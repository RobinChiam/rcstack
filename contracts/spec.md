# Contract: Spec

**Produced by:** `architect_blueprint`, during `PLANNING`.
**Consumed by:** builders (one slice each), the `independent_reviewer`, and the Review Map.
**Lives at:** `specs/<feature>/spec.md` in the target repository. A sub-spec goes in a
subdirectory of its parent spec's directory, so every directory under `specs/` holds a `spec.md`.

A spec makes the work checkable before it starts. A builder given one slice and this document
needs nothing else to do the job; a reviewer given the diff and this document can say whether the
job was done.

## Template

```markdown
# Spec: <change>

## Problem Statement

<What is wrong or missing today, who it affects, and the observable outcome when it is fixed.>

## Non-Goals

- <tempting adjacent work that is explicitly out of scope>

## Data Shapes & Interfaces

<Types, schemas, CLI flags, file formats, and function signatures that cross a slice boundary.>

## Non-Overlapping File Slices

| Slice | Owns (exact paths or globs) | Depends on | Capability |
| :--- | :--- | :--- | :--- |
| S1 <name> | `src/a.ts`, `src/a.test.ts` | — | `primary_builder` |
| S2 <name> | `src/b/**` | S1 | `primary_builder` |

## Failure Modes

- <how this can break> → <how the design prevents or detects it>

## Acceptance Criteria

- [ ] <observable, testable statement>

## Verification Plan

- Command: `<the repo's canonical verify command>`
- Mechanical: <format, lint, static, and type checks that must pass>
- Behavioral: <tests that cover the changed paths>
- Hardened (Tier 3 only): <edge-case, security, or runtime proof>
```

## Rules

- **Non-Overlapping File Slices**: no path belongs to two slices. Each slice's paths become the
  `--allowed-paths` of its Work Receipt, so a builder that strays outside its slice is rejected.
- A slice touching a path that matches the profile's `tier3_path_patterns` makes the whole run Tier 3.
- **Acceptance Criteria** are observable from outside the code. "Works correctly" is not a criterion.
- **Verification Plan** names real commands. If the repo cannot produce the evidence its tier's
  assurance floor needs, say so here; the run will carry an `ASSURANCE GAP`.
- Tier 3: the human signs off on this spec before any builder starts.
- A sub-spec narrows its parent spec and never contradicts it. Read every parent `spec.md` first.
- The feature's other documents (requirements, planning notes, a research brief) sit beside its
  `spec.md` and nowhere else in the repository, and are committed before the integrated receipt.
  The Review Map is delivered at review as the pull request body, not written into the
  repository. Task state, telemetry, and Work Receipts never go there.
- The spec directory is owned by a slice like any other path: list it under Non-Overlapping File
  Slices, so the commit that writes it passes the receipt gate.
