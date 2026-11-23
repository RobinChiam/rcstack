---
name: bug-root-cause
profile: rcstack-engineering
entry_mode: router_only
default_tier: 2
required_skills:
  - rc-state
  - rc-verify
  - rc-audit
  - rc-review-map
required_roles:
  - systems_research
  - primary_builder
  - independent_reviewer
contracts:
  - contracts/spec.md
  - contracts/work-receipt.md
  - contracts/audit-findings.md
  - contracts/review-map.md
---

# Bug Root Cause (`engineering/bug-root-cause`)

Fix a defect by proving it first: a failing test, an isolated cause, a fix for that cause, and a guardrail that keeps the whole class of bug from returning.

## Router-Only Invocation Boundary

> **ROUTER-ONLY:** This playbook MUST ONLY be invoked by `rc-router` (`/rcstack`) after profile selection, risk-tier classification, and model resolution. Never execute this playbook standalone or bypass `rc-router`.

The router hands over the profile, the tier, the resolved role-to-model route, the reviewer, and the branch state. If any of these is missing, stop and return to `rc-router`.

## Do NOT Use When

- The behaviour is missing rather than broken — use `feature-build`.
- The request is cleanup with no observed failure — use `refactor-pinned` or `garden-maintenance`.
- The failure is in CI or review feedback on a change being shipped — use `ship-and-babysit`.
- The defect sits on a Tier 3 path or is a security vulnerability — stop and return to `rc-router`, which selects `security-critical`.
- A quick look is enough to answer "why does this happen" with no fix wanted — answer directly at Tier 0.

## Workflow Phases

1. **Load state** — `rc-state`: read `docs/decisions.md` and the branch state, then record the reported symptom, profile, tier, and this playbook.
2. **Reproduce first** — `primary_builder` writes the smallest failing test or script that reproduces the symptom, and `rc-verify` proves it fails for the reported reason. No fix code is written in this phase. If it cannot be reproduced, stop and report what was tried.
3. **Isolate the root cause** — `systems_research` traces from the failing test to the defect and writes a compact root-cause Spec per `contracts/spec.md`: the symptom, the proven cause with `path:line`, Non-Goals, and Acceptance Criteria that include the failing test passing. An unproven cause is not a cause: keep investigating or stop. No symptom patches.
4. **Fix** — `primary_builder` changes the cause, not the symptom, and emits a Work Receipt per `contracts/work-receipt.md`. This role is the builder of record.
5. **Verify** — `rc-verify`: the reproduction now passes and the full suite stays green. A failure returns to phase 4; a fix that needs a wider change returns to phase 3.
6. **Audit** — `rc-audit`: the `independent_reviewer` checks, in a fresh context, that the fix addresses the proven cause and emits Audit Findings per `contracts/audit-findings.md`. Every `Blocker` and `Major` returns to phase 4.
7. **Harden** — add the guardrail that would have caught this earlier: keep the regression test, and add a lint rule, assertion, type, or deterministic check where one fits. Anything added or changed here re-runs `rc-verify`, and a change to code or checks gets an `rc-audit` of the delta, before the run closes. Then `rc-state` records any new guardrail as a decision, and `rc-review-map` emits the Review Map per `contracts/review-map.md` and appends the telemetry row.

## Exit Gate & Definition of Done

- A test that failed before the fix now passes, and it stays in the suite.
- The root cause is stated with evidence in the Spec; no symptom patch was merged.
- `rc-verify` passes on the final commit, with commands and exit codes in a Work Receipt.
- `rc-audit` returns `APPROVE` with zero open `Blocker` findings; every `Major` is fixed or listed for human approval.
- A guardrail exists, a Review Map is emitted, and one telemetry row is appended.
