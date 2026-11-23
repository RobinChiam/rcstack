---
name: security-critical
profile: rcstack-engineering
entry_mode: router_only
default_tier: 3
required_skills:
  - rc-state
  - rc-architect
  - rc-verify
  - rc-audit
  - rc-review-map
required_roles:
  - systems_research
  - architect_blueprint
  - security_builder
  - independent_reviewer
contracts:
  - contracts/research-brief.md
  - contracts/spec.md
  - contracts/work-receipt.md
  - contracts/audit-findings.md
  - contracts/review-map.md
---

# Security Critical (`engineering/security-critical`)

The auto-escalated Tier 3 track for auth, sandboxing, containers, symlinks, infrastructure, and schema changes. Every gate is mandatory and none may run degraded.

## Router-Only Invocation Boundary

> **ROUTER-ONLY:** This playbook MUST ONLY be invoked by `rc-router` (`/rcstack`) after profile selection, risk-tier classification, and model resolution. Never execute this playbook standalone or bypass `rc-router`.

The router hands over the profile, the tier, the resolved role-to-model route, the reviewer, and the branch state. If any of these is missing, stop and return to `rc-router`.

## Do NOT Use When

- No touched path matches a Tier 3 pattern and the change is not security-relevant — use `feature-build` or `bug-root-cause`.
- The work is exploratory and nothing will be kept — use `viability-spike` under the research profile, at Tier 3.
- The change is already audited and only needs shipping — use `ship-and-babysit`, which keeps the Tier 3 gates.
- The intent is to finish without a cross-model audit — never. When no distinct reviewer is reachable, the run stops after `rc-verify` and hands the audit to the human, exactly as `rc-router` defines for Tier 3.

## Workflow Phases

1. **Load state** — `rc-state`: read `docs/decisions.md` and the branch state, then record the goal, the Tier 3 trigger (the matching path or pattern), profile, and this playbook.
2. **Threat-aware grounding and blueprint** — `rc-architect`: `systems_research` grounds the affected paths, trust boundaries, and prior decisions in a Research Brief per `contracts/research-brief.md`; `architect_blueprint` writes the Spec per `contracts/spec.md` with abuse cases under Failure Modes and a negative test for each. The human approves the Spec before any build. This approval is never skipped.
3. **Build** — `security_builder` implements exactly the approved Spec in small commits, with the negative tests, and emits a Work Receipt per `contracts/work-receipt.md`. This role is the builder of record. No scope beyond the Spec; no secrets in code, logs, or receipts.
4. **Verify** — `rc-verify`: run the full Verification Plan, including every negative test, and a dry run for anything that mutates a filesystem, environment, or deployment. A failure returns to phase 3.
5. **Strict audit** — `rc-audit`: the `independent_reviewer` audits the Spec, the full diff, and the verification evidence in a fresh context and emits Audit Findings per `contracts/audit-findings.md`. The reviewer must be a different model from the builder. When none is reachable, the run halts here with the audit recorded as outstanding and handed to the human; it does not complete. Every `Blocker` and every `Major` returns to phase 3, then phase 4, then a re-audit.
6. **Review Map** — `rc-review-map`: emit the Review Map per `contracts/review-map.md` with the security-relevant files first in the reading order, and append the telemetry row. Then `rc-state` records the outcome and every security decision made.

## Exit Gate & Definition of Done

- The human approved the Spec before the build started.
- `rc-verify` passes on the final commit, including negative tests and dry runs, with commands and exit codes in a Work Receipt.
- `rc-audit` returns `APPROVE` from a different model in a fresh context, with zero open `Blocker` and zero open `Major` findings.
- A Review Map is emitted and one telemetry row is appended, and that row names the reviewer: `reviewer_model` is never null for a completed Tier 3 run.
- Security decisions are recorded in `docs/decisions.md` with a guardrail each.
