---
name: rc-retro
description: Analyzes local telemetry and turns it into concrete, evidence-backed tuning diffs for profiles and skills.
version: 0.1.0
entry_mode: standalone_or_router
capability: retrospective
invokes_contracts:
  - contracts/telemetry-event.schema.json
invokes_scripts:
  - scripts/verify.mjs
---

# rc-retro

## Single Job

Turn the telemetry of past runs into specific proposed diffs to profiles and skills, each backed by the rows that justify it.

## When to Use

- Enough runs have accumulated to compare (a useful floor is about ten rows for the thing compared).
- A capability, reviewer, or playbook seems to underperform and the human wants evidence.
- On a regular cadence, to keep routing matched to what actually works.

## Do NOT Use When

- There is a task to do — use `rc-router`. A retro never builds, fixes, or reviews work.
- You want to apply a routing change immediately — a retro proposes diffs; the human applies them.
- The evidence is one bad run. One row is an anecdote; say so and stop.
- A repository's health is the question — use `rc-doctor`. Machine setup — use `rc-setup`.

## Procedure

1. **Load telemetry.** Read `~/.rcstack/runtime/telemetry.jsonl`, one JSON object per line, in
   the shape of `contracts/telemetry-event.schema.json`. Keep historical rows readable as recorded;
   count and skip only malformed lines and report how many were skipped. Never edit or rewrite the
   file: it is append-only.
2. **Fix the window and the question.** State the date range, the row count, and what is being
   compared. If the sample is too small to support a conclusion, say so and stop.
3. **Compute the signals,** per profile, playbook, builder, and reviewer:
   - **Assurance gaps:** runs where `achieved_assurance` is below `required_assurance`, and which
     evidence was missing.
   - **Verify churn:** the distribution of `verify_attempts`. High counts point at weak specs or
     a builder mismatched to the work.
   - **Audit signal:** per reviewer, `audit_accepted` against `audit_dismissed` on non-degraded
     audited runs only. Many dismissed findings mean noise; near-zero accepted findings on risky
     work mean a rubber stamp. A row with `degraded_single_harness: true` supplies no independent
     reviewer evidence: even if a historical degraded row lists reviewers or audit counts, exclude
     those fields from reviewer metrics and independent-audit totals.
   - **Escalations:** `escalated_from_tier` set means triage under-classified; look for the path
     patterns that should have matched earlier.
   - **Degraded runs and overrides:** how often `degraded_single_harness` or `overridden` is true,
     and for which capability or gate. Count degraded rows (including historical ones) here rather
     than as audited runs.
4. **Separate signal from noise.** For each pattern give the count, the denominator, and the rows.
   Label a pattern with thin evidence as a hypothesis, not a finding.
5. **Write concrete tuning diffs.** Every recommendation is a unified diff against a real file:
   a binding, chain, or tier gate in `~/.rcstack/profiles/<profile>.yaml`; a `tier3_path_patterns`
   entry; or a step in a skill or playbook in the source checkout. No diff, no recommendation.
6. **Respect the invariants.** A proposal never weakens `reviewer != builder`, never enables
   self-review, never moves a reviewer-only model into a builder capability, and never lowers a
   tier's assurance floor. Changing a guardrail needs a decision entry, which the proposal drafts.
7. **Validate before proposing.** Apply each profile diff to a scratch copy and run
   `node ~/.rcstack/dist/scripts/verify.mjs --profile <scratch copy>`. Drop any diff that fails.
8. **Deliver the retro:** window and sample size, findings ranked by impact, one diff per finding
   with its evidence, the hypotheses that need more data, and what to measure next time. Changes
   to skills and playbooks in the source go through `rc-router` like any other change.

## Definition of Done

- The window, row count, and number of skipped lines are stated.
- Every finding cites its count, denominator, and rows.
- Every recommendation is a concrete diff, and every profile diff passed `verify.mjs --profile`.
- No proposal weakens `reviewer != builder` or an assurance floor, and degraded rows (including
  historical ones) were excluded from independent reviewer evidence.
- Nothing was applied: profiles, skills, and `telemetry.jsonl` are unchanged.
