---
name: socratic-session
profile: rcstack-study
entry_mode: router_only
default_tier: 1
required_skills:
  - rc-verify
required_roles:
  - vibe_executor
contracts:
  - contracts/work-receipt.md
---

# Socratic Session (`study/socratic-session`)

Guided questioning that stress-tests the learner's mental model. The learner does the thinking; answers are never given away prematurely.

## Router-Only Invocation Boundary

> **ROUTER-ONLY:** This playbook MUST ONLY be invoked by `rc-router` (`/rcstack`) after profile selection, risk-tier classification, and model resolution. Never execute this playbook standalone or bypass `rc-router`.

The router hands over the profile, the tier, the resolved role-to-model route, and the branch state. If any of these is missing, stop and return to `rc-router`.

## Do NOT Use When

- The learner has not met the topic yet and needs it explained — use `topic-deep-dive`.
- The goal is memorizing facts on a schedule — use `recall-and-drill`.
- The learner asks for the answer outright to a quick factual question — answer directly at Tier 0.
- The session would mean working through graded or exam material for the learner — stop and return to `rc-router` for Tier 3 classification.

## Workflow Phases

1. **Frame** — the learner states the topic and explains their current understanding in their own words. `vibe_executor` picks one to three target concepts and tells the learner what the session will probe.
2. **Question loop** — `vibe_executor` asks one question at a time and waits. When the learner is stuck, escalate hints in order: a nudge, a narrower question, a worked analogy. Give the answer only after a genuine attempt, or when the learner explicitly asks for it.
3. **Stress-test** — probe the model with edge cases, counter-examples, and "what would change if" variations until it either holds or breaks. Name each misconception plainly when it surfaces.
4. **Verify** — `rc-verify`: check every factual statement made during the session against the grounded notes or their sources. Retract or flag anything that cannot be supported.
5. **Receipt** — `vibe_executor` emits one Work Receipt per `contracts/work-receipt.md`: concepts that held, misconceptions found, the verification evidence, and follow-up drills to hand to `recall-and-drill`.

## Exit Gate & Definition of Done

- The learner attempted every question before any answer was revealed.
- `rc-verify` passes: every factual statement from the session is supported by the notes or sources, or was retracted, as recorded in the Work Receipt.
- The Work Receipt lists the misconceptions found and the follow-up for each.
- No graded work was completed on the learner's behalf.
