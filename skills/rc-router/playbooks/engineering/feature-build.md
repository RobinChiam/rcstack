---
name: feature-build
profile: rcstack-engineering
entry_mode: router_only
default_tier: 2
required_assurance: A2
required_capabilities:
  - systems_research
  - architect_blueprint
  - primary_builder
  - independent_reviewer
contracts:
  - contracts/research-brief.md
  - contracts/spec.md
  - contracts/work-receipt.md
  - contracts/audit-findings.md
  - contracts/review-map.md
---

# Feature Build

Delivers a new capability from a grounded brief through sliced implementation to an audited, human-reviewed change.

## Router-Only Invocation Boundary

> **ROUTER-ONLY:** This playbook MUST ONLY be invoked by `rc-router` (`/rcstack`) after profile selection, risk-tier classification, and live model resolution. Never execute this playbook standalone or bypass `rc-router`.

## Do NOT Use When

- Existing behavior is wrong rather than missing — use `bug-root-cause`.
- The structure changes but the behavior must not — use `refactor-pinned`.
- Any target path matches `tier3_path_patterns` — use `security-critical`.
- The work is a sketch nobody will depend on yet — use `vibe-iterate`.
- Nobody knows whether the approach can work — use `viability-spike` first.

## Workflow Phases

1. **TRIAGE** — `rc-router` has opened state with `rc-state.mjs init`. Restate the feature in one
   sentence and confirm it has observable acceptance criteria; ask if it does not.
2. **RESEARCHING** — `systems_research` writes `contracts/research-brief.md`: how the affected
   code works today (cited by `file:line`), constraints from repo law and prior decisions, and
   open questions. Questions that change scope are settled with the human before planning.
3. **PLANNING** — `architect_blueprint` turns the brief into `contracts/spec.md` with
   non-overlapping file slices, failure modes, acceptance criteria, and a verification plan. A
   slice that touches a Tier 3 path stops this playbook and re-routes.
4. **EXECUTING** — `primary_builder` implements one slice per delegation, inside that slice's
   paths, with tests alongside the code. It commits and returns `contracts/work-receipt.md`.
5. **VERIFYING** — the main thread runs the repo's canonical verify command on the new head and
   admits the slice's receipt through `rc-receipt.mjs` (`rc-state.mjs transition --admit-receipt`,
   with `--allowed-paths` set to the slice). A failing verify or rejected receipt returns to
   `EXECUTING` with the exact failure. After the last slice, run the integrated verify once more.
6. **AUDITING** — the `independent_reviewer` audits the whole range in a fresh context against the
   spec and returns `contracts/audit-findings.md`. Any `Blocker` returns to `EXECUTING`; the fix is
   verified and re-audited. Then the main thread admits the integrated receipt with the open
   finding counts, which sets the achieved assurance.
7. **AWAITING_REVIEW** — synthesize `contracts/review-map.md`, propose a decision entry for any
   durable choice, and stop for the human.
8. **SHIPPED** — after approval, append the telemetry row with `rc-log.mjs`, then hand the branch
   to `ship-and-babysit` or close the state.

## Exit Gate & Definition of Done

- The canonical verify command exits `0` on the final head.
- Every slice receipt and the integrated receipt were `ADMITTED` by `rc-receipt.mjs`.
- A reviewer that is not the builder audited in a fresh context; `0` open `Blocker`s.
- Achieved assurance is at least `A2`, or the Review Map carries an `ASSURANCE GAP` banner the
  human acknowledged.
- Every acceptance criterion in the spec is met and traceable to a test or check.
- The Review Map was delivered and the telemetry row was appended by `rc-log.mjs`.
