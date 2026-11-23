---
name: bug-root-cause
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

# Bug Root Cause

Fixes a defect by reproducing it, proving its cause, removing that cause, and leaving a guardrail behind.

## Router-Only Invocation Boundary

> **ROUTER-ONLY:** This playbook MUST ONLY be invoked by `rc-router` (`/rcstack`) after profile selection, risk-tier classification, and live model resolution. Never execute this playbook standalone or bypass `rc-router`.

## Do NOT Use When

- The behavior was never built — use `feature-build`.
- The cause or the fix sits in a path matching `tier3_path_patterns` — use `security-critical`.
- The goal is to tidy code near the bug without changing behavior — use `refactor-pinned`.
- A throwaway prototype is misbehaving — keep iterating in `vibe-iterate`.

## Workflow Phases

1. **TRIAGE** — `rc-router` has opened state with `rc-state.mjs init`. Capture the symptom
   exactly: observed versus expected, the triggering input, the environment.
2. **RESEARCHING** — reproduce first. `systems_research` writes the smallest failing test that
   shows the bug on the base commit, then isolates the root cause: the earliest point where state
   goes wrong, cited by `file:line` in `contracts/research-brief.md`. No fix is written in this
   phase. A bug that cannot be reproduced is `BLOCKED`, not guessed at.
3. **PLANNING** — `architect_blueprint` writes a short `contracts/spec.md`: the root cause in one
   sentence, the fix slice, why the fix removes the cause instead of masking the symptom, and the
   reproduction test as an acceptance criterion.
4. **EXECUTING** — `primary_builder` makes the reproduction test pass by fixing the cause, inside
   the slice, and returns `contracts/work-receipt.md`. Deleting, weakening, or skipping the
   failing test is a rejection.
5. **VERIFYING** — run the repo's canonical verify command; the reproduction test must fail on the
   base commit and pass on the head. Admit the receipt through `rc-receipt.mjs`
   (`rc-state.mjs transition --admit-receipt`).
6. **AUDITING** — the `independent_reviewer` audits in a fresh context and returns
   `contracts/audit-findings.md`: is this the root cause, does the same mistake exist elsewhere,
   does the fix change behavior it should not? A `Blocker` returns to `EXECUTING`.
7. **Harden** — turn the lesson into a guardrail as its own slice: the regression test at minimum,
   and a type, assertion, or lint rule when the whole class of bug can be made impossible. It goes
   through `EXECUTING`, `VERIFYING`, and a re-audit of the delta like any other slice. Then admit
   the integrated receipt with the open finding counts.
8. **AWAITING_REVIEW** — synthesize `contracts/review-map.md` (root cause first) and stop for the
   human.
9. **SHIPPED** — after approval, append the telemetry row with `rc-log.mjs`, then hand off to
   `ship-and-babysit` or close the state.

## Exit Gate & Definition of Done

- A test exists that fails on the base commit and passes on the final head.
- The root cause is stated with a `file:line` citation; the fix removes it, not its symptom.
- The canonical verify command exits `0`; every receipt was `ADMITTED` by `rc-receipt.mjs`.
- A reviewer that is not the builder audited in a fresh context; `0` open `Blocker`s.
- Achieved assurance is at least `A2`, or the Review Map carries an acknowledged `ASSURANCE GAP`.
- A guardrail now catches a recurrence, and the telemetry row was appended by `rc-log.mjs`.
