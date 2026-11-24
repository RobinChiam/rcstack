# Decisions Log — `rcstack-beta`

Evergreen record of durable choices. Every entry carries `Date`, `Status`, `Decision`,
`Rejected Alternative`, and `Guardrail`; `scripts/verify.mjs` enforces all five. Entries are never
deleted: a changed decision gets a new entry and the old one is marked `Superseded by DEC-NNN`.

## DEC-001 — Three-directory split: source, installed runtime, target repos

- **Date:** 2026-11-23
- **Status:** Accepted
- **Decision:** The source checkout is only ever edited. `adapters/install.sh` promotes it into
  `~/.rcstack/dist/`; every harness skill directory symlinks to `~/.rcstack/dist/skills/<skill>`
  and nowhere else. Machine-active profiles live in `~/.rcstack/profiles/`, task state and
  telemetry in `~/.rcstack/runtime/`. Target repositories receive no rcstack runtime file.
- **Rejected Alternative:** Symlinking harness skill directories straight into the dev checkout.
  Editing a skill then rewrites the router underneath the live session that is using it, so
  rcstack could not safely build rcstack.
- **Guardrail:** `tests/install.test.mjs` asserts every harness symlink resolves to
  `<rcstack-home>/dist/skills/*` and never into the source. `scripts/verify.mjs` rejects any
  symbolic link in the owned source tree (narrowed to the owned directories by DEC-015).

## DEC-002 — Exactly five top-level skills

- **Date:** 2026-11-23
- **Status:** Accepted
- **Decision:** `skills/` holds only `rc-router`, `rc-setup`, `rc-init`, `rc-doctor`, and
  `rc-retro`. Grounding, architecture, verification, audit, state, and review-map work are not
  skills: they are contracts, deterministic scripts, and playbook phases driven by `rc-router`.
- **Rejected Alternative:** One registered skill per lifecycle step. Ten or more entries crowd
  every harness skill list and invite calling a step without the router's tier and reviewer
  decisions.
- **Guardrail:** `scripts/verify.mjs` fails on any other directory under `skills/` (slice 1) and
  requires exactly the five (slice 3). `adapters/install.sh` links only those five.

## DEC-003 — Playbooks are nested and router-only

- **Date:** 2026-11-23
- **Status:** Accepted
- **Decision:** The 12 playbooks live only under `skills/rc-router/playbooks/` in the
  `engineering`, `study`, and `research` directories. Each declares `entry_mode: router_only` and
  carries the verbatim `ROUTER-ONLY:` boundary rule.
- **Rejected Alternative:** A top-level `playbooks/` directory, or registering playbooks as
  skills. Either makes a playbook directly invocable, bypassing profile selection, risk-tier
  classification, and reviewer resolution.
- **Guardrail:** `scripts/verify.mjs` fails on a `playbooks` directory anywhere else (outside
  `specs/` and custom root directories, as narrowed by DEC-013 and DEC-015), on any file outside the exact 12 plus `TEMPLATE.md`, and on a
  missing or reworded `ROUTER-ONLY:` rule.

## DEC-004 — Assurance ladder `A0`-`A3` is computed, never self-rated

- **Date:** 2026-11-23
- **Status:** Accepted
- **Decision:** Achieved assurance is derived mechanically from evidence: exit codes, which check
  classes passed, and open audit findings. Each risk tier has a floor (`A0` for Tier 0 through
  `A3` for Tier 3). Work short of its floor ships only under an explicit `ASSURANCE GAP` banner.
- **Rejected Alternative:** Letting the builder or router state a confidence level. Self-rated
  confidence is uncorrelated with correctness and always rounds up.
- **Guardrail:** `profiles/schema.json` pins each tier's floor and `scripts/verify.mjs` pins every
  playbook's tier and floor to the system spec, section 2.4. `scripts/rc-receipt.mjs` is the only source
  of an assurance level; `scripts/rc-state.mjs` refuses `AWAITING_REVIEW` and `SHIPPED` below the
  floor without `--ack-assurance-gap`; `scripts/rc-log.mjs` rejects an `A2` or `A3` row that has
  no independent reviewer.

## DEC-005 — Shadow-git single-writer task state

- **Date:** 2026-11-23
- **Status:** Accepted
- **Decision:** Active task state lives at `~/.rcstack/runtime/state/<repo-slug>/<branch-slug>.md`
  inside a local-only git repository. Only the main thread mutates it, and only through the
  state script, which locks, checks an optimistic revision, writes atomically, and commits every
  transition. The shadow history is the state: every decision reads the last shadow commit, never
  the working file, so a hand edit or a write left by a crashed writer cannot influence anything,
  and the next writer puts the committed revision back. Every decision is also made on the target
  repository as it is once the lock is held. Subagents never receive state paths; they return
  Work Receipts. Git beats state.
- **Rejected Alternative:** A gitignored state file inside each target repository. It pollutes
  the repo, vanishes on `git clean`, and lets several agents overwrite each other silently.
- **Guardrail:** `scripts/rc-state.mjs` refuses a runtime directory inside the target repository,
  a shadow repository that has a remote or whose `.git` is not a real directory, and a stale
  `--expected-rev`. `tests/rc-state.test.mjs` covers the lock, the revision check, forged and
  hand-edited state files, a hostile machine git configuration, and a repository that changes
  while a writer waits for the lock. `rc-router` keeps state paths out of delegation briefs.

## DEC-006 — `reviewer != builder` is absolute

- **Date:** 2026-11-23
- **Status:** Accepted
- **Decision:** Work is audited in a fresh context by a different model than the one that built
  it. Every builder-side model has a `review_matrix` entry whose reviewers differ from it. When no
  independent reviewer is reachable the run is flagged degraded; it is never self-approved.
- **Rejected Alternative:** Allowing the builder to review itself in a fresh context when the
  reviewer is unavailable. Same-model review shares the builder's blind spots.
- **Guardrail:** `profiles/schema.json` pins `require_reviewer_not_equal_builder: true`,
  `require_fresh_context_audit: true`, and `allow_self_review_on_fallback: false`.
  `scripts/verify.mjs` enforces matrix coverage and inequality for every builder model, and
  `scripts/rc-log.mjs` rejects a telemetry row in which a builder reviewed its own work.

## DEC-007 — Zero-dependency scripts with shared primitives in `scripts/verify.mjs`

- **Date:** 2026-11-23
- **Status:** Accepted
- **Decision:** Scripts are Node.js `>=20` ESM using only `node:` built-ins. The strict YAML
  subset parser, the JSON Schema subset validator, and the glob matcher live in
  `scripts/verify.mjs`; the other scripts import them. The validator throws on any schema keyword
  it does not enforce, so a schema can never promise a constraint that silently does nothing.
- **Rejected Alternative:** npm packages for YAML and JSON Schema (supply-chain surface and an
  install step on every machine), or a fifth shared library file (breaks the closed `scripts/`
  tree), or a private copy of the parser in each script (the copies drift).
- **Guardrail:** `scripts/verify.mjs` fails on any import that is not a `node:` built-in or an
  existing relative file, on `package.json` dependencies, and on a `node_modules` directory.

## DEC-008 — Work enters state only through the 4-point receipt gate

- **Date:** 2026-11-23
- **Status:** Accepted
- **Decision:** A subagent returns a Work Receipt and nothing else. `scripts/rc-receipt.mjs` admits
  it only when its schema is complete, `git diff` between its two commits equals the files it
  claims, the tree is clean, and its verify command exited `0`. `scripts/rc-state.mjs` runs that
  gate itself on `--admit-receipt`, so achieved assurance cannot be set any other way. Audit
  counts are `null` until an independent audit has run, which caps un-audited work at `A1`.
  Achieved assurance describes the task's whole range: only an integrated receipt (task base to
  the current `HEAD`) sets it, and it returns to `A0` as soon as `HEAD` moves. A floor can be
  raised at `init`, never lowered, and a playbook never starts below its default tier.
- **Rejected Alternative:** Trusting a subagent's prose summary, or passing an already-computed
  admission result into the state script. Both let a claim be recorded without being checked.
- **Guardrail:** `tests/rc-receipt.test.mjs` covers every rejection, the `A0`-`A3` ladder, and a
  hostile machine git configuration. `tests/rc-state.test.mjs` proves a rejected receipt leaves the
  state untouched, an ancestor or slice receipt never raises assurance, and new commits reset it.

## DEC-009 — The state machine has no bypass

- **Date:** 2026-11-23
- **Status:** Accepted
- **Decision:** `scripts/rc-state.mjs` allows only the transitions drawn in the system spec, section 2.2,
  plus `AWAITING_REVIEW -> EXECUTING` for a blocker the human raises at review. `BLOCKED` records
  the phase it was entered from and returns only there. Tier escalation is one-way. An unfinished
  task is discarded only with an explicit `close --abandon`.
- **Rejected Alternative:** Letting `BLOCKED` resume into any phase, as "any phase <-> BLOCKED"
  could be read. It would turn `BLOCKED` into a route around verification and audit.
- **Guardrail:** `tests/rc-state.test.mjs` asserts illegal transitions, the `BLOCKED` round trip,
  one-way escalation, and the assurance gate.

## DEC-010 — The installer promotes only a verified source into a read-only dist

- **Date:** 2026-11-23
- **Status:** Accepted
- **Decision:** `adapters/install.sh` runs `scripts/verify.mjs` on the source and scans every
  destination for collisions before it changes anything. It stages a copy inside the rcstack
  home, makes it read-only, and swaps it into `dist/` by rename (one atomic exchange where the
  platform supports it, otherwise two renames with rollback). Existing profiles, the runtime
  repository, and non-symlink harness entries are never overwritten.
- **Rejected Alternative:** Copying files into `dist/` in place. A failed or interrupted copy
  leaves live sessions reading a half-updated tree.
- **Guardrail:** `tests/install.test.mjs` asserts a dry run writes nothing, a collision aborts
  before any change, profile edits survive a re-install, and `dist/` is not writable.

## DEC-011 — Model-agnostic surfaces are enforced, not trusted

- **Date:** 2026-11-23
- **Status:** Accepted
- **Decision:** Skills, playbooks, rules, contracts, and `AGENTS.md` name abstract capabilities
  only. Concrete models are bound in `profiles/*.yaml` with portable descriptors (`driver_kind`
  and a display `model` name) and mapped to a live catalog id at dispatch time. Because that
  mapping ignores case and punctuation, every `reviewer != builder` check compares model
  identity rather than spelling: names are compared as whole word and number tokens, so a display
  name, its catalog id (wherever the id puts the version), and the same label behind a provider
  name are one model, while a model whose name merely ends with another's stays different.
- **Rejected Alternative:** Naming a preferred model inside a playbook, or storing a provider
  instance id in a profile. The first makes every model change a multi-file edit; the second
  breaks the profile on any other machine.
- **Guardrail:** `scripts/verify.mjs` scans those surfaces for model-name patterns (display names,
  catalog ids, snake_case, version-first and versionless spellings) and for every name bound in a
  profile, and rejects provider instance ids and UUIDs in profiles. `tests/verify.test.mjs`
  asserts the shipped profiles equal the system spec's section 3.3 table.

## DEC-012 — The repository tree is closed, including its root

- **Date:** 2026-11-23
- **Status:** Superseded by DEC-013
- **Decision:** The repository holds exactly the tree in `SPEC.md` section 1.A, plus `assets/`
  for the README icon that the initial commit shipped. `SPEC.md` is the only copy of the
  specification in the repository; drafts for a future revision are kept outside it until they
  replace `SPEC.md`.
- **Rejected Alternative:** Keeping the spec's working copy under a `specs/` directory next to
  `SPEC.md`. Two copies drift, and an open root lets runtime state or stray directories land in
  the source checkout unnoticed.
- **Guardrail:** `scripts/verify.mjs` fails on any root entry outside the tree, on any file in
  `docs/` other than `decisions.md`, and on a `skills` path that is not a directory.

## DEC-013 — Feature-local specs live under `specs/`

- **Date:** 2026-11-24
- **Status:** Accepted (amended by DEC-014 and DEC-015)
- **Decision:** Each feature keeps its spec and the documents written while changing and
  implementing it in its own directory under `specs/`. Every directory under `specs/`, at any
  depth, holds a `spec.md`, so a sub-spec always sits inside its parent spec's directory and is
  constrained by it; any other file the task needs (`requirements.md`, `planning.md`, ...) sits
  beside it. `SPEC.md` stays the single system specification: a feature spec describes one change
  on top of it and is never a second copy. (DEC-014 later moved that specification into `specs/`.) The rest of the repository root stays closed, as in
  DEC-012; `specs/` joins the tree. `specs/` is source-only and holds no runtime state.
- **Rejected Alternative:** Keeping specs outside the repository (DEC-012): a change and the
  design it implements are then never reviewed or versioned together, and its requirements and
  planning notes scatter. Also rejected: one flat file per feature, which leaves those documents
  no home, and a free-form tree, where a folder without a `spec.md` passes unnoticed.
- **Guardrail:** `scripts/verify.mjs` checks the layout in slice 1 and offers the same check for
  any repository as `--specs`; it still fails on every other stray root entry. A spec directory
  may be named for its subject, so the rule against stray `playbooks` directories applies
  outside `specs/` only; nothing under `specs/` is ever installed or read as a playbook.
  `tests/verify.test.mjs` covers each layout rule, and `tests/install.test.mjs` asserts that
  `adapters/install.sh` installs with `specs/` present and never stages it into `dist/`.

## DEC-014 — The system specification lives in `specs/` like every other spec

- **Date:** 2026-11-24
- **Status:** Accepted
- **Decision:** The system specification is `specs/initialization-build/spec.md`. No spec document lives outside `specs/`, and
  the repository root holds no `SPEC.md`. It stays canonical: every other spec describes one
  change on top of it, and a feature that changes the system contract edits it in the same
  change. This amends DEC-013, which kept the system specification at the root.
- **Rejected Alternative:** Leaving `SPEC.md` at the root. One spec would be exempt from the
  layout every other spec follows, and there would be two places to look for specs. Also
  rejected: copying it into `specs/` while keeping the root file, because two copies drift.
- **Guardrail:** `scripts/verify.mjs` requires the system spec at that path, fails on a
  `SPEC.md` at the root, and still requires every path the system spec names to exist. It opens
  and lists only real files and directories inside the checkout, so a pipe or a link in place of
  any document or directory fails the check instead of hanging it or bringing in outside files.
  `tests/verify.test.mjs` reads the model stack table from it and compares the shipped profiles.

## DEC-015 — The root is open; structure is enforced inside owned subtrees, and git decides what is ignored

- **Date:** 2026-11-24
- **Status:** Accepted
- **Decision:** `scripts/verify.mjs` enforces exact membership only inside the directories rcstack
  owns (`skills/`, its playbooks tree, `profiles/`, `contracts/`, `rules/`, `scripts/`,
  `adapters/`, `tests/`, `docs/`, `specs/`). The repository root is open: any other top-level
  entry, tracked or not, is neither listed nor read. Three root names stay forbidden whether or
  not git ignores them: `playbooks`, `SPEC.md`/`spec.md`, and `node_modules`. Inside the owned
  directories, paths that git ignores and does not track are skipped by default. This amends
  DEC-013, which kept the root closed.
- **Rejected Alternative:** The closed root of DEC-012 and DEC-013: a local, git-ignored
  `.archive/` made verify, 32 tests and the installer fail in a checkout whose committed tree was
  valid. Also rejected: parsing `.gitignore` in the validator (it would disagree with git on
  negation, nesting and the user's excludes file); skipping ignored paths in the installer's
  check too (the installer copies whole directories, so an ignored file there would reach
  `dist/` unjudged); and judging custom directories with the symlink and playbooks rules (an
  archive of old work legitimately holds both).
- **Guardrail:** The ignored set comes only from `git ls-files --others --ignored
  --exclude-standard`, so a tracked file is never in it, and any git failure or a root outside a
  worktree yields an empty set: everything is judged. `adapters/install.sh` runs verify with
  `--include-ignored`. `scripts/rc-receipt.mjs` is unchanged: its boundary check reads the commit
  range, where ignore rules do not apply. `tests/verify.test.mjs` proves that an ignored or
  tracked `.archive/` passes, that a rogue skill, playbook or root `playbooks/` still fails, that
  a tracked file matching an ignore pattern is still judged, and that an ignore rule cannot excuse
  a missing file; `tests/install.test.mjs` proves the installer refuses an ignored file in a
  directory it copies.
