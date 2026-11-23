---
name: rc-retro
description: Monthly telemetry review and stack tuning. Reads the telemetry log, measures first-pass verification, audit findings, overrides and degraded runs per profile, playbook and model, and proposes at most three evidence-backed changes. Use monthly or when the user asks how the stack is performing.
version: 0.1.0
entry_mode: standalone_or_router
role: systems_research
invokes_contracts:
  - contracts/telemetry-event.schema.json
---

# rc-retro

## Single Job

Review a month of telemetry and propose at most three evidence-backed changes to profiles, tiers, playbooks, or checks.

## When to Use

- A month has passed since the last retro, or about twenty new telemetry rows have accumulated.
- A run went badly (a human override, repeated Blockers) and it is unclear whether that is a pattern.
- The user asks how the stack, a model pairing, or a playbook is performing.

## Do NOT Use When

- **Run directly:** for the read-only review and its proposals at any time; this skill changes nothing.
- **Defer to `rc-router`:** to apply any accepted proposal. Edits to profiles, skills, playbooks, or scripts are routed changes, and edits to `profiles/schema.json` or `scripts/verify.mjs` are Tier 3.
- Fewer than five telemetry rows exist — say the data is insufficient instead of guessing.
- The question is about one specific run — read that run's Review Map.
- The concern is repo hygiene rather than routing performance — use `rc-doctor`.

## Procedure

Contract and script paths are relative to the rcstack root: the real path of this skill's directory, two levels up.

1. Read `~/.rcstack/telemetry.jsonl`, or the path the user gives. Validate every row against `contracts/telemetry-event.schema.json`. Count invalid rows and set them aside; never repair or delete them.
2. Select the window, by default the last 30 days by `timestamp`, and state the row count.
3. Compute, per profile, playbook, builder model, and reviewer model: number of runs; first-pass verification rate; mean Blockers, Majors, and Nits per run; human override rate; degraded share; and the share of runs in which the reviewer found at least one Blocker or Major.
4. Treat a segment as a pattern only when it has at least five runs. Label anything smaller as an anecdote.
5. Look for causes: a builder with a low first-pass rate on one playbook; a reviewer pairing that never finds anything; a high override rate that suggests a gate is too strict or is being bypassed; a high degraded share; and tier misclassification in either direction.
6. Propose at most three changes. Each states the evidence in numbers, the exact change (file and field), the expected effect, how the next retro will measure it, and the risk. Typical changes: a profile binding or reviewer pairing, a Tier 3 path pattern, a new deterministic check, or a playbook phase.
7. Present the proposals to the human and apply nothing. An accepted proposal goes through `rc-router`, and its outcome is recorded in `docs/decisions.md` through `rc-state`.
8. Report the retro: date, window, row counts, metrics with the method used to compute them, and each proposal with its status.

## Definition of Done

- The report states the window, the number of rows used, and the number of invalid rows.
- Every metric is computed from the rows by a stated, repeatable method.
- At most three proposals exist, each with evidence, an exact change, and a measure of success.
- No file was modified, including the telemetry log.
