---
name: garden-maintenance
profile: rcstack-engineering
entry_mode: router_only
default_tier: 2
required_skills:
  - rc-doctor
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

# Garden Maintenance (`engineering/garden-maintenance`)

Periodic repo hygiene: diagnose, apply only approved cures as atomic commits, prune stale decisions, and turn repeat problems into deterministic checks.

## Router-Only Invocation Boundary

> **ROUTER-ONLY:** This playbook MUST ONLY be invoked by `rc-router` (`/rcstack`) after profile selection, risk-tier classification, and model resolution. Never execute this playbook standalone or bypass `rc-router`.

The router hands over the profile, the tier, the resolved role-to-model route, the reviewer, and the branch state. If any of these is missing, stop and return to `rc-router`.

## Do NOT Use When

- Only a read-only health check is wanted — run `rc-doctor` directly in Diagnose mode.
- The target repo has no guardrails yet — run `rc-init` first.
- A specific defect needs fixing — use `bug-root-cause`.
- Code structure needs to change — use `refactor-pinned`.
- A proposed cure touches a Tier 3 path — stop and return to `rc-router`, which selects `security-critical`.

## Workflow Phases

1. **Diagnose** — `rc-doctor` in Diagnose mode: a read-only hygiene report with evidence for every finding. Nothing is changed in this phase.
2. **Approve cures** — present the findings and let the human choose. Record the approved cures as a compact cure plan per `contracts/spec.md`, with unapproved findings listed under Non-Goals.
3. **Cure** — `rc-doctor` in Cure mode: `primary_builder` applies each approved cure as one atomic commit and runs `rc-verify` after each. A cure that fails verification is reverted. This role is the builder of record and emits a Work Receipt per `contracts/work-receipt.md`.
4. **Prune decisions** — `rc-state`: mark decisions in `docs/decisions.md` that no longer hold as superseded, never deleted, and add an entry for each new guardrail.
5. **Promote repeat issues** — any finding seen in a previous run becomes a deterministic check (a lint rule, a test, or a validator rule) so it cannot recur silently. Run `rc-verify` to prove the new check passes now and fails on the old problem.
6. **Audit** — `rc-audit`: the `independent_reviewer` reviews the cure plan, the cumulative diff, and the verification evidence in a fresh context and emits Audit Findings per `contracts/audit-findings.md`. Every `Blocker` and `Major` returns to phase 3.
7. **Review Map** — `rc-review-map`: emit the Review Map per `contracts/review-map.md` and append the telemetry row.

## Exit Gate & Definition of Done

- Only human-approved cures were applied, one atomic commit each.
- `rc-verify` passed after every cure and on the final commit, with commands and exit codes in a Work Receipt.
- `rc-audit` returns `APPROVE` with zero open `Blocker` findings; every `Major` is fixed or listed for human approval.
- A Review Map is emitted and one telemetry row is appended.
- `docs/decisions.md` is current, and every repeat issue has a deterministic check.
