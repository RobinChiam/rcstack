---
name: viability-spike
profile: rcstack-research
entry_mode: router_only
default_tier: 2
required_assurance: A2
required_capabilities:
  - deep_grounding
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

# Viability Spike

Answers "could this approach work?" with prior art, a time-boxed throwaway prototype, and a report of strengths, weaknesses, and failure modes.

## Router-Only Invocation Boundary

> **ROUTER-ONLY:** This playbook MUST ONLY be invoked by `rc-router` (`/rcstack`) after profile selection, risk-tier classification, and live model resolution. Never execute this playbook standalone or bypass `rc-router`.

## Do NOT Use When

- The answer needs reading, not building — use `research-report`.
- The prototype is meant to be kept — use `feature-build`.
- You are exploring look and feel with no written verdict needed — use `vibe-iterate`.

## Workflow Phases

1. **TRIAGE** — `rc-router` has opened state with `rc-state.mjs init`. Write down one viability
   question, its time box, and the kill criteria: the result that means "no".
2. **RESEARCHING** — `deep_grounding` surveys prior art into `contracts/research-brief.md`:
   existing solutions, failed attempts, and known limits, each cited.
3. **PLANNING** — the spike plan is a short `contracts/spec.md`: the smallest prototype that can
   answer the question, the throwaway location it lives in (never a production path), what will
   be measured, and the time box.
4. **EXECUTING** — `primary_builder` builds the prototype inside the time box. Use
   `security_builder` instead when the prototype exercises auth, sandboxing, containers, or
   another Tier 3 concern. The builder commits and returns `contracts/work-receipt.md`.
5. **VERIFYING** — run the prototype's verify command: it builds, its measurement runs, and the
   result reproduces from a clean checkout. Admit the receipt through `rc-receipt.mjs`
   (`rc-state.mjs transition --admit-receipt`).
6. **AUDITING** — the `independent_reviewer` challenges the evidence in a fresh context: does the
   prototype answer the question, are the measurements sound, which failure modes were never
   exercised? It returns `contracts/audit-findings.md`; a `Blocker` returns to `EXECUTING`. Then
   admit the integrated receipt with the open finding counts.
7. **AWAITING_REVIEW** — write the report into `contracts/review-map.md`: the verdict (viable, not
   viable, or viable with conditions), strengths, weaknesses, failure modes, and the cost to
   build it for real. Stop for the human.
8. **SHIPPED** — after approval, append the telemetry row with `rc-log.mjs` and close the state.
   The prototype is discarded or archived; promoting it is a new `feature-build`.

## Exit Gate & Definition of Done

- The viability question has an explicit verdict tied to the kill criteria set in triage.
- The verify command exits `0` and the measurements reproduce; the receipt was `ADMITTED` by
  `rc-receipt.mjs`.
- A reviewer that is not the builder audited in a fresh context; `0` open `Blocker`s.
- Achieved assurance is at least `A2`, or the report carries an `ASSURANCE GAP` banner.
- The report lists strengths, weaknesses, and failure modes, including ones not tested.
- No prototype code reached a production path, and the telemetry row was appended by `rc-log.mjs`.
