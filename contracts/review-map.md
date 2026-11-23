# Contract: Review Map

**Produced by:** `rc-router`, at `AWAITING_REVIEW`. **Consumed by:** the human reviewer.
Reusable verbatim as a pull request body.

A Review Map tells a human where to spend attention. It leads with what could be wrong, shows the
evidence for what is claimed right, and never rounds confidence up.

## Template

```markdown
# Review Map: <change>

## Header Bar

Profile: <profile> | Tier: T<n> | Assurance: achieved A<n> vs. required A<n> | Slices: <n> | Verify attempts: <n>

> **ASSURANCE GAP:** achieved A<n> is below the required A<n> because <missing evidence>.
> (Include this banner only when achieved is below required. Never omit it when it is.)

## Executive Delta

- <what changed, in user-visible terms>
- <the most important design choice>
- <what did not change that a reader might assume did>

## Risk-Ranked Reading Order

1. [HIGH] `path/to/file.ext:42` — <why this needs a careful read>
2. [MED] `path/to/other.ext:10` — <what to check>
3. [SKIM] `path/to/generated.ext:1` — <why a glance is enough>

## Assumptions & Tradeoffs Checklist

- [ ] <assumption a builder made, from the Work Receipts> — confirm or reject
- [ ] <tradeoff taken> — <what was given up>

## Cross-Model Audit Ledger

| Finding | Severity | Reviewer | Outcome | Evidence |
| :--- | :--- | :--- | :--- | :--- |
| `file:line` <summary> | Blocker | <reviewer_model> | Fixed in `<sha>` | <test or check> |
| `file:line` <summary> | Nit | <reviewer_model> | Dismissed | <reason> |

Builder: <builder_model> | Reviewer: <reviewer_model> | Fresh context: yes | Verdict: <verdict>

## Verification Matrix

| Check | Command | Result |
| :--- | :--- | :--- |
| Mechanical | `<command>` | exit 0 |
| Behavioral | `<command>` | <n> passed, 0 failed |
| Hardened | `<command>` | <result, or "not run"> |
| Receipts | `rc-receipt.mjs` | <n> admitted, 0 rejected |

## Proposed `docs/decisions.md` Entry

## DEC-NNN — <title>

- **Date:** YYYY-MM-DD
- **Status:** Proposed
- **Decision:** <the durable choice>
- **Rejected Alternative:** <what was not done, and why>
- **Guardrail:** <the check that keeps this true>
```

## Rules

- **Header Bar** reports the achieved assurance computed by `scripts/rc-receipt.mjs`, never an
  estimate. Below the floor, the `ASSURANCE GAP` banner is mandatory and says what evidence is
  missing.
- **Executive Delta** is exactly three bullets.
- **Risk-Ranked Reading Order** lists every changed file once, `[HIGH]` first, then `[MED]`, then
  `[SKIM]`, each with a `file:line` anchor. Tier 3 paths are always `[HIGH]`.
- **Assumptions & Tradeoffs Checklist** carries forward every `assumptions` entry from the
  admitted receipts.
- **Cross-Model Audit Ledger** lists every finding with its outcome. Dismissing a `Blocker` needs
  the human's explicit agreement; record it as an override.
- **Verification Matrix** shows real commands and real results. Write "not run" where that is true.
- **Proposed `docs/decisions.md` Entry** appears when the change makes a durable choice; otherwise
  write "No durable decision."
