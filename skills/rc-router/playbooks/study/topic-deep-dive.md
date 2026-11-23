---
name: topic-deep-dive
profile: rcstack-study
entry_mode: router_only
default_tier: 2
required_skills:
  - rc-ground
  - rc-verify
  - rc-audit
  - rc-review-map
required_roles:
  - deep_grounding
  - architect_blueprint
  - systems_research
  - independent_reviewer
contracts:
  - contracts/research-brief.md
  - contracts/spec.md
  - contracts/work-receipt.md
  - contracts/audit-findings.md
  - contracts/review-map.md
---

# Topic Deep Dive (`study/topic-deep-dive`)

Learn a topic from its sources: curated citations, a note structure and study guide, a first-principles walkthrough, and an independent fact-audit of every claim.

## Router-Only Invocation Boundary

> **ROUTER-ONLY:** This playbook MUST ONLY be invoked by `rc-router` (`/rcstack`) after profile selection, risk-tier classification, and model resolution. Never execute this playbook standalone or bypass `rc-router`.

The router hands over the profile, the tier, the resolved role-to-model route, the reviewer, and the branch state. If any of these is missing, stop and return to `rc-router`.

## Do NOT Use When

- Grounded notes already exist and the goal is memorization — use `recall-and-drill`.
- The learner wants to be questioned rather than taught — use `socratic-session`.
- The goal is a recommendation or decision, not understanding — use `research-report` under the research profile.
- A single definition or fact is wanted — answer directly at Tier 0.
- The material is graded, a submission, or a formal proof — stop and return to `rc-router`, which applies the Tier 3 gates and binds the building role to `security_builder`.

## Workflow Phases

1. **Ground** — `rc-ground`: `deep_grounding` ingests the assigned sources and curates citations into a Research Brief per `contracts/research-brief.md`. Gaps in the sources become Open Questions, not invented facts.
2. **Blueprint the notes** — `architect_blueprint` designs the note structure and study guide as a Spec per `contracts/spec.md`: the learning objective as the Problem Statement, the outline under Data Shapes & Interfaces, what the learner can do afterwards as Acceptance Criteria, and citation checks plus self-test questions as the Verification Plan.
3. **First-principles walkthrough** — `systems_research` writes the notes to the blueprint, building each idea from definitions and worked examples and citing the Research Brief for every claim. This role is the builder of record and emits a Work Receipt per `contracts/work-receipt.md`.
4. **Verify** — `rc-verify`: every citation resolves to the stated location, every worked example recomputes to the stated result, and no factual claim is uncited. A failure returns to phase 3.
5. **Fact-audit** — `rc-audit`: the `independent_reviewer` audits sources and citations in a fresh context, checking that each cited passage supports its claim, and emits Audit Findings per `contracts/audit-findings.md`. Every `Blocker` and `Major` returns to phase 3.
6. **Review Map** — `rc-review-map`: emit the Review Map per `contracts/review-map.md`, ranking sections by factual risk, and append the telemetry row.

## Exit Gate & Definition of Done

- Notes and a study guide exist in the structure the blueprint defines, with every claim cited.
- `rc-verify` passes: citations resolve and worked examples recompute, with the checks recorded in a Work Receipt.
- `rc-audit` returns `APPROVE` with zero open `Blocker` findings; every `Major` is fixed or listed for human approval.
- A Review Map is emitted and one telemetry row is appended.
- Open Questions that the sources could not answer are listed for the learner.
