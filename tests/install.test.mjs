// Hermetic tests for adapters/install.sh. Every home directory is a fresh one under os.tmpdir();
// the real ~/.rcstack and the real harness directories are never read or written.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'rcstack-install-'));
const SKILLS = ['rc-router', 'rc-setup', 'rc-init', 'rc-doctor', 'rc-retro'];
const HARNESSES = ['.agents', '.claude', '.codex', '.gemini', '.cursor'];
const PROFILES = ['rcstack-engineering.yaml', 'rcstack-study.yaml', 'rcstack-research.yaml'];

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
function freshHome() {
  counter += 1;
  const home = path.join(SANDBOX, `home-${counter}`);
  fs.mkdirSync(home);
  return home;
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
    else if (ent.isFile()) fs.copyFileSync(from, to);
  }
}

/** A private copy of the source checkout, for tests that must break the source. */
function copySource() {
  counter += 1;
  const dir = path.join(SANDBOX, `source-${counter}`);
  copyTree(ROOT, dir);
  return dir;
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
    assert.equal((res.stdout.match(/\[dry-run\] would seed /g) ?? []).length, 3);
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
    assert.equal((res.stdout.match(/\[dry-run\] would keep .*profiles\/rcstack-.*never overwritten/g) ?? []).length, 3);
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
  test('promotes into dist, seeds profiles, initializes runtime, and links only to dist', () => {
    const home = freshHome();
    const rc = path.join(home, '.rcstack');
    const res = install(home, ['--from-local']);
    assert.equal(res.status, 0, res.out);
    assert.match(res.stdout, /install: OK: rcstack-beta 0\.1\.0-beta promoted to .*\/\.rcstack\/dist; 25 harness link\(s\) point there/);

    assert.deepEqual(fs.readdirSync(rc).sort(), ['dist', 'install-meta.json', 'profiles', 'runtime']);
    assert.ok(fs.existsSync(path.join(ROOT, 'specs', 'feature-local-specs', 'spec.md')), 'the source has feature-local specs');
    assert.deepEqual(fs.readdirSync(path.join(rc, 'dist')).sort(), ['contracts', 'defaults', 'rules', 'scripts', 'skills'], 'specs/, docs/ and tests/ are source-only');
    assert.deepEqual(fs.readdirSync(path.join(rc, 'dist', 'skills')).sort(), [...SKILLS].sort());
    assert.deepEqual(fs.readdirSync(path.join(rc, 'dist', 'defaults', 'profiles')).sort(), [...PROFILES, 'schema.json'].sort());
    assert.equal(fs.readdirSync(path.join(rc, 'dist', 'skills', 'rc-router', 'playbooks', 'engineering')).length, 7);
    for (const rel of ['rules/study.md', 'contracts/work-receipt.md', 'scripts/rc-state.mjs', 'skills/rc-router/SKILL.md']) {
      assert.equal(fs.readFileSync(path.join(rc, 'dist', rel), 'utf8'), fs.readFileSync(path.join(ROOT, rel), 'utf8'), rel);
    }

    const meta = JSON.parse(fs.readFileSync(path.join(rc, 'install-meta.json'), 'utf8'));
    assert.deepEqual(Object.keys(meta), ['version', 'commit_sha', 'source', 'dirty', 'installed_at']);
    assert.equal(meta.version, '0.1.0-beta');
    assert.equal(meta.source, 'local');
    assert.match(meta.commit_sha, /^(?:[0-9a-f]{40}|unknown)$/);
    assert.equal(typeof meta.dirty, 'boolean');
    assert.match(meta.installed_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);

    for (const profile of PROFILES) {
      assert.equal(fs.readFileSync(path.join(rc, 'profiles', profile), 'utf8'), fs.readFileSync(path.join(ROOT, 'profiles', profile), 'utf8'));
      assert.notEqual(fs.statSync(path.join(rc, 'profiles', profile)).mode & 0o200, 0, 'seeded profiles are editable');
    }

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
    for (const rel of ['', 'skills', 'skills/rc-router/SKILL.md', 'scripts/verify.mjs', 'defaults/profiles/schema.json']) {
      assert.equal(fs.statSync(path.join(dist, rel)).mode & 0o222, 0, `dist/${rel} is not writable`);
    }
  });

  test('installed scripts run from dist against the installed layout', () => {
    const home = freshHome();
    assert.equal(install(home).status, 0);
    const rc = path.join(home, '.rcstack');
    const env = { ...process.env, HOME: home };
    const profile = spawnSync(process.execPath, [path.join(rc, 'dist/scripts/verify.mjs'), '--profile', path.join(rc, 'profiles/rcstack-study.yaml')], { encoding: 'utf8', env });
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

describe('idempotency', () => {
  for (const [label, env] of [['atomic exchange', {}], ['portable two-rename swap', { RCSTACK_INSTALL_NO_EXCHANGE: '1' }]]) {
    test(`re-running replaces dist and preserves user profile edits (${label})`, () => {
      const home = freshHome();
      const rc = path.join(home, '.rcstack');
      assert.equal(install(home, [], { env }).status, 0);

      const profile = path.join(rc, 'profiles', 'rcstack-engineering.yaml');
      const edited = `${fs.readFileSync(profile, 'utf8')}\n# my machine-local routing tweak\n`;
      fs.writeFileSync(profile, edited);
      fs.rmSync(path.join(rc, 'profiles', 'rcstack-study.yaml'));
      const stateFile = path.join(rc, 'runtime', 'state', 'keep.md');
      fs.writeFileSync(stateFile, 'runtime data survives\n');
      const distBefore = fs.statSync(path.join(rc, 'dist')).ino;
      const gitBefore = fs.statSync(path.join(rc, 'runtime', '.git')).ino;

      const res = install(home, [], { env });
      assert.equal(res.status, 0, res.out);
      assert.equal(fs.readFileSync(profile, 'utf8'), edited, 'an edited profile is never overwritten');
      assert.match(res.stdout, /-> keep .*rcstack-engineering\.yaml \(machine-local profiles are never overwritten\)/);
      assert.ok(fs.existsSync(path.join(rc, 'profiles', 'rcstack-study.yaml')), 'a missing profile is seeded again');
      assert.equal(fs.readFileSync(stateFile, 'utf8'), 'runtime data survives\n');
      assert.equal(fs.statSync(path.join(rc, 'runtime', '.git')).ino, gitBefore, 'the shadow repository is not re-initialized');
      assert.notEqual(fs.statSync(path.join(rc, 'dist')).ino, distBefore, 'dist is a freshly staged tree');
      assert.equal((res.stdout.match(/-> keep .*skills\/rc-/g) ?? []).length, 25);
      assertLinks(home);
      assert.deepEqual(fs.readdirSync(rc).sort(), ['dist', 'install-meta.json', 'profiles', 'runtime'], 'no leftovers after the swap');
    });
  }

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

describe('refusals', () => {
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
    assert.equal(snapshot(rc).some((entry) => /refunds|requirements\.md|planning\.md/.test(entry)), false, 'no spec document reached the installed runtime');
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
