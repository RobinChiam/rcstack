---
name: rc-review-map
description: Synthesize the Work Receipts and Audit Findings of a Tier 2 or Tier 3 run into a risk-ranked Review Map for the human, then validate and append one telemetry row. Use when rc-router dispatches the closing phase or the user explicitly asks for a Review Map.
version: 0.1.0
entry_mode: router_dispatched
role: router
invokes_contracts:
  - contracts/work-receipt.md
  - contracts/audit-findings.md
  - contracts/review-map.md
  - contracts/telemetry-event.schema.json
---

# rc-review-map

## Single Job

Synthesize the Work Receipts and Audit Findings of a Tier 2 or Tier 3 run into one risk-ranked Review Map and append its telemetry row.

## When to Use

- `rc-router` dispatches the closing phase of a Tier 2 or Tier 3 playbook.
- The `ship-and-babysit` playbook needs a pull request body.
- The user explicitly asks for a Review Map of a completed run whose receipts exist.

## Do NOT Use When

- Do NOT self-trigger this skill autonomously as part of a multi-step workflow outside `rc-router` (`/rcstack`). Run directly only when explicitly invoked by the user or dispatched by `rc-router`.
- The run is Tier 0 or Tier 1 — a Work Receipt is enough; do not add ceremony.
- Work Receipts or Audit Findings are missing — return to `rc-router`; never reconstruct evidence from memory.
- The work still needs reviewing or proving — use `rc-audit` or `rc-verify` first.
- A telemetry row was already appended for this run — never log the same run twice.

## Procedure

Contract and script paths are relative to the rcstack root: the real path of this skill's directory, two levels up.

1. Collect the inputs: every Work Receipt of the run (per `contracts/work-receipt.md`), the latest Audit Findings (per `contracts/audit-findings.md`), the Spec, and the Routing Plan (profile, tier, playbook, builder of record, reviewer, degraded flag). If any is missing, stop.
2. Write the Executive Delta: two or three lines on what changed and why.
3. Build the Risk-Ranked Reading Order, High then Medium then Low. Rank by blast radius, irreversibility, security relevance, audit findings, and weak verification, and give each row one focus question for the human.
4. List Assumptions Requiring Approval as numbered yes/no items, taken from every receipt's Assumptions & Trade-offs and from any Major the human is asked to accept. In a degraded run, item 1 is "cross-model audit not performed".
5. Fill the Cross-Model Audit Ledger: builder model, reviewer model, the counts, and a disposition for every Blocker and Major. Confirm the reviewer differs from the builder. While any Blocker is open, state plainly that the run is not ready.
6. Fill the Verification Matrix from the receipts, with only commands that were actually run and their real results.
7. Log telemetry, once per run. Build one event that satisfies `contracts/telemetry-event.schema.json`: `schema_version`, a UTC `timestamp` (`date -u +%Y-%m-%dT%H:%M:%SZ`), `repo` (basename), `branch`, `profile`, `playbook`, `risk_tier`, `builder_model`, `reviewer_model` (null only at Tier 0/1 or when degraded), `degraded_single_harness`, `first_pass_verify_passed` (from the first `rc-verify` receipt), `audit_blockers`, `audit_majors`, `audit_nits`, `human_override` (true when the human accepted an open finding or waived a gate), and optional `notes`. From the rcstack root, validate it with `node scripts/log-telemetry.mjs --dry-run --json '<event>'`, then append it by running the same command without `--dry-run`.
8. Complete the Review Map per `contracts/review-map.md`, copying the logger's confirmation line into Telemetry Confirmation, and deliver it to the human.

## Definition of Done

- The Review Map has all six sections, with the reading order ranked by risk.
- Every Blocker and Major appears in the ledger with a disposition, and the reviewer differs from the builder or the degraded note is present.
- Exactly one telemetry row was appended for the run, and its confirmation line is recorded.
- Nothing in the map lacks a supporting Work Receipt or finding.
