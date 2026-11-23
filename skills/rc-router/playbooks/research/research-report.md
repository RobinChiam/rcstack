---
name: research-report
profile: rcstack-research
entry_mode: router_only
default_tier: 2
required_assurance: A2
required_capabilities:
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

# Research Report

Produces a cited decision report from a multi-source investigation, a structured synthesis, and an adversarial critique.

## Router-Only Invocation Boundary

> **ROUTER-ONLY:** This playbook MUST ONLY be invoked by `rc-router` (`/rcstack`) after profile selection, risk-tier classification, and live model resolution. Never execute this playbook standalone or bypass `rc-router`.

## Do NOT Use When

- The question can only be answered by building something — use `viability-spike`.
- The aim is to learn a topic rather than decide something — use `topic-deep-dive`.
- A single fact is needed — ask `rc-router` for a Tier 0 lookup.

## Workflow Phases

1. **TRIAGE** — `rc-router` has opened state with `rc-state.mjs init`. State the decision to be
   made, the options on the table, what evidence would change the answer, and the git repository
   the report lives in.
2. **RESEARCHING** — multi-source investigation. `deep_grounding` gathers and curates the sources;
   `systems_research` analyzes them from first principles. Together they produce
   `contracts/research-brief.md`: dated, cited facts and every conflict between sources.
3. **PLANNING** — `architect_blueprint` writes the synthesis plan as `contracts/spec.md`: the
   report outline, the claims each section must support, and acceptance criteria (every claim
   cited, every option compared on the same criteria).
4. **EXECUTING** — `architect_blueprint` writes the synthesis into the report, commits it, and
   returns `contracts/work-receipt.md`.
5. **VERIFYING** — run the report repository's verify command. Mechanical: structure matches the
   outline, links and citation anchors resolve. Behavioral: every claim traces to a fact in the
   brief and every cited source was opened. Admit the receipt through `rc-receipt.mjs`
   (`rc-state.mjs transition --admit-receipt`).
6. **AUDITING** — the `independent_reviewer` writes an adversarial devil's-advocate critique in a
   fresh context: argue the opposite conclusion, find the weakest evidence, the missing
   alternative, and every overclaim. It returns `contracts/audit-findings.md`. An unsupported
   conclusion is a `Blocker` and returns to `EXECUTING`. Then admit the integrated receipt with
   the open finding counts.
7. **AWAITING_REVIEW** — deliver the cited decision report with `contracts/review-map.md`: the
   recommendation, the strength of the evidence behind it, and the conditions for revisiting it.
8. **SHIPPED** — after approval, append the telemetry row with `rc-log.mjs` and close the state.

## Exit Gate & Definition of Done

- Every claim in the report cites a source a reader can open; inference is labeled as inference.
- The verify command exits `0`; the receipt was `ADMITTED` by `rc-receipt.mjs`.
- A reviewer that is not the author argued against the conclusion in a fresh context; `0` open
  `Blocker`s, and each critique point is answered or accepted in the ledger.
- Achieved assurance is at least `A2`, or the Review Map carries an `ASSURANCE GAP` banner.
- The report ends with a recommendation and the conditions under which it should be revisited.
- The Review Map was delivered and the telemetry row was appended by `rc-log.mjs`.
