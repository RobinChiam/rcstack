---
name: recall-and-drill
profile: rcstack-study
entry_mode: router_only
default_tier: 1
required_skills:
  - rc-verify
required_roles:
  - primary_builder
  - vibe_executor
contracts:
  - contracts/work-receipt.md
---

# Recall and Drill (`study/recall-and-drill`)

Convert grounded notes into active-recall material: flashcards, edge-case quizzes, and a spaced-repetition schedule, then run a first drill round.

## Router-Only Invocation Boundary

> **ROUTER-ONLY:** This playbook MUST ONLY be invoked by `rc-router` (`/rcstack`) after profile selection, risk-tier classification, and model resolution. Never execute this playbook standalone or bypass `rc-router`.

The router hands over the profile, the tier, the resolved role-to-model route, and the branch state. If any of these is missing, stop and return to `rc-router`.

## Do NOT Use When

- No grounded, cited notes exist for the topic yet — use `topic-deep-dive` first.
- The learner wants to reason through a concept, not memorize it — use `socratic-session`.
- The request is a single quick question — answer directly at Tier 0.
- The material is an exam, a submission, or graded work — stop and return to `rc-router` for Tier 3 classification.

## Workflow Phases

1. **Check inputs** — confirm that grounded notes with citations exist for the topic. If they do not, stop and return to `rc-router`.
2. **Build the deck** — `primary_builder` writes flashcards with one fact per card, each pointing to the note anchor it came from, plus edge-case quiz questions and a spaced-repetition schedule with concrete review dates.
3. **Drill** — `vibe_executor` runs one drill round: ask, wait for the learner's answer, then reveal and explain. Log every miss and adapt the order and difficulty to performance.
4. **Verify** — `rc-verify`: every card traces to a note anchor, every answer matches the notes, no two cards test the same fact, and every schedule date is valid and in the future.
5. **Receipt** — `primary_builder` emits one Work Receipt per `contracts/work-receipt.md`: deck size, topic coverage, the verification evidence, and the weak areas the drill exposed.

## Exit Gate & Definition of Done

- A deck, a quiz set, and a dated schedule exist, each item traceable to the grounded notes.
- `rc-verify` passes, with the checks and results recorded in the Work Receipt.
- Missed items from the drill round are scheduled for earlier review.
- No card states a fact that the notes do not support.
