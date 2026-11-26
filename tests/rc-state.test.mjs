// Hermetic tests for scripts/rc-state.mjs. Runtime dirs and target repos live under os.tmpdir().
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseState, renderState, slugify, stateRelPath, StateError, PHASES, TRANSITIONS } from '../scripts/rc-state.mjs';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts/rc-state.mjs');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'rcstack-state-'));
const FAKE_HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(FAKE_HOME);

// Children never see the real HOME or the machine's git configuration.
const ENV = {
  ...process.env,
  HOME: FAKE_HOME,
  GIT_CONFIG_GLOBAL: os.devNull,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'rcstack-test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'rcstack-test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
  GIT_TERMINAL_PROMPT: '0',
};
for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete ENV[key];

after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

function git(cwd, ...args) {
  const res = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: ENV });
  assert.equal(res.status, 0, `git ${args.join(' ')}: ${res.stderr}`);
  return res.stdout.trim();
}

function commitFile(repo, rel, content, message) {
  const file = path.join(repo, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', message);
  return git(repo, 'rev-parse', 'HEAD');
}

let counter = 0;
/** A fresh target repo on `branch` plus its own empty runtime directory. */
function fixture(branch = 'main') {
  counter += 1;
  const repo = path.join(SANDBOX, `case-${counter}`, 'widgets');
  const runtime = path.join(SANDBOX, `case-${counter}`, 'runtime');
  fs.mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q', '-b', branch);
  const base = commitFile(repo, 'README.md', '# widgets\n', 'base');
  return { repo, runtime, base, branch };
}

function run(f, command, ...args) {
  const res = spawnSync(process.execPath, [SCRIPT, command, '--repo', f.repo, '--runtime-dir', f.runtime, ...args], {
    encoding: 'utf8',
    env: ENV,
  });
  let json = null;
  try {
    json = JSON.parse(res.stdout);
  } catch {
    // not every command prints JSON
  }
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, json };
}

function ok(f, command, ...args) {
  const res = run(f, command, ...args);
  assert.equal(res.status, 0, `${command} ${args.join(' ')}\n${res.stderr}${res.stdout}`);
  return res.json;
}

function init(f, ...extra) {
  return ok(f, 'init', '--profile', 'rcstack-engineering', '--playbook', 'feature-build', '--tier', '2', '--goal', 'Add the widget exporter', ...extra);
}

function move(f, to, rev, ...extra) {
  return ok(f, 'transition', '--to', to, '--expected-rev', String(rev), ...extra);
}

/** Walk TRIAGE -> EXECUTING and return the current rev (4). */
function toExecuting(f) {
  init(f);
  move(f, 'RESEARCHING', 1);
  move(f, 'PLANNING', 2);
  return move(f, 'EXECUTING', 3).rev;
}

function shadowLog(f) {
  return git(f.runtime, 'log', '--format=%s').split('\n');
}

function stateFile(f) {
  return path.join(f.runtime, 'state', 'widgets', `${slugify(f.branch)}.md`);
}

function writeReceipt(f, base, head, files, overrides = {}) {
  const data = {
    slice: 'S1 exporter',
    base_sha: base,
    head_sha: head,
    files_touched: files,
    verify_cmd: 'node --test',
    verify_exit_code: 0,
    checks_passed: ['mechanical', 'behavioral'],
    audit_blockers: null,
    audit_majors: null,
    assumptions: [],
    review_hotspot: [`${files[0]}:1`],
    ...overrides,
  };
  const file = path.join(path.dirname(f.repo), `receipt-${Math.random().toString(16).slice(2)}.json`);
  fs.writeFileSync(file, JSON.stringify(data));
  return file;
}

describe('init', () => {
  test('creates rev 1 in TRIAGE inside a local-only shadow git repository', () => {
    const f = fixture();
    const out = init(f);
    assert.deepEqual(
      { status: out.status, rev: out.rev, phase: out.phase, risk_tier: out.risk_tier, required: out.required_assurance, achieved: out.achieved_assurance, head: out.head_sha, attempts: out.verify_attempts },
      { status: 'OK', rev: 1, phase: 'TRIAGE', risk_tier: 2, required: 'A2', achieved: 'A0', head: f.base, attempts: 0 },
    );
    assert.ok(fs.existsSync(path.join(f.runtime, '.git')), 'runtime is a git repository');
    assert.equal(git(f.runtime, 'remote'), '', 'no remote is configured');
    assert.deepEqual(shadowLog(f), ['state(widgets/main): NONE -> TRIAGE (rev 1, A0)']);
    assert.equal(git(f.runtime, 'status', '--porcelain'), '', 'the shadow repo is clean after the commit');

    const state = parseState(fs.readFileSync(stateFile(f), 'utf8'));
    assert.deepEqual(Object.keys(state.meta), ['schema_version', 'rev', 'repo', 'branch', 'profile', 'playbook', 'risk_tier', 'required_assurance', 'achieved_assurance', 'phase', 'base_sha', 'head_sha', 'verify_attempts', 'updated_at']);
    assert.equal(state.meta.schema_version, 1);
    assert.equal(state.meta.base_sha, f.base);
    assert.match(state.meta.updated_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.equal(state.goal, 'Add the widget exporter');
    const body = fs.readFileSync(stateFile(f), 'utf8');
    for (const heading of ['## Active Goal', '## Admitted Receipts', '## Next Step', '## Open Blockers']) assert.ok(body.includes(heading), heading);
  });

  test('never writes into the target repository or the real home', () => {
    const f = fixture();
    init(f);
    assert.equal(git(f.repo, 'status', '--porcelain'), '', 'target repo stays clean');
    assert.deepEqual(fs.readdirSync(FAKE_HOME), [], 'nothing was written under HOME');
  });

  test('defaults --runtime-dir to ~/.rcstack/runtime under HOME', () => {
    const f = fixture();
    const home = path.join(path.dirname(f.repo), 'home');
    fs.mkdirSync(home);
    const res = spawnSync(process.execPath, [SCRIPT, 'init', '--repo', f.repo, '--profile', 'rcstack-engineering', '--playbook', 'feature-build', '--tier', '2', '--goal', 'g'], { encoding: 'utf8', env: { ...ENV, HOME: home } });
    assert.equal(res.status, 0, res.stderr);
    assert.ok(fs.existsSync(path.join(home, '.rcstack', 'runtime', 'state', 'widgets', 'main.md')));
  });

  test('refuses a second init, bad arguments, and a playbook from another profile', () => {
    const f = fixture();
    init(f);
    assert.match(run(f, 'init', '--profile', 'rcstack-engineering', '--playbook', 'feature-build', '--tier', '2', '--goal', 'again').stderr, /STATE_EXISTS/);
    const g = fixture();
    assert.match(run(g, 'init', '--profile', 'rcstack-study', '--playbook', 'feature-build', '--tier', '2', '--goal', 'x').stderr, /belongs to rcstack-engineering/);
    assert.match(run(g, 'init', '--profile', 'rcstack-engineering', '--playbook', 'nope', '--tier', '2', '--goal', 'x').stderr, /not one of the 12 playbooks/);
    assert.match(run(g, 'init', '--profile', 'rcstack-engineering', '--playbook', 'feature-build', '--tier', '9', '--goal', 'x').stderr, /--tier must be an integer in 0\.\.3/);
    assert.match(run(g, 'init', '--profile', 'rcstack-engineering', '--playbook', 'feature-build', '--tier', '2').stderr, /init needs --goal/);
    assert.match(run(g, 'init', '--profile', 'rcstack-engineering', '--playbook', 'feature-build', '--tier', '2', '--goal', 'x', '--to', 'SHIPPED').stderr, /unknown flag "--to" for init/);
    assert.equal(fs.existsSync(g.runtime), false, 'a rejected init creates nothing');
  });

  test('cannot lower an assurance floor or run a playbook below its tier', () => {
    const f = fixture();
    const attempt = (...args) => run(f, 'init', '--goal', 'g', ...args);
    const lowered = attempt('--profile', 'rcstack-engineering', '--playbook', 'security-critical', '--tier', '3', '--required-assurance', 'A0');
    assert.equal(lowered.status, 1);
    assert.match(lowered.stderr, /--required-assurance A0 is below the floor A3 for security-critical at Tier 3; a floor can be raised, never lowered/);
    assert.match(attempt('--profile', 'rcstack-engineering', '--playbook', 'feature-build', '--tier', '2', '--required-assurance', 'A1').stderr, /below the floor A2/);
    assert.match(attempt('--profile', 'rcstack-engineering', '--playbook', 'feature-build', '--tier', '3', '--required-assurance', 'A2').stderr, /below the floor A3/);
    assert.match(attempt('--profile', 'rcstack-engineering', '--playbook', 'security-critical', '--tier', '0').stderr, /security-critical runs at Tier 3 or above; it cannot start at Tier 0/);
    assert.match(attempt('--profile', 'rcstack-engineering', '--playbook', 'feature-build', '--tier', '1').stderr, /runs at Tier 2 or above/);
    assert.equal(fs.existsSync(f.runtime), false, 'a rejected init creates nothing');
  });

  test('takes the floor from the playbook, raises it on a higher tier, and honours an explicit floor', () => {
    const socratic = fixture();
    assert.equal(ok(socratic, 'init', '--profile', 'rcstack-study', '--playbook', 'socratic-session', '--tier', '1', '--goal', 'g').required_assurance, 'A0');
    const escalated = fixture();
    assert.equal(ok(escalated, 'init', '--profile', 'rcstack-engineering', '--playbook', 'feature-build', '--tier', '3', '--goal', 'g').required_assurance, 'A3');
    const explicit = fixture();
    assert.equal(init(explicit, '--required-assurance', 'A3').required_assurance, 'A3');
  });

  test('slugs a branch with slashes into one safe file name and keeps the exact branch inside', () => {
    const f = fixture('feature/export-v2');
    init(f);
    const digest = (text) => crypto.createHash('sha256').update(text).digest('hex').slice(0, 8);
    assert.equal(stateRelPath('widgets', 'feature/export-v2'), `state/widgets/feature-export-v2-${digest('feature/export-v2')}.md`);
    const state = parseState(fs.readFileSync(stateFile(f), 'utf8'));
    assert.equal(state.meta.branch, 'feature/export-v2');
    assert.equal(slugify('feature-x'), 'feature-x', 'a safe name is kept as it is');
    assert.notEqual(slugify('feature/x'), slugify('feature-x'), 'names that differ never share a state file');
    assert.notEqual(slugify('feature/x'), slugify('feature x'));
    assert.match(slugify('../../etc/passwd'), /^etc-passwd-[0-9a-f]{8}$/, 'no path traversal');
    assert.match(slugify('..'), /^x-[0-9a-f]{8}$/);
    assert.deepEqual(shadowLog(f), ['state(widgets/feature/export-v2): NONE -> TRIAGE (rev 1, A0)']);
  });

  test('refuses a runtime directory inside the target repository', () => {
    const f = fixture();
    f.runtime = path.join(f.repo, '.rcstack-runtime');
    assert.match(run(f, 'init', '--profile', 'rcstack-engineering', '--playbook', 'feature-build', '--tier', '2', '--goal', 'x').stderr, /RUNTIME_IN_REPO/);
    assert.equal(fs.existsSync(f.runtime), false);
  });

  test('refuses a shadow repository that has a remote', () => {
    const f = fixture();
    fs.mkdirSync(f.runtime, { recursive: true });
    git(f.runtime, 'init', '-q');
    git(f.runtime, 'remote', 'add', 'origin', 'https://example.invalid/shadow.git');
    assert.match(run(f, 'init', '--profile', 'rcstack-engineering', '--playbook', 'feature-build', '--tier', '2', '--goal', 'x').stderr, /REMOTE_CONFIGURED/);
  });
});

describe('transition', () => {
  test('increments rev and creates one shadow commit per transition', () => {
    const f = fixture();
    init(f);
    const out = move(f, 'RESEARCHING', 1, '--next', 'Write the research brief');
    assert.equal(out.rev, 2);
    assert.equal(out.phase, 'RESEARCHING');
    assert.equal(out.shadow_commit, git(f.runtime, 'rev-parse', 'HEAD'));
    assert.deepEqual(shadowLog(f), ['state(widgets/main): TRIAGE -> RESEARCHING (rev 2, A0)', 'state(widgets/main): NONE -> TRIAGE (rev 1, A0)']);
    const shown = ok(f, 'show', '--json');
    assert.equal(shown.rev, 2);
    assert.equal(shown.next, 'Write the research brief');
    assert.match(run(f, 'show').stdout, /^---\nschema_version: 1\nrev: 2\n/);
  });

  test('rejects a stale --expected-rev and leaves the state untouched', () => {
    const f = fixture();
    init(f);
    move(f, 'RESEARCHING', 1);
    const before = fs.readFileSync(stateFile(f), 'utf8');
    const res = run(f, 'transition', '--to', 'PLANNING', '--expected-rev', '1');
    assert.equal(res.status, 1);
    assert.match(res.stderr, /REV_CONFLICT: expected rev 1 but the state is at rev 2/);
    assert.equal(fs.readFileSync(stateFile(f), 'utf8'), before);
    assert.equal(shadowLog(f).length, 2);
    assert.match(run(f, 'transition', '--to', 'PLANNING').stderr, /transition needs --expected-rev/);
  });

  test('enforces the state machine', () => {
    const f = fixture();
    init(f);
    assert.match(run(f, 'transition', '--to', 'EXECUTING', '--expected-rev', '1').stderr, /ILLEGAL_TRANSITION: TRIAGE -> EXECUTING is not allowed/);
    assert.match(run(f, 'transition', '--to', 'SHIPPED', '--expected-rev', '1').stderr, /ILLEGAL_TRANSITION/);
    assert.match(run(f, 'transition', '--to', 'TRIAGE', '--expected-rev', '1').stderr, /already in TRIAGE/);
    assert.match(run(f, 'transition', '--to', 'DONE', '--expected-rev', '1').stderr, /--to must be one of/);
    assert.match(run(f, 'transition', '--expected-rev', '1').stderr, /needs --to <PHASE> or an update/);
    assert.equal(ok(f, 'show', '--json').rev, 1);
    assert.deepEqual(TRANSITIONS.VERIFYING, ['EXECUTING', 'AUDITING']);
    assert.deepEqual(TRANSITIONS.AUDITING, ['EXECUTING', 'AWAITING_REVIEW']);
    assert.deepEqual(TRANSITIONS.SHIPPED, []);
    assert.equal(PHASES.length, 9);
  });

  test('counts verify attempts across the EXECUTING <-> VERIFYING loop', () => {
    const f = fixture();
    let rev = toExecuting(f);
    rev = move(f, 'VERIFYING', rev).rev;
    rev = move(f, 'EXECUTING', rev).rev;
    const out = move(f, 'VERIFYING', rev);
    assert.equal(out.verify_attempts, 2);
    assert.equal(move(f, 'AUDITING', out.rev).verify_attempts, 2);
  });

  test('BLOCKED needs a reason and returns only to the phase it left', () => {
    const f = fixture();
    const rev = toExecuting(f);
    assert.match(run(f, 'transition', '--to', 'BLOCKED', '--expected-rev', String(rev)).stderr, /entering BLOCKED needs --blocker/);
    const blocked = move(f, 'BLOCKED', rev, '--blocker', 'waiting for API credentials');
    assert.equal(blocked.phase, 'BLOCKED');
    let shown = ok(f, 'show', '--json');
    assert.equal(shown.blocked_from, 'EXECUTING');
    assert.deepEqual(shown.blockers, ['[BLOCKED] waiting for API credentials']);
    assert.match(run(f, 'transition', '--to', 'AUDITING', '--expected-rev', String(blocked.rev)).stderr, /BLOCKED returns only to EXECUTING/);
    assert.match(run(f, 'transition', '--to', 'SHIPPED', '--expected-rev', String(blocked.rev)).stderr, /BLOCKED returns only to EXECUTING/);
    const resumed = move(f, 'EXECUTING', blocked.rev);
    shown = ok(f, 'show', '--json');
    assert.equal(resumed.phase, 'EXECUTING');
    assert.equal(shown.blocked_from, undefined);
    assert.deepEqual(shown.blockers, []);
    assert.equal(shadowLog(f)[1], `state(widgets/main): EXECUTING -> BLOCKED (rev ${blocked.rev}, A0)`);
  });

  test('admits a Work Receipt through the gate and derives achieved assurance from it', () => {
    const f = fixture();
    let rev = toExecuting(f);
    const head = commitFile(f.repo, 'src/export.js', 'export const x = 1;\n', 'slice');
    const receipt = writeReceipt(f, f.base, head, ['src/export.js']);
    const out = move(f, 'VERIFYING', rev, '--admit-receipt', receipt, '--allowed-paths', 'src/**');
    assert.equal(out.achieved_assurance, 'A1', 'un-audited work tops out at A1');
    assert.equal(out.head_sha, head);
    assert.deepEqual(out.admitted, { slice: 'S1 exporter', assurance: 'A1', scope: 'integrated', files: 1 });
    assert.equal(shadowLog(f)[0], `state(widgets/main): EXECUTING -> VERIFYING (rev ${out.rev}, A1)`);
    rev = move(f, 'AUDITING', out.rev).rev;

    const audited = writeReceipt(f, f.base, head, ['src/export.js'], { slice: 'Integrated', audit_blockers: 0, audit_majors: 1 });
    const updated = ok(f, 'transition', '--expected-rev', String(rev), '--admit-receipt', audited);
    assert.equal(updated.phase, 'AUDITING', 'an update without --to keeps the phase');
    assert.equal(updated.achieved_assurance, 'A2');
    const shown = ok(f, 'show', '--json');
    assert.equal(shown.receipts.length, 2);
    assert.match(shown.receipts[0], /^A1 \| integrated \| S1 exporter \| [0-9a-f]{12}\.\.[0-9a-f]{12} \| 1 file\(s\) \| verify: node --test \(exit 0\)$/);
    assert.equal(move(f, 'AWAITING_REVIEW', updated.rev).phase, 'AWAITING_REVIEW');
  });

  const A3 = { checks_passed: ['mechanical', 'behavioral', 'hardened'], audit_blockers: 0, audit_majors: 0 };

  test('achieved assurance is reset when HEAD moves past the audited commit', () => {
    const f = fixture();
    let rev = toExecuting(f);
    const c1 = commitFile(f.repo, 'src/export.js', 'export const x = 1;\n', 'slice');
    rev = move(f, 'VERIFYING', rev, '--admit-receipt', writeReceipt(f, f.base, c1, ['src/export.js'], A3)).rev;
    rev = move(f, 'AUDITING', rev).rev;
    const reviewed = move(f, 'AWAITING_REVIEW', rev);
    assert.equal(reviewed.achieved_assurance, 'A3');
    rev = move(f, 'EXECUTING', reviewed.rev).rev;

    const c2 = commitFile(f.repo, 'src/export.js', 'export const x = "never verified";\n', 'unaudited change');
    const out = move(f, 'VERIFYING', rev);
    assert.equal(out.head_sha, c2);
    assert.equal(out.achieved_assurance, 'A0', 'evidence for the old HEAD no longer counts');
    assert.match(ok(f, 'show', '--json').receipts.at(-1), /^Evidence reset: HEAD moved [0-9a-f]{12}\.\.[0-9a-f]{12} past the last integrated receipt; achieved A3 -> A0$/);
    rev = move(f, 'AUDITING', out.rev).rev;
    const refused = run(f, 'transition', '--to', 'AWAITING_REVIEW', '--expected-rev', String(rev));
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /ASSURANCE_GAP: achieved A0 is below the required A2/);

    const fresh = writeReceipt(f, f.base, c2, ['src/export.js'], { audit_blockers: 0, audit_majors: 0 });
    assert.equal(move(f, 'AWAITING_REVIEW', rev, '--admit-receipt', fresh).achieved_assurance, 'A2', 'fresh integrated evidence restores it');
  });

  test('a receipt for an ancestor commit or a partial range never sets achieved assurance', () => {
    const f = fixture();
    let rev = toExecuting(f);
    const c1 = commitFile(f.repo, 'src/a.js', '1\n', 'audited work');
    const c2 = commitFile(f.repo, 'src/backdoor.js', '2\n', 'work nobody audited');

    const ancestor = move(f, 'VERIFYING', rev, '--admit-receipt', writeReceipt(f, f.base, c1, ['src/a.js'], A3));
    assert.equal(ancestor.admitted.scope, 'slice');
    assert.equal(ancestor.achieved_assurance, 'A0', 'an A3 receipt for base..C1 says nothing about C2');
    const partial = ok(f, 'transition', '--expected-rev', String(ancestor.rev), '--admit-receipt', writeReceipt(f, c1, c2, ['src/backdoor.js'], A3));
    assert.equal(partial.admitted.scope, 'slice');
    assert.equal(partial.achieved_assurance, 'A0', 'a slice receipt does not cover the task');

    rev = move(f, 'AUDITING', partial.rev).rev;
    assert.match(run(f, 'transition', '--to', 'AWAITING_REVIEW', '--expected-rev', String(rev)).stderr, /ASSURANCE_GAP: achieved A0 is below the required A2/);
    const whole = move(f, 'AWAITING_REVIEW', rev, '--admit-receipt', writeReceipt(f, f.base, c2, ['src/a.js', 'src/backdoor.js'], A3));
    assert.equal(whole.admitted.scope, 'integrated');
    assert.equal(whole.achieved_assurance, 'A3');
    assert.deepEqual(ok(f, 'show', '--json').receipts.map((r) => r.split(' | ')[1]), ['slice', 'slice', 'integrated']);
  });

  test('nothing uncommitted goes to review or ships', () => {
    const f = fixture();
    let rev = toExecuting(f);
    const head = commitFile(f.repo, 'src/export.js', 'export const x = 1;\n', 'slice');
    rev = move(f, 'VERIFYING', rev, '--admit-receipt', writeReceipt(f, f.base, head, ['src/export.js'], A3)).rev;
    rev = move(f, 'AUDITING', rev).rev;
    fs.writeFileSync(path.join(f.repo, 'src', 'late-edit.js'), 'not committed\n');
    for (const extra of [[], ['--ack-assurance-gap']]) {
      const res = run(f, 'transition', '--to', 'AWAITING_REVIEW', '--expected-rev', String(rev), ...extra);
      assert.equal(res.status, 1);
      assert.match(res.stderr, /DIRTY_TREE: 1 uncommitted or untracked path/);
    }
    fs.rmSync(path.join(f.repo, 'src', 'late-edit.js'));
    assert.equal(move(f, 'AWAITING_REVIEW', rev).phase, 'AWAITING_REVIEW');
  });

  test('a rejected receipt aborts the transition and changes nothing', () => {
    const f = fixture();
    const rev = toExecuting(f);
    const head = commitFile(f.repo, 'src/export.js', 'export const x = 1;\n', 'slice');
    const outOfBounds = writeReceipt(f, f.base, head, ['src/export.js']);
    const res = run(f, 'transition', '--to', 'VERIFYING', '--expected-rev', String(rev), '--admit-receipt', outOfBounds, '--allowed-paths', 'docs/**');
    assert.equal(res.status, 1);
    assert.match(res.stderr, /RECEIPT_REJECTED[\s\S]*outside --allowed-paths: src\/export\.js/);
    assert.equal(res.json.status, 'REJECTED');
    const failing = writeReceipt(f, f.base, head, ['src/export.js'], { verify_exit_code: 1 });
    assert.match(run(f, 'transition', '--to', 'VERIFYING', '--expected-rev', String(rev), '--admit-receipt', failing).stderr, /verify_exit_code is 1, not 0/);
    const shown = ok(f, 'show', '--json');
    assert.equal(shown.rev, rev);
    assert.equal(shown.phase, 'EXECUTING');
    assert.deepEqual(shown.receipts, []);
    assert.match(run(f, 'transition', '--to', 'VERIFYING', '--expected-rev', String(rev), '--allowed-paths', 'src/**').stderr, /--allowed-paths only applies together with --admit-receipt/);
  });

  test('refuses AWAITING_REVIEW and SHIPPED below the assurance floor unless the gap is acknowledged', () => {
    const f = fixture();
    let rev = toExecuting(f);
    rev = move(f, 'VERIFYING', rev).rev;
    rev = move(f, 'AUDITING', rev).rev;
    const refused = run(f, 'transition', '--to', 'AWAITING_REVIEW', '--expected-rev', String(rev));
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /ASSURANCE_GAP: achieved A0 is below the required A2/);

    const acked = move(f, 'AWAITING_REVIEW', rev, '--ack-assurance-gap');
    assert.equal(acked.assurance_gap, true);
    assert.match(ok(f, 'show', '--json').receipts[0], /^ASSURANCE GAP acknowledged entering AWAITING_REVIEW: achieved A0 < required A2$/);
    assert.match(git(f.runtime, 'log', '-1', '--format=%b'), /ASSURANCE GAP acknowledged/);
    assert.match(run(f, 'transition', '--to', 'SHIPPED', '--expected-rev', String(acked.rev)).stderr, /ASSURANCE_GAP/);
    assert.equal(move(f, 'SHIPPED', acked.rev, '--ack-assurance-gap').phase, 'SHIPPED');
  });

  test('an audit Blocker loops back to EXECUTING and must be resolved before review', () => {
    const f = fixture();
    let rev = toExecuting(f);
    rev = move(f, 'VERIFYING', rev).rev;
    rev = move(f, 'AUDITING', rev).rev;
    rev = move(f, 'EXECUTING', rev, '--blocker', 'src/export.js:4 drops rows on empty input').rev;
    rev = move(f, 'VERIFYING', rev).rev;
    rev = move(f, 'AUDITING', rev).rev;
    assert.match(run(f, 'transition', '--to', 'AWAITING_REVIEW', '--expected-rev', String(rev), '--ack-assurance-gap').stderr, /OPEN_BLOCKERS: 1 open blocker/);
    const cleared = move(f, 'AWAITING_REVIEW', rev, '--resolve-blockers', '--ack-assurance-gap');
    assert.deepEqual(ok(f, 'show', '--json').blockers, []);
    assert.equal(move(f, 'EXECUTING', cleared.rev).phase, 'EXECUTING', 'a human change request returns to EXECUTING');
  });

  test('escalates the tier one way and raises the floor', () => {
    const f = fixture();
    init(f);
    const out = ok(f, 'transition', '--expected-rev', '1', '--escalate-tier', '3');
    assert.equal(out.risk_tier, 3);
    assert.equal(out.required_assurance, 'A3');
    assert.equal(out.phase, 'TRIAGE');
    const shown = ok(f, 'show', '--json');
    assert.equal(shown.profile, 'rcstack-engineering');
    assert.equal(shown.playbook, 'security-critical');
    assert.equal(shown.escalated_from_tier, 2);
    assert.equal(shadowLog(f)[0], 'state(widgets/main): TRIAGE -> TRIAGE (rev 2, A0)');
    assert.match(run(f, 'transition', '--expected-rev', '2', '--escalate-tier', '2').stderr, /escalation is one-way/);
  });

  test('Tier 3 escalation persists engineering/security-critical across engineering, study, and research in one commit', () => {
    const cases = [
      ['rcstack-engineering', 'feature-build', '2'],
      ['rcstack-study', 'topic-deep-dive', '2'],
      ['rcstack-research', 'research-report', '2'],
    ];
    for (const [profile, playbook, startTier] of cases) {
      const f = fixture();
      ok(f, 'init', '--profile', profile, '--playbook', playbook, '--tier', startTier, '--goal', `work in ${profile}`);
      const beforeCount = shadowLog(f).length;
      const out = ok(f, 'transition', '--expected-rev', '1', '--escalate-tier', '3');
      assert.equal(out.risk_tier, 3, profile);
      assert.equal(out.required_assurance, 'A3', profile);
      assert.equal(shadowLog(f).length, beforeCount + 1, `${profile}: single shadow commit`);

      const shown = ok(f, 'show', '--json');
      assert.equal(shown.profile, 'rcstack-engineering', profile);
      assert.equal(shown.playbook, 'security-critical', profile);
      assert.equal(shown.risk_tier, 3, profile);
      assert.equal(shown.required_assurance, 'A3', profile);
      assert.equal(shown.escalated_from_tier, Number(startTier), profile);

      const plain = run(f, 'show').stdout;
      assert.match(plain, /^profile: "rcstack-engineering"$/m, profile);
      assert.match(plain, /^playbook: "security-critical"$/m, profile);
      const committed = git(f.runtime, 'show', `HEAD:${stateRelPath('widgets', f.branch)}`);
      assert.equal(committed, plain.trimEnd(), `${profile}: committed blob matches show`);
    }
  });

  test('lower-tier escalation retains its route and subsequent Tier 3 escalation preserves the first escalated_from_tier', () => {
    const f = fixture();
    ok(f, 'init', '--profile', 'rcstack-study', '--playbook', 'recall-and-drill', '--tier', '1', '--goal', 'drill');
    const mid = ok(f, 'transition', '--expected-rev', '1', '--escalate-tier', '2');
    assert.equal(mid.risk_tier, 2);
    assert.equal(mid.required_assurance, 'A2');
    let shown = ok(f, 'show', '--json');
    assert.equal(shown.profile, 'rcstack-study');
    assert.equal(shown.playbook, 'recall-and-drill');
    assert.equal(shown.escalated_from_tier, 1);

    const top = ok(f, 'transition', '--expected-rev', '2', '--escalate-tier', '3');
    assert.equal(top.risk_tier, 3);
    assert.equal(top.required_assurance, 'A3');
    shown = ok(f, 'show', '--json');
    assert.equal(shown.profile, 'rcstack-engineering');
    assert.equal(shown.playbook, 'security-critical');
    assert.equal(shown.escalated_from_tier, 1, 'preserves first escalated_from_tier');
  });

  test('a task initialized directly at Tier 3 lacks escalated_from_tier and retains its selected route', () => {
    const f = fixture();
    ok(f, 'init', '--profile', 'rcstack-study', '--playbook', 'topic-deep-dive', '--tier', '3', '--goal', 'high-stakes notes');
    let shown = ok(f, 'show', '--json');
    assert.equal(shown.profile, 'rcstack-study');
    assert.equal(shown.playbook, 'topic-deep-dive');
    assert.equal(shown.risk_tier, 3);
    assert.equal(shown.required_assurance, 'A3');
    assert.equal(shown.escalated_from_tier, undefined);

    move(f, 'RESEARCHING', 1);
    shown = ok(f, 'show', '--json');
    assert.equal(shown.profile, 'rcstack-study');
    assert.equal(shown.playbook, 'topic-deep-dive');
    assert.match(run(f, 'show').stdout, /^playbook: "topic-deep-dive"$/m);
  });

  test('stale revision or failed commit during Tier 3 escalation preserves the prior route', () => {
    const f = fixture();
    ok(f, 'init', '--profile', 'rcstack-research', '--playbook', 'viability-spike', '--tier', '2', '--goal', 'spike');
    move(f, 'RESEARCHING', 1);
    const before = fs.readFileSync(stateFile(f), 'utf8');

    const stale = run(f, 'transition', '--expected-rev', '1', '--escalate-tier', '3');
    assert.equal(stale.status, 1);
    assert.match(stale.stderr, /REV_CONFLICT/);
    assert.equal(ok(f, 'show', '--json').profile, 'rcstack-research');
    assert.equal(ok(f, 'show', '--json').playbook, 'viability-spike');
    assert.equal(fs.readFileSync(stateFile(f), 'utf8'), before);

    const indexLock = path.join(f.runtime, '.git', 'index.lock');
    fs.writeFileSync(indexLock, '');
    const failed = run(f, 'transition', '--expected-rev', '2', '--escalate-tier', '3');
    fs.rmSync(indexLock);
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /COMMIT_FAILED/);
    assert.equal(fs.readFileSync(stateFile(f), 'utf8'), before);
    assert.equal(ok(f, 'show', '--json').profile, 'rcstack-research');
    assert.equal(ok(f, 'show', '--json').playbook, 'viability-spike');
    assert.equal(shadowLog(f).length, 2);
  });

  test('legacy committed escalated state reports effective route on show without writing, rolls back to original bytes, and persists on next transition', () => {
    const f = fixture();
    ok(f, 'init', '--profile', 'rcstack-study', '--playbook', 'topic-deep-dive', '--tier', '2', '--goal', 'deep study');
    let rev = move(f, 'RESEARCHING', 1).rev;
    rev = move(f, 'PLANNING', rev).rev;
    rev = move(f, 'EXECUTING', rev).rev;
    const c1 = commitFile(f.repo, 'notes/ch1.md', '# Ch1\n', 'notes');
    rev = move(f, 'VERIFYING', rev, '--admit-receipt', writeReceipt(f, f.base, c1, ['notes/ch1.md'], { audit_blockers: 0, audit_majors: 1 })).rev;
    assert.equal(ok(f, 'show', '--json').achieved_assurance, 'A2');

    // Commit a legacy-format escalated state directly into shadow history (old profile/playbook kept with tier 3 + escalated_from_tier).
    const current = parseState(fs.readFileSync(stateFile(f), 'utf8'));
    current.meta.risk_tier = 3;
    current.meta.required_assurance = 'A3';
    current.meta.escalated_from_tier = 2;
    current.meta.rev += 1;
    const legacyBytes = renderState(current);
    assert.match(legacyBytes, /^profile: "rcstack-study"$/m);
    assert.match(legacyBytes, /^playbook: "topic-deep-dive"$/m);
    fs.writeFileSync(stateFile(f), legacyBytes);
    git(f.runtime, 'add', '-f', '--', stateRelPath('widgets', f.branch));
    git(f.runtime, 'commit', '-q', '--no-verify', '-m', `state(widgets/main): VERIFYING -> VERIFYING (rev ${current.meta.rev}, A2)`);
    const legacyLogBefore = shadowLog(f);
    const legacyRev = current.meta.rev;

    // 1. Both show forms report the effective route without touching disk or shadow history.
    const shownJson = ok(f, 'show', '--json');
    assert.equal(shownJson.profile, 'rcstack-engineering');
    assert.equal(shownJson.playbook, 'security-critical');
    assert.equal(shownJson.risk_tier, 3);
    assert.equal(shownJson.required_assurance, 'A3');
    assert.equal(shownJson.escalated_from_tier, 2);
    assert.equal(shownJson.achieved_assurance, 'A2');
    assert.equal(shownJson.receipts.length, 1);

    const shownPlain = run(f, 'show').stdout;
    assert.match(shownPlain, /^profile: "rcstack-engineering"$/m);
    assert.match(shownPlain, /^playbook: "security-critical"$/m);
    assert.match(shownPlain, /^risk_tier: 3$/m);
    assert.match(shownPlain, /^required_assurance: "A3"$/m);
    assert.equal(fs.readFileSync(stateFile(f), 'utf8'), legacyBytes, 'show does not rewrite disk');
    assert.deepEqual(shadowLog(f), legacyLogBefore, 'show does not touch shadow history');
    assert.equal(git(f.runtime, 'show', `HEAD:${stateRelPath('widgets', f.branch)}`), legacyBytes.trimEnd(), 'raw history keeps original commit');

    // 2. Working copy disagreement is ignored on reads, and stale caller restores committed bytes and fails.
    fs.writeFileSync(stateFile(f), legacyBytes.replace('profile: "rcstack-study"', 'profile: "rcstack-research"').replace('risk_tier: 3', 'risk_tier: 2'));
    assert.equal(ok(f, 'show', '--json').profile, 'rcstack-engineering');
    assert.equal(ok(f, 'show', '--json').playbook, 'security-critical');
    const stale = run(f, 'transition', '--to', 'AUDITING', '--expected-rev', String(legacyRev - 1));
    assert.equal(stale.status, 1);
    assert.match(stale.stderr, /REV_CONFLICT/);
    assert.equal(fs.readFileSync(stateFile(f), 'utf8'), legacyBytes, 'stale write restores actual committed bytes');
    assert.deepEqual(shadowLog(f), legacyLogBefore);

    // 3. Failed shadow commit rolls back to the actual original committed bytes (not normalized text).
    const indexLock = path.join(f.runtime, '.git', 'index.lock');
    fs.writeFileSync(indexLock, '');
    const failed = run(f, 'transition', '--to', 'AUDITING', '--expected-rev', String(legacyRev));
    fs.rmSync(indexLock);
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /COMMIT_FAILED/);
    assert.equal(fs.readFileSync(stateFile(f), 'utf8'), legacyBytes, 'failed commit rolls back to original legacy committed bytes');
    assert.deepEqual(shadowLog(f), legacyLogBefore);

    // 4. Ordinary successful transition persists the effective route while preserving receipts and earned assurance (HEAD unchanged).
    const moved = move(f, 'AUDITING', legacyRev, '--next', 'Observe Tier 3 audit');
    assert.equal(moved.achieved_assurance, 'A2', 'earned assurance preserved when HEAD did not move');
    assert.equal(shadowLog(f).length, legacyLogBefore.length + 1);
    const persisted = git(f.runtime, 'show', `HEAD:${stateRelPath('widgets', f.branch)}`);
    assert.match(persisted, /^profile: "rcstack-engineering"$/m);
    assert.match(persisted, /^playbook: "security-critical"$/m);
    const afterJson = ok(f, 'show', '--json');
    assert.equal(afterJson.receipts.length, 1);
    assert.equal(afterJson.achieved_assurance, 'A2');

    // 5. Usual HEAD reset still applies on a legacy state when HEAD moved before the persisting transition.
    const f2 = fixture();
    ok(f2, 'init', '--profile', 'rcstack-study', '--playbook', 'topic-deep-dive', '--tier', '2', '--goal', 'head reset check');
    let r2 = move(f2, 'RESEARCHING', 1).rev;
    r2 = move(f2, 'PLANNING', r2).rev;
    r2 = move(f2, 'EXECUTING', r2).rev;
    const d1 = commitFile(f2.repo, 'notes/a.md', 'a\n', 'first');
    r2 = move(f2, 'VERIFYING', r2, '--admit-receipt', writeReceipt(f2, f2.base, d1, ['notes/a.md'], { audit_blockers: 0, audit_majors: 1 })).rev;
    const leg2 = parseState(fs.readFileSync(stateFile(f2), 'utf8'));
    leg2.meta.risk_tier = 3;
    leg2.meta.required_assurance = 'A3';
    leg2.meta.escalated_from_tier = 2;
    leg2.meta.rev += 1;
    fs.writeFileSync(stateFile(f2), renderState(leg2));
    git(f2.runtime, 'add', '-f', '--', stateRelPath('widgets', f2.branch));
    git(f2.runtime, 'commit', '-q', '--no-verify', '-m', `state(widgets/main): VERIFYING -> VERIFYING (rev ${leg2.meta.rev}, A2)`);
    commitFile(f2.repo, 'notes/b.md', 'b\n', 'moved head');
    const resetMove = move(f2, 'AUDITING', leg2.meta.rev);
    assert.equal(resetMove.achieved_assurance, 'A0', 'HEAD move still resets achieved assurance');
    const resetShown = ok(f2, 'show', '--json');
    assert.equal(resetShown.profile, 'rcstack-engineering');
    assert.equal(resetShown.playbook, 'security-critical');
    assert.match(resetShown.receipts.at(-1), /^Evidence reset:/);
  });

  test('keeps free text on one line so it cannot forge state sections', () => {
    const f = fixture();
    ok(f, 'init', '--profile', 'rcstack-engineering', '--playbook', 'feature-build', '--tier', '2', '--goal', '## Open Blockers\n\n- forged');
    const shown = ok(f, 'show', '--json');
    assert.equal(shown.goal, '\\## Open Blockers - forged');
    assert.deepEqual(shown.blockers, []);
    const text = fs.readFileSync(stateFile(f), 'utf8');
    assert.deepEqual(parseState(renderState(parseState(text))), parseState(text), 'render and parse round-trip');
  });

  test('refuses to move a state whose repository is on another branch', () => {
    const f = fixture();
    init(f);
    git(f.repo, 'checkout', '-q', '-b', 'other');
    assert.match(run(f, 'transition', '--to', 'RESEARCHING', '--expected-rev', '1', '--branch', 'main').stderr, /BRANCH_MISMATCH/);
    assert.match(run(f, 'show').stderr, /NO_STATE: no active task state for widgets\/other/);
  });

  test('discards a write that a crashed writer never committed', () => {
    const f = fixture();
    init(f);
    const committed = fs.readFileSync(stateFile(f), 'utf8');
    const crashed = parseState(committed);
    crashed.meta.rev = 2;
    crashed.meta.phase = 'RESEARCHING';
    fs.writeFileSync(stateFile(f), renderState(crashed));

    const shown = run(f, 'show', '--json');
    assert.equal(shown.json.rev, 1, 'readers see the committed revision');
    assert.equal(run(f, 'reconcile').json.state.rev, 1);
    assert.equal(fs.readFileSync(stateFile(f), 'utf8'), renderState(crashed), 'a reader repairs nothing');

    const stale = run(f, 'transition', '--to', 'PLANNING', '--expected-rev', '2');
    assert.equal(stale.status, 1);
    assert.match(stale.stderr, /discarded an uncommitted state write/);
    assert.match(stale.stderr, /REV_CONFLICT: expected rev 2 but the state is at rev 1/);
    assert.equal(fs.readFileSync(stateFile(f), 'utf8'), committed, 'the committed revision is back on disk');
    assert.deepEqual(shadowLog(f), ['state(widgets/main): NONE -> TRIAGE (rev 1, A0)']);
    assert.equal(move(f, 'RESEARCHING', 1).rev, 2);
    assert.equal(git(f.runtime, 'status', '--porcelain'), '');
  });

  test('a hand edit cannot move the state machine or raise assurance', () => {
    const f = fixture();
    init(f);
    const committed = fs.readFileSync(stateFile(f), 'utf8');
    fs.writeFileSync(stateFile(f), committed.replace('phase: "TRIAGE"', 'phase: "SHIPPED"').replace('achieved_assurance: "A0"', 'achieved_assurance: "A3"'));
    const res = run(f, 'close', '--expected-rev', '1');
    assert.equal(res.status, 1);
    assert.match(res.stderr, /NOT_SHIPPED: the task is in TRIAGE/);
    assert.equal(fs.readFileSync(stateFile(f), 'utf8'), committed);
    assert.equal(shadowLog(f).length, 1);
  });

  test('garbage in the state file never reaches the shadow history', () => {
    const f = fixture();
    init(f);
    fs.writeFileSync(stateFile(f), 'CORRUPTED GARBAGE');
    const out = run(f, 'transition', '--to', 'RESEARCHING', '--expected-rev', '1');
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stderr, /discarded an uncommitted state write/);
    assert.deepEqual(shadowLog(f), ['state(widgets/main): TRIAGE -> RESEARCHING (rev 2, A0)', 'state(widgets/main): NONE -> TRIAGE (rev 1, A0)']);
    assert.doesNotMatch(git(f.runtime, 'log', '-p', '--all'), /CORRUPTED GARBAGE/);
  });

  /** A syntactically valid state file nobody committed: AWAITING_REVIEW at A3 with no receipts. */
  function forgeState(f) {
    const donor = fixture();
    init(donor);
    const forged = parseState(fs.readFileSync(stateFile(donor), 'utf8'));
    Object.assign(forged.meta, { rev: 1, phase: 'AWAITING_REVIEW', risk_tier: 3, required_assurance: 'A3', achieved_assurance: 'A3', base_sha: f.base, head_sha: f.base });
    fs.mkdirSync(path.dirname(stateFile(f)), { recursive: true });
    fs.writeFileSync(stateFile(f), renderState(forged));
  }
  const runEnv = (env, f, command, ...args) =>
    spawnSync(process.execPath, [SCRIPT, command, '--repo', f.repo, '--runtime-dir', f.runtime, ...args], { encoding: 'utf8', env: { ...ENV, ...env } });

  test('a state file that was never committed is set aside, not adopted', () => {
    const f = fixture();
    init(f);
    ok(f, 'close', '--expected-rev', '1', '--abandon');
    forgeState(f);
    assert.match(run(f, 'show').stderr, /NO_STATE/);
    assert.equal(run(f, 'reconcile').json.state, null);
    assert.match(run(f, 'transition', '--to', 'SHIPPED', '--expected-rev', '1').stderr, /NO_STATE/);
    assert.ok(fs.existsSync(`${stateFile(f)}.orphan`), 'the uncommitted file is set aside for a human to inspect');
    const fresh = init(f);
    assert.deepEqual([fresh.rev, fresh.phase, fresh.achieved_assurance], [1, 'TRIAGE', 'A0']);
  });

  test('a machine-wide git ignore file cannot make an uncommitted state file count', () => {
    const f = fixture();
    const ignore = path.join(path.dirname(f.repo), 'global-ignore');
    const gitconfig = path.join(path.dirname(f.repo), 'gitconfig');
    fs.writeFileSync(ignore, '*.md\nstate/\n');
    fs.writeFileSync(gitconfig, `[core]\n\texcludesFile = ${ignore}\n[status]\n\tshowUntrackedFiles = no\n`);
    const hostile = { GIT_CONFIG_GLOBAL: gitconfig };
    fs.mkdirSync(f.runtime, { recursive: true });
    git(f.runtime, 'init', '-q');
    forgeState(f);

    const shown = runEnv(hostile, f, 'show', '--json');
    assert.equal(shown.status, 1);
    assert.match(shown.stderr, /NO_STATE/);
    const shipped = runEnv(hostile, f, 'transition', '--to', 'SHIPPED', '--expected-rev', '1');
    assert.equal(shipped.status, 1, shipped.stdout);
    assert.match(shipped.stderr, /NO_STATE/);
    assert.equal(git(f.runtime, 'rev-list', '--all', '--count'), '0', 'nothing forged reached the shadow history');

    // A real task under the same hostile configuration: commits still happen and hand edits still lose.
    const real = runEnv(hostile, f, 'init', '--profile', 'rcstack-engineering', '--playbook', 'feature-build', '--tier', '2', '--goal', 'g');
    assert.equal(real.status, 0, real.stderr);
    const committed = fs.readFileSync(stateFile(f), 'utf8');
    fs.writeFileSync(stateFile(f), committed.replace('phase: "TRIAGE"', 'phase: "SHIPPED"').replace('achieved_assurance: "A0"', 'achieved_assurance: "A3"'));
    assert.equal(JSON.parse(runEnv(hostile, f, 'show', '--json').stdout).phase, 'TRIAGE');
    assert.match(runEnv(hostile, f, 'close', '--expected-rev', '1').stderr, /NOT_SHIPPED: the task is in TRIAGE/);
    assert.equal(fs.readFileSync(stateFile(f), 'utf8'), committed);
  });

  test('without a readable shadow history there is no state, never a fallback to the file', () => {
    const noRepo = fixture();
    forgeState(noRepo);
    assert.match(run(noRepo, 'show').stderr, /NO_STATE/);
    const reconciled = run(noRepo, 'reconcile');
    assert.equal(reconciled.status, 0);
    assert.equal(reconciled.json.state, null);

    const broken = fixture();
    init(broken);
    fs.writeFileSync(stateFile(broken), fs.readFileSync(stateFile(broken), 'utf8').replace('phase: "TRIAGE"', 'phase: "SHIPPED"'));
    fs.writeFileSync(path.join(broken.runtime, '.git', 'HEAD'), 'garbage\n');
    for (const command of ['show', 'reconcile']) {
      const res = run(broken, command);
      assert.equal(res.status, 1, command);
      assert.match(res.stderr, /GIT_FAILED|RUNTIME_NOT_A_REPO/, command);
    }
    assert.equal(run(broken, 'close', '--expected-rev', '1').status, 1);
  });

  test('never initializes a shadow repository through a symlinked .git', () => {
    const f = fixture();
    fs.mkdirSync(f.runtime, { recursive: true });
    const outside = path.join(path.dirname(f.repo), 'outside-target');
    fs.symlinkSync(outside, path.join(f.runtime, '.git'));
    const res = run(f, 'init', '--profile', 'rcstack-engineering', '--playbook', 'feature-build', '--tier', '2', '--goal', 'g');
    assert.equal(res.status, 1);
    assert.match(res.stderr, /RUNTIME_NOT_A_REPO: .*\.git exists but is not a directory/);
    assert.equal(fs.existsSync(outside), false);
    assert.match(run(f, 'show').stderr, /RUNTIME_NOT_A_REPO/);
  });

  test('a failed shadow commit rolls the state file back', () => {
    const f = fixture();
    init(f);
    const before = fs.readFileSync(stateFile(f), 'utf8');
    const indexLock = path.join(f.runtime, '.git', 'index.lock');
    fs.writeFileSync(indexLock, '');
    const res = run(f, 'transition', '--to', 'RESEARCHING', '--expected-rev', '1');
    fs.rmSync(indexLock);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /COMMIT_FAILED: .*the previous state was restored/s);
    assert.equal(fs.readFileSync(stateFile(f), 'utf8'), before);
    assert.equal(shadowLog(f).length, 1);
    assert.equal(fs.existsSync(path.join(f.runtime, '.rc-state.lock')), false, 'the lock is released after a failure');
    assert.equal(move(f, 'RESEARCHING', 1).rev, 2);
  });

  test('parseState rejects malformed state with CORRUPT_STATE', () => {
    const f = fixture();
    init(f);
    const good = fs.readFileSync(stateFile(f), 'utf8');
    const corrupt = (text) => assert.throws(() => parseState(text), (err) => err instanceof StateError && err.code === 'CORRUPT_STATE');
    corrupt('no frontmatter at all');
    corrupt(good.replace('phase: "TRIAGE"', 'phase: "TRIAGE"\nextra: 1'));
    corrupt(good.replace('schema_version: 1', 'schema_version: 2'));
    corrupt(good.replace('rev: 1', 'rev: 0'));
    corrupt(good.replace('phase: "TRIAGE"', 'phase: "DONE"'));
    corrupt(good.replace('phase: "TRIAGE"', 'phase: "BLOCKED"'));
    corrupt(good.replace('## Next Step', '## Next'));
    corrupt(good.replace(/base_sha: "[0-9a-f]+"/, 'base_sha: "abc123"'));
  });
});

describe('locking', () => {
  const lockOf = (f) => path.join(f.runtime, '.rc-state.lock');
  const guardOf = (f) => `${lockOf(f)}.guard`;
  const holdLock = (f, owner) => fs.writeFileSync(lockOf(f), JSON.stringify(owner));
  const deadPid = () => Number(spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' }).stdout.trim());
  const leftovers = (f) => fs.readdirSync(f.runtime).filter((name) => name.startsWith('.rc-state'));

  test('times out while another live writer holds the lock, without writing', () => {
    const f = fixture();
    init(f);
    holdLock(f, { token: 'someone-else', pid: process.pid, host: os.hostname(), acquired_at: new Date().toISOString() });
    const res = run(f, 'transition', '--to', 'RESEARCHING', '--expected-rev', '1', '--lock-timeout-ms', '150');
    assert.equal(res.status, 1);
    assert.match(res.stderr, /LOCK_TIMEOUT/);
    assert.equal(JSON.parse(fs.readFileSync(lockOf(f), 'utf8')).token, 'someone-else', 'the foreign lock is left alone');
    fs.rmSync(lockOf(f));
    assert.equal(ok(f, 'show', '--json').rev, 1);
  });

  test('reclaims a lock whose owner process is dead, and leaves no lock files behind', () => {
    const f = fixture();
    init(f);
    holdLock(f, { token: 'dead-owner', pid: deadPid(), host: os.hostname(), acquired_at: new Date().toISOString() });
    assert.equal(move(f, 'RESEARCHING', 1, '--lock-timeout-ms', '2000').rev, 2);
    assert.deepEqual(leftovers(f), [], 'lock, guard and temp files are all gone');
  });

  test('reclaims a lock older than the stale threshold', () => {
    const f = fixture();
    init(f);
    holdLock(f, { token: 'ancient', pid: process.pid, host: 'another-host', acquired_at: '2020-01-01T00:00:00Z' });
    const old = new Date(Date.now() - 120000);
    fs.utimesSync(lockOf(f), old, old);
    assert.equal(move(f, 'RESEARCHING', 1, '--stale-lock-ms', '1000', '--lock-timeout-ms', '2000').rev, 2);
    assert.deepEqual(leftovers(f), []);
  });

  test('never deletes a lock while another writer holds the guard', () => {
    const f = fixture();
    init(f);
    holdLock(f, { token: 'dead-owner', pid: deadPid(), host: os.hostname(), acquired_at: new Date().toISOString() });
    fs.writeFileSync(guardOf(f), '');
    const res = run(f, 'transition', '--to', 'RESEARCHING', '--expected-rev', '1', '--lock-timeout-ms', '200');
    assert.equal(res.status, 1);
    assert.match(res.stderr, /LOCK_TIMEOUT/);
    assert.equal(JSON.parse(fs.readFileSync(lockOf(f), 'utf8')).token, 'dead-owner', 'a stale lock is only removed under the guard');
    assert.ok(fs.existsSync(guardOf(f)), 'a fresh guard is respected');

    // A guard left by a writer that died holding it is cleared once it is clearly abandoned.
    const old = new Date(Date.now() - 120000);
    fs.utimesSync(guardOf(f), old, old);
    assert.equal(move(f, 'RESEARCHING', 1, '--lock-timeout-ms', '3000').rev, 2);
    assert.deepEqual(leftovers(f), []);
  });

  test('decides on the repository as it is once the lock is held, not as it was while waiting', async () => {
    const f = fixture();
    let rev = toExecuting(f);
    const c1 = commitFile(f.repo, 'src/export.js', 'export const x = 1;\n', 'slice');
    const audited = writeReceipt(f, f.base, c1, ['src/export.js'], { audit_blockers: 0, audit_majors: 0 });
    rev = move(f, 'VERIFYING', rev, '--admit-receipt', audited).rev;
    rev = move(f, 'AUDITING', rev).rev;
    rev = move(f, 'AWAITING_REVIEW', rev).rev;

    const waitFor = (args) =>
      new Promise((resolve) => {
        const child = spawn(process.execPath, [SCRIPT, 'transition', '--repo', f.repo, '--runtime-dir', f.runtime, ...args], { env: ENV });
        let stderr = '';
        child.stderr.on('data', (chunk) => (stderr += chunk));
        child.stdout.resume();
        child.on('close', (code) => resolve({ code, stderr }));
      });
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    // 1. A new, unverified commit lands while a SHIPPED transition waits for the lock.
    holdLock(f, { token: 'busy', pid: process.pid, host: os.hostname(), acquired_at: new Date().toISOString() });
    const shipping = waitFor(['--to', 'SHIPPED', '--expected-rev', String(rev)]);
    await pause(300);
    commitFile(f.repo, 'src/export.js', 'export const x = "landed while waiting";\n', 'unverified');
    fs.rmSync(lockOf(f));
    const shipped = await shipping;
    assert.equal(shipped.code, 1);
    assert.match(shipped.stderr, /ASSURANCE_GAP: achieved A0 is below the required A2/);

    // 2. A receipt that was valid when the command started is judged against the tree as it is now.
    holdLock(f, { token: 'busy', pid: process.pid, host: os.hostname(), acquired_at: new Date().toISOString() });
    const c2 = git(f.repo, 'rev-parse', 'HEAD');
    const fresh = writeReceipt(f, f.base, c2, ['src/export.js'], { audit_blockers: 0, audit_majors: 0 });
    const admitting = waitFor(['--expected-rev', String(rev), '--admit-receipt', fresh]);
    await pause(300);
    fs.writeFileSync(path.join(f.repo, 'dirty.txt'), 'appeared while waiting\n');
    fs.rmSync(lockOf(f));
    const admitted = await admitting;
    assert.equal(admitted.code, 1);
    assert.match(admitted.stderr, /RECEIPT_REJECTED[\s\S]*working tree is not clean/);

    const shown = ok(f, 'show', '--json');
    assert.equal(shown.rev, rev, 'neither waiting command changed the state');
    assert.equal(shown.phase, 'AWAITING_REVIEW');
  });

  test('serializes concurrent writers: exactly one wins each revision', async () => {
    const f = fixture();
    init(f);
    const attempt = () =>
      new Promise((resolve) => {
        const child = spawn(process.execPath, [SCRIPT, 'transition', '--repo', f.repo, '--runtime-dir', f.runtime, '--to', 'RESEARCHING', '--expected-rev', '1'], { env: ENV, stdio: 'ignore' });
        child.on('close', resolve);
      });
    const codes = await Promise.all(Array.from({ length: 6 }, attempt));
    assert.equal(codes.filter((c) => c === 0).length, 1, `exit codes: ${codes}`);
    assert.equal(ok(f, 'show', '--json').rev, 2);
    assert.equal(shadowLog(f).length, 2);
  });
});

describe('reconcile', () => {
  test('reports no state, then in sync', () => {
    const f = fixture();
    const none = run(f, 'reconcile');
    assert.equal(none.status, 0);
    assert.equal(none.json.state, null);
    assert.equal(fs.existsSync(f.runtime), false, 'a read-only command creates nothing');
    init(f);
    const synced = run(f, 'reconcile');
    assert.equal(synced.status, 0);
    assert.equal(synced.json.in_sync, true);
    assert.deepEqual(synced.json.drift, []);
  });

  test('git beats state: reports a moved HEAD and a dirty tree with exit 2', () => {
    const f = fixture();
    init(f);
    const head = commitFile(f.repo, 'src/new.js', '1\n', 'work the state has not seen');
    fs.writeFileSync(path.join(f.repo, 'scratch.txt'), 'uncommitted\n');
    const res = run(f, 'reconcile');
    assert.equal(res.status, 2);
    assert.equal(res.json.in_sync, false);
    assert.deepEqual(res.json.drift.map((d) => d.code), ['HEAD_MOVED', 'DIRTY_TREE']);
    assert.equal(res.json.drift[0].state, f.base);
    assert.equal(res.json.drift[0].git, head);
    assert.match(res.json.drift[0].detail, /^1 commit\(s\) landed after the last recorded transition/);
    assert.match(res.json.note, /git beats state/);
    assert.equal(ok(f, 'show', '--json').head_sha, f.base, 'reconcile only reports; it never rewrites state');

    fs.rmSync(path.join(f.repo, 'scratch.txt'));
    assert.equal(move(f, 'RESEARCHING', 1).head_sha, head, 'the next transition records what git shows');
    assert.equal(run(f, 'reconcile').status, 0);
  });

  test('reports rewritten history', () => {
    const f = fixture();
    commitFile(f.repo, 'a.txt', 'a\n', 'second');
    init(f);
    git(f.repo, 'reset', '-q', '--hard', f.base);
    commitFile(f.repo, 'b.txt', 'b\n', 'rewritten');
    const res = run(f, 'reconcile');
    assert.equal(res.status, 2);
    assert.deepEqual(res.json.drift.map((d) => d.code), ['HEAD_MOVED', 'BASE_NOT_ANCESTOR']);
    assert.match(res.json.drift[0].detail, /history was rewritten/);
  });
});

describe('close', () => {
  test('removes a SHIPPED state with a shadow commit', () => {
    const f = fixture();
    let rev = toExecuting(f);
    rev = move(f, 'VERIFYING', rev).rev;
    rev = move(f, 'AUDITING', rev).rev;
    rev = move(f, 'AWAITING_REVIEW', rev, '--ack-assurance-gap').rev;
    assert.match(run(f, 'close', '--expected-rev', String(rev)).stderr, /NOT_SHIPPED: the task is in AWAITING_REVIEW/);
    rev = move(f, 'SHIPPED', rev, '--ack-assurance-gap').rev;
    assert.match(run(f, 'close', '--expected-rev', String(rev - 1)).stderr, /REV_CONFLICT/);
    assert.match(run(f, 'transition', '--to', 'BLOCKED', '--expected-rev', String(rev), '--blocker', 'x').stderr, /SHIPPED task cannot be blocked/);

    const closed = ok(f, 'close', '--expected-rev', String(rev));
    assert.equal(closed.phase, 'CLOSED');
    assert.equal(fs.existsSync(stateFile(f)), false);
    assert.equal(shadowLog(f)[0], `state(widgets/main): SHIPPED -> CLOSED (rev ${rev + 1}, A0)`);
    assert.equal(git(f.runtime, 'status', '--porcelain'), '');
    assert.equal(git(f.runtime, 'ls-files'), '', 'the state file is gone from the shadow index');
    assert.match(run(f, 'show').stderr, /NO_STATE/);
    assert.equal(init(f).rev, 1, 'a new task can start on the same branch');
  });

  test('--abandon discards an unfinished task explicitly', () => {
    const f = fixture();
    init(f);
    const out = ok(f, 'close', '--expected-rev', '1', '--abandon');
    assert.equal(out.phase, 'ABANDONED');
    assert.equal(shadowLog(f)[0], 'state(widgets/main): TRIAGE -> ABANDONED (rev 2, A0)');
  });
});

describe('CLI', () => {
  test('prints usage and rejects unknown commands', () => {
    const help = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8', env: ENV });
    assert.equal(help.status, 0);
    assert.match(help.stdout, /init\|transition\|show\|reconcile\|close/);
    const bad = spawnSync(process.execPath, [SCRIPT, 'destroy'], { encoding: 'utf8', env: ENV });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /unknown command "destroy"/);
    const notRepo = spawnSync(process.execPath, [SCRIPT, 'show', '--repo', SANDBOX, '--runtime-dir', path.join(SANDBOX, 'rt')], { encoding: 'utf8', env: ENV });
    assert.match(notRepo.stderr, /NOT_A_REPO/);
  });
});
