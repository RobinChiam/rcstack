---
name: ship-and-babysit
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

# Ship and Babysit (`engineering/ship-and-babysit`)

Take a built and audited change over the line: a final verification, an unslop pass, a pull request body generated from the Review Map, and safe triage of CI and review feedback.

## Router-Only Invocation Boundary

> **ROUTER-ONLY:** This playbook MUST ONLY be invoked by `rc-router` (`/rcstack`) after profile selection, risk-tier classification, and model resolution. Never execute this playbook standalone or bypass `rc-router`.

The router hands over the profile, the tier, the resolved role-to-model route, the reviewer, and the branch state. If any of these is missing, stop and return to `rc-router`.

## Do NOT Use When

- The change is not built yet — use `feature-build`, `bug-root-cause`, or `refactor-pinned` first.
- The branch has no approved Spec or no audit ledger — return to `rc-router` and run the building playbook that produces them.
- CI is failing on the default branch for reasons unrelated to this change — use `bug-root-cause`.
- Only a status check is wanted with no action — answer directly at Tier 0.

## Workflow Phases

1. **Load state** — `rc-state`: read the branch state and confirm the upstream artifacts exist: the approved Spec per `contracts/spec.md`, the Work Receipts, and the last Audit Findings. If the upstream run was Tier 3, keep every Tier 3 gate here.
2. **Final verify** — `rc-verify`: run the full verification on the exact commit to be shipped. A failure returns the branch to the playbook that built it.
3. **Unslop pass** — `primary_builder` removes debug output, dead code, commented-out blocks, stray files, and narration comments, with no behaviour change, then re-runs `rc-verify` and emits a Work Receipt per `contracts/work-receipt.md`. This role is the builder of record for everything changed in this playbook.
4. **Audit the delta** — `rc-audit`: the `independent_reviewer` reviews, in a fresh context, everything changed since the last audited commit and emits Audit Findings per `contracts/audit-findings.md`. With no delta since the last `APPROVE`, cite those findings instead of re-auditing.
5. **Pull request body** — `rc-review-map`: refresh the Review Map per `contracts/review-map.md`, generate the pull request body from it, and append the telemetry row. Pushing, opening the pull request, and merging are outward-facing: do them only on explicit human instruction.
6. **Babysit** — classify each CI failure and review comment. Mechanical (formatting, flaky retry, typo): fix, then `rc-verify`. Behavioural: fix through phases 3 and 4 so the delta is re-audited, or return to `rc-router` for `bug-root-cause`. Disagreement: reply with evidence and leave the decision to the human. Then `rc-state` records the status.

Never disable or skip a failing check, never force-push over reviewed commits, and never merge without being asked.

## Exit Gate & Definition of Done

- `rc-verify` passes on the exact commit that ships, with commands and exit codes in a Work Receipt.
- `rc-audit` shows `APPROVE` covering every commit that ships, with zero open `Blocker` findings; every `Major` is fixed or listed for human approval.
- The pull request body is generated from a current Review Map, and one telemetry row is appended.
- Every CI failure and review comment is fixed and verified, answered with evidence, or handed to the human.
- No outward-facing action was taken without explicit instruction.
