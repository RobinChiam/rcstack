---
name: refactor-pinned
profile: rcstack-engineering
entry_mode: router_only
default_tier: 2
required_skills:
  - rc-state
  - rc-verify
  - rc-audit
  - rc-review-map
required_roles:
  - primary_builder
  - independent_reviewer
contracts:
  - contracts/spec.md
  - contracts/work-receipt.md
  - contracts/audit-findings.md
  - contracts/review-map.md
---

# Refactor Pinned (`engineering/refactor-pinned`)

Change structure without changing behaviour: pin what the code does today with characterization tests, then move in small atomic steps that each stay green.

## Router-Only Invocation Boundary

> **ROUTER-ONLY:** This playbook MUST ONLY be invoked by `rc-router` (`/rcstack`) after profile selection, risk-tier classification, and model resolution. Never execute this playbook standalone or bypass `rc-router`.

The router hands over the profile, the tier, the resolved role-to-model route, the reviewer, and the branch state. If any of these is missing, stop and return to `rc-router`.

## Do NOT Use When

- Behaviour is meant to change — use `feature-build`.
- Behaviour is wrong and needs fixing — use `bug-root-cause`; refactor afterwards.
- The cleanup is repo hygiene such as stale docs, dead files, or broken links — use `garden-maintenance`.
- The code being restructured sits on a Tier 3 path — stop and return to `rc-router`, which selects `security-critical`.

## Workflow Phases

1. **Load state** — `rc-state`: read `docs/decisions.md` and the branch state, then record the refactor goal, profile, tier, and this playbook.
2. **Pin behaviour** — `primary_builder` writes characterization tests that capture what the code does today, including behaviour that looks odd, and `rc-verify` proves they pass on the untouched code. Do not fix anything here.
3. **Plan the steps** — `primary_builder` writes a compact refactor Spec per `contracts/spec.md`: the target structure, an ordered list of atomic steps, and Non-Goals that rule out any behaviour change.
4. **Step loop** — `primary_builder` applies one structural step per commit and runs `rc-verify` after each step. A red step is reverted, not patched forward. This role is the builder of record and emits a Work Receipt per `contracts/work-receipt.md` covering all steps.
5. **Audit** — `rc-audit`: the `independent_reviewer` checks in a fresh context that behaviour is unchanged and the pins are meaningful, and emits Audit Findings per `contracts/audit-findings.md`. Every `Blocker` and `Major` returns to phase 4.
6. **Review Map** — `rc-review-map`: emit the Review Map per `contracts/review-map.md` and append the telemetry row. Then `rc-state` records the outcome.

If a step reveals that behaviour must change, stop the loop and return to `rc-router`.

## Exit Gate & Definition of Done

- Characterization tests existed and passed before the first structural step, and still pass unmodified.
- `rc-verify` passed after every step and on the final commit, with commands and exit codes in a Work Receipt.
- `rc-audit` returns `APPROVE` with zero open `Blocker` findings; every `Major` is fixed or listed for human approval.
- A Review Map is emitted and one telemetry row is appended.
- No behaviour change is present in the diff.
