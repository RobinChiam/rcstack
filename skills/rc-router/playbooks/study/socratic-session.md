---
name: socratic-session
profile: rcstack-study
entry_mode: router_only
default_tier: 1
required_assurance: A0
required_capabilities:
  - vibe_executor
contracts: []
---

# Socratic Session

Stress-tests a learner's mental model through guided questions, without giving the answer away early.

## Router-Only Invocation Boundary

> **ROUTER-ONLY:** This playbook MUST ONLY be invoked by `rc-router` (`/rcstack`) after profile selection, risk-tier classification, and live model resolution. Never execute this playbook standalone or bypass `rc-router`.

## Do NOT Use When

- The learner wants an explanation or written notes — use `topic-deep-dive`.
- The learner wants graded recall practice on known material — use `recall-and-drill`.
- The question is a quick factual lookup — ask `rc-router` for a Tier 0 answer.

## Workflow Phases

1. **Frame** — name the idea under test and ask the learner to state it in their own words.
2. **Probe** — `vibe_executor` asks one question at a time, each smaller than the last:
   definition, mechanism, prediction, edge case, counterexample.
3. **Withhold** — never give the answer away prematurely. When the learner is stuck, offer a hint
   that narrows the question, not the conclusion. Reveal only when the learner asks to stop or two
   narrowed hints have failed.
4. **Stress-test** — push the model where it should break: limits, inversions, and analogies that
   mislead. Name the exact belief that failed and why it was reasonable to hold.
5. **Close** — the learner restates the model. List what held, what broke, and what to study next,
   as candidates for `topic-deep-dive` or `recall-and-drill`.

## Exit Gate & Definition of Done

- The session produces no artifact, so nothing deterministic can be checked: it is honestly `A0`
  and is never reported higher.
- The learner's final restatement and the list of open gaps were delivered.
- No answer was revealed before the learner attempted it.
- Any factual claim the learner will rely on is marked unverified or routed to `topic-deep-dive`.
- No state file, receipt, Review Map, or telemetry row was created.
