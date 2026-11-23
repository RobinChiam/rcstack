---
name: feature-build
profile: rcstack-engineering
entry_mode: router_only
default_tier: 2
required_skills:
  - rc-state
  - rc-architect
  - rc-verify
  - rc-audit
  - rc-review-map
required_roles:
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

# Feature Build (`engineering/feature-build`)

The standard delivery track: new or changed behaviour, built to an approved Spec, verified, independently audited, and handed to the human with a Review Map.

## Router-Only Invocation Boundary

> **ROUTER-ONLY:** This playbook MUST ONLY be invoked by `rc-router` (`/rcstack`) after profile selection, risk-tier classification, and model resolution. Never execute this playbook standalone or bypass `rc-router`.

The router hands over the profile, the tier, the resolved role-to-model route, the reviewer, and the branch state. If any of these is missing, stop and return to `rc-router`.

## Do NOT Use When

- Something is broken and the cause is unproven — use `bug-root-cause`.
- Structure changes but behaviour must stay identical — use `refactor-pinned`.
- The work is a prototype, UI tweak, or throwaway experiment — use `vibe-iterate`.
- Any touched path matches a Tier 3 pattern, or the change concerns auth, sandboxing, containers, symlinks, infrastructure, or schema — stop and return to `rc-router`, which selects `security-critical`.
- The change is already built and audited and only needs shipping — use `ship-and-babysit`.

## Workflow Phases

1. **Load state** — `rc-state`: read `docs/decisions.md` and the branch state, then record the goal, profile, tier, and this playbook. Resume from the recorded Next Step if one exists.
2. **Ground and blueprint** — `rc-architect`: `systems_research` grounds the affected code paths in a Research Brief per `contracts/research-brief.md`, then `architect_blueprint` writes the Spec per `contracts/spec.md`. Stop for human approval when the Spec lists open questions or assumptions needing sign-off.
3. **Build** — `primary_builder` implements the approved Spec in small commits with tests alongside, and emits a Work Receipt per `contracts/work-receipt.md`. This role is the builder of record. Anything the Spec does not cover goes back to phase 2, not into the diff.
4. **Verify** — `rc-verify`: run the Spec's Verification Plan plus the repo's lint, type, and test commands. Record whether the first pass succeeded. A failure returns to phase 3.
5. **Audit** — `rc-audit`: the `independent_reviewer` reviews the Spec, the diff, and the verification evidence in a fresh context and emits Audit Findings per `contracts/audit-findings.md`. Every `Blocker` and `Major` returns to phase 3, then phase 4, then a re-audit of the delta.
6. **Review Map** — `rc-review-map`: synthesize all Work Receipts and Audit Findings into a Review Map per `contracts/review-map.md` and append the telemetry row. Then `rc-state` records the outcome and any new decision.

## Exit Gate & Definition of Done

- An approved Spec exists and every Acceptance Criterion maps to passing verification evidence.
- `rc-verify` passes on the final commit, with commands and exit codes in a Work Receipt.
- `rc-audit` returns `APPROVE` with zero open `Blocker` findings; every `Major` is fixed or listed for human approval.
- A Review Map is emitted and one telemetry row is appended.
- The branch state shows all phases complete, or the exact blocker and next step.
