#!/usr/bin/env node
/**
 * scripts/rc-log.mjs — schema-validated JSONL telemetry appender.
 *
 *   node scripts/rc-log.mjs --json '<payload>' [--runtime-dir <dir>] [--file <path>] [--dry-run]
 *   echo '<payload>' | node scripts/rc-log.mjs
 *
 * Validates one event against contracts/telemetry-event.schema.json, applies the cross-field rules
 * JSON Schema cannot express (no self-review, no unaudited A2/A3), and appends one compact line to
 * <runtime-dir>/telemetry.jsonl (default ~/.rcstack/runtime).
 *
 * Prints one JSON object. Exit status: 0 appended (or valid under --dry-run), 1 rejected.
 * Zero dependencies: Node.js >= 20 built-ins only.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { validateSchema, sameModel, PLAYBOOKS, ASSURANCE_LEVELS, ANY_OF_MISMATCH } from './verify.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_SCHEMA = path.join(HERE, '..', 'contracts', 'telemetry-event.schema.json');

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * True when every builder was reviewed by at least one model other than itself. Models are
 * compared by identity, not spelling: a display name and its catalog id are the same model.
 */
function independentlyReviewed(event) {
  return event.reviewers.length > 0 && event.builders.every((b) => event.reviewers.some((r) => !sameModel(r, b)));
}

/** Cross-field rules. Call only on a schema-valid event. */
export function semanticErrors(event) {
  const errors = [];
  for (const field of ['builders', 'reviewers']) {
    const list = event[field];
    const twin = list.find((name, i) => list.slice(0, i).some((other) => sameModel(other, name)));
    if (twin !== undefined) errors.push(`${field} lists the same model twice under different spellings ("${twin}")`);
  }
  const overlap = event.builders.filter((b) => event.reviewers.some((r) => sameModel(r, b)));

  // reviewer != builder. Degraded runs had no independent reviewer at all, so reviewers and audit
  // counts must be empty; on audited runs, overlap is only legitimate when several builders
  // cross-reviewed each other so nobody reviewed only their own work.
  if (event.degraded_single_harness) {
    if (event.reviewers.length > 0) {
      errors.push('degraded_single_harness run must have empty reviewers (no independent audit ran)');
    }
    for (const field of ['audit_accepted', 'audit_dismissed']) {
      if (Object.keys(event[field]).length > 0) {
        errors.push(`degraded_single_harness run must have empty ${field} (no independent audit ran)`);
      }
    }
  } else if (overlap.length > 0) {
    if (event.builders.length === 1) {
      errors.push(`self-review: "${overlap[0]}" is the sole builder and is also listed as a reviewer (reviewer != builder)`);
    } else if (!independentlyReviewed(event)) {
      const alone = event.builders.filter((b) => !event.reviewers.some((r) => !sameModel(r, b)));
      errors.push(`self-review: no reviewer other than itself for builder(s) ${alone.map((b) => `"${b}"`).join(', ')}`);
    }
  }

  // A2 and A3 include an independent audit by definition; a row may not claim them without one.
  // A degraded single-harness run had no independent reviewer, so it tops out at A1.
  if (ASSURANCE_LEVELS.indexOf(event.achieved_assurance) >= 2) {
    if (event.degraded_single_harness) {
      errors.push(`achieved_assurance ${event.achieved_assurance} is impossible for a degraded_single_harness run: without an independent reviewer it tops out at A1`);
    } else if (!independentlyReviewed(event)) {
      errors.push(`achieved_assurance ${event.achieved_assurance} requires an independent audit: every builder needs a reviewer other than itself`);
    }
  }

  if (event.escalated_from_tier !== null && event.escalated_from_tier >= event.risk_tier) {
    errors.push(`escalated_from_tier ${event.escalated_from_tier} must be below risk_tier ${event.risk_tier}`);
  }

  const playbook = PLAYBOOKS.find((p) => p.name === event.playbook);
  if (playbook && `rcstack-${playbook.domain}` !== event.profile) {
    errors.push(`playbook "${event.playbook}" belongs to rcstack-${playbook.domain}, not ${event.profile}`);
  }

  if (!event.degraded_single_harness) {
    for (const field of ['audit_accepted', 'audit_dismissed']) {
      for (const model of Object.keys(event[field])) {
        if (!event.reviewers.some((r) => sameModel(r, model))) errors.push(`${field} counts findings for "${model}", which is not listed in reviewers`);
      }
    }
  }

  // Date.parse() rolls impossible dates over (February 31 becomes March 3), so round-trip it.
  const parsed = new Date(event.ts);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 19) !== event.ts.slice(0, 19)) {
    errors.push(`ts "${event.ts}" is not a real date-time`);
  }
  return errors;
}

/** Schema errors, then (only when the shape is valid) cross-field errors. */
export function validateEvent(event, schema) {
  if (!isPlainObject(event)) return ['$: the telemetry payload must be a JSON object'];
  const errors = validateSchema(event, schema);
  if (errors.length === 0) return semanticErrors(event);
  // If every property passed shape/type checks and only a root cross-field rule failed,
  // return the specific semantic errors instead of a generic shape mismatch.
  if (errors.length === 1 && errors[0] === `$: ${ANY_OF_MISMATCH}`) {
    const semantic = semanticErrors(event);
    if (semantic.length > 0) return semantic;
  }
  return errors;
}

/** Append one line. Refuses to follow a symlink, and repairs a missing trailing newline first. */
export function appendLine(file, line) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  let prefix = '';
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile()) throw new Error(`${file} is not a regular file`);
    if (st.size > 0) {
      const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try {
        const last = Buffer.alloc(1);
        fs.readSync(fd, last, 0, 1, st.size - 1);
        if (last[0] !== 0x0a) prefix = '\n';
      } finally {
        fs.closeSync(fd);
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const data = `${prefix}${line}\n`;
  const flags = fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW;
  const fd = fs.openSync(file, flags, 0o600);
  try {
    fs.writeSync(fd, data);
  } finally {
    fs.closeSync(fd);
  }
  return Buffer.byteLength(data);
}

const USAGE = `Usage: node scripts/rc-log.mjs [--json '<payload>'] [--runtime-dir <dir>] [--file <path>] [--schema <path>] [--dry-run]

  --json         telemetry event as a JSON object (default: read it from stdin)
  --runtime-dir  directory holding telemetry.jsonl (default: ~/.rcstack/runtime)
  --file         append to this file instead of <runtime-dir>/telemetry.jsonl
  --schema       event schema (default: contracts/telemetry-event.schema.json next to this script)
  --dry-run      validate and print the line without writing anything
Prints a JSON result. Exit status: 0 appended or valid, 1 rejected.`;

function reject(errors) {
  console.log(JSON.stringify({ status: 'REJECTED', errors }, null, 2));
  return 1;
}

export function main(argv) {
  const opts = { json: null, runtimeDir: null, file: null, schema: DEFAULT_SCHEMA, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const eq = arg.startsWith('--') ? arg.indexOf('=') : -1;
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    const value = () => {
      if (eq !== -1) return arg.slice(eq + 1);
      i += 1;
      if (i >= argv.length) throw new Error(`${flag} needs a value`);
      return argv[i];
    };
    try {
      if ((flag === '--help' || flag === '--dry-run') && eq !== -1) throw new Error(`${flag} takes no value`);
      if (flag === '--help' || flag === '-h') {
        console.log(USAGE);
        return 0;
      } else if (flag === '--dry-run') opts.dryRun = true;
      else if (flag === '--json') opts.json = value();
      else if (flag === '--runtime-dir') opts.runtimeDir = value();
      else if (flag === '--file') opts.file = value();
      else if (flag === '--schema') opts.schema = value();
      else throw new Error(`unknown argument "${arg}"`);
    } catch (err) {
      console.error(USAGE);
      return reject([`usage: ${err.message}`]);
    }
  }

  let schema;
  try {
    schema = JSON.parse(fs.readFileSync(opts.schema, 'utf8'));
  } catch (err) {
    return reject([`cannot load schema ${opts.schema}: ${err.message}`]);
  }

  let event;
  try {
    event = JSON.parse(opts.json ?? fs.readFileSync(0, 'utf8'));
  } catch (err) {
    return reject([`payload is not valid JSON: ${err.message}`]);
  }

  let errors;
  try {
    errors = validateEvent(event, schema);
  } catch (err) {
    return reject([`schema ${opts.schema} is unusable: ${err.message}`]);
  }
  if (errors.length > 0) return reject(errors);

  // Canonical key order (the schema's `required` list) keeps rows diffable.
  const ordered = {};
  for (const key of schema.required) ordered[key] = event[key];
  const line = JSON.stringify(ordered);
  const file = path.resolve(opts.file ?? path.join(opts.runtimeDir ?? path.join(os.homedir(), '.rcstack', 'runtime'), 'telemetry.jsonl'));

  if (opts.dryRun) {
    console.log(JSON.stringify({ status: 'DRY_RUN', file, line }, null, 2));
    return 0;
  }
  try {
    const bytes = appendLine(file, line);
    console.log(JSON.stringify({ status: 'APPENDED', file, bytes }, null, 2));
    return 0;
  } catch (err) {
    return reject([`cannot append to ${file}: ${err.message}`]);
  }
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) process.exitCode = main(process.argv.slice(2));
