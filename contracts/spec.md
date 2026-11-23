# Contract: Spec

The merge-ready structural blueprint. A builder who reads only this document and the files it
cites must be able to implement the change, and a reviewer must be able to judge the result
against it.

- **Produced by:** `architect_blueprint` (via `rc-architect`), or the role a playbook names for a
  compact spec (root-cause spec, refactor plan, cure plan, spike plan, outline).
- **Consumed by:** builder roles, `rc-verify` (Verification Plan), and `independent_reviewer`.

## Required Fields

| Field | Requirement |
| :--- | :--- |
| Problem Statement | What is wrong or missing, for whom, and why it matters now. Cite the Research Brief. |
| Non-Goals | What this change deliberately does not do. At least one entry. |
| Data Shapes & Interfaces | Exact types, schemas, signatures, CLI flags, file formats, or document structures being added or changed. |
| Module Boundaries | Which files or modules change, which must not, and who owns each responsibility. |
| Failure Modes | How it can fail, how each failure is detected, and the intended behaviour. |
| Acceptance Criteria | Numbered, independently checkable statements of done. |
| Verification Plan | The exact command or check that proves each Acceptance Criterion. |

## Template

```markdown
# Spec: <title>

- **Author:** <abstract role> (<model that actually ran>)
- **Date:** <YYYY-MM-DD>
- **Profile / Tier / Playbook:** <profile> | T<0-3> | <domain>/<playbook>
- **Inputs:** <Research Brief reference, issue, or user request>

## Problem Statement
<What is wrong or missing, for whom, and why now. Cite facts by number.>

## Non-Goals
- <Explicitly out of scope>

## Data Shapes & Interfaces
<Types, schemas, signatures, flags, formats, or outline. Use code blocks for exact shapes.>

## Module Boundaries
| File / Module | Change | Responsibility |
| :--- | :--- | :--- |
| `<path>` | add / modify / must not change | <what it owns> |

## Failure Modes
| Failure | Detection | Intended Behaviour |
| :--- | :--- | :--- |
| <What goes wrong> | <How it is noticed> | <What the system does> |

## Acceptance Criteria
1. <Independently checkable statement>
2. <...>

## Verification Plan
| Criterion | Command or Check | Expected Result |
| :--- | :--- | :--- |
| AC1 | `<exact command>` | <exit code and observable result> |
```

## Rules

- Every Acceptance Criterion maps to at least one row of the Verification Plan.
- Unknowns are written as open questions for the human, never guessed into the design.
- A compact spec may be short, but it keeps all seven sections; write `None` rather than drop one.
- Changes to an approved Spec are appended as dated amendments, not silent edits.
