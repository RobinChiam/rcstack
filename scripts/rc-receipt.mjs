#!/usr/bin/env node
/**
 * scripts/rc-receipt.mjs — 4-point deterministic Work Receipt admission gate.
 *
 *   node scripts/rc-receipt.mjs --receipt <file|-> [--repo <path>] [--allowed-paths <glob,glob>]
 *
 * 1. Schema completeness   every contracts/work-receipt.md field present and correctly typed
 * 2. Git boundary          `git diff --name-only base..head` equals files_touched, every file is
 *                          inside --allowed-paths, head is on the checked-out branch, tree is clean
 * 3. Command proof         verify_cmd is non-empty and verify_exit_code is 0
 * 4. Assurance tagging     A0-A3 computed from the evidence fields, never claimed
 *
 * Prints one JSON object. Exits 0 on ADMITTED and 1 on REJECTED (with every failure reason).
 * Zero dependencies: Node.js >= 20 built-ins only.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseYaml, globToRegExp } from './verify.mjs';

export const RECEIPT_FIELDS = Object.freeze([
  'slice',
  'base_sha',
  'head_sha',
  'files_touched',
  'verify_cmd',
  'verify_exit_code',
  'checks_passed',
  'audit_blockers',
  'audit_majors',
  'assumptions',
  'review_hotspot',
]);
export const CHECK_CLASSES = Object.freeze(['mechanical', 'behavioral', 'hardened']);

const SHA = /^[0-9a-f]{7,64}$/;
const HOTSPOT = /^(.+):[1-9]\d*$/;

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isRepoRelativePath(p) {
  if (typeof p !== 'string' || p === '' || p.startsWith('/') || /[\0\\]/.test(p)) return false;
  return !p.split('/').some((seg) => seg === '' || seg === '.' || seg === '..');
}

/** Parse a receipt: a JSON object, a bare strict-YAML mapping, or Markdown with one fenced block. */
export function parseReceipt(text) {
  if (typeof text !== 'string' || text.trim() === '') throw new Error('receipt is empty');
  let source = text.trim();
  let asJson = source.startsWith('{');
  if (!asJson) {
    const fence = /^(?:```|~~~)[ \t]*(ya?ml|json|receipt)?[ \t]*\n([\s\S]*?)\n(?:```|~~~)[ \t]*$/m.exec(text);
    if (fence) {
      source = fence[2];
      asJson = fence[1] === 'json' || source.trim().startsWith('{');
    } else {
      source = text;
    }
  }
  let receipt;
  try {
    receipt = asJson ? JSON.parse(source) : parseYaml(source);
  } catch (err) {
    throw new Error(`receipt is not valid ${asJson ? 'JSON' : 'strict YAML'}: ${err.message}`);
  }
  if (!isPlainObject(receipt)) throw new Error('receipt must be a mapping of fields');
  return receipt;
}

/** Point 1: every required field present and correctly typed. Returns failure reasons. */
export function schemaErrors(r) {
  const e = [];
  const has = (f) => Object.hasOwn(r, f);
  for (const f of RECEIPT_FIELDS) if (!has(f)) e.push(`missing field "${f}"`);
  for (const f of Object.keys(r)) if (!RECEIPT_FIELDS.includes(f)) e.push(`unknown field "${f}"`);

  if (has('slice') && !(typeof r.slice === 'string' && r.slice.trim() !== '' && !/[\r\n]/.test(r.slice))) {
    e.push('slice must be a non-empty one-line string');
  }
  for (const f of ['base_sha', 'head_sha']) {
    if (has(f) && !(typeof r[f] === 'string' && SHA.test(r[f]))) {
      e.push(`${f} must be a double-quoted commit SHA (7-64 lowercase hex characters)`);
    }
  }
  let files = null;
  if (has('files_touched')) {
    if (!Array.isArray(r.files_touched) || r.files_touched.length === 0) {
      e.push('files_touched must be a non-empty list of repo-relative paths');
    } else if (!r.files_touched.every(isRepoRelativePath)) {
      e.push('files_touched entries must be repo-relative paths without "." or ".." segments');
    } else if (new Set(r.files_touched).size !== r.files_touched.length) {
      e.push('files_touched lists a path more than once');
    } else {
      files = r.files_touched;
    }
  }
  if (has('verify_cmd') && typeof r.verify_cmd !== 'string') e.push('verify_cmd must be a string');
  if (has('verify_exit_code') && !Number.isInteger(r.verify_exit_code)) e.push('verify_exit_code must be an integer');
  if (has('checks_passed')) {
    const c = r.checks_passed;
    if (!Array.isArray(c) || !c.every((x) => CHECK_CLASSES.includes(x)) || new Set(c).size !== c.length) {
      e.push(`checks_passed must be a list drawn from ${CHECK_CLASSES.join(', ')} without repeats`);
    }
  }
  const isCount = (v) => v === null || (Number.isInteger(v) && v >= 0);
  for (const f of ['audit_blockers', 'audit_majors']) {
    if (has(f) && !isCount(r[f])) e.push(`${f} must be an integer >= 0, or null when no independent audit has run`);
  }
  if (has('audit_blockers') && has('audit_majors') && isCount(r.audit_blockers) && isCount(r.audit_majors)) {
    if ((r.audit_blockers === null) !== (r.audit_majors === null)) {
      e.push('audit_blockers and audit_majors must both be null (no audit yet) or both be counts');
    }
  }
  if (has('assumptions') && !(Array.isArray(r.assumptions) && r.assumptions.every((x) => typeof x === 'string'))) {
    e.push('assumptions must be a list of strings (use [] for none)');
  }
  if (has('review_hotspot')) {
    const h = r.review_hotspot;
    if (!Array.isArray(h) || h.length < 1 || h.length > 2 || !h.every((x) => typeof x === 'string' && HOTSPOT.test(x))) {
      e.push('review_hotspot must list 1 or 2 "file:line" anchors');
    } else if (files) {
      for (const anchor of h) {
        const file = HOTSPOT.exec(anchor)[1];
        if (!files.includes(file)) e.push(`review_hotspot "${anchor}" does not point into files_touched`);
      }
    }
  }
  return e;
}

function git(repo, args) {
  const res = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return {
    ok: !res.error && res.status === 0,
    stdout: res.stdout ?? '',
    stderr: res.error ? res.error.message : (res.stderr ?? '').trim(),
  };
}

/**
 * Point 2: the receipt's claim matches git exactly, stays in bounds, and the tree is clean.
 * Every command runs from the repository root with explicit options, so neither a `--repo` that
 * points at a subdirectory nor a machine-wide git config (`diff.relative`,
 * `status.showUntrackedFiles`, ignored submodules) can hide a changed or untracked file.
 */
export function gitBoundary(receipt, repoArg, allowedPaths = null) {
  const errors = [];
  const out = { errors, base: null, head: null, files: null };
  const top = git(repoArg, ['rev-parse', '--show-toplevel']);
  if (!top.ok) {
    errors.push(`"${repoArg}" is not a git work tree`);
    return out;
  }
  const repo = top.stdout.replace(/\r?\n$/, '');
  const resolve = (sha, label) => {
    const res = git(repo, ['rev-parse', '--verify', '--quiet', `${sha}^{commit}`]);
    if (!res.ok) errors.push(`${label} ${sha} is not a commit in this repository`);
    return res.ok ? res.stdout.trim() : null;
  };
  out.base = resolve(receipt.base_sha, 'base_sha');
  out.head = resolve(receipt.head_sha, 'head_sha');

  if (out.base && out.head) {
    if (out.base === out.head) {
      errors.push('base_sha and head_sha are the same commit; the receipt covers no work');
    } else if (!git(repo, ['merge-base', '--is-ancestor', out.base, out.head]).ok) {
      errors.push('base_sha is not an ancestor of head_sha');
    }
    if (!git(repo, ['merge-base', '--is-ancestor', out.head, 'HEAD']).ok) {
      errors.push(`head_sha ${out.head.slice(0, 12)} is not contained in the checked-out branch`);
    }
    const diff = git(repo, ['-c', 'diff.relative=false', 'diff', '--name-only', '--no-renames', '--ignore-submodules=none', '-z', `${out.base}..${out.head}`]);
    if (!diff.ok) {
      errors.push(`git diff failed: ${diff.stderr}`);
    } else {
      out.files = diff.stdout.split('\0').filter(Boolean).sort();
      const claimed = new Set(receipt.files_touched);
      const actual = new Set(out.files);
      for (const f of out.files) if (!claimed.has(f)) errors.push(`changed but not listed in files_touched: ${f}`);
      for (const f of receipt.files_touched) if (!actual.has(f)) errors.push(`listed in files_touched but not changed: ${f}`);
      if (allowedPaths) {
        const matchers = allowedPaths.map(globToRegExp);
        for (const f of new Set([...out.files, ...receipt.files_touched])) {
          if (!matchers.some((re) => re.test(f))) errors.push(`outside --allowed-paths: ${f}`);
        }
      }
    }
  }

  // --no-optional-locks: checking cleanliness must not write to the repository's index.
  const status = git(repo, ['--no-optional-locks', 'status', '--porcelain', '--untracked-files=normal', '--ignore-submodules=none']);
  if (!status.ok) {
    errors.push(`git status failed: ${status.stderr}`);
  } else if (status.stdout.trim() !== '') {
    const count = status.stdout.trim().split('\n').length;
    errors.push(`working tree is not clean (${count} uncommitted or untracked path(s))`);
  }
  return out;
}

/** Point 4: the assurance level the evidence supports. Call only on a schema-valid receipt. */
export function computeAssurance(r) {
  const passed = (c) => r.checks_passed.includes(c);
  if (r.verify_exit_code !== 0 || !passed('mechanical')) return 'A0';
  if (!passed('behavioral') || r.audit_blockers !== 0) return 'A1';
  if (!passed('hardened') || r.audit_majors !== 0) return 'A2';
  return 'A3';
}

/** Parse comma-separated globs. Throws when the list is empty or a glob is invalid. */
export function parseAllowedPaths(value) {
  const globs = String(value)
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean);
  if (globs.length === 0) throw new Error('--allowed-paths needs at least one glob');
  globs.forEach(globToRegExp);
  return globs;
}

/**
 * Run the 4-point gate. `allowedPaths` is a list of globs or null. Never throws for a bad
 * receipt: every problem becomes a reason on a REJECTED result.
 */
export function evaluateReceipt({ receiptText, repo, allowedPaths = null }) {
  const checks = {
    schema_completeness: 'fail',
    git_boundary: 'skipped',
    command_proof: 'skipped',
    assurance_tagging: 'skipped',
  };
  const reasons = [];
  const result = {
    status: 'REJECTED',
    assurance: null,
    slice: null,
    base_sha: null,
    head_sha: null,
    files_touched: [],
    verify_cmd: null,
    checks_passed: [],
    audit_blockers: null,
    audit_majors: null,
    checks,
    reasons,
  };
  const add = (check, list) => reasons.push(...list.map((m) => `${check}: ${m}`));

  let receipt;
  try {
    receipt = parseReceipt(receiptText);
  } catch (err) {
    add('schema_completeness', [err.message]);
    return result;
  }
  const schema = schemaErrors(receipt);
  add('schema_completeness', schema);
  if (typeof receipt.slice === 'string') result.slice = receipt.slice;

  if (typeof receipt.verify_cmd === 'string' && Number.isInteger(receipt.verify_exit_code)) {
    const proof = [];
    if (receipt.verify_cmd.trim() === '') proof.push('verify_cmd is empty');
    if (receipt.verify_exit_code !== 0) proof.push(`verify_exit_code is ${receipt.verify_exit_code}, not 0`);
    add('command_proof', proof);
    checks.command_proof = proof.length === 0 ? 'pass' : 'fail';
  }
  if (schema.length > 0) return result;
  checks.schema_completeness = 'pass';
  result.verify_cmd = receipt.verify_cmd;
  result.checks_passed = receipt.checks_passed;
  result.audit_blockers = receipt.audit_blockers;
  result.audit_majors = receipt.audit_majors;

  const boundary = gitBoundary(receipt, repo, allowedPaths);
  add('git_boundary', boundary.errors);
  checks.git_boundary = boundary.errors.length === 0 ? 'pass' : 'fail';
  result.base_sha = boundary.base;
  result.head_sha = boundary.head;
  result.files_touched = boundary.files ?? [];

  if (reasons.length > 0) return result;
  result.assurance = computeAssurance(receipt);
  checks.assurance_tagging = 'pass';
  result.status = 'ADMITTED';
  return result;
}

const USAGE = `Usage: node scripts/rc-receipt.mjs --receipt <file|-> [--repo <path>] [--allowed-paths <glob,glob>]

  --receipt        Work Receipt file (contracts/work-receipt.md format), or "-" for stdin
  --repo           git work tree the receipt describes (default: current directory)
  --allowed-paths  comma-separated repo-relative globs every touched file must match
Prints a JSON admission result. Exit status: 0 ADMITTED, 1 REJECTED or usage error.`;

function rejectUsage(message) {
  console.log(JSON.stringify({ status: 'REJECTED', assurance: null, reasons: [`usage: ${message}`] }, null, 2));
  console.error(USAGE);
  return 1;
}

export function main(argv) {
  const opts = { receipt: null, repo: process.cwd(), allowed: null };
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
      if (flag === '--help' || flag === '-h') {
        console.log(USAGE);
        return 0;
      } else if (flag === '--receipt') opts.receipt = value();
      else if (flag === '--repo') opts.repo = value();
      else if (flag === '--allowed-paths') opts.allowed = parseAllowedPaths(value());
      else throw new Error(`unknown argument "${arg}"`);
    } catch (err) {
      return rejectUsage(err.message);
    }
  }
  if (opts.receipt === null) return rejectUsage('--receipt <file|-> is required');

  let receiptText;
  try {
    receiptText = fs.readFileSync(opts.receipt === '-' ? 0 : opts.receipt, 'utf8');
  } catch (err) {
    return rejectUsage(`cannot read receipt: ${err.message}`);
  }
  const result = evaluateReceipt({ receiptText, repo: path.resolve(opts.repo), allowedPaths: opts.allowed });
  console.log(JSON.stringify(result, null, 2));
  return result.status === 'ADMITTED' ? 0 : 1;
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
