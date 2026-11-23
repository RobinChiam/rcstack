// Hermetic tests for scripts/rc-log.mjs. Every telemetry file lives under os.tmpdir().
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { appendLine, semanticErrors, validateEvent, DEFAULT_SCHEMA } from '../scripts/rc-log.mjs';
import { TELEMETRY_REQUIRED_FIELDS } from '../scripts/verify.mjs';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts/rc-log.mjs');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'rcstack-log-'));
const FAKE_HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(FAKE_HOME);
const ENV = { ...process.env, HOME: FAKE_HOME };
const SCHEMA = JSON.parse(fs.readFileSync(DEFAULT_SCHEMA, 'utf8'));

after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

function event(overrides = {}) {
  return {
    schema_version: 1,
    ts: '2026-11-23T14:05:09Z',
    repo: 'widgets',
    branch: 'feature/export',
    profile: 'rcstack-engineering',
    playbook: 'feature-build',
    risk_tier: 2,
    required_assurance: 'A2',
    achieved_assurance: 'A2',
    builders: ['Builder One'],
    reviewers: ['Reviewer One'],
    degraded_single_harness: false,
    verify_attempts: 2,
    audit_accepted: { 'Reviewer One': 3 },
    audit_dismissed: { 'Reviewer One': 1 },
    overridden: false,
    escalated_from_tier: null,
    ...overrides,
  };
}

let counter = 0;
function tmpFile() {
  counter += 1;
  return path.join(SANDBOX, `case-${counter}`, 'telemetry.jsonl');
}

function cli(args, input) {
  const res = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: ENV, input });
  let json = null;
  try {
    json = JSON.parse(res.stdout);
  } catch {
    // --help prints plain text
  }
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, json };
}

const errorsOf = (overrides) => validateEvent(event(overrides), SCHEMA).join('\n');

describe('append', () => {
  test('validates and appends one compact JSONL row', () => {
    const file = tmpFile();
    const res = cli(['--file', file, '--json', JSON.stringify(event())]);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.equal(res.json.status, 'APPENDED');
    assert.equal(res.json.file, file);
    const text = fs.readFileSync(file, 'utf8');
    assert.equal(text.endsWith('\n'), true);
    assert.equal(text.split('\n').length, 2, 'exactly one line');
    assert.equal(text.includes(': '), false, 'compact JSON');
    assert.deepEqual(JSON.parse(text), event());
    assert.deepEqual(Object.keys(JSON.parse(text)), [...TELEMETRY_REQUIRED_FIELDS], 'canonical key order');
    assert.equal(res.json.bytes, Buffer.byteLength(text));
  });

  test('appends rows in order, reading the payload from stdin and reordering keys', () => {
    const file = tmpFile();
    const shuffled = Object.fromEntries(Object.entries(event({ verify_attempts: 1 })).reverse());
    assert.equal(cli(['--file', file], JSON.stringify(shuffled)).status, 0);
    assert.equal(cli([`--file=${file}`, `--json=${JSON.stringify(event({ verify_attempts: 5 }))}`]).status, 0);
    const rows = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(rows.map((r) => r.verify_attempts), [1, 5]);
    assert.deepEqual(Object.keys(rows[0]), [...TELEMETRY_REQUIRED_FIELDS]);
  });

  test('writes to <runtime-dir>/telemetry.jsonl, and by default under HOME/.rcstack/runtime', () => {
    const runtime = path.join(SANDBOX, 'runtime-a');
    assert.equal(cli(['--runtime-dir', runtime, '--json', JSON.stringify(event())]).status, 0);
    assert.equal(fs.readFileSync(path.join(runtime, 'telemetry.jsonl'), 'utf8').trim().split('\n').length, 1);

    const home = path.join(SANDBOX, 'home-b');
    fs.mkdirSync(home);
    const res = spawnSync(process.execPath, [SCRIPT, '--json', JSON.stringify(event())], { encoding: 'utf8', env: { ...ENV, HOME: home } });
    assert.equal(res.status, 0, res.stdout);
    assert.ok(fs.existsSync(path.join(home, '.rcstack', 'runtime', 'telemetry.jsonl')));
  });

  test('--dry-run validates and prints the row without writing', () => {
    const file = tmpFile();
    const res = cli(['--file', file, '--dry-run', '--json', JSON.stringify(event())]);
    assert.equal(res.status, 0);
    assert.equal(res.json.status, 'DRY_RUN');
    assert.deepEqual(JSON.parse(res.json.line), event());
    assert.equal(fs.existsSync(path.dirname(file)), false, 'not even the directory is created');
    assert.equal(cli(['--file', file, '--dry-run', '--json', JSON.stringify(event({ risk_tier: 7 }))]).status, 1);
    assert.deepEqual(fs.readdirSync(FAKE_HOME), [], 'nothing was written under HOME');
  });

  test('repairs a missing trailing newline instead of corrupting the previous row', () => {
    const file = tmpFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{"truncated":true}');
    appendLine(file, '{"next":1}');
    assert.equal(fs.readFileSync(file, 'utf8'), '{"truncated":true}\n{"next":1}\n');
  });

  test('refuses to append through a symlink', () => {
    const file = tmpFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const elsewhere = path.join(path.dirname(file), 'elsewhere.txt');
    fs.writeFileSync(elsewhere, 'do not touch\n');
    fs.symlinkSync(elsewhere, file);
    const res = cli(['--file', file, '--json', JSON.stringify(event())]);
    assert.equal(res.status, 1);
    assert.match(res.json.errors[0], /cannot append/);
    assert.equal(fs.readFileSync(elsewhere, 'utf8'), 'do not touch\n');
  });
});

describe('schema rejection', () => {
  test('rejects a row missing any required field', () => {
    for (const field of TELEMETRY_REQUIRED_FIELDS) {
      const payload = event();
      delete payload[field];
      assert.match(validateEvent(payload, SCHEMA).join('\n'), new RegExp(`missing required property "${field}"`));
    }
  });

  const malformed = {
    'a wrong schema_version': [{ schema_version: 2 }, /schema_version: must equal 1/],
    'a non-UTC timestamp': [{ ts: '2026-11-23T14:05:09+08:00' }, /\$\.ts: must match/],
    'a date-only timestamp': [{ ts: '2026-11-23' }, /\$\.ts: must match/],
    'an impossible date': [{ ts: '2026-13-45T25:61:00Z' }, /is not a real date-time/],
    'a calendar date that does not exist': [{ ts: '2026-02-31T00:00:00Z' }, /is not a real date-time/],
    'February 29 in a common year': [{ ts: '2026-02-29T12:00:00Z' }, /is not a real date-time/],
    'a filesystem path as repo': [{ repo: '/home/someone/widgets' }, /\$\.repo: must match/],
    'an unknown profile': [{ profile: 'rcstack-cooking' }, /\$\.profile: must be one of/],
    'an unknown playbook': [{ playbook: 'yolo-deploy' }, /\$\.playbook: must be one of/],
    'a tier out of range': [{ risk_tier: 4 }, /\$\.risk_tier: must be <= 3/],
    'a non-integer tier': [{ risk_tier: '2' }, /expected integer, got string/],
    'an unknown assurance level': [{ achieved_assurance: 'A4' }, /\$\.achieved_assurance: must be one of/],
    'no builders': [{ builders: [] }, /\$\.builders: must have at least 1 item/],
    'duplicate builders': [{ builders: ['Builder One', 'Builder One'] }, /items must be unique/],
    'negative verify attempts': [{ verify_attempts: -1 }, /must be >= 0/],
    'a non-integer audit count': [{ audit_accepted: { 'Reviewer One': 'many' } }, /audit_accepted\.Reviewer One: expected integer/],
    'a non-boolean flag': [{ overridden: 'no' }, /\$\.overridden: expected boolean/],
    'a bad escalation value': [{ escalated_from_tier: 5 }, /escalated_from_tier: must be <= 3/],
    'an extra property': [{ prompt: 'secret text' }, /\$\.prompt: unknown property/],
  };
  for (const [label, [overrides, pattern]] of Object.entries(malformed)) {
    test(`rejects ${label}`, () => assert.match(errorsOf(overrides), pattern));
  }

  test('rejects non-object and non-JSON payloads through the CLI, writing nothing', () => {
    const file = tmpFile();
    for (const payload of ['[]', '"text"', 'null', '{not json']) {
      const res = cli(['--file', file, '--json', payload]);
      assert.equal(res.status, 1, payload);
      assert.equal(res.json.status, 'REJECTED');
    }
    const res = cli(['--file', file, '--json', JSON.stringify(event({ risk_tier: 9, repo: 'a/b' }))]);
    assert.equal(res.status, 1);
    assert.equal(res.json.errors.length, 2, 'every schema error is reported');
    assert.equal(fs.existsSync(file), false);
  });
});

describe('reviewer != builder', () => {
  test('rejects a sole builder listed as its own reviewer', () => {
    assert.match(errorsOf({ builders: ['Solo'], reviewers: ['Solo'], audit_accepted: {}, audit_dismissed: {}, achieved_assurance: 'A1' }), /self-review: "Solo" is the sole builder and is also listed as a reviewer/);
    assert.match(errorsOf({ builders: ['Solo'], reviewers: ['Solo', 'Other'], audit_accepted: {}, audit_dismissed: {}, achieved_assurance: 'A1' }), /self-review/);
    const file = tmpFile();
    const res = cli(['--file', file, '--json', JSON.stringify(event({ builders: ['Solo'], reviewers: ['Solo'], audit_accepted: {}, audit_dismissed: {} }))]);
    assert.equal(res.status, 1);
    assert.match(res.json.errors.join('\n'), /self-review/);
    assert.equal(fs.existsSync(file), false);
  });

  test('allows an honestly degraded single-harness run, but never at A2 or above', () => {
    const degraded = { builders: ['Solo'], reviewers: ['Solo'], degraded_single_harness: true, audit_accepted: {}, audit_dismissed: {} };
    assert.equal(errorsOf({ ...degraded, achieved_assurance: 'A1' }), '');
    assert.match(errorsOf({ ...degraded, achieved_assurance: 'A2' }), /achieved_assurance A2 is impossible for a degraded_single_harness run/);
    assert.match(errorsOf({ ...degraded, achieved_assurance: 'A3' }), /achieved_assurance A3 is impossible for a degraded_single_harness run/);
    // A second reviewer does not launder a degraded self-review into an audited result.
    const padded = { ...degraded, reviewers: ['Solo', 'Other'] };
    assert.equal(errorsOf({ ...padded, achieved_assurance: 'A1' }), '');
    assert.match(errorsOf({ ...padded, achieved_assurance: 'A2' }), /is impossible for a degraded_single_harness run/);
    assert.match(errorsOf({ builders: ['Solo'], reviewers: ['Other'], degraded_single_harness: true, audit_accepted: {}, audit_dismissed: {}, achieved_assurance: 'A3' }), /tops out at A1/);
  });

  test('sees through a different spelling of the same model', () => {
    const base = { audit_accepted: {}, audit_dismissed: {}, achieved_assurance: 'A2' };
    assert.match(errorsOf({ ...base, builders: ['Gemini 4 Neon'], reviewers: ['gemini-4-neon'] }), /self-review: "Gemini 4 Neon" is the sole builder/);
    assert.match(errorsOf({ ...base, builders: ['claude_opus_5_5'], reviewers: ['Claude Opus 5.5'] }), /self-review/);
    assert.match(errorsOf({ ...base, builders: ['Grok 4.7'], reviewers: ['Cursor Grok 4.7'] }), /self-review/);
    assert.match(errorsOf({ ...base, builders: ['Alpha One', 'alpha-one'], reviewers: ['Beta'] }), /builders lists the same model twice under different spellings/);
    assert.equal(errorsOf({ ...base, builders: ['Gemini 4 Neon'], reviewers: ['claude-opus-5-5'], audit_accepted: { 'Claude Opus 5.5': 2 } }), '');
    // A catalog id with the version in front of the model name is still the same model.
    for (const [builder, reviewer] of [['Claude Opus 5.5', 'claude-5-5-opus'], ['Gemini 4 Neon', 'gemini-neon-4'], ['GPT 6.2 Astra', 'gpt-astra-6.2']]) {
      assert.match(errorsOf({ ...base, achieved_assurance: 'A3', builders: [builder], reviewers: [reviewer] }), /self-review/, `${builder} / ${reviewer}`);
    }
  });

  test('does not mistake a different model for the builder because one name ends with the other', () => {
    const base = { audit_accepted: {}, audit_dismissed: {}, achieved_assurance: 'A3' };
    for (const [builder, reviewer] of [['Llama 3', 'CodeLlama 3'], ['Gemma 3', 'CodeGemma 3'], ['2.5 Pro', '12.5 Pro'], ['Solo', 'NotSolo'], ['GPT 4', 'MiniGPT 4']]) {
      assert.equal(errorsOf({ ...base, builders: [builder], reviewers: [reviewer] }), '', `${builder} / ${reviewer}`);
    }
  });

  test('allows valid multi-slice cross-pairing and rejects a builder with no other reviewer', () => {
    const crossed = { builders: ['Alpha', 'Beta'], reviewers: ['Beta', 'Alpha'], audit_accepted: { Alpha: 1, Beta: 2 }, audit_dismissed: {} };
    assert.equal(errorsOf(crossed), '');
    assert.match(errorsOf({ builders: ['Alpha', 'Beta'], reviewers: ['Alpha'], audit_accepted: {}, audit_dismissed: {}, achieved_assurance: 'A1' }), /self-review: no reviewer other than itself for builder\(s\) "Alpha"/);
  });

  test('A2 and A3 require a reviewer; lower levels may have none', () => {
    const unreviewed = { reviewers: [], audit_accepted: {}, audit_dismissed: {} };
    assert.match(errorsOf({ ...unreviewed, achieved_assurance: 'A2' }), /requires an independent audit/);
    assert.equal(errorsOf({ ...unreviewed, achieved_assurance: 'A1' }), '');
    assert.equal(errorsOf({ ...unreviewed, achieved_assurance: 'A0', required_assurance: 'A0', risk_tier: 0 }), '');
  });
});

describe('other cross-field rules', () => {
  test('an assurance gap is a valid row: it is logged, not hidden', () => {
    assert.equal(errorsOf({ achieved_assurance: 'A1', required_assurance: 'A3', risk_tier: 3, overridden: true }), '');
  });
  test('escalation must go upward', () => {
    assert.equal(errorsOf({ risk_tier: 3, required_assurance: 'A3', escalated_from_tier: 2 }), '');
    assert.match(errorsOf({ risk_tier: 2, escalated_from_tier: 2 }), /escalated_from_tier 2 must be below risk_tier 2/);
  });
  test('a playbook must belong to its profile', () => {
    assert.match(errorsOf({ profile: 'rcstack-study' }), /playbook "feature-build" belongs to rcstack-engineering, not rcstack-study/);
    assert.equal(errorsOf({ profile: 'rcstack-study', playbook: 'topic-deep-dive' }), '');
  });
  test('audit counts may only name listed reviewers', () => {
    assert.match(errorsOf({ audit_dismissed: { Stranger: 2 } }), /audit_dismissed counts findings for "Stranger", which is not listed in reviewers/);
  });
  test('semanticErrors is exported for a schema-valid event', () => {
    assert.deepEqual(semanticErrors(event()), []);
  });
  test('accepts real timestamps, including a leap day and fractional seconds', () => {
    for (const ts of ['2028-02-29T23:59:59Z', '2026-11-23T14:05:09.123Z', '2026-12-31T00:00:00Z']) assert.equal(errorsOf({ ts }), '', ts);
  });
});

describe('CLI', () => {
  test('prints usage, and rejects unknown flags and an unusable schema', () => {
    const help = cli(['--help']);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /Usage: node scripts\/rc-log\.mjs/);
    assert.equal(cli(['--bogus']).status, 1);
    const valued = cli(['--dry-run=false', '--file', tmpFile(), '--json', JSON.stringify(event())]);
    assert.equal(valued.status, 1);
    assert.match(valued.json.errors[0], /--dry-run takes no value/);
    const badSchema = path.join(SANDBOX, 'bad-schema.json');
    fs.writeFileSync(badSchema, JSON.stringify({ type: 'object', required: [], format: 'x' }));
    const res = cli(['--schema', badSchema, '--file', tmpFile(), '--json', JSON.stringify(event())]);
    assert.equal(res.status, 1);
    assert.match(res.json.errors[0], /unsupported JSON Schema keyword "format"/);
    assert.equal(cli(['--schema', path.join(SANDBOX, 'missing.json'), '--json', '{}']).status, 1);
  });
});
