# AGENTS.md — Repo Law for `rcstack-beta`

Binding rules for every agent or human changing this repository. The system spec,
`specs/initialization-build/spec.md`, is canonical: when it and this file disagree, it wins and this file gets fixed.

## Prime Directive

- A change is not done until all three gates exit `0`. Paste their result lines as evidence:
  `node scripts/verify.mjs`, `node --test tests/*.test.mjs`, `bash adapters/install.sh --dry-run`.
- Never weaken, skip, or special-case a check to get green. Fix the content, or change the rule
  in the system spec and `docs/decisions.md` first.
- Changing a guardrail (a check, a schema, a boundary sentence) requires a new `DEC-NNN` entry.

## Three Directories

- **Source** (this checkout): edited freely, never a symlink target, never holds runtime state.
- **Installed runtime** (`~/.rcstack/`): `dist/` is replaced only by `adapters/install.sh`;
  `profiles/` is machine-local and never clobbered; `runtime/` is a local-only shadow git repo.
- **Target repositories**: bootstrapped by `rc-init`; hold feature `specs/`, never state or receipts.

## Layout Invariants

- `skills/` holds exactly 5 directories: `rc-router`, `rc-setup`, `rc-init`, `rc-doctor`, `rc-retro`.
- The 12 playbooks plus `TEMPLATE.md` live only under `skills/rc-router/playbooks/`, split into
  `engineering/` (7), `study/` (3), and `research/` (2). No other `playbooks` directory may exist
  outside `specs/`.
- The repository root, `docs/`, `scripts/`, `contracts/`, `profiles/`, `rules/`, `adapters/` and
  `tests/` are closed sets fixed by the system spec's tree. Adding a skill, playbook, script,
  contract, or top-level entry is a spec change.
- `specs/` holds every spec, the system spec included, and no spec lives anywhere else. Every
  directory under it contains a `spec.md`, so a sub-spec sits inside its parent spec's directory,
  with the feature's other documents (`requirements.md`, `planning.md`, ...) beside it.
- No symbolic links anywhere in the source tree. No `package.json` dependencies, ever.

## Model-Agnosticism

- Concrete model names never appear in `skills/`, `rules/`, `contracts/`, or this file. Only
  `profiles/*.yaml` binds them; `README.md` and the system spec document the default stack.
- Name an abstract capability instead (`primary_builder`, `independent_reviewer`, ...) and let
  `rc-router` resolve it through the active profile.
- `reviewer != builder` is absolute. No profile, fallback, or shortcut may permit self-review.

## Authoring Rules

- Skills: frontmatter (`name`, `description`, `version`, `entry_mode`, `capability`,
  `invokes_contracts`, `invokes_scripts`) and exactly the five sections `Single Job`, `When to
  Use`, `Do NOT Use When`, `Procedure`, `Definition of Done`, in that order.
- Playbooks: start from `skills/rc-router/playbooks/TEMPLATE.md`. Keep the `ROUTER-ONLY:` rule
  verbatim; `scripts/verify.mjs` matches it exactly. `default_tier` and `required_assurance`
  are fixed by the system spec, section 2.4.
- A playbook must honour every gate its default tier sets in the profile (`require_spec`,
  `require_state_file`, `require_verify`, `require_receipt_gate`, `require_cross_model_audit`,
  `require_review_map`, `log_telemetry`).
- Every `## Do NOT Use When` names the skill or playbook that owns the adjacent task.
- Profiles and frontmatter use the strict YAML subset: 2-space indent, block mappings and
  sequences, double-quoted model names and globs; `[]` is the only flow form. No tabs, anchors,
  tags, or block scalars.
- Scripts are Node.js `>=20` ESM importing only `node:` built-ins and each other.
- `adapters/install.sh` stays portable `bash`, idempotent, and mutation-free under `--dry-run`.

## Tier 3 Paths

Edits to these paths are security-critical and route through the `security-critical` playbook:

- `adapters/install.sh`
- `scripts/verify.mjs`
- `scripts/rc-state.mjs`
- `scripts/rc-receipt.mjs`
- `profiles/schema.json`

## Review and Memory

- Tier 2+ changes need a fresh-context cross-model audit and a Review Map before they are done.
- Assurance (`A0`-`A3`) is computed by `scripts/rc-receipt.mjs` from evidence, never self-rated.
  It covers the task's base to the current `HEAD` and resets when `HEAD` moves. Short of the
  floor, surface an `ASSURANCE GAP`; never round up.
- Durable choices go in `docs/decisions.md` with `Date`, `Status`, `Decision`,
  `Rejected Alternative`, and `Guardrail`. Never delete an entry — supersede it.
- Task state lives in `~/.rcstack/runtime/state/` and is written only by `scripts/rc-state.mjs`.

## Safety

- Never run `adapters/install.sh` without `--dry-run` unless the human explicitly asks for
  activation in that session.
- Never write to `~/.rcstack`, `~/.agents`, `~/.claude`, `~/.codex`, `~/.gemini`, `~/.cursor`, or
  git config from a build or test. Tests work only inside `os.tmpdir()` and pass `--home`,
  `--rcstack-home`, `--runtime-dir`, or `--file`.
- Never push or force-push without an explicit request.
- No secrets, tokens, or personal data in any tracked file, state file, or telemetry row.

## Commands

```bash
node scripts/verify.mjs                 # full validation (slice 3)
node scripts/verify.mjs --slice=1       # foundation only
node scripts/verify.mjs --slice=2       # + profiles, contracts, rules, rc-router, playbooks
node --test tests/*.test.mjs            # hermetic unit tests
bash adapters/install.sh --dry-run      # print the activation plan; changes nothing
```
