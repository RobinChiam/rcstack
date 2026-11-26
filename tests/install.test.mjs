// Hermetic tests for adapters/install.sh, adapters/build-release.sh, and adapters/release-install.sh.
// Every home directory, temp dir, and git repo is a fresh one under os.tmpdir(); the real
// ~/.rcstack, real harness directories, and network are never read or written.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'rcstack-install-'));
const SKILLS = ['rc-router', 'rc-setup', 'rc-init', 'rc-doctor', 'rc-retro'];
const HARNESSES = ['.agents', '.claude', '.codex', '.gemini', '.cursor'];
const MAIN_PROFILE = 'rcstack-main.yaml';
const LEGACY_PROFILES = ['rcstack-engineering.yaml', 'rcstack-study.yaml', 'rcstack-research.yaml'];
const VERSION = '0.2.1';
const TAG = `v${VERSION}`;

/** dist is installed read-only, so make everything writable again before deleting. */
function forceRemove(dir) {
  const walk = (p) => {
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink() || !st.isDirectory()) return;
    fs.chmodSync(p, 0o755);
    for (const name of fs.readdirSync(p)) walk(path.join(p, name));
  };
  if (fs.existsSync(dir)) walk(dir);
  fs.rmSync(dir, { recursive: true, force: true });
}
after(() => forceRemove(SANDBOX));

let counter = 0;
function freshDir(prefix) {
  counter += 1;
  const dir = path.join(SANDBOX, `${prefix}-${counter}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function freshHome() {
  return freshDir('home');
}

function gitEnv(extra = {}) {
  return {
    ...process.env,
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'rcstack-test',
    GIT_AUTHOR_EMAIL: 'test@example.invalid',
    GIT_COMMITTER_NAME: 'rcstack-test',
    GIT_COMMITTER_EMAIL: 'test@example.invalid',
    ...extra,
  };
}

/** Run an installer. HOME is always the sandbox home too, so a bug cannot reach the real one. */
function install(home, args = [], { script = path.join(ROOT, 'adapters/install.sh'), env = {} } = {}) {
  const res = spawnSync('bash', [script, '--home', home, ...args], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1', ...env },
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, out: `${res.stdout}\n${res.stderr}` };
}

/** Every entry under dir with its type (and link target), for before/after comparison. */
function snapshot(dir) {
  const out = [];
  const walk = (p, rel) => {
    for (const name of fs.readdirSync(p).sort()) {
      const full = path.join(p, name);
      const st = fs.lstatSync(full);
      const r = rel ? `${rel}/${name}` : name;
      if (st.isSymbolicLink()) out.push(`${r} -> ${fs.readlinkSync(full)}`);
      else if (st.isDirectory()) {
        out.push(`${r}/`);
        walk(full, r);
      } else out.push(`${r} [${st.size}]`);
    }
  };
  walk(dir, '');
  return out;
}

function copyTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    if (ent.name === '.git' || ent.name === 'node_modules') continue;
    const from = path.join(src, ent.name);
    const to = path.join(dest, ent.name);
    if (ent.isDirectory()) copyTree(from, to);
    else if (ent.isFile()) {
      fs.copyFileSync(from, to);
      fs.chmodSync(to, fs.statSync(from).mode);
    }
  }
}

/** A private copy of the source checkout, for tests that must break or tag the source. */
function copySource() {
  counter += 1;
  const dir = path.join(SANDBOX, `source-${counter}`);
  copyTree(ROOT, dir);
  return dir;
}

/** Create a clean committed git repo from the current checkout and tag it. */
function createTaggedRepo(tag = TAG, mutate = null) {
  const repo = copySource();
  if (mutate) mutate(repo);
  const env = gitEnv();
  const runGit = (args) => {
    const res = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', env });
    assert.equal(res.status, 0, `git ${args.join(' ')} failed: ${res.stdout}\n${res.stderr}`);
    return res.stdout.trim();
  };
  runGit(['init', '-q', '-b', 'main']);
  runGit(['add', '-A']);
  runGit(['commit', '-q', '-m', `release ${tag}`]);
  if (tag) runGit(['tag', '-a', tag, '-m', `Release ${tag}`]);
  const commit = runGit(['rev-parse', 'HEAD']);
  return { repo, commit };
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

/** Create a directory containing a mock curl executable that serves a local file or fails. */
function createMockCurl({ expectedUrl, serveFile = null, exitCode = 0, logFile = null } = {}) {
  const binDir = freshDir('mock-bin');
  const mockPath = path.join(binDir, 'curl');
  const lines = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    logFile ? `printf '%s\\n' "$*" >> ${JSON.stringify(logFile)}` : ':',
    'out=""',
    'url=""',
    'proto=""',
    'proto_redir=""',
    'while [ "$#" -gt 0 ]; do',
    '  case "$1" in',
    '    -o|--output) out="$2"; shift ;;',
    '    --proto) proto="$2"; shift ;;',
    '    --proto-redir) proto_redir="$2"; shift ;;',
    '    --fail|--silent|--show-error|--location|--tlsv1.2|-f|-s|-S|-L) ;;',
    '    http://*|https://*) url="$1" ;;',
    '  esac',
    '  shift',
    'done',
    'if [ "$proto" != "=https" ] || [ "$proto_redir" != "=https" ]; then',
    '  printf "mock-curl: missing strict HTTPS flags (proto=%s proto-redir=%s)\\n" "$proto" "$proto_redir" >&2',
    '  exit 22',
    'fi',
  ];
  if (expectedUrl) {
    lines.push(
      `if [ "$url" != ${JSON.stringify(expectedUrl)} ]; then`,
      `  printf 'mock-curl: unexpected URL: %s\\n' "$url" >&2`,
      '  exit 22',
      'fi',
    );
  }
  if (exitCode !== 0) {
    lines.push(`printf 'mock-curl: simulated download failure\\n' >&2`, `exit ${exitCode}`);
  } else if (serveFile) {
    lines.push(`cp ${JSON.stringify(serveFile)} "$out"`);
  }
  fs.writeFileSync(mockPath, `${lines.join('\n')}\n`, { mode: 0o755 });
  return binDir;
}

function assertLinks(home, rcHome = path.join(home, '.rcstack')) {
  for (const harness of HARNESSES) {
    assert.deepEqual(fs.readdirSync(path.join(home, harness, 'skills')).sort(), [...SKILLS].sort(), `${harness} holds exactly the 5 skills`);
    for (const skill of SKILLS) {
      const link = path.join(home, harness, 'skills', skill);
      assert.ok(fs.lstatSync(link).isSymbolicLink(), `${link} is a symlink`);
      const target = fs.readlinkSync(link);
      assert.equal(target, path.join(rcHome, 'dist', 'skills', skill));
      assert.equal(target.startsWith(ROOT + path.sep), false, 'links never point into the source checkout');
      assert.ok(fs.existsSync(path.join(link, 'SKILL.md')), `${link} resolves to an installed skill`);
    }
  }
}

describe('--dry-run', () => {
  test('performs zero writes and prints the full plan', () => {
    const home = freshHome();
    fs.mkdirSync(path.join(home, '.claude', 'skills', 'unrelated'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude', 'skills', 'unrelated', 'SKILL.md'), 'mine\n');
    const before = snapshot(home);

    const res = install(home, ['--dry-run']);
    assert.equal(res.status, 0, res.out);
    assert.deepEqual(snapshot(home), before, 'the home directory is byte-for-byte untouched');
    assert.equal(fs.existsSync(path.join(home, '.rcstack')), false);

    assert.match(res.stdout, /mode:\s+DRY RUN: nothing will be created, changed, or deleted/);
    assert.match(res.stdout, /\[dry-run\] would atomically swap staging into .*\/\.rcstack\/dist/);
    assert.equal((res.stdout.match(/\[dry-run\] would link /g) ?? []).length, 25);
    assert.equal((res.stdout.match(/\[dry-run\] would seed /g) ?? []).length, 1);
    assert.match(res.stdout, /\[dry-run\] would seed .*\/profiles\/rcstack-main\.yaml/);
    assert.match(res.stdout, /\[dry-run\] would initialize the local-only shadow git repository/);
    assert.match(res.stdout, /dry run complete: 25 link\(s\) planned, 0 collisions, nothing changed/);
    assert.doesNotMatch(res.stdout, new RegExp(`-> ${ROOT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/skills`), 'no link targets the source');
  });

  test('reports what a re-install would keep', () => {
    const home = freshHome();
    assert.equal(install(home).status, 0);
    const before = snapshot(home);
    const res = install(home, ['--dry-run']);
    assert.equal(res.status, 0, res.out);
    assert.deepEqual(snapshot(home), before);
    assert.equal((res.stdout.match(/\[dry-run\] would keep .*skills\/rc-/g) ?? []).length, 25);
    assert.equal((res.stdout.match(/\[dry-run\] would keep .*profiles\/rcstack-main\.yaml.*never overwritten/g) ?? []).length, 1);
    assert.equal((res.stdout.match(/\[dry-run\] would seed /g) ?? []).length, 0);
  });

  test('fails on a collision without changing anything', () => {
    const home = freshHome();
    fs.mkdirSync(path.join(home, '.cursor', 'skills', 'rc-retro'), { recursive: true });
    const before = snapshot(home);
    const res = install(home, ['--dry-run']);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /COLLISION: .*\.cursor\/skills\/rc-retro exists and is not a symbolic link/);
    assert.deepEqual(snapshot(home), before);
  });
});

describe('--from-local promote', () => {
  test('promotes into dist, seeds rcstack-main.yaml only, initializes runtime, and links only to dist', () => {
    const home = freshHome();
    const rc = path.join(home, '.rcstack');
    const res = install(home, ['--from-local']);
    assert.equal(res.status, 0, res.out);
    assert.match(res.stdout, /install: OK: rcstack-beta 0\.2\.1 promoted to .*\/\.rcstack\/dist; 25 harness link\(s\) point there/);

    assert.deepEqual(fs.readdirSync(rc).sort(), ['dist', 'install-meta.json', 'profiles', 'runtime']);
    assert.ok(fs.existsSync(path.join(ROOT, 'specs', 'feature-local-specs', 'spec.md')), 'the source has feature-local specs');
    assert.deepEqual(fs.readdirSync(path.join(rc, 'dist')).sort(), ['contracts', 'defaults', 'rules', 'scripts', 'skills'], 'specs/, docs/ and tests/ are source-only');
    assert.deepEqual(fs.readdirSync(path.join(rc, 'dist', 'skills')).sort(), [...SKILLS].sort());
    assert.deepEqual(fs.readdirSync(path.join(rc, 'dist', 'defaults', 'profiles')).sort(), [MAIN_PROFILE, 'schema.json'].sort());
    assert.equal(fs.readdirSync(path.join(rc, 'dist', 'skills', 'rc-router', 'playbooks', 'engineering')).length, 8);
    for (const rel of ['rules/study.md', 'contracts/work-receipt.md', 'scripts/rc-state.mjs', 'skills/rc-router/SKILL.md', 'skills/rc-router/playbooks/engineering/project-planning.md']) {
      assert.equal(fs.readFileSync(path.join(rc, 'dist', rel), 'utf8'), fs.readFileSync(path.join(ROOT, rel), 'utf8'), rel);
    }

    const meta = JSON.parse(fs.readFileSync(path.join(rc, 'install-meta.json'), 'utf8'));
    assert.deepEqual(Object.keys(meta), ['version', 'commit_sha', 'source', 'dirty', 'installed_at']);
    assert.equal(meta.version, VERSION);
    assert.equal(meta.source, 'local');
    assert.match(meta.commit_sha, /^(?:[0-9a-f]{40}|unknown)$/);
    assert.equal(typeof meta.dirty, 'boolean');
    assert.match(meta.installed_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);

    assert.deepEqual(fs.readdirSync(path.join(rc, 'profiles')), [MAIN_PROFILE], 'fresh install seeds rcstack-main.yaml only');
    assert.equal(
      fs.readFileSync(path.join(rc, 'profiles', MAIN_PROFILE), 'utf8'),
      fs.readFileSync(path.join(ROOT, 'profiles', MAIN_PROFILE), 'utf8'),
    );
    assert.notEqual(fs.statSync(path.join(rc, 'profiles', MAIN_PROFILE)).mode & 0o200, 0, 'seeded profile is editable');

    assert.ok(fs.statSync(path.join(rc, 'runtime', '.git')).isDirectory(), 'runtime is a git repository');
    assert.ok(fs.statSync(path.join(rc, 'runtime', 'state')).isDirectory());
    const remotes = spawnSync('git', ['-C', path.join(rc, 'runtime'), 'remote'], { encoding: 'utf8' });
    assert.equal(remotes.stdout.trim(), '', 'the shadow repository has no remote');

    assertLinks(home);
    assert.deepEqual(fs.readdirSync(rc).filter((n) => n.startsWith('.')), [], 'no staging directory or lock is left behind');
  });

  test('installs dist read-only', () => {
    const home = freshHome();
    assert.equal(install(home).status, 0);
    const dist = path.join(home, '.rcstack', 'dist');
    for (const rel of ['', 'skills', 'skills/rc-router/SKILL.md', 'scripts/verify.mjs', 'defaults/profiles/schema.json', 'defaults/profiles/rcstack-main.yaml']) {
      assert.equal(fs.statSync(path.join(dist, rel)).mode & 0o222, 0, `dist/${rel} is not writable`);
    }
  });

  test('installed scripts run from dist against the installed layout', () => {
    const home = freshHome();
    assert.equal(install(home).status, 0);
    const rc = path.join(home, '.rcstack');
    const env = { ...process.env, HOME: home };
    const profile = spawnSync(process.execPath, [path.join(rc, 'dist/scripts/verify.mjs'), '--profile', path.join(rc, 'profiles/rcstack-main.yaml')], { encoding: 'utf8', env });
    assert.equal(profile.status, 0, profile.stdout + profile.stderr);
    const log = spawnSync(process.execPath, [path.join(rc, 'dist/scripts/rc-log.mjs'), '--dry-run', '--json', '{}'], { encoding: 'utf8', env });
    assert.equal(log.status, 1);
    assert.ok(JSON.parse(log.stdout).errors.includes('$: missing required property "schema_version"'), 'rc-log found its schema inside dist');

    // The specs check is meant to be run from dist against any repository.
    const installedVerify = path.join(rc, 'dist/scripts/verify.mjs');
    const good = spawnSync(process.execPath, [installedVerify, '--specs', path.join(ROOT, 'specs')], { encoding: 'utf8', env });
    assert.equal(good.status, 0, good.stdout + good.stderr);
    const target = path.join(home, 'some-project', 'specs');
    fs.mkdirSync(path.join(target, 'checkout', 'coupons'), { recursive: true });
    fs.writeFileSync(path.join(target, 'checkout', 'coupons', 'spec.md'), '# Spec: coupons\n');
    const bad = spawnSync(process.execPath, [installedVerify, '--specs', target], { encoding: 'utf8', env });
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /specs\/checkout\/ has no spec\.md/);
    fs.writeFileSync(path.join(target, 'checkout', 'spec.md'), '# Spec: checkout\n');
    assert.equal(spawnSync(process.execPath, [installedVerify, '--specs', target], { encoding: 'utf8', env }).status, 0);
  });

  test('honours --rcstack-home', () => {
    const home = freshHome();
    const rc = path.join(home, 'custom', 'rc-home');
    const res = install(home, [`--rcstack-home=${rc}`]);
    assert.equal(res.status, 0, res.out);
    assert.ok(fs.existsSync(path.join(rc, 'dist', 'skills', 'rc-init', 'SKILL.md')));
    assert.equal(fs.existsSync(path.join(home, '.rcstack')), false);
    assertLinks(home, rc);
  });
});

describe('upgrades and idempotency', () => {
  for (const [label, env] of [['atomic exchange', {}], ['portable two-rename swap', { RCSTACK_INSTALL_NO_EXCHANGE: '1' }]]) {
    test(`re-running replaces dist and preserves user profile edits (${label})`, () => {
      const home = freshHome();
      const rc = path.join(home, '.rcstack');
      assert.equal(install(home, [], { env }).status, 0);

      const profile = path.join(rc, 'profiles', MAIN_PROFILE);
      const edited = `${fs.readFileSync(profile, 'utf8')}\n# my machine-local routing tweak\n`;
      fs.writeFileSync(profile, edited);
      const stateFile = path.join(rc, 'runtime', 'state', 'keep.md');
      fs.writeFileSync(stateFile, 'runtime data survives\n');
      const distBefore = fs.statSync(path.join(rc, 'dist')).ino;
      const gitBefore = fs.statSync(path.join(rc, 'runtime', '.git')).ino;

      const res = install(home, [], { env });
      assert.equal(res.status, 0, res.out);
      assert.equal(fs.readFileSync(profile, 'utf8'), edited, 'an edited profile is never overwritten');
      assert.match(res.stdout, /-> keep .*rcstack-main\.yaml \(machine-local profiles are never overwritten\)/);
      assert.equal(fs.readFileSync(stateFile, 'utf8'), 'runtime data survives\n');
      assert.equal(fs.statSync(path.join(rc, 'runtime', '.git')).ino, gitBefore, 'the shadow repository is not re-initialized');
      assert.notEqual(fs.statSync(path.join(rc, 'dist')).ino, distBefore, 'dist is a freshly staged tree');
      assert.equal((res.stdout.match(/-> keep .*skills\/rc-/g) ?? []).length, 25);
      assertLinks(home);
      assert.deepEqual(fs.readdirSync(rc).sort(), ['dist', 'install-meta.json', 'profiles', 'runtime'], 'no leftovers after the swap');
    });
  }

  test('re-seeds rcstack-main.yaml when all profiles are removed', () => {
    const home = freshHome();
    const rc = path.join(home, '.rcstack');
    assert.equal(install(home).status, 0);
    fs.rmSync(path.join(rc, 'profiles', MAIN_PROFILE));

    const res = install(home);
    assert.equal(res.status, 0, res.out);
    assert.match(res.stdout, /-> seed .*profiles\/rcstack-main\.yaml/);
    assert.deepEqual(fs.readdirSync(path.join(rc, 'profiles')), [MAIN_PROFILE]);
  });

  test('upgrade with all legacy profiles preserves them and skips seeding rcstack-main.yaml', () => {
    const home = freshHome();
    const rc = path.join(home, '.rcstack');
    const profilesDir = path.join(rc, 'profiles');
    fs.mkdirSync(profilesDir, { recursive: true });
    const legacyContents = {};
    for (const file of LEGACY_PROFILES) {
      legacyContents[file] = `# custom legacy ${file}\n`;
      fs.writeFileSync(path.join(profilesDir, file), legacyContents[file]);
    }

    const beforeDry = snapshot(home);
    const dry = install(home, ['--dry-run']);
    assert.equal(dry.status, 0, dry.out);
    assert.deepEqual(snapshot(home), beforeDry, 'upgrade dry-run mutates nothing');
    assert.equal((dry.stdout.match(/\[dry-run\] would keep .*profiles\/rcstack-(?:engineering|study|research)\.yaml/g) ?? []).length, 3);
    assert.match(dry.stdout, /\[dry-run\] would skip seeding .*profiles\/rcstack-main\.yaml/);
    assert.equal((dry.stdout.match(/\[dry-run\] would seed /g) ?? []).length, 0);

    const res = install(home);
    assert.equal(res.status, 0, res.out);
    assert.match(res.stdout, /-> skip seeding .*profiles\/rcstack-main\.yaml/);
    assert.deepEqual(fs.readdirSync(profilesDir).sort(), [...LEGACY_PROFILES].sort(), 'rcstack-main.yaml is not seeded when legacy profiles exist');
    for (const file of LEGACY_PROFILES) {
      assert.equal(fs.readFileSync(path.join(profilesDir, file), 'utf8'), legacyContents[file], `${file} is preserved`);
    }
    assertLinks(home);
  });

  test('upgrade with a single legacy profile preserves it and skips seeding rcstack-main.yaml', () => {
    const home = freshHome();
    const rc = path.join(home, '.rcstack');
    const profilesDir = path.join(rc, 'profiles');
    fs.mkdirSync(profilesDir, { recursive: true });
    const legacyFile = path.join(profilesDir, 'rcstack-study.yaml');
    fs.writeFileSync(legacyFile, '# custom study override\n');

    const res = install(home);
    assert.equal(res.status, 0, res.out);
    assert.deepEqual(fs.readdirSync(profilesDir), ['rcstack-study.yaml']);
    assert.equal(fs.readFileSync(legacyFile, 'utf8'), '# custom study override\n');
    assert.match(res.stdout, /-> keep .*profiles\/rcstack-study\.yaml/);
    assert.match(res.stdout, /-> skip seeding .*profiles\/rcstack-main\.yaml/);
  });

  test('upgrade preserves both rcstack-main.yaml and legacy profiles when both already exist', () => {
    const home = freshHome();
    const rc = path.join(home, '.rcstack');
    const profilesDir = path.join(rc, 'profiles');
    fs.mkdirSync(profilesDir, { recursive: true });
    fs.writeFileSync(path.join(profilesDir, MAIN_PROFILE), '# custom consolidated\n');
    fs.writeFileSync(path.join(profilesDir, 'rcstack-engineering.yaml'), '# custom legacy engineering\n');

    const res = install(home);
    assert.equal(res.status, 0, res.out);
    assert.deepEqual(fs.readdirSync(profilesDir).sort(), ['rcstack-engineering.yaml', MAIN_PROFILE].sort());
    assert.equal(fs.readFileSync(path.join(profilesDir, MAIN_PROFILE), 'utf8'), '# custom consolidated\n');
    assert.equal(fs.readFileSync(path.join(profilesDir, 'rcstack-engineering.yaml'), 'utf8'), '# custom legacy engineering\n');
    assert.match(res.stdout, /-> keep .*profiles\/rcstack-main\.yaml/);
    assert.match(res.stdout, /-> keep .*profiles\/rcstack-engineering\.yaml/);
    assert.doesNotMatch(res.stdout, /skip seeding/);
  });

  test('repoints a stale symlink, including one into the source checkout', () => {
    const home = freshHome();
    const skillsDir = path.join(home, '.codex', 'skills');
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.symlinkSync(path.join(ROOT, 'skills', 'rc-init'), path.join(skillsDir, 'rc-init'));
    fs.symlinkSync(path.join(home, 'nowhere'), path.join(skillsDir, 'rc-doctor'));
    const res = install(home);
    assert.equal(res.status, 0, res.out);
    assert.match(res.stdout, /-> repoint .*\.codex\/skills\/rc-init -> .*\/dist\/skills\/rc-init \(was -> /);
    assertLinks(home);
  });

  test('leaves unrelated skills in harness directories alone', () => {
    const home = freshHome();
    const mine = path.join(home, '.claude', 'skills', 'my-skill');
    fs.mkdirSync(mine, { recursive: true });
    fs.writeFileSync(path.join(mine, 'SKILL.md'), 'mine\n');
    assert.equal(install(home).status, 0);
    assert.equal(fs.readFileSync(path.join(mine, 'SKILL.md'), 'utf8'), 'mine\n');
    assert.deepEqual(fs.readdirSync(path.join(home, '.claude', 'skills')).sort(), ['my-skill', ...SKILLS].sort());
  });
});

describe('release packaging and standalone installer', () => {
  test('build-release.sh produces reproducible verified assets and installs cleanly with mock download', () => {
    const { repo, commit } = createTaggedRepo(TAG);
    const out1 = freshDir('release-out-1');
    const out2 = freshDir('release-out-2');
    const builder = path.join(ROOT, 'adapters/build-release.sh');

    const build1 = spawnSync('bash', [builder, '--tag', TAG, '--out-dir', out1, '--source-repo', repo], {
      encoding: 'utf8',
      env: gitEnv(),
    });
    assert.equal(build1.status, 0, `${build1.stdout}\n${build1.stderr}`);
    assert.deepEqual(fs.readdirSync(out1).sort(), ['install.sh', `rcstack-${VERSION}.tar.gz`]);

    const archive1 = path.join(out1, `rcstack-${VERSION}.tar.gz`);
    const script1 = path.join(out1, 'install.sh');
    const digest1 = sha256File(archive1);
    const expectedUrl = `https://github.com/RobinChiam/rcstack/releases/download/${TAG}/rcstack-${VERSION}.tar.gz`;
    assert.notEqual(fs.statSync(script1).mode & 0o111, 0, 'generated install.sh is executable');

    const scriptText = fs.readFileSync(script1, 'utf8');
    assert.ok(scriptText.includes(`RELEASE_VERSION="${VERSION}"`), 'embeds version');
    assert.ok(scriptText.includes(`RELEASE_TAG="${TAG}"`), 'embeds tag');
    assert.ok(scriptText.includes(`RELEASE_COMMIT="${commit}"`), 'embeds tagged commit');
    assert.ok(scriptText.includes(`ARCHIVE_URL="${expectedUrl}"`), 'embeds pinned RobinChiam/rcstack release URL');
    assert.ok(scriptText.includes(`ARCHIVE_SHA256="${digest1}"`), 'embeds archive SHA-256');
    assert.equal(scriptText.includes('__RCSTACK_'), false, 'no unrendered template placeholders remain');

    // Second build into a separate directory must be byte-for-byte reproducible.
    const build2 = spawnSync('bash', [builder, '--tag', TAG, '--out-dir', out2, '--source-repo', repo], {
      encoding: 'utf8',
      env: gitEnv(),
    });
    assert.equal(build2.status, 0, `${build2.stdout}\n${build2.stderr}`);
    assert.equal(sha256File(path.join(out2, `rcstack-${VERSION}.tar.gz`)), digest1, 'tarball is reproducible');
    assert.equal(fs.readFileSync(path.join(out2, 'install.sh'), 'utf8'), scriptText, 'generated install.sh is reproducible');

    // Read-only --dry-run on generated install.sh: zero temp writes, zero network calls, accurate plan.
    const dryHome = freshHome();
    const dryTmp = freshDir('dry-tmp');
    const curlLog = path.join(SANDBOX, 'dry-curl-log.txt');
    const failingCurlBin = createMockCurl({ expectedUrl, exitCode: 99, logFile: curlLog });
    const dryRes = install(dryHome, ['--dry-run'], {
      script: script1,
      env: { TMPDIR: dryTmp, PATH: `${failingCurlBin}:${process.env.PATH}` },
    });
    assert.equal(dryRes.status, 0, dryRes.out);
    assert.deepEqual(snapshot(dryHome), [], 'release --dry-run touches nothing in home');
    assert.deepEqual(snapshot(dryTmp), [], 'release --dry-run writes no temp files');
    assert.equal(fs.existsSync(curlLog), false, 'release --dry-run never invokes curl');
    assert.match(dryRes.stdout, new RegExp(expectedUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(dryRes.stdout, new RegExp(digest1));
    assert.match(dryRes.stdout, new RegExp(commit));
    assert.doesNotMatch(dryRes.stdout, /0 collisions/, 'release --dry-run does not claim destination checks ran');

    // Real install using mock curl serving the verified archive.
    const home = freshHome();
    const runTmp = freshDir('run-tmp');
    const rc = path.join(home, '.rcstack');
    const mockBin = createMockCurl({ expectedUrl, serveFile: archive1 });
    const runRes = install(home, [], {
      script: script1,
      env: { TMPDIR: runTmp, PATH: `${mockBin}:${process.env.PATH}` },
    });
    assert.equal(runRes.status, 0, runRes.out);
    assert.match(runRes.stdout, /release-install: verified SHA-256/);
    assert.match(runRes.stdout, /install: OK: rcstack-beta 0\.2\.1 promoted to .*\/\.rcstack\/dist; 25 harness link\(s\) point there/);
    assert.deepEqual(snapshot(runTmp), [], 'private temp directory is cleaned up after release install');

    const meta = JSON.parse(fs.readFileSync(path.join(rc, 'install-meta.json'), 'utf8'));
    assert.deepEqual(Object.keys(meta), ['version', 'commit_sha', 'source', 'dirty', 'installed_at']);
    assert.equal(meta.version, VERSION);
    assert.equal(meta.commit_sha, commit);
    assert.equal(meta.source, 'release');
    assert.equal(meta.dirty, false);

    assert.deepEqual(fs.readdirSync(path.join(rc, 'profiles')), [MAIN_PROFILE]);
    assertLinks(home, rc);
  });

  test('corrupted release archive fails digest check and leaves destination completely untouched', () => {
    const { repo } = createTaggedRepo(TAG);
    const outDir = freshDir('release-corrupt-out');
    const builder = path.join(ROOT, 'adapters/build-release.sh');
    const build = spawnSync('bash', [builder, '--tag', TAG, '--out-dir', outDir, '--source-repo', repo], {
      encoding: 'utf8',
      env: gitEnv(),
    });
    assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);

    const archive = path.join(outDir, `rcstack-${VERSION}.tar.gz`);
    const script = path.join(outDir, 'install.sh');
    const expectedUrl = `https://github.com/RobinChiam/rcstack/releases/download/${TAG}/rcstack-${VERSION}.tar.gz`;

    // Tamper with one byte of the archive.
    const corruptArchive = path.join(outDir, 'corrupt.tar.gz');
    const buf = Buffer.from(fs.readFileSync(archive));
    buf[buf.length - 1] ^= 0xff;
    fs.writeFileSync(corruptArchive, buf);

    // Pre-populate a home with an existing custom file to prove existing state survives untouched.
    const home = freshHome();
    const existingProfile = path.join(home, '.rcstack', 'profiles', 'rcstack-engineering.yaml');
    fs.mkdirSync(path.dirname(existingProfile), { recursive: true });
    fs.writeFileSync(existingProfile, '# untouched user profile\n');
    const before = snapshot(home);

    const tmpDir = freshDir('corrupt-tmp');
    const mockBin = createMockCurl({ expectedUrl, serveFile: corruptArchive });
    const res = install(home, [], {
      script,
      env: { TMPDIR: tmpDir, PATH: `${mockBin}:${process.env.PATH}` },
    });
    assert.notEqual(res.status, 0, 'corrupted archive must fail');
    assert.match(res.stderr, /SHA-256 mismatch/);
    assert.match(res.stderr, /Nothing was changed/);
    assert.deepEqual(snapshot(home), before, 'destination home is byte-for-byte untouched');
    assert.equal(fs.readFileSync(existingProfile, 'utf8'), '# untouched user profile\n');
    assert.deepEqual(snapshot(tmpDir), [], 'temp directory is cleaned up after checksum failure');
  });

  test('failed release download leaves destination untouched and cleans up temp dir', () => {
    const { repo } = createTaggedRepo(TAG);
    const outDir = freshDir('release-fail-out');
    const builder = path.join(ROOT, 'adapters/build-release.sh');
    const build = spawnSync('bash', [builder, '--tag', TAG, '--out-dir', outDir, '--source-repo', repo], {
      encoding: 'utf8',
      env: gitEnv(),
    });
    assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);

    const script = path.join(outDir, 'install.sh');
    const expectedUrl = `https://github.com/RobinChiam/rcstack/releases/download/${TAG}/rcstack-${VERSION}.tar.gz`;
    const home = freshHome();
    const tmpDir = freshDir('fail-tmp');
    const mockBin = createMockCurl({ expectedUrl, exitCode: 22 });
    const res = install(home, [], {
      script,
      env: { TMPDIR: tmpDir, PATH: `${mockBin}:${process.env.PATH}` },
    });
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /failed to download/);
    assert.deepEqual(snapshot(home), []);
    assert.deepEqual(snapshot(tmpDir), []);
  });

  test('unrendered release-install.sh template refuses to run directly', () => {
    const home = freshHome();
    const template = path.join(ROOT, 'adapters/release-install.sh');
    for (const args of [['--dry-run'], []]) {
      const res = install(home, args, { script: template });
      assert.notEqual(res.status, 0);
      assert.match(res.stderr, /unrendered release installer template/);
      assert.deepEqual(snapshot(home), []);
    }
  });

  test('build-release.sh refuses missing tags, out-dir inside repo, and unverified commits', () => {
    const builder = path.join(ROOT, 'adapters/build-release.sh');
    const { repo } = createTaggedRepo(TAG);

    const missing = spawnSync('bash', [builder, '--tag', 'v9.9.9', '--out-dir', freshDir('out'), '--source-repo', repo], {
      encoding: 'utf8',
      env: gitEnv(),
    });
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /git tag not found/);

    const inside = spawnSync('bash', [builder, '--tag', TAG, '--out-dir', path.join(repo, 'release-out'), '--source-repo', repo], {
      encoding: 'utf8',
      env: gitEnv(),
    });
    assert.notEqual(inside.status, 0);
    assert.match(inside.stderr, /inside the source repository/);

    const broken = createTaggedRepo(TAG, (dir) => {
      const pb = path.join(dir, 'skills/rc-router/playbooks/study/socratic-session.md');
      fs.writeFileSync(pb, fs.readFileSync(pb, 'utf8').replace('entry_mode: router_only', 'entry_mode: standalone'));
    });
    const outBroken = freshDir('out-broken');
    const resBroken = spawnSync('bash', [builder, '--tag', TAG, '--out-dir', outBroken, '--source-repo', broken.repo], {
      encoding: 'utf8',
      env: gitEnv(),
    });
    assert.notEqual(resBroken.status, 0);
    assert.match(resBroken.stderr, /failed scripts\/verify\.mjs/);
    assert.deepEqual(snapshot(outBroken), [], 'no assets written when verification fails');
  });
});

describe('refusals', () => {
  test('refuses invalid --from-release and --release-commit combinations', () => {
    const home = freshHome();
    const sha = '0'.repeat(40);
    for (const [args, pattern] of [
      [['--from-release'], /--from-release requires --release-commit/],
      [['--release-commit', sha], /--release-commit requires --from-release/],
      [['--from-local', '--from-release', '--release-commit', sha], /cannot be combined/],
      [['--from-release', '--release-commit', 'not-a-sha'], /40-character lowercase hex SHA/],
    ]) {
      const res = install(home, args);
      assert.notEqual(res.status, 0, args.join(' '));
      assert.match(res.stderr, pattern, args.join(' '));
      assert.deepEqual(snapshot(home), []);
    }
  });

  test('refuses to overwrite a non-symlink directory, before changing anything', () => {
    const home = freshHome();
    const real = path.join(home, '.claude', 'skills', 'rc-router');
    fs.mkdirSync(real, { recursive: true });
    fs.writeFileSync(path.join(real, 'SKILL.md'), 'hand-written\n');
    const before = snapshot(home);
    const res = install(home);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /COLLISION: .*\.claude\/skills\/rc-router exists and is not a symbolic link/);
    assert.match(res.stderr, /refusing to overwrite 1 conflicting destination\(s\).*Nothing was changed/);
    assert.deepEqual(snapshot(home), before, 'no dist, no profiles, no links were created');
    assert.equal(fs.readFileSync(path.join(real, 'SKILL.md'), 'utf8'), 'hand-written\n');
  });

  test('refuses to overwrite a regular file, and reports every collision', () => {
    const home = freshHome();
    fs.mkdirSync(path.join(home, '.agents', 'skills'), { recursive: true });
    fs.writeFileSync(path.join(home, '.agents', 'skills', 'rc-setup'), 'a file\n');
    fs.writeFileSync(path.join(home, '.gemini'), 'not a directory\n');
    const before = snapshot(home);
    const res = install(home);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /COLLISION: .*\.agents\/skills\/rc-setup/);
    assert.match(res.stderr, /COLLISION: .*\.gemini exists and is not a directory/);
    assert.deepEqual(snapshot(home), before);
  });

  test('refuses a dist that is a symlink or a non-directory', () => {
    const home = freshHome();
    fs.mkdirSync(path.join(home, '.rcstack', 'elsewhere'), { recursive: true });
    fs.symlinkSync(path.join(home, '.rcstack', 'elsewhere'), path.join(home, '.rcstack', 'dist'));
    const before = snapshot(home);
    const res = install(home);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /dist is a symbolic link; refusing to replace it/);
    assert.deepEqual(snapshot(home), before);
  });

  test('treats a dangling symlink in a parent path as a collision, in dry-run and for real', () => {
    for (const [label, make] of [
      ['a dangling harness skills directory', (home) => {
        fs.mkdirSync(path.join(home, '.claude'));
        fs.symlinkSync(path.join(home, 'does-not-exist'), path.join(home, '.claude', 'skills'));
      }],
      ['a dangling harness directory', (home) => fs.symlinkSync(path.join(home, 'does-not-exist'), path.join(home, '.cursor'))],
      ['a dangling rcstack home', (home) => fs.symlinkSync(path.join(home, 'does-not-exist'), path.join(home, '.rcstack'))],
      ['a dangling profiles directory', (home) => {
        fs.mkdirSync(path.join(home, '.rcstack'));
        fs.symlinkSync(path.join(home, 'does-not-exist'), path.join(home, '.rcstack', 'profiles'));
      }],
      ['a file where runtime/state belongs', (home) => {
        fs.mkdirSync(path.join(home, '.rcstack', 'runtime'), { recursive: true });
        fs.writeFileSync(path.join(home, '.rcstack', 'runtime', 'state'), 'x\n');
      }],
    ]) {
      const home = freshHome();
      make(home);
      const before = snapshot(home);
      for (const args of [['--dry-run'], []]) {
        const res = install(home, args);
        assert.equal(res.status, 1, `${label} ${args.join(' ')}\n${res.out}`);
        assert.match(res.stderr, /COLLISION: .* exists and is not a directory/, label);
        assert.deepEqual(snapshot(home), before, `${label}: nothing changed`);
      }
    }
  });

  test('refuses a runtime/.git that is a symlink or a file, and never initializes through it', () => {
    const dangling = freshHome();
    fs.mkdirSync(path.join(dangling, '.rcstack', 'runtime'), { recursive: true });
    const outside = path.join(dangling, 'outside-target');
    fs.symlinkSync(outside, path.join(dangling, '.rcstack', 'runtime', '.git'));
    const asFile = freshHome();
    fs.mkdirSync(path.join(asFile, '.rcstack', 'runtime'), { recursive: true });
    fs.writeFileSync(path.join(asFile, '.rcstack', 'runtime', '.git'), 'not a gitdir\n');
    for (const home of [dangling, asFile]) {
      const before = snapshot(home);
      for (const args of [['--dry-run'], []]) {
        const res = install(home, args);
        assert.equal(res.status, 1, res.out);
        assert.match(res.stderr, /COLLISION: .*runtime\/\.git exists and is not a directory/);
        assert.deepEqual(snapshot(home), before);
      }
    }
    assert.equal(fs.existsSync(outside), false, 'no repository was created where the symlink points');
  });

  test('refuses an install-meta.json that is not a regular file', () => {
    const home = freshHome();
    fs.mkdirSync(path.join(home, '.rcstack', 'install-meta.json'), { recursive: true });
    const before = snapshot(home);
    const res = install(home);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /COLLISION: .*install-meta\.json exists and is not a regular file/);
    assert.deepEqual(snapshot(home), before);
  });

  test('refuses while another install holds the lock', () => {
    const home = freshHome();
    fs.mkdirSync(path.join(home, '.rcstack', '.install.lock'), { recursive: true });
    const res = install(home);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /another install is running/);
    assert.ok(fs.existsSync(path.join(home, '.rcstack', '.install.lock')), 'a foreign lock is not removed');
    assert.equal(fs.existsSync(path.join(home, '.rcstack', 'dist')), false);
  });

  test('refuses a home that does not exist, and unknown arguments', () => {
    const missing = path.join(SANDBOX, 'no-such-home');
    const res = install(missing);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /home directory does not exist/);
    assert.equal(fs.existsSync(missing), false);
    const home = freshHome();
    assert.notEqual(install(home, ['--force']).status, 0);
    assert.deepEqual(snapshot(home), []);
    assert.equal(install(home, ['--help']).status, 0);
  });

  test('refuses to install inside the source checkout', () => {
    const source = copySource();
    const home = freshHome();
    const res = install(home, ['--rcstack-home', path.join(source, 'installed')], { script: path.join(source, 'adapters/install.sh') });
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /is inside the source checkout/);
    assert.equal(fs.existsSync(path.join(source, 'installed')), false);
    assert.deepEqual(snapshot(home), []);
  });

  test('cannot be steered into the source checkout through ".." in a path that does not exist yet', () => {
    const source = copySource();
    const home = freshHome();
    // Built by hand: path.join() would resolve the ".." before the installer ever saw it.
    const sneaky = `${SANDBOX}/not-created/../${path.basename(source)}/installed-inside-src`;
    const res = install(home, ['--rcstack-home', sneaky], { script: path.join(source, 'adapters/install.sh') });
    assert.notEqual(res.status, 0, res.out);
    assert.match(res.stderr, /is inside the source checkout/);
    assert.equal(fs.existsSync(path.join(source, 'installed-inside-src')), false);
    assert.deepEqual(snapshot(home), []);
  });

  test('normalizes "." and ".." in --home and --rcstack-home before using them', () => {
    const home = freshHome();
    const res = install(`${home}/sub/.././`, [`--rcstack-home=${home}/a/../rc/`]);
    assert.equal(res.status, 0, res.out);
    assertLinks(home, path.join(home, 'rc'));
    assert.equal(fs.existsSync(path.join(home, 'a')), false);
  });

  test('the portable swap is not confused by leftovers of an earlier crashed run', () => {
    const home = freshHome();
    const rc = path.join(home, '.rcstack');
    assert.equal(install(home).status, 0);
    fs.mkdirSync(path.join(rc, '.dist-prev.12345'));
    const res = install(home, [], { env: { RCSTACK_INSTALL_NO_EXCHANGE: '1' } });
    assert.equal(res.status, 0, res.out);
    assert.deepEqual(fs.readdirSync(path.join(rc, 'dist')).sort(), ['contracts', 'defaults', 'rules', 'scripts', 'skills']);
    assertLinks(home);
  });

  test('installs from a source with nested feature specs and working documents, without staging them', () => {
    const source = copySource();
    const write = (rel, text) => {
      fs.mkdirSync(path.dirname(path.join(source, rel)), { recursive: true });
      fs.writeFileSync(path.join(source, rel), text);
    };
    write('specs/payments/spec.md', '# Spec: payments\n');
    write('specs/payments/requirements.md', 'requirements\n');
    write('specs/payments/refunds/spec.md', '# Spec: refunds\n');
    write('specs/payments/refunds/planning.md', 'planning\n');
    const home = freshHome();
    const res = install(home, [], { script: path.join(source, 'adapters/install.sh') });
    assert.equal(res.status, 0, res.out);
    const rc = path.join(home, '.rcstack');
    assert.deepEqual(fs.readdirSync(path.join(rc, 'dist')).sort(), ['contracts', 'defaults', 'rules', 'scripts', 'skills']);
    assert.equal(
      snapshot(rc).some((entry) => /(?:^|\/)(?:refunds\/|(?:requirements|planning)\.md \[)/.test(entry)),
      false,
      'no spec document reached the installed runtime',
    );
    assertLinks(home);
  });

  test('refuses a source whose specs tree is invalid, before changing anything', () => {
    const source = copySource();
    fs.mkdirSync(path.join(source, 'specs', 'half-written', 'sub-feature'), { recursive: true });
    fs.writeFileSync(path.join(source, 'specs', 'half-written', 'sub-feature', 'spec.md'), '# Spec: orphan\n');
    const home = freshHome();
    for (const args of [['--dry-run'], []]) {
      const res = install(home, args, { script: path.join(source, 'adapters/install.sh') });
      assert.notEqual(res.status, 0);
      assert.match(res.stderr, /specs\/half-written\/ has no spec\.md/);
      assert.match(res.stderr, /does not pass scripts\/verify\.mjs; nothing was changed/);
      assert.deepEqual(snapshot(home), []);
    }
  });

  test('refuses a source whose system spec is missing, back at the root, or not a real file', (t) => {
    const system = 'specs/initialization-build/spec.md';
    const breakers = {
      'deleted': (source) => fs.rmSync(path.join(source, system)),
      'moved back to the root': (source) => fs.renameSync(path.join(source, system), path.join(source, 'SPEC.md')),
      'a named pipe': (source) => {
        fs.rmSync(path.join(source, system));
        return spawnSync('mkfifo', [path.join(source, system)]).status === 0;
      },
    };
    for (const [label, breakIt] of Object.entries(breakers)) {
      const source = copySource();
      if (breakIt(source) === false) {
        t.diagnostic(`skipped "${label}": mkfifo is not available`);
        continue;
      }
      const home = freshHome();
      for (const args of [['--dry-run'], []]) {
        const res = spawnSync('bash', [path.join(source, 'adapters/install.sh'), '--home', home, ...args], {
          encoding: 'utf8',
          timeout: 60000,
          env: { ...process.env, HOME: home, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' },
        });
        assert.equal(res.signal, null, `${label}: the installer did not hang`);
        assert.equal(res.status, 1, `${label} ${args.join(' ')}`);
        assert.match(res.stderr, /S1 required file specs\/initialization-build\/spec\.md/, label);
        assert.match(res.stderr, /does not pass scripts\/verify\.mjs; nothing was changed/, label);
        assert.deepEqual(snapshot(home), [], `${label}: nothing was created`);
      }
    }
  });

  test('installs with a git-ignored custom directory, but refuses an ignored file in a directory it copies', () => {
    const source = copySource();
    const env = { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' };
    assert.equal(spawnSync('git', ['-C', source, 'init', '-q'], { env }).status, 0);
    fs.writeFileSync(path.join(source, '.gitignore'), '.archive/\n*.local.md\n');
    fs.mkdirSync(path.join(source, '.archive/playbooks'), { recursive: true });
    fs.writeFileSync(path.join(source, '.archive/playbooks/old.md'), 'old\n');
    fs.symlinkSync(os.tmpdir(), path.join(source, '.archive/link-out'));
    const hidden = path.join(source, 'skills/rc-setup/notes.local.md');
    fs.writeFileSync(hidden, 'never reviewed\n');
    const home = freshHome();
    for (const args of [['--dry-run'], []]) {
      const res = install(home, args, { script: path.join(source, 'adapters/install.sh') });
      assert.notEqual(res.status, 0);
      assert.match(res.stderr, /skills\/rc-setup\/notes\.local\.md is not part of the system spec's tree/);
      assert.deepEqual(snapshot(home), []);
    }
    fs.rmSync(hidden);
    const res = install(home, [], { script: path.join(source, 'adapters/install.sh') });
    assert.equal(res.status, 0, res.out);
    assert.equal(snapshot(path.join(home, '.rcstack')).some((entry) => /archive|link-out|old\.md/.test(entry)), false, 'nothing from the custom directory was installed');
    assertLinks(home);
  });

  test('refuses a source that fails its own verify', () => {
    const source = copySource();
    const playbook = path.join(source, 'skills/rc-router/playbooks/study/socratic-session.md');
    fs.writeFileSync(playbook, fs.readFileSync(playbook, 'utf8').replace('entry_mode: router_only', 'entry_mode: standalone'));
    const home = freshHome();
    const res = install(home, [], { script: path.join(source, 'adapters/install.sh') });
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /entry_mode must be "router_only"/);
    assert.match(res.stderr, /does not pass scripts\/verify\.mjs; nothing was changed/);
    assert.deepEqual(snapshot(home), []);
  });

  test('refuses a source containing a symbolic link or a sixth skill', () => {
    const linked = copySource();
    fs.symlinkSync(path.join(SANDBOX, 'outside-secret'), path.join(linked, 'skills', 'rc-setup', 'extra'));
    const home = freshHome();
    const res = install(home, [], { script: path.join(linked, 'adapters/install.sh') });
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /source contains symbolic links, refusing to stage them/);
    assert.deepEqual(snapshot(home), []);

    const extra = copySource();
    fs.mkdirSync(path.join(extra, 'skills', 'rc-audit'));
    const res2 = install(home, [], { script: path.join(extra, 'adapters/install.sh') });
    assert.notEqual(res2.status, 0);
    assert.match(res2.stderr, /unexpected entry in skills\/: rc-audit/);
    assert.deepEqual(snapshot(home), []);
  });
});
