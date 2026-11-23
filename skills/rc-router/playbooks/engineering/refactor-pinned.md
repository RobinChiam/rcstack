---
name: refactor-pinned
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

# Refactor Pinned

Changes structure without changing behavior, by pinning the behavior with tests first and moving in atomic steps.

## Router-Only Invocation Boundary

> **ROUTER-ONLY:** This playbook MUST ONLY be invoked by `rc-router` (`/rcstack`) after profile selection, risk-tier classification, and live model resolution. Never execute this playbook standalone or bypass `rc-router`.

## Do NOT Use When

- Behavior should change — use `feature-build` for new behavior or `bug-root-cause` for wrong
  behavior. Fix the bug first, then refactor.
- Any path in scope matches `tier3_path_patterns` — use `security-critical`.
- The cleanup is repo-wide hygiene rather than one structural goal — use `garden-maintenance`.

## Workflow Phases

1. **TRIAGE** — `rc-router` has opened state with `rc-state.mjs init`. Name the structural goal
   and the behavior that must not change.
2. **RESEARCHING** — map the public seams of the code being moved and what today's tests already
   cover. List the behavior, including quirks, that callers depend on.
3. **PLANNING** — `architect_blueprint` writes `contracts/spec.md`: the target structure, the
   characterization tests to add, and an ordered list of atomic steps, each of which leaves every
   test green.
4. **EXECUTING (pin)** — `primary_builder` writes characterization tests that capture current
   behavior at the public seams. They must pass on the untouched code. This is the first slice.
5. **EXECUTING (steps)** — `primary_builder` applies one atomic structural step per commit and
   returns `contracts/work-receipt.md` per slice. No step changes a characterization test.
6. **VERIFYING** — run the repo's canonical verify command after every step. A red step is
   reverted, not patched forward. Admit each receipt through `rc-receipt.mjs`
   (`rc-state.mjs transition --admit-receipt`).
7. **AUDITING** — the `independent_reviewer` checks behavior preservation in a fresh context: no
   test weakened, no public interface changed outside the spec, no behavior change hidden in a
   move. It returns `contracts/audit-findings.md`; a `Blocker` returns to `EXECUTING`. Then admit
   the integrated receipt with the open finding counts.
8. **AWAITING_REVIEW** — synthesize `contracts/review-map.md` and stop for the human.
9. **SHIPPED** — after approval, append the telemetry row with `rc-log.mjs`, then hand off to
   `ship-and-babysit` or close the state.

## Exit Gate & Definition of Done

- Characterization tests were committed before the first structural step and pass, unmodified, on
  the final head.
- The canonical verify command exits `0` after every step and on the final head.
- Every receipt was `ADMITTED` by `rc-receipt.mjs`.
- A reviewer that is not the builder audited in a fresh context; `0` open `Blocker`s.
- Achieved assurance is at least `A2`, or the Review Map carries an acknowledged `ASSURANCE GAP`.
- The Review Map was delivered and the telemetry row was appended by `rc-log.mjs`.
