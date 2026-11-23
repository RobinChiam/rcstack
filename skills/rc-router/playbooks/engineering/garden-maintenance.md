---
name: garden-maintenance
profile: rcstack-engineering
entry_mode: router_only
default_tier: 2
required_assurance: A2
required_capabilities:
  - architect_blueprint
  - primary_builder
  - independent_reviewer
contracts:
  - contracts/spec.md
  - contracts/work-receipt.md
  - contracts/audit-findings.md
  - contracts/review-map.md
---

# Garden Maintenance

Keeps a repository healthy: diagnose with `rc-doctor`, apply approved atomic cures, prune stale decisions, and turn repeated mistakes into deterministic checks.

## Router-Only Invocation Boundary

> **ROUTER-ONLY:** This playbook MUST ONLY be invoked by `rc-router` (`/rcstack`) after profile selection, risk-tier classification, and live model resolution. Never execute this playbook standalone or bypass `rc-router`.

## Do NOT Use When

- You only want a diagnosis and no changes — run `rc-doctor` on its own.
- The repository has never been bootstrapped — use `rc-init`.
- There is one structural goal — use `refactor-pinned`. There is a defect — use `bug-root-cause`.
- A cure touches a path matching `tier3_path_patterns` — use `security-critical` for that cure.

## Workflow Phases

1. **TRIAGE** — `rc-router` has opened state with `rc-state.mjs init`. Fix the scope: the whole
   repository or one area.
2. **RESEARCHING** — invoke `rc-doctor` in Diagnose mode. It changes nothing and returns ranked
   findings: failing or missing checks, stale `docs/decisions.md` entries, drift from `AGENTS.md`,
   and mistakes that keep recurring.
3. **PLANNING** — `architect_blueprint` turns the findings into a cure plan in `contracts/spec.md`:
   one atomic, independently revertible cure per slice. The human approves which cures run.
   Nothing is cured without approval.
4. **EXECUTING** — `rc-doctor` in Cure mode: `primary_builder` applies one approved cure per
   commit and returns `contracts/work-receipt.md`. Stale decisions are superseded, never deleted.
   A mistake seen more than once becomes a deterministic check (a test, a lint rule, or a line in
   the repo's verify command) in its own slice.
5. **VERIFYING** — run the repo's canonical verify command after every cure. A cure that turns it
   red is reverted. Admit each receipt through `rc-receipt.mjs`
   (`rc-state.mjs transition --admit-receipt`).
6. **AUDITING** — the `independent_reviewer` checks in a fresh context that each cure is
   behavior-neutral and that every new check really fails on the mistake it targets. It returns
   `contracts/audit-findings.md`; a `Blocker` returns to `EXECUTING`. Then admit the integrated
   receipt with the open finding counts.
7. **AWAITING_REVIEW** — synthesize `contracts/review-map.md` listing each cure and stop for the
   human.
8. **SHIPPED** — after approval, append the telemetry row with `rc-log.mjs`, then hand off to
   `ship-and-babysit` or close the state.

## Exit Gate & Definition of Done

- Every applied cure was approved by the human and is one revertible commit.
- The canonical verify command exits `0` on the final head; every receipt was `ADMITTED` by
  `rc-receipt.mjs`.
- No `docs/decisions.md` entry was deleted; pruned ones are marked superseded.
- Each promoted check was shown to fail on the mistake it guards against.
- A reviewer that is not the builder audited in a fresh context; `0` open `Blocker`s.
- Achieved assurance is at least `A2`, or the Review Map carries an acknowledged `ASSURANCE GAP`.
- The telemetry row was appended by `rc-log.mjs`.
