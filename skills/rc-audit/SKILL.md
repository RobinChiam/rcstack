---
name: rc-audit
description: Run a fresh-context cross-model review enforcing reviewer != builder and emitting Blocker/Major/Nit findings.
version: 0.1.0
entry_mode: router_dispatched
role: independent_reviewer
invokes_contracts:
  - contracts/audit-findings.md
---

# rc-audit

## Single Job

Review finished work in a fresh context with a model different from the builder and return Blocker, Major, and Nit findings with a verdict.

## When to Use

- `rc-router` dispatches the audit phase of a Tier 2 or Tier 3 playbook.
- A fix for earlier findings needs a re-audit of the delta.
- The user explicitly asks for an independent, cross-model review of a change or artifact.

## Do NOT Use When

- Do NOT self-trigger this skill autonomously as part of a multi-step workflow outside `rc-router` (`/rcstack`). Run directly only when explicitly invoked by the user or dispatched by `rc-router`.
- The reviewing model is the model that built the work — refuse and report; self-review is never an audit.
- This context already holds the builder's conversation or reasoning — it is not fresh; ask for a fresh dispatch.
- The question is only whether commands pass — use `rc-verify`.
- The goal is a repo-wide hygiene report — use `rc-doctor`.
- A finding needs fixing — report it; the builder fixes, and the fix is re-audited.

## Procedure

Contract paths are relative to the rcstack root: the real path of this skill's directory, two levels up.

1. Check the preconditions before reading the work: the handoff names a `builder_model` and a `reviewer_model`, the two differ when compared without regard to case or spacing, and this context contains none of the builder's conversation. If any check fails, stop and return "audit refused" with the reason. Issue no findings.
2. Accept only these inputs: the Spec or stated intent, the diff scope or artifact, and the verification evidence with commands and exit codes. Ask for anything missing instead of inferring it.
3. Read the Spec first and form expectations. Then read the whole diff or artifact, every changed line.
4. Review in this order:
   - correctness against each Acceptance Criterion;
   - failure modes and edge cases;
   - security and data safety — at Tier 3: trust boundaries, abuse cases, secrets, destructive operations, and dry-run behaviour;
   - verification gaps: claims without evidence, tests that cannot fail;
   - scope beyond the Spec, and conflicts with `docs/decisions.md` or repo law;
   - clarity.
   For study and research artifacts, check that each cited passage supports its claim, and state the strongest counter-argument.
5. Reproduce where it is cheap: re-run a verification command or re-open a citation rather than trusting the receipt.
6. Write each finding with an exact `file:line`, a concrete `impact`, and a `concrete_fix`, classified as `Blocker`, `Major`, or `Nit`. Drop findings that cannot be made specific.
7. Set the verdict: `CHANGES_REQUESTED` while any Blocker or Major is open, otherwise `APPROVE`.
8. Fill `contracts/audit-findings.md` completely, with `fresh_context: true`, and return it. Do not edit the audited work.

## Definition of Done

- `reviewer_model` differs from `builder_model` and both are recorded, or the audit was refused and no findings were issued.
- Every finding has a location, an impact, and a concrete fix, and all three severity groups are present (`None` where empty).
- The verdict matches the open findings.
- The reviewer changed nothing in the audited work.
