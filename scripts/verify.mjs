#!/usr/bin/env node
// scripts/verify.mjs — deterministic repository validator for rcstack-beta (SPEC.md §5.1).
//
// Zero third-party dependencies: Node.js >= 20 built-ins only.
//
// Usage:   node scripts/verify.mjs [--slice=1|2|3]
//          --slice=1  repo skeleton & docs
//          --slice=2  slice 1 + profiles, contracts, rules, router, playbooks
//          --slice=3  slice 2 + all atomic skills, telemetry, installer (default)
// Exit:    0 = every check group passed, 1 = at least one failed, 2 = bad invocation.
//
// This file also exports the strict YAML parser and the JSON Schema subset validator so
// that scripts/log-telemetry.mjs validates with the same implementation (see DEC-007).
// Importing it has no side effects; checks only run when it is executed directly.

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fs.realpathSync(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(path.dirname(SELF), '..');

// ---------------------------------------------------------------------------
// Canonical tables (SPEC.md §1, §2.1, §2.4, §3.2)
// ---------------------------------------------------------------------------

const SKILLS = {
  'rc-router': 'front_door',
  'rc-init': 'standalone_or_router',
  'rc-doctor': 'standalone_or_router',
  'rc-ground': 'router_dispatched',
  'rc-architect': 'router_dispatched',
  'rc-verify': 'router_dispatched',
  'rc-audit': 'router_dispatched',
  'rc-state': 'router_dispatched',
  'rc-review-map': 'router_dispatched',
  'rc-retro': 'standalone_or_router',
};
const SKILL_NAMES = Object.keys(SKILLS);

// domain -> playbook name -> canonical default tier
const PLAYBOOKS = {
  engineering: {
    'feature-build': 2,
    'bug-root-cause': 2,
    'vibe-iterate': 1,
    'security-critical': 3,
    'refactor-pinned': 2,
    'ship-and-babysit': 2,
    'garden-maintenance': 2,
  },
  study: { 'topic-deep-dive': 2, 'recall-and-drill': 1, 'socratic-session': 1 },
  research: { 'viability-spike': 2, 'research-report': 2 },
};
const DOMAINS = Object.keys(PLAYBOOKS);
const PROFILE_NAMES = DOMAINS.map((d) => `rcstack-${d}`);
const PLAYBOOK_BASE = 'skills/rc-router/playbooks';

const CONTRACT_FILES = [
  'contracts/research-brief.md',
  'contracts/spec.md',
  'contracts/work-receipt.md',
  'contracts/audit-findings.md',
  'contracts/review-map.md',
  'contracts/telemetry-event.schema.json',
];

// Field names every Markdown contract template must carry (SPEC.md §4.1–§4.3).
const CONTRACT_TERMS = {
  'contracts/research-brief.md': [
    'Goal', 'Grounded Facts', 'Open Questions', 'Constraints', 'Recommended Approach',
  ],
  'contracts/spec.md': [
    'Problem Statement', 'Non-Goals', 'Data Shapes & Interfaces', 'Module Boundaries',
    'Failure Modes', 'Acceptance Criteria', 'Verification Plan',
  ],
  'contracts/work-receipt.md': [
    'task_id', 'role', 'model_used', 'risk_tier', 'branch', 'commit_or_diff_scope',
    'Summary of Changes', 'Verification Evidence', 'Assumptions & Trade-offs',
    'Known Risks / Follow-ups',
  ],
  'contracts/audit-findings.md': [
    'builder_model', 'reviewer_model', 'diff_scope', 'fresh_context: true', 'Blocker', 'Major',
    'Nit', 'file:line', 'impact', 'concrete_fix', 'APPROVE', 'CHANGES_REQUESTED',
  ],
  'contracts/review-map.md': [
    'Executive Delta', 'Risk-Ranked Reading Order', 'File / Area', 'Risk', 'Why It Matters',
    'Focus Question for Human', 'Assumptions Requiring Approval', 'Cross-Model Audit Ledger',
    'Verification Matrix', 'Command', 'Result', 'Scope', 'Telemetry Confirmation',
  ],
};

const RULE_FILES = DOMAINS.map((d) => `rules/${d}.md`);

// Keys of `roles` in every profile; `independent_reviewer` is resolved via review_matrix.
const ROLE_KEYS = [
  'systems_research', 'architect_blueprint', 'primary_builder', 'security_builder',
  'vibe_executor', 'deep_grounding', 'quick_lookup',
];
const REVIEWER_ROLE = 'independent_reviewer';
// Roles whose models produce reviewable work and therefore need a review_matrix entry.
const BUILDER_ROLES = [
  'primary_builder', 'security_builder', 'vibe_executor', 'systems_research', 'architect_blueprint',
];
const NON_PROFILE_ROLES = ['router', 'local_deterministic'];
const TIER_KEYS = ['0', '1', '2', '3'];
const TIER_FLAGS = [
  'require_spec', 'require_verify', 'require_cross_model_audit', 'require_review_map',
  'log_telemetry',
];
// Files of this repo that AGENTS.md must list under "## Tier 3 Paths" (SPEC.md §3.2). Every path
// in that section, these included, must also be a tier3_path_patterns entry of the engineering profile.
const SELF_PROTECTED_PATHS = ['adapters/install.sh', 'scripts/verify.mjs', 'profiles/schema.json'];

const SKILL_FRONTMATTER_KEYS = [
  'name', 'description', 'version', 'entry_mode', 'role', 'invokes_contracts',
];
const SKILL_HEADINGS = [
  'Single Job', 'When to Use', 'Do NOT Use When', 'Procedure', 'Definition of Done',
];
const PLAYBOOK_FRONTMATTER_KEYS = [
  'name', 'profile', 'entry_mode', 'default_tier', 'required_skills', 'required_roles', 'contracts',
];
const PLAYBOOK_HEADINGS = [
  'Router-Only Invocation Boundary', 'Do NOT Use When', 'Workflow Phases',
  'Exit Gate & Definition of Done',
];

const ROUTER_DISPATCHED_BOUNDARY =
  'Do NOT self-trigger this skill autonomously as part of a multi-step workflow outside ' +
  '`rc-router` (`/rcstack`). Run directly only when explicitly invoked by the user or ' +
  'dispatched by `rc-router`.';
const ROUTER_ONLY_BOUNDARY =
  '**ROUTER-ONLY:** This playbook MUST ONLY be invoked by `rc-router` (`/rcstack`) after ' +
  'profile selection, risk-tier classification, and model resolution. Never execute this ' +
  'playbook standalone or bypass `rc-router`.';
const ROUTING_PLAN_LINES = [
  'Profile: <profile> | Tier: T<0-3> | Playbook: <domain>/<playbook>',
  'Route: <role -> model chain> | Reviewer: <model> (builder: <model>)',
  'Exit Gate: <required verification & review map artifacts>',
];

// Concrete model names may live only in profiles/*.yaml and README.md (SPEC.md §1). These
// patterns are deliberately family-wide so renamed or re-versioned models are caught too.
// They run over whole files (flag "g"), and the separator may span a wrapped line or a
// blockquote marker, so a name split across two Markdown lines is still caught.
const WRAP = '[\\s_>-]';
const MODEL_NAME_PATTERNS = [
  ['GPT model', new RegExp(`\\bgpt${WRAP}*\\d`, 'gi')],
  ['Claude model', new RegExp(`\\bclaude${WRAP}+(?:opus|fable|sonnet|haiku|mythos)\\b`, 'gi')],
  // Tier words are ordinary English, so a wrapped match must not be a list marker ("3. ").
  ['Claude model tier', /\b(?:opus|sonnet|fable|haiku|mythos)[ \t_-]*(?:\d|\n[ \t>]*\d+(?!\d*[.)][ \t]))/gi],
  ['Gemini model', new RegExp(`\\bgemini${WRAP}*(?:\\d|notebook|neon|hydrogen|pro\\b|flash|ultra)`, 'gi')],
  ['Grok model', /\bgrok\b/gi],
];
// Everything scanned for model names. README.md, SPEC.md, profiles/ and scripts/ are exempt.
const MODEL_FREE_PATHS = ['skills', 'rules', 'contracts', 'adapters', 'AGENTS.md', 'docs/decisions.md'];
// Everything this validator reads must be a real file or directory, never a symbolic link.
const SYMLINK_FREE_PATHS = [
  'skills', 'profiles', 'contracts', 'rules', 'scripts', 'adapters', 'docs', 'AGENTS.md', 'README.md',
];

// ---------------------------------------------------------------------------
// Strict YAML subset parser (SPEC.md §3.1)
// ---------------------------------------------------------------------------
// Accepts: 2-space indentation, mappings, nested mappings, block sequences ("- item" or
// "- key: value"), "#" comments, true/false, canonical integers, plain and double-quoted
// strings. Rejects everything else — tabs, anchors, aliases, tags, block scalars, flow
// collections, single quotes, nulls and any plain scalar another YAML parser could read as
// something other than a string — so an accepted document has exactly one interpretation.

export class YamlError extends Error {}

// Control, space-like, zero-width and bidi characters. JavaScript would treat several of them
// as whitespace (and so as indentation) where a YAML parser would not.
const FORBIDDEN_YAML_CHARS =
  /[\u0000-\u0008\u000B-\u001F\u007F-\u00A0\u1680\u2000-\u200F\u2028-\u202F\u205F-\u206F\u3000\uFEFF]/;

const PLAIN_KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const AMBIGUOUS_PLAIN = [
  [/^(?:~|null|Null|NULL)$/, 'a null'],
  [/^(?:true|false|True|TRUE|False|FALSE|y|Y|yes|Yes|YES|n|N|no|No|NO|on|On|ON|off|Off|OFF)$/, 'a boolean'],
  [/^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?$/, 'a number'],
  [/^[-+]?\.(?:inf|Inf|INF)$|^\.(?:nan|NaN|NAN)$/, 'a special float'],
  [/^[-+]?0[xob][0-9A-Fa-f_]+$/, 'a non-decimal number'],
  [/^[-+]?[0-9][0-9_,]*$/, 'a number'],
  [/^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+(?:\.[0-9_]*)?$/, 'a sexagesimal number'],
  [/^[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}(?:[Tt ].*)?$/, 'a timestamp'],
];
const INDICATOR_MESSAGES = {
  '&': 'anchors are not allowed',
  '*': 'aliases are not allowed (double-quote values that start with "*")',
  '!': 'tags are not allowed',
  '|': 'block scalars are not allowed',
  '>': 'block scalars are not allowed',
  '[': 'flow sequences are not allowed (use a block sequence)',
  ']': 'flow sequences are not allowed (use a block sequence)',
  '{': 'flow mappings are not allowed (use a block mapping)',
  '}': 'flow mappings are not allowed (use a block mapping)',
  "'": 'single-quoted strings are not allowed (use double quotes)',
  '"': 'unexpected double quote',
  '@': 'reserved indicator "@" (double-quote the value)',
  '`': 'reserved indicator "`" (double-quote the value)',
  '%': 'directives are not allowed',
  ',': 'unexpected "," (double-quote the value)',
  '?': 'complex keys are not allowed',
  ':': 'unexpected ":" (double-quote the value)',
};

export function parseStrictYaml(text, label = 'yaml', lineOffset = 0) {
  const fail = (no, msg) => {
    throw new YamlError(`${label}:${no + lineOffset}: ${msg}`);
  };
  if (text.charCodeAt(0) === 0xfeff) fail(1, 'byte-order mark is not allowed');

  const lines = [];
  text.split('\n').forEach((raw, i) => {
    const no = i + 1;
    if (raw.includes('\t')) fail(no, 'tab character is not allowed (indent with 2 spaces)');
    if (raw.includes('\r')) fail(no, 'carriage return is not allowed (use LF line endings)');
    const odd = FORBIDDEN_YAML_CHARS.exec(raw);
    if (odd) {
      const code = odd[0].charCodeAt(0).toString(16).toUpperCase().padStart(4, '0');
      fail(no, `character U+${code} is not allowed (ASCII space is the only whitespace; escape others in a double-quoted string)`);
    }
    const body = raw.replace(/ +$/, '');
    const content = body.replace(/^ +/, '');
    if (content === '' || content[0] === '#') return;
    if (/^(?:---|\.\.\.)(?:\s|$)/.test(body)) fail(no, 'document markers are not allowed');
    const indent = body.length - content.length;
    if (indent % 2 !== 0) fail(no, `indentation of ${indent} spaces is not a multiple of 2`);
    lines.push({ no, indent, text: content });
  });
  if (lines.length === 0) fail(1, 'document is empty');

  const readDoubleQuoted = (s, no) => {
    // s[0] is the opening quote; returns the decoded value and the index after the close.
    let out = '';
    for (let i = 1; i < s.length; i++) {
      const ch = s[i];
      if (ch === '"') return { value: out, end: i + 1 };
      if (ch !== '\\') {
        out += ch;
        continue;
      }
      const esc = s[++i];
      if (esc === 'n') out += '\n';
      else if (esc === 't') out += '\t';
      else if (esc === 'r') out += '\r';
      else if (esc === '"' || esc === '\\' || esc === '/') out += esc;
      else if (esc === 'u' && /^[0-9A-Fa-f]{4}$/.test(s.slice(i + 1, i + 5))) {
        out += String.fromCharCode(parseInt(s.slice(i + 1, i + 5), 16));
        i += 4;
      } else fail(no, `unsupported escape sequence "\\${esc ?? ''}"`);
    }
    return fail(no, 'unterminated double-quoted string');
  };

  const ambiguity = (plain) => {
    const hit = AMBIGUOUS_PLAIN.find(([re]) => re.test(plain));
    return hit ? hit[1] : null;
  };

  const typePlain = (plain, no) => {
    if (Object.hasOwn(INDICATOR_MESSAGES, plain[0])) fail(no, INDICATOR_MESSAGES[plain[0]]);
    if (plain === '-' || plain.startsWith('- ')) fail(no, 'nested sequences are not allowed');
    if (/:\s/.test(plain) || plain.endsWith(':')) {
      fail(no, 'plain scalar contains ": " (double-quote the value)');
    }
    if (plain === 'true') return true;
    if (plain === 'false') return false;
    if (/^-?(?:0|[1-9][0-9]*)$/.test(plain)) {
      const n = Number(plain);
      if (!Number.isSafeInteger(n) || Object.is(n, -0)) fail(no, `integer "${plain}" is out of range`);
      return n;
    }
    const kind = ambiguity(plain);
    if (kind) fail(no, `plain scalar "${plain}" could be read as ${kind} (double-quote it)`);
    return plain;
  };

  const EMPTY = Symbol('empty');
  const parseValue = (rest, no) => {
    // `rest` is the text after "key:" or "- " and may hold a trailing comment.
    const s = rest.trim();
    if (s === '' || s[0] === '#') return EMPTY;
    if (s[0] === '"') {
      const { value, end } = readDoubleQuoted(s, no);
      const tail = s.slice(end);
      if (tail.trim() !== '' && !/^\s+#/.test(tail)) {
        fail(no, 'unexpected characters after closing double quote');
      }
      return value;
    }
    const cut = s.search(/\s#/);
    return typePlain((cut === -1 ? s : s.slice(0, cut)).trim(), no);
  };

  const parseKey = (text2, no) => {
    // Returns { key, rest } for "key: value", "key:" or the quoted-key equivalents.
    let key;
    let after;
    if (text2[0] === '"') {
      const { value, end } = readDoubleQuoted(text2, no);
      key = value;
      after = text2.slice(end);
    } else {
      const colon = text2.search(/:(?:\s|$)/);
      if (colon === -1) fail(no, 'expected "key: value"');
      key = text2.slice(0, colon);
      after = text2.slice(colon);
      if (!PLAIN_KEY.test(key)) {
        fail(no, `key "${key}" must be a plain identifier or a double-quoted string`);
      }
      const kind = ambiguity(key);
      if (kind) fail(no, `key "${key}" could be read as ${kind} (double-quote it)`);
    }
    if (after[0] !== ':' || (after.length > 1 && after[1] !== ' ')) {
      fail(no, 'expected ": " after the key');
    }
    if (key === '__proto__') fail(no, 'key "__proto__" is not allowed');
    return { key, rest: after.slice(1) };
  };

  const isSeqLine = (t) => t === '-' || t.startsWith('- ');
  const isMapEntry = (t, no) => {
    if (t[0] === '"') return t.slice(readDoubleQuoted(t, no).end).startsWith(':');
    return /^[^\s:#"']+:(?:\s|$)/.test(t);
  };

  let pos = 0;
  const peekIndent = () => (pos < lines.length ? lines[pos].indent : -1);

  const parseEntryValue = (rest, indent, no) => {
    const v = parseValue(rest, no);
    if (v !== EMPTY) {
      if (peekIndent() > indent) fail(lines[pos].no, 'unexpected indentation after a scalar value');
      return v;
    }
    if (peekIndent() <= indent) fail(no, 'key has no value (empty and null values are not allowed)');
    if (peekIndent() !== indent + 2) {
      fail(lines[pos].no, `nested block must be indented by exactly 2 spaces (expected ${indent + 2})`);
    }
    return parseBlock(indent + 2);
  };

  const parseMapping = (indent, into) => {
    while (peekIndent() === indent) {
      const line = lines[pos];
      if (isSeqLine(line.text)) fail(line.no, 'sequence item found where a mapping key was expected');
      const { key, rest } = parseKey(line.text, line.no);
      if (Object.hasOwn(into, key)) fail(line.no, `duplicate key "${key}"`);
      pos++;
      into[key] = parseEntryValue(rest, indent, line.no);
    }
    if (peekIndent() > indent) fail(lines[pos].no, 'unexpected indentation');
    return into;
  };

  const parseSequence = (indent) => {
    const items = [];
    while (peekIndent() === indent && isSeqLine(lines[pos].text)) {
      const line = lines[pos];
      if (!/^- \S/.test(line.text)) fail(line.no, 'sequence item must be "- " followed by a value');
      const content = line.text.slice(2);
      if (isSeqLine(content)) fail(line.no, 'nested sequences are not allowed');
      pos++;
      if (isMapEntry(content, line.no)) {
        const { key, rest } = parseKey(content, line.no);
        const item = {};
        item[key] = parseEntryValue(rest, indent + 2, line.no);
        items.push(parseMapping(indent + 2, item));
      } else {
        const v = parseValue(content, line.no);
        if (v === EMPTY) fail(line.no, 'sequence item has no value');
        if (peekIndent() > indent) fail(lines[pos].no, 'unexpected indentation after a sequence item');
        items.push(v);
      }
    }
    if (peekIndent() === indent) fail(lines[pos].no, 'mapping key found where a sequence item was expected');
    if (peekIndent() > indent) fail(lines[pos].no, 'unexpected indentation');
    return items;
  };

  function parseBlock(indent) {
    return isSeqLine(lines[pos].text) ? parseSequence(indent) : parseMapping(indent, {});
  }

  if (lines[0].indent !== 0) fail(lines[0].no, 'top-level content must not be indented');
  const doc = parseBlock(0);
  if (pos < lines.length) fail(lines[pos].no, 'unexpected content (check indentation)');
  if (Array.isArray(doc)) fail(lines[0].no, 'top level must be a mapping');
  return doc;
}

// ---------------------------------------------------------------------------
// JSON Schema (Draft 2020-12) subset validator
// ---------------------------------------------------------------------------
// lintSchema() fails on any keyword outside the supported subset, so a schema can never
// carry a constraint that validateSchema() would silently skip.

export const JSON_SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema';
const JSON_TYPES = ['null', 'boolean', 'integer', 'number', 'string', 'array', 'object'];
const ANNOTATION_KEYWORDS = new Set(['$schema', '$id', '$comment', 'title', 'description', 'examples']);
const SUBSCHEMA_KEYWORDS = new Set(['additionalProperties', 'propertyNames', 'items', 'not', 'if', 'then', 'else']);
const SUBSCHEMA_LIST_KEYWORDS = new Set(['allOf', 'anyOf', 'oneOf']);
const COUNT_KEYWORDS = new Set(['minLength', 'maxLength', 'minItems', 'maxItems', 'minProperties']);
const SUPPORTED_KEYWORDS = new Set([
  '$ref', '$defs', 'type', 'const', 'enum', 'required', 'properties', 'uniqueItems', 'pattern',
  'minimum', 'maximum',
  ...SUBSCHEMA_KEYWORDS, ...SUBSCHEMA_LIST_KEYWORDS, ...COUNT_KEYWORDS,
]);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function jsonType(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

export function deepEqual(a, b) {
  if (a === b) return true;
  if (jsonType(a) !== jsonType(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  if (isObject(a)) {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
  }
  return false;
}

function resolveRef(root, ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return undefined;
  let node = root;
  for (const raw of ref.slice(2).split('/')) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (node === null || typeof node !== 'object' || !Object.hasOwn(node, key)) return undefined;
    node = node[key];
  }
  return isObject(node) || typeof node === 'boolean' ? node : undefined;
}

export function lintSchema(root) {
  const errors = [];
  const nodes = [];
  const walk = (node, ptr) => {
    if (typeof node === 'boolean') return;
    if (!isObject(node)) {
      errors.push(`#${ptr}: schema must be an object or a boolean`);
      return;
    }
    nodes.push(node);
    for (const [key, val] of Object.entries(node)) {
      const here = `${ptr}/${key}`;
      if (ANNOTATION_KEYWORDS.has(key)) continue;
      if (!SUPPORTED_KEYWORDS.has(key)) {
        errors.push(`#${here}: unsupported keyword "${key}" (not enforced by the zero-dep validator)`);
      } else if (key === '$ref') {
        if (resolveRef(root, val) === undefined) errors.push(`#${here}: unresolvable $ref ${JSON.stringify(val)}`);
      } else if (key === '$defs' || key === 'properties') {
        if (!isObject(val)) errors.push(`#${here}: must be an object`);
        else for (const [k, sub] of Object.entries(val)) walk(sub, `${here}/${k}`);
      } else if (SUBSCHEMA_KEYWORDS.has(key)) {
        walk(val, here);
      } else if (SUBSCHEMA_LIST_KEYWORDS.has(key)) {
        if (!Array.isArray(val) || val.length === 0) errors.push(`#${here}: must be a non-empty array`);
        else val.forEach((sub, i) => walk(sub, `${here}/${i}`));
      } else if (key === 'type') {
        const types = Array.isArray(val) ? val : [val];
        if (types.length === 0 || types.some((t) => !JSON_TYPES.includes(t))) errors.push(`#${here}: invalid type`);
      } else if (key === 'enum') {
        if (!Array.isArray(val) || val.length === 0) errors.push(`#${here}: must be a non-empty array`);
      } else if (key === 'required') {
        if (!Array.isArray(val) || val.some((k) => typeof k !== 'string') || new Set(val).size !== val.length) {
          errors.push(`#${here}: must be an array of unique strings`);
        }
      } else if (key === 'pattern') {
        if (typeof val !== 'string') errors.push(`#${here}: must be a string`);
        else {
          try {
            new RegExp(val, 'u');
          } catch {
            errors.push(`#${here}: invalid regular expression`);
          }
        }
      } else if (COUNT_KEYWORDS.has(key)) {
        if (!Number.isInteger(val) || val < 0) errors.push(`#${here}: must be a non-negative integer`);
      } else if (key === 'minimum' || key === 'maximum') {
        if (typeof val !== 'number' || !Number.isFinite(val)) errors.push(`#${here}: must be a finite number`);
      } else if (key === 'uniqueItems') {
        if (typeof val !== 'boolean') errors.push(`#${here}: must be a boolean`);
      }
    }
  };
  walk(root, '');

  // A cycle made only of in-place applicators ($ref, allOf, if, ...) never descends into the
  // instance, so validating against it would recurse forever.
  const state = new Map();
  const visit = (node, trail) => {
    if (!isObject(node) || state.get(node) === 'done') return;
    if (state.get(node) === 'active') {
      errors.push(`#: cyclic schema reference that never consumes the instance (${trail.join(' -> ')})`);
      return;
    }
    state.set(node, 'active');
    const next = [];
    const target = Object.hasOwn(node, '$ref') ? resolveRef(root, node.$ref) : undefined;
    if (target !== undefined) next.push([target, `$ref ${node.$ref}`]);
    for (const key of SUBSCHEMA_LIST_KEYWORDS) {
      if (Array.isArray(node[key])) node[key].forEach((sub, i) => next.push([sub, `${key}/${i}`]));
    }
    for (const key of ['not', 'if', 'then', 'else']) if (Object.hasOwn(node, key)) next.push([node[key], key]);
    for (const [child, label] of next) visit(child, [...trail, label]);
    state.set(node, 'done');
  };
  for (const node of nodes) visit(node, []);
  return errors;
}

export function validateSchema(root, data) {
  const at = (ptr) => ptr || '(root)';
  const inProgress = new Map(); // schema object -> instance pointers currently being checked
  const check = (schema, value, ptr, out) => {
    if (schema === true) return;
    if (schema === false) {
      out.push(`${at(ptr)}: not allowed`);
      return;
    }
    // Defence in depth behind lintSchema: never re-enter the same schema at the same instance.
    const pointers = inProgress.get(schema) ?? new Set();
    if (pointers.has(ptr)) {
      out.push(`${at(ptr)}: cyclic schema reference`);
      return;
    }
    inProgress.set(schema, pointers.add(ptr));
    try {
      checkKeywords(schema, value, ptr, out);
    } finally {
      pointers.delete(ptr);
    }
  };
  const checkKeywords = (schema, value, ptr, out) => {
    if (Object.hasOwn(schema, '$ref')) {
      const target = resolveRef(root, schema.$ref);
      if (target === undefined) out.push(`${at(ptr)}: unresolvable $ref ${JSON.stringify(schema.$ref)}`);
      else check(target, value, ptr, out);
    }
    if (Object.hasOwn(schema, 'type')) {
      const types = Array.isArray(schema.type) ? schema.type : [schema.type];
      const actual = jsonType(value);
      if (!types.some((t) => t === actual || (t === 'number' && actual === 'integer'))) {
        out.push(`${at(ptr)}: expected ${types.join(' or ')}, got ${actual}`);
      }
    }
    if (Object.hasOwn(schema, 'const') && !deepEqual(schema.const, value)) {
      out.push(`${at(ptr)}: must equal ${JSON.stringify(schema.const)}`);
    }
    if (Object.hasOwn(schema, 'enum') && !schema.enum.some((e) => deepEqual(e, value))) {
      out.push(`${at(ptr)}: must be one of ${JSON.stringify(schema.enum)}`);
    }
    if (typeof value === 'string') {
      const length = [...value].length;
      if (Object.hasOwn(schema, 'minLength') && length < schema.minLength) {
        out.push(`${at(ptr)}: must be at least ${schema.minLength} character(s) long`);
      }
      if (Object.hasOwn(schema, 'maxLength') && length > schema.maxLength) {
        out.push(`${at(ptr)}: must be at most ${schema.maxLength} character(s) long`);
      }
      if (Object.hasOwn(schema, 'pattern') && !new RegExp(schema.pattern, 'u').test(value)) {
        out.push(`${at(ptr)}: must match pattern ${schema.pattern}`);
      }
    }
    if (typeof value === 'number') {
      if (Object.hasOwn(schema, 'minimum') && value < schema.minimum) out.push(`${at(ptr)}: must be >= ${schema.minimum}`);
      if (Object.hasOwn(schema, 'maximum') && value > schema.maximum) out.push(`${at(ptr)}: must be <= ${schema.maximum}`);
    }
    if (Array.isArray(value)) {
      if (Object.hasOwn(schema, 'minItems') && value.length < schema.minItems) {
        out.push(`${at(ptr)}: must have at least ${schema.minItems} item(s)`);
      }
      if (Object.hasOwn(schema, 'maxItems') && value.length > schema.maxItems) {
        out.push(`${at(ptr)}: must have at most ${schema.maxItems} item(s)`);
      }
      if (schema.uniqueItems === true && value.some((x, i) => value.slice(0, i).some((y) => deepEqual(x, y)))) {
        out.push(`${at(ptr)}: items must be unique`);
      }
      if (Object.hasOwn(schema, 'items')) value.forEach((item, i) => check(schema.items, item, `${ptr}/${i}`, out));
    }
    if (isObject(value)) {
      const keys = Object.keys(value);
      for (const key of schema.required ?? []) {
        if (!Object.hasOwn(value, key)) out.push(`${at(ptr)}: missing required property "${key}"`);
      }
      if (Object.hasOwn(schema, 'minProperties') && keys.length < schema.minProperties) {
        out.push(`${at(ptr)}: must have at least ${schema.minProperties} propert(ies)`);
      }
      const props = schema.properties ?? {};
      for (const key of keys) {
        if (Object.hasOwn(schema, 'propertyNames')) check(schema.propertyNames, key, `${ptr}/${key} (property name)`, out);
        if (Object.hasOwn(props, key)) check(props[key], value[key], `${ptr}/${key}`, out);
        else if (schema.additionalProperties === false) out.push(`${at(ptr)}: unexpected property "${key}"`);
        else if (Object.hasOwn(schema, 'additionalProperties')) check(schema.additionalProperties, value[key], `${ptr}/${key}`, out);
      }
    }
    const passes = (sub) => {
      const scratch = [];
      check(sub, value, ptr, scratch);
      return scratch.length === 0;
    };
    for (const sub of schema.allOf ?? []) check(sub, value, ptr, out);
    if (Object.hasOwn(schema, 'anyOf') && !schema.anyOf.some(passes)) out.push(`${at(ptr)}: must match at least one "anyOf" branch`);
    if (Object.hasOwn(schema, 'oneOf')) {
      const hits = schema.oneOf.filter(passes).length;
      if (hits !== 1) out.push(`${at(ptr)}: must match exactly one "oneOf" branch (matched ${hits})`);
    }
    if (Object.hasOwn(schema, 'not') && passes(schema.not)) out.push(`${at(ptr)}: must not match the "not" schema`);
    if (Object.hasOwn(schema, 'if')) {
      const branch = passes(schema.if) ? schema.then : schema.else;
      if (branch !== undefined) check(branch, value, ptr, out);
    }
  };
  const errors = [];
  check(root, data, '', errors);
  return errors;
}

// ---------------------------------------------------------------------------
// Filesystem and Markdown helpers
// ---------------------------------------------------------------------------

const abs = (p) => path.join(REPO_ROOT, p);
const isFile = (p) => fs.statSync(abs(p), { throwIfNoEntry: false })?.isFile() ?? false;
const isDir = (p) => fs.statSync(abs(p), { throwIfNoEntry: false })?.isDirectory() ?? false;
const read = (p) => fs.readFileSync(abs(p), 'utf8');
const listDir = (p) => fs.readdirSync(abs(p), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
const normalizeSpace = (s) => s.replace(/\s+/g, ' ').trim();
const normalizeModel = (s) => normalizeSpace(s).toLowerCase();
const sameSet = (a, b) => a.length === b.length && new Set(a).size === a.length && a.every((x) => b.includes(x));
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function walkFiles(relPath) {
  // All files under relPath (or relPath itself), repo-relative, in sorted order.
  if (isFile(relPath)) return [relPath];
  if (!isDir(relPath)) return [];
  const out = [];
  for (const ent of listDir(relPath)) {
    if (ent.name === '.git' || ent.name === 'node_modules') continue;
    const child = `${relPath}/${ent.name}`;
    if (ent.isDirectory()) out.push(...walkFiles(child));
    else if (ent.isFile()) out.push(child);
  }
  return out;
}

function markFences(text) {
  // One record per line, flagged when the line belongs to a fenced code block.
  let fence = null;
  return text.split('\n').map((line, i) => {
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    let fenced = fence !== null;
    if (m && fence === null) {
      fence = { ch: m[1][0], len: m[1].length };
      fenced = true;
    } else if (m && m[1][0] === fence.ch && m[1].length >= fence.len && m[2].trim() === '') {
      fence = null;
    }
    return { text: line, no: i + 1, fenced };
  });
}

function splitSections(markdown) {
  // H2 sections outside code fences: [{ title, text }].
  const sections = [];
  for (const line of markFences(markdown)) {
    const h = line.fenced ? null : /^## +(.+?)\s*$/.exec(line.text);
    if (h) sections.push({ title: h[1], lines: [] });
    else if (sections.length > 0) sections.at(-1).lines.push(line.text);
  }
  return sections.map((s) => ({ title: s.title, text: s.lines.join('\n') }));
}

function readFrontmatterDoc(file, err) {
  if (!isFile(file)) {
    err(`${file}: missing`);
    return null;
  }
  const text = read(file);
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) {
    err(`${file}: must begin with YAML frontmatter fenced by "---" lines`);
    return null;
  }
  try {
    const frontmatter = parseStrictYaml(m[1], file, 1);
    const body = text.slice(m[0].length);
    return { frontmatter, body, sections: splitSections(body) };
  } catch (e) {
    if (!(e instanceof YamlError)) throw e;
    err(`${e.message} (frontmatter)`);
    return null;
  }
}

function checkKeys(file, frontmatter, expected, err) {
  for (const key of expected) if (!Object.hasOwn(frontmatter, key)) err(`${file}: frontmatter is missing "${key}"`);
  for (const key of Object.keys(frontmatter)) if (!expected.includes(key)) err(`${file}: unexpected frontmatter key "${key}"`);
}

function checkStringList(file, key, value, err) {
  const ok = Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'string' && v !== '');
  if (!ok) err(`${file}: "${key}" must be a non-empty list of strings`);
  else if (new Set(value).size !== value.length) err(`${file}: "${key}" contains duplicates`);
  return ok ? value : [];
}

function requireSections(file, sections, headings, err) {
  // Mandatory headings: each exactly once, in order, with content. Returns title -> text.
  const found = {};
  let last = -1;
  for (const title of headings) {
    const hits = sections.map((s, i) => (s.title === title ? i : -1)).filter((i) => i !== -1);
    if (hits.length !== 1) {
      err(`${file}: expected exactly one "## ${title}" heading, found ${hits.length}`);
      continue;
    }
    if (hits[0] < last) err(`${file}: "## ${title}" is out of order (required order: ${headings.join(' > ')})`);
    last = Math.max(last, hits[0]);
    const text = sections[hits[0]].text;
    if (text.trim() === '') err(`${file}: "## ${title}" is empty`);
    found[title] = text;
  }
  return found;
}

const hasBullet = (text) => /^\s*[-*] +\S/m.test(text);
const hasNumberedItem = (text) => /^\s*\d+\. +\S/m.test(text);
const unquote = (text) => text.split('\n').map((l) => l.replace(/^\s*>\s?/, '')).join('\n');

// ---------------------------------------------------------------------------
// Skill and playbook contracts (SPEC.md §2)
// ---------------------------------------------------------------------------

function checkSkill(name, ctx, err) {
  const file = `skills/${name}/SKILL.md`;
  const doc = readFrontmatterDoc(file, err);
  if (!doc) return;
  const fm = doc.frontmatter;
  checkKeys(file, fm, SKILL_FRONTMATTER_KEYS, err);

  if (fm.name !== name) err(`${file}: frontmatter name "${fm.name}" must match the folder name "${name}"`);
  if (typeof fm.description !== 'string' || fm.description.trim() === '') err(`${file}: "description" must be a non-empty string`);
  else if (fm.description.length > 1024) err(`${file}: "description" exceeds 1024 characters`);
  if (typeof fm.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(fm.version)) err(`${file}: "version" must be a semver string such as 0.1.0`);
  if (fm.entry_mode !== SKILLS[name]) err(`${file}: entry_mode must be "${SKILLS[name]}", found "${fm.entry_mode}"`);

  if (!ctx.abstractRoles) err(`${file}: cannot validate "role" because profiles/schema.json did not load`);
  else if (![...ctx.abstractRoles, ...NON_PROFILE_ROLES].includes(fm.role)) {
    err(`${file}: role "${fm.role}" is not an abstract role from profiles/schema.json or one of ${NON_PROFILE_ROLES.join(', ')}`);
  }
  if (name === 'rc-router' && fm.role !== 'router') err(`${file}: rc-router must declare role "router"`);

  for (const ref of checkStringList(file, 'invokes_contracts', fm.invokes_contracts, err)) {
    if (!CONTRACT_FILES.includes(ref)) err(`${file}: invokes_contracts entry "${ref}" is not one of the 6 contract files`);
    else if (!isFile(ref)) err(`${file}: invokes_contracts entry "${ref}" does not exist`);
  }

  const sec = requireSections(file, doc.sections, SKILL_HEADINGS, err);

  if (sec['Single Job'] !== undefined) {
    const job = sec['Single Job'].trim();
    const flat = normalizeSpace(job);
    if (/\n\s*\n/.test(job) || /^[-*\d]/.test(flat)) err(`${file}: "## Single Job" must be one plain paragraph`);
    else if (!flat.endsWith('.') || /[.!?]["')\]]*\s+[A-Z`*]/.test(flat)) {
      err(`${file}: "## Single Job" must be exactly one sentence ending with a period`);
    }
  }
  if (sec['When to Use'] !== undefined && !hasBullet(sec['When to Use'])) err(`${file}: "## When to Use" needs bullet criteria`);
  if (sec['Procedure'] !== undefined && !hasNumberedItem(sec['Procedure'])) err(`${file}: "## Procedure" needs numbered steps`);
  if (sec['Definition of Done'] !== undefined && !hasBullet(sec['Definition of Done'])) {
    err(`${file}: "## Definition of Done" needs bullet exit criteria`);
  }

  const boundary = sec['Do NOT Use When'];
  if (boundary !== undefined) {
    const flat = normalizeSpace(unquote(boundary));
    if (!hasBullet(boundary)) err(`${file}: "## Do NOT Use When" needs bullet boundaries`);
    if (fm.entry_mode === 'router_dispatched' && !flat.includes(ROUTER_DISPATCHED_BOUNDARY)) {
      err(`${file}: "## Do NOT Use When" must contain the verbatim router-dispatched boundary sentence`);
    }
    if (fm.entry_mode === 'standalone_or_router') {
      for (const label of ['**Run directly:**', '**Defer to `rc-router`:**']) {
        if (!flat.includes(label)) err(`${file}: "## Do NOT Use When" must state "${label} ..." (standalone_or_router boundary)`);
      }
    }
    if (fm.entry_mode === 'front_door') {
      if (!/\bTier 0\b/.test(flat)) err(`${file}: "## Do NOT Use When" must exclude Tier 0 trivial work from routing ceremony`);
      if (!/standalone/i.test(flat)) err(`${file}: "## Do NOT Use When" must exclude direct user-invoked standalone checks`);
    }
  }
}

function checkRouterContent(err) {
  const file = 'skills/rc-router/SKILL.md';
  if (!isFile(file)) return;
  const text = read(file);
  const flat = normalizeSpace(text);
  const need = (needle, why) => {
    if (!flat.includes(needle)) err(`${file}: must reference ${why} (${needle})`);
  };
  for (const profile of PROFILE_NAMES) need(`profiles/${profile}.yaml`, 'every profile file');
  for (const rule of RULE_FILES) need(rule, 'every rules file');
  for (const [domain, books] of Object.entries(PLAYBOOKS)) {
    for (const book of Object.keys(books)) need(`${PLAYBOOK_BASE}/${domain}/${book}.md`, 'every playbook in its dispatch table');
  }
  need('AGENTS.md', 'the repo AGENTS.md');
  need('docs/decisions.md', 'the decisions log');
  need('.rcstack/state/', 'the branch state file');
  need('tier3_path_patterns', 'Tier 3 auto-escalation');
  need('review_matrix', 'reviewer resolution');
  need('reviewer != builder', 'the reviewer invariant');
  need('orchestrator_capabilities', 'orchestrated execution');
  need('delegate_task', 'orchestrated execution');
  need('degraded_single_harness', 'standalone degradation');
  for (const line of ROUTING_PLAN_LINES) need(line, 'the verbatim Routing Plan format');
}

function checkPlaybook(domain, name, ctx, err) {
  const file = `${PLAYBOOK_BASE}/${domain}/${name}.md`;
  const doc = readFrontmatterDoc(file, err);
  if (!doc) return;
  const fm = doc.frontmatter;
  const profileName = `rcstack-${domain}`;
  checkKeys(file, fm, PLAYBOOK_FRONTMATTER_KEYS, err);

  if (fm.name !== name) err(`${file}: frontmatter name "${fm.name}" must match the file name "${name}"`);
  if (fm.profile !== profileName) err(`${file}: profile must be "${profileName}" to match its directory`);
  if (fm.entry_mode !== 'router_only') err(`${file}: entry_mode must be "router_only"`);
  const tierOk = Number.isInteger(fm.default_tier) && fm.default_tier >= 0 && fm.default_tier <= 3;
  if (!tierOk) err(`${file}: default_tier must be an integer 0..3`);
  else if (fm.default_tier !== PLAYBOOKS[domain][name]) {
    err(`${file}: default_tier must be ${PLAYBOOKS[domain][name]} (SPEC.md §2.4), found ${fm.default_tier}`);
  }

  const skills = checkStringList(file, 'required_skills', fm.required_skills, err);
  for (const s of skills) {
    if (!SKILL_NAMES.includes(s)) err(`${file}: required_skills entry "${s}" is not an approved skill`);
    else if (s === 'rc-router') err(`${file}: required_skills must not list rc-router (a playbook never re-enters the router)`);
  }
  const roles = checkStringList(file, 'required_roles', fm.required_roles, err);
  if (!ctx.abstractRoles) err(`${file}: cannot validate required_roles because profiles/schema.json did not load`);
  else for (const r of roles) if (!ctx.abstractRoles.includes(r)) err(`${file}: required_roles entry "${r}" is not defined in profiles/schema.json`);
  const contracts = checkStringList(file, 'contracts', fm.contracts, err);
  for (const c of contracts) {
    if (!CONTRACT_FILES.includes(c)) err(`${file}: contracts entry "${c}" is not one of the 6 contract files`);
    else if (!isFile(c)) err(`${file}: contracts entry "${c}" does not exist`);
  }

  const sec = requireSections(file, doc.sections, PLAYBOOK_HEADINGS, err);

  const invocation = sec['Router-Only Invocation Boundary'];
  if (invocation !== undefined && !normalizeSpace(unquote(invocation)).includes(ROUTER_ONLY_BOUNDARY)) {
    err(`${file}: "## Router-Only Invocation Boundary" must contain the verbatim ROUTER-ONLY rule`);
  }

  const negatives = sec['Do NOT Use When'];
  if (negatives !== undefined) {
    if (!hasBullet(negatives)) err(`${file}: "## Do NOT Use When" needs bullet boundaries`);
    const others = [...SKILL_NAMES, ...DOMAINS.flatMap((d) => Object.keys(PLAYBOOKS[d]))].filter((n) => n !== name);
    if (!others.some((n) => negatives.includes(`\`${n}\``))) {
      err(`${file}: "## Do NOT Use When" must name the playbook or skill that handles adjacent tasks`);
    }
  }

  const phases = sec['Workflow Phases'];
  if (phases !== undefined) {
    if (!hasNumberedItem(phases)) err(`${file}: "## Workflow Phases" needs a numbered sequence`);
    for (const item of [...skills, ...roles, ...contracts]) {
      if (!phases.includes(`\`${item}\``)) err(`${file}: "## Workflow Phases" never uses \`${item}\` declared in frontmatter`);
    }
  }

  const gate = sec['Exit Gate & Definition of Done'];
  if (gate !== undefined && !hasBullet(gate)) err(`${file}: "## Exit Gate & Definition of Done" needs bullet gates`);

  // The profile's tier flags are binding on every playbook that defaults to that tier.
  const tier = ctx.profiles[profileName]?.risk_tiers?.[String(fm.default_tier)];
  if (!tierOk) return;
  if (!isObject(tier)) {
    err(`${file}: cannot check tier gates because profiles/${profileName}.yaml did not load`);
    return;
  }
  const demand = (flag, ok, what) => {
    if (tier[flag] === true && !ok) err(`${file}: Tier ${fm.default_tier} sets ${flag}, so the playbook must ${what}`);
  };
  const gateText = gate ?? '';
  demand('require_spec', contracts.includes('contracts/spec.md'), 'list contracts/spec.md');
  demand('require_verify', skills.includes('rc-verify'), 'require rc-verify');
  demand('require_verify', gateText.includes('`rc-verify`'), 'gate on `rc-verify` in its exit gate');
  demand('require_cross_model_audit', skills.includes('rc-audit'), 'require rc-audit');
  demand('require_cross_model_audit', roles.includes(REVIEWER_ROLE), `require the ${REVIEWER_ROLE} role`);
  demand('require_cross_model_audit', contracts.includes('contracts/audit-findings.md'), 'list contracts/audit-findings.md');
  demand('require_cross_model_audit', /`rc-audit`/.test(gateText) && /Blocker/.test(gateText), 'gate on zero open Blocker findings from `rc-audit`');
  demand('require_review_map', skills.includes('rc-review-map'), 'require rc-review-map');
  demand('require_review_map', contracts.includes('contracts/review-map.md'), 'list contracts/review-map.md');
  demand('require_review_map', /Review Map/.test(gateText), 'gate on an emitted Review Map');
  demand('log_telemetry', /telemetry/i.test(gateText), 'gate on an appended telemetry row');
}

// ---------------------------------------------------------------------------
// Probes: mutations of a valid document that a strict schema must reject
// ---------------------------------------------------------------------------

const clone = (v) => JSON.parse(JSON.stringify(v));

function runProbes(label, schema, base, probes, err) {
  const baseErrors = validateSchema(schema, base);
  if (baseErrors.length > 0) {
    err(`${label}: baseline document is rejected, cannot probe (${baseErrors[0]})`);
    return;
  }
  for (const [what, mutate] of probes) {
    const doc = clone(base);
    try {
      mutate(doc);
    } catch (e) {
      err(`${label}: probe "${what}" could not be applied (${e.message})`);
      continue;
    }
    if (validateSchema(schema, doc).length === 0) err(`${label}: schema is too permissive — it accepts ${what}`);
  }
}

function profileProbes() {
  const probes = [
    ['schema_version other than "1.0"', (d) => { d.schema_version = '2.0'; }],
    ['an unknown profile name', (d) => { d.profile = 'rcstack-other'; }],
    ['an unknown domain', (d) => { d.domain = 'operations'; }],
    ['an empty description', (d) => { d.description = ''; }],
    ['require_reviewer_not_equal_builder: false', (d) => { d.invariants.require_reviewer_not_equal_builder = false; }],
    ['require_fresh_context_audit: false', (d) => { d.invariants.require_fresh_context_audit = false; }],
    ['allow_self_review_on_fallback: true', (d) => { d.invariants.allow_self_review_on_fallback = true; }],
    ['a missing invariant', (d) => { delete d.invariants.require_fresh_context_audit; }],
    ['tier3_path_patterns that is not an array', (d) => { d.tier3_path_patterns = 'auth/**'; }],
    ['a non-string tier3 path pattern', (d) => { d.tier3_path_patterns = [7]; }],
    ['vibe_executor without secondary', (d) => { delete d.roles.vibe_executor.secondary; }],
    ['deep_grounding without paired_with', (d) => { delete d.roles.deep_grounding.paired_with; }],
    ['deep_grounding without companion_tools', (d) => { delete d.roles.deep_grounding.companion_tools; }],
    ['companion_tools that is not an array', (d) => { d.roles.deep_grounding.companion_tools = 'tool'; }],
    ['quick_lookup without exclusive', (d) => { delete d.roles.quick_lookup.exclusive; }],
    ['a non-boolean quick_lookup.exclusive', (d) => { d.roles.quick_lookup.exclusive = 'true'; }],
    ['a non-string model name', (d) => { d.roles.primary_builder.primary = 42; }],
    ['review_matrix without default_fallback', (d) => { delete d.review_matrix.default_fallback; }],
    ['a review_matrix entry that is not an object', (d) => { d.review_matrix[firstBuilder(d)] = 'reviewer'; }],
    ['a review_matrix entry without primary', (d) => { delete d.review_matrix[firstBuilder(d)].primary; }],
    ['a review_matrix entry without fallback', (d) => { delete d.review_matrix[firstBuilder(d)].fallback; }],
    ['a risk tier with an unknown default role', (d) => { d.risk_tiers['2'].default_roles = ['not_a_role']; }],
    ['a risk tier without a name', (d) => { delete d.risk_tiers['0'].name; }],
    ['a risk tier with a non-string name', (d) => { d.risk_tiers['0'].name = 7; }],
    ['a risk tier whose default_roles is not an array', (d) => { d.risk_tiers['1'].default_roles = 'vibe_executor'; }],
    ['an unknown top-level property', (d) => { d.extra = true; }],
    ['an unknown invariant', (d) => { d.invariants.extra = true; }],
    ['an unknown role', (d) => { d.roles.extra_role = { primary: 'model-x', fallback: 'model-y' }; }],
    ['an unknown property on a role', (d) => { d.roles.primary_builder.extra = 'model-x'; }],
    ['an unknown property on a review_matrix entry', (d) => { d.review_matrix[firstBuilder(d)].extra = 'model-x'; }],
    ['an unknown risk tier "4"', (d) => { d.risk_tiers['4'] = d.risk_tiers['3']; }],
    ['an unknown property on a risk tier', (d) => { d.risk_tiers['1'].extra = true; }],
    ['a domain that does not match the profile', (d) => { d.domain = d.domain === 'study' ? 'research' : 'study'; }],
    ['an empty tier3_path_patterns list', (d) => { d.tier3_path_patterns = []; }],
    ['an empty default_roles list', (d) => { d.risk_tiers['1'].default_roles = []; }],
    ['an empty model name', (d) => { d.roles.primary_builder.primary = ''; }],
    ['a model name padded with whitespace', (d) => { d.roles.primary_builder.primary = ' model-x '; }],
  ];
  for (const key of ['invariants', 'tier3_path_patterns', 'roles', 'review_matrix', 'risk_tiers', 'description']) {
    probes.push([`a profile without "${key}"`, (d) => { delete d[key]; }]);
  }
  for (const role of ROLE_KEYS) {
    probes.push([`roles without ${role}`, (d) => { delete d.roles[role]; }]);
    probes.push([`${role} without primary`, (d) => { delete d.roles[role].primary; }]);
    if (role !== 'quick_lookup') probes.push([`${role} without fallback`, (d) => { delete d.roles[role].fallback; }]);
  }
  for (const tier of TIER_KEYS) probes.push([`risk_tiers without tier "${tier}"`, (d) => { delete d.risk_tiers[tier]; }]);
  for (const flag of TIER_FLAGS) {
    probes.push([`a risk tier without ${flag}`, (d) => { delete d.risk_tiers['1'][flag]; }]);
    probes.push([`a non-boolean ${flag}`, (d) => { d.risk_tiers['1'][flag] = 'yes'; }]);
  }
  return probes;
}

function firstBuilder(profile) {
  const key = Object.keys(profile.review_matrix).find((k) => k !== 'default_fallback');
  if (key === undefined) throw new Error('review_matrix has no builder entries');
  return key;
}

// Neutral placeholder models: scripts must stay free of concrete model bindings.
const TELEMETRY_SAMPLE = Object.freeze({
  schema_version: '1.0',
  timestamp: '2026-01-15T09:30:00Z',
  repo: 'example-repo',
  branch: 'feature/example',
  profile: 'rcstack-engineering',
  playbook: 'engineering/feature-build',
  risk_tier: 2,
  builder_model: 'builder-model',
  reviewer_model: 'reviewer-model',
  degraded_single_harness: false,
  first_pass_verify_passed: true,
  audit_blockers: 0,
  audit_majors: 1,
  audit_nits: 2,
  human_override: false,
  notes: 'sample row used by scripts/verify.mjs',
});
const TELEMETRY_REQUIRED = Object.keys(TELEMETRY_SAMPLE).filter((k) => k !== 'notes');

function telemetryProbes() {
  const probes = TELEMETRY_REQUIRED.map((key) => [`an event without "${key}"`, (d) => { delete d[key]; }]);
  probes.push(
    ['schema_version other than "1.0"', (d) => { d.schema_version = '2.0'; }],
    ['a timestamp that is not ISO-8601', (d) => { d.timestamp = 'yesterday'; }],
    ['a timestamp with a non-UTC offset', (d) => { d.timestamp = '2026-01-15T09:30:00+01:00'; }],
    ['an empty repo', (d) => { d.repo = ''; }],
    ['an empty branch', (d) => { d.branch = ''; }],
    ['an unknown profile', (d) => { d.profile = 'rcstack-other'; }],
    ['a non-string playbook', (d) => { d.playbook = 3; }],
    ['risk_tier 4', (d) => { d.risk_tier = 4; }],
    ['risk_tier -1', (d) => { d.risk_tier = -1; }],
    ['a fractional risk_tier', (d) => { d.risk_tier = 1.5; }],
    ['an empty builder_model', (d) => { d.builder_model = ''; }],
    ['a null builder_model', (d) => { d.builder_model = null; }],
    ['a numeric reviewer_model', (d) => { d.reviewer_model = 5; }],
    ['a null reviewer_model on a non-degraded Tier 2 run', (d) => { d.reviewer_model = null; }],
    ['a non-boolean degraded_single_harness', (d) => { d.degraded_single_harness = 'no'; }],
    ['a non-boolean first_pass_verify_passed', (d) => { d.first_pass_verify_passed = 1; }],
    ['a negative audit_blockers', (d) => { d.audit_blockers = -1; }],
    ['a non-integer audit_majors', (d) => { d.audit_majors = '0'; }],
    ['a fractional audit_nits', (d) => { d.audit_nits = 0.5; }],
    ['a non-boolean human_override', (d) => { d.human_override = 0; }],
    ['non-string notes', (d) => { d.notes = 5; }],
    ['an unknown property', (d) => { d.extra = 1; }],
    ['a playbook from another profile domain', (d) => { d.playbook = 'study/topic-deep-dive'; }],
    ['a playbook without a domain prefix', (d) => { d.playbook = 'feature-build'; }],
    ['a repo given as a filesystem path', (d) => { d.repo = '/home/user/example-repo'; }],
  );
  return probes;
}

// Variants of the sample the telemetry schema must accept (SPEC.md §5.2).
const TELEMETRY_ACCEPTED = [
  ['the canonical sample', () => {}],
  ['an event without the optional notes', (d) => { delete d.notes; }],
  ['a null reviewer_model at Tier 1', (d) => { d.risk_tier = 1; d.reviewer_model = null; }],
  ['a null reviewer_model at Tier 0', (d) => { d.risk_tier = 0; d.reviewer_model = null; }],
  ['a null reviewer_model in a degraded single harness', (d) => { d.degraded_single_harness = true; d.reviewer_model = null; }],
  ['a Tier 3 event', (d) => { d.risk_tier = 3; }],
  ['a fractional-second UTC timestamp', (d) => { d.timestamp = '2026-01-15T09:30:00.123Z'; }],
];

// ---------------------------------------------------------------------------
// Sandbox helpers for behavioural checks (never touch the real $HOME)
// ---------------------------------------------------------------------------

function withSandboxHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rcstack-verify-'));
  try {
    return fn(home);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

function sandboxEnv(home) {
  const env = { ...process.env, HOME: home, GIT_CONFIG_NOSYSTEM: '1' };
  for (const key of ['XDG_CONFIG_HOME', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'GIT_DIR', 'GIT_WORK_TREE']) delete env[key];
  return env;
}

function run(cmd, args, options = {}) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', timeout: 60_000, ...options });
  return {
    status: res.error ? `spawn error: ${res.error.message}` : res.status,
    output: `${res.stdout ?? ''}${res.stderr ?? ''}`,
    stdout: res.stdout ?? '',
  };
}

function snapshot(root) {
  const out = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(dir, ent.name);
      const name = path.relative(root, full);
      if (ent.isSymbolicLink()) out.push(`link ${name} -> ${fs.readlinkSync(full)}`);
      else if (ent.isDirectory()) {
        out.push(`dir  ${name}`);
        walk(full);
      } else out.push(`file ${name} ${createHash('sha256').update(fs.readFileSync(full)).digest('hex')}`);
    }
  };
  walk(root);
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Check groups
// ---------------------------------------------------------------------------

const ctx = { schema: null, abstractRoles: null, profiles: {}, modelNames: new Set() };

function checkBaseFiles(err) {
  for (const file of ['README.md', 'AGENTS.md', 'docs/decisions.md', 'scripts/verify.mjs']) {
    if (!isFile(file)) err(`${file}: missing`);
    else if (read(file).trim() === '') err(`${file}: empty`);
  }
  if (isFile('AGENTS.md')) {
    const lineCount = read('AGENTS.md').replace(/\n$/, '').split('\n').length;
    if (lineCount >= 100) err(`AGENTS.md: must stay under 100 lines, found ${lineCount}`);
  }
}

function isRealDate(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

function checkDecisionsLog(err) {
  const file = 'docs/decisions.md';
  if (!isFile(file)) return err(`${file}: missing`);
  const FIELDS = ['Date', 'Status', 'Decision', 'Rejected Alternative', 'Guardrail'];
  const entries = [];
  let current = null;
  for (const line of markFences(read(file))) {
    if (line.fenced) {
      if (current) err(`${file}:${line.no}: code fences are not allowed inside ${current.id}`);
      continue;
    }
    if (/^#{1,3} /.test(line.text)) {
      current = null;
      if (!line.text.startsWith('### ')) continue;
      const m = /^### (DEC-\d{3}): (\S.*)$/.exec(line.text);
      if (!m) {
        err(`${file}:${line.no}: entry heading must be "### DEC-NNN: <Short Title>"`);
        continue;
      }
      current = { id: m[1], no: line.no, fields: [] };
      entries.push(current);
    } else if (current && line.text.trim() !== '') {
      const field = /^- \*\*([^*]+):\*\* *(.*)$/.exec(line.text);
      if (field) current.fields.push({ name: field[1], value: field[2].trim(), no: line.no });
      else if (/^ {2,}\S/.test(line.text) && current.fields.length > 0) current.fields.at(-1).value += ` ${line.text.trim()}`;
      else err(`${file}:${line.no}: unexpected content inside ${current.id} (entries hold exactly the 5 template fields)`);
    }
  }
  if (entries.length === 0) return err(`${file}: needs at least one "### DEC-NNN: <Short Title>" entry`);

  const ids = entries.map((e) => e.id);
  for (const e of entries) {
    const where = `${file}:${e.no}: ${e.id}`;
    if (ids.indexOf(e.id) !== ids.lastIndexOf(e.id)) err(`${where} is defined more than once`);
    const names = e.fields.map((f) => f.name);
    if (names.join('|') !== FIELDS.join('|')) {
      err(`${where} must have exactly these fields in order: ${FIELDS.join(', ')} (found: ${names.join(', ') || 'none'})`);
      continue;
    }
    const value = Object.fromEntries(e.fields.map((f) => [f.name, f.value]));
    for (const name of FIELDS) if (value[name] === '') err(`${where} has an empty "${name}:"`);
    if (!isRealDate(value.Date)) err(`${where} needs "Date:" as a real YYYY-MM-DD date`);
    const superseded = /^Superseded by (DEC-\d{3})$/.exec(value.Status);
    if (value.Status !== 'Accepted' && !superseded) err(`${where} needs "Status:" of "Accepted" or "Superseded by DEC-NNN"`);
    if (superseded && (superseded[1] === e.id || !ids.includes(superseded[1]))) {
      err(`${where} is superseded by ${superseded[1]}, which is not another entry in this log`);
    }
  }
}

function checkNoStrayPlaybooks(err) {
  // lstat, so a file, a directory, or a (possibly dangling) symlink named "playbooks" all count.
  if (fs.lstatSync(abs('playbooks'), { throwIfNoEntry: false })) err('playbooks: a top-level playbooks entry is forbidden');
  const walk = (dir) => {
    for (const ent of listDir(dir)) {
      if (ent.name === '.git' || ent.name === 'node_modules') continue;
      const child = dir === '.' ? ent.name : `${dir}/${ent.name}`;
      if (ent.name === 'playbooks' && child !== PLAYBOOK_BASE && child !== 'playbooks') {
        err(`${child}: playbooks may only live under ${PLAYBOOK_BASE}/`);
      }
      if (ent.isDirectory()) walk(child);
    }
  };
  walk('.');
}

function checkNoSymlinks(err) {
  // Checks follow symlinks when reading but not when walking, so a link could carry content
  // past the scans. Validated paths therefore hold real files and directories only.
  const walk = (relPath) => {
    const stat = fs.lstatSync(abs(relPath), { throwIfNoEntry: false });
    if (!stat) return;
    if (stat.isSymbolicLink()) err(`${relPath}: symbolic links are not allowed in validated paths`);
    else if (stat.isDirectory()) for (const ent of listDir(relPath)) walk(`${relPath}/${ent.name}`);
  };
  SYMLINK_FREE_PATHS.forEach(walk);
}

function checkSkillsSubset(err) {
  if (!fs.existsSync(abs('skills'))) return;
  if (!isDir('skills')) return err('skills: must be a directory');
  for (const ent of listDir('skills')) {
    if (!ent.isDirectory()) err(`skills/${ent.name}: only skill directories are allowed directly under skills/`);
    else if (!SKILL_NAMES.includes(ent.name)) err(`skills/${ent.name}/: not one of the 10 approved skills`);
  }
}

function checkZeroDependencies(err) {
  if (fs.existsSync(abs('node_modules'))) err('node_modules/: the repository must have no installed npm packages');
  if (isFile('package.json')) {
    let pkg = null;
    try {
      pkg = JSON.parse(read('package.json'));
    } catch (e) {
      err(`package.json: invalid JSON (${e.message})`);
    }
    for (const key of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      if (isObject(pkg?.[key]) && Object.keys(pkg[key]).length > 0) err(`package.json: "${key}" must be empty (zero npm dependencies)`);
    }
  }
  // Static forms carry a quoted specifier; dynamic forms are matched up to their argument so a
  // template literal or a computed specifier is caught as well.
  const specifiers = [
    /\bfrom\s*(['"])([^'"\n]*)\1/g,
    /\bimport\s*(['"])([^'"\n]*)\1/g,
    /\b(?:import|require)\s*\(\s*(['"`]?)([^'"`)\n]*)/g,
  ];
  for (const file of walkFiles('scripts')) {
    if (!/\.(?:mjs|js|cjs)$/.test(file)) continue;
    const source = read(file);
    for (const re of specifiers) {
      for (const m of source.matchAll(re)) {
        const [, quote, spec] = m;
        const local = /^\.\/[\w.-]+\.mjs$/.test(spec) && isFile(`scripts/${spec.slice(2)}`);
        if (quote === '') err(`${file}: loads a module through a computed specifier — only literal "node:" built-ins and sibling ./*.mjs files are allowed`);
        else if (!spec.startsWith('node:') && !local) {
          err(`${file}: imports "${spec}" — only "node:" built-ins and sibling ./*.mjs files are allowed`);
        }
      }
    }
  }
}

function scanForModelNames(patterns, err) {
  // Patterns carry the "g" flag and run over the whole file, not line by line.
  for (const file of MODEL_FREE_PATHS.flatMap(walkFiles)) {
    const text = read(file);
    for (const [label, re] of patterns) {
      for (const m of text.matchAll(re)) {
        const line = text.slice(0, m.index).split('\n').length;
        err(`${file}:${line}: hardcoded model name "${normalizeSpace(m[0])}" (${label}); bind models only in profiles/*.yaml`);
      }
    }
  }
}

function loadJson(file, err) {
  if (!isFile(file)) {
    err(`${file}: missing`);
    return null;
  }
  try {
    return JSON.parse(read(file));
  } catch (e) {
    err(`${file}: invalid JSON (${e.message})`);
    return null;
  }
}

function checkExactDir(dir, expected, err) {
  if (!isDir(dir)) return err(`${dir}/: missing`);
  for (const ent of listDir(dir)) if (!expected.includes(`${dir}/${ent.name}`)) err(`${dir}/${ent.name}: unexpected entry`);
  for (const file of expected) if (!isFile(file)) err(`${file}: missing`);
}

function checkProfileSchema(err) {
  checkExactDir('profiles', ['profiles/schema.json', ...PROFILE_NAMES.map((p) => `profiles/${p}.yaml`)], err);
  const schema = loadJson('profiles/schema.json', err);
  if (schema === null) return;
  if (!isObject(schema)) return err('profiles/schema.json: must be a JSON object');
  if (schema.$schema !== JSON_SCHEMA_DIALECT) err(`profiles/schema.json: "$schema" must be ${JSON_SCHEMA_DIALECT}`);
  const lint = lintSchema(schema);
  for (const e of lint) err(`profiles/schema.json ${e}`);
  if (lint.length > 0) return;

  const list = (v) => (Array.isArray(v) ? v : []);
  const top = ['schema_version', 'profile', 'domain', 'description', 'invariants', 'tier3_path_patterns', 'roles', 'review_matrix', 'risk_tiers'];
  if (!sameSet(list(schema.required), top)) err(`profiles/schema.json: top-level "required" must be exactly ${top.join(', ')}`);
  if (!sameSet(list(schema.properties?.roles?.required), ROLE_KEYS)) {
    err(`profiles/schema.json: properties.roles.required must be exactly ${ROLE_KEYS.join(', ')}`);
  }
  if (!sameSet(list(schema.properties?.risk_tiers?.required), TIER_KEYS)) {
    err('profiles/schema.json: properties.risk_tiers.required must be exactly "0", "1", "2", "3"');
  }
  const abstractRoles = list(schema.$defs?.abstract_role?.enum);
  if (!sameSet(abstractRoles, [...ROLE_KEYS, REVIEWER_ROLE])) {
    err(`profiles/schema.json: $defs.abstract_role.enum must be exactly ${[...ROLE_KEYS, REVIEWER_ROLE].join(', ')}`);
  }
  ctx.schema = schema;
  ctx.abstractRoles = abstractRoles;
}

function profileModels(profile) {
  // Every model string a profile binds, for the dynamic model-name scan.
  const names = new Set();
  const add = (v) => {
    if (typeof v === 'string') names.add(v);
  };
  for (const role of Object.values(isObject(profile.roles) ? profile.roles : {})) {
    if (!isObject(role)) continue;
    for (const key of ['primary', 'secondary', 'fallback', 'paired_with']) add(role[key]);
    if (Array.isArray(role.companion_tools)) role.companion_tools.forEach(add);
  }
  for (const [builder, entry] of Object.entries(isObject(profile.review_matrix) ? profile.review_matrix : {})) {
    if (builder === 'default_fallback') add(entry);
    else {
      add(builder);
      if (isObject(entry)) Object.values(entry).forEach(add);
    }
  }
  return names;
}

function checkProfilesConform(err) {
  if (!ctx.schema) err('profiles/schema.json did not load, so profiles cannot be validated against it');
  for (const name of PROFILE_NAMES) {
    const file = `profiles/${name}.yaml`;
    if (!isFile(file)) {
      err(`${file}: missing`);
      continue;
    }
    let profile;
    try {
      profile = parseStrictYaml(read(file), file);
    } catch (e) {
      if (!(e instanceof YamlError)) throw e;
      err(e.message);
      continue;
    }
    for (const model of profileModels(profile)) ctx.modelNames.add(model);
    if (!ctx.schema) continue;
    const errors = validateSchema(ctx.schema, profile);
    for (const e of errors) err(`${file}: ${e}`);
    if (profile.profile !== name) err(`${file}: "profile" must be "${name}" to match the file name`);
    if (`rcstack-${profile.domain}` !== name) err(`${file}: "domain" must be "${name.replace('rcstack-', '')}"`);
    if (errors.length === 0) ctx.profiles[name] = profile;
  }
}

function checkSchemaStrictness(err) {
  const base = ctx.profiles['rcstack-engineering'];
  if (!ctx.schema || !base) return err('profiles/rcstack-engineering.yaml did not validate, so schema strictness cannot be probed');
  runProbes('profiles/schema.json', ctx.schema, base, profileProbes(), err);
}

function checkReviewerInvariant(err) {
  for (const name of PROFILE_NAMES) {
    const profile = ctx.profiles[name];
    const file = `profiles/${name}.yaml`;
    if (!profile) {
      err(`${file}: did not validate, so reviewer != builder cannot be proven`);
      continue;
    }
    const matrix = profile.review_matrix;
    for (const role of BUILDER_ROLES) {
      for (const slot of ['primary', 'secondary', 'fallback']) {
        const model = profile.roles[role][slot];
        if (model !== undefined && !isObject(matrix[model])) {
          err(`${file}: roles.${role}.${slot} "${model}" has no review_matrix entry`);
        }
      }
    }
    for (const [builder, entry] of Object.entries(matrix)) {
      if (builder === 'default_fallback') continue;
      const same = (a, b) => normalizeModel(a) === normalizeModel(b);
      if (same(entry.primary, builder)) err(`${file}: review_matrix["${builder}"].primary equals the builder`);
      if (entry.tier1_primary !== undefined && same(entry.tier1_primary, builder)) {
        err(`${file}: review_matrix["${builder}"].tier1_primary equals the builder`);
      }
      if (same(entry.fallback, builder)) err(`${file}: review_matrix["${builder}"].fallback equals the builder`);
      if (same(entry.primary, entry.fallback)) err(`${file}: review_matrix["${builder}"] primary and fallback are the same model`);
    }
    // Two spellings of one model would make reviewer resolution ambiguous.
    const builders = Object.keys(matrix).filter((k) => k !== 'default_fallback');
    const normalized = builders.map(normalizeModel);
    normalized.forEach((name, i) => {
      if (normalized.indexOf(name) !== i) err(`${file}: review_matrix has more than one entry for "${builders[i]}"`);
    });
    // default_fallback reviews any model that builds without an entry of its own, so it must
    // not itself be such a model: that pairing would be a self-review.
    for (const [role, binding] of Object.entries(profile.roles)) {
      for (const [slot, model] of Object.entries(binding)) {
        if (typeof model !== 'string' || normalized.includes(normalizeModel(model))) continue;
        if (normalizeModel(model) === normalizeModel(matrix.default_fallback)) {
          err(`${file}: review_matrix.default_fallback equals roles.${role}.${slot} "${model}", which has no entry of its own`);
        }
      }
    }
  }
}

function checkProfileSemantics(err) {
  for (const name of PROFILE_NAMES) {
    const profile = ctx.profiles[name];
    const file = `profiles/${name}.yaml`;
    if (!profile) {
      err(`${file}: did not validate, so semantic invariants cannot be checked`);
      continue;
    }
    // Tier 2+ is the delivery floor: every gate stays on (SPEC.md §2.3 exit gates).
    for (const tier of ['2', '3']) {
      for (const flag of TIER_FLAGS) {
        if (profile.risk_tiers[tier][flag] !== true) err(`${file}: risk_tiers["${tier}"].${flag} must be true`);
      }
    }
    // quick_lookup.exclusive reserves that model for Tier 0 lookups only.
    const lookup = profile.roles.quick_lookup;
    if (lookup.exclusive === true) {
      const reserved = normalizeModel(lookup.primary);
      if (lookup.fallback !== undefined && normalizeModel(lookup.fallback) !== reserved) {
        err(`${file}: roles.quick_lookup.fallback must equal its primary while exclusive is true`);
      }
      for (const role of ROLE_KEYS.filter((r) => r !== 'quick_lookup')) {
        // Every bound name counts: single slots and list slots such as companion_tools.
        const bound = Object.entries(profile.roles[role]).flatMap(([slot, v]) => (Array.isArray(v) ? v : [v])
          .filter((model) => typeof model === 'string').map((model) => [slot, model]));
        for (const [slot, model] of bound) {
          if (normalizeModel(model) === reserved) err(`${file}: roles.${role}.${slot} reuses the exclusive quick_lookup model`);
        }
      }
      for (const [builder, entry] of Object.entries(profile.review_matrix)) {
        const used = builder === 'default_fallback' ? [entry] : [builder, ...Object.values(entry)];
        if (used.some((m) => normalizeModel(m) === reserved)) err(`${file}: review_matrix["${builder}"] uses the exclusive quick_lookup model`);
      }
    }
  }
  // AGENTS.md declares this repo's own Tier 3 paths; the engineering profile must cover them all.
  const section = isFile('AGENTS.md') ? splitSections(read('AGENTS.md')).find((s) => s.title === 'Tier 3 Paths') : undefined;
  const declared = [...(section?.text ?? '').matchAll(/^\s*[-*] +`([^`\s]+)`\s*$/gm)].map((m) => m[1]);
  if (declared.length === 0) err('AGENTS.md: needs a "## Tier 3 Paths" section listing one backticked path per bullet');
  for (const p of SELF_PROTECTED_PATHS) if (!declared.includes(p)) err(`AGENTS.md: "## Tier 3 Paths" must list "${p}"`);
  const engineering = ctx.profiles['rcstack-engineering'];
  for (const p of engineering ? new Set([...SELF_PROTECTED_PATHS, ...declared]) : []) {
    if (!engineering.tier3_path_patterns.includes(p)) err(`profiles/rcstack-engineering.yaml: tier3_path_patterns must list "${p}"`);
  }
}

function checkContracts(err) {
  checkExactDir('contracts', CONTRACT_FILES, err);
  for (const [file, terms] of Object.entries(CONTRACT_TERMS)) {
    if (!isFile(file)) continue;
    const sections = splitSections(read(file));
    const section = (title) => sections.find((s) => s.title === title)?.text;
    const fields = section('Required Fields');
    if (!fields?.trim()) err(`${file}: needs a non-empty "## Required Fields" section`);
    else for (const term of terms) if (!fields.includes(term)) err(`${file}: "## Required Fields" does not define "${term}"`);
    // The template is the fenced block itself, not the prose around it.
    const template = markFences(section('Template') ?? '').filter((l) => l.fenced).map((l) => l.text).join('\n');
    if (template.trim() === '') {
      err(`${file}: needs a "## Template" section holding a fenced, copy-pasteable template`);
      continue;
    }
    for (const term of terms) if (!template.includes(term)) err(`${file}: template is missing the required field "${term}"`);
  }

  const file = 'contracts/telemetry-event.schema.json';
  const schema = loadJson(file, err);
  if (schema === null) return;
  if (!isObject(schema)) return err(`${file}: must be a JSON object`);
  if (schema.$schema !== JSON_SCHEMA_DIALECT) err(`${file}: "$schema" must be ${JSON_SCHEMA_DIALECT}`);
  const lint = lintSchema(schema);
  for (const e of lint) err(`${file} ${e}`);
  if (lint.length > 0) return;
  const required = Array.isArray(schema.required) ? schema.required : [];
  if (!sameSet(required, TELEMETRY_REQUIRED)) err(`${file}: "required" must be exactly ${TELEMETRY_REQUIRED.join(', ')}`);
  for (const [what, mutate] of TELEMETRY_ACCEPTED) {
    const doc = clone(TELEMETRY_SAMPLE);
    mutate(doc);
    const errors = validateSchema(schema, doc);
    if (errors.length > 0) err(`${file}: must accept ${what} (${errors[0]})`);
  }
  runProbes(file, schema, TELEMETRY_SAMPLE, telemetryProbes(), err);
}

function checkRules(err) {
  checkExactDir('rules', RULE_FILES, err);
  for (const file of RULE_FILES) if (isFile(file) && read(file).trim() === '') err(`${file}: empty`);
}

function checkRouterSkill(err) {
  checkSkill('rc-router', ctx, err);
  checkRouterContent(err);
}

function checkPlaybookLayout(err) {
  if (!isDir(PLAYBOOK_BASE)) return err(`${PLAYBOOK_BASE}/: missing`);
  const top = ['TEMPLATE.md', ...DOMAINS];
  for (const ent of listDir(PLAYBOOK_BASE)) {
    if (!top.includes(ent.name)) err(`${PLAYBOOK_BASE}/${ent.name}: unexpected entry (allowed: ${top.join(', ')})`);
  }
  for (const domain of DOMAINS) {
    const dir = `${PLAYBOOK_BASE}/${domain}`;
    const expected = Object.keys(PLAYBOOKS[domain]).map((n) => `${dir}/${n}.md`);
    checkExactDir(dir, expected, err);
  }

  const template = `${PLAYBOOK_BASE}/TEMPLATE.md`;
  const doc = readFrontmatterDoc(template, err);
  if (!doc) return;
  checkKeys(template, doc.frontmatter, PLAYBOOK_FRONTMATTER_KEYS, err);
  if (doc.frontmatter.entry_mode !== 'router_only') err(`${template}: entry_mode must be "router_only"`);
  const sec = requireSections(template, doc.sections, PLAYBOOK_HEADINGS, err);
  const invocation = sec['Router-Only Invocation Boundary'];
  if (invocation !== undefined && !normalizeSpace(unquote(invocation)).includes(ROUTER_ONLY_BOUNDARY)) {
    err(`${template}: "## Router-Only Invocation Boundary" must contain the verbatim ROUTER-ONLY rule`);
  }
}

function checkPlaybooks(err) {
  for (const domain of DOMAINS) for (const name of Object.keys(PLAYBOOKS[domain])) checkPlaybook(domain, name, ctx, err);
}

function checkBoundModelNames(err) {
  if (ctx.modelNames.size === 0) return err('no model names could be read from profiles/*.yaml');
  const patterns = [...ctx.modelNames].map((name) => [
    'bound in profiles/',
    new RegExp(`(?<![\\w-])${normalizeSpace(name).split(' ').map(escapeRegExp).join(`${WRAP}*`)}(?![\\w-])`, 'gi'),
  ]);
  scanForModelNames(patterns, err);
}

function checkAllSkillDirs(err) {
  if (!isDir('skills')) return err('skills/: missing');
  const present = listDir('skills').map((e) => e.name);
  for (const name of SKILL_NAMES) {
    if (!isDir(`skills/${name}`)) err(`skills/${name}/: missing`);
    else if (!isFile(`skills/${name}/SKILL.md`)) err(`skills/${name}/SKILL.md: missing`);
  }
  for (const name of present) if (!SKILL_NAMES.includes(name)) err(`skills/${name}: not one of the 10 approved skills`);
  for (const name of SKILL_NAMES.filter((n) => n !== 'rc-router' && isDir(`skills/${n}`))) {
    for (const ent of listDir(`skills/${name}`)) {
      if (ent.name !== 'SKILL.md') err(`skills/${name}/${ent.name}: unexpected entry (atomic skills hold only SKILL.md)`);
    }
  }
  for (const ent of isDir('skills/rc-router') ? listDir('skills/rc-router') : []) {
    if (!['SKILL.md', 'playbooks'].includes(ent.name)) err(`skills/rc-router/${ent.name}: unexpected entry`);
  }
}

function checkRemainingSkills(err) {
  for (const name of SKILL_NAMES.filter((n) => n !== 'rc-router')) checkSkill(name, ctx, err);
}

function checkTelemetryScript(err) {
  const file = 'scripts/log-telemetry.mjs';
  checkExactDir('scripts', ['scripts/verify.mjs', file], err);
  if (!isFile(file)) return;
  const syntax = run(process.execPath, ['--check', abs(file)]);
  if (syntax.status !== 0) return err(`${file}: fails "node --check" (${normalizeSpace(syntax.output)})`);

  withSandboxHome((home) => {
    const env = sandboxEnv(home);
    const cli = (args, input) => run(process.execPath, [abs(file), ...args], { env, cwd: home, input: input ?? '' });
    const good = JSON.stringify(TELEMETRY_SAMPLE);
    const expect = (what, res, wantOk) => {
      if ((res.status === 0) !== wantOk) {
        err(`${file}: ${what} should ${wantOk ? 'succeed' : 'be rejected'} (exit ${res.status}: ${normalizeSpace(res.output).slice(0, 200)})`);
      }
    };
    const withField = (patch) => JSON.stringify({ ...TELEMETRY_SAMPLE, ...patch });

    expect('--dry-run --json with a valid event', cli(['--dry-run', '--json', good]), true);
    expect('--dry-run with a valid event on stdin', cli(['--dry-run'], good), true);
    if (snapshot(home) !== '') err(`${file}: --dry-run must not write anything`);
    expect('an event where reviewer_model == builder_model', cli(['--dry-run', '--json', withField({ reviewer_model: TELEMETRY_SAMPLE.builder_model })]), false);
    expect('an event where reviewer_model differs from builder_model only by case', cli(['--dry-run', '--json', withField({ reviewer_model: TELEMETRY_SAMPLE.builder_model.toUpperCase() })]), false);
    expect('an event missing a required field', cli(['--dry-run', '--json', JSON.stringify({ ...TELEMETRY_SAMPLE, branch: undefined })]), false);
    expect('an event with an impossible calendar date', cli(['--dry-run', '--json', withField({ timestamp: '2026-02-30T09:30:00Z' })]), false);
    expect('malformed JSON', cli(['--dry-run', '--json', '{not json']), false);
    expect('a JSON array payload', cli(['--dry-run', '--json', '[]']), false);
    expect('an empty stdin payload', cli(['--dry-run'], ''), false);
    expect('an unknown flag', cli(['--dry-run', '--bogus', '--json', good]), false);
    if (snapshot(home) !== '') err(`${file}: rejected events and --dry-run must not write anything`);

    const custom = path.join(home, 'custom', 'events.jsonl');
    expect('--file append #1', cli(['--file', custom, '--json', good]), true);
    expect('--file append #2 (stdin)', cli(['--file', custom], good), true);
    expect('an invalid event with --file', cli(['--file', custom, '--json', withField({ risk_tier: 9 })]), false);
    const rows = fs.existsSync(custom) ? fs.readFileSync(custom, 'utf8') : '';
    const parsed = rows.split('\n').filter((l) => l !== '');
    if (!rows.endsWith('\n') || parsed.length !== 2 || !parsed.every((l) => deepEqual(JSON.parse(l), TELEMETRY_SAMPLE))) {
      err(`${file}: two valid appends via --file must leave exactly two newline-terminated JSON rows`);
    }
    if (fs.existsSync(path.join(home, '.rcstack'))) err(`${file}: --file must not touch the default ~/.rcstack location`);

    expect('a default-path append', cli(['--json', good]), true);
    const fallback = path.join(home, '.rcstack', 'telemetry.jsonl');
    const defaultRows = fs.existsSync(fallback) ? fs.readFileSync(fallback, 'utf8').split('\n').filter((l) => l !== '') : [];
    if (defaultRows.length !== 1) err(`${file}: the default path must be ~/.rcstack/telemetry.jsonl (created on demand)`);
  });
}

function checkInstaller(err) {
  const file = 'adapters/install.sh';
  checkExactDir('adapters', [file], err);
  if (!isFile(file)) return;
  if ((fs.statSync(abs(file)).mode & 0o111) === 0) err(`${file}: must be executable (chmod +x)`);
  const source = read(file);
  if (!/^#!.*\bbash\b/.test(source)) err(`${file}: must start with a bash shebang`);
  if (!/^set -euo pipefail$/m.test(source)) err(`${file}: must enable "set -euo pipefail"`);
  if (!source.includes('--dry-run')) err(`${file}: must support --dry-run`);
  // Run without arguments, an empty "$@" is an unbound variable under `set -u` on older bash.
  if (/^\s*for\s+\w+\s+in\s+"\$@"/m.test(source)) err(`${file}: must not loop over "$@" directly (use while/shift)`);
  const syntax = run('bash', ['-n', abs(file)]);
  if (syntax.status !== 0) return err(`${file}: fails "bash -n" (${normalizeSpace(syntax.output)})`);

  const targets = ['.agents/skills', '.claude/skills', '.codex/skills'];
  const sourceOf = (skill) => path.join(REPO_ROOT, 'skills', skill);
  const install = (home, args = ['--dry-run']) => run('bash', [abs(file), ...args], { env: sandboxEnv(home), cwd: home });
  // Whole-line matches, so a path can never be satisfied by a longer path that contains it.
  const hasLine = (res, line) => res.output.split('\n').includes(line);
  const hasLineStarting = (res, prefix) => res.output.split('\n').some((l) => l.startsWith(prefix));
  const pattern = '.rcstack/state/';

  // A: empty home — every link and the gitignore entry are planned, nothing is created.
  withSandboxHome((home) => {
    const res = install(home);
    if (res.status !== 0) return err(`${file}: --dry-run on an empty home must exit 0 (exit ${res.status}: ${normalizeSpace(res.output).slice(0, 300)})`);
    for (const target of targets) {
      for (const skill of SKILL_NAMES) {
        const dest = path.join(home, target, skill);
        if (!hasLine(res, `[DRY-RUN] would link ${dest} -> ${sourceOf(skill)}`)) err(`${file}: --dry-run does not plan the link ${target}/${skill}`);
      }
    }
    const planned = res.output.split('\n').filter((l) => / -> /.test(l));
    if (planned.length !== targets.length * SKILL_NAMES.length || planned.some((l) => /\/playbooks(?:\/|$)/.test(l.replaceAll(REPO_ROOT, '')))) {
      err(`${file}: must plan exactly ${targets.length * SKILL_NAMES.length} links and never link or flatten rc-router/playbooks`);
    }
    if (!hasLine(res, `[DRY-RUN] would append "${pattern}" to global gitignore ${path.join(home, '.config/git/ignore')}`)) {
      err(`${file}: --dry-run does not plan the global gitignore entry (default ~/.config/git/ignore)`);
    }
    if (snapshot(home) !== '') err(`${file}: --dry-run mutated an empty home`);
  });

  // B: existing links and an existing ignore entry — reported, never rewritten in dry-run.
  // C: a real file or directory in the way — refuse, exit non-zero, change nothing.
  withSandboxHome((home) => {
    const claude = path.join(home, '.claude/skills');
    const ignoreFile = path.join(home, '.config/git/ignore');
    const elsewhere = path.join(home, 'elsewhere');
    fs.mkdirSync(claude, { recursive: true });
    fs.symlinkSync(sourceOf('rc-router'), path.join(claude, 'rc-router'));
    fs.symlinkSync(elsewhere, path.join(claude, 'rc-init'));
    fs.mkdirSync(path.dirname(ignoreFile), { recursive: true });
    fs.writeFileSync(ignoreFile, `*.swp\n${pattern}\n`);
    let before = snapshot(home);
    let res = install(home);
    if (res.status !== 0) err(`${file}: --dry-run with pre-existing symlinks must exit 0 (exit ${res.status})`);
    if (!hasLine(res, `[OK] already linked ${path.join(claude, 'rc-router')} -> ${sourceOf('rc-router')}`)) {
      err(`${file}: an identical existing symlink must be reported as "[OK] already linked"`);
    }
    if (!hasLine(res, `[DRY-RUN] would update ${path.join(claude, 'rc-init')}: ${elsewhere} -> ${sourceOf('rc-init')}`)) {
      err(`${file}: a symlink pointing elsewhere must be planned as an update`);
    }
    if (!hasLine(res, `[OK] already ignored ${pattern} in ${ignoreFile}`)) err(`${file}: an existing gitignore entry must be reported as "[OK]"`);
    if (snapshot(home) !== before) err(`${file}: --dry-run mutated a populated home`);

    const realDir = path.join(home, '.codex/skills/rc-audit');
    const realFile = path.join(home, '.agents/skills/rc-state');
    fs.mkdirSync(realDir, { recursive: true });
    fs.mkdirSync(path.dirname(realFile), { recursive: true });
    fs.writeFileSync(realFile, 'not a symlink\n');
    before = snapshot(home);
    res = install(home);
    if (res.status === 0) err(`${file}: must exit non-zero when a destination is a real file or directory`);
    for (const dest of [realDir, realFile]) {
      if (!hasLineStarting(res, `[ERROR] refusing to overwrite ${dest}:`)) err(`${file}: must print a clear error naming ${path.relative(home, dest)}`);
    }
    if (res.output.includes('would link') || res.output.includes('[DONE]')) err(`${file}: a refused run must not plan or perform any change`);
    if (snapshot(home) !== before) err(`${file}: a refused run must not change anything`);
  });

  // D: a mistyped flag must never fall through to a real install.
  withSandboxHome((home) => {
    const res = install(home, ['--dryrun']);
    if (res.status === 0) err(`${file}: an unknown argument must exit non-zero`);
    if (snapshot(home) !== '') err(`${file}: an unknown argument must not trigger an install`);
  });

  // E: a global gitignore that cannot be written later must be refused up front, before any
  // link is planned, so a real run can never stop half-installed.
  withSandboxHome((home) => {
    const ignoreFile = path.join(home, '.config/git/ignore');
    fs.mkdirSync(path.dirname(ignoreFile), { recursive: true });
    fs.symlinkSync(path.join(home, 'missing-dir', 'ignore'), ignoreFile);
    const before = snapshot(home);
    const res = install(home);
    if (res.status === 0) err(`${file}: a dangling global gitignore symlink must be refused in the preflight`);
    if (!hasLineStarting(res, `[ERROR] refusing to use ${ignoreFile} `)) err(`${file}: must name the unusable global gitignore in an error`);
    if (res.output.includes('would link')) err(`${file}: a refused preflight must not plan any link`);
    if (snapshot(home) !== before) err(`${file}: a refused preflight must not change anything`);
  });

  // F: two harness directories that are really one directory are linked once, not twice.
  withSandboxHome((home) => {
    fs.mkdirSync(path.join(home, '.agents'));
    fs.symlinkSync(path.join(home, '.agents'), path.join(home, '.claude'));
    const before = snapshot(home);
    const res = install(home);
    const planned = res.output.split('\n').filter((l) => l.startsWith('[DRY-RUN] would link ')).length;
    if (res.status !== 0 || planned !== 2 * SKILL_NAMES.length || !hasLineStarting(res, `[SKIP] ${path.join(home, '.claude/skills')} `)) {
      err(`${file}: aliased harness directories must be planned once (${2 * SKILL_NAMES.length} links plus a [SKIP]), found ${planned}`);
    }
    if (snapshot(home) !== before) err(`${file}: --dry-run mutated a home with aliased harness directories`);
  });
}

function checkCrossReferences(err) {
  const files = [
    'AGENTS.md', 'README.md', 'docs/decisions.md',
    ...['skills', 'contracts', 'rules'].flatMap(walkFiles).filter((f) => f.endsWith('.md')),
  ];
  const token = /(?<![\w.~\/-])(?:contracts|profiles|rules|skills|scripts|adapters|docs)\/[\w.\/<>{},*-]+/g;
  for (const file of files.filter(isFile)) {
    read(file).split('\n').forEach((line, i) => {
      for (const m of line.matchAll(token)) {
        const ref = m[0].replace(/[.,]+$/, '');
        if (/[<>{}*,]/.test(ref)) continue; // placeholder or glob, not a concrete path
        if (!fs.existsSync(abs(ref))) err(`${file}:${i + 1}: references "${ref}", which does not exist`);
      }
    });
  }
}

const GROUPS = [
  [1, '1.1', 'Required base files exist (AGENTS.md under 100 lines)', checkBaseFiles],
  [1, '1.2', 'docs/decisions.md entries follow the DEC template', checkDecisionsLog],
  [1, '1.3', 'No playbooks directory outside skills/rc-router/playbooks/', checkNoStrayPlaybooks],
  [1, '1.4', 'skills/ holds only approved skill directories', checkSkillsSubset],
  [1, '1.5', 'Scripts have zero third-party dependencies', checkZeroDependencies],
  [1, '1.6', 'No hardcoded model names outside profiles/ and README.md (known families)', (err) => scanForModelNames(MODEL_NAME_PATTERNS, err)],
  [1, '1.7', 'No symbolic links inside validated paths', checkNoSymlinks],
  [2, '2.1', 'profiles/schema.json is a supported Draft 2020-12 schema defining all roles', checkProfileSchema],
  [2, '2.2', 'All 3 profiles parse as strict YAML and conform to the schema', checkProfilesConform],
  [2, '2.3', 'profiles/schema.json rejects every malformed-profile probe', checkSchemaStrictness],
  [2, '2.4', 'reviewer != builder holds across every review_matrix', checkReviewerInvariant],
  [2, '2.5', 'Profile semantics: Tier 2+ gates, exclusive quick_lookup, self-protected paths', checkProfileSemantics],
  [2, '2.6', 'All 6 contracts exist with required fields; telemetry schema is strict', checkContracts],
  [2, '2.7', 'All 3 rules files exist and are non-empty', checkRules],
  [2, '2.8', 'rc-router passes the skill contract and references every profile and playbook', checkRouterSkill],
  [2, '2.9', 'Playbook layout is exactly TEMPLATE.md + 12 playbooks (7/3/2)', checkPlaybookLayout],
  [2, '2.10', 'Every playbook passes frontmatter, heading, ROUTER-ONLY and tier-gate checks', checkPlaybooks],
  [2, '2.11', 'No model name bound in profiles/ appears outside profiles/ and README.md', checkBoundModelNames],
  [3, '3.1', 'skills/ holds exactly the 10 approved skill directories', checkAllSkillDirs],
  [3, '3.2', 'The 9 remaining atomic skills pass the skill contract', checkRemainingSkills],
  [3, '3.3', 'scripts/log-telemetry.mjs passes node --check and sandboxed behaviour checks', checkTelemetryScript],
  [3, '3.4', 'adapters/install.sh is executable, passes bash -n and sandboxed --dry-run checks', checkInstaller],
  [3, '3.5', 'Cross-references resolve to real files', checkCrossReferences],
];

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  let slice = 3;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') return { help: true };
    const value = arg === '--slice' ? argv[++i] : /^--slice=(.*)$/.exec(arg)?.[1];
    if (value === undefined || !['1', '2', '3'].includes(value)) return { error: `invalid argument "${arg}"` };
    slice = Number(value);
  }
  return { slice };
}

function main() {
  const usage = 'Usage: node scripts/verify.mjs [--slice=1|2|3]   (default: 3 = full validation)';
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage);
    return 0;
  }
  if (args.error) {
    console.error(`[ERROR] ${args.error}\n${usage}`);
    return 2;
  }
  if (Number(process.versions.node.split('.')[0]) < 20) {
    console.error(`[ERROR] Node.js >= 20 is required (found ${process.versions.node})`);
    return 2;
  }

  console.log(`rcstack-beta verify — slice ${args.slice}${args.slice === 3 ? ' (full)' : ''} — ${REPO_ROOT}`);
  let failedGroups = 0;
  let errorCount = 0;
  const selected = GROUPS.filter(([slice]) => slice <= args.slice);
  for (const [, id, title, fn] of selected) {
    const errors = [];
    try {
      fn((msg) => errors.push(msg));
    } catch (e) {
      errors.push(`check crashed: ${e.stack ?? e.message}`);
    }
    console.log(`[${errors.length === 0 ? 'PASS' : 'FAIL'}] ${id} ${title}`);
    for (const e of errors) console.log(`       - ${e}`);
    if (errors.length > 0) failedGroups++;
    errorCount += errors.length;
  }
  const passed = selected.length - failedGroups;
  console.log(
    errorCount === 0
      ? `RESULT: PASS — ${passed}/${selected.length} check groups passed (slice ${args.slice})`
      : `RESULT: FAIL — ${failedGroups}/${selected.length} check groups failed with ${errorCount} error(s) (slice ${args.slice})`,
  );
  return errorCount === 0 ? 0 : 1;
}

const invokedDirectly = process.argv[1] !== undefined
  && fs.existsSync(process.argv[1])
  && fs.realpathSync(process.argv[1]) === SELF;
if (invokedDirectly) process.exitCode = main();
