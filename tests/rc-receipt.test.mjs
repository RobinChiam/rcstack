// Hermetic tests for scripts/rc-receipt.mjs. Every git repository lives under os.tmpdir().
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { computeAssurance, evaluateReceipt, parseReceipt, parseAllowedPaths, schemaErrors, RECEIPT_FIELDS } from '../scripts/rc-receipt.mjs';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts/rc-receipt.mjs');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'rcstack-receipt-'));

// Isolate git (and anything that reads HOME) from the real machine, in this process and children.
Object.assign(process.env, {
  HOME: path.join(SANDBOX, 'home'),
  GIT_CONFIG_GLOBAL: os.devNull,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'rcstack-test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'rcstack-test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
  GIT_TERMINAL_PROMPT: '0',
});
for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete process.env[key];
fs.mkdirSync(process.env.HOME);

after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

function git(repo, ...args) {
  const res = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  assert.equal(res.status, 0, `git ${args.join(' ')}: ${res.stderr}`);
  return res.stdout.trim();
}

function write(repo, rel, content) {
  const file = path.join(repo, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

let counter = 0;
/** A repo with a base commit and one slice commit touching src/a.js and tests/a.test.js. */
function makeRepo() {
  counter += 1;
  const repo = path.join(SANDBOX, `repo-${counter}`);
  fs.mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  write(repo, 'README.md', '# fixture\n');
  write(repo, 'src/a.js', 'export const a = 1;\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'base');
  const base = git(repo, 'rev-parse', 'HEAD');
  write(repo, 'src/a.js', 'export const a = 2;\n');
  write(repo, 'tests/a.test.js', '// test\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'slice');
  const head = git(repo, 'rev-parse', 'HEAD');
  return { repo, base, head };
}

function receipt(base, head, overrides = {}) {
  return {
    slice: 'S1 change a',
    base_sha: base,
    head_sha: head,
    files_touched: ['src/a.js', 'tests/a.test.js'],
    verify_cmd: 'node --test',
    verify_exit_code: 0,
    checks_passed: ['mechanical'],
    audit_blockers: null,
    audit_majors: null,
    assumptions: [],
    review_hotspot: ['src/a.js:1'],
    ...overrides,
  };
}

function gate(fixture, overrides = {}, allowedPaths = null) {
  const data = receipt(fixture.base, fixture.head, overrides);
  for (const [key, value] of Object.entries(data)) if (value === undefined) delete data[key];
  return evaluateReceipt({ receiptText: JSON.stringify(data), repo: fixture.repo, allowedPaths });
}

function toYaml(data) {
  const lines = [];
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      if (value.length === 0) lines.push(`${key}: []`);
      else lines.push(`${key}:`, ...value.map((v) => `  - ${JSON.stringify(v)}`));
    } else {
      lines.push(`${key}: ${typeof value === 'string' ? JSON.stringify(value) : value}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function cli(args, input) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', input });
}

describe('assurance tagging', () => {
  const tag = (checks_passed, audit_blockers, audit_majors, verify_exit_code = 0) =>
    computeAssurance({ checks_passed, audit_blockers, audit_majors, verify_exit_code });

  test('follows the ladder strictly from evidence', () => {
    assert.equal(tag([], null, null), 'A0');
    assert.equal(tag(['behavioral', 'hardened'], 0, 0), 'A0', 'no mechanical pass means A0');
    assert.equal(tag(['mechanical'], null, null), 'A1');
    assert.equal(tag(['mechanical'], 0, 0), 'A1', 'an audit without behavioral tests is still A1');
    assert.equal(tag(['mechanical', 'behavioral'], null, null), 'A1', 'un-audited work tops out at A1');
    assert.equal(tag(['mechanical', 'behavioral'], 1, 0), 'A1', 'an open Blocker caps at A1');
    assert.equal(tag(['mechanical', 'behavioral'], 0, 3), 'A2');
    assert.equal(tag(['mechanical', 'behavioral', 'hardened'], 0, 1), 'A2', 'an open Major caps at A2');
    assert.equal(tag(['mechanical', 'hardened'], 0, 0), 'A1', 'hardened without behavioral is still A1');
    assert.equal(tag(['mechanical', 'behavioral', 'hardened'], 0, 0), 'A3');
    assert.equal(tag(['mechanical', 'behavioral', 'hardened'], 0, 0, 1), 'A0', 'a failing verify means A0');
  });
});

describe('admission', () => {
  test('admits a valid clean-tree receipt as A1', () => {
    const f = makeRepo();
    const result = gate(f);
    assert.equal(result.status, 'ADMITTED', result.reasons.join('\n'));
    assert.equal(result.assurance, 'A1');
    assert.deepEqual(result.reasons, []);
    assert.deepEqual(result.checks, { schema_completeness: 'pass', git_boundary: 'pass', command_proof: 'pass', assurance_tagging: 'pass' });
    assert.equal(result.base_sha, f.base);
    assert.equal(result.head_sha, f.head);
    assert.deepEqual(result.files_touched, ['src/a.js', 'tests/a.test.js']);
    assert.equal(result.verify_cmd, 'node --test');
  });

  test('admits as A2 with behavioral evidence and an audit with 0 open Blockers', () => {
    const result = gate(makeRepo(), { checks_passed: ['mechanical', 'behavioral'], audit_blockers: 0, audit_majors: 2 });
    assert.equal(result.status, 'ADMITTED', result.reasons.join('\n'));
    assert.equal(result.assurance, 'A2');
  });

  test('admits as A3 with hardened evidence and 0 open Blockers or Majors', () => {
    const result = gate(makeRepo(), { checks_passed: ['mechanical', 'behavioral', 'hardened'], audit_blockers: 0, audit_majors: 0 });
    assert.equal(result.status, 'ADMITTED', result.reasons.join('\n'));
    assert.equal(result.assurance, 'A3');
  });

  test('admits as A0 when no mechanical check passed', () => {
    const result = gate(makeRepo(), { checks_passed: [] });
    assert.equal(result.status, 'ADMITTED');
    assert.equal(result.assurance, 'A0');
  });

  test('accepts abbreviated SHAs and reports the full ones', () => {
    const f = makeRepo();
    const result = gate(f, { base_sha: f.base.slice(0, 10), head_sha: f.head.slice(0, 10) });
    assert.equal(result.status, 'ADMITTED', result.reasons.join('\n'));
    assert.equal(result.head_sha, f.head);
  });

  test('accepts files inside --allowed-paths', () => {
    const result = gate(makeRepo(), {}, ['src/**', 'tests/*.test.js']);
    assert.equal(result.status, 'ADMITTED', result.reasons.join('\n'));
  });

  test('admits a receipt whose head is an ancestor of the checked-out HEAD', () => {
    const f = makeRepo();
    write(f.repo, 'later.txt', 'later\n');
    git(f.repo, 'add', '-A');
    git(f.repo, 'commit', '-q', '-m', 'later slice');
    assert.equal(gate(f).status, 'ADMITTED');
  });
});

describe('rejection', () => {
  const rejects = (result, pattern) => {
    assert.equal(result.status, 'REJECTED');
    assert.equal(result.assurance, null);
    assert.match(result.reasons.join('\n'), pattern);
  };

  test('rejects a dirty working tree (untracked or modified)', () => {
    const untracked = makeRepo();
    write(untracked.repo, 'scratch.txt', 'left behind\n');
    rejects(gate(untracked), /git_boundary: working tree is not clean \(1 uncommitted or untracked path/);

    const modified = makeRepo();
    write(modified.repo, 'src/a.js', 'export const a = 3;\n');
    const result = gate(modified);
    rejects(result, /working tree is not clean/);
    assert.equal(result.checks.git_boundary, 'fail');
  });

  test('rejects a diff that touches a file the receipt does not list', () => {
    rejects(gate(makeRepo(), { files_touched: ['src/a.js'], review_hotspot: ['src/a.js:1'] }), /changed but not listed in files_touched: tests\/a\.test\.js/);
  });

  test('rejects a receipt listing a file that did not change', () => {
    rejects(gate(makeRepo(), { files_touched: ['src/a.js', 'tests/a.test.js', 'README.md'] }), /listed in files_touched but not changed: README\.md/);
  });

  test('rejects files outside --allowed-paths', () => {
    rejects(gate(makeRepo(), {}, ['src/**']), /git_boundary: outside --allowed-paths: tests\/a\.test\.js/);
  });

  test('rejects a non-zero verify exit code or an empty verify command', () => {
    const failed = gate(makeRepo(), { verify_exit_code: 1 });
    rejects(failed, /command_proof: verify_exit_code is 1, not 0/);
    assert.equal(failed.checks.command_proof, 'fail');
    rejects(gate(makeRepo(), { verify_cmd: '   ' }), /command_proof: verify_cmd is empty/);
  });

  test('rejects missing fields, naming each one', () => {
    for (const field of RECEIPT_FIELDS) {
      const result = gate(makeRepo(), { [field]: undefined });
      rejects(result, new RegExp(`schema_completeness: missing field "${field}"`));
      assert.equal(result.checks.schema_completeness, 'fail');
      assert.equal(result.checks.git_boundary, 'skipped');
    }
  });

  test('rejects wrongly typed or unknown fields', () => {
    const f = makeRepo();
    rejects(gate(f, { confidence: 'very high' }), /unknown field "confidence"/);
    rejects(gate(f, { verify_exit_code: '0' }), /verify_exit_code must be an integer/);
    rejects(gate(f, { checks_passed: ['mechanical', 'vibes'] }), /checks_passed must be a list drawn from/);
    rejects(gate(f, { checks_passed: ['mechanical', 'mechanical'] }), /without repeats/);
    rejects(gate(f, { audit_blockers: -1, audit_majors: 0 }), /audit_blockers must be an integer >= 0/);
    rejects(gate(f, { audit_blockers: 0, audit_majors: null }), /must both be null \(no audit yet\) or both be counts/);
    rejects(gate(f, { files_touched: [] }), /files_touched must be a non-empty list/);
    rejects(gate(f, { files_touched: ['../outside.js'] }), /repo-relative paths/);
    rejects(gate(f, { files_touched: ['/etc/passwd'] }), /repo-relative paths/);
    rejects(gate(f, { slice: 'two\nlines' }), /slice must be a non-empty one-line string/);
    rejects(gate(f, { assumptions: 'none' }), /assumptions must be a list of strings/);
    rejects(gate(f, { review_hotspot: [] }), /review_hotspot must list 1 or 2/);
    rejects(gate(f, { review_hotspot: ['src/a.js'] }), /review_hotspot must list 1 or 2 "file:line" anchors/);
    rejects(gate(f, { review_hotspot: ['README.md:1'] }), /does not point into files_touched/);
    rejects(gate(f, { base_sha: 12345678 }), /base_sha must be a double-quoted commit SHA/);
    rejects(gate(f, { head_sha: '--output=/tmp/x' }), /head_sha must be a double-quoted commit SHA/);
  });

  test('rejects commits that do not exist, are equal, reversed, or off the checked-out branch', () => {
    const f = makeRepo();
    rejects(gate(f, { head_sha: 'f'.repeat(40) }), /head_sha f{40} is not a commit in this repository/);
    rejects(gate(f, { base_sha: f.head }), /the receipt covers no work/);
    rejects(gate(f, { base_sha: f.head, head_sha: f.base }), /base_sha is not an ancestor of head_sha/);

    git(f.repo, 'checkout', '-q', '-b', 'side', f.base);
    write(f.repo, 'side.txt', 'side\n');
    git(f.repo, 'add', '-A');
    git(f.repo, 'commit', '-q', '-m', 'side work');
    rejects(gate(f), /head_sha [0-9a-f]{12} is not contained in the checked-out branch/);
  });

  test('rejects when --repo is not a git work tree', () => {
    const f = makeRepo();
    const notRepo = path.join(SANDBOX, 'plain-dir');
    fs.mkdirSync(notRepo, { recursive: true });
    rejects(evaluateReceipt({ receiptText: JSON.stringify(receipt(f.base, f.head)), repo: notRepo }), /is not a git work tree/);
  });

  test('rejects unparseable or empty receipts without throwing', () => {
    const f = makeRepo();
    rejects(evaluateReceipt({ receiptText: '', repo: f.repo }), /receipt is empty/);
    rejects(evaluateReceipt({ receiptText: '{"slice": ', repo: f.repo }), /not valid JSON/);
    rejects(evaluateReceipt({ receiptText: 'slice: [a, b]', repo: f.repo }), /not valid strict YAML/);
    rejects(evaluateReceipt({ receiptText: '- just\n- a list', repo: f.repo }), /must be a mapping of fields/);
  });

  test('reports every failure at once', () => {
    const f = makeRepo();
    write(f.repo, 'scratch.txt', 'x\n');
    const result = gate(f, { verify_exit_code: 2, files_touched: ['src/a.js'], review_hotspot: ['src/a.js:1'] }, ['docs/**']);
    assert.equal(result.status, 'REJECTED');
    assert.ok(result.reasons.length >= 4, result.reasons.join('\n'));
  });
});

describe('independence from the machine git configuration', () => {
  // A hostile or merely unusual ~/.gitconfig must not be able to hide a changed or untracked file.
  const gitconfig = path.join(SANDBOX, 'hostile.gitconfig');
  fs.writeFileSync(gitconfig, '[diff]\n\trelative = true\n\tignoreSubmodules = all\n[status]\n\tshowUntrackedFiles = no\n');
  const hostile = (args, input) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', input, env: { ...process.env, GIT_CONFIG_GLOBAL: gitconfig } });

  /** One commit that changes sub/a.js and, outside that directory, auth.js. */
  function twoAreaRepo() {
    counter += 1;
    const repo = path.join(SANDBOX, `repo-${counter}`);
    fs.mkdirSync(repo);
    git(repo, 'init', '-q', '-b', 'main');
    write(repo, 'sub/a.js', '1\n');
    write(repo, 'auth.js', 'safe\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'base');
    const base = git(repo, 'rev-parse', 'HEAD');
    write(repo, 'sub/a.js', '2\n');
    write(repo, 'auth.js', 'BACKDOOR\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'slice');
    return { repo, base, head: git(repo, 'rev-parse', 'HEAD') };
  }

  test('status.showUntrackedFiles=no cannot hide an untracked file', () => {
    const f = makeRepo();
    write(f.repo, 'secret.txt', 'left behind\n');
    const res = hostile(['--receipt', '-', '--repo', f.repo], JSON.stringify(receipt(f.base, f.head)));
    assert.equal(res.status, 1, res.stdout);
    assert.match(JSON.parse(res.stdout).reasons.join('\n'), /working tree is not clean/);
  });

  test('diff.relative and a --repo inside a subdirectory cannot hide files changed elsewhere', () => {
    const f = twoAreaRepo();
    const subdirOnly = receipt(f.base, f.head, { files_touched: ['a.js'], review_hotspot: ['a.js:1'] });
    const hidden = hostile(['--receipt', '-', '--repo', path.join(f.repo, 'sub'), '--allowed-paths', 'a.js'], JSON.stringify(subdirOnly));
    assert.equal(hidden.status, 1, hidden.stdout);
    const reasons = JSON.parse(hidden.stdout).reasons.join('\n');
    assert.match(reasons, /changed but not listed in files_touched: auth\.js/);
    assert.match(reasons, /changed but not listed in files_touched: sub\/a\.js/);

    const honest = receipt(f.base, f.head, { files_touched: ['auth.js', 'sub/a.js'], review_hotspot: ['auth.js:1'] });
    const admitted = hostile(['--receipt', '-', '--repo', path.join(f.repo, 'sub')], JSON.stringify(honest));
    assert.equal(admitted.status, 0, admitted.stdout);
    assert.deepEqual(JSON.parse(admitted.stdout).files_touched, ['auth.js', 'sub/a.js'], 'paths are always relative to the repository root');
    const bounded = hostile(['--receipt', '-', '--repo', path.join(f.repo, 'sub'), '--allowed-paths', 'sub/**'], JSON.stringify(honest));
    assert.equal(bounded.status, 1);
    assert.match(JSON.parse(bounded.stdout).reasons.join('\n'), /outside --allowed-paths: auth\.js/);
  });
});

describe('receipt formats and CLI', () => {
  test('parses bare YAML, fenced YAML inside prose, and JSON alike', () => {
    const data = receipt('a'.repeat(40), 'b'.repeat(40), { assumptions: ['Rows stay local.'] });
    const yaml = toYaml(data);
    assert.deepEqual(parseReceipt(yaml), data);
    assert.deepEqual(parseReceipt(`Finished the slice.\n\n\`\`\`yaml\n${yaml}\`\`\`\n\nThanks.`), data);
    assert.deepEqual(parseReceipt(`\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``), data);
    assert.deepEqual(schemaErrors(data), []);
  });

  test('an unquoted all-digit SHA is rejected with a hint to quote it', () => {
    const data = receipt('a'.repeat(40), 'b'.repeat(40));
    const yaml = toYaml(data).replace(`"${'a'.repeat(40)}"`, '1234567');
    assert.match(schemaErrors(parseReceipt(yaml)).join('\n'), /base_sha must be a double-quoted commit SHA/);
  });

  test('parseAllowedPaths rejects an empty or invalid list', () => {
    assert.deepEqual(parseAllowedPaths('src/**, tests/*.js'), ['src/**', 'tests/*.js']);
    assert.throws(() => parseAllowedPaths(' , '), /at least one glob/);
    assert.throws(() => parseAllowedPaths('/abs/**'), /invalid glob/);
  });

  test('CLI prints JSON and exits 0 on ADMITTED, from a file and from stdin', () => {
    const f = makeRepo();
    const yaml = toYaml(receipt(f.base, f.head));
    const file = path.join(SANDBOX, 'receipt-ok.yaml');
    fs.writeFileSync(file, yaml);

    const fromFile = cli(['--receipt', file, '--repo', f.repo, '--allowed-paths', 'src/**,tests/**']);
    assert.equal(fromFile.status, 0, fromFile.stdout + fromFile.stderr);
    assert.equal(JSON.parse(fromFile.stdout).status, 'ADMITTED');
    assert.equal(JSON.parse(fromFile.stdout).assurance, 'A1');

    const fromStdin = cli(['--receipt=-', `--repo=${f.repo}`], `Done.\n\n\`\`\`yaml\n${yaml}\`\`\`\n`);
    assert.equal(fromStdin.status, 0, fromStdin.stdout + fromStdin.stderr);
    assert.equal(JSON.parse(fromStdin.stdout).status, 'ADMITTED');
  });

  test('CLI exits 1 on REJECTED with exact reasons, and on usage errors', () => {
    const f = makeRepo();
    const rejected = cli(['--receipt', '-', '--repo', f.repo, '--allowed-paths', 'docs/**'], toYaml(receipt(f.base, f.head, { verify_exit_code: 3 })));
    assert.equal(rejected.status, 1);
    const out = JSON.parse(rejected.stdout);
    assert.equal(out.status, 'REJECTED');
    assert.ok(out.reasons.includes('command_proof: verify_exit_code is 3, not 0'));
    assert.ok(out.reasons.includes('git_boundary: outside --allowed-paths: src/a.js'));

    for (const args of [[], ['--receipt', path.join(SANDBOX, 'missing.yaml')], ['--receipt', '-', '--allowed-paths', ''], ['--bogus']]) {
      const res = cli(args, '');
      assert.equal(res.status, 1, args.join(' '));
      assert.equal(JSON.parse(res.stdout).status, 'REJECTED');
    }
    assert.equal(cli(['--help']).status, 0);
  });
});
