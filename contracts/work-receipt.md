# Contract: Work Receipt

Compact, evidence-backed proof of one execution phase. Every subagent or build phase emits exactly
one, and nothing counts as done without it.

- **Produced by:** any role that changes files or completes a phase.
- **Consumed by:** `rc-audit` (verification evidence only), `rc-review-map`, and `rc-state`.

## Required Fields

| Field | Requirement |
| :--- | :--- |
| `task_id` | Stable phase id: `<branch-slug>/<NN>-<phase-name>`. |
| `role` | The abstract role that did the work. |
| `model_used` | The model that actually ran, not the one that was planned. |
| `risk_tier` | `0`-`3`, as classified by `rc-router`. |
| `branch` | Git branch, or `n/a` outside a repository. |
| `commit_or_diff_scope` | Commit SHA(s), a diff range, or the exact list of files covered. |
| Summary of Changes | Concise bullets with exact file paths, `path:line` where relevant. |
| Verification Evidence | Exact commands run, their exit codes, and a short pass/fail stdout summary. |
| Assumptions & Trade-offs | Non-obvious decisions that need human sign-off. `None` if empty. |
| Known Risks / Follow-ups | Anything deferred, untested, or uncovered. `None` if empty. |

## Template

```markdown
# Work Receipt: <task_id>

## Metadata
- **task_id:** <branch-slug>/<NN>-<phase-name>
- **role:** <abstract role>
- **model_used:** <model that actually ran>
- **risk_tier:** <0-3>
- **branch:** <branch>
- **commit_or_diff_scope:** <sha | sha..sha | file list>

## Summary of Changes
- `<path>:<line>` — <what changed and why>

## Verification Evidence
| Command | Exit Code | Result |
| :--- | :--- | :--- |
| `<exact command>` | <code> | <PASS or FAIL, plus a one-line stdout summary> |

## Assumptions & Trade-offs
1. <Decision that needs human sign-off, and the alternative not taken>

## Known Risks / Follow-ups
- <Deferred, untested, or uncovered item>
```

## Rules

- No hand-waving: "tests pass" without a command and an exit code is not evidence.
- Report failures as failures. A receipt with a failing command is valid; a hidden one is not.
- Commands that were not run are listed under Known Risks / Follow-ups, never implied.
- One phase, one receipt. Reference earlier receipts by `task_id` instead of repeating them.
