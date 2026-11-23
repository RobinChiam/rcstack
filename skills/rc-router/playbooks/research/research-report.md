---
name: research-report
profile: rcstack-research
entry_mode: router_only
default_tier: 2
required_skills:
  - rc-ground
  - rc-verify
  - rc-audit
  - rc-review-map
required_roles:
  - deep_grounding
  - systems_research
  - architect_blueprint
  - independent_reviewer
contracts:
  - contracts/research-brief.md
  - contracts/spec.md
  - contracts/work-receipt.md
  - contracts/audit-findings.md
  - contracts/review-map.md
---

# Research Report (`research/research-report`)

Investigate a question across multiple sources and deliver a cited, decision-ready report that has survived an adversarial devil's-advocate audit.

## Router-Only Invocation Boundary

> **ROUTER-ONLY:** This playbook MUST ONLY be invoked by `rc-router` (`/rcstack`) after profile selection, risk-tier classification, and model resolution. Never execute this playbook standalone or bypass `rc-router`.

The router hands over the profile, the tier, the resolved role-to-model route, the reviewer, and the branch state. If any of these is missing, stop and return to `rc-router`.

## Do NOT Use When

- The answer depends on whether something actually runs — use `viability-spike`.
- The goal is to learn the topic rather than decide something — use `topic-deep-dive` under the study profile.
- One fact or definition is wanted — answer directly at Tier 0.
- The decision is already made and needs implementing — use `feature-build` under the engineering profile.

## Workflow Phases

1. **Investigate** — `rc-ground`: `deep_grounding` builds the multi-source corpus and extracts cited facts, and `systems_research` adds hypotheses, trade-offs, and failure modes. Together they produce a Research Brief per `contracts/research-brief.md`, with conflicting sources shown side by side.
2. **Blueprint the report** — `architect_blueprint` writes the report blueprint as a Spec per `contracts/spec.md`: the decision question as the Problem Statement, the outline under Data Shapes & Interfaces, the evaluation criteria as Acceptance Criteria, and citation and calculation checks as the Verification Plan.
3. **Synthesize** — `architect_blueprint` writes the report to the blueprint: recommendation and confidence first, then options with strengths, weaknesses, and failure modes, each claim citing the Research Brief. This role is the builder of record and emits a Work Receipt per `contracts/work-receipt.md`.
4. **Verify** — `rc-verify`: every citation resolves, every quoted figure matches its source, and every derived number recomputes. A failure returns to phase 3.
5. **Devil's-advocate audit** — `rc-audit`: the `independent_reviewer` argues against the report in a fresh context: the strongest counter-argument, missing sources, unsupported leaps, and what would overturn the recommendation. It emits Audit Findings per `contracts/audit-findings.md`. Every `Blocker` and `Major` returns to phase 3, or to phase 1 when evidence is missing.
6. **Review Map** — `rc-review-map`: emit the Review Map per `contracts/review-map.md`, ranking claims by how much the decision depends on them, and append the telemetry row.

## Exit Gate & Definition of Done

- A report exists that leads with a recommendation, states confidence, and cites every factual claim.
- `rc-verify` passes: citations resolve and numbers recompute, with the checks recorded in a Work Receipt.
- `rc-audit` returns `APPROVE` with zero open `Blocker` findings; every `Major` is fixed or listed for human approval.
- A Review Map is emitted and one telemetry row is appended.
- The report says what evidence would change the recommendation.
