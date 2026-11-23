# Contract: Audit Findings

**Produced by:** the `independent_reviewer`, during `AUDITING`, in a fresh context.
**Consumed by:** `rc-router`, which fixes or dismisses each finding and records the outcome in the
Review Map's Cross-Model Audit Ledger.

The reviewer is a different model from the builder and sees only the diff, the spec, and the
repo's rules. It does not see the builder's reasoning. It reports; it never edits.

## Template

```markdown
# Audit Findings: <change>

## Metadata

- builder_model: <model that produced the diff>
- reviewer_model: <model that reviewed it — must differ from builder_model>
- fresh_context: true
- diff_scope: <base_sha>..<head_sha> (<n> files)

## Findings

### Blocker

- `path/to/file.ext:42`
  - impact: <what breaks, for whom, under what input>
  - concrete_fix: <the specific change that resolves it>

### Major

- `path/to/file.ext:88`
  - impact: <...>
  - concrete_fix: <...>

### Nit

- `path/to/file.ext:120`
  - impact: <...>
  - concrete_fix: <...>

## Verdict

APPROVE | CHANGES_REQUESTED
```

## Severity

- **Blocker** — wrong behavior, data loss, a security hole, a broken invariant, or an unmet
  acceptance criterion. The change cannot ship.
- **Major** — a real defect or risk that needs fixing but does not make the change wrong for its
  stated purpose: a missing failure-mode test, a fragile edge, a misleading contract.
- **Nit** — style, naming, and small clarity improvements. Never blocks.

## Rules

- Metadata is mandatory. `fresh_context` must be `true`, and `reviewer_model` must not equal
  `builder_model`; otherwise the audit does not count.
- Group findings strictly under `Blocker`, `Major`, and `Nit`. Write `None.` under an empty group.
- Every finding has an exact `file:line`, an `impact`, and a `concrete_fix`. "Consider improving"
  is not a finding.
- Verdict is `CHANGES_REQUESTED` when any `Blocker` is open (Tier 3: any `Blocker` or `Major`);
  otherwise `APPROVE`.
- One audit has one reviewer. A fallback reviewer replaces an unreachable primary; it is never
  added as a second opinion.
- The reviewer does not modify files. Fixes go back through `EXECUTING` to a builder.
