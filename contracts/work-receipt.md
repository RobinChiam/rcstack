# Contract: Work Receipt

**Produced by:** every builder subagent when it finishes a slice, and by the main thread for the
integrated diff. **Consumed by:** `scripts/rc-receipt.mjs`, the 4-point admission gate.

A receipt is the only thing a subagent hands back. It is a claim the gate checks against git, not
a summary to be trusted. Prose outside the receipt is ignored.

## Format

One mapping in the strict YAML subset (a JSON object is also accepted). Return it as a fenced
`yaml` block or a bare file.

```yaml
slice: "S1 telemetry appender"
base_sha: "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
head_sha: "9f1c2ab77d0e4c1f8a3b5d6e7f8091a2b3c4d5e6"
files_touched:
  - scripts/rc-log.mjs
  - tests/rc-log.test.mjs
verify_cmd: "node scripts/verify.mjs && node --test tests/*.test.mjs"
verify_exit_code: 0
checks_passed:
  - mechanical
  - behavioral
audit_blockers: null
audit_majors: null
assumptions:
  - "Telemetry rows stay on the local machine."
review_hotspot:
  - "scripts/rc-log.mjs:88"
```

## Fields

| Field | Type | Meaning |
| :--- | :--- | :--- |
| `slice` | one-line string | The scope this receipt owns. |
| `base_sha` | quoted commit SHA | Commit the slice started from. |
| `head_sha` | quoted commit SHA | Commit containing the finished slice. |
| `files_touched` | non-empty list of repo-relative paths | Exactly the files changed between the two commits. |
| `verify_cmd` | string | The command that was actually run on `head_sha`. |
| `verify_exit_code` | integer | Its real exit code. |
| `checks_passed` | subset of `mechanical`, `behavioral`, `hardened` | Check classes that ran and passed. |
| `audit_blockers` | integer `>= 0` or `null` | Open `Blocker` findings; `null` until an independent audit has run. |
| `audit_majors` | integer `>= 0` or `null` | Open `Major` findings; `null` until an independent audit has run. |
| `assumptions` | list of strings (`[]` if none) | What the builder took for granted. |
| `review_hotspot` | 1-2 `file:line` anchors | Where a human should look first; each file is in `files_touched`. |

All eleven fields are required. Unknown fields are rejected. Always double-quote SHAs.

`checks_passed` classes: **mechanical** — format, lint, static, and type checks; **behavioral** —
automated tests covering the changed paths; **hardened** — targeted edge-case, security, or
runtime proof.

## Admission

```bash
node scripts/rc-receipt.mjs --receipt <file|-> --repo <path> [--allowed-paths <glob,glob>]
```

1. **Schema completeness** — every field present and correctly typed.
2. **Git boundary & cleanliness** — `git diff --name-only <base_sha>..<head_sha>` equals
   `files_touched` exactly, every file is inside `--allowed-paths`, `head_sha` is contained in the
   checked-out branch, and the working tree is clean.
3. **Command proof** — `verify_cmd` is non-empty and `verify_exit_code` is `0`.
4. **Mechanical assurance tagging** — the gate computes the level; nobody claims one:

| Level | Evidence required |
| :--- | :--- |
| `A0` | admitted, but `mechanical` did not pass |
| `A1` | `mechanical` |
| `A2` | `A1` + `behavioral` + `audit_blockers` is `0` |
| `A3` | `A2` + `hardened` + `audit_majors` is `0` |

The gate prints JSON and exits `0` on `ADMITTED`, `1` on `REJECTED` with every failure reason.

## Rules

- A builder never audits itself. Its own receipt carries `audit_blockers: null` and
  `audit_majors: null`, so it tops out at `A1`. Only the main thread writes audit counts, after the
  `independent_reviewer` has returned `contracts/audit-findings.md`.
- Never write `0` for an audit that did not happen, and never list a check class that did not run.
- A **slice** receipt covers one slice's commits. An **integrated** receipt runs from the task's
  base commit to the current `HEAD`, and is the only kind that sets a task's achieved assurance.
  A commit that lands afterwards makes that evidence stale, and the assurance returns to `A0`.
- Commit the work and leave the tree clean before writing the receipt.
- A rejected receipt is not negotiated. Fix the work or the receipt and submit it again.
