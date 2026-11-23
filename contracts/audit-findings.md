# Contract: Audit Findings

The output of a fresh-context cross-model audit. It exists only when the reviewer is a different
model from the builder and started without the builder's conversation or reasoning.

- **Produced by:** `independent_reviewer` (via `rc-audit`).
- **Consumed by:** the builder of record (to fix), `rc-review-map`, and the human.

## Required Fields

| Field | Requirement |
| :--- | :--- |
| `builder_model` | The model that produced the audited work (the builder of record). |
| `reviewer_model` | The model that reviewed it. MUST differ from `builder_model`. |
| `diff_scope` | Commit range, file list, or artifact path that was audited. |
| `fresh_context: true` | Always `true`. If it cannot be true, no Audit Findings may be issued. |
| Findings | Grouped strictly as `Blocker`, `Major`, `Nit`. Each has `file:line`, `impact`, `concrete_fix`. |
| Verdict | Exactly one of `APPROVE` or `CHANGES_REQUESTED`. |

Severity definitions:

- **Blocker** — wrong, unsafe, or violates the Spec or an invariant. Must be fixed before done.
- **Major** — likely defect, missing verification, or a design flaw with real cost. Must be fixed
  or explicitly accepted by the human in the Review Map.
- **Nit** — style, naming, or minor clarity. Optional.

## Template

```markdown
# Audit Findings: <title of the audited change>

## Metadata
- **builder_model:** <model that produced the work>
- **reviewer_model:** <model that reviewed it; must differ from builder_model>
- **diff_scope:** <sha..sha | file list | artifact path>
- **fresh_context: true**
- **Inputs reviewed:** <Spec, diff, verification evidence>

## Findings

### Blocker
- **B1** — <one-line title>
  - **file:line:** `<path>:<line>`
  - **impact:** <what breaks, for whom, under which conditions>
  - **concrete_fix:** <the specific change to make>

### Major
- **M1** — <one-line title>
  - **file:line:** `<path>:<line>`
  - **impact:** <...>
  - **concrete_fix:** <...>

### Nit
- **N1** — <one-line title>
  - **file:line:** `<path>:<line>`
  - **impact:** <...>
  - **concrete_fix:** <...>

## Verdict
- **Counts:** Blocker <n> / Major <n> / Nit <n>
- **Verdict:** APPROVE | CHANGES_REQUESTED
```

## Rules

- `reviewer_model` equal to `builder_model` invalidates the whole document. Never self-review.
- The verdict is `CHANGES_REQUESTED` while any Blocker or Major is open, and `APPROVE` otherwise.
- Write `None` under an empty severity group; never omit the group.
- Every finding is specific: an exact location, a concrete impact, and a fix the builder can apply.
- The reviewer reports and does not edit the work. Fixes return to the builder, then get re-audited.
