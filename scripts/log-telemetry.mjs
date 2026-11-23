#!/usr/bin/env node
// scripts/log-telemetry.mjs — validate one telemetry event and append it to the JSONL log
// (SPEC.md §5.2). Zero third-party dependencies: Node.js >= 20 built-ins only.
//
// Usage:
//   node scripts/log-telemetry.mjs [--dry-run] [--file <path>] --json '<event>'
//   <producer> | node scripts/log-telemetry.mjs [--dry-run] [--file <path>]
//
//   --json <event>   The event as a JSON object. When absent, the event is read from stdin.
//   --file <path>    Append to this file instead of ~/.rcstack/telemetry.jsonl.
//   --dry-run        Validate and print the row; write nothing.
//
// The event must satisfy contracts/telemetry-event.schema.json and two rules the schema
// cannot express: the timestamp is a real calendar instant, and reviewer_model differs
// from builder_model. A valid event is appended as exactly one newline-terminated line in
// a single O_APPEND write, so concurrent loggers never interleave rows.
//
// Exit: 0 = valid (and appended unless --dry-run), 1 = invalid event or write failure,
//       2 = bad invocation.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO_ROOT, lintSchema, validateSchema } from './verify.mjs';

const SCHEMA_FILE = path.join(REPO_ROOT, 'contracts', 'telemetry-event.schema.json');
const USAGE = `Usage: node scripts/log-telemetry.mjs [--dry-run] [--file <path>] [--json '<event>']
       (without --json the event is read from stdin)`;

class UsageError extends Error {}
class InvalidEvent extends Error {
  constructor(problems) {
    super('invalid telemetry event');
    this.problems = problems;
  }
}

function parseArgs(argv) {
  const opts = { dryRun: false, help: false, file: undefined, json: undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const inline = /^--(file|json)=([\s\S]*)$/.exec(arg);
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--file' || arg === '--json' || inline) {
      const key = inline ? inline[1] : arg.slice(2);
      const value = inline ? inline[2] : argv[++i];
      if (value === undefined || value === '') throw new UsageError(`--${key} requires a value`);
      if (opts[key] !== undefined) throw new UsageError(`--${key} was given more than once`);
      opts[key] = value;
    } else throw new UsageError(`unknown argument "${arg}"`);
  }
  return opts;
}

function readPayload(opts) {
  if (opts.json !== undefined) return opts.json;
  if (process.stdin.isTTY) throw new UsageError('no event given: pass --json or pipe the event on stdin');
  return fs.readFileSync(0, 'utf8');
}

function loadSchema() {
  const schema = JSON.parse(fs.readFileSync(SCHEMA_FILE, 'utf8'));
  const problems = lintSchema(schema);
  if (problems.length > 0) throw new Error(`${SCHEMA_FILE} is not a supported schema: ${problems[0]}`);
  return schema;
}

function isRealUtcInstant(timestamp) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/.exec(timestamp);
  if (!m) return false;
  const [year, month, day, hour, minute, second] = m.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    && date.getUTCHours() === hour && date.getUTCMinutes() === minute && date.getUTCSeconds() === second;
}

const normalizeModel = (name) => name.replace(/\s+/g, ' ').trim().toLowerCase();

function validateEvent(schema, payload) {
  if (payload.trim() === '') throw new InvalidEvent(['the event payload is empty']);
  let event;
  try {
    event = JSON.parse(payload);
  } catch (e) {
    throw new InvalidEvent([`the event is not valid JSON (${e.message})`]);
  }
  const problems = validateSchema(schema, event);
  if (problems.length > 0) throw new InvalidEvent(problems);

  // Cross-field rules that JSON Schema cannot express.
  if (!isRealUtcInstant(event.timestamp)) problems.push('/timestamp: is not a real calendar date and time');
  if (event.reviewer_model !== null && normalizeModel(event.reviewer_model) === normalizeModel(event.builder_model)) {
    problems.push('/reviewer_model: must differ from builder_model (reviewer != builder); use null when no cross-model audit ran');
  }
  if (problems.length > 0) throw new InvalidEvent(problems);

  // Emit keys in schema order so rows are uniform regardless of how the caller built them.
  const row = {};
  for (const key of Object.keys(schema.properties)) if (Object.hasOwn(event, key)) row[key] = event[key];
  return JSON.stringify(row);
}

function appendRow(target, line) {
  const dir = path.dirname(target);
  const isDefaultDir = dir === path.join(os.homedir(), '.rcstack');
  fs.mkdirSync(dir, { recursive: true, ...(isDefaultDir ? { mode: 0o700 } : {}) });
  const fd = fs.openSync(target, 'a+', 0o600);
  try {
    // If an earlier writer was cut off mid-row, start on a fresh line instead of gluing rows.
    const { size } = fs.fstatSync(fd);
    const last = Buffer.alloc(1);
    const unterminated = size > 0 && fs.readSync(fd, last, 0, 1, size - 1) === 1 && last[0] !== 0x0a;
    const data = Buffer.from(`${unterminated ? '\n' : ''}${line}\n`, 'utf8');
    const written = fs.writeSync(fd, data);
    if (written !== data.length) throw new Error(`short write (${written} of ${data.length} bytes); the last row may be incomplete`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
    if (opts.help) {
      console.log(USAGE);
      return 0;
    }
    const payload = readPayload(opts);
    const line = validateEvent(loadSchema(), payload);
    const target = path.resolve(opts.file ?? path.join(os.homedir(), '.rcstack', 'telemetry.jsonl'));
    if (opts.dryRun) {
      console.log(`[DRY-RUN] valid telemetry event; nothing written (target: ${target})`);
      console.log(line);
      return 0;
    }
    appendRow(target, line);
    console.log(`[OK] appended 1 row to ${target}`);
    return 0;
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(`[ERROR] ${e.message}\n${USAGE}`);
      return 2;
    }
    if (e instanceof InvalidEvent) {
      for (const problem of e.problems) console.error(`[FAIL] ${problem}`);
      console.error(`[FAIL] event rejected: ${e.problems.length} problem(s); nothing written`);
      return 1;
    }
    console.error(`[ERROR] ${e.message}`);
    return 1;
  }
}

process.exitCode = main();
