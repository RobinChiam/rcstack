---
name: viability-spike
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
  - primary_builder
  - security_builder
  - independent_reviewer
contracts:
  - contracts/research-brief.md
  - contracts/spec.md
  - contracts/work-receipt.md
  - contracts/audit-findings.md
  - contracts/review-map.md
---

# Viability Spike (`research/viability-spike`)

Find out whether an approach can work: ground the prior art, build a time-boxed throwaway prototype, prove what it does, and evaluate strengths, weaknesses, and failure modes.

## Router-Only Invocation Boundary

> **ROUTER-ONLY:** This playbook MUST ONLY be invoked by `rc-router` (`/rcstack`) after profile selection, risk-tier classification, and model resolution. Never execute this playbook standalone or bypass `rc-router`.

The router hands over the profile, the tier, the resolved role-to-model route, the reviewer, and the branch state. If any of these is missing, stop and return to `rc-router`.

## Do NOT Use When

- The question can be answered from sources without building anything — use `research-report`.
- The approach is already chosen and the result will be kept — use `feature-build` under the engineering profile.
- The goal is a quick UI or code experiment with no viability question — use `vibe-iterate` under the engineering profile.
- Only prior art is wanted — run `rc-ground` on its own through `rc-router`.

## Workflow Phases

1. **Prior art** — `rc-ground`: `deep_grounding` surveys existing solutions, documentation, and known limits into a Research Brief per `contracts/research-brief.md`.
2. **Spike plan** — `systems_research` writes a compact spike plan per `contracts/spec.md`: the hypothesis, what would falsify it, a hard time box, success and kill criteria as Acceptance Criteria, and production quality under Non-Goals.
3. **Prototype** — `primary_builder` builds the smallest throwaway prototype that can test the hypothesis, in an isolated branch or directory. When the spike runs untrusted code, touches infrastructure, or handles credentials, the router binds `security_builder` instead and the run is Tier 3. The building role is the builder of record and emits a Work Receipt per `contracts/work-receipt.md`. Stop when the time box ends, finished or not.
4. **Verify** — `rc-verify`: re-run the commands and measurements behind every claimed result so each number is reproducible. An unreproducible result is reported as unproven.
5. **Evaluate** — `systems_research` states strengths, weaknesses, and failure modes against the plan's criteria, and a verdict of viable, not viable, or needs more evidence, each tied to recorded evidence.
6. **Critique** — `rc-audit`: the `independent_reviewer` attacks the verdict in a fresh context: does the evidence support it, and what did the prototype not test? It emits Audit Findings per `contracts/audit-findings.md`. Every `Blocker` and `Major` returns to phase 5, or to phase 3 when more evidence is needed.
7. **Review Map** — `rc-review-map`: emit the Review Map per `contracts/review-map.md` as the decision summary and append the telemetry row.

The prototype is never promoted. A viable result returns to `rc-router` for a build playbook.

## Exit Gate & Definition of Done

- A verdict exists with the evidence for it, and with what was not tested stated explicitly.
- `rc-verify` passes: every claimed result is reproduced, with commands and exit codes in a Work Receipt.
- `rc-audit` returns `APPROVE` with zero open `Blocker` findings; every `Major` is fixed or listed for human approval.
- A Review Map is emitted and one telemetry row is appended.
- The time box was respected, and the prototype is marked as disposable.
