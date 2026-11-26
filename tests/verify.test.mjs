// Hermetic tests for scripts/verify.mjs. Every mutation happens in a copy under os.tmpdir().
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  parseYaml,
  YamlError,
  validateSchema,
  checkSchemaKeywords,
  globToRegExp,
  findModelNames,
  extractPathRefs,
  parseSections,
  checkProfileText,
  checkSpecsTree,
  checkPlaybookGates,
  isGateExempt,
  SYSTEM_SPEC,
  OWNED_DIRS,
  FORBIDDEN_ROOT_ENTRIES,
  gitIgnoredPaths,
  runSpecsCheck,
  sameModel,
  normalizeModelName,
  runVerify,
  APPROVED_SKILLS,
  PLAYBOOKS,
  ROUTER_ONLY_RULE,
} from '../scripts/verify.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmpDirs = [];

after(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

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

/** A private copy of the repository under os.tmpdir(). */
function copyRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rcstack-verify-'));
  tmpDirs.push(dir);
  copyTree(ROOT, dir);
  return dir;
}

function edit(root, rel, fn) {
  const file = path.join(root, rel);
  const before = fs.readFileSync(file, 'utf8');
  const afterText = fn(before);
  assert.notEqual(afterText, before, `mutation of ${rel} changed nothing`);
  fs.writeFileSync(file, afterText);
}

function failures(root, slice = 3) {
  return runVerify({ root, slice })
    .failures.map((f) => `${f.name}\n${f.errors.join('\n')}`)
    .join('\n');
}

/** Copy the repo, apply `mutate`, and assert verify fails with a message matching `pattern`. */
function expectFailure(mutate, pattern, slice = 3) {
  const root = copyRepo();
  mutate(root);
  const report = failures(root, slice);
  assert.notEqual(report, '', 'verify unexpectedly passed');
  assert.match(report, pattern);
}

function cli(root, args = []) {
  return spawnSync(process.execPath, [path.join(root, 'scripts/verify.mjs'), ...args], { encoding: 'utf8' });
}

const PLAYBOOK = 'skills/rc-router/playbooks/engineering/feature-build.md';

describe('parseYaml: strict subset', () => {
  test('parses mappings, sequences, scalars and comments', () => {
    const doc = [
      '# leading comment',
      'name: rc-router            # trailing comment',
      'version: 0.1.0',
      'count: 42',
      'negative: -7',
      'enabled: true',
      'disabled: false',
      'nothing: null',
      'empty: []',
      'quoted: "a: b # not a comment"',
      'escaped: "say \\"hi\\"\\n"',
      'glob: "**/Dockerfile*"',
      'nested:',
      '  deeper:',
      '    key: value',
      'list:',
      '  - contracts/spec.md',
      '  - "scripts/rc-log.mjs:88"',
      'records:',
      '  - driver_kind: codex',
      '    model: "Some Model"',
      '  - driver_kind: other',
      '"Quoted Key":',
      '  primary: "x"',
      '"0":',
      '  name: lookup',
    ].join('\n');
    assert.deepEqual(parseYaml(doc), {
      name: 'rc-router',
      version: '0.1.0',
      count: 42,
      negative: -7,
      enabled: true,
      disabled: false,
      nothing: null,
      empty: [],
      quoted: 'a: b # not a comment',
      escaped: 'say "hi"\n',
      glob: '**/Dockerfile*',
      nested: { deeper: { key: 'value' } },
      list: ['contracts/spec.md', 'scripts/rc-log.mjs:88'],
      records: [{ driver_kind: 'codex', model: 'Some Model' }, { driver_kind: 'other' }],
      'Quoted Key': { primary: 'x' },
      0: { name: 'lookup' },
    });
  });

  const rejected = {
    'a tab': 'a:\n\tb: 1',
    'odd indentation': 'a:\n   b: 1',
    'an indentation jump': 'a:\n    b: 1',
    'a stray indent': 'a: 1\n  b: 2',
    'an anchor': 'a: &x 1',
    'an alias': 'a: *x',
    'a tag': 'a: !!str 1',
    'a literal block scalar': 'a: |\n  text',
    'a folded block scalar': 'a: >\n  text',
    'a flow sequence': 'a: [1, 2]',
    'a flow mapping': 'a: {b: 1}',
    'a single-quoted string': "a: 'x'",
    'a duplicate key': 'a: 1\na: 2',
    'a float': 'a: 1.5',
    'an exponent that could be a SHA': 'a: 1234e56',
    'a leading-zero number': 'a: 007',
    'a YAML 1.1 boolean': 'a: yes',
    'a tilde null': 'a: ~',
    'a document marker': '---\na: 1',
    'a carriage return': 'a: 1\r\nb: 2',
    'an unterminated quote': 'a: "x',
    'an unsupported escape': 'a: "\\x41"',
    'an empty document': '# only a comment\n',
    'a key without a value': 'a:\nb: 1',
    'a plain scalar holding a mapping': 'a: b: c',
    'a nested sequence': 'a:\n  - - 1',
    'an indentless sequence': 'a:\n- 1',
    'a missing space after the colon': '"a":b',
    'a prototype key': '__proto__: 1',
    'a bare scalar document': 'just text',
  };
  for (const [label, doc] of Object.entries(rejected)) {
    test(`rejects ${label}`, () => {
      assert.throws(() => parseYaml(doc), YamlError);
    });
  }

  test('reports the offending line', () => {
    assert.throws(() => parseYaml('a: 1\nb:\n\tc: 2'), /line 3: tab characters are not allowed/);
  });
});

describe('validateSchema: fails closed', () => {
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'tier'],
    properties: {
      name: { type: 'string', minLength: 1, pattern: '^[a-z-]+$' },
      tier: { type: 'integer', minimum: 0, maximum: 3 },
      level: { $ref: '#/$defs/level' },
      tags: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string' } },
      maybe: { type: ['integer', 'null'] },
      fixed: { const: true },
      counts: { type: 'object', propertyNames: { pattern: '^\\S+$' }, additionalProperties: { type: 'integer', minimum: 0 } },
      shape: { anyOf: [{ type: 'string' }, { type: 'integer' }] },
      narrowed: { allOf: [{ type: 'string' }, { enum: ['a', 'b'] }] },
      exclusive: { oneOf: [{ type: 'integer', minimum: 5 }, { type: 'integer', maximum: 1 }] },
      never: { not: { const: 'forbidden' } },
    },
    $defs: { level: { enum: ['A0', 'A1'] } },
  };

  test('accepts a valid document', () => {
    const doc = { name: 'ok', tier: 2, level: 'A1', tags: ['x'], maybe: null, fixed: true, counts: { m: 1 }, shape: 3, narrowed: 'a', exclusive: 7, never: 'fine' };
    assert.deepEqual(validateSchema(doc, schema), []);
  });

  const invalid = {
    'a missing required property': [{ name: 'ok' }, /missing required property "tier"/],
    'an unknown property': [{ name: 'ok', tier: 1, extra: 1 }, /\$\.extra: unknown property/],
    'a wrong type': [{ name: 'ok', tier: '1' }, /\$\.tier: expected integer, got string/],
    'a non-integer number': [{ name: 'ok', tier: 1.5 }, /expected integer, got number/],
    'a value above maximum': [{ name: 'ok', tier: 4 }, /must be <= 3/],
    'a pattern mismatch': [{ name: 'Not OK', tier: 1 }, /must match/],
    'an enum violation through $ref': [{ name: 'ok', tier: 1, level: 'A9' }, /\$\.level: must be one of/],
    'duplicate array items': [{ name: 'ok', tier: 1, tags: ['x', 'x'] }, /items must be unique/],
    'an empty array': [{ name: 'ok', tier: 1, tags: [] }, /at least 1 item/],
    'a const violation': [{ name: 'ok', tier: 1, fixed: false }, /must equal true/],
    'a bad property name': [{ name: 'ok', tier: 1, counts: { 'a b': 1 } }, /invalid property name/],
    'a bad additional property': [{ name: 'ok', tier: 1, counts: { m: -1 } }, /\$\.counts\.m: must be >= 0/],
    'no anyOf match': [{ name: 'ok', tier: 1, shape: true }, /at least one allowed shape/],
    'an allOf violation': [{ name: 'ok', tier: 1, narrowed: 'c' }, /\$\.narrowed: must be one of/],
    'no oneOf match': [{ name: 'ok', tier: 1, exclusive: 3 }, /exactly one allowed shape/],
    'a not violation': [{ name: 'ok', tier: 1, never: 'forbidden' }, /forbidden shape/],
  };
  for (const [label, [doc, pattern]] of Object.entries(invalid)) {
    test(`rejects ${label}`, () => {
      assert.match(validateSchema(doc, schema).join('\n'), pattern);
    });
  }

  test('throws on a keyword it does not enforce', () => {
    assert.throws(() => validateSchema({}, { type: 'object', dependentRequired: {} }), /unsupported JSON Schema keyword "dependentRequired"/);
    assert.throws(() => checkSchemaKeywords({ properties: { a: { format: 'email' } } }), /unsupported JSON Schema keyword "format"/);
  });

  test('throws on an unresolvable or remote $ref', () => {
    assert.throws(() => validateSchema(1, { $ref: '#/$defs/missing' }), /unresolvable \$ref/);
    assert.throws(() => validateSchema(1, { $ref: 'https://example.invalid/schema.json' }), /unsupported \$ref/);
  });
});

describe('globToRegExp', () => {
  const cases = [
    ['auth/**', 'auth/login.ts', true],
    ['auth/**', 'auth/deep/er/x.ts', true],
    ['auth/**', 'auth', false],
    ['auth/**', 'src/auth/x.ts', false],
    ['**/Dockerfile*', 'Dockerfile', true],
    ['**/Dockerfile*', 'svc/api/Dockerfile.dev', true],
    ['**/Dockerfile*', 'svc/Dockerfile/x', false],
    ['scripts/verify.mjs', 'scripts/verify.mjs', true],
    ['scripts/verify.mjs', 'scripts/verifyXmjs', false],
    ['src/*.ts', 'src/a.ts', true],
    ['src/*.ts', 'src/sub/a.ts', false],
    ['src/?.ts', 'src/ab.ts', false],
    ['**', 'anything/at/all', true],
  ];
  for (const [glob, file, expected] of cases) {
    test(`${glob} ${expected ? 'matches' : 'does not match'} ${file}`, () => {
      assert.equal(globToRegExp(glob).test(file), expected);
    });
  }
  test('rejects absolute, empty, traversing and whitespace globs', () => {
    for (const bad of ['', '/etc/passwd', 'a/../b', 'a//b', 'a b', 'a\\b', 'src/']) {
      assert.throws(() => globToRegExp(bad), /invalid glob/);
    }
  });
});

describe('model-name detection', () => {
  test('flags concrete model names and catalog ids', () => {
    for (const text of ['GPT 6.2 Astra', 'ask Claude Opus to review', 'claude-sonnet-5-5', 'Gemini 4 Neon', 'gemini-4-hydrogen', 'Gemini Notebook', 'Cursor Grok 4.7', 'Opus 5.5']) {
      assert.notEqual(findModelNames(text).length, 0, `missed "${text}"`);
    }
  });
  test('does not flag harness names, directories or abstract capabilities', () => {
    const text = 'T3 Code, Claude Code, Codex CLI, Cursor, Antigravity, ~/.gemini/skills, ~/.claude/skills, primary_builder, independent_reviewer';
    assert.deepEqual(findModelNames(text), []);
  });
  test('flags any model name bound in a profile, with its line number', () => {
    const hits = findModelNames('first line\nroute this to Nova Nine please', ['Nova Nine']);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].line, 2);
  });
  test('flags catalog ids, snake_case, version-first and versionless spellings', () => {
    const spellings = [
      'claude-5-5-opus', 'claude-5-5-sonnet', 'claude-5-2-fable', 'claude-3-5-sonnet', 'claude_opus_5_5', 'Claude Haiku',
      'gpt_6_2_astra', 'gpt-6.2-sol', 'GPT Astra', 'GPT Sol', 'gemini_4_neon', 'Gemini Neon', 'gemini-pro', 'gemini_notebook',
      'o3-mini', 'grok_4_7', 'sonnet-5',
    ];
    for (const text of spellings) assert.notEqual(findModelNames(`use ${text} here`).length, 0, `missed "${text}"`);
  });
  test('flags a profile-bound name however it is punctuated, reordered or shortened', () => {
    const bound = ['Nova Nine 3.1', 'Vega 2 Pulsar'];
    for (const text of ['nova-nine-3.1', 'nova_nine_3_1', 'NOVA NINE', 'nova-3-1-nine', 'vega-2-pulsar', 'Vega Pulsar', 'vega_pulsar_2']) {
      assert.notEqual(findModelNames(`route to ${text}.`, bound).length, 0, `missed "${text}"`);
    }
    assert.deepEqual(findModelNames('a supernova nineteen times brighter than Vega', bound), []);
  });
  test('does not flag ordinary words that merely contain a family name', () => {
    assert.deepEqual(findModelNames('~/.gemini/profile, gemini-profile, a prosol solution, opus magnum, fable, haiku, the o2 sensor'), []);
    assert.deepEqual(findModelNames('Help the learner grok the architecture; they grokked it.'), []);
  });
  test('sameModel compares model identity, not spelling', () => {
    assert.equal(normalizeModelName('Gemini 4 Neon'), 'gemini4neon');
    for (const [a, b] of [['Gemini 4 Neon', 'gemini-4-neon'], ['Claude Opus 5.5', 'claude-opus-5-5'], ['GPT 6.2 Sol', 'gpt_6_2_sol'], ['Cursor Grok 4.7', 'Grok 4.7'], ['grok-4.7', 'Cursor Grok 4.7']]) {
      assert.equal(sameModel(a, b), true, `${a} / ${b}`);
    }
    for (const [a, b] of [['Gemini 4 Neon', 'Gemini 4 Hydrogen'], ['GPT 6.2 Sol', 'GPT 6.2 Astra'], ['Claude Opus 5.5', 'Claude Sonnet 5.5'], ['GPT 6.2 Sol', 'Sol']]) {
      assert.equal(sameModel(a, b), false, `${a} / ${b}`);
    }
  });
  test('sameModel sees through a version placed elsewhere, as catalog ids do', () => {
    const aliases = [
      ['Claude Opus 5.5', 'claude-5-5-opus'], ['Claude Sonnet 5.5', 'claude-5-5-sonnet'], ['Claude Fable 5.2', 'claude-5-2-fable'],
      ['Gemini 4 Neon', 'gemini-neon-4'], ['GPT 6.2 Astra', 'gpt-astra-6.2'], ['GPT 6.2 Sol', 'gpt62sol'], ['Cursor Grok 4.7', 'grok-4-7'],
      ['Cursor Grok 4.7', 'cursor_4_7_grok'],
    ];
    for (const [a, b] of aliases) {
      assert.equal(sameModel(a, b), true, `${a} / ${b}`);
      assert.equal(sameModel(b, a), true, `${b} / ${a}`);
    }
  });
  test('sameModel matches whole tokens, so different models stay different', () => {
    const distinct = [
      ['Llama 3', 'CodeLlama 3'], ['Gemma 3', 'CodeGemma 3'], ['Qwen 2.5', 'CodeQwen 2.5'], ['GPT 4', 'MiniGPT 4'], ['o1-mini', 'Pro1-mini'],
      ['2.5 Pro', '12.5 Pro'], ['Gemini 4 Neon', 'Neon'], ['GPT 6.2 Astra', 'Astra'], ['Solo', 'NotSolo'], ['Claude Fable 5.2', 'claude-2-5-fable'],
      ['Claude Opus 5.5', 'Claude Opus 5.6'], ['Gemini 4 Neon', 'Gemini 5 Neon'], ['Grok 4.7', 'Cursor 4.7'],
    ];
    for (const [a, b] of distinct) {
      assert.equal(sameModel(a, b), false, `${a} / ${b}`);
      assert.equal(sameModel(b, a), false, `${b} / ${a}`);
    }
  });
});

describe('markdown helpers', () => {
  test('parseSections ignores headings inside fenced code', () => {
    const body = '## One\n\ntext\n\n```md\n## Not A Heading\n```\n\n## Two\n\nmore';
    assert.deepEqual(parseSections(body).map((s) => s.heading), ['One', 'Two']);
  });
  test('extractPathRefs resolves repo paths, dist paths, script names and playbook refs', () => {
    const text = 'See `contracts/spec.md`, `~/.rcstack/dist/scripts/rc-log.mjs`, `rc-state.mjs transition`, `study/topic-deep-dive`, `~/.rcstack/dist/defaults/profiles/schema.json`, `skills/<name>/SKILL.md`, `tests/*.test.mjs`, `~/.claude/skills/x`, and `auth/**`.';
    assert.deepEqual(extractPathRefs(text), [
      'contracts/spec.md',
      'profiles/schema.json',
      'scripts/rc-log.mjs',
      'scripts/rc-state.mjs',
      'skills/rc-router/playbooks/study/topic-deep-dive.md',
    ]);
  });
  test('extractPathRefs follows an inline code span that wraps across lines', () => {
    const wrapped = 'Run `rc-state.mjs init --repo <repo>\n   --tier 2` and then `scripts/missing.mjs\n--flag`.';
    assert.deepEqual(extractPathRefs(wrapped), ['scripts/missing.mjs', 'scripts/rc-state.mjs']);
    // The closing backtick of a wrapped span must not pair with the next span's opening one.
    const prose = 'Run `rc-state.mjs init\n--tier 2` for engineering/product work with `ok`.';
    assert.deepEqual(extractPathRefs(prose), ['scripts/rc-state.mjs']);
    // A blank line ends a paragraph, so an unbalanced backtick cannot swallow the next one.
    assert.deepEqual(extractPathRefs('A stray ` here.\n\nSee engineering/product and `contracts/spec.md`.'), ['contracts/spec.md']);
  });
  test('extractPathRefs reads only inline code: prose and fenced examples are not references', () => {
    const text = 'See engineering/product decisions and research/design notes, or scripts/build.sh.\n\n```bash\nnode scripts/missing.mjs\ncat tests/foo.test.js\n```\n\nBut `scripts/real.mjs` counts.';
    assert.deepEqual(extractPathRefs(text), ['scripts/real.mjs']);
  });
});

describe('repository validation', () => {
  test('the real checkout passes every slice', () => {
    for (const slice of [1, 2, 3]) assert.equal(failures(ROOT, slice), '', `slice ${slice}`);
  });

  test('CLI exits 0 on a valid copy and honours --slice and --root', () => {
    const root = copyRepo();
    for (const slice of ['1', '2', '3']) {
      const res = cli(root, [`--slice=${slice}`]);
      assert.equal(res.status, 0, res.stdout);
      assert.match(res.stdout, new RegExp(`verify --slice=${slice}: \\d+ checks, \\d+ passed, 0 failed -> PASS`));
      assert.match(res.stdout, /^\[PASS\] /m);
    }
    const viaRoot = cli(ROOT, ['--root', root, '--quiet']);
    assert.equal(viaRoot.status, 0, viaRoot.stdout);
    assert.doesNotMatch(viaRoot.stdout, /\[PASS\]/);
  });

  test('CLI exits 1 with [FAIL] diagnostics on an invalid copy', () => {
    const root = copyRepo();
    fs.mkdirSync(path.join(root, 'skills/rc-audit'));
    const res = cli(root);
    assert.equal(res.status, 1);
    assert.match(res.stdout, /\[FAIL\] S1 skills\/ holds only approved top-level skills/);
    assert.match(res.stdout, /-> FAIL/);
  });

  test('CLI rejects an unknown slice or flag, and a value on a boolean flag', () => {
    assert.equal(cli(ROOT, ['--slice=4']).status, 1);
    assert.equal(cli(ROOT, ['--nope']).status, 1);
    const res = cli(ROOT, ['--quiet=false']);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /--quiet takes no value/);
  });

  test('fails on a rogue top-level skill', () => {
    expectFailure((root) => {
      fs.mkdirSync(path.join(root, 'skills/rc-audit'));
      fs.writeFileSync(path.join(root, 'skills/rc-audit/SKILL.md'), '# rogue\n');
    }, /skills\/rc-audit is not one of the 5 approved skills/, 1);
  });

  test('fails when skills is not a directory', () => {
    expectFailure((root) => {
      fs.rmSync(path.join(root, 'skills'), { recursive: true });
      fs.writeFileSync(path.join(root, 'skills'), 'not a directory\n');
    }, /skills exists but is not a directory/, 1);
  });

  test('fails on forbidden root entries', () => {
    expectFailure((root) => fs.writeFileSync(path.join(root, 'spec.md'), '# stray\n'), /spec\.md must not exist at the repository root/, 1);
    // No spec lives at the root any more, not even a copy of the system spec.
    expectFailure((root) => fs.copyFileSync(path.join(root, SYSTEM_SPEC), path.join(root, 'SPEC.md')), /SPEC\.md must not exist at the repository root/, 1);
  });

  test('accepts additional documentation alongside the required decisions log', () => {
    const root = copyRepo();
    fs.writeFileSync(path.join(root, 'docs/operator-guide.md'), '# Operator guide\n');
    fs.mkdirSync(path.join(root, 'docs/reference'));
    fs.writeFileSync(path.join(root, 'docs/reference/terms.md'), '# Terms\n');
    assert.equal(failures(root), '');
    fs.rmSync(path.join(root, 'docs/decisions.md'));
    assert.match(failures(root, 1), /required file docs\/decisions\.md/);
  });

  test('prose that merely looks like a path does not break the cross-reference check', () => {
    const root = copyRepo();
    edit(root, 'docs/decisions.md', (t) => `${t}\nSee engineering/product decisions and the tests/foo.test.js example.\n`);
    assert.equal(failures(root), '');
  });

  test('fails when one of the 5 skills is missing', () => {
    expectFailure((root) => fs.rmSync(path.join(root, 'skills/rc-retro'), { recursive: true }), /skills\/rc-retro is missing/);
  });

  test('fails on a top-level playbooks directory or one in the wrong place', () => {
    expectFailure((root) => fs.mkdirSync(path.join(root, 'playbooks')), /playbooks live only under skills\/rc-router\/playbooks/, 1);
    expectFailure((root) => fs.mkdirSync(path.join(root, 'skills/rc-doctor/playbooks')), /playbooks live only under/, 1);
  });

  test('fails on a hardcoded model name in a skill', () => {
    expectFailure(
      (root) => edit(root, 'skills/rc-doctor/SKILL.md', (t) => `${t}\nEscalate to Claude Opus 5.5 when stuck.\n`),
      /skill rc-doctor[\s\S]*hardcoded model name/,
    );
  });

  test('fails on a hardcoded model name in a playbook', () => {
    expectFailure(
      (root) => edit(root, PLAYBOOK, (t) => t.replace('`primary_builder` implements', 'Gemini 4 Neon implements')),
      /playbook engineering\/feature-build[\s\S]*hardcoded model name/,
      2,
    );
  });

  test('fails on a model catalog id in the router skill', () => {
    expectFailure((root) => edit(root, 'skills/rc-router/SKILL.md', (t) => `${t}\nDispatch to gpt-6.2-sol.\n`), /skill rc-router[\s\S]*hardcoded model name/, 2);
  });

  test('fails on a model name in rules, contracts or AGENTS.md', () => {
    expectFailure((root) => edit(root, 'rules/study.md', (t) => `${t}\n- Prefer Gemini 4 Neon.\n`), /rules\/study\.md line \d+: hardcoded model name/, 2);
  });

  test('fails when the ROUTER-ONLY rule is missing', () => {
    expectFailure((root) => edit(root, PLAYBOOK, (t) => t.replace(`> ${ROUTER_ONLY_RULE}\n`, '')), /missing the verbatim ROUTER-ONLY: rule/, 2);
  });

  test('fails when the ROUTER-ONLY rule is reworded', () => {
    expectFailure(
      (root) => edit(root, PLAYBOOK, (t) => t.replace('Never execute this playbook standalone', 'Avoid executing this playbook standalone')),
      /missing the verbatim ROUTER-ONLY: rule/,
      2,
    );
    expectFailure(
      (root) => edit(root, 'skills/rc-router/playbooks/TEMPLATE.md', (t) => t.replace('MUST ONLY', 'should only')),
      /TEMPLATE\.md[\s\S]*ROUTER-ONLY/,
      2,
    );
  });

  test('fails when a playbook is not router_only, or drifts from its canonical tier and floor', () => {
    expectFailure((root) => edit(root, PLAYBOOK, (t) => t.replace('entry_mode: router_only', 'entry_mode: standalone')), /entry_mode must be "router_only"/, 2);
    expectFailure((root) => edit(root, PLAYBOOK, (t) => t.replace('default_tier: 2', 'default_tier: 1')), /default_tier must be 2/, 2);
    expectFailure((root) => edit(root, PLAYBOOK, (t) => t.replace('required_assurance: A2', 'required_assurance: A1')), /required_assurance must be "A2"/, 2);
    expectFailure((root) => edit(root, PLAYBOOK, (t) => t.replace('profile: rcstack-engineering', 'profile: rcstack-study')), /profile must be "rcstack-engineering"/, 2);
  });

  test('fails when a playbook is added, removed, or lacks its negative boundary', () => {
    expectFailure((root) => fs.copyFileSync(path.join(root, PLAYBOOK), path.join(root, 'skills/rc-router/playbooks/study/feature-build.md')), /study\/feature-build\.md is not part of the system spec's tree/, 2);
    expectFailure((root) => fs.rmSync(path.join(root, PLAYBOOK)), /feature-build\.md is missing/, 2);
    expectFailure((root) => edit(root, PLAYBOOK, (t) => t.replace('## Do NOT Use When', '## When Not To Use')), /headings must be exactly/, 2);
    expectFailure(
      (root) => edit(root, PLAYBOOK, (t) => t.replace(/## Do NOT Use When[\s\S]*?## Workflow Phases/, '## Do NOT Use When\n\n- Never.\n\n## Workflow Phases')),
      /must point to an alternative playbook or top-level skill/,
      2,
    );
  });

  test('fails when a playbook names an unknown capability or contract, or skips a tier gate', () => {
    expectFailure((root) => edit(root, PLAYBOOK, (t) => t.replace('  - primary_builder\n', '  - mega_builder\n')), /"mega_builder" is not an abstract capability/, 2);
    expectFailure((root) => edit(root, PLAYBOOK, (t) => t.replace('  - contracts/spec.md\n', '  - contracts/plan.md\n')), /"contracts\/plan\.md" is not a known contracts\/\* path/, 2);
    expectFailure((root) => edit(root, PLAYBOOK, (t) => t.replace('  - independent_reviewer\n', '')), /require_cross_model_audit[\s\S]*independent_reviewer/, 2);
    expectFailure((root) => edit(root, PLAYBOOK, (t) => t.replaceAll('rc-receipt.mjs', 'the gate')), /require_receipt_gate[\s\S]*rc-receipt\.mjs/, 2);
  });

  test('enforces require_verify on ordinary Tier 1 playbooks and other gates on study/socratic-session', () => {
    const socratic = 'skills/rc-router/playbooks/study/socratic-session.md';
    const recall = 'skills/rc-router/playbooks/study/recall-and-drill.md';
    const vibe = 'skills/rc-router/playbooks/engineering/vibe-iterate.md';

    // Shipped socratic-session passes, while enabling another gate on Tier 1 still fails it.
    assert.equal(failures(ROOT, 2), '');
    expectFailure(
      (root) => edit(root, 'profiles/rcstack-study.yaml', (t) => t.replace(/("1":[\s\S]*?)require_spec: false/, '$1require_spec: true')),
      /playbook study\/socratic-session[\s\S]*profile gate require_spec \(Tier 1\): contracts must list contracts\/spec\.md/,
      2,
    );
    expectFailure(
      (root) => edit(root, 'profiles/rcstack-study.yaml', (t) => t.replace(/("1":[\s\S]*?)log_telemetry: false/, '$1log_telemetry: true')),
      /playbook study\/socratic-session[\s\S]*profile gate log_telemetry \(Tier 1\): the workflow or exit gate must use `rc-log\.mjs`/,
      2,
    );

    // Ordinary Tier 1 playbooks omitting verification fail require_verify, even if labeled A0.
    expectFailure(
      (root) => edit(root, recall, (t) => t.replaceAll('verify', 'check').replaceAll('Verify', 'Check')),
      /playbook study\/recall-and-drill[\s\S]*profile gate require_verify \(Tier 1\): the workflow or exit gate must use `verify`/,
      2,
    );
    expectFailure(
      (root) => edit(root, vibe, (t) => t.replaceAll('verify', 'check').replaceAll('Verify', 'Check')),
      /playbook engineering\/vibe-iterate[\s\S]*profile gate require_verify \(Tier 1\): the workflow or exit gate must use `verify`/,
      2,
    );
    expectFailure(
      (root) =>
        edit(root, recall, (t) =>
          t.replace('required_assurance: A1', 'required_assurance: A0').replaceAll('verify', 'check').replaceAll('Verify', 'Check'),
        ),
      /playbook study\/recall-and-drill[\s\S]*frontmatter required_assurance must be "A1"[\s\S]*profile gate require_verify \(Tier 1\)/,
      2,
    );

    // Socratic escalated above its default Tier 1/A0 loses the require_verify exemption.
    expectFailure(
      (root) => edit(root, socratic, (t) => t.replace('default_tier: 1', 'default_tier: 2')),
      /playbook study\/socratic-session[\s\S]*frontmatter default_tier must be 1[\s\S]*profile gate require_verify \(Tier 1\)/,
      2,
    );
  });

  test('an A0 label alone never qualifies a playbook for the require_verify exception', () => {
    const socratic = { domain: 'study', name: 'socratic-session', tier: 1, assurance: 'A0' };
    const otherA0 = { domain: 'study', name: 'recall-and-drill', tier: 1, assurance: 'A0' };
    const engA0 = { domain: 'engineering', name: 'vibe-iterate', tier: 1, assurance: 'A0' };
    const wrongDomain = { domain: 'engineering', name: 'socratic-session', tier: 1, assurance: 'A0' };
    const escalated = { domain: 'study', name: 'socratic-session', tier: 2, assurance: 'A0' };
    const raisedFloor = { domain: 'study', name: 'socratic-session', tier: 1, assurance: 'A1' };

    assert.equal(isGateExempt('require_verify', socratic), true);
    for (const flag of ['require_spec', 'require_state_file', 'require_receipt_gate', 'require_cross_model_audit', 'require_review_map', 'log_telemetry']) {
      assert.equal(isGateExempt(flag, socratic), false, `socratic is not exempt from ${flag}`);
    }
    for (const pb of [otherA0, engA0, wrongDomain, escalated, raisedFloor]) {
      assert.equal(isGateExempt('require_verify', pb), false, `${pb.domain}/${pb.name} T${pb.tier}/${pb.assurance}`);
      const errs = checkPlaybookGates({
        playbook: pb,
        tierConfig: { require_verify: true },
        contracts: [],
        capabilities: ['vibe_executor'],
        workflow: '1. Frame\n2. Close\n',
      });
      assert.match(errs.join('\n'), new RegExp(`profile gate require_verify \\(Tier ${pb.tier}\\): the workflow or exit gate must use \`verify\``));
    }

    // Canonical study/socratic-session T1/A0 skips only require_verify while other enabled gates still fire.
    assert.deepEqual(
      checkPlaybookGates({
        playbook: socratic,
        tierConfig: { require_verify: true },
        contracts: [],
        capabilities: ['vibe_executor'],
        workflow: '1. Frame\n2. Close\n',
      }),
      [],
    );
    const otherGates = checkPlaybookGates({
      playbook: socratic,
      tierConfig: { require_verify: true, require_spec: true, log_telemetry: true },
      contracts: [],
      capabilities: ['vibe_executor'],
      workflow: '1. Frame\n2. Close\n',
    });
    assert.equal(otherGates.length, 2);
    assert.match(otherGates.join('\n'), /profile gate require_spec \(Tier 1\)/);
    assert.match(otherGates.join('\n'), /profile gate log_telemetry \(Tier 1\)/);
  });

  test('fails when reviewer == builder anywhere in a review matrix', () => {
    const profile = 'profiles/rcstack-engineering.yaml';
    expectFailure(
      (root) => edit(root, profile, (t) => t.replace('  "Gemini 4 Neon":\n    primary: "Claude Opus 5.5"', '  "Gemini 4 Neon":\n    primary: "Gemini 4 Neon"')),
      /reviewer == builder: review_matrix\["Gemini 4 Neon"\]\.primary/,
      2,
    );
    expectFailure(
      (root) => edit(root, profile, (t) => t.replace('  "Claude Opus 5.5":\n    primary: "Gemini 4 Neon"\n    fallback: "Cursor Grok 4.7"', '  "Claude Opus 5.5":\n    primary: "Gemini 4 Neon"\n    fallback: "Claude Opus 5.5"')),
      /reviewer == builder: review_matrix\["Claude Opus 5.5"\]\.fallback/,
      2,
    );
    expectFailure((root) => edit(root, profile, (t) => t.replace('tier1_primary: "Gemini 4 Neon"', 'tier1_primary: "GPT 6.2 Sol"')), /reviewer == builder: review_matrix\["GPT 6.2 Sol"\]\.tier1_primary/, 2);
    expectFailure((root) => edit(root, profile, (t) => t.replace('default_fallback: "Cursor Grok 4.7"', 'default_fallback: "Gemini 4 Neon"')), /default_fallback "Gemini 4 Neon" is also a builder model/, 2);
  });

  test('fails when reviewer == builder is hidden behind a different spelling of the same model', () => {
    const profile = 'profiles/rcstack-engineering.yaml';
    expectFailure(
      (root) => edit(root, profile, (t) => t.replace('  "Gemini 4 Neon":\n    primary: "Claude Opus 5.5"', '  "Gemini 4 Neon":\n    primary: "gemini-4-neon"')),
      /reviewer == builder: review_matrix\["Gemini 4 Neon"\]\.primary/,
      2,
    );
    expectFailure(
      (root) => edit(root, profile, (t) => t.replace('  "Gemini 4 Neon":\n    primary: "Claude Opus 5.5"\n    fallback: "Cursor Grok 4.7"', '  "Gemini 4 Neon":\n    primary: "Claude Opus 5.5"\n    fallback: "claude-opus-5-5"')),
      /review_matrix\["Gemini 4 Neon"\]: primary and fallback reviewer are the same model/,
      2,
    );
    expectFailure((root) => edit(root, profile, (t) => t.replace('default_fallback: "Cursor Grok 4.7"', 'default_fallback: "gemini_4_neon"')), /default_fallback "gemini_4_neon" is also a builder model/, 2);
    expectFailure(
      (root) => edit(root, profile, (t) => t.replace('  "Claude Sonnet 5.5":\n    primary: "Gemini 4 Neon"\n    fallback: "Cursor Grok 4.7"', '  "Claude Sonnet 5.5":\n    primary: "Gemini 4 Neon"\n    fallback: "Cursor Grok 4.7"\n  "claude-sonnet-5-5":\n    primary: "Claude Sonnet 5.5"\n    fallback: "Cursor Grok 4.7"')),
      /lists the same builder model twice: "Claude Sonnet 5\.5" and "claude-sonnet-5-5"/,
      2,
    );
    expectFailure(
      (root) => edit(root, profile, (t) => t.replace('    paired:\n      driver_kind: "codex"\n      model: "GPT 6.2 Astra"', '    paired:\n      driver_kind: "codex"\n      model: "gemini-4-hydrogen"')),
      /quick_lookup is exclusive but "Gemini 4 Hydrogen" is also bound/,
      2,
    );
    expectFailure((root) => edit(root, profile, (t) => t.replace('tier1_primary: "Gemini 4 Neon"', 'tier1_primary: "gpt-6.2-sol"')), /reviewer == builder: review_matrix\["GPT 6\.2 Sol"\]\.tier1_primary/, 2);
    // A catalog id that puts the version before the model name is still the same model.
    expectFailure(
      (root) => edit(root, profile, (t) => t.replace('  "Claude Opus 5.5":\n    primary: "Gemini 4 Neon"', '  "Claude Opus 5.5":\n    primary: "claude-5-5-opus"')),
      /reviewer == builder: review_matrix\["Claude Opus 5\.5"\]\.primary/,
      2,
    );
    expectFailure((root) => edit(root, profile, (t) => t.replace('default_fallback: "Cursor Grok 4.7"', 'default_fallback: "gpt-astra-6.2"')), /default_fallback "gpt-astra-6\.2" is also a builder model/, 2);
    // A binding spelled as a catalog id is still covered by, and judged against, its matrix entry.
    const root = copyRepo();
    edit(root, profile, (t) => t.replace('    model: "Claude Fable 5.2"\n    secondary:', '    model: "claude-fable-5-2"\n    secondary:'));
    assert.equal(failures(root, 2), '');
  });

  test('fails when a builder model has no reviewer entry, or self-review is switched on', () => {
    const profile = 'profiles/rcstack-study.yaml';
    expectFailure((root) => edit(root, profile, (t) => t.replace(/  "Claude Sonnet 5\.5":\n    primary: "[^"]+"\n    fallback: "[^"]+"\n/, '')), /no entry for builder model "Claude Sonnet 5\.5"/, 2);
    expectFailure((root) => edit(root, profile, (t) => t.replace('allow_self_review_on_fallback: false', 'allow_self_review_on_fallback: true')), /allow_self_review_on_fallback: must equal false/, 2);
    expectFailure((root) => edit(root, profile, (t) => t.replace('require_reviewer_not_equal_builder: true', 'require_reviewer_not_equal_builder: false')), /require_reviewer_not_equal_builder: must equal true/, 2);
  });

  test('fails on a profile that breaks the strict YAML subset, the schema, or portability', () => {
    const profile = 'profiles/rcstack-research.yaml';
    expectFailure((root) => edit(root, profile, (t) => t.replace('  require_fresh_context_audit', '\trequire_fresh_context_audit')), /tab characters are not allowed/, 2);
    expectFailure((root) => edit(root, profile, (t) => t.replace('    name: "lookup"', '     name: "lookup"')), /not a multiple of 2/, 2);
    expectFailure((root) => edit(root, profile, (t) => t.replace('required_assurance: "A2"', 'required_assurance: "A1"')), /risk_tiers\.2\.required_assurance: must equal "A2"/, 2);
    expectFailure((root) => edit(root, profile, (t) => t.replace(/("2":[\s\S]*?)require_receipt_gate: true/, '$1require_receipt_gate: false')), /risk_tiers\["2"\]\.require_receipt_gate must be true/, 2);
    expectFailure(
      (root) => edit(root, profile, (t) => t.replace('    driver_kind: "claudeAgent"\n    model: "Claude Fable 5.2"', '    driver_kind: "claudeAgent"\n    model: "Claude Fable 5.2"\n    options:\n      session: "3f2a9c1e-5b7d-4e8a-9c1f-0a2b3c4d5e6f"')),
      /machine-specific UUIDs are not portable/,
      2,
    );
    expectFailure((root) => edit(root, profile, (t) => t.replace('    exclusive: true', '    exclusive: true\n  extra_capability:\n    driver_kind: "x"\n    model: "Y"')), /capabilities\.extra_capability: unknown property/, 2);
  });

  test('fails when an exclusive model is bound to a second capability', () => {
    expectFailure(
      (root) => edit(root, 'profiles/rcstack-study.yaml', (t) => t.replace('      driver_kind: "external"\n      model: "Gemini Notebook"', '      driver_kind: "external"\n      model: "Gemini 4 Hydrogen"')),
      /quick_lookup is exclusive but "Gemini 4 Hydrogen" is also bound/,
      2,
    );
  });

  test('fails on a skill that breaks the skill contract', () => {
    const skill = 'skills/rc-init/SKILL.md';
    expectFailure((root) => edit(root, skill, (t) => t.replace('## Definition of Done', '## Done')), /skill rc-init[\s\S]*headings must be exactly/);
    expectFailure((root) => edit(root, skill, (t) => t.replace('entry_mode: standalone_or_router', 'entry_mode: front_door')), /entry_mode must be "standalone_or_router"/);
    expectFailure((root) => edit(root, skill, (t) => t.replace('name: rc-init', 'name: rc-bootstrap')), /name "rc-bootstrap" must equal "rc-init"/);
    expectFailure((root) => edit(root, skill, (t) => t.replace('capability: bootstrap\n', '')), /frontmatter is missing "capability"/);
    expectFailure((root) => edit(root, skill, (t) => t.replaceAll('rc-router', 'the router')), /must say when to defer to rc-router/);
    expectFailure((root) => edit(root, 'skills/rc-router/SKILL.md', (t) => t.replaceAll('Tier 0', 'trivial')), /skip heavy ceremony for Tier 0 lookups/, 2);
    expectFailure((root) => edit(root, 'skills/rc-router/SKILL.md', (t) => t.replace('  - scripts/rc-receipt.mjs\n', '')), /rc-router must invoke scripts\/rc-receipt\.mjs/, 2);
    expectFailure((root) => fs.writeFileSync(path.join(root, 'skills/rc-init/NOTES.md'), 'x\n'), /skills\/rc-init\/NOTES\.md is not part of the system spec's tree/);
  });

  test('fails on a missing contract, rule, script or test, and on stray files in closed directories', () => {
    expectFailure((root) => fs.rmSync(path.join(root, 'contracts/review-map.md')), /contracts\/review-map\.md is missing/, 2);
    expectFailure((root) => fs.rmSync(path.join(root, 'rules/research.md')), /rules\/research\.md is missing/, 2);
    expectFailure((root) => fs.rmSync(path.join(root, 'scripts/rc-log.mjs')), /scripts\/rc-log\.mjs is missing/);
    expectFailure((root) => fs.rmSync(path.join(root, 'tests/rc-state.test.mjs')), /tests\/rc-state\.test\.mjs is missing/);
    expectFailure((root) => fs.writeFileSync(path.join(root, 'scripts/helper.mjs'), 'export {};\n'), /scripts\/helper\.mjs is not part of the system spec's tree/);
    expectFailure((root) => edit(root, 'contracts/telemetry-event.schema.json', (t) => t.replace('"overridden",\n', '')), /"overridden" is not required/, 2);
    expectFailure((root) => edit(root, 'contracts/work-receipt.md', (t) => t.replaceAll('review_hotspot', 'hotspot')), /missing "review_hotspot"/, 2);
  });

  test('fails on a script with a syntax error or a non-executable installer', () => {
    expectFailure((root) => fs.appendFileSync(path.join(root, 'scripts/rc-log.mjs'), '\nconst = ;\n'), /scripts\/rc-log\.mjs passes node --check/);
    expectFailure((root) => fs.chmodSync(path.join(root, 'adapters/install.sh'), 0o644), /is not executable/);
    expectFailure((root) => fs.appendFileSync(path.join(root, 'adapters/install.sh'), '\nif then\n'), /bash -n/);
  });

  test('fails on a third-party import, package dependencies, or node_modules', () => {
    expectFailure((root) => fs.appendFileSync(path.join(root, 'scripts/rc-log.mjs'), "\nimport yaml from 'js-yaml';\n"), /imports "js-yaml"/, 1);
    expectFailure((root) => fs.appendFileSync(path.join(root, 'scripts/rc-log.mjs'), "\nimport fs2 from 'fs';\n"), /imports "fs"/, 1);
    expectFailure((root) => fs.appendFileSync(path.join(root, 'scripts/rc-log.mjs'), '\nimport x\nfrom "lodash";\n'), /imports "lodash"/, 1);
    expectFailure((root) => fs.appendFileSync(path.join(root, 'scripts/rc-log.mjs'), "\nimport {\n  a,\n  b,\n} from 'left-pad';\n"), /imports "left-pad"/, 1);
    expectFailure((root) => fs.appendFileSync(path.join(root, 'scripts/rc-log.mjs'), "\nexport * from 'chalk';\n"), /imports "chalk"/, 1);
    const required = ["\nconst r = requ", "ire('ajv');\n"].join('');
    expectFailure((root) => fs.appendFileSync(path.join(root, 'tests/rc-log.test.mjs'), required), /imports "ajv"/, 1);
    const computed = ['\nconst name = "x";\nconst m = await imp', 'ort(name);\n'].join('');
    expectFailure((root) => fs.appendFileSync(path.join(root, 'scripts/rc-log.mjs'), computed), /computed specifier/, 1);
  });

  test('the dependency scan needs no whitespace or statement boundary and sees through comments', () => {
    // Keywords are assembled at run time: the scan reads this file too, and must not trip on it.
    const IMP = ['imp', 'ort'].join('');
    const EXP = ['exp', 'ort'].join('');
    const REQ = ['requ', 'ire'].join('');
    const cases = {
      'a named load with no spaces': [`${IMP}{readFileSync}from"fs";`, /imports "fs"/],
      'a namespace load with no spaces': [`${IMP}*as x from"lodash";`, /imports "lodash"/],
      'a side-effect load with no space': [`${IMP}"lodash";`, /imports "lodash"/],
      'a re-export with no spaces': [`${EXP}{x}from"lodash";`, /imports "lodash"/],
      'a comment before the statement': [`/* ok */ ${IMP} x from "lodash";`, /imports "lodash"/],
      'a comment inside the statement': [`${IMP} x from /* c */ "lodash";`, /imports "lodash"/],
      'a line comment inside the statement': [`${IMP} x from // c\n "lodash";`, /imports "lodash"/],
      'a statement after a string holding two slashes': [`const u = "http://x"; ${IMP} y from "lodash";`, /imports "lodash"/],
      'a computed legacy load': [`const pkg = "lodash"; const x = ${REQ}(pkg);`, /computed specifier/],
    };
    for (const [label, [code, pattern]] of Object.entries(cases)) {
      const root = copyRepo();
      fs.appendFileSync(path.join(root, 'scripts/rc-log.mjs'), `\n${code}\n`);
      assert.match(failures(root, 1), pattern, label);
    }
    // Built-ins and relative files stay allowed in every one of those shapes.
    const root = copyRepo();
    fs.appendFileSync(path.join(root, 'scripts/rc-log.mjs'), `\n${IMP}{constants}from"node:os";\n${EXP}{parseYaml}from"./verify.mjs";\n/* c */ ${IMP} "node:path";\n`);
    assert.equal(failures(root, 1), '');
    expectFailure((root) => fs.writeFileSync(path.join(root, 'package.json'), '{"dependencies":{"ajv":"^8.0.0"}}'), /package\.json declares dependencies/, 1);
    expectFailure((root) => fs.mkdirSync(path.join(root, 'node_modules')), /node_modules\/ must not exist/, 1);
  });

  test('fails on a symbolic link anywhere in the source tree', () => {
    expectFailure((root) => fs.symlinkSync(path.join(root, 'README.md'), path.join(root, 'skills/rc-setup/README.md')), /skills\/rc-setup\/README\.md is a symbolic link/, 1);
  });

  test('fails on a decisions entry without its Rejected Alternative or Guardrail', () => {
    expectFailure((root) => edit(root, 'docs/decisions.md', (t) => t.replace('- **Guardrail:**', '- **Protection:**')), /DEC-001 is missing "Guardrail:"/, 1);
    expectFailure((root) => edit(root, 'docs/decisions.md', (t) => t.replace('- **Rejected Alternative:**', '- **Alternative:**')), /DEC-001 is missing "Rejected Alternative:"/, 1);
    expectFailure((root) => fs.writeFileSync(path.join(root, 'docs/decisions.md'), '# Decisions\n'), /no "## DEC-NNN" entry found/, 1);
  });

  test('fails when AGENTS.md grows to 100 lines or drops the verify command', () => {
    expectFailure((root) => fs.appendFileSync(path.join(root, 'AGENTS.md'), '\n- filler'.repeat(20)), /must be < 100/, 1);
    expectFailure((root) => edit(root, 'AGENTS.md', (t) => t.replaceAll('node scripts/verify.mjs', 'the validator')), /does not name `node scripts\/verify\.mjs`/, 1);
  });

  test('fails on a cross-reference that does not resolve', () => {
    expectFailure((root) => edit(root, 'skills/rc-retro/SKILL.md', (t) => `${t}\nSee \`contracts/retro-report.md\`.\n`), /skills\/rc-retro\/SKILL\.md refers to contracts\/retro-report\.md/);
    expectFailure((root) => edit(root, 'rules/engineering.md', (t) => `${t}\nRoute to \`engineering/hotfix\`.\n`), /playbooks\/engineering\/hotfix\.md, which does not exist/);
  });
});

describe('feature-local specs', () => {
  /** Build a specs tree under os.tmpdir() from { 'relative/path': 'content' | null (directory) }. */
  function specsTree(files) {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rcstack-specs-'));
    tmpDirs.push(base);
    const dir = path.join(base, 'specs');
    fs.mkdirSync(dir);
    for (const [rel, content] of Object.entries(files)) {
      const target = path.join(dir, rel);
      if (content === null) fs.mkdirSync(target, { recursive: true });
      else {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content);
      }
    }
    return dir;
  }
  const SPEC = '# Spec: something\n\nBody.\n';

  test('accepts a spec directory, companion documents, and sub-specs nested inside their parent', () => {
    const dir = specsTree({
      'billing/spec.md': SPEC,
      'billing/requirements.md': 'Needs.\n',
      'billing/planning.md': 'Plan.\n',
      'billing/diagram.png': 'binary',
      'billing/invoices/spec.md': SPEC,
      'billing/invoices/planning.md': 'Sub-plan.\n',
      'billing/invoices/pdf-export/spec.md': '---\nowner: me\n---\n\n# Spec: PDF export\n',
      'onboarding-2/spec.md': SPEC,
    });
    assert.deepEqual(checkSpecsTree(dir), []);
  });

  test('accepts an empty specs directory elsewhere, but this repository always has its system spec', () => {
    // Any other repository may have an empty specs/ directory, or none at all.
    const empty = specsTree({});
    assert.deepEqual(checkSpecsTree(empty), []);
    assert.equal(cli(ROOT, ['--specs', empty]).status, 0);
    // This one keeps its system spec there, so it cannot do without the directory.
    expectFailure((root) => fs.rmSync(path.join(root, 'specs'), { recursive: true }), /S1 required file specs\/initialization-build\/spec\.md\nmissing/, 1);
    expectFailure((root) => fs.rmSync(path.join(root, 'specs/initialization-build'), { recursive: true }), /S1 required file specs\/initialization-build\/spec\.md\nmissing/, 1);
    // The other specs are free to come and go.
    const root = copyRepo();
    fs.rmSync(path.join(root, 'specs/feature-local-specs'), { recursive: true });
    assert.equal(failures(root), '');
  });

  const invalid = {
    'a loose file directly under specs/': [{ 'notes.md': 'x', 'a/spec.md': SPEC }, /^specs\/notes\.md is a loose file: specs\/ holds only spec directories$/],
    'a top-level directory without spec.md': [{ 'a/planning.md': 'x' }, /^specs\/a\/ has no spec\.md/],
    'a sub-directory without spec.md': [{ 'a/spec.md': SPEC, 'a/b/planning.md': 'x' }, /^specs\/a\/b\/ has no spec\.md/],
    'a sub-spec whose parent has no spec.md': [{ 'a/b/spec.md': SPEC }, /^specs\/a\/ has no spec\.md: every directory under specs\/ is a spec directory, and a sub-spec lives inside its parent's$/],
    'a deep sub-spec with a gap in its chain': [{ 'a/spec.md': SPEC, 'a/b/c/spec.md': SPEC }, /^specs\/a\/b\/ has no spec\.md/],
    'an empty directory': [{ 'a/spec.md': SPEC, 'a/empty': null }, /^specs\/a\/empty\/ has no spec\.md/],
    'a capitalized name': [{ 'Billing/spec.md': SPEC }, /^specs\/Billing\/ is not a lowercase kebab-case name$/],
    'a name with a space': [{ 'my feature/spec.md': SPEC }, /^specs\/my feature\/ is not a lowercase kebab-case name$/],
    'a name with an underscore, in a sub-spec': [{ 'a/spec.md': SPEC, 'a/sub_spec/spec.md': SPEC }, /^specs\/a\/sub_spec\/ is not a lowercase kebab-case name$/],
    'a hidden directory': [{ '.cache/spec.md': SPEC }, /^specs\/\.cache\/ is not a lowercase kebab-case name$/],
    'an empty spec.md': [{ 'a/spec.md': '' }, /^specs\/a\/spec\.md is empty$/],
    'a whitespace-only spec.md': [{ 'a/spec.md': ' \n\t\r\n' }, /^specs\/a\/spec\.md is empty$/],
    'a spec.md holding only a byte-order mark': [{ 'a/spec.md': '\uFEFF\n' }, /^specs\/a\/spec\.md is empty$/],
    'a spec.md that is a directory': [{ 'a/spec.md': null }, /^specs\/a\/spec\.md is not a regular file$/],
    'a differently cased SPEC.md': [{ 'a/SPEC.md': SPEC }, /^specs\/a\/ has no spec\.md/],
  };
  for (const [label, [files, pattern]] of Object.entries(invalid)) {
    test(`rejects ${label}`, () => {
      const errors = checkSpecsTree(specsTree(files));
      assert.ok(errors.some((e) => pattern.test(e)), `${label}: ${JSON.stringify(errors)}`);
    });
  }

  test('rejects symbolic links, including a symlinked spec.md and a symlinked specs directory', () => {
    const dir = specsTree({ 'a/spec.md': SPEC, 'real/spec.md': SPEC });
    fs.symlinkSync(path.join(dir, 'a'), path.join(dir, 'alias'));
    fs.symlinkSync(path.join(dir, 'a', 'spec.md'), path.join(dir, 'real', 'linked.md'));
    assert.deepEqual(checkSpecsTree(dir), ['specs/alias is a symbolic link', 'specs/real/linked.md is a symbolic link']);

    const linkedSpec = specsTree({ 'a/spec.md': SPEC, 'b/requirements.md': 'x' });
    fs.symlinkSync(path.join(linkedSpec, 'a', 'spec.md'), path.join(linkedSpec, 'b', 'spec.md'));
    assert.deepEqual(checkSpecsTree(linkedSpec), ['specs/b/spec.md is a symbolic link'], 'a symlink is never a spec');

    const base = path.dirname(dir);
    fs.symlinkSync(dir, path.join(base, 'specs-link'));
    assert.deepEqual(checkSpecsTree(path.join(base, 'specs-link'), 'specs-link'), ['specs-link exists but is not a directory']);
    assert.deepEqual(checkSpecsTree(path.join(base, 'missing')), ['specs/ does not exist']);
  });

  test('a spec directory may be named for its subject, including "playbooks"', () => {
    const root = copyRepo();
    for (const rel of ['specs/playbooks/spec.md', 'specs/feature-local-specs/playbooks/spec.md']) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), SPEC);
    }
    fs.writeFileSync(path.join(root, 'specs/feature-local-specs/playbooks/playbooks'), 'a companion file with that name\n');
    assert.equal(failures(root), '');
    // Outside specs/ the rule is unchanged.
    for (const stray of ['playbooks', 'skills/rc-doctor/playbooks', 'docs/playbooks', 'scripts/playbooks']) {
      const copy = copyRepo();
      fs.mkdirSync(path.join(copy, stray), { recursive: true });
      assert.match(failures(copy, 1), /playbooks live only under skills\/rc-router\/playbooks/, stray);
    }
  });

  test('a trailing slash cannot make a symlinked specs directory look real', () => {
    const dir = specsTree({ 'a/spec.md': SPEC });
    const link = path.join(path.dirname(dir), 'specs-link');
    fs.symlinkSync(dir, link);
    for (const form of [link, `${link}/`, `${link}//`, `${link}/.`, `${link}/./`, `${path.dirname(link)}/x/../specs-link/`]) {
      assert.deepEqual(checkSpecsTree(form, 'specs-link'), ['specs-link exists but is not a directory'], form);
    }
    const dangling = path.join(path.dirname(dir), 'dangling');
    fs.symlinkSync(path.join(path.dirname(dir), 'nowhere'), dangling);
    assert.deepEqual(checkSpecsTree(`${dangling}/`, 'dangling'), ['dangling exists but is not a directory']);
    assert.deepEqual(checkSpecsTree(`${dir}/`), [], 'a real directory with a trailing slash is still accepted');
    assert.equal(cli(ROOT, ['--specs', `${link}/`]).status, 1);
  });

  test('judges the shape of the tree, never the prose: any non-empty spec.md is accepted', () => {
    const documents = {
      'titled': '# Spec: plain\n',
      'untitled': 'Just prose, no heading at all.\n',
      'byte-order-mark': '\uFEFF# Spec: byte-order mark\n',
      'crlf': 'Intro.\r\n\r\n# Spec: CRLF\r\n',
      'frontmatter': '---\nowner: me\n# a comment\n--- \n\n# Spec\n\n---\n\n## Section\n',
      'yaml-end-marker': '---\nowner: me\n...\n\n# Spec\n\n---\n',
      'nested-fences': '````md\n```bash\n# not a heading\n```\n````\n\n# Spec\n',
      'unclosed-fence': '```\n# still code\n',
      'inline-fence': '```inline``` is a code span.\n\n# Spec\n',
      'indented-fence': 'Example:\n\n    ```bash\n    echo hi\n\n# Spec\n',
      'one-character': 'x',
    };
    const files = {};
    for (const [name, text] of Object.entries(documents)) files[`${name}/spec.md`] = text;
    assert.deepEqual(checkSpecsTree(specsTree(files)), []);
  });

  test('an empty or non-string path is reported as missing and never resolved to another directory', () => {
    for (const bad of ['', undefined, null, 0, {}]) assert.deepEqual(checkSpecsTree(bad), ['specs/ does not exist'], String(bad));
    assert.deepEqual(checkSpecsTree('', 'target/specs'), ['target/specs/ does not exist']);
    // The current directory and the filesystem root are valid-looking trees to a careless check.
    assert.notDeepEqual(checkSpecsTree('.'), ['specs/ does not exist'], 'an explicit "." is honoured, not mistaken for empty');
  });

  test('an unreadable spec.md is reported as unreadable, not as untitled', (t) => {
    if (process.getuid?.() === 0) return t.skip('root can read everything');
    const dir = specsTree({ 'a/spec.md': SPEC });
    fs.chmodSync(path.join(dir, 'a', 'spec.md'), 0o000);
    const errors = checkSpecsTree(dir);
    fs.chmodSync(path.join(dir, 'a', 'spec.md'), 0o644);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /^specs\/a\/spec\.md cannot be read: /);
  });

  test('only regular files and spec directories belong in the tree', (t) => {
    const dir = specsTree({ 'a/spec.md': SPEC, 'b/spec.md': null });
    assert.deepEqual(checkSpecsTree(dir), ['specs/b/spec.md is not a regular file'], 'a directory named spec.md is reported once');

    const pipes = specsTree({ 'a/spec.md': SPEC, 'c/planning.md': 'x' });
    const made = ['a/companion-pipe', 'top-level-pipe', 'c/spec.md'].map((rel) => spawnSync('mkfifo', [path.join(pipes, rel)]).status === 0);
    if (!made.every(Boolean)) return t.skip('mkfifo is not available');
    assert.deepEqual(checkSpecsTree(pipes), [
      'specs/a/companion-pipe is not a regular file',
      'specs/c/spec.md is not a regular file',
      'specs/top-level-pipe is not a regular file',
    ]);
    const root = copyRepo();
    assert.equal(spawnSync('mkfifo', [path.join(root, 'specs/feature-local-specs/pipe')]).status, 0);
    assert.match(failures(root, 1), /specs\/feature-local-specs\/pipe is not a regular file/);
  });

  test('a dist path is a valid reference only for what is actually installed', () => {
    const valid = ['~/.rcstack/dist/', '~/.rcstack/dist/skills/', '~/.rcstack/dist/defaults/', '~/.rcstack/dist/defaults/profiles/', '~/.rcstack/dist/scripts/rc-log.mjs',
      '~/.rcstack/dist/defaults/profiles/schema.json', '~/.rcstack/dist/skills/<skill>', '~/.rcstack/dist/contracts/*', '~/.rcstack/dist/rules/<domain>.md',
      '~/.rcstack/dist/defaults/profiles/<profile>.yaml', '~/.rcstack/dist/<dir>/anything', '~/.rcstack/dist/skills/rc-router/../rc-init/SKILL.md'];
    assert.deepEqual(extractPathRefs(valid.map((v) => `\`${v}\``).join(', ')), ['profiles/schema.json', 'scripts/rc-log.mjs', 'skills/rc-init/SKILL.md']);
    // Not installed, so broken: even with placeholders further along, and even when ".." is used to get there.
    const broken = ['~/.rcstack/dist/specs/feature-local-specs/spec.md', '~/.rcstack/dist/tests/verify.test.mjs', '~/.rcstack/dist/specs/<feature>/spec.md',
      '~/.rcstack/dist/skills/../specs/feature-local-specs/spec.md', '~/.rcstack/dist/../profiles/schema.json', '~/.rcstack/dist/defaults/other/x.md', '~/.rcstack/dist/docs/decisions.md'];
    assert.deepEqual(extractPathRefs(broken.map((v) => `\`${v}\``).join(', ')), [...broken].sort());
    expectFailure(
      (root) => edit(root, 'README.md', (t) => `${t}\nSee \`~/.rcstack/dist/specs/feature-local-specs/spec.md\`.\n`),
      /README\.md refers to ~\/\.rcstack\/dist\/specs\/feature-local-specs\/spec\.md, which does not exist/,
    );
  });

  test('reports every violation in one pass, in a stable order', () => {
    const dir = specsTree({ 'b/spec.md': '\n', 'a/x/spec.md': SPEC, 'README.md': 'x' });
    assert.deepEqual(checkSpecsTree(dir), [
      'specs/README.md is a loose file: specs/ holds only spec directories',
      "specs/a/ has no spec.md: every directory under specs/ is a spec directory, and a sub-spec lives inside its parent's",
      'specs/b/spec.md is empty',
    ]);
  });

  test('the repository check runs the layout rules on specs/', () => {
    expectFailure((root) => fs.mkdirSync(path.join(root, 'specs/feature-local-specs/sub-feature')), /S1 specs\/ holds feature-local specs[\s\S]*specs\/feature-local-specs\/sub-feature\/ has no spec\.md/, 1);
    expectFailure((root) => fs.writeFileSync(path.join(root, 'specs/TODO.md'), 'x\n'), /specs\/TODO\.md is a loose file/, 1);
    expectFailure((root) => fs.symlinkSync(path.join(root, SYSTEM_SPEC), path.join(root, 'specs/feature-local-specs/system.md')), /specs\/feature-local-specs\/system\.md is a symbolic link/, 1);
    expectFailure((root) => {
      fs.rmSync(path.join(root, 'specs'), { recursive: true });
      fs.writeFileSync(path.join(root, 'specs'), 'not a directory\n');
    }, /specs exists but is not a directory/, 1);

    // The shape the feature exists for: a parent spec, a sub-spec, and working documents beside both.
    const root = copyRepo();
    for (const rel of ['specs/payments/spec.md', 'specs/payments/refunds/spec.md']) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), SPEC);
    }
    for (const rel of ['specs/payments/requirements.md', 'specs/payments/refunds/planning.md']) fs.writeFileSync(path.join(root, rel), 'notes\n');
    assert.equal(failures(root), '');
  });

  test('a document that points at a spec path must point at one that exists', () => {
    expectFailure((root) => edit(root, 'README.md', (t) => `${t}\nSee \`specs/does-not-exist/spec.md\`.\n`), /README\.md refers to specs\/does-not-exist\/spec\.md, which does not exist/);
    const root = copyRepo();
    edit(root, 'README.md', (t) => `${t}\nSee \`specs/feature-local-specs/spec.md\`.\n`);
    assert.equal(failures(root), '');
  });

  test('the system spec lives in specs/, is required there, and its references must resolve', () => {
    assert.equal(SYSTEM_SPEC, 'specs/initialization-build/spec.md');
    assert.ok(fs.existsSync(path.join(ROOT, SYSTEM_SPEC)));
    assert.equal(fs.existsSync(path.join(ROOT, 'SPEC.md')), false, 'nothing is left at the root');
    expectFailure((root) => fs.rmSync(path.join(root, SYSTEM_SPEC)), /S1 required file specs\/initialization-build\/spec\.md/, 1);
    expectFailure((root) => fs.renameSync(path.join(root, SYSTEM_SPEC), path.join(root, 'SPEC.md')), /S1 required file specs\/initialization-build\/spec\.md[\s\S]*SPEC\.md must not exist at the repository root/, 1);
    expectFailure(
      (root) => edit(root, SYSTEM_SPEC, (t) => `${t}\nSee \`scripts/not-in-the-tree.mjs\`.\n`),
      /specs\/initialization-build\/spec\.md refers to scripts\/not-in-the-tree\.mjs, which does not exist/,
    );
  });

  test('the system spec must be a real file in real directories: nothing else is ever opened', (t) => {
    const system = (root) => path.join(root, SYSTEM_SPEC);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'rcstack-outside-'));
    tmpDirs.push(outside);
    fs.writeFileSync(path.join(outside, 'secret.md'), '# Outside\n\nSee `scripts/leaked-from-outside.mjs`.\n');
    // Laid out so that either link below leads to a real, readable specs/initialization-build/spec.md.
    fs.mkdirSync(path.join(outside, 'initialization-build'));
    fs.writeFileSync(path.join(outside, 'initialization-build', 'spec.md'), '# Elsewhere\n\nSee `scripts/leaked-from-outside.mjs`.\n');

    // A directory in its place.
    expectFailure((root) => {
      fs.rmSync(system(root));
      fs.mkdirSync(system(root));
    }, /S1 required file specs\/initialization-build\/spec\.md\nmissing[\s\S]*specs\/initialization-build\/spec\.md is not a regular file/);

    // A link to a file outside the checkout: refused, and the outside file is never read.
    const linkedFile = copyRepo();
    fs.rmSync(system(linkedFile));
    fs.symlinkSync(path.join(outside, 'secret.md'), system(linkedFile));
    const linkedFileReport = failures(linkedFile);
    assert.match(linkedFileReport, /S1 required file specs\/initialization-build\/spec\.md\nmissing/);
    assert.match(linkedFileReport, /specs\/initialization-build\/spec\.md is a symbolic link/);
    assert.doesNotMatch(linkedFileReport, /leaked-from-outside/, 'nothing from the outside file reaches the report');

    // The same through a linked parent directory, and through a linked specs/ directory.
    for (const rel of ['specs/initialization-build', 'specs']) {
      const linkedDir = copyRepo();
      fs.rmSync(path.join(linkedDir, rel), { recursive: true });
      fs.symlinkSync(rel === 'specs' ? outside : path.join(outside, 'initialization-build'), path.join(linkedDir, rel));
      assert.ok(fs.readFileSync(path.join(linkedDir, SYSTEM_SPEC), 'utf8').includes('leaked-from-outside'), `${rel}: the outside spec is reachable through the link`);
      const report = failures(linkedDir);
      assert.match(report, /S1 required file specs\/initialization-build\/spec\.md\nmissing/, rel);
      assert.match(report, /S1 no symbolic links in the owned source tree/, rel);
      assert.doesNotMatch(report, /leaked-from-outside/, rel);
    }

    // A named pipe: the full check fails at once instead of blocking on it.
    const piped = copyRepo();
    fs.rmSync(system(piped));
    if (spawnSync('mkfifo', [system(piped)]).status !== 0) return t.skip('mkfifo is not available');
    const res = spawnSync(process.execPath, [path.join(piped, 'scripts/verify.mjs'), '--quiet'], { encoding: 'utf8', timeout: 30000 });
    assert.equal(res.signal, null, 'verify did not hang on the pipe');
    assert.equal(res.status, 1);
    assert.match(res.stdout, /\[FAIL\] S1 required file specs\/initialization-build\/spec\.md/);
    assert.match(res.stdout, /specs\/initialization-build\/spec\.md is not a regular file/);
  });

  test('no document is read through a link or from a pipe, wherever it sits', (t) => {
    // The same guard covers every file the validator opens, not only the system spec.
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'rcstack-outside-'));
    tmpDirs.push(outside);
    fs.writeFileSync(path.join(outside, 'law.md'), 'node scripts/verify.mjs\n\nSee `scripts/leaked-from-outside.mjs`.\n');
    const linked = copyRepo();
    fs.rmSync(path.join(linked, 'AGENTS.md'));
    fs.symlinkSync(path.join(outside, 'law.md'), path.join(linked, 'AGENTS.md'));
    const report = failures(linked);
    assert.match(report, /S1 required file AGENTS\.md\nmissing/);
    assert.doesNotMatch(report, /leaked-from-outside/);

    for (const rel of ['README.md', 'docs/decisions.md', 'skills/rc-retro/SKILL.md', 'profiles/rcstack-study.yaml', 'contracts/spec.md']) {
      const piped = copyRepo();
      fs.rmSync(path.join(piped, rel));
      if (spawnSync('mkfifo', [path.join(piped, rel)]).status !== 0) return t.skip('mkfifo is not available');
      const res = spawnSync(process.execPath, [path.join(piped, 'scripts/verify.mjs'), '--quiet'], { encoding: 'utf8', timeout: 30000 });
      assert.equal(res.signal, null, `verify did not hang on a pipe at ${rel}`);
      assert.equal(res.status, 1, rel);
    }
  });

  test('a directory replaced by a link is never listed, judged or passed', () => {
    const closed = ['docs', 'rules', 'profiles', 'contracts', 'scripts', 'adapters', 'tests', 'skills', 'skills/rc-router/playbooks', 'skills/rc-router/playbooks/engineering'];
    for (const rel of closed) {
      const root = copyRepo();
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'rcstack-outside-'));
      tmpDirs.push(outside);
      // The outside directory mirrors the real one's names, with empty files, plus one sentinel.
      for (const ent of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
        if (ent.isDirectory()) fs.mkdirSync(path.join(outside, ent.name));
        else fs.writeFileSync(path.join(outside, ent.name), '');
      }
      fs.writeFileSync(path.join(outside, 'OUTSIDE-SENTINEL.txt'), 'x');
      fs.rmSync(path.join(root, rel), { recursive: true });
      fs.symlinkSync(outside, path.join(root, rel));

      const report = runVerify({ root, slice: 3 });
      const text = report.failures.map((f) => `${f.name}\n${f.errors.join('\n')}`).join('\n');
      assert.match(text, /S1 no symbolic links in the owned source tree/, rel);
      assert.doesNotMatch(text, /OUTSIDE-SENTINEL/, `${rel}: no outside file name reaches the report`);
      const top = rel.split('/')[0];
      const passed = report.results.filter((res) => res.ok && new RegExp(`^S[123] ${rel.replace(/[/]/g, '\\/')}\\/ holds exactly`).test(res.name));
      assert.deepEqual(passed.map((res) => res.name), [], `${rel}: its own contents check does not pass on outside files`);
      assert.ok(report.failures.length >= 2, `${top}: more than the symlink check fails`);
    }
  });

  test('a linked adapters directory never gets an outside script parsed by bash', () => {
    const root = copyRepo();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'rcstack-outside-'));
    tmpDirs.push(outside);
    fs.writeFileSync(path.join(outside, 'install.sh'), 'set -euo pipefail\necho "hi" ) SECRET_TOKEN_OUTSIDE_REPO\n', { mode: 0o755 });
    fs.rmSync(path.join(root, 'adapters'), { recursive: true });
    fs.symlinkSync(outside, path.join(root, 'adapters'));
    const res = cli(root, ['--quiet']);
    assert.equal(res.status, 1);
    assert.doesNotMatch(res.stdout + res.stderr, /SECRET_TOKEN_OUTSIDE_REPO/);
    assert.match(res.stdout, /\[FAIL\] S3 adapters\/install\.sh is executable, strict-mode bash, and passes bash -n\n\s+- missing/);
    assert.match(res.stdout, /adapters exists but is not a real directory/);
  });

  test('a reference cannot be satisfied from outside the checkout', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'rcstack-outside-'));
    tmpDirs.push(outside);
    fs.writeFileSync(path.join(outside, 'target.md'), 'x\n');
    const root = copyRepo();
    // Two levels up from docs/ is the directory that holds both the copy and the outside directory.
    const escaping = `docs/../../${path.basename(outside)}/target.md`;
    assert.ok(fs.existsSync(path.join(root, escaping)), 'the traversal really leads to an existing file');
    edit(root, 'README.md', (t) => `${t}\nSee \`${escaping}\`.\n`);
    assert.match(failures(root), new RegExp(`README\\.md refers to docs/\\.\\./\\.\\./${path.basename(outside)}/target\\.md, which does not exist`));

    // A link or a pipe where a referenced file should be does not count as that file either.
    const linked = copyRepo();
    fs.rmSync(path.join(linked, 'contracts/review-map.md'));
    fs.symlinkSync(path.join(outside, 'target.md'), path.join(linked, 'contracts/review-map.md'));
    assert.match(failures(linked), /refers to contracts\/review-map\.md, which does not exist/);

    // The same holds for the files a profile names as Tier 3 paths.
    const tier3 = copyRepo();
    fs.rmSync(path.join(tier3, 'adapters/install.sh'));
    fs.symlinkSync(path.join(root, 'adapters/install.sh'), path.join(tier3, 'adapters/install.sh'));
    assert.match(failures(tier3), /profiles\/rcstack-engineering\.yaml tier3_path_patterns names adapters\/install\.sh, which does not exist/);
  });

  test('--root may be a link to a checkout, but not a dangling link or a file', () => {
    const real = copyRepo();
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rcstack-rootlink-'));
    tmpDirs.push(base);
    const link = path.join(base, 'link-to-repo');
    fs.symlinkSync(real, link);
    for (const form of [link, `${link}/`]) {
      const res = cli(ROOT, ['--root', form, '--quiet']);
      assert.equal(res.status, 0, `${form}\n${res.stdout}${res.stderr}`);
    }
    assert.equal(cli(link).status, 0, 'run from inside the linked checkout');
    fs.symlinkSync(path.join(base, 'nowhere'), path.join(base, 'dangling'));
    fs.writeFileSync(path.join(base, 'a-file'), 'x');
    for (const bad of ['dangling', 'a-file', 'missing']) {
      const res = cli(ROOT, ['--root', path.join(base, bad)]);
      assert.equal(res.status, 1, bad);
      assert.match(res.stderr, /is not a directory/, bad);
    }
  });

  test('a spec may name files that do not exist yet and models by name: its contents are not scanned', () => {
    const root = copyRepo();
    edit(root, 'specs/feature-local-specs/spec.md', (t) => `${t}\nPlanned: \`scripts/not-written-yet.mjs\`. Reviewed by Gemini 4 Neon.\n`);
    assert.equal(failures(root), '');
  });

  test('--specs validates any specs tree and exits 0 or 1', () => {
    const good = specsTree({ 'a/spec.md': SPEC, 'a/b/spec.md': SPEC, 'a/requirements.md': 'x' });
    const passed = cli(ROOT, ['--specs', good]);
    assert.equal(passed.status, 0, passed.stdout);
    assert.match(passed.stdout, /verify --specs: 1 checks, 1 passed, 0 failed -> PASS/);

    const bad = specsTree({ 'a/b/spec.md': SPEC });
    const failed = cli(ROOT, [`--specs=${bad}/`, '--quiet']);
    assert.equal(failed.status, 1);
    assert.match(failed.stdout, /\/specs\/a\/ has no spec\.md/);
    assert.match(failed.stdout, /verify --specs: 1 checks, 0 passed, 1 failed -> FAIL/);

    assert.equal(cli(ROOT, ['--specs', path.join(path.dirname(good), 'missing')]).status, 1);
    assert.equal(cli(ROOT, ['--specs']).status, 1);
    assert.equal(cli(ROOT, ['--specs=']).status, 1, 'an empty value never falls back to the current directory');
    const mixed = cli(ROOT, ['--specs', good, '--root', ROOT]);
    assert.equal(mixed.status, 1);
    assert.match(mixed.stderr, /--specs cannot be combined with --slice, --root, --profile or --schema/);
    for (const extra of [['--slice=1'], ['--profile', path.join(ROOT, 'profiles/rcstack-study.yaml')], ['--schema', path.join(ROOT, 'profiles/schema.json')]]) {
      const res = cli(ROOT, ['--specs', good, ...extra]);
      assert.equal(res.status, 1, extra.join(' '));
      assert.match(res.stderr, /--specs cannot be combined with/);
    }
    const sliced = cli(ROOT, ['--profile', path.join(ROOT, 'profiles/rcstack-study.yaml'), '--slice=2']);
    assert.equal(sliced.status, 1);
    assert.match(sliced.stderr, /--profile cannot be combined with --slice/);
    assert.equal(cli(ROOT, ['--specs', `${good}///`, '--quiet']).status, 0, 'trailing slashes on a real directory are fine');
    assert.equal(cli(ROOT, ['--specs', path.join(ROOT, 'specs')]).status, 0, 'the repository\'s own specs tree is valid');
  });
});

describe('custom top-level paths and git-ignored paths (DEC-015)', () => {
  // Every git call in this suite, in this process or a child, sees no host configuration and no
  // host excludes file: HOME and XDG_CONFIG_HOME point at an empty temporary directory.
  const ISOLATED = ['HOME', 'XDG_CONFIG_HOME', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM'];
  const savedEnv = {};
  before(() => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rcstack-githome-'));
    tmpDirs.push(home);
    for (const key of ISOLATED) savedEnv[key] = process.env[key];
    Object.assign(process.env, { HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' });
  });
  after(() => {
    for (const key of ISOLATED) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });
  const git = (root, ...args) => {
    const res = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    assert.equal(res.status, 0, `git ${args.join(' ')}: ${res.stderr}`);
    return res.stdout;
  };
  const write = (root, rel, text = 'x\n') => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  /** A copy of the repository that is its own git worktree, with everything in it tracked. */
  const gitRepo = (ignore = '') => {
    const root = copyRepo();
    git(root, 'init', '-q');
    if (ignore) write(root, '.gitignore', ignore);
    git(root, 'add', '-A');
    return root;
  };
  /** Everything a hostile archive could hold: stray documents, a playbooks tree, a skill, a link. */
  const fillArchive = (root, dir = '.archive') => {
    write(root, `${dir}/notes.md`, '# old notes\n\nSee `scripts/long-gone.mjs`.\n');
    write(root, `${dir}/SPEC.md`, '# an old spec\n');
    write(root, `${dir}/playbooks/engineering/old-playbook.md`, 'not a playbook\n');
    write(root, `${dir}/skills/rc-seventh/SKILL.md`, 'not a skill\n');
    write(root, `${dir}/specs/No Spec Here/draft.txt`, 'draft\n');
    write(root, `${dir}/package.json`, '{"dependencies":{"left-pad":"1"}}\n');
    fs.symlinkSync(os.tmpdir(), path.join(root, dir, 'link-out'));
  };

  test('the root is open: the owned directories and the forbidden names are the whole rule', () => {
    assert.deepEqual([...OWNED_DIRS].sort(), ['adapters', 'assets', 'contracts', 'docs', 'profiles', 'rules', 'scripts', 'skills', 'specs', 'tests']);
    assert.deepEqual(Object.keys(FORBIDDEN_ROOT_ENTRIES).sort(), ['SPEC.md', 'playbooks', 'spec.md']);
  });

  test('a git-ignored .archive/ with arbitrary content passes', () => {
    const root = gitRepo('.archive/\n');
    fillArchive(root);
    assert.deepEqual([...gitIgnoredPaths(root)], ['.archive/']);
    assert.equal(failures(root), '');
    const res = cli(root, ['--quiet']);
    assert.equal(res.status, 0, res.stdout);
  });

  test('a custom top-level directory passes when tracked, when untracked, and outside any git worktree', () => {
    const tracked = gitRepo();
    fillArchive(tracked);
    write(tracked, 'notes/todo.md');
    write(tracked, 'LICENSE', 'MIT\n');
    write(tracked, '.rcstack-local/state.json', '{}\n');
    assert.equal(failures(tracked), '', 'untracked and not ignored');
    git(tracked, 'add', '-A');
    assert.match(git(tracked, 'ls-files'), /^\.archive\/notes\.md$/m);
    assert.equal(failures(tracked), '', 'tracked');
    assert.equal(runVerify({ root: tracked, includeIgnored: true }).ok, true, 'custom paths are not judged even with --include-ignored');

    const plain = copyRepo();
    fillArchive(plain);
    write(plain, 'drafts/idea/spec.md', '# draft\n');
    assert.deepEqual([...gitIgnoredPaths(plain)], [], 'outside a worktree nothing is ignored');
    assert.equal(failures(plain), '');
  });

  test('owned subtrees stay exact: a rogue skill, playbook, script or root playbooks/ still fails', () => {
    const cases = {
      'skills/rc-rogue/SKILL.md': /skills\/rc-rogue is not one of the 5 approved skills/,
      'skills/rc-router/playbooks/engineering/rogue.md': /playbooks\/engineering\/rogue\.md is not part of the system spec's tree/,
      'skills/rc-router/playbooks/ops/x.md': /playbooks\/ops is not part of the system spec's tree/,
      'skills/rc-init/playbooks/x.md': /playbooks live only under skills\/rc-router\/playbooks/,
      'scripts/helper.mjs': /scripts\/helper\.mjs is not part of the system spec's tree/,
      'profiles/extra.yaml': /profiles\/extra\.yaml/,
      'contracts/extra.md': /contracts\/extra\.md is not part of the system spec's tree/,
      'playbooks/x.md': /playbooks must not exist at the repository root/,
    };
    for (const [rel, pattern] of Object.entries(cases)) {
      for (const tracked of [false, true]) {
        const root = gitRepo();
        write(root, rel);
        if (tracked) git(root, 'add', '-A');
        assert.match(failures(root), pattern, `${rel} (${tracked ? 'tracked' : 'untracked'})`);
      }
    }
  });

  test('a forbidden root entry fails even when git ignores it', () => {
    // SPEC.md and spec.md live in separate repositories: on a filesystem that ignores case
    // (default macOS) writing one would overwrite the other.
    const root = gitRepo('/playbooks/\n/SPEC.md\n/node_modules/\n');
    write(root, 'playbooks/x.md');
    write(root, 'SPEC.md');
    write(root, 'node_modules/left-pad/index.js');
    assert.deepEqual([...gitIgnoredPaths(root)].sort(), ['SPEC.md', 'node_modules/', 'playbooks/']);
    const report = failures(root);
    assert.match(report, /node_modules\/ must not exist/);
    assert.match(report, /playbooks must not exist at the repository root/);
    assert.match(report, /SPEC\.md must not exist at the repository root/);

    const lower = gitRepo('/spec.md\n');
    write(lower, 'spec.md');
    assert.deepEqual([...gitIgnoredPaths(lower)], ['spec.md']);
    assert.match(failures(lower), /^spec\.md must not exist at the repository root/m);
  });

  test('an ignored root package.json that declares dependencies still fails', () => {
    const root = gitRepo('/package.json\n');
    write(root, 'package.json', '{"dependencies":{"left-pad":"1"}}\n');
    assert.deepEqual([...gitIgnoredPaths(root)], ['package.json']);
    assert.match(failures(root), /package\.json declares dependencies/);
    assert.match(failures(root, 1), /package\.json declares dependencies/);
  });

  test('an ignored, untracked required file or directory is reported missing; tracked, it is judged', () => {
    const cases = {
      'AGENTS.md': /S1 required file AGENTS\.md\nmissing/,
      'README.md': /S1 required file README\.md\nmissing/,
      'skills/rc-router/SKILL.md': /S2 skill rc-router honours[^\n]*\nmissing/,
      [SYSTEM_SPEC]: /S1 required file specs\/initialization-build\/spec\.md\nmissing/,
      'docs/decisions.md': /S1 required file docs\/decisions\.md\nmissing/,
      'scripts/rc-log.mjs': /scripts\/rc-log\.mjs is missing/,
      'rules/': /rules\/ is missing/,
      'skills/rc-retro/': /skills\/rc-retro is missing/,
    };
    for (const [rel, pattern] of Object.entries(cases)) {
      const root = gitRepo();
      write(root, '.gitignore', `/${rel}\n`);
      assert.equal(failures(root), '', `${rel}: tracked, an ignore pattern matching it changes nothing`);
      git(root, 'rm', '-r', '--cached', '-q', rel.replace(/\/$/, ''));
      // Git may also list the emptied parent directory (as for the system spec), the collapsed form.
      assert.ok(gitIgnoredPaths(root).has(rel), rel);
      const report = failures(root);
      assert.match(report, pattern, `${rel}: ignored and untracked`);
      assert.doesNotMatch(report, /exists but is not a real directory/, rel);
      assert.equal(cli(root, ['--quiet']).status, 1, `${rel}: the CLI fails too`);
      assert.equal(runVerify({ root, includeIgnored: true }).ok, true, `${rel}: judged and valid with includeIgnored`);
    }
  });

  test('an ignored path inside an owned subtree is skipped by default and judged with includeIgnored', () => {
    const root = gitRepo('*.local.md\nscratch/\n.DS_Store\n');
    write(root, 'skills/rc-setup/notes.local.md');
    write(root, 'skills/scratch/anything.txt');
    write(root, 'scripts/.DS_Store');
    write(root, 'specs/.DS_Store');
    write(root, 'specs/feature-local-specs/scratch/no-spec-here.txt');
    assert.equal(failures(root), '');
    const strict = runVerify({ root, includeIgnored: true }).failures.flatMap((f) => f.errors).join('\n');
    assert.match(strict, /skills\/rc-setup\/notes\.local\.md is not part of the system spec's tree/);
    assert.match(strict, /skills\/scratch is not one of the 5 approved skills/);
    assert.match(strict, /scripts\/\.DS_Store is not part of the system spec's tree/);
    assert.match(strict, /specs\/\.DS_Store is a loose file/);
    assert.match(strict, /specs\/feature-local-specs\/scratch\/ has no spec\.md/);
    assert.equal(cli(root, ['--quiet']).status, 0);
    assert.equal(cli(root, ['--include-ignored', '--quiet']).status, 1);
    assert.equal(cli(root, ['--include-ignored=yes']).status, 1, 'the flag takes no value');
    assert.equal(cli(root, ['--profile', path.join(root, 'profiles/rcstack-study.yaml')]).status, 0);
    assert.equal(cli(root, ['--profile', path.join(root, 'profiles/rcstack-study.yaml'), '--include-ignored']).status, 1, 'the flag does not apply to --profile');
  });

  test('listing ignored paths never runs a program named in the repository configuration', () => {
    const root = gitRepo('.archive/\n');
    fillArchive(root);
    const marker = path.join(root, '.archive', 'fsmonitor-ran');
    const hook = path.join(root, '.archive', 'hook.sh');
    fs.writeFileSync(hook, `#!/bin/sh\ntouch "${marker}"\n`, { mode: 0o755 });
    git(root, 'config', 'core.fsmonitor', hook);
    assert.deepEqual([...gitIgnoredPaths(root)], ['.archive/']);
    assert.equal(failures(root), '');
    assert.equal(fs.existsSync(marker), false);
  });

  test('--specs never points git at a directory reached through a link', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'rcstack-outside-'));
    tmpDirs.push(outside);
    git(outside, 'init', '-q');
    write(outside, '.gitignore', 'evil.txt\n');
    write(outside, 'evil.txt');
    const holder = fs.mkdtempSync(path.join(os.tmpdir(), 'rcstack-target-'));
    tmpDirs.push(holder);
    fs.symlinkSync(outside, path.join(holder, 'specs'));
    assert.deepEqual([...gitIgnoredPaths(path.join(holder, 'specs'))], ['evil.txt'], 'git itself would follow the link');
    // A stand-in git that leaves a marker: if the check ran git at all, the marker would exist.
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'rcstack-fakegit-'));
    tmpDirs.push(bin);
    const marker = path.join(bin, 'git-ran');
    fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh\ntouch "${marker}"\nexit 1\n`, { mode: 0o755 });
    const savedPath = process.env.PATH;
    process.env.PATH = `${bin}${path.delimiter}${savedPath}`;
    try {
      gitIgnoredPaths(holder);
      assert.equal(fs.existsSync(marker), true, 'the stand-in is what a git call would run');
      fs.rmSync(marker);
      const r = runSpecsCheck({ specsPath: path.join(holder, 'specs'), label: 'specs' });
      assert.deepEqual(r.failures.flatMap((f) => f.errors), ['specs exists but is not a directory']);
      assert.equal(fs.existsSync(marker), false, 'git was not run on the linked directory');
    } finally {
      process.env.PATH = savedPath;
    }
  });

  test('a tracked file is never skipped, even when an ignore pattern matches it', () => {
    const root = gitRepo('*.local.md\n');
    write(root, 'skills/rc-setup/notes.local.md');
    assert.equal(failures(root), '', 'untracked and ignored: skipped');
    git(root, 'add', '-f', 'skills/rc-setup/notes.local.md');
    assert.deepEqual([...gitIgnoredPaths(root)], []);
    assert.match(failures(root), /skills\/rc-setup\/notes\.local\.md is not part of the system spec's tree/);
    // An ignore rule added after the fact cannot hide a tracked symbolic link either.
    const linked = gitRepo();
    fs.symlinkSync('SKILL.md', path.join(linked, 'skills/rc-setup/alias.md'));
    git(linked, 'add', '-A');
    write(linked, '.gitignore', 'alias.md\n');
    assert.match(failures(linked), /skills\/rc-setup\/alias\.md is a symbolic link/);
  });

  test('an ignore rule cannot hide a required file from the missing-file checks', () => {
    const root = gitRepo();
    fs.rmSync(path.join(root, 'skills/rc-retro'), { recursive: true });
    write(root, '.gitignore', 'skills/rc-retro/\n');
    assert.match(failures(root), /skills\/rc-retro is missing/);
  });

  test('git environment variables naming another repository do not change what is ignored', () => {
    const root = gitRepo('.archive/\n');
    fillArchive(root);
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'rcstack-other-'));
    tmpDirs.push(other);
    git(other, 'init', '-q');
    const saved = { GIT_DIR: process.env.GIT_DIR, GIT_WORK_TREE: process.env.GIT_WORK_TREE };
    process.env.GIT_DIR = path.join(other, '.git');
    process.env.GIT_WORK_TREE = other;
    try {
      assert.deepEqual([...gitIgnoredPaths(root)], ['.archive/']);
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  test('--specs skips ignored entries of a target repository unless asked not to', () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'rcstack-target-'));
    tmpDirs.push(target);
    git(target, 'init', '-q');
    write(target, '.gitignore', '.DS_Store\ntmp/\n');
    write(target, 'specs/payments/spec.md', '# Spec: payments\n');
    write(target, 'specs/.DS_Store');
    write(target, 'specs/payments/tmp/scratch.txt');
    const specsPath = path.join(target, 'specs');
    assert.equal(runSpecsCheck({ specsPath, label: 'specs' }).ok, true);
    const strict = runSpecsCheck({ specsPath, label: 'specs', includeIgnored: true });
    assert.deepEqual(strict.failures.flatMap((f) => f.errors), [
      'specs/.DS_Store is a loose file: specs/ holds only spec directories',
      'specs/payments/tmp/ has no spec.md: every directory under specs/ is a spec directory, and a sub-spec lives inside its parent\'s',
    ]);
    assert.equal(cli(ROOT, ['--specs', specsPath, '--quiet']).status, 0);
    assert.equal(cli(ROOT, ['--specs', specsPath, '--include-ignored', '--quiet']).status, 1);
    // An ignored spec.md does not count: it would never be committed.
    write(target, '.gitignore', 'spec.md\n');
    write(target, 'specs/payments/requirements.md', 'requirements\n');
    assert.match(runSpecsCheck({ specsPath, label: 'specs' }).failures.flatMap((f) => f.errors).join('\n'), /specs\/payments\/ has no spec\.md/);
  });
});

describe('--profile mode', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'profiles/schema.json'), 'utf8'));

  test('accepts each shipped profile', () => {
    for (const domain of ['engineering', 'study', 'research']) {
      const res = cli(ROOT, ['--profile', path.join(ROOT, `profiles/rcstack-${domain}.yaml`)]);
      assert.equal(res.status, 0, res.stdout);
    }
  });

  test('rejects a machine-local profile that permits self-review', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rcstack-profile-'));
    tmpDirs.push(dir);
    const file = path.join(dir, 'rcstack-engineering.yaml');
    const text = fs.readFileSync(path.join(ROOT, 'profiles/rcstack-engineering.yaml'), 'utf8');
    fs.writeFileSync(file, text.replace('  "GPT 6.2 Astra":\n    primary: "Claude Opus 5.5"', '  "GPT 6.2 Astra":\n    primary: "GPT 6.2 Astra"'));
    const res = cli(ROOT, ['--profile', file]);
    assert.equal(res.status, 1);
    assert.match(res.stdout, /reviewer == builder: review_matrix\["GPT 6\.2 Astra"\]\.primary/);
    assert.equal(cli(ROOT, ['--profile', file, '--schema', path.join(dir, 'missing.json')]).status, 1);
  });

  test('checkProfileText reports YAML errors instead of throwing', () => {
    assert.match(checkProfileText('a: [1]', schema).errors[0], /^YAML: line 1: flow collections/);
  });
});

describe('shipped profiles match the system spec, section 3.3', () => {
  const spec = fs.readFileSync(path.join(ROOT, SYSTEM_SPEC), 'utf8');
  const section = spec.slice(spec.indexOf('### 3.3'), spec.indexOf('### 3.4'));
  const profiles = Object.fromEntries(
    ['engineering', 'study', 'research'].map((d) => [d, parseYaml(fs.readFileSync(path.join(ROOT, `profiles/rcstack-${d}.yaml`), 'utf8'))]),
  );
  const pick = (cell, label) => new RegExp(`${label}: \`([^\`]+)\``).exec(cell)?.[1];

  test('every capability binding equals the specification table', () => {
    const rows = section.split('\n').filter((l) => /^\| `[a-z_]+` \|/.test(l));
    assert.equal(rows.length, 7);
    for (const row of rows) {
      const cells = row.split('|').slice(1, -1).map((c) => c.trim());
      const capability = cells[0].replaceAll('`', '');
      ['engineering', 'study', 'research'].forEach((domain, i) => {
        const cell = cells[i + 1] === 'Same' ? cells[1] : cells[i + 1];
        const binding = profiles[domain].capabilities[capability];
        const where = `${domain}.${capability}`;
        assert.equal(binding.model, /^`([^`]+)`/.exec(cell)[1], `${where} primary`);
        assert.equal(binding.fallback?.model, pick(cell, 'fb'), `${where} fallback`);
        assert.equal(binding.secondary?.model, pick(cell, 'sec'), `${where} secondary`);
        assert.equal(binding.paired?.model, pick(cell, 'paired'), `${where} paired`);
        assert.equal(binding.companion?.model, pick(cell, 'companion'), `${where} companion`);
        assert.equal(binding.exclusive === true, cell.includes('`exclusive: true`'), `${where} exclusive`);
      });
    }
  });

  test('every review matrix equals the specification list', () => {
    const expected = {};
    for (const line of section.split('\n')) {
      const entry = /^- `([^`]+)` → (.+)$/.exec(line);
      if (entry) expected[entry[1]] = Object.fromEntries([...entry[2].matchAll(/`(\w+): ([^`]+)`/g)].map((m) => [m[1], m[2]]));
      const fallback = /^- `default_fallback`: `([^`]+)`/.exec(line);
      if (fallback) expected.default_fallback = fallback[1];
    }
    assert.equal(Object.keys(expected).length, 7);
    for (const domain of Object.keys(profiles)) assert.deepEqual(profiles[domain].review_matrix, expected, domain);
  });

  test('the canonical playbook table has 13 entries across 5 skills', () => {
    assert.equal(PLAYBOOKS.length, 13);
    assert.deepEqual(PLAYBOOKS.find((p) => p.name === 'project-planning'), { domain: 'engineering', name: 'project-planning', tier: 0, assurance: 'A0' });
    assert.equal(APPROVED_SKILLS.length, 5);
    for (const pb of PLAYBOOKS) {
      assert.match(spec, new RegExp(`\`${pb.name}\` \\(\`T${pb.tier}\`, \`${pb.assurance}\`\\)`), pb.name);
    }
  });
});
