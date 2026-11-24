---
name: rc-init
description: Bootstraps a target repository with opt-in modules for repo law, a decisions log, feature specs, strict checks, a canonical verify command, and CI.
version: 0.1.0
entry_mode: standalone_or_router
capability: bootstrap
invokes_contracts: []
invokes_scripts:
  - scripts/verify.mjs
---

# rc-init

## Single Job

Give a target repository the minimum it needs for rcstack to work in it honestly: written law, a decisions log, deterministic checks, and one verify command that CI also runs.

## When to Use

- A repository is about to be worked on through rcstack and has no `AGENTS.md`.
- A repository has no single command that says whether it is healthy.
- The human asks to add one specific module (for example, only the decisions log).

## Do NOT Use When

- The repository is already bootstrapped and needs upkeep — use `rc-doctor`.
- There is a feature, fix, or refactor to deliver — use `rc-router`. Bootstrapping never changes
  product behavior.
- Adding a module means editing existing source, a Tier 3 path, or CI that already gates
  releases — hand the change to `rc-router`, which will classify it.
- The machine itself is not set up — use `rc-setup`.

## Procedure

1. **Survey, read-only.** Detect the languages, package managers, existing formatters, linters,
   type checkers, test runners, and CI. List which modules already exist. Change nothing yet.
2. **Offer the modules.** Each is opt-in; present all six with what would be created and wait for
   the human to choose. Never install a module that was not chosen.
   - **Repo law** — `AGENTS.md`: under 100 lines, stating the prime directive, layout invariants,
     authoring rules, safety rules, and the verify command.
   - **Decisions log** — `docs/decisions.md`, seeded with one real entry. Every entry carries
     `Date`, `Status`, `Decision`, `Rejected Alternative`, and `Guardrail`.
   - **Feature specs** — the `specs/` layout, recorded in `AGENTS.md`: one directory per feature
     holding a `spec.md` and the feature's other documents, with sub-specs nested inside their
     parent's directory. Create a spec directory only when there is a real spec to put in it,
     never a placeholder, and check the tree with
     `node ~/.rcstack/dist/scripts/verify.mjs --specs <repo>/specs`.
   - **Strict checks** — the strictest practical formatter, linter, and type-checker settings for
     the stack, using tools the repository already has before adding any.
   - **Canonical verify** — one command that runs format, lint, static and type checks, and tests,
     and exits non-zero on any failure. It is named in `AGENTS.md`.
   - **CI workflow** — runs exactly the canonical verify command on every push and pull request.
3. **Write only the chosen modules**, one commit per module. Do not reformat or fix existing code
   to satisfy a new check in the same commit; record the failures instead.
   Never impose a fixed list of allowed root entries on a target repository: its top-level
   layout is its own, and `AGENTS.md` records only the invariants the human states. If the
   repository keeps committed folders that are not authoritative (an archive of old work, vendored
   material), offer to list them in `AGENTS.md` on one line starting `Ignored / Archived Paths:`.
4. **Keep the target clean.** Write no rcstack runtime state, telemetry, or Work Receipts into the
   repository, and no reference to a machine-local path. Task state lives in
   `~/.rcstack/runtime/`; contracts stay in `~/.rcstack/dist/`. The only rcstack documents a
   repository holds are its feature specs under `specs/`.
5. **Run the canonical verify command** and report its real exit code and output.
6. **State the assurance the repository can now support.** With mechanical checks only, work tops
   out at `A1`; behavioral tests on changed paths are needed for `A2`; Tier 3 work needs hardened
   evidence for `A3`. Name what is missing, so later runs surface an honest `ASSURANCE GAP`.
7. **Hand over.** List what was created, what was skipped and why, any check that fails on
   existing code, and the suggested next step (usually `rc-router` for the first real task).

## Definition of Done

- Only the modules the human chose were created, one commit each.
- `AGENTS.md` (if chosen) is under 100 lines and names the canonical verify command.
- `docs/decisions.md` (if chosen) has at least one entry with all five fields.
- `specs/` (if chosen and present) passes `verify.mjs --specs`.
- The canonical verify command ran, and its real exit code was reported.
- CI (if chosen) runs that same command and nothing else.
- No rcstack runtime state, telemetry, or Work Receipt exists anywhere in the target repository.
