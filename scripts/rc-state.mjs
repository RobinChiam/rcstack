#!/usr/bin/env node
/**
 * scripts/rc-state.mjs — atomic single-writer task state mutator + shadow git controller.
 *
 *   node scripts/rc-state.mjs init       --profile <p> --playbook <name> --tier <0-3> --goal "<text>"
 *                                        [--required-assurance <A0-A3>] [--base-sha <sha>]
 *   node scripts/rc-state.mjs transition --expected-rev <N> [--to <PHASE>] [--admit-receipt <file|->]
 *                                        [--allowed-paths <glob,glob>] [--next "<text>"]
 *                                        [--blocker "<text>"] [--resolve-blockers]
 *                                        [--escalate-tier <n>] [--ack-assurance-gap]
 *   node scripts/rc-state.mjs show       [--json]
 *   node scripts/rc-state.mjs reconcile
 *   node scripts/rc-state.mjs close      --expected-rev <N> [--abandon]
 *
 * Common flags: --repo <path> (default: cwd), --runtime-dir <path> (default: ~/.rcstack/runtime),
 *               --branch <name>, --repo-name <name>, --lock-timeout-ms <n>, --stale-lock-ms <n>
 *
 * State lives at <runtime-dir>/state/<repo-slug>/<branch-slug>.md inside a local-only shadow git
 * repository. Every mutation takes an exclusive lock, checks the optimistic revision, writes a
 * temp file, renames it into place, and commits:
 *   state(<repo>/<branch>): <OLD_PHASE> -> <NEW_PHASE> (rev <N>, <Ax>)
 * The shadow history is the state. Every decision reads the last shadow commit, never the working
 * file, so a hand edit or a write left by a crashed writer cannot influence anything; the next
 * writer puts the committed revision back.
 * Every decision is also made on the repository as it is once the lock is held.
 *
 * Achieved assurance comes only from an admitted integrated receipt (the task's base to the
 * current HEAD) and is reset to A0 as soon as HEAD moves past it.
 *
 * Exit status: 0 success (reconcile: in sync), 1 error, 2 reconcile found drift (git beats state).
 * Zero dependencies: Node.js >= 20 built-ins only.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseYaml, splitFrontmatter, PROFILE_NAMES, PLAYBOOKS, ASSURANCE_LEVELS } from './verify.mjs';
import { evaluateReceipt, parseAllowedPaths } from './rc-receipt.mjs';

export const PHASES = Object.freeze([
  'TRIAGE',
  'RESEARCHING',
  'PLANNING',
  'EXECUTING',
  'VERIFYING',
  'AUDITING',
  'AWAITING_REVIEW',
  'SHIPPED',
  'BLOCKED',
]);

/**
 * TRIAGE -> RESEARCHING -> PLANNING -> EXECUTING <-> VERIFYING -> AUDITING -> AWAITING_REVIEW -> SHIPPED
 * AUDITING -> EXECUTING is the Blocker loop; AWAITING_REVIEW -> EXECUTING is the same loop when the
 * human raises the blocker. Any phase except SHIPPED may enter BLOCKED, which returns only to the
 * phase it left, so BLOCKED can never be used to skip a gate.
 */
export const TRANSITIONS = Object.freeze({
  TRIAGE: ['RESEARCHING'],
  RESEARCHING: ['PLANNING'],
  PLANNING: ['EXECUTING'],
  EXECUTING: ['VERIFYING'],
  VERIFYING: ['EXECUTING', 'AUDITING'],
  AUDITING: ['EXECUTING', 'AWAITING_REVIEW'],
  AWAITING_REVIEW: ['EXECUTING', 'SHIPPED'],
  SHIPPED: [],
});

const META_FIELDS = Object.freeze([
  'schema_version',
  'rev',
  'repo',
  'branch',
  'profile',
  'playbook',
  'risk_tier',
  'required_assurance',
  'achieved_assurance',
  'phase',
  'base_sha',
  'head_sha',
  'verify_attempts',
  'updated_at',
]);
/** Present only while they carry information: where BLOCKED returns to, and the pre-escalation tier. */
const OPTIONAL_META = Object.freeze(['blocked_from', 'escalated_from_tier']);
const BODY_HEADINGS = Object.freeze(['## Active Goal', '## Admitted Receipts', '## Next Step', '## Open Blockers']);
const NONE = '_None._';
const BLOCKED_TAG = '[BLOCKED] ';
const TIER3_PROFILE = 'rcstack-engineering';
const TIER3_PLAYBOOK = 'security-critical';
const SHA = /^[0-9a-f]{7,64}$/;
const FULL_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

export class StateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'StateError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new StateError(code, message);
}

function note(message) {
  console.error(`rc-state: note: ${message}`);
}

// ------------------------------------------------------------------------------------------
// git
// ------------------------------------------------------------------------------------------

function runGit(cwd, args) {
  const res = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return {
    ok: !res.error && res.status === 0,
    stdout: res.stdout ?? '',
    stderr: res.error ? res.error.message : (res.stderr ?? '').trim(),
  };
}

/** Shadow-repo git: fixed identity, no hooks, no signing, so machine git config cannot interfere. */
function shadowGit(runtimeDir, args) {
  return runGit(runtimeDir, [
    '-c',
    'core.hooksPath=/dev/null',
    '-c',
    'commit.gpgsign=false',
    '-c',
    'user.name=rcstack',
    '-c',
    'user.email=rcstack@localhost',
    '-c',
    'core.excludesFile=/dev/null',
    ...args,
  ]);
}

function lstatOrNull(p) {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
}

/** Resolve symlinks in the part of a path that exists; the rest (not created yet) is appended. */
function realpathOrSelf(p) {
  let current = path.resolve(p);
  const rest = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync(current), ...rest);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(p);
      rest.unshift(path.basename(current));
      current = parent;
    }
  }
}

function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Make sure the runtime directory is a local-only git repository of its own. */
export function ensureRuntime(runtimeDir) {
  fs.mkdirSync(runtimeDir, { recursive: true });
  const gitDir = lstatOrNull(path.join(runtimeDir, '.git'));
  if (gitDir !== null && !gitDir.isDirectory()) {
    // `git init` would follow a symlink and build a repository wherever it points.
    fail('RUNTIME_NOT_A_REPO', `${path.join(runtimeDir, '.git')} exists but is not a directory`);
  }
  if (gitDir === null) {
    const init = runGit(runtimeDir, ['-c', 'init.defaultBranch=main', 'init', '-q']);
    if (!init.ok) fail('RUNTIME_INIT_FAILED', `git init failed in ${runtimeDir}: ${init.stderr}`);
  }
  const top = runGit(runtimeDir, ['rev-parse', '--show-toplevel']);
  if (!top.ok || realpathOrSelf(top.stdout.trim()) !== realpathOrSelf(runtimeDir)) {
    fail('RUNTIME_NOT_A_REPO', `${runtimeDir} is not the root of its own git repository`);
  }
  const remotes = runGit(runtimeDir, ['remote']).stdout.trim();
  if (remotes !== '') {
    fail('REMOTE_CONFIGURED', `the runtime shadow repository must stay local-only, but has remote(s): ${remotes.replace(/\n/g, ', ')}`);
  }
}

/** Identity of the target repository: its name, branch, HEAD, and whether the tree is dirty. */
function repoIdentity(repoArg, { branch: branchOverride, name: nameOverride } = {}) {
  const repo = path.resolve(repoArg);
  const top = runGit(repo, ['rev-parse', '--show-toplevel']);
  if (!top.ok) fail('NOT_A_REPO', `${repo} is not a git work tree`);
  const topDir = top.stdout.trim();
  // Worktrees share one identity: name the repository after its main checkout.
  const common = path.resolve(repo, runGit(repo, ['rev-parse', '--git-common-dir']).stdout.trim());
  const name = nameOverride ?? (path.basename(common) === '.git' ? path.basename(path.dirname(common)) : path.basename(topDir));
  const head = runGit(topDir, ['rev-parse', '--verify', '--quiet', 'HEAD']);
  if (!head.ok) fail('NO_COMMITS', `${topDir} has no commits yet`);
  const live = runGit(topDir, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  const liveBranch = live.ok ? live.stdout.trim() : null;
  const branch = branchOverride ?? liveBranch;
  if (!branch) fail('DETACHED_HEAD', 'HEAD is detached; pass --branch <name>');
  for (const [label, value] of [['repository name', name], ['branch', branch]]) {
    if (value === '' || value.length > 250 || CONTROL.test(value)) fail('USAGE', `invalid ${label} "${value}"`);
  }
  // Explicit flags, so a machine-wide git config cannot hide untracked files or submodule changes.
  const status = runGit(topDir, ['--no-optional-locks', 'status', '--porcelain', '--untracked-files=normal', '--ignore-submodules=none']);
  if (!status.ok) fail('GIT_FAILED', `git status failed in ${topDir}: ${status.stderr}`);
  const dirty = status.stdout.trim() === '' ? 0 : status.stdout.trim().split('\n').length;
  return { top: topDir, name, branch, liveBranch, head: head.stdout.trim(), dirty };
}

function resolveCommit(repo, sha, label) {
  if (!SHA.test(sha)) fail('USAGE', `${label} must be a commit SHA (7-64 lowercase hex characters)`);
  const res = runGit(repo, ['rev-parse', '--verify', '--quiet', `${sha}^{commit}`]);
  if (!res.ok) fail('UNKNOWN_COMMIT', `${label} ${sha} is not a commit in the repository`);
  return res.stdout.trim();
}

// ------------------------------------------------------------------------------------------
// state file
// ------------------------------------------------------------------------------------------

/**
 * A filesystem-safe slug. A name that had to be altered gets a digest of the exact name appended,
 * so two different names ("feature/x" and "feature-x") never share a state file.
 */
export function slugify(text) {
  const base = text
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .slice(0, 100)
    .replace(/^[-.]+|[-.]+$/g, '');
  if (base === text) return base;
  const digest = crypto.createHash('sha256').update(text).digest('hex').slice(0, 8);
  return `${base || 'x'}-${digest}`;
}

export function stateRelPath(repoName, branch) {
  return `state/${slugify(repoName)}/${slugify(branch)}.md`;
}

function oneLine(value, label, max = 500) {
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (text === '') fail('USAGE', `${label} must not be empty`);
  if (CONTROL.test(text)) fail('USAGE', `${label} contains control characters`);
  if (text.length > max) fail('USAGE', `${label} is longer than ${max} characters`);
  return text.startsWith('#') ? `\\${text}` : text;
}

function rank(assurance) {
  return ASSURANCE_LEVELS.indexOf(assurance);
}

function isEscalatedTier3(meta) {
  return meta.risk_tier === 3 && meta.escalated_from_tier !== undefined;
}

function applyTier3EscalatedRoute(meta) {
  meta.profile = TIER3_PROFILE;
  meta.playbook = TIER3_PLAYBOOK;
  meta.risk_tier = 3;
  if (rank('A3') > rank(meta.required_assurance)) meta.required_assurance = 'A3';
}

function normalizeLoadedState(state) {
  if (!isEscalatedTier3(state.meta)) return false;
  if (
    state.meta.profile === TIER3_PROFILE &&
    state.meta.playbook === TIER3_PLAYBOOK &&
    rank(state.meta.required_assurance) >= rank('A3')
  ) {
    return false;
  }
  applyTier3EscalatedRoute(state.meta);
  return true;
}

function validateMeta(meta) {
  const bad = (msg) => fail('CORRUPT_STATE', `state file frontmatter: ${msg}`);
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) bad('not a mapping');
  if (meta.schema_version !== 1) bad(`unsupported schema_version ${JSON.stringify(meta.schema_version)} (expected 1)`);
  for (const key of META_FIELDS) if (!Object.hasOwn(meta, key)) bad(`missing "${key}"`);
  for (const key of Object.keys(meta)) {
    if (!META_FIELDS.includes(key) && !OPTIONAL_META.includes(key)) bad(`unknown key "${key}"`);
  }
  const int = (key, min, max = Number.MAX_SAFE_INTEGER) => {
    if (!Number.isInteger(meta[key]) || meta[key] < min || meta[key] > max) bad(`"${key}" must be an integer in ${min}..${max}`);
  };
  int('rev', 1);
  int('risk_tier', 0, 3);
  int('verify_attempts', 0);
  for (const key of ['repo', 'branch', 'updated_at']) {
    if (typeof meta[key] !== 'string' || meta[key] === '') bad(`"${key}" must be a non-empty string`);
  }
  if (!PROFILE_NAMES.includes(meta.profile)) bad(`unknown profile "${meta.profile}"`);
  if (!PLAYBOOKS.some((p) => p.name === meta.playbook)) bad(`unknown playbook "${meta.playbook}"`);
  for (const key of ['required_assurance', 'achieved_assurance']) {
    if (!ASSURANCE_LEVELS.includes(meta[key])) bad(`"${key}" must be one of ${ASSURANCE_LEVELS.join(', ')}`);
  }
  if (!PHASES.includes(meta.phase)) bad(`unknown phase "${meta.phase}"`);
  for (const key of ['base_sha', 'head_sha']) {
    if (typeof meta[key] !== 'string' || !FULL_SHA.test(meta[key])) bad(`"${key}" must be a full commit SHA`);
  }
  if (meta.phase === 'BLOCKED') {
    if (!Object.hasOwn(TRANSITIONS, meta.blocked_from) || meta.blocked_from === 'SHIPPED') {
      bad('"blocked_from" must name the phase BLOCKED was entered from');
    }
  } else if (meta.blocked_from !== undefined) {
    bad('"blocked_from" is only valid while the phase is BLOCKED');
  }
  if (meta.escalated_from_tier !== undefined) int('escalated_from_tier', 0, 3);
}

export function parseState(text) {
  const parts = splitFrontmatter(text);
  if (!parts) fail('CORRUPT_STATE', 'state file has no frontmatter');
  let meta;
  try {
    meta = parseYaml(parts.frontmatter);
  } catch (err) {
    fail('CORRUPT_STATE', `state file frontmatter: ${err.message}`);
  }
  validateMeta(meta);
  const lines = parts.body.split('\n');
  const at = BODY_HEADINGS.map((h) => lines.indexOf(h));
  if (at.some((v, i) => v === -1 || (i > 0 && v <= at[i - 1]))) {
    fail('CORRUPT_STATE', 'state file body sections are missing or out of order');
  }
  const chunk = (i) =>
    lines
      .slice(at[i] + 1, i + 1 < at.length ? at[i + 1] : lines.length)
      .map((l) => l.trim())
      .filter((l) => l !== '' && l !== NONE);
  const items = (i) => chunk(i).filter((l) => l.startsWith('- ')).map((l) => l.slice(2));
  return { meta, goal: chunk(0).join(' '), receipts: items(1), next: chunk(2).join(' '), blockers: items(3) };
}

export function renderState(state) {
  const { meta } = state;
  const out = ['---'];
  for (const key of [...META_FIELDS, ...OPTIONAL_META]) {
    if (meta[key] === undefined) continue;
    out.push(`${key}: ${typeof meta[key] === 'string' ? JSON.stringify(meta[key]) : meta[key]}`);
  }
  const list = (entries) => (entries.length > 0 ? entries.map((e) => `- ${e}`) : [NONE]);
  out.push(
    '---',
    '',
    `# Active Task State: ${meta.repo} / ${meta.branch}`,
    '',
    '<!-- Written only by scripts/rc-state.mjs. Never edit by hand; git beats state. -->',
    '',
    BODY_HEADINGS[0],
    '',
    state.goal || NONE,
    '',
    BODY_HEADINGS[1],
    '',
    ...list(state.receipts),
    '',
    BODY_HEADINGS[2],
    '',
    state.next || NONE,
    '',
    BODY_HEADINGS[3],
    '',
    ...list(state.blockers),
    '',
  );
  return out.join('\n');
}

function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function writeAtomic(file, text) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  try {
    const fd = fs.openSync(tmp, 'wx', 0o600);
    try {
      fs.writeSync(fd, text);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

// ------------------------------------------------------------------------------------------
// lock
//
// The lock is one file, created atomically with its owner record already inside (hard link from a
// private temp file, so it is never visible half-written). The lock file is only ever deleted
// while holding a second, short-lived guard file, and only after re-reading the owner token under
// that guard. A release and a stale reclaim therefore cannot remove a lock that changed hands.
// ------------------------------------------------------------------------------------------

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function lockPaths(runtimeDir) {
  return { lock: path.join(runtimeDir, '.rc-state.lock'), guard: path.join(runtimeDir, '.rc-state.lock.guard') };
}

function readOwner(lockFile) {
  try {
    return JSON.parse(fs.readFileSync(lockFile, 'utf8'));
  } catch {
    return null;
  }
}

function ageMs(file) {
  try {
    return Date.now() - fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/** Create the lock with its owner record in place. Returns false when the lock is already held. */
function tryCreateLock(lockFile, record) {
  const body = JSON.stringify(record);
  const tmp = `${lockFile}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, body, { flag: 'wx', mode: 0o600 });
  try {
    fs.linkSync(tmp, lockFile);
    return true;
  } catch (err) {
    if (err.code === 'EEXIST') return false;
    // No hard links on this filesystem: fall back to an exclusive create.
    try {
      fs.writeFileSync(lockFile, body, { flag: 'wx', mode: 0o600 });
      return true;
    } catch (inner) {
      if (inner.code === 'EEXIST') return false;
      throw inner;
    }
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/** Run `fn` while holding the guard. Returns false, without running it, when the guard is busy. */
function withGuard(paths, staleMs, fn) {
  let fd;
  try {
    fd = fs.openSync(paths.guard, 'wx', 0o600);
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    // A guard is held for microseconds; an old one belongs to a writer that died holding it.
    const age = ageMs(paths.guard);
    if (age !== null && age > Math.max(staleMs, 5000)) fs.rmSync(paths.guard, { force: true });
    return false;
  }
  try {
    fn();
  } finally {
    fs.closeSync(fd);
    fs.rmSync(paths.guard, { force: true });
  }
  return true;
}

function isStale(lockFile, owner, staleMs) {
  const age = ageMs(lockFile);
  if (age === null) return false;
  const ownerDead = owner !== null && owner.host === os.hostname() && Number.isInteger(owner.pid) && !pidAlive(owner.pid);
  return ownerDead || age > staleMs;
}

/** Remove a lock whose owner died or that outlived `staleMs`, re-checking it under the guard. */
function reclaimIfStale(paths, staleMs) {
  const seen = readOwner(paths.lock);
  if (!isStale(paths.lock, seen, staleMs)) return;
  withGuard(paths, staleMs, () => {
    const current = readOwner(paths.lock);
    if ((current?.token ?? null) !== (seen?.token ?? null)) return;
    if (!isStale(paths.lock, current, staleMs)) return;
    fs.rmSync(paths.lock, { force: true });
  });
}

function acquireLock(paths, { timeoutMs, staleMs }) {
  const token = crypto.randomBytes(12).toString('hex');
  const record = { token, pid: process.pid, host: os.hostname(), acquired_at: new Date().toISOString() };
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (tryCreateLock(paths.lock, record)) return token;
    reclaimIfStale(paths, staleMs);
    if (Date.now() >= deadline) {
      fail('LOCK_TIMEOUT', `could not acquire the state lock within ${timeoutMs} ms (${paths.lock} is held by another writer)`);
    }
    sleep(20 + Math.floor(Math.random() * 40));
  }
}

function assertHeld(paths, token) {
  if (readOwner(paths.lock)?.token !== token) fail('LOCK_LOST', 'the state lock was taken over by another writer; nothing was written');
}

function releaseLock(paths, token, staleMs) {
  const deadline = Date.now() + 2000;
  for (;;) {
    const released = withGuard(paths, staleMs, () => {
      if (readOwner(paths.lock)?.token === token) fs.rmSync(paths.lock, { force: true });
    });
    // If the guard never frees up, the lock is left behind; its dead owner makes it reclaimable.
    if (released || Date.now() >= deadline) return;
    sleep(5 + Math.floor(Math.random() * 10));
  }
}

// ------------------------------------------------------------------------------------------
// shadow history is authoritative
// ------------------------------------------------------------------------------------------

function context(flags) {
  const runtimeDir = path.resolve(flags['--runtime-dir'] ?? path.join(os.homedir(), '.rcstack', 'runtime'));
  const id = repoIdentity(flags['--repo'] ?? process.cwd(), { branch: flags['--branch'], name: flags['--repo-name'] });
  if (isInside(realpathOrSelf(runtimeDir), realpathOrSelf(id.top))) {
    fail('RUNTIME_IN_REPO', 'the runtime directory is inside the target repository; task state never enters a target repo');
  }
  const rel = stateRelPath(id.name, id.branch);
  return {
    runtimeDir,
    id,
    rel,
    file: path.join(runtimeDir, rel),
    locks: lockPaths(runtimeDir),
    lock: { timeoutMs: flags['--lock-timeout-ms'] ?? 10000, staleMs: flags['--stale-lock-ms'] ?? 30000 },
  };
}

/**
 * The state as the shadow history records it, which is the only state there is. Returns null when
 * nothing is committed for this repository and branch. A shadow repository that cannot be read is
 * an error, never a reason to fall back to the working file.
 */
function committedText(ctx) {
  const gitDir = lstatOrNull(path.join(ctx.runtimeDir, '.git'));
  if (gitDir === null) return null;
  if (!gitDir.isDirectory()) fail('RUNTIME_NOT_A_REPO', `${path.join(ctx.runtimeDir, '.git')} exists but is not a directory`);
  const top = shadowGit(ctx.runtimeDir, ['rev-parse', '--show-toplevel']);
  if (!top.ok || realpathOrSelf(top.stdout.trim()) !== realpathOrSelf(ctx.runtimeDir)) {
    fail('GIT_FAILED', `the shadow repository in ${ctx.runtimeDir} cannot be read: ${top.stderr || 'it is not the root of its own repository'}`);
  }
  if (!shadowGit(ctx.runtimeDir, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']).ok) return null;
  const listed = shadowGit(ctx.runtimeDir, ['ls-tree', '--name-only', 'HEAD', '--', ctx.rel]);
  if (!listed.ok) fail('GIT_FAILED', `cannot read the shadow history: ${listed.stderr}`);
  if (listed.stdout.trim() === '') return null;
  const blob = shadowGit(ctx.runtimeDir, ['show', `HEAD:${ctx.rel}`]);
  if (!blob.ok) fail('GIT_FAILED', `cannot read ${ctx.rel} from the shadow history: ${blob.stderr}`);
  return blob.stdout;
}

/**
 * Under the lock: make the working file equal the last commit, byte for byte. Anything else on
 * disk was left by a writer that died before committing, or was written by hand; it is not state.
 * The comparison reads the bytes directly, so no ignore rule or git status quirk can hide a file.
 */
function syncWithHistory(ctx) {
  const committed = committedText(ctx);
  let disk = null;
  try {
    disk = fs.readFileSync(ctx.file, 'utf8');
  } catch {
    // no working file
  }
  if (disk === committed) return;
  shadowGit(ctx.runtimeDir, ['reset', '-q', '--', ctx.rel]);
  if (committed === null) {
    // Never committed: set it aside instead of adopting it or destroying what a human may want.
    fs.renameSync(ctx.file, `${ctx.file}.orphan`);
    shadowGit(ctx.runtimeDir, ['rm', '-q', '--cached', '--ignore-unmatch', '--', ctx.rel]);
    note(`set aside ${ctx.rel}.orphan: a state file that was never committed is not state`);
  } else {
    fs.mkdirSync(path.dirname(ctx.file), { recursive: true });
    writeAtomic(ctx.file, committed);
    note('discarded an uncommitted state write; the last shadow commit is authoritative');
  }
}

/** Re-read the repository under the lock: no decision uses facts gathered while waiting for it. */
function refreshIdentity(ctx, flags) {
  const fresh = repoIdentity(flags['--repo'] ?? process.cwd(), { branch: flags['--branch'], name: flags['--repo-name'] });
  if (fresh.name !== ctx.id.name || fresh.branch !== ctx.id.branch) {
    fail('REPO_CHANGED', `the repository moved from ${ctx.id.branch} to ${fresh.branch} while this command waited for the lock; run it again`);
  }
  ctx.id = fresh;
}

function withLock(ctx, flags, fn) {
  ensureRuntime(ctx.runtimeDir);
  const token = acquireLock(ctx.locks, ctx.lock);
  try {
    syncWithHistory(ctx);
    refreshIdentity(ctx, flags);
    return fn(() => assertHeld(ctx.locks, token));
  } finally {
    releaseLock(ctx.locks, token, ctx.lock.staleMs);
  }
}

function loadState(ctx) {
  const committed = committedText(ctx);
  if (committed === null) return null;
  const state = parseState(committed);
  if (state.meta.repo !== ctx.id.name || state.meta.branch !== ctx.id.branch) {
    fail('SLUG_COLLISION', `${ctx.rel} belongs to ${state.meta.repo}/${state.meta.branch}, not ${ctx.id.name}/${ctx.id.branch}`);
  }
  const normalized = normalizeLoadedState(state);
  return { state, text: normalized ? renderState(state) : committed, committedText: committed };
}

function requireState(ctx) {
  const loaded = loadState(ctx);
  if (!loaded) fail('NO_STATE', `no active task state for ${ctx.id.name}/${ctx.id.branch}`);
  return loaded;
}

function subject(meta, from, to) {
  return `state(${meta.repo}/${meta.branch}): ${from} -> ${to} (rev ${meta.rev}, ${meta.achieved_assurance})`;
}

function commitPath(ctx, message, body) {
  const add = shadowGit(ctx.runtimeDir, ['add', '-f', '--', ctx.rel]);
  if (!add.ok) throw new Error(`git add failed: ${add.stderr}`);
  const args = ['commit', '-q', '--no-verify', '-m', message];
  if (body) args.push('-m', body);
  const commit = shadowGit(ctx.runtimeDir, [...args, '--', ctx.rel]);
  if (!commit.ok) throw new Error(`git commit failed: ${commit.stderr || commit.stdout.trim()}`);
  return shadowGit(ctx.runtimeDir, ['rev-parse', 'HEAD']).stdout.trim();
}

function summary(command, state, shadowCommit) {
  const m = state.meta;
  return {
    status: 'OK',
    command,
    repo: m.repo,
    branch: m.branch,
    rev: m.rev,
    phase: m.phase,
    risk_tier: m.risk_tier,
    required_assurance: m.required_assurance,
    achieved_assurance: m.achieved_assurance,
    head_sha: m.head_sha,
    verify_attempts: m.verify_attempts,
    shadow_commit: shadowCommit,
  };
}

// ------------------------------------------------------------------------------------------
// commands
// ------------------------------------------------------------------------------------------

function cmdInit(flags) {
  for (const required of ['--profile', '--playbook', '--tier', '--goal']) {
    if (flags[required] === undefined) fail('USAGE', `init needs ${required}`);
  }
  if (!PROFILE_NAMES.includes(flags['--profile'])) fail('USAGE', `--profile must be one of ${PROFILE_NAMES.join(', ')}`);
  const playbook = PLAYBOOKS.find((p) => p.name === flags['--playbook']);
  if (!playbook) fail('USAGE', `--playbook "${flags['--playbook']}" is not one of the 12 playbooks`);
  if (`rcstack-${playbook.domain}` !== flags['--profile']) {
    fail('USAGE', `playbook ${playbook.name} belongs to rcstack-${playbook.domain}, not ${flags['--profile']}`);
  }
  const tier = flags['--tier'];
  if (tier < playbook.tier) {
    fail('USAGE', `playbook ${playbook.name} runs at Tier ${playbook.tier} or above; it cannot start at Tier ${tier}`);
  }
  // The playbook's own floor, raised to the tier floor when the run starts above its default tier.
  const floor = tier > playbook.tier && rank(`A${tier}`) > rank(playbook.assurance) ? `A${tier}` : playbook.assurance;
  const required = flags['--required-assurance'] ?? floor;
  if (rank(required) < rank(floor)) {
    fail('USAGE', `--required-assurance ${required} is below the floor ${floor} for ${playbook.name} at Tier ${tier}; a floor can be raised, never lowered`);
  }
  const goal = oneLine(flags['--goal'], '--goal');
  const ctx = context(flags);
  if (flags['--base-sha'] !== undefined) resolveCommit(ctx.id.top, flags['--base-sha'], '--base-sha');

  return withLock(ctx, flags, (held) => {
    const base = flags['--base-sha'] ? resolveCommit(ctx.id.top, flags['--base-sha'], '--base-sha') : ctx.id.head;
    if (!runGit(ctx.id.top, ['merge-base', '--is-ancestor', base, ctx.id.head]).ok) {
      fail('USAGE', '--base-sha is not an ancestor of HEAD');
    }
    const existing = loadState(ctx);
    if (existing) {
      fail('STATE_EXISTS', `state already exists for ${ctx.id.name}/${ctx.id.branch} (rev ${existing.state.meta.rev}, ${existing.state.meta.phase})`);
    }
    const state = {
      meta: {
        schema_version: 1,
        rev: 1,
        repo: ctx.id.name,
        branch: ctx.id.branch,
        profile: flags['--profile'],
        playbook: playbook.name,
        risk_tier: tier,
        required_assurance: required,
        achieved_assurance: 'A0',
        phase: 'TRIAGE',
        base_sha: base,
        head_sha: ctx.id.head,
        verify_attempts: 0,
        updated_at: nowIso(),
      },
      goal,
      receipts: [],
      next: '',
      blockers: [],
    };
    fs.mkdirSync(path.dirname(ctx.file), { recursive: true });
    held();
    writeAtomic(ctx.file, renderState(state));
    let sha;
    try {
      sha = commitPath(ctx, subject(state.meta, 'NONE', 'TRIAGE'));
    } catch (err) {
      try {
        held();
        fs.rmSync(ctx.file, { force: true });
        shadowGit(ctx.runtimeDir, ['rm', '-q', '--cached', '--ignore-unmatch', '--', ctx.rel]);
      } catch {
        // the lock is no longer ours: leave the file for the next writer to set aside
      }
      fail('COMMIT_FAILED', `${err.message}; the state was not created`);
    }
    console.log(JSON.stringify(summary('init', state, sha), null, 2));
    return 0;
  });
}

function cmdTransition(flags) {
  if (flags['--expected-rev'] === undefined) fail('USAGE', 'transition needs --expected-rev <N>');
  const to = flags['--to'];
  if (to !== undefined && !PHASES.includes(to)) fail('USAGE', `--to must be one of ${PHASES.join(', ')}`);
  const updates = ['--admit-receipt', '--next', '--blocker', '--resolve-blockers', '--escalate-tier'];
  if (to === undefined && !updates.some((f) => flags[f] !== undefined)) {
    fail('USAGE', `transition needs --to <PHASE> or an update (${updates.join(', ')})`);
  }
  if (flags['--allowed-paths'] !== undefined && flags['--admit-receipt'] === undefined) {
    fail('USAGE', '--allowed-paths only applies together with --admit-receipt');
  }
  const next = flags['--next'] === undefined ? undefined : oneLine(flags['--next'], '--next');
  const blocker = flags['--blocker'] === undefined ? undefined : oneLine(flags['--blocker'], '--blocker');
  const ctx = context(flags);

  // Only the receipt's bytes are read here. The gate itself runs under the lock, so it judges the
  // repository as it is when the transition is decided, not as it was while waiting.
  let receiptText = null;
  let allowedPaths = null;
  if (flags['--admit-receipt'] !== undefined) {
    try {
      receiptText = fs.readFileSync(flags['--admit-receipt'] === '-' ? 0 : flags['--admit-receipt'], 'utf8');
    } catch (err) {
      fail('USAGE', `cannot read receipt: ${err.message}`);
    }
    if (flags['--allowed-paths'] !== undefined) {
      try {
        allowedPaths = parseAllowedPaths(flags['--allowed-paths']);
      } catch (err) {
        fail('USAGE', err.message);
      }
    }
  }

  return withLock(ctx, flags, (held) => {
    let admission = null;
    if (receiptText !== null) {
      admission = evaluateReceipt({ receiptText, repo: ctx.id.top, allowedPaths });
      if (admission.status !== 'ADMITTED') {
        console.log(JSON.stringify(admission, null, 2));
        fail('RECEIPT_REJECTED', `the Work Receipt did not pass the admission gate:\n  - ${admission.reasons.join('\n  - ')}`);
      }
    }
    const { state, committedText: previousText } = requireState(ctx);
    const meta = state.meta;
    if (meta.rev !== flags['--expected-rev']) {
      fail('REV_CONFLICT', `expected rev ${flags['--expected-rev']} but the state is at rev ${meta.rev}; re-read it before deciding again`);
    }
    if (ctx.id.liveBranch !== meta.branch) {
      fail('BRANCH_MISMATCH', `the repository is on ${ctx.id.liveBranch ?? 'a detached HEAD'}, but this state tracks ${meta.branch}`);
    }
    const from = meta.phase;
    const target = to ?? from;

    if (to !== undefined) {
      if (to === from) fail('ILLEGAL_TRANSITION', `the state is already in ${from}; omit --to for an in-place update`);
      if (from === 'BLOCKED') {
        if (to !== meta.blocked_from) fail('ILLEGAL_TRANSITION', `BLOCKED returns only to ${meta.blocked_from}, the phase it left`);
        delete meta.blocked_from;
        state.blockers = state.blockers.filter((b) => !b.startsWith(BLOCKED_TAG));
      } else if (to === 'BLOCKED') {
        if (from === 'SHIPPED') fail('ILLEGAL_TRANSITION', 'a SHIPPED task cannot be blocked; close it');
        if (blocker === undefined) fail('USAGE', 'entering BLOCKED needs --blocker "<reason>"');
        meta.blocked_from = from;
      } else if (!TRANSITIONS[from].includes(to)) {
        fail('ILLEGAL_TRANSITION', `${from} -> ${to} is not allowed (from ${from}: ${[...TRANSITIONS[from], 'BLOCKED'].join(', ')})`);
      }
    }

    if (flags['--escalate-tier'] !== undefined) {
      const tier = flags['--escalate-tier'];
      if (tier <= meta.risk_tier) fail('USAGE', `--escalate-tier must be above the current tier ${meta.risk_tier}; escalation is one-way`);
      meta.escalated_from_tier ??= meta.risk_tier;
      meta.risk_tier = tier;
      if (rank(`A${tier}`) > rank(meta.required_assurance)) meta.required_assurance = `A${tier}`;
      if (tier === 3) applyTier3EscalatedRoute(meta);
    }
    if (flags['--resolve-blockers']) state.blockers = state.blockers.filter((b) => b.startsWith(BLOCKED_TAG));
    if (blocker !== undefined) state.blockers.push(to === 'BLOCKED' ? `${BLOCKED_TAG}${blocker}` : blocker);
    if (next !== undefined) state.next = next;

    // Achieved assurance describes exactly one thing: the task's whole range, base_sha..HEAD.
    // Only an integrated receipt (that base, the current HEAD) can set it. A slice receipt is
    // recorded but proves nothing about the whole, and evidence admitted for an older HEAD stops
    // counting the moment HEAD moves.
    const short = (sha) => sha.slice(0, 12);
    let integrated = false;
    if (admission) {
      integrated = admission.base_sha === meta.base_sha && admission.head_sha === ctx.id.head;
      state.receipts.push(
        `${admission.assurance} | ${integrated ? 'integrated' : 'slice'} | ${oneLine(admission.slice, 'slice', 300)} | ` +
          `${short(admission.base_sha)}..${short(admission.head_sha)} | ${admission.files_touched.length} file(s) | ` +
          `verify: ${oneLine(admission.verify_cmd, 'verify_cmd', 300)} (exit 0)`,
      );
      if (integrated) meta.achieved_assurance = admission.assurance;
    }
    if (ctx.id.head !== meta.head_sha && !integrated && meta.achieved_assurance !== 'A0') {
      state.receipts.push(
        `Evidence reset: HEAD moved ${short(meta.head_sha)}..${short(ctx.id.head)} past the last integrated receipt; ` +
          `achieved ${meta.achieved_assurance} -> A0`,
      );
      meta.achieved_assurance = 'A0';
    }

    let gapNote = '';
    if (to === 'AWAITING_REVIEW' || to === 'SHIPPED') {
      if (ctx.id.dirty > 0) {
        fail('DIRTY_TREE', `${ctx.id.dirty} uncommitted or untracked path(s) in the repository; nothing unverified goes to ${to}`);
      }
      const open = state.blockers.filter((b) => !b.startsWith(BLOCKED_TAG));
      if (open.length > 0) {
        fail('OPEN_BLOCKERS', `${open.length} open blocker(s) remain; resolve them (--resolve-blockers) before ${to}`);
      }
      if (rank(meta.achieved_assurance) < rank(meta.required_assurance)) {
        if (!flags['--ack-assurance-gap']) {
          fail(
            'ASSURANCE_GAP',
            `achieved ${meta.achieved_assurance} is below the required ${meta.required_assurance}. ` +
              `Admit an integrated receipt for ${short(meta.base_sha)}..${short(ctx.id.head)}, ` +
              `or surface the gap to the human and pass --ack-assurance-gap`,
          );
        }
        gapNote = `ASSURANCE GAP acknowledged entering ${to}: achieved ${meta.achieved_assurance} < required ${meta.required_assurance}`;
        state.receipts.push(gapNote);
      }
    }

    if (to === 'VERIFYING') meta.verify_attempts += 1;
    meta.phase = target;
    meta.head_sha = ctx.id.head;
    meta.rev += 1;
    meta.updated_at = nowIso();

    held();
    writeAtomic(ctx.file, renderState(state));
    let sha;
    try {
      sha = commitPath(ctx, subject(meta, from, target), gapNote);
    } catch (err) {
      // Undo only while the lock is still ours. If it is not, the next writer discards the
      // uncommitted file anyway, so the shadow history stays the single source of truth.
      let restored = false;
      try {
        held();
        writeAtomic(ctx.file, previousText);
        shadowGit(ctx.runtimeDir, ['reset', '-q', '--', ctx.rel]);
        restored = true;
      } catch {
        // leave the file for the next writer to discard
      }
      fail('COMMIT_FAILED', `${err.message}; ${restored ? 'the previous state was restored' : 'the uncommitted write will be discarded by the next writer'}`);
    }
    const out = summary('transition', state, sha);
    if (admission) {
      out.admitted = { slice: admission.slice, assurance: admission.assurance, scope: integrated ? 'integrated' : 'slice', files: admission.files_touched.length };
    }
    if (gapNote) out.assurance_gap = true;
    console.log(JSON.stringify(out, null, 2));
    return 0;
  });
}

function cmdShow(flags) {
  const ctx = context(flags);
  const { state, text } = requireState(ctx);
  if (flags['--json']) {
    console.log(JSON.stringify({ ...state.meta, goal: state.goal, receipts: state.receipts, next: state.next, blockers: state.blockers }, null, 2));
  } else {
    process.stdout.write(text);
  }
  return 0;
}

function cmdReconcile(flags) {
  const ctx = context(flags);
  const git = { branch: ctx.id.liveBranch, head_sha: ctx.id.head, dirty_paths: ctx.id.dirty };
  const loaded = loadState(ctx);
  if (!loaded) {
    console.log(JSON.stringify({ in_sync: true, state: null, git, drift: [], note: 'no active task state for this repository and branch' }, null, 2));
    return 0;
  }
  const meta = loaded.state.meta;
  const drift = [];
  const isAncestor = (a, b) => runGit(ctx.id.top, ['merge-base', '--is-ancestor', a, b]).ok;
  if (meta.head_sha !== ctx.id.head) {
    let detail = 'the recorded head is not an ancestor of HEAD: history was rewritten or the branch was reset';
    if (isAncestor(meta.head_sha, ctx.id.head)) {
      const count = runGit(ctx.id.top, ['rev-list', '--count', `${meta.head_sha}..${ctx.id.head}`]).stdout.trim();
      detail = `${count} commit(s) landed after the last recorded transition; the next transition resets achieved assurance to A0`;
    }
    drift.push({ code: 'HEAD_MOVED', state: meta.head_sha, git: ctx.id.head, detail });
  }
  if (!isAncestor(meta.base_sha, ctx.id.head)) {
    drift.push({
      code: 'BASE_NOT_ANCESTOR',
      state: meta.base_sha,
      git: ctx.id.head,
      detail: 'the recorded base commit is no longer in this branch; close --abandon and init again to track the rewritten history',
    });
  }
  if (ctx.id.liveBranch !== meta.branch) {
    drift.push({ code: 'BRANCH_MISMATCH', state: meta.branch, git: ctx.id.liveBranch, detail: 'the repository is not on the branch this state tracks' });
  }
  if (ctx.id.dirty > 0) {
    drift.push({ code: 'DIRTY_TREE', state: null, git: ctx.id.dirty, detail: `${ctx.id.dirty} uncommitted or untracked path(s) the state knows nothing about` });
  }
  console.log(
    JSON.stringify(
      {
        in_sync: drift.length === 0,
        state: { rev: meta.rev, phase: meta.phase, branch: meta.branch, base_sha: meta.base_sha, head_sha: meta.head_sha, achieved_assurance: meta.achieved_assurance },
        git,
        drift,
        note: drift.length === 0 ? 'state matches git' : 'git beats state: trust git, re-verify, and record the next transition from what git shows',
      },
      null,
      2,
    ),
  );
  return drift.length === 0 ? 0 : 2;
}

function cmdClose(flags) {
  if (flags['--expected-rev'] === undefined) fail('USAGE', 'close needs --expected-rev <N>');
  const ctx = context(flags);
  return withLock(ctx, flags, (held) => {
    const { state } = requireState(ctx);
    const meta = state.meta;
    if (meta.rev !== flags['--expected-rev']) {
      fail('REV_CONFLICT', `expected rev ${flags['--expected-rev']} but the state is at rev ${meta.rev}; re-read it before deciding again`);
    }
    if (meta.phase !== 'SHIPPED' && !flags['--abandon']) {
      fail('NOT_SHIPPED', `the task is in ${meta.phase}; only a SHIPPED task can be closed (pass --abandon to discard an unfinished one)`);
    }
    const from = meta.phase;
    const end = meta.phase === 'SHIPPED' ? 'CLOSED' : 'ABANDONED';
    meta.rev += 1;
    held();
    const rm = shadowGit(ctx.runtimeDir, ['rm', '-q', '--', ctx.rel]);
    if (!rm.ok) fail('COMMIT_FAILED', `git rm failed: ${rm.stderr}`);
    const commit = shadowGit(ctx.runtimeDir, ['commit', '-q', '--no-verify', '-m', subject(meta, from, end), '--', ctx.rel]);
    if (!commit.ok) {
      // The staged deletion is uncommitted, so the next writer restores the file from history.
      fail('COMMIT_FAILED', `git commit failed: ${commit.stderr}; the state was not closed`);
    }
    try {
      fs.rmdirSync(path.dirname(ctx.file));
    } catch {
      // other branches of this repository still have state
    }
    const sha = shadowGit(ctx.runtimeDir, ['rev-parse', 'HEAD']).stdout.trim();
    console.log(JSON.stringify({ status: 'OK', command: 'close', repo: meta.repo, branch: meta.branch, rev: meta.rev, phase: end, shadow_commit: sha }, null, 2));
    return 0;
  });
}

// ------------------------------------------------------------------------------------------
// CLI
// ------------------------------------------------------------------------------------------

const COMMON = ['--repo', '--runtime-dir', '--branch', '--repo-name', '--lock-timeout-ms', '--stale-lock-ms'];
const COMMANDS = Object.freeze({
  init: { run: cmdInit, flags: [...COMMON, '--profile', '--playbook', '--tier', '--required-assurance', '--goal', '--base-sha'] },
  transition: {
    run: cmdTransition,
    flags: [...COMMON, '--to', '--expected-rev', '--admit-receipt', '--allowed-paths', '--next', '--blocker', '--resolve-blockers', '--escalate-tier', '--ack-assurance-gap'],
  },
  show: { run: cmdShow, flags: [...COMMON, '--json'] },
  reconcile: { run: cmdReconcile, flags: COMMON },
  close: { run: cmdClose, flags: [...COMMON, '--expected-rev', '--abandon'] },
});
const BOOLEAN_FLAGS = new Set(['--json', '--resolve-blockers', '--ack-assurance-gap', '--abandon']);
const INTEGER_FLAGS = { '--tier': [0, 3], '--escalate-tier': [1, 3], '--expected-rev': [1, Number.MAX_SAFE_INTEGER], '--lock-timeout-ms': [0, 600000], '--stale-lock-ms': [0, 86400000] };

const USAGE = `Usage: node scripts/rc-state.mjs <init|transition|show|reconcile|close> [flags]

  init        --profile <p> --playbook <name> --tier <0-3> --goal "<text>" [--required-assurance <A0-A3>] [--base-sha <sha>]
  transition  --expected-rev <N> [--to <PHASE>] [--admit-receipt <file|->] [--allowed-paths <glob,glob>]
              [--next "<text>"] [--blocker "<text>"] [--resolve-blockers] [--escalate-tier <n>] [--ack-assurance-gap]
  show        [--json]
  reconcile   compare the state with live git; exit 2 on drift (git beats state)
  close       --expected-rev <N> [--abandon]

Common: --repo <path> (default: cwd)  --runtime-dir <path> (default: ~/.rcstack/runtime)
        --branch <name>  --repo-name <name>  --lock-timeout-ms <n>  --stale-lock-ms <n>
Phases: ${PHASES.join(', ')}
Exit status: 0 success, 1 error, 2 reconcile found drift.`;

function parseFlags(command, argv) {
  const allowed = COMMANDS[command].flags;
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const eq = arg.startsWith('--') ? arg.indexOf('=') : -1;
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    if (!allowed.includes(flag)) fail('USAGE', `unknown flag "${flag}" for ${command}`);
    if (Object.hasOwn(flags, flag)) fail('USAGE', `${flag} was given more than once`);
    if (BOOLEAN_FLAGS.has(flag)) {
      if (eq !== -1) fail('USAGE', `${flag} takes no value`);
      flags[flag] = true;
      continue;
    }
    let value;
    if (eq !== -1) value = arg.slice(eq + 1);
    else {
      i += 1;
      if (i >= argv.length) fail('USAGE', `${flag} needs a value`);
      value = argv[i];
    }
    if (Object.hasOwn(INTEGER_FLAGS, flag)) {
      const [min, max] = INTEGER_FLAGS[flag];
      if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) {
        fail('USAGE', `${flag} must be an integer in ${min}..${max}`);
      }
      value = Number(value);
    }
    flags[flag] = value;
  }
  if (flags['--required-assurance'] !== undefined && !ASSURANCE_LEVELS.includes(flags['--required-assurance'])) {
    fail('USAGE', `--required-assurance must be one of ${ASSURANCE_LEVELS.join(', ')}`);
  }
  return flags;
}

export function main(argv) {
  const [command, ...rest] = argv;
  if (command === undefined || command === '--help' || command === '-h' || rest.includes('--help') || rest.includes('-h')) {
    console.log(USAGE);
    return command === undefined ? 1 : 0;
  }
  try {
    if (!Object.hasOwn(COMMANDS, command)) fail('USAGE', `unknown command "${command}"`);
    return COMMANDS[command].run(parseFlags(command, rest));
  } catch (err) {
    if (err instanceof StateError) {
      console.error(`rc-state: ${err.code}: ${err.message}`);
      if (err.code === 'USAGE') console.error(`\n${USAGE}`);
      return 1;
    }
    throw err;
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
