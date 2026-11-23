---
name: topic-deep-dive
profile: rcstack-study
entry_mode: router_only
default_tier: 2
required_assurance: A2
required_capabilities:
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

# Topic Deep Dive

Builds durable, cited notes and a study guide for a topic, grounded in sources and fact-audited by an independent reviewer.

## Router-Only Invocation Boundary

> **ROUTER-ONLY:** This playbook MUST ONLY be invoked by `rc-router` (`/rcstack`) after profile selection, risk-tier classification, and live model resolution. Never execute this playbook standalone or bypass `rc-router`.

## Do NOT Use When

- The material is already understood and needs practice — use `recall-and-drill`.
- The learner wants to be questioned rather than taught — use `socratic-session`.
- The aim is a decision or recommendation, not understanding — use `research-report`.

## Workflow Phases

1. **TRIAGE** — `rc-router` has opened state with `rc-state.mjs init`. Fix the topic's scope, the
   learner's starting point, and the git repository the notes live in, so receipts can bind the
   diff.
2. **RESEARCHING** — `deep_grounding` ingests the sources, together with its paired model and
   companion tool when the profile binds them, and curates citations into
   `contracts/research-brief.md`: every fact with its exact page, section, or timestamp, and weak
   or conflicting sources flagged.
3. **PLANNING** — `architect_blueprint` writes `contracts/spec.md` as the note structure and study
   guide: concept order, prerequisites, what each note must let the learner do, and self-test
   questions as acceptance criteria.
4. **EXECUTING** — `systems_research` writes the first-principles walkthrough into the notes, one
   section per slice, every claim citing the brief. It commits and returns
   `contracts/work-receipt.md`.
5. **VERIFYING** — run the notes repository's verify command. Mechanical: structure, links, and
   citation anchors resolve. Behavioral: each cited location was opened and contains the claim,
   and each self-test question is answerable from the notes. Admit receipts through
   `rc-receipt.mjs` (`rc-state.mjs transition --admit-receipt`).
6. **AUDITING** — the `independent_reviewer` performs a source and citation fact-audit in a fresh
   context: it opens the sources, checks each claim, and hunts for misconceptions and unsupported
   leaps, returning `contracts/audit-findings.md`. A wrong or unsupported claim is a `Blocker` and
   returns to `EXECUTING`. Then admit the integrated receipt with the open finding counts.
7. **AWAITING_REVIEW** — synthesize `contracts/review-map.md`, ordering the notes most likely to
   mislead first, and stop for the learner.
8. **SHIPPED** — after approval, append the telemetry row with `rc-log.mjs`, close the state, and
   suggest `recall-and-drill` on the finished notes.

## Exit Gate & Definition of Done

- Every factual claim in the notes cites a source location recorded in the brief.
- The verify command exits `0`; every receipt was `ADMITTED` by `rc-receipt.mjs`.
- A reviewer that is not the author audited the citations in a fresh context; `0` open `Blocker`s.
- Achieved assurance is at least `A2`. If the notes repository has no citation or structure check,
  the Review Map carries an `ASSURANCE GAP` banner instead of a claim of `A2`.
- Each self-test question in the study guide can be answered from the notes alone.
- The Review Map was delivered and the telemetry row was appended by `rc-log.mjs`.
