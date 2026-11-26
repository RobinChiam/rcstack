#!/usr/bin/env node
/**
 * scripts/verify.mjs — repo invariant & contract validator for rcstack-beta.
 *
 *   node scripts/verify.mjs [--slice=1|2|3] [--root <dir>] [--include-ignored] [--quiet]
 *   node scripts/verify.mjs --profile <file.yaml> [--schema <schema.json>] [--quiet]
 *   node scripts/verify.mjs --specs <dir> [--include-ignored] [--quiet]
 *
 * "System spec" below means specs/initialization-build/spec.md, the canonical specification.
 *
 * Exits 0 on a full pass and 1 on any failure or usage error, printing [PASS]/[FAIL] lines.
 * Zero dependencies: Node.js >= 20 built-ins only.
 *
 * `scripts/` is a closed set of four files (system spec section 1), so this file is also the single
 * home of the deterministic primitives the other scripts share, per docs/decisions.md DEC-007:
 *   parseYaml()       strict YAML subset parser (system spec section 3.1)
 *   validateSchema()  JSON Schema Draft 2020-12 subset validator that fails closed
 *   globToRegExp()    repo-relative glob matcher
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ------------------------------------------------------------------------------------------
// Canon: the exact shapes the system spec fixes. Changing any of these is a spec change.
// ------------------------------------------------------------------------------------------

/** The canonical system specification. It lives in specs/ like every other spec. */
export const SYSTEM_SPEC = 'specs/initialization-build/spec.md';

export const APPROVED_SKILLS = Object.freeze(['rc-router', 'rc-setup', 'rc-init', 'rc-doctor', 'rc-retro']);

export const PLAYBOOKS = Object.freeze([
  { domain: 'engineering', name: 'feature-build', tier: 2, assurance: 'A2' },
  { domain: 'engineering', name: 'bug-root-cause', tier: 2, assurance: 'A2' },
  { domain: 'engineering', name: 'vibe-iterate', tier: 1, assurance: 'A1' },
  { domain: 'engineering', name: 'security-critical', tier: 3, assurance: 'A3' },
  { domain: 'engineering', name: 'refactor-pinned', tier: 2, assurance: 'A2' },
  { domain: 'engineering', name: 'ship-and-babysit', tier: 2, assurance: 'A2' },
  { domain: 'engineering', name: 'garden-maintenance', tier: 2, assurance: 'A2' },
  { domain: 'engineering', name: 'project-planning', tier: 0, assurance: 'A0' },
  { domain: 'study', name: 'topic-deep-dive', tier: 2, assurance: 'A2' },
  { domain: 'study', name: 'recall-and-drill', tier: 1, assurance: 'A1' },
  { domain: 'study', name: 'socratic-session', tier: 1, assurance: 'A0' },
  { domain: 'research', name: 'viability-spike', tier: 2, assurance: 'A2' },
  { domain: 'research', name: 'research-report', tier: 2, assurance: 'A2' },
]);

/**
 * The top-level directories this repository owns (system spec section 1.A, plus `assets/` for the
 * README icon). Structure is judged only inside them. The root itself is open: any other
 * top-level entry, tracked or not, is a custom path that the validator neither lists nor reads
 * (docs/decisions.md DEC-015).
 */
export const OWNED_DIRS = Object.freeze(['assets', 'docs', 'specs', 'rules', 'profiles', 'contracts', 'skills', 'scripts', 'adapters', 'tests']);

/** The root files the validator requires and reads. */
export const ROOT_FILES = Object.freeze(['README.md', 'AGENTS.md']);

/**
 * Names that may never exist at the repository root, whatever they are and whether or not git
 * ignores them. `node_modules` is the third; the dependency check reports it.
 */
export const FORBIDDEN_ROOT_ENTRIES = Object.freeze({
  playbooks: 'playbooks live only under skills/rc-router/playbooks/',
  'SPEC.md': `the system spec lives at ${SYSTEM_SPEC}`,
  'spec.md': `the system spec lives at ${SYSTEM_SPEC}`,
});

export const DOMAINS = Object.freeze(['engineering', 'study', 'research']);
export const PROFILE_NAMES = Object.freeze(DOMAINS.map((d) => `rcstack-${d}`));
export const ASSURANCE_LEVELS = Object.freeze(['A0', 'A1', 'A2', 'A3']);

export const CAPABILITY_KEYS = Object.freeze([
  'systems_research',
  'architect_blueprint',
  'primary_builder',
  'security_builder',
  'vibe_executor',
  'deep_grounding',
  'quick_lookup',
]);
/** Resolved through `review_matrix` for the builder of record; never bound under `capabilities`. */
export const REVIEWER_CAPABILITY = 'independent_reviewer';
/** Capabilities whose models produce work that must be reviewable (system spec section 3.2). */
export const BUILDER_CAPABILITIES = Object.freeze([
  'primary_builder',
  'security_builder',
  'vibe_executor',
  'systems_research',
  'architect_blueprint',
]);

export const CONTRACT_FILES = Object.freeze([
  'research-brief.md',
  'spec.md',
  'work-receipt.md',
  'audit-findings.md',
  'review-map.md',
  'telemetry-event.schema.json',
]);
export const RULE_FILES = Object.freeze(['engineering.md', 'study.md', 'research.md']);
export const SCRIPT_FILES = Object.freeze(['verify.mjs', 'rc-state.mjs', 'rc-receipt.mjs', 'rc-log.mjs']);
export const TEST_FILES = Object.freeze([
  'verify.test.mjs',
  'rc-state.test.mjs',
  'rc-receipt.test.mjs',
  'rc-log.test.mjs',
  'install.test.mjs',
]);

export const SKILL_HEADINGS = Object.freeze([
  'Single Job',
  'When to Use',
  'Do NOT Use When',
  'Procedure',
  'Definition of Done',
]);
export const PLAYBOOK_HEADINGS = Object.freeze([
  'Router-Only Invocation Boundary',
  'Do NOT Use When',
  'Workflow Phases',
  'Exit Gate & Definition of Done',
]);

/** The verbatim boundary sentence every playbook (and TEMPLATE.md) must carry. */
export const ROUTER_ONLY_RULE =
  '**ROUTER-ONLY:** This playbook MUST ONLY be invoked by `rc-router` (`/rcstack`) after profile selection, ' +
  'risk-tier classification, and live model resolution. Never execute this playbook standalone or bypass `rc-router`.';

export const TELEMETRY_REQUIRED_FIELDS = Object.freeze([
  'schema_version',
  'ts',
  'repo',
  'branch',
  'profile',
  'playbook',
  'risk_tier',
  'required_assurance',
  'achieved_assurance',
  'builders',
  'reviewers',
  'degraded_single_harness',
  'verify_attempts',
  'audit_accepted',
  'audit_dismissed',
  'overridden',
  'escalated_from_tier',
]);

/** Strings each contract must contain so producers and consumers agree on its shape. */
const CONTRACT_REQUIREMENTS = Object.freeze({
  'research-brief.md': ['## Goal', '## Grounded Facts', '## Constraints', '## Open Questions', '## Recommended Approach'],
  'spec.md': [
    '## Problem Statement',
    '## Non-Goals',
    '## Data Shapes & Interfaces',
    '## Non-Overlapping File Slices',
    '## Failure Modes',
    '## Acceptance Criteria',
    '## Verification Plan',
  ],
  'work-receipt.md': [
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
    'mechanical',
    'behavioral',
    'hardened',
  ],
  'audit-findings.md': [
    'builder_model',
    'reviewer_model',
    'fresh_context: true',
    'diff_scope',
    'Blocker',
    'Major',
    'Nit',
    'impact',
    'concrete_fix',
    'APPROVE',
    'CHANGES_REQUESTED',
  ],
  'review-map.md': [
    'Header Bar',
    'Executive Delta',
    'Risk-Ranked Reading Order',
    'Assumptions & Tradeoffs Checklist',
    'Cross-Model Audit Ledger',
    'Verification Matrix',
    'Proposed `docs/decisions.md` Entry',
    'ASSURANCE GAP',
    '[HIGH]',
    '[MED]',
    '[SKIM]',
  ],
});

/**
 * Profile risk-tier gates and what a playbook must carry to honour each one. A playbook whose
 * default tier switches a gate on must list the contract, name the capability and mention the tool.
 */
const TIER_GATES = Object.freeze([
  { flag: 'require_spec', contract: 'contracts/spec.md' },
  { flag: 'require_state_file', mention: 'rc-state.mjs' },
  { flag: 'require_verify', mention: 'verify' },
  { flag: 'require_receipt_gate', contract: 'contracts/work-receipt.md', mention: 'rc-receipt.mjs' },
  { flag: 'require_cross_model_audit', contract: 'contracts/audit-findings.md', capability: REVIEWER_CAPABILITY },
  { flag: 'require_review_map', contract: 'contracts/review-map.md' },
  { flag: 'log_telemetry', mention: 'rc-log.mjs' },
]);

/** Sole canonical playbook exempt from `require_verify` at its default Tier 1/A0 (DEC-018). */
export const REQUIRE_VERIFY_EXEMPT_PLAYBOOK = Object.freeze({
  domain: 'study',
  name: 'socratic-session',
  tier: 1,
  assurance: 'A0',
});

export function isGateExempt(gateFlag, pb) {
  return (
    gateFlag === 'require_verify' &&
    pb?.domain === REQUIRE_VERIFY_EXEMPT_PLAYBOOK.domain &&
    pb?.name === REQUIRE_VERIFY_EXEMPT_PLAYBOOK.name &&
    pb?.tier === REQUIRE_VERIFY_EXEMPT_PLAYBOOK.tier &&
    pb?.assurance === REQUIRE_VERIFY_EXEMPT_PLAYBOOK.assurance
  );
}

export function checkPlaybookGates({ playbook, frontmatter = null, tierConfig, contracts, capabilities, workflow }) {
  const errors = [];
  if (!tierConfig) return errors;
  const effective = frontmatter
    ? {
        domain: typeof frontmatter.profile === 'string' && frontmatter.profile.startsWith('rcstack-') ? frontmatter.profile.slice('rcstack-'.length) : null,
        name: frontmatter.name,
        tier: frontmatter.default_tier,
        assurance: frontmatter.required_assurance,
      }
    : playbook;
  for (const gate of TIER_GATES) {
    if (tierConfig[gate.flag] !== true) continue;
    if (isGateExempt(gate.flag, playbook) && isGateExempt(gate.flag, effective)) continue;
    const where = `profile gate ${gate.flag} (Tier ${playbook.tier})`;
    if (gate.contract && !contracts.includes(gate.contract)) errors.push(`${where}: contracts must list ${gate.contract}`);
    if (gate.capability && !capabilities.includes(gate.capability)) errors.push(`${where}: required_capabilities must list ${gate.capability}`);
    if (gate.mention && !workflow.includes(gate.mention)) errors.push(`${where}: the workflow or exit gate must use \`${gate.mention}\``);
  }
  return errors;
}

/**
 * Concrete model names never appear in model-agnostic surfaces (system spec hard invariant 3).
 * Each pattern tolerates spaces, hyphens and underscores, so display names ("GPT 6.2"), catalog ids
 * ("claude-opus-5-5", "claude-3-5-sonnet") and snake_case forms ("gemini_4_neon") are all caught.
 * Underscores are word characters, so the patterns use explicit lookarounds instead of \b.
 */
export const MODEL_NAME_PATTERNS = Object.freeze([
  { re: /(?<![a-z0-9])gpt[\s_-]*(?:\d|(?:astra|sol)(?![a-z]))/i, label: 'GPT model' },
  { re: /(?<![a-z0-9])claude(?:[\s_-]+\d+(?:[._-]\d+)*)?[\s_-]+(?:opus|fable|sonnet|haiku|mythos)(?![a-z])/i, label: 'Claude model' },
  { re: /(?<![a-z0-9])(?:opus|sonnet|haiku|fable|mythos)[\s_-]*\d/i, label: 'Claude model version' },
  { re: /(?<![a-z0-9])gemini[\s_-]*(?:\d|(?:neon|hydrogen|carbon|argon|pro|flash|ultra|nano|notebook)(?![a-z]))/i, label: 'Gemini model' },
  { re: /(?<![a-z0-9])(?:cursor[\s_-]+grok(?![a-z])|grok[\s_-]*\d)/i, label: 'Grok model' },
  { re: /(?<![a-z0-9])o[1-9][\s_-]*(?:mini|pro|preview)(?![a-z])/i, label: 'o-series model' },
]);

/** Model identity as rc-router resolves it: case and punctuation do not distinguish two names. */
export function normalizeModelName(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * True when two names denote the same model. Names are compared as word and number tokens:
 *   - the same tokens, however they are cased or punctuated ("<Family> 4 <Name>", "family_4_name");
 *   - the same words and the same numbers with the version placed elsewhere, as catalog ids do
 *     ("<family>-<name>-5-5" and "<family>-5-5-<name>"), while "5.2" and "2.5" stay different;
 *   - one name is the other with a provider's display name in front ("<provider> <label>").
 * Everything is matched on whole tokens, so "<x>" and "code<x>" are different models.
 */
export function sameModel(a, b) {
  if (normalizeModelName(a) === normalizeModelName(b)) return true;
  const tokens = (name) => String(name).toLowerCase().match(/[a-z]+|\d+/g) ?? [];
  const isWord = (t) => /[a-z]/.test(t);
  const equal = (x, y) => x.length === y.length && x.every((t, i) => t === y[i]);
  const same = (x, y) => {
    if (equal(x, y)) return true;
    const words = x.filter(isWord);
    const numbers = x.filter((t) => !isWord(t));
    return words.length >= 2 && numbers.length >= 1 && equal(words, y.filter(isWord)) && equal(numbers, y.filter((t) => !isWord(t)));
  };
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.length === 0 || tb.length === 0) return false;
  if (same(ta, tb)) return true;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (short.length < 2 || !isWord(short[0])) return false;
  for (let lead = 1; lead <= long.length - short.length; lead += 1) {
    if (long.slice(0, lead).every(isWord) && same(long.slice(lead), short)) return true;
  }
  return false;
}

/**
 * Regexes that find a profile-bound model name however it is written: the same tokens with any
 * separators, and the same words with the version moved or dropped ("<family> <codename>").
 */
function nameMatchers(name) {
  const tokens = String(name).toLowerCase().match(/[a-z]+|\d+/g) ?? [];
  if (tokens.length === 0) return [];
  const sep = '[\\s_.-]*';
  const bounded = (body) => new RegExp(`(?<![a-z0-9])${body}(?![a-z0-9])`, 'i');
  const matchers = [bounded(tokens.join(sep))];
  const words = tokens.filter((t) => /[a-z]/.test(t));
  if (words.length >= 2 && words.join('').length >= 6) matchers.push(bounded(words.join(`(?:${sep}\\d+)*${sep}`)));
  return matchers;
}

const SEMVER = /^\d+\.\d+\.\d+$/;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

// ------------------------------------------------------------------------------------------
// Strict YAML subset parser
// ------------------------------------------------------------------------------------------

export class YamlError extends Error {
  constructor(message, line) {
    super(line ? `line ${line}: ${message}` : message);
    this.name = 'YamlError';
    this.line = line ?? null;
  }
}

const PLAIN_KEY = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

function stripComment(raw) {
  let inQuote = false;
  for (let i = 0; i < raw.length; i += 1) {
    const c = raw[i];
    if (inQuote) {
      if (c === '\\') i += 1;
      else if (c === '"') inQuote = false;
    } else if (c === '"') {
      inQuote = true;
    } else if (c === '#' && (i === 0 || raw[i - 1] === ' ')) {
      return raw.slice(0, i).trimEnd();
    }
  }
  return raw.trimEnd();
}

function readQuoted(text, start, line) {
  let out = '';
  for (let i = start + 1; i < text.length; i += 1) {
    const c = text[i];
    if (c === '"') return { value: out, end: i + 1 };
    if (c === '\\') {
      i += 1;
      const e = text[i];
      if (e === '"' || e === '\\' || e === '/') out += e;
      else if (e === 'n') out += '\n';
      else if (e === 't') out += '\t';
      else throw new YamlError(`unsupported escape sequence "\\${e ?? ''}"`, line);
    } else {
      out += c;
    }
  }
  throw new YamlError('unterminated double-quoted string', line);
}

/** Split `key: rest`. Returns null when the text does not start a mapping entry. */
function splitKey(text, line) {
  let key;
  let after;
  if (text[0] === '"') {
    const q = readQuoted(text, 0, line);
    if (text[q.end] !== ':') return null;
    key = q.value;
    after = text.slice(q.end + 1);
    if (key === '') throw new YamlError('empty mapping key', line);
  } else {
    let idx = -1;
    for (let i = 0; i < text.length; i += 1) {
      if (text[i] === ':' && (i + 1 === text.length || text[i + 1] === ' ')) {
        idx = i;
        break;
      }
    }
    if (idx === -1) return null;
    key = text.slice(0, idx);
    after = text.slice(idx + 1);
    if (!PLAIN_KEY.test(key)) {
      throw new YamlError(`invalid mapping key "${key}" (use [A-Za-z0-9_.-] or double-quote it)`, line);
    }
  }
  if (after !== '' && after[0] !== ' ') throw new YamlError('expected a space after ":"', line);
  if (key === '__proto__') throw new YamlError('reserved mapping key "__proto__"', line);
  return { key, rest: after.trim() };
}

function parseScalar(text, line) {
  if (text === '[]') return [];
  const c = text[0];
  if (c === '"') {
    const q = readQuoted(text, 0, line);
    if (q.end !== text.length) throw new YamlError('unexpected content after closing quote', line);
    return q.value;
  }
  if (c === "'") throw new YamlError('single-quoted strings are outside the strict subset; use double quotes', line);
  if (c === '&' || c === '*') throw new YamlError('anchors and aliases are not allowed', line);
  if (c === '!') throw new YamlError('tags are not allowed', line);
  if (c === '|' || c === '>') throw new YamlError('block scalars are not allowed', line);
  if (c === '[' || c === '{') {
    throw new YamlError('flow collections are not allowed (only the empty sequence [] is)', line);
  }
  if (c === '%' || c === '@' || c === '`') throw new YamlError(`reserved indicator "${c}"; double-quote the value`, line);
  if (text === '-' || text.startsWith('- ')) throw new YamlError('nested sequences are not supported', line);
  if (text === '?' || text.startsWith('? ')) throw new YamlError('complex mapping keys are not allowed', line);
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null') return null;
  if (/^(?:~|yes|no|on|off|y|n|true|false|null)$/i.test(text)) {
    throw new YamlError(`ambiguous scalar "${text}"; write true, false or null, or double-quote it`, line);
  }
  if (/^-?(?:0|[1-9]\d*)$/.test(text)) {
    const n = Number(text);
    if (!Number.isSafeInteger(n)) throw new YamlError(`integer "${text}" is out of range`, line);
    return n;
  }
  if (
    /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(text) ||
    /^[-+]?0[xXoObB][0-9a-fA-F_]+$/.test(text) ||
    /^[-+]?\.(?:inf|nan)$/i.test(text)
  ) {
    throw new YamlError(`ambiguous numeric scalar "${text}"; only plain integers are numbers, double-quote it`, line);
  }
  if (/: |:$| #/.test(text)) {
    throw new YamlError('plain scalar contains ": " or " #"; double-quote the value', line);
  }
  return text;
}

function isSequenceLine(text) {
  return text === '-' || text.startsWith('- ');
}

function parseBlock(state, indent) {
  return isSequenceLine(state.lines[state.pos].text) ? parseSequence(state, indent) : parseMapping(state, indent);
}

function parseMapping(state, indent) {
  const out = {};
  while (state.pos < state.lines.length) {
    const cur = state.lines[state.pos];
    if (cur.indent < indent) break;
    if (cur.indent > indent) throw new YamlError('unexpected indentation', cur.n);
    if (isSequenceLine(cur.text)) throw new YamlError('sequence item where a mapping key was expected', cur.n);
    const kv = splitKey(cur.text, cur.n);
    if (!kv) throw new YamlError('expected "key: value"', cur.n);
    if (Object.hasOwn(out, kv.key)) throw new YamlError(`duplicate mapping key "${kv.key}"`, cur.n);
    state.pos += 1;
    if (kv.rest === '') {
      const next = state.lines[state.pos];
      if (!next || next.indent <= indent) throw new YamlError(`key "${kv.key}" has no value`, cur.n);
      if (next.indent !== indent + 2) {
        throw new YamlError('a nested block must be indented by exactly 2 spaces', next.n);
      }
      out[kv.key] = parseBlock(state, indent + 2);
    } else {
      out[kv.key] = parseScalar(kv.rest, cur.n);
    }
  }
  return out;
}

function parseSequence(state, indent) {
  const out = [];
  while (state.pos < state.lines.length) {
    const cur = state.lines[state.pos];
    if (cur.indent < indent) break;
    if (cur.indent > indent) throw new YamlError('unexpected indentation', cur.n);
    if (!isSequenceLine(cur.text)) throw new YamlError('mapping key where a sequence item was expected', cur.n);
    const rest = cur.text.slice(2);
    if (rest === '') throw new YamlError('empty sequence item', cur.n);
    if (rest[0] === ' ') throw new YamlError('expected exactly one space after "-"', cur.n);
    if (isSequenceLine(rest)) throw new YamlError('nested sequences are not supported', cur.n);
    if (splitKey(rest, cur.n)) {
      // "- key: value" starts a mapping whose remaining keys sit two columns deeper.
      state.lines[state.pos] = { n: cur.n, indent: indent + 2, text: rest };
      out.push(parseMapping(state, indent + 2));
    } else {
      out.push(parseScalar(rest, cur.n));
      state.pos += 1;
    }
  }
  return out;
}

/**
 * Parse the strict YAML subset: 2-space indentation, block mappings, block sequences, comments,
 * integers, booleans, null, plain and double-quoted strings, and the empty sequence `[]`.
 * Tabs, anchors, aliases, tags, block scalars, flow collections, single quotes, floats and
 * document markers are rejected with a line number.
 */
export function parseYaml(text) {
  if (typeof text !== 'string') throw new YamlError('input must be a string');
  if (text.charCodeAt(0) === 0xfeff) throw new YamlError('byte-order mark is not allowed', 1);
  const lines = [];
  text.split('\n').forEach((raw, i) => {
    const n = i + 1;
    if (raw.includes('\t')) throw new YamlError('tab characters are not allowed', n);
    if (raw.includes('\r')) throw new YamlError('carriage returns are not allowed (use LF line endings)', n);
    const content = stripComment(raw);
    if (content.trim() === '') return;
    const indent = content.length - content.trimStart().length;
    if (indent % 2 !== 0) throw new YamlError(`indentation of ${indent} spaces is not a multiple of 2`, n);
    const body = content.slice(indent);
    if (body === '---' || body === '...' || body.startsWith('--- ')) {
      throw new YamlError('document markers are not allowed', n);
    }
    lines.push({ n, indent, text: body });
  });
  if (lines.length === 0) throw new YamlError('document is empty');
  if (lines[0].indent !== 0) throw new YamlError('the document must start at column 0', lines[0].n);
  const state = { lines, pos: 0 };
  const value = parseBlock(state, 0);
  if (state.pos < lines.length) throw new YamlError('unexpected indentation', lines[state.pos].n);
  return value;
}

/** Split a Markdown document into its `---` frontmatter and body. Returns null when absent. */
export function splitFrontmatter(text) {
  const lines = text.split('\n');
  if (lines[0] !== '---') return null;
  const end = lines.indexOf('---', 1);
  if (end === -1) return null;
  return { frontmatter: lines.slice(1, end).join('\n'), body: lines.slice(end + 1).join('\n') };
}

// ------------------------------------------------------------------------------------------
// JSON Schema (Draft 2020-12 subset) validator — fails closed on anything it cannot enforce
// ------------------------------------------------------------------------------------------

const SCHEMA_ANNOTATIONS = new Set(['$schema', '$id', '$comment', 'title', 'description', 'examples', 'default']);
const SCHEMA_ASSERTIONS = new Set([
  'type',
  'const',
  'enum',
  'required',
  'minProperties',
  'maxProperties',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minLength',
  'maxLength',
  'pattern',
  'minimum',
  'maximum',
  '$ref',
]);
const SCHEMA_SINGLE = new Set(['additionalProperties', 'propertyNames', 'items', 'not']);
const SCHEMA_MAP = new Set(['properties', '$defs']);
const SCHEMA_LIST = new Set(['allOf', 'anyOf', 'oneOf']);
const SCHEMA_TYPES = new Set(['string', 'integer', 'number', 'boolean', 'object', 'array', 'null']);

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function resolveRef(root, ref) {
  if (typeof ref !== 'string' || !(ref === '#' || ref.startsWith('#/'))) {
    throw new Error(`unsupported $ref "${ref}" (only local "#/..." pointers are supported)`);
  }
  let node = root;
  if (ref === '#') return node;
  for (const raw of ref.slice(2).split('/')) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!isPlainObject(node) || !Object.hasOwn(node, key)) throw new Error(`unresolvable $ref "${ref}"`);
    node = node[key];
  }
  return node;
}

/**
 * Throw if a schema uses a keyword this validator does not enforce. A schema must never promise
 * a constraint that silently does nothing.
 */
export function checkSchemaKeywords(schema, root = schema, at = '#') {
  if (typeof schema === 'boolean') return;
  if (!isPlainObject(schema)) throw new Error(`${at}: a schema must be an object or a boolean`);
  for (const [key, value] of Object.entries(schema)) {
    if (SCHEMA_ANNOTATIONS.has(key)) continue;
    if (SCHEMA_ASSERTIONS.has(key)) {
      if (key === '$ref') resolveRef(root, value);
      if (key === 'pattern') new RegExp(value, 'u');
      if (key === 'type') {
        for (const t of [].concat(value)) {
          if (!SCHEMA_TYPES.has(t)) throw new Error(`${at}: unknown type "${t}"`);
        }
      }
      if ((key === 'required' || key === 'enum') && !Array.isArray(value)) {
        throw new Error(`${at}: "${key}" must be an array`);
      }
      continue;
    }
    if (SCHEMA_SINGLE.has(key)) {
      checkSchemaKeywords(value, root, `${at}/${key}`);
    } else if (SCHEMA_MAP.has(key)) {
      if (!isPlainObject(value)) throw new Error(`${at}: "${key}" must be an object`);
      for (const [name, sub] of Object.entries(value)) checkSchemaKeywords(sub, root, `${at}/${key}/${name}`);
    } else if (SCHEMA_LIST.has(key)) {
      if (!Array.isArray(value) || value.length === 0) throw new Error(`${at}: "${key}" must be a non-empty array`);
      value.forEach((sub, i) => checkSchemaKeywords(sub, root, `${at}/${key}/${i}`));
    } else {
      throw new Error(`${at}: unsupported JSON Schema keyword "${key}"`);
    }
  }
}

function jsonType(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

function typeMatches(v, t) {
  const actual = jsonType(v);
  return actual === t || (t === 'number' && actual === 'integer');
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (jsonType(a) !== jsonType(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  if (isPlainObject(a)) {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
  }
  return false;
}

export const ANY_OF_MISMATCH = 'must match at least one allowed shape';

function validateNode(v, s, root, at) {
  if (s === true) return [];
  if (s === false) return [`${at}: no value is allowed here`];
  const e = [];
  if (s.$ref !== undefined) e.push(...validateNode(v, resolveRef(root, s.$ref), root, at));
  if (s.type !== undefined) {
    const types = [].concat(s.type);
    if (!types.some((t) => typeMatches(v, t))) {
      e.push(`${at}: expected ${types.join(' or ')}, got ${jsonType(v)}`);
      return e;
    }
  }
  if (Object.hasOwn(s, 'const') && !deepEqual(v, s.const)) e.push(`${at}: must equal ${JSON.stringify(s.const)}`);
  if (s.enum !== undefined && !s.enum.some((x) => deepEqual(v, x))) {
    e.push(`${at}: must be one of ${JSON.stringify(s.enum)}`);
  }
  if (typeof v === 'string') {
    const length = [...v].length;
    if (s.minLength !== undefined && length < s.minLength) e.push(`${at}: must be at least ${s.minLength} characters`);
    if (s.maxLength !== undefined && length > s.maxLength) e.push(`${at}: must be at most ${s.maxLength} characters`);
    if (s.pattern !== undefined && !new RegExp(s.pattern, 'u').test(v)) e.push(`${at}: must match /${s.pattern}/`);
  }
  if (typeof v === 'number') {
    if (s.minimum !== undefined && v < s.minimum) e.push(`${at}: must be >= ${s.minimum}`);
    if (s.maximum !== undefined && v > s.maximum) e.push(`${at}: must be <= ${s.maximum}`);
  }
  if (Array.isArray(v)) {
    if (s.minItems !== undefined && v.length < s.minItems) e.push(`${at}: must have at least ${s.minItems} item(s)`);
    if (s.maxItems !== undefined && v.length > s.maxItems) e.push(`${at}: must have at most ${s.maxItems} item(s)`);
    if (s.uniqueItems === true && v.some((x, i) => v.findIndex((y) => deepEqual(x, y)) !== i)) {
      e.push(`${at}: items must be unique`);
    }
    if (s.items !== undefined) v.forEach((x, i) => e.push(...validateNode(x, s.items, root, `${at}[${i}]`)));
  }
  if (isPlainObject(v)) {
    const keys = Object.keys(v);
    for (const req of s.required ?? []) {
      if (!Object.hasOwn(v, req)) e.push(`${at}: missing required property "${req}"`);
    }
    if (s.minProperties !== undefined && keys.length < s.minProperties) {
      e.push(`${at}: must have at least ${s.minProperties} properties`);
    }
    if (s.maxProperties !== undefined && keys.length > s.maxProperties) {
      e.push(`${at}: must have at most ${s.maxProperties} properties`);
    }
    const props = s.properties ?? {};
    for (const key of keys) {
      const child = `${at}.${key}`;
      if (s.propertyNames !== undefined) {
        const nameErrors = validateNode(key, s.propertyNames, root, child);
        if (nameErrors.length) e.push(`${child}: invalid property name (${nameErrors.join('; ')})`);
      }
      if (Object.hasOwn(props, key)) e.push(...validateNode(v[key], props[key], root, child));
      else if (s.additionalProperties === false) e.push(`${child}: unknown property`);
      else if (s.additionalProperties !== undefined) e.push(...validateNode(v[key], s.additionalProperties, root, child));
    }
  }
  for (const sub of s.allOf ?? []) e.push(...validateNode(v, sub, root, at));
  if (s.anyOf !== undefined && !s.anyOf.some((sub) => validateNode(v, sub, root, at).length === 0)) {
    e.push(`${at}: ${ANY_OF_MISMATCH}`);
  }
  if (s.oneOf !== undefined && s.oneOf.filter((sub) => validateNode(v, sub, root, at).length === 0).length !== 1) {
    e.push(`${at}: must match exactly one allowed shape`);
  }
  if (s.not !== undefined && validateNode(v, s.not, root, at).length === 0) e.push(`${at}: matches a forbidden shape`);
  return e;
}

/** Validate `value` against `schema`. Returns a list of human-readable errors (empty when valid). */
export function validateSchema(value, schema) {
  checkSchemaKeywords(schema);
  return validateNode(value, schema, schema, '$');
}

// ------------------------------------------------------------------------------------------
// Globs
// ------------------------------------------------------------------------------------------

/**
 * Compile a repo-relative glob. `*` and `?` stay inside one path segment; a `**` segment spans
 * any number of directories (and, as the last segment, everything beneath the prefix).
 */
export function globToRegExp(glob) {
  if (typeof glob !== 'string' || glob === '' || /[\s\\]/.test(glob) || glob.startsWith('/')) {
    throw new Error(`invalid glob "${glob}" (repo-relative, no whitespace, no backslashes)`);
  }
  const segments = glob.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) {
    throw new Error(`invalid glob "${glob}" (empty, "." or ".." segment)`);
  }
  let re = '^';
  segments.forEach((seg, i) => {
    const last = i === segments.length - 1;
    if (seg === '**') {
      re += last ? '.+' : '(?:[^/]+/)*';
      return;
    }
    re += seg
      .replace(/[.+^${}()|[\]]/g, '\\$&')
      .replace(/\*+/g, '[^/]*')
      .replace(/\?/g, '[^/]');
    if (!last) re += '/';
  });
  return new RegExp(`${re}$`);
}

// ------------------------------------------------------------------------------------------
// Markdown helpers
// ------------------------------------------------------------------------------------------

/** Level-2 sections of a Markdown body, ignoring anything inside fenced code blocks. */
export function parseSections(body) {
  const sections = [];
  let current = null;
  let fence = null;
  for (const line of body.split('\n')) {
    const f = /^\s*(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (fence === null) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
    } else if (fence === null) {
      const h = /^## (.+?)\s*$/.exec(line);
      if (h) {
        current = { heading: h[1], lines: [] };
        sections.push(current);
        continue;
      }
    }
    if (current) current.lines.push(line);
  }
  return sections.map((s) => ({ heading: s.heading, content: s.lines.join('\n').trim() }));
}

/** Concrete model names found in `text`: `[{ line, match }]`. */
export function findModelNames(text, extraNames = []) {
  const hits = [];
  const extras = extraNames
    .filter((n) => typeof n === 'string' && n.trim() !== '')
    .map((name) => ({ name, matchers: nameMatchers(name) }));
  text.split('\n').forEach((line, i) => {
    for (const { re, label } of MODEL_NAME_PATTERNS) {
      const m = re.exec(line);
      if (m) hits.push({ line: i + 1, match: `${m[0].trim()} (${label})` });
    }
    for (const { name, matchers } of extras) {
      const m = matchers.map((re) => re.exec(line)).find(Boolean);
      if (m) hits.push({ line: i + 1, match: `${m[0].trim()} (bound in profiles/ as "${name}")` });
    }
  });
  return hits;
}

/**
 * Inline code spans of a Markdown document. Fenced code blocks are skipped, and a span may wrap
 * across lines but never across a blank line, so backticks are paired within one paragraph.
 */
function inlineCodeSpans(text) {
  const kept = [];
  let fence = null;
  for (const line of text.split('\n')) {
    const f = /^\s*(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (fence === null) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      kept.push('');
    } else {
      kept.push(fence === null ? line : '');
    }
  }
  const spans = [];
  for (const paragraph of kept.join('\n').split(/\n[ \t]*\n/)) {
    for (const m of paragraph.matchAll(/`([^`]+)`/g)) spans.push(m[1]);
  }
  return spans;
}

/**
 * Repo-relative paths a document refers to. Only inline code spans count: prose such as
 * "engineering/product decisions" and examples inside fenced blocks are not references.
 * Placeholders, globs and runtime paths are skipped.
 */
export function extractPathRefs(text) {
  const refs = new Set();
  for (const span of inlineCodeSpans(text)) {
    for (const m of span.matchAll(/[A-Za-z0-9_.~<>*{}$\/-]+/g)) {
      let token = m[0].replace(/[.,;:]+$/, '');
      if (!token.includes('/')) {
        if (/^(?:verify|rc-state|rc-receipt|rc-log)\.mjs$/.test(token)) refs.add(`scripts/${token}`);
        continue;
      }
      if (token.startsWith('~/.rcstack/dist/')) {
        // dist holds rules/, defaults/profiles/, contracts/, scripts/ and skills/, nothing else.
        // The first segment decides: a path into anything else is broken even when its later
        // segments are placeholders, and ".." may not be used to climb out of an installed tree.
        const rest = path.posix.normalize(token.slice('~/.rcstack/dist/'.length));
        const first = rest.split('/')[0];
        if (rest === '.' || /[<>*{}$~]/.test(first)) continue;
        const installed = /^(?:rules|contracts|scripts|skills)(?:\/|$)/.test(rest) || /^defaults(?:\/?$|\/profiles(?:\/|$))/.test(rest) || /^defaults\/[^/]*[<>*{}$~]/.test(rest);
        if (first === '..' || !installed) {
          refs.add(token);
          continue;
        }
        if (/^defaults\/?$/.test(rest)) continue;
        token = rest.replace(/^defaults\/profiles/, 'profiles');
      } else if (token.startsWith('~')) {
        continue;
      }
      if (/[<>*{}$~]/.test(token)) continue;
      token = token.replace(/\/+$/, '');
      if (/^(?:engineering|study|research)\/[a-z0-9-]+$/.test(token)) {
        refs.add(`skills/rc-router/playbooks/${token}.md`);
      } else if (/^(?:skills|contracts|scripts|profiles|rules|adapters|tests|docs|specs)\//.test(token)) {
        refs.add(token);
      }
    }
  }
  return [...refs].sort();
}

// ------------------------------------------------------------------------------------------
// Profile checks
// ------------------------------------------------------------------------------------------

function bindingModels(binding, slots) {
  const out = [];
  for (const slot of slots) {
    const ref = slot === 'primary' ? binding : binding?.[slot];
    if (isPlainObject(ref) && typeof ref.model === 'string') out.push({ slot, model: ref.model });
  }
  return out;
}

/** Cross-entry invariants JSON Schema cannot express. Call only on a schema-valid profile. */
export function checkProfileInvariants(profile) {
  const errors = [];
  const caps = profile.capabilities;
  const matrix = profile.review_matrix;
  const entries = Object.entries(matrix).filter(([key]) => key !== 'default_fallback');

  if (profile.profile !== `rcstack-${profile.domain}`) {
    errors.push(`profile "${profile.profile}" does not match domain "${profile.domain}"`);
  }

  // reviewer != builder, judged on model identity: "<Name>" and "<name-as-catalog-id>" are one model.
  const builderModels = new Map();
  for (const cap of BUILDER_CAPABILITIES) {
    for (const { slot, model } of bindingModels(caps[cap], ['primary', 'secondary', 'fallback'])) {
      if (![...builderModels.keys()].some((known) => sameModel(known, model))) builderModels.set(model, `capabilities.${cap}.${slot}`);
    }
  }
  entries.forEach(([builder], i) => {
    const twin = entries.slice(0, i).find(([other]) => sameModel(other, builder));
    if (twin) errors.push(`review_matrix lists the same builder model twice: "${twin[0]}" and "${builder}"`);
  });
  for (const [model, where] of builderModels) {
    if (!entries.some(([builder]) => sameModel(builder, model))) {
      errors.push(`review_matrix has no entry for builder model "${model}" (bound at ${where})`);
    }
  }
  for (const [builder, entry] of entries) {
    if (sameModel(entry.primary, builder)) errors.push(`reviewer == builder: review_matrix["${builder}"].primary`);
    if (entry.tier1_primary !== undefined && sameModel(entry.tier1_primary, builder)) {
      errors.push(`reviewer == builder: review_matrix["${builder}"].tier1_primary`);
    }
    if (sameModel(entry.fallback, builder)) errors.push(`reviewer == builder: review_matrix["${builder}"].fallback`);
    if (sameModel(entry.primary, entry.fallback)) {
      errors.push(`review_matrix["${builder}"]: primary and fallback reviewer are the same model`);
    }
  }
  const fallback = matrix.default_fallback;
  if ([...builderModels.keys(), ...entries.map(([builder]) => builder)].some((model) => sameModel(model, fallback))) {
    errors.push(`reviewer == builder: review_matrix.default_fallback "${fallback}" is also a builder model`);
  }

  // exclusive bindings serve one capability only and never review.
  for (const [cap, binding] of Object.entries(caps)) {
    if (binding.exclusive !== true) continue;
    for (const [other, otherBinding] of Object.entries(caps)) {
      if (other === cap) continue;
      const slots = ['primary', 'secondary', 'fallback', 'paired', 'companion'];
      if (bindingModels(otherBinding, slots).some((b) => sameModel(b.model, binding.model))) {
        errors.push(`capabilities.${cap} is exclusive but "${binding.model}" is also bound under capabilities.${other}`);
      }
    }
    const inMatrix = entries.flatMap(([builder, entry]) => [builder, entry.primary, entry.tier1_primary, entry.fallback]);
    if ([...inMatrix, fallback].some((model) => model !== undefined && sameModel(model, binding.model))) {
      errors.push(`capabilities.${cap} is exclusive but "${binding.model}" appears in review_matrix`);
    }
  }

  // Tier 2-3 floor: the state machine, the receipt gate and the evidence behind A2/A3.
  for (const tier of ['2', '3']) {
    for (const gate of ['require_state_file', 'require_verify', 'require_receipt_gate', 'require_cross_model_audit']) {
      if (profile.risk_tiers[tier][gate] !== true) {
        errors.push(`risk_tiers["${tier}"].${gate} must be true (Tier 2-3 floor)`);
      }
    }
  }

  for (const pattern of profile.tier3_path_patterns) {
    try {
      globToRegExp(pattern);
    } catch (err) {
      errors.push(`tier3_path_patterns: ${err.message}`);
    }
  }

  // Portable descriptors only: nothing machine-specific may be checked in or seeded.
  (function scan(node, at) {
    if (Array.isArray(node)) node.forEach((x, i) => scan(x, `${at}[${i}]`));
    else if (isPlainObject(node)) {
      for (const [key, value] of Object.entries(node)) {
        if (/provider[_-]?instance/i.test(key)) errors.push(`${at}.${key}: machine-specific provider instance ids are not portable`);
        scan(value, `${at}.${key}`);
      }
    } else if (typeof node === 'string' && UUID.test(node)) {
      errors.push(`${at}: machine-specific UUIDs are not portable`);
    }
  })(profile, '$');

  return errors;
}

/** Parse + schema-validate + invariant-check one profile document. */
export function checkProfileText(text, schema) {
  let profile;
  try {
    profile = parseYaml(text);
  } catch (err) {
    return { profile: null, errors: [`YAML: ${err.message}`] };
  }
  const errors = validateSchema(profile, schema);
  if (errors.length === 0) errors.push(...checkProfileInvariants(profile));
  return { profile: errors.length === 0 ? profile : null, errors };
}

/** Every concrete model name a profile binds or lists as a reviewer. */
export function profileModelNames(profile) {
  const names = new Set();
  for (const binding of Object.values(profile.capabilities ?? {})) {
    for (const { model } of bindingModels(binding, ['primary', 'secondary', 'fallback', 'paired', 'companion'])) {
      names.add(model);
    }
  }
  for (const [key, entry] of Object.entries(profile.review_matrix ?? {})) {
    if (key === 'default_fallback') {
      names.add(entry);
      continue;
    }
    names.add(key);
    for (const slot of ['primary', 'tier1_primary', 'fallback']) if (entry?.[slot]) names.add(entry[slot]);
  }
  return [...names].filter((n) => typeof n === 'string');
}

// ------------------------------------------------------------------------------------------
// Reporting + filesystem helpers
// ------------------------------------------------------------------------------------------

export class Report {
  constructor() {
    this.results = [];
  }

  /** Record one check. `errors` is a list of failure reasons; empty means pass. */
  check(name, errors) {
    const list = (Array.isArray(errors) ? errors : [errors]).filter(Boolean).map(String);
    this.results.push({ name, ok: list.length === 0, errors: list });
    return list.length === 0;
  }

  get failures() {
    return this.results.filter((r) => !r.ok);
  }

  get ok() {
    return this.failures.length === 0;
  }
}

function lstat(p) {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
}

/**
 * What `rel` is, looking only at real entries inside `root`: 'file', 'directory', or null. Every
 * component on the way must be a real directory, so nothing reached through a symbolic link
 * counts, and neither does a link, pipe, socket or device at the end of the path. A path that git
 * ignores and does not track, or that sits inside such a directory, is null too: an ignore rule
 * can never excuse a required entry, which is then reported missing. Only a check of a forbidden
 * entry passes `evenIfIgnored`, because being ignored must not hide that entry either.
 */
function entryKind(root, rel, { evenIfIgnored = false } = {}) {
  const segments = String(rel).split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return null;
  let current = root;
  for (let i = 0; i < segments.length; i += 1) {
    if (!evenIfIgnored && isIgnored(root, segments.slice(0, i + 1).join('/'))) return null;
    current = path.join(current, segments[i]);
    const st = lstat(current);
    if (!st) return null;
    if (i === segments.length - 1) return st.isFile() ? 'file' : st.isDirectory() ? 'directory' : null;
    if (!st.isDirectory()) return null;
  }
  return null;
}

function isFile(root, rel, options) {
  return entryKind(root, rel, options) === 'file';
}

function isDir(root, rel) {
  return entryKind(root, rel) === 'directory';
}

/**
 * The text of a regular file inside `root`, or null. It never opens anything else: reading a pipe
 * would block forever, and following a link would read a file from outside the checkout. Like
 * entryKind(), it treats an ignored, untracked path as absent unless `evenIfIgnored` is set.
 */
function read(root, rel, options) {
  if (!isFile(root, rel, options)) return null;
  try {
    return fs.readFileSync(path.join(root, rel), 'utf8');
  } catch {
    return null;
  }
}

/** Environment variables that point git at another repository; a hook or wrapper may have set them. */
const GIT_LOCATION_ENV = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_COMMON_DIR', 'GIT_NAMESPACE', 'GIT_PREFIX'];

/**
 * The paths under `dir` that git ignores and does not track, relative to `dir`; an ignored
 * directory is one entry ending in "/". Git decides, so every ignore source it honours counts
 * (`.gitignore`, `.git/info/exclude`, the user's excludes file) and none is parsed here. A
 * tracked file is never in the set, even when an ignore pattern matches it: only untracked paths
 * are listed. Outside a git worktree, or when git fails for any reason, the set is empty, which
 * means nothing is skipped and every path is judged.
 */
export function gitIgnoredPaths(dir) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !GIT_LOCATION_ENV.includes(key)));
  // core.fsmonitor can name a program; listing files must never run one.
  const args = ['-c', 'core.fsmonitor=false', '-C', dir, 'ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory'];
  const res = spawnSync('git', args, { encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 });
  if (res.error || res.status !== 0) return new Set();
  return new Set(res.stdout.split('\0').filter(Boolean));
}

/** Ignored-path sets of the repositories being verified, keyed by root. Set and cleared by runVerify(). */
const IGNORED = new Map();

function isIgnored(root, rel) {
  const set = IGNORED.get(root);
  return set !== undefined && (set.has(rel) || set.has(`${rel}/`));
}

/** Whether `rel` or any directory on the way to it is ignored (git collapses an ignored directory to one entry). */
function isIgnoredPath(root, rel) {
  const segments = String(rel).split('/');
  return segments.some((_, i) => isIgnored(root, segments.slice(0, i + 1).join('/')));
}

/**
 * The entries of a real directory inside `root` (or of `root` itself), or null. A directory
 * reached through a symbolic link is never listed: its files live outside the checkout, and
 * judging them would let outside content pass a check or show up in the report. Entries that git
 * ignores are left out unless the run asked for them (`--include-ignored`).
 */
function listDir(root, rel) {
  if (rel !== '' && !isDir(root, rel)) return null;
  try {
    return fs
      .readdirSync(path.join(root, rel), { withFileTypes: true })
      .filter((ent) => !isIgnored(root, rel ? `${rel}/${ent.name}` : ent.name));
  } catch {
    return null;
  }
}

/**
 * Every entry of the owned tree: the root files, the owned directories, and all they contain
 * (repo-relative). Custom top-level entries are not walked. Symlinks are reported, never followed.
 */
function walk(root, rel = '', out = []) {
  for (const ent of listDir(root, rel) ?? []) {
    if (rel === '' && !OWNED_DIRS.includes(ent.name) && !ROOT_FILES.includes(ent.name)) continue;
    const p = rel ? `${rel}/${ent.name}` : ent.name;
    out.push({ path: p, ent });
    if (ent.isDirectory()) walk(root, p, out);
  }
  return out;
}

/** Fail unless `rel` is a directory containing exactly `expected`; `kind` is 'file', 'directory' or null (any). */
function exactEntries(root, rel, expected, kind) {
  const entries = listDir(root, rel);
  if (!entries) {
    // An ignored, untracked directory counts as absent, like any other ignored path.
    const present = lstat(path.join(root, rel)) && !isIgnoredPath(root, rel);
    return [present ? `${rel} exists but is not a real directory` : `${rel}/ is missing`];
  }
  const errors = [];
  const names = entries.map((e) => e.name);
  for (const want of expected) {
    const ent = entries.find((e) => e.name === want);
    if (!ent) errors.push(`${rel}/${want} is missing`);
    else if (kind === 'file' && !ent.isFile()) errors.push(`${rel}/${want} is not a regular file`);
    else if (kind === 'directory' && !ent.isDirectory()) errors.push(`${rel}/${want} is not a directory`);
  }
  for (const name of names) {
    if (!expected.includes(name)) errors.push(`${rel}/${name} is not part of the system spec's tree`);
  }
  return errors;
}

// ------------------------------------------------------------------------------------------
// Slice 1 — foundation
// ------------------------------------------------------------------------------------------

/** The one file every spec directory holds. */
export const SPEC_FILE = 'spec.md';
const SPEC_DIR_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Validate a feature-local specs tree (system spec section 1.D). `dir` is the specs directory itself
 * and `label` is how messages name it. Every directory in the tree is a spec directory: it holds
 * a non-empty `spec.md`, so a sub-spec always sits inside its parent spec's directory. Any other
 * regular file may sit beside a `spec.md`. Only the shape of the tree is judged: deciding what a
 * document says would take a Markdown parser, and a validator that misreads prose is worse than
 * one that does not read it. `ignored` is a gitIgnoredPaths() set relative to `dir`; those entries
 * are skipped as if they were absent.
 */
export function checkSpecsTree(dirArg, label = 'specs', { ignored = new Set() } = {}) {
  if (typeof dirArg !== 'string' || dirArg === '') return [`${label}/ does not exist`];
  // Resolve the path lexically first: a trailing "/" or "/." would make lstat follow a symlinked
  // specs directory instead of seeing the link.
  const dir = path.resolve(dirArg);
  const top = lstat(dir);
  if (!top) return [`${label}/ does not exist`];
  if (!top.isDirectory()) return [`${label} exists but is not a directory`];
  const errors = [];
  const visit = (abs, rel, depth, sub = '') => {
    let entries;
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true }).filter((ent) => !ignored.has(`${sub}${ent.name}`) && !ignored.has(`${sub}${ent.name}/`));
    } catch (err) {
      errors.push(`${rel}/ cannot be read: ${err.message}`);
      return;
    }
    entries.sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
    if (depth > 0) {
      // The name is matched against the directory listing, so "SPEC.md" never counts as
      // "spec.md", even on a filesystem that ignores case.
      const spec = entries.find((ent) => ent.name === SPEC_FILE);
      if (!spec) {
        errors.push(`${rel}/ has no ${SPEC_FILE}: every directory under ${label}/ is a spec directory, and a sub-spec lives inside its parent's`);
      } else if (spec.isFile()) {
        let text = null;
        try {
          text = fs.readFileSync(path.join(abs, SPEC_FILE), 'utf8');
        } catch (err) {
          errors.push(`${rel}/${SPEC_FILE} cannot be read: ${err.message}`);
        }
        if (text !== null && text.replace(/^\uFEFF/, '').trim() === '') errors.push(`${rel}/${SPEC_FILE} is empty`);
      } else if (!spec.isSymbolicLink()) {
        errors.push(`${rel}/${SPEC_FILE} is not a regular file`);
      }
    }
    for (const ent of entries) {
      const childRel = `${rel}/${ent.name}`;
      if (ent.isSymbolicLink()) {
        errors.push(`${childRel} is a symbolic link`);
      } else if (depth > 0 && ent.name === SPEC_FILE) {
        // judged above, whatever kind of entry it is
      } else if (ent.isDirectory()) {
        if (!SPEC_DIR_NAME.test(ent.name)) errors.push(`${childRel}/ is not a lowercase kebab-case name`);
        visit(path.join(abs, ent.name), childRel, depth + 1, `${sub}${ent.name}/`);
      } else if (!ent.isFile()) {
        // A pipe, socket or device beside a spec is never a document, and reading one can hang.
        errors.push(`${childRel} is not a regular file`);
      } else if (depth === 0) {
        errors.push(`${childRel} is a loose file: ${label}/ holds only spec directories`);
      }
    }
  };
  visit(dir, label, 0);
  return errors;
}

function checkDecisions(text) {
  const errors = [];
  const heads = [...text.matchAll(/^## (DEC-\d{3})\b.*$/gm)];
  if (heads.length === 0) return ['no "## DEC-NNN" entry found'];
  const seen = new Set();
  heads.forEach((head, i) => {
    const id = head[1];
    if (seen.has(id)) errors.push(`${id} is defined twice`);
    seen.add(id);
    const body = text.slice(head.index, heads[i + 1]?.index ?? text.length);
    for (const field of ['Date', 'Status', 'Decision', 'Rejected Alternative', 'Guardrail']) {
      if (!new RegExp(`${field}:\\*{0,2}[ \\t]*\\S`).test(body)) errors.push(`${id} is missing "${field}:"`);
    }
    if (!/Date:\*{0,2}[ \t]*\d{4}-\d{2}-\d{2}\b/.test(body)) errors.push(`${id} needs a YYYY-MM-DD date`);
  });
  return errors;
}

/** Remove comments, leaving string and template literals intact. Regex literals are not parsed. */
function stripComments(source) {
  let out = '';
  let quote = null;
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i];
    const next = source[i + 1];
    if (quote !== null) {
      out += c;
      if (c === '\\') {
        out += next ?? '';
        i += 1;
      } else if (c === quote || (c === '\n' && quote !== '`')) {
        quote = null;
      }
    } else if (c === '"' || c === "'" || c === '`') {
      quote = c;
      out += c;
    } else if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      out += '\n';
    } else if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 1;
      out += ' ';
    } else {
      out += c;
    }
  }
  return out;
}

/**
 * Module specifiers a source file loads; null stands for a specifier that is computed and so cannot
 * be verified. The scan is deliberately broad and fails safe: it needs no statement boundary or
 * whitespace, and it reads the source twice, as written and with comments removed, because either
 * view alone can be fooled (a comment inside a statement, or "//" inside a string).
 */
function importSpecifiers(source) {
  const specs = new Set();
  const literal = (text) => /^(['"])([^'"\n]+)\1$/.exec(text.trim())?.[2] ?? null;
  for (const text of [source, stripComments(source)]) {
    for (const m of text.matchAll(/\bimport\b\s*(?:[\w$*{},\s]*?\bfrom\b\s*)?['"]([^'"\n]+)['"]/g)) specs.add(m[1]);
    for (const m of text.matchAll(/\bexport\b\s*(?:\*(?:\s*as\s+[\w$]+)?|\{[^}]*\})\s*from\s*['"]([^'"\n]+)['"]/g)) specs.add(m[1]);
    for (const m of text.matchAll(/\bimport\s*\(([^)]*)\)/g)) specs.add(literal(m[1]));
    for (const m of text.matchAll(/\brequire\s*\(([^)]*)\)/g)) specs.add(literal(m[1]));
  }
  return [...specs];
}

function checkImports(root) {
  const errors = [];
  for (const dir of ['scripts', 'tests']) {
    for (const ent of listDir(root, dir) ?? []) {
      if (!ent.isFile() || !/\.(?:mjs|cjs|js)$/.test(ent.name)) continue;
      const rel = `${dir}/${ent.name}`;
      for (const spec of importSpecifiers(read(root, rel) ?? '')) {
        if (spec === null) {
          // The scan is deliberately dumb: it also reads comments and strings, so it fails safe.
          errors.push(`${rel} loads a module through a computed specifier, which cannot be verified (reword it if this is prose)`);
        } else if (spec.startsWith('node:')) {
          continue;
        } else if (spec.startsWith('./') || spec.startsWith('../')) {
          if (!isFile(root, path.posix.normalize(`${dir}/${spec}`))) errors.push(`${rel} imports "${spec}", which does not exist`);
        } else {
          errors.push(`${rel} imports "${spec}" (only "node:" built-ins and relative files are allowed)`);
        }
      }
    }
  }
  // package.json is forbidden from declaring dependencies, so it is judged even when git ignores it.
  const pkg = read(root, 'package.json', { evenIfIgnored: true });
  if (pkg !== null) {
    try {
      const json = JSON.parse(pkg);
      for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
        if (json[field] && Object.keys(json[field]).length > 0) errors.push(`package.json declares ${field}`);
      }
    } catch {
      errors.push('package.json is not valid JSON');
    }
  }
  if (lstat(path.join(root, 'node_modules'))) errors.push('node_modules/ must not exist');
  return errors;
}

function sliceOne(root, r) {
  for (const file of ['README.md', 'AGENTS.md', SYSTEM_SPEC, 'docs/decisions.md', 'scripts/verify.mjs']) {
    r.check(`S1 required file ${file}`, isFile(root, file) ? [] : ['missing']);
  }

  const agents = read(root, 'AGENTS.md');
  if (agents !== null) {
    const lineCount = agents.replace(/\n$/, '').split('\n').length;
    r.check('S1 AGENTS.md is repo law under 100 lines with the verify command', [
      lineCount < 100 ? '' : `${lineCount} lines (must be < 100)`,
      agents.includes('node scripts/verify.mjs') ? '' : 'does not name `node scripts/verify.mjs`',
    ]);
  }

  const decisions = read(root, 'docs/decisions.md');
  if (decisions !== null) {
    r.check('S1 docs/decisions.md entries carry Date, Status, Decision, Rejected Alternative, Guardrail', checkDecisions(decisions));
  }

  const all = walk(root);
  // A spec directory may be named for its subject, so documents under specs/ are exempt: nothing
  // there is ever installed or read as a playbook. Custom top-level directories are not judged.
  const strayPlaybooks = all
    .filter(({ path: p, ent }) => ent.isDirectory() && ent.name === 'playbooks' && p !== 'skills/rc-router/playbooks' && !p.startsWith('specs/'))
    .map(({ path: p }) => `${p} (playbooks live only under skills/rc-router/playbooks/)`);
  r.check('S1 no playbooks directory in the owned tree outside skills/rc-router/', strayPlaybooks);

  // The root is open, so these names are looked up directly: being ignored by git does not excuse them.
  let rootNames = [];
  try {
    rootNames = fs.readdirSync(root);
  } catch {
    // an unreadable root is reported by the required-file checks above
  }
  const forbidden = Object.entries(FORBIDDEN_ROOT_ENTRIES)
    .filter(([name]) => rootNames.includes(name))
    .map(([name, why]) => `${name} must not exist at the repository root (${why})`);
  r.check('S1 the repository root holds no forbidden entry (custom top-level entries are allowed)', forbidden);
  if (lstat(path.join(root, 'specs'))) {
    const ignoredSpecs = new Set([...(IGNORED.get(root) ?? [])].filter((p) => p.startsWith('specs/')).map((p) => p.slice('specs/'.length)));
    r.check(
      'S1 specs/ holds feature-local specs: every directory has a spec.md, so a sub-spec sits inside its parent',
      checkSpecsTree(path.join(root, 'specs'), 'specs', { ignored: ignoredSpecs }),
    );
  }

  const skillErrors = [];
  const skillsStat = lstat(path.join(root, 'skills'));
  if (skillsStat && !skillsStat.isDirectory()) skillErrors.push('skills exists but is not a directory');
  for (const ent of listDir(root, 'skills') ?? []) {
    if (!ent.isDirectory()) skillErrors.push(`skills/${ent.name} is not a directory`);
    else if (!APPROVED_SKILLS.includes(ent.name)) skillErrors.push(`skills/${ent.name} is not one of the 5 approved skills`);
  }
  r.check('S1 skills/ holds only approved top-level skills', skillErrors);

  r.check(
    'S1 no symbolic links in the owned source tree',
    all.filter(({ ent }) => ent.isSymbolicLink()).map(({ path: p }) => `${p} is a symbolic link`),
  );

  r.check('S1 zero third-party dependencies (node: built-ins and relative imports only)', checkImports(root));
}

// ------------------------------------------------------------------------------------------
// Slice 2 — profiles, contracts, rules, rc-router, playbooks
// ------------------------------------------------------------------------------------------

function loadJson(root, rel) {
  const text = read(root, rel);
  if (text === null) return { value: null, errors: ['missing'] };
  try {
    return { value: JSON.parse(text), errors: [] };
  } catch (err) {
    return { value: null, errors: [`invalid JSON: ${err.message}`] };
  }
}

function checkProfiles(root, r) {
  const profiles = {};
  r.check(
    'S2 profiles/ holds exactly schema.json and the 3 profile templates',
    exactEntries(root, 'profiles', ['schema.json', ...PROFILE_NAMES.map((n) => `${n}.yaml`)], 'file'),
  );
  const schema = loadJson(root, 'profiles/schema.json');
  if (schema.value !== null) {
    try {
      checkSchemaKeywords(schema.value);
    } catch (err) {
      schema.errors.push(err.message);
    }
  }
  r.check('S2 profiles/schema.json is valid JSON Schema this validator fully enforces', schema.errors);
  for (const name of PROFILE_NAMES) {
    const rel = `profiles/${name}.yaml`;
    const text = read(root, rel);
    let errors = ['missing'];
    if (text !== null && schema.errors.length > 0) errors = ['cannot validate: profiles/schema.json is unusable'];
    else if (text !== null) {
      const result = checkProfileText(text, schema.value);
      errors = result.errors;
      if (result.profile && result.profile.profile !== name) {
        errors.push(`profile "${result.profile.profile}" does not match the file name`);
      } else if (result.profile) {
        profiles[name] = result.profile;
      }
    }
    r.check(`S2 ${rel} parses (strict YAML), satisfies the schema, and keeps reviewer != builder`, errors);
  }
  return profiles;
}

function checkContracts(root, r) {
  r.check('S2 contracts/ holds exactly the 6 contracts', exactEntries(root, 'contracts', CONTRACT_FILES, 'file'));
  for (const [file, needles] of Object.entries(CONTRACT_REQUIREMENTS)) {
    const text = read(root, `contracts/${file}`);
    if (text === null) continue;
    r.check(
      `S2 contracts/${file} defines its required sections and fields`,
      needles.filter((n) => !text.includes(n)).map((n) => `missing "${n}"`),
    );
  }
  const telemetry = loadJson(root, 'contracts/telemetry-event.schema.json');
  if (telemetry.value !== null) {
    try {
      checkSchemaKeywords(telemetry.value);
      const s = telemetry.value;
      for (const field of TELEMETRY_REQUIRED_FIELDS) {
        if (!(s.required ?? []).includes(field)) telemetry.errors.push(`"${field}" is not required`);
        if (!Object.hasOwn(s.properties ?? {}, field)) telemetry.errors.push(`"${field}" has no property schema`);
      }
      if (s.properties?.schema_version?.const !== 1) telemetry.errors.push('schema_version must be const 1');
      if (s.additionalProperties !== false) telemetry.errors.push('additionalProperties must be false');
    } catch (err) {
      telemetry.errors.push(err.message);
    }
  }
  r.check('S2 contracts/telemetry-event.schema.json is valid and requires every telemetry field', telemetry.errors);
}

function checkRules(root, r) {
  const errors = exactEntries(root, 'rules', RULE_FILES, 'file');
  for (const file of RULE_FILES) {
    const text = read(root, `rules/${file}`);
    if (text !== null && text.trim() === '') errors.push(`rules/${file} is empty`);
  }
  r.check('S2 rules/ holds exactly the 3 non-empty rule files', errors);
}

function refList(value, prefix, allowed, label) {
  const errors = [];
  if (!Array.isArray(value)) return [`${label} must be a sequence (use [] for none)`];
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== 'string' || !item.startsWith(prefix) || !allowed.includes(item.slice(prefix.length))) {
      errors.push(`${label}: "${item}" is not a known ${prefix}* path`);
    } else if (seen.has(item)) {
      errors.push(`${label}: "${item}" is listed twice`);
    }
    seen.add(item);
  }
  return errors;
}

function headingErrors(sections, expected) {
  const errors = [];
  const found = sections.map((s) => s.heading);
  if (found.join(' | ') !== expected.join(' | ')) {
    errors.push(`"##" headings must be exactly [${expected.join(' | ')}] in that order, found [${found.join(' | ')}]`);
  }
  for (const s of sections) {
    if (expected.includes(s.heading) && s.content === '') errors.push(`"## ${s.heading}" is empty`);
  }
  return errors;
}

function modelNameErrors(text, modelNames) {
  return findModelNames(text, modelNames).map((h) => `line ${h.line}: hardcoded model name "${h.match}"`);
}

function parseFrontmatter(text, requiredKeys) {
  const parts = splitFrontmatter(text);
  if (!parts) return { errors: ['missing "---" YAML frontmatter'], data: null, body: text };
  let data;
  try {
    data = parseYaml(parts.frontmatter);
  } catch (err) {
    return { errors: [`frontmatter: ${err.message}`], data: null, body: parts.body };
  }
  const errors = [];
  if (!isPlainObject(data)) return { errors: ['frontmatter must be a mapping'], data: null, body: parts.body };
  for (const key of requiredKeys) if (!Object.hasOwn(data, key)) errors.push(`frontmatter is missing "${key}"`);
  for (const key of Object.keys(data)) if (!requiredKeys.includes(key)) errors.push(`frontmatter has unknown key "${key}"`);
  return { errors, data, body: parts.body };
}

const SKILL_KEYS = ['name', 'description', 'version', 'entry_mode', 'capability', 'invokes_contracts', 'invokes_scripts'];

function checkSkill(root, name, slice, modelNames) {
  const rel = `skills/${name}/SKILL.md`;
  const text = read(root, rel);
  if (text === null) return ['missing'];
  const fm = parseFrontmatter(text, SKILL_KEYS);
  const errors = [...fm.errors];
  const d = fm.data;
  if (d) {
    if (d.name !== name) errors.push(`frontmatter name "${d.name}" must equal "${name}"`);
    if (typeof d.description !== 'string' || d.description.trim() === '') errors.push('frontmatter description must be a non-empty string');
    if (typeof d.version !== 'string' || !SEMVER.test(d.version)) errors.push('frontmatter version must be MAJOR.MINOR.PATCH');
    const mode = name === 'rc-router' ? 'front_door' : 'standalone_or_router';
    if (d.entry_mode !== mode) errors.push(`frontmatter entry_mode must be "${mode}"`);
    if (typeof d.capability !== 'string' || !/^[a-z][a-z0-9_]*$/.test(d.capability)) {
      errors.push('frontmatter capability must be an abstract lowercase identifier');
    }
    const contractErrors = refList(d.invokes_contracts, 'contracts/', CONTRACT_FILES, 'invokes_contracts');
    const scriptErrors = refList(d.invokes_scripts, 'scripts/', SCRIPT_FILES, 'invokes_scripts');
    errors.push(...contractErrors, ...scriptErrors);
    if (contractErrors.length === 0) {
      for (const ref of d.invokes_contracts) if (!isFile(root, ref)) errors.push(`invokes_contracts: ${ref} does not exist`);
    }
    if (scriptErrors.length === 0 && slice >= 3) {
      for (const ref of d.invokes_scripts) if (!isFile(root, ref)) errors.push(`invokes_scripts: ${ref} does not exist`);
    }
    if (name === 'rc-router' && contractErrors.length === 0 && scriptErrors.length === 0) {
      for (const file of CONTRACT_FILES.filter((f) => f.endsWith('.md'))) {
        if (!d.invokes_contracts.includes(`contracts/${file}`)) errors.push(`rc-router must invoke contracts/${file}`);
      }
      for (const file of SCRIPT_FILES.filter((f) => f !== 'verify.mjs')) {
        if (!d.invokes_scripts.includes(`scripts/${file}`)) errors.push(`rc-router must invoke scripts/${file}`);
      }
    }
  }
  const sections = parseSections(fm.body);
  errors.push(...headingErrors(sections, SKILL_HEADINGS));
  const section = (h) => sections.find((s) => s.heading === h)?.content ?? '';
  if (section('Single Job').split(/\n\s*\n/).length > 1) errors.push('"## Single Job" must be a single sentence');
  if (section('Procedure') !== '' && !/^\d+\. /m.test(section('Procedure'))) errors.push('"## Procedure" must be a numbered list');
  const boundary = section('Do NOT Use When');
  if (name === 'rc-router') {
    if (!/Tier 0/.test(boundary)) errors.push('"## Do NOT Use When" must tell rc-router to skip heavy ceremony for Tier 0 lookups');
  } else if (!boundary.includes('rc-router')) {
    errors.push('"## Do NOT Use When" must say when to defer to rc-router');
  }
  errors.push(...modelNameErrors(text, modelNames));
  const extras = (listDir(root, `skills/${name}`) ?? [])
    .map((e) => e.name)
    .filter((n) => n !== 'SKILL.md' && !(name === 'rc-router' && n === 'playbooks'));
  for (const extra of extras) errors.push(`skills/${name}/${extra} is not part of the system spec's tree`);
  return errors;
}

const PLAYBOOK_KEYS = ['name', 'profile', 'entry_mode', 'default_tier', 'required_assurance', 'required_capabilities', 'contracts'];

function checkPlaybook(root, pb, profiles, modelNames) {
  const rel = `skills/rc-router/playbooks/${pb.domain}/${pb.name}.md`;
  const text = read(root, rel);
  if (text === null) return ['missing'];
  const fm = parseFrontmatter(text, PLAYBOOK_KEYS);
  const errors = [...fm.errors];
  const d = fm.data;
  const sections = parseSections(fm.body);
  const section = (h) => sections.find((s) => s.heading === h)?.content ?? '';
  errors.push(...headingErrors(sections, PLAYBOOK_HEADINGS));

  if (!section('Router-Only Invocation Boundary').includes(ROUTER_ONLY_RULE)) {
    errors.push('"## Router-Only Invocation Boundary" is missing the verbatim ROUTER-ONLY: rule');
  }
  const alternatives = [...PLAYBOOKS.map((p) => p.name).filter((n) => n !== pb.name), ...APPROVED_SKILLS];
  if (!alternatives.some((alt) => section('Do NOT Use When').includes(`\`${alt}\``))) {
    errors.push('"## Do NOT Use When" must point to an alternative playbook or top-level skill');
  }
  if (section('Workflow Phases') !== '' && !/^\d+\. /m.test(section('Workflow Phases'))) {
    errors.push('"## Workflow Phases" must be a numbered list of phases');
  }
  errors.push(...modelNameErrors(text, modelNames));

  if (!d) return errors;
  if (d.name !== pb.name) errors.push(`frontmatter name "${d.name}" must equal the file name "${pb.name}"`);
  if (d.profile !== `rcstack-${pb.domain}`) errors.push(`frontmatter profile must be "rcstack-${pb.domain}" (parent directory)`);
  if (d.entry_mode !== 'router_only') errors.push('frontmatter entry_mode must be "router_only"');
  if (d.default_tier !== pb.tier) errors.push(`frontmatter default_tier must be ${pb.tier} (system spec section 2.4)`);
  if (d.required_assurance !== pb.assurance) errors.push(`frontmatter required_assurance must be "${pb.assurance}" (system spec section 2.4)`);

  const profile = profiles[`rcstack-${pb.domain}`];
  const knownCapabilities = [...(profile ? Object.keys(profile.capabilities) : CAPABILITY_KEYS), REVIEWER_CAPABILITY];
  let capabilities = [];
  if (!Array.isArray(d.required_capabilities) || d.required_capabilities.length === 0) {
    errors.push('frontmatter required_capabilities must be a non-empty sequence');
  } else {
    capabilities = d.required_capabilities;
    for (const cap of capabilities) {
      if (!knownCapabilities.includes(cap)) errors.push(`required_capabilities: "${cap}" is not an abstract capability`);
    }
    if (new Set(capabilities).size !== capabilities.length) errors.push('required_capabilities has duplicates');
  }
  const contractErrors = refList(d.contracts, 'contracts/', CONTRACT_FILES, 'contracts');
  errors.push(...contractErrors);
  const contracts = contractErrors.length === 0 ? d.contracts : [];
  for (const ref of contracts) if (!isFile(root, ref)) errors.push(`contracts: ${ref} does not exist`);

  // Honour every gate the profile sets for this playbook's default tier.
  const tier = profile?.risk_tiers?.[String(pb.tier)];
  if (tier && contractErrors.length === 0) {
    const workflow = `${section('Workflow Phases')}\n${section('Exit Gate & Definition of Done')}`;
    errors.push(...checkPlaybookGates({ playbook: pb, frontmatter: d, tierConfig: tier, contracts, capabilities, workflow }));
  }
  return errors;
}

function checkPlaybookTree(root, r, profiles, modelNames) {
  const base = 'skills/rc-router/playbooks';
  r.check(`S2 ${base}/ holds exactly TEMPLATE.md and the 3 domain directories`, [
    ...exactEntries(root, base, ['TEMPLATE.md', ...DOMAINS], null),
    isFile(root, `${base}/TEMPLATE.md`) ? '' : `${base}/TEMPLATE.md must be a regular file`,
    ...DOMAINS.map((d) => (isDir(root, `${base}/${d}`) ? '' : `${base}/${d}/ must be a directory`)),
  ]);
  for (const domain of DOMAINS) {
    const expected = PLAYBOOKS.filter((p) => p.domain === domain).map((p) => `${p.name}.md`);
    r.check(`S2 ${base}/${domain}/ holds exactly its ${expected.length} approved playbooks`, exactEntries(root, `${base}/${domain}`, expected, 'file'));
  }
  const template = read(root, `${base}/TEMPLATE.md`);
  if (template !== null) {
    const parts = splitFrontmatter(template);
    r.check('S2 playbook TEMPLATE.md carries the frontmatter keys, headings, and verbatim ROUTER-ONLY: rule', [
      parts ? '' : 'missing "---" YAML frontmatter',
      ...PLAYBOOK_KEYS.filter((k) => !new RegExp(`^${k}:`, 'm').test(parts?.frontmatter ?? '')).map((k) => `frontmatter is missing "${k}"`),
      ...headingErrors(parseSections(parts?.body ?? template), PLAYBOOK_HEADINGS),
      template.includes(ROUTER_ONLY_RULE) ? '' : 'missing the verbatim ROUTER-ONLY: rule',
      ...modelNameErrors(template, modelNames),
    ]);
  }
  for (const pb of PLAYBOOKS) {
    r.check(`S2 playbook ${pb.domain}/${pb.name} (T${pb.tier}, ${pb.assurance}) honours the playbook contract`, checkPlaybook(root, pb, profiles, modelNames));
  }
}

function sliceTwo(root, r, slice) {
  const profiles = checkProfiles(root, r);
  const modelNames = [...new Set(Object.values(profiles).flatMap(profileModelNames))];
  checkContracts(root, r);
  checkRules(root, r);

  const agnostic = ['AGENTS.md', ...RULE_FILES.map((f) => `rules/${f}`), ...CONTRACT_FILES.map((f) => `contracts/${f}`)];
  const leaks = [];
  for (const rel of agnostic) {
    for (const err of modelNameErrors(read(root, rel) ?? '', modelNames)) leaks.push(`${rel} ${err}`);
  }
  r.check('S2 AGENTS.md, rules/ and contracts/ name no concrete model', leaks);

  r.check('S2 skill rc-router honours the skill contract, negative boundary, and names no model', checkSkill(root, 'rc-router', slice, modelNames));
  checkPlaybookTree(root, r, profiles, modelNames);
  return { profiles, modelNames };
}

// ------------------------------------------------------------------------------------------
// Slice 3 — remaining skills, scripts, installer, tests, cross-references
// ------------------------------------------------------------------------------------------

function run(cmd, args) {
  const res = spawnSync(cmd, args, { encoding: 'utf8' });
  if (res.error) return [`could not run ${cmd}: ${res.error.message}`];
  return res.status === 0 ? [] : [`${cmd} ${args.join(' ')} exited ${res.status}: ${(res.stderr || res.stdout).trim()}`];
}

function checkCrossReferences(root) {
  // Feature specs may name files that do not exist yet, so specs/ is not scanned. The system
  // spec is the exception: it describes the repository as it is, so its references must resolve.
  const docs = [SYSTEM_SPEC, 'README.md', 'AGENTS.md', 'docs/decisions.md'];
  for (const { path: p, ent } of walk(root)) {
    if (ent.isFile() && p.endsWith('.md') && /^(?:skills|contracts|rules)\//.test(p)) docs.push(p);
  }
  const errors = [];
  for (const rel of docs) {
    const text = read(root, rel);
    if (text === null) continue;
    for (const ref of extractPathRefs(text)) {
      // entryKind() refuses ".." and links, so a reference cannot be satisfied from outside the checkout.
      if (entryKind(root, ref) === null) errors.push(`${rel} refers to ${ref}, which does not exist`);
    }
  }
  return errors;
}

function sliceThree(root, r, { profiles, modelNames }) {
  r.check('S3 skills/ holds exactly the 5 approved skills', exactEntries(root, 'skills', APPROVED_SKILLS, 'directory'));
  for (const name of APPROVED_SKILLS.filter((n) => n !== 'rc-router')) {
    r.check(`S3 skill ${name} honours the skill contract, negative boundary, and names no model`, checkSkill(root, name, 3, modelNames));
  }

  r.check('S3 scripts/ holds exactly the 4 deterministic tools', exactEntries(root, 'scripts', SCRIPT_FILES, 'file'));
  for (const file of SCRIPT_FILES) {
    const rel = `scripts/${file}`;
    r.check(`S3 ${rel} passes node --check`, isFile(root, rel) ? run(process.execPath, ['--check', path.join(root, rel)]) : ['missing']);
  }

  const installer = 'adapters/install.sh';
  // Only a real file inside the checkout is examined and handed to bash.
  const st = isFile(root, installer) ? lstat(path.join(root, installer)) : null;
  r.check('S3 adapters/ holds exactly install.sh', exactEntries(root, 'adapters', ['install.sh'], 'file'));
  r.check(`S3 ${installer} is executable, strict-mode bash, and passes bash -n`, [
    ...(st?.isFile()
      ? [
          st.mode & 0o111 ? '' : 'is not executable (chmod +x)',
          /^set -euo pipefail$/m.test(read(root, installer) ?? '') ? '' : 'does not run under `set -euo pipefail`',
          ...run('bash', ['-n', path.join(root, installer)]),
        ]
      : ['missing']),
  ]);

  r.check('S3 tests/ holds exactly the 5 hermetic suites', exactEntries(root, 'tests', TEST_FILES, 'file'));

  const tier3 = [];
  for (const [name, profile] of Object.entries(profiles)) {
    for (const pattern of profile.tier3_path_patterns) {
      if (/[*?]/.test(pattern) || !/^(?:adapters|scripts|profiles|contracts|skills|rules|tests|docs)\//.test(pattern)) continue;
      if (entryKind(root, pattern) === null) tier3.push(`profiles/${name}.yaml tier3_path_patterns names ${pattern}, which does not exist`);
    }
  }
  r.check('S3 cross-references across skills, playbooks, contracts, scripts, profiles and docs resolve', [
    ...checkCrossReferences(root),
    ...tier3,
  ]);
}

// ------------------------------------------------------------------------------------------
// Entry points
// ------------------------------------------------------------------------------------------

/**
 * Run every check up to `slice` against the repository at `root`. Paths that git ignores are
 * skipped unless `includeIgnored` is set; the installer sets it, because it copies whole
 * directories and so must have every file in them judged.
 */
export function runVerify({ root, slice = 3, includeIgnored = false }) {
  const r = new Report();
  if (includeIgnored) IGNORED.delete(root);
  else IGNORED.set(root, gitIgnoredPaths(root));
  try {
    return runSlices(root, slice, r);
  } finally {
    IGNORED.delete(root);
  }
}

function runSlices(root, slice, r) {
  const guarded = (label, fn) => {
    try {
      return fn();
    } catch (err) {
      r.check(`${label} completed without an internal error`, [err.stack ?? String(err)]);
      return null;
    }
  };
  guarded('S1', () => sliceOne(root, r));
  let two = null;
  if (slice >= 2) two = guarded('S2', () => sliceTwo(root, r, slice));
  if (slice >= 3) guarded('S3', () => sliceThree(root, r, two ?? { profiles: {}, modelNames: [] }));
  return r;
}

/** Validate one profile file (used by rc-setup against machine-local profiles). */
export function runProfileCheck({ profilePath, schemaPath }) {
  const r = new Report();
  let schema = null;
  const schemaErrors = [];
  try {
    schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    checkSchemaKeywords(schema);
  } catch (err) {
    schemaErrors.push(err.message);
  }
  r.check(`schema ${schemaPath} is usable`, schemaErrors);
  if (schemaErrors.length === 0) {
    let errors;
    try {
      errors = checkProfileText(fs.readFileSync(profilePath, 'utf8'), schema).errors;
    } catch (err) {
      errors = [err.message];
    }
    r.check(`profile ${profilePath} parses (strict YAML), satisfies the schema, and keeps reviewer != builder`, errors);
  }
  return r;
}

/** Validate one feature-local specs tree (used by rc-init and rc-doctor on a target repository). */
export function runSpecsCheck({ specsPath, label, includeIgnored = false }) {
  const r = new Report();
  // Git is only pointed at a real directory: through a link it would read another repository.
  const real = typeof specsPath === 'string' && specsPath !== '' && lstat(path.resolve(specsPath))?.isDirectory();
  const ignored = includeIgnored || !real ? new Set() : gitIgnoredPaths(path.resolve(specsPath));
  r.check(`${label} follows the feature-local spec layout`, checkSpecsTree(specsPath, label, { ignored }));
  return r;
}

function printReport(r, { quiet, label }) {
  for (const res of r.results) {
    if (res.ok) {
      if (!quiet) console.log(`[PASS] ${res.name}`);
    } else {
      console.log(`[FAIL] ${res.name}`);
      for (const err of res.errors) console.log(`       - ${err.replace(/\n/g, '\n         ')}`);
    }
  }
  const failed = r.failures.length;
  console.log(`${label}: ${r.results.length} checks, ${r.results.length - failed} passed, ${failed} failed -> ${failed === 0 ? 'PASS' : 'FAIL'}`);
}

const USAGE = `Usage:
  node scripts/verify.mjs [--slice=1|2|3] [--root <dir>] [--include-ignored] [--quiet]
  node scripts/verify.mjs --profile <file.yaml> [--schema <schema.json>] [--quiet]
  node scripts/verify.mjs --specs <dir> [--include-ignored] [--quiet]

  --slice=N   1 = foundation; 2 = + profiles, contracts, rules, rc-router, playbooks; 3 = everything (default)
  --root      repository to validate (default: the checkout containing this script)
  --profile   validate a single profile file instead of the repository
  --schema    profile schema for --profile (default: profiles/schema.json or defaults/profiles/schema.json)
  --specs     validate one feature-local specs directory (any repository) instead of this repository
  --include-ignored  also judge paths that git ignores (default: untracked ignored paths are skipped)
  --quiet     print only failures and the summary line
Exit status: 0 on a full pass, 1 on any failure or usage error.`;

export function main(argv) {
  const opts = { slice: null, quiet: false, includeIgnored: false, root: null, profile: null, schema: null, specs: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const eq = arg.indexOf('=');
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    const value = () => {
      if (eq !== -1) return arg.slice(eq + 1);
      i += 1;
      if (i >= argv.length) throw new Error(`${flag} needs a value`);
      return argv[i];
    };
    try {
      if ((flag === '--help' || flag === '--quiet' || flag === '--include-ignored') && eq !== -1) throw new Error(`${flag} takes no value`);
      if (flag === '--help' || flag === '-h') {
        console.log(USAGE);
        return 0;
      } else if (flag === '--quiet') opts.quiet = true;
      else if (flag === '--include-ignored') opts.includeIgnored = true;
      else if (flag === '--slice') opts.slice = value();
      else if (flag === '--root') opts.root = value();
      else if (flag === '--profile') opts.profile = value();
      else if (flag === '--schema') opts.schema = value();
      else if (flag === '--specs') opts.specs = value();
      else throw new Error(`unknown argument "${arg}"`);
    } catch (err) {
      console.error(`verify: ${err.message}\n${USAGE}`);
      return 1;
    }
  }
  if (opts.slice !== null && !['1', '2', '3'].includes(opts.slice)) {
    console.error(`verify: --slice must be 1, 2 or 3 (got "${opts.slice}")\n${USAGE}`);
    return 1;
  }
  if (opts.specs !== null && (opts.slice !== null || opts.root !== null || opts.profile !== null || opts.schema !== null)) {
    console.error(`verify: --specs cannot be combined with --slice, --root, --profile or --schema\n${USAGE}`);
    return 1;
  }
  if (opts.profile !== null && (opts.slice !== null || opts.includeIgnored)) {
    console.error(`verify: --profile cannot be combined with --slice or --include-ignored\n${USAGE}`);
    return 1;
  }
  if (opts.specs !== null) {
    if (opts.specs.trim() === '') {
      console.error(`verify: --specs needs a directory\n${USAGE}`);
      return 1;
    }
    const label = opts.specs.replace(/\/+$/, '') || '/';
    const r = runSpecsCheck({ specsPath: path.resolve(opts.specs), label, includeIgnored: opts.includeIgnored });
    printReport(r, { quiet: opts.quiet, label: 'verify --specs' });
    return r.ok ? 0 : 1;
  }
  const root = path.resolve(opts.root ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));

  if (opts.profile !== null) {
    // Source checkouts keep the schema in profiles/; an installed dist keeps it in defaults/profiles/.
    const defaults = [path.join(root, 'profiles/schema.json'), path.join(root, 'defaults/profiles/schema.json')];
    const schemaPath = opts.schema ?? defaults.find((p) => fs.existsSync(p)) ?? defaults[0];
    const r = runProfileCheck({ profilePath: path.resolve(opts.profile), schemaPath: path.resolve(schemaPath) });
    printReport(r, { quiet: opts.quiet, label: 'verify --profile' });
    return r.ok ? 0 : 1;
  }

  // The checkout may be reached through a link (stat follows it); everything inside it must be real.
  let rootStat = null;
  try {
    rootStat = fs.statSync(root);
  } catch {
    // reported below
  }
  if (!rootStat?.isDirectory()) {
    console.error(`verify: --root "${root}" is not a directory`);
    return 1;
  }
  const slice = Number(opts.slice ?? 3);
  const r = runVerify({ root, slice, includeIgnored: opts.includeIgnored });
  printReport(r, { quiet: opts.quiet, label: `verify --slice=${slice}` });
  return r.ok ? 0 : 1;
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
