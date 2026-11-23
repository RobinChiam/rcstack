# AGENTS.md — Repo Law for `rcstack-beta`

Binding rules for every agent or human changing this repository. `SPEC.md` is the canonical
specification: when this file and `SPEC.md` disagree, `SPEC.md` wins and this file gets fixed.

## Prime Directive

- A change is not done until `node scripts/verify.mjs` exits `0`. Paste the result line as evidence.
- Never weaken, skip, or special-case a check to get green. Fix the content, or change the rule
  in `SPEC.md` and `docs/decisions.md` first.
- Changing a guardrail (a check, a schema, a boundary sentence) requires a new `DEC-NNN` entry.

## Layout Invariants (2-tier)

- `skills/` holds exactly 10 skill directories: `rc-router`, `rc-init`, `rc-doctor`, `rc-ground`,
  `rc-architect`, `rc-verify`, `rc-audit`, `rc-state`, `rc-review-map`, `rc-retro`.
- The 12 playbooks plus `TEMPLATE.md` live only under `skills/rc-router/playbooks/`, split into
  `engineering/` (7), `study/` (3), and `research/` (2). No other `playbooks` directory may exist.
- Adding a skill or playbook is a spec change, not a routine edit. Extend an existing one instead.
- Do not add files to `scripts/`, `contracts/`, `profiles/`, or `rules/` beyond the `SPEC.md` tree.
- No symbolic links anywhere in validated paths; the repository is only ever a link target.

## Model-Agnosticism

- Concrete model names appear only in `profiles/*.yaml` and `README.md`.
- Everywhere else, name an abstract role (`primary_builder`, `independent_reviewer`, ...) and let
  `rc-router` resolve it through the active profile.
- `reviewer != builder` is absolute. No profile, fallback, or shortcut may permit self-review.

## Authoring Rules

- Skills: frontmatter (`name`, `description`, `version`, `entry_mode`, `role`,
  `invokes_contracts`) and the five sections `Single Job`, `When to Use`, `Do NOT Use When`,
  `Procedure`, `Definition of Done`, in that order.
- Playbooks: start from `skills/rc-router/playbooks/TEMPLATE.md`. Keep the `ROUTER-ONLY:` rule
  and the router-dispatched boundary sentence verbatim; `scripts/verify.mjs` matches them exactly.
- A playbook must honour every gate its tier sets in the profile (`require_spec`,
  `require_verify`, `require_cross_model_audit`, `require_review_map`, `log_telemetry`).
- Every `## Do NOT Use When` names the skill or playbook that owns the adjacent task.
- Profiles use the strict YAML subset: 2-space indent, double-quoted model names and globs, block
  sequences only; no tabs, anchors, tags, flow collections, or block scalars.
- Scripts are Node.js `>=20` ESM with built-ins only. No `package.json` dependencies, ever.
- `adapters/install.sh` stays POSIX `bash`, idempotent, and side-effect free under `--dry-run`.

## Tier 3 Paths

Edits to these paths are security-critical and route through the `security-critical` playbook:

- `adapters/install.sh`
- `scripts/verify.mjs`
- `scripts/log-telemetry.mjs`
- `profiles/schema.json`
- `contracts/telemetry-event.schema.json`

## Review and Memory

- Tier 2+ changes need a fresh-context cross-model audit and a Review Map before they are done.
- Durable choices go in `docs/decisions.md` using the exact `DEC-NNN` template; never delete an
  entry — supersede it.
- Session state goes in `.rcstack/state/<branch-slug>.md`, which is globally gitignored and never
  committed.

## Safety

- Never run `adapters/install.sh` without `--dry-run` unless the human explicitly asks for
  activation in that session.
- Never write to `~/.agents`, `~/.claude`, `~/.codex`, `~/.rcstack`, or git config from a build
  or test. Tests use a sandboxed `HOME` and `--file`.
- No secrets, tokens, or personal data in any tracked file or telemetry row.

## Commands

```bash
node scripts/verify.mjs                 # full validation (slice 3)
node scripts/verify.mjs --slice=1       # skeleton and docs only
node scripts/verify.mjs --slice=2       # + profiles, contracts, rules, router, playbooks
node scripts/log-telemetry.mjs --dry-run --json '<event>'   # validate a telemetry row
bash adapters/install.sh --dry-run      # print the activation plan; changes nothing
```
