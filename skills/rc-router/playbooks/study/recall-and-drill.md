---
name: recall-and-drill
profile: rcstack-study
entry_mode: router_only
default_tier: 1
required_assurance: A1
required_capabilities:
  - primary_builder
  - vibe_executor
contracts: []
---

# Recall and Drill

Turns known material into active-recall flashcards, edge-case quizzes, and a spaced-repetition schedule, then runs the drill.

## Router-Only Invocation Boundary

> **ROUTER-ONLY:** This playbook MUST ONLY be invoked by `rc-router` (`/rcstack`) after profile selection, risk-tier classification, and live model resolution. Never execute this playbook standalone or bypass `rc-router`.

## Do NOT Use When

- The material is not yet understood, or there are no trusted notes — use `topic-deep-dive`.
- The learner wants to reason through open questions — use `socratic-session`.
- A single fact is needed right now — ask `rc-router` for a Tier 0 lookup.

## Workflow Phases

1. **Frame** — the material (notes or sources), what the recall is for, and the time available.
2. **Build the deck** — `primary_builder` writes active-recall flashcards: one idea per card, an
   answer that must come from memory, and a pointer to the source location on every card.
3. **Edge-case quizzes** — questions at the boundaries: where the rule stops working, pairs that
   get confused, cases where intuition is wrong. Each has a worked explanation.
4. **Schedule** — a spaced-repetition schedule: first review within a day, expanding intervals,
   and a lapse resets the card's interval.
5. **Verify** — run a mechanical verify of the deck: every card has a prompt, an answer, and a
   source pointer; no prompt is duplicated; schedule dates are valid and in order.
6. **Drill** — `vibe_executor` runs the session: ask, wait for the answer, reveal, grade, and
   reschedule. It never reveals before the learner has tried.
7. **Confirm** — reply in two lines: the cards and quizzes produced, and the verify result.

## Exit Gate & Definition of Done

- The deck's mechanical verify exits `0`, which is `A1`. With no deck checker available, say so:
  the result is `A0` and the confirmation carries `ASSURANCE GAP`.
- Every card has one idea, an answer, and a source pointer.
- A review schedule exists for every card.
- A card whose fact is in doubt is flagged for `topic-deep-dive`, never silently rewritten.
- No state file, Review Map, or telemetry row was created; Tier 1 skips all three.
