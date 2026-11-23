# Contract: Review Map

The risk-ranked guide a human uses to review a Tier 2 or Tier 3 run in minutes instead of reading
every line. Synthesized from all Work Receipts and the Audit Findings of the run.

- **Produced by:** `rc-review-map`.
- **Consumed by:** the human reviewer; the pull request body in `ship-and-babysit`.

## Required Fields

| # | Section | Requirement |
| :--- | :--- | :--- |
| 1 | Executive Delta | 2-3 lines stating what changed and why. |
| 2 | Risk-Ranked Reading Order | Table ordered High, then Medium, then Low risk, with columns `File / Area`, `Risk`, `Why It Matters`, `Focus Question for Human`. |
| 3 | Assumptions Requiring Approval | Numbered yes/no sign-off items. `None` if empty. |
| 4 | Cross-Model Audit Ledger | Builder model, Reviewer model (`reviewer != builder`), counts of `Blocker / Major / Nit`, and the disposition of every Blocker and Major. |
| 5 | Verification Matrix | Table of commands executed, with columns `Command`, `Result`, `Scope`. |
| 6 | Telemetry Confirmation | Confirmation that 1 JSONL row was appended via `scripts/log-telemetry.mjs`. |

## Template

```markdown
# Review Map: <title>

- **Profile / Tier / Playbook:** <profile> | T<2-3> | <domain>/<playbook>
- **Branch / Scope:** <branch> | <sha..sha>
- **Degraded single harness:** <true | false>

## 1. Executive Delta
<2-3 lines: what changed and why.>

## 2. Risk-Ranked Reading Order
| File / Area | Risk | Why It Matters | Focus Question for Human |
| :--- | :--- | :--- | :--- |
| `<path or area>` | High | <consequence if wrong> | <the one question to answer while reading> |
| `<path or area>` | Medium | <...> | <...> |
| `<path or area>` | Low | <...> | <...> |

## 3. Assumptions Requiring Approval
1. [ ] yes / [ ] no — <assumption or trade-off, and what changes if the answer is no>

## 4. Cross-Model Audit Ledger
- **Builder model:** <model>
- **Reviewer model:** <model, different from the builder>
- **Findings:** Blocker <n> / Major <n> / Nit <n>

| Finding | Severity | Disposition |
| :--- | :--- | :--- |
| <B1 or M1: title> | Blocker / Major | Fixed in <sha> / Accepted by human / Open |

## 5. Verification Matrix
| Command | Result | Scope |
| :--- | :--- | :--- |
| `<exact command>` | PASS / FAIL (exit <code>) | <what it covers> |

## 6. Telemetry Confirmation
- [ ] 1 JSONL row appended via `scripts/log-telemetry.mjs` to `~/.rcstack/telemetry.jsonl`
  (output line: `<the logger's confirmation line>`)
```

## Rules

- Order the reading table by risk, never by file path or commit order.
- Every Blocker and every Major from the Audit Findings appears in the ledger with a disposition.
- If no cross-model audit was possible, say so in the ledger, set the reviewer to `none`, and make
  "cross-model audit not performed" item 1 under Assumptions Requiring Approval.
- The Verification Matrix lists only commands that were actually run, with their real results.
- Do not mark the telemetry box until the logger has printed its confirmation line.
