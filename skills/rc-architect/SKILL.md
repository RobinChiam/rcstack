---
name: rc-architect
description: Produce a merge-ready structural blueprint. Grounds the problem in a Research Brief, then writes a Spec with interfaces, module boundaries, failure modes, acceptance criteria and a verification plan. Use when rc-router dispatches a blueprint phase or the user explicitly asks for a spec.
version: 0.1.0
entry_mode: router_dispatched
role: architect_blueprint
invokes_contracts:
  - contracts/research-brief.md
  - contracts/spec.md
---

# rc-architect

## Single Job

Turn a grounded problem into a merge-ready Spec that a builder can implement and a reviewer can judge without further explanation.

## When to Use

- `rc-router` dispatches the blueprint phase of a playbook such as `feature-build` or `security-critical`.
- The user explicitly asks for a spec, blueprint, or design for a defined change.
- The run's tier sets `require_spec` and no approved Spec exists yet.

## Do NOT Use When

- Do NOT self-trigger this skill autonomously as part of a multi-step workflow outside `rc-router` (`/rcstack`). Run directly only when explicitly invoked by the user or dispatched by `rc-router`.
- The sources have not been read and the problem is not yet understood — use `rc-ground` first.
- The work is Tier 0 or Tier 1 — no Spec is required; do not add ceremony.
- The task is to implement — this skill writes no production code.
- The task is to review an existing design or diff — use `rc-audit`.

## Procedure

Contract paths are relative to the rcstack root: the real path of this skill's directory, two levels up.

1. Confirm the handoff: the goal, the tier, the constraints, and whether a Research Brief already exists.
2. **Research (`systems_research`).** When no Research Brief is supplied, ground the affected code paths, interfaces, existing tests, and relevant `docs/decisions.md` entries into one per `contracts/research-brief.md`. If a blocking question cannot be grounded, stop and return it.
3. **Blueprint (`architect_blueprint`).** Write the Spec per `contracts/spec.md` with all seven sections: Problem Statement, Non-Goals, Data Shapes & Interfaces, Module Boundaries, Failure Modes, Acceptance Criteria, Verification Plan.
4. Choose the smallest design that meets the goal. Follow the conventions already in the code, give exact data shapes, and name the files and modules that must not change.
5. Treat failure as part of the design: for each failure mode state how it is detected and what the system does. At Tier 3, add abuse cases and a negative test for each.
6. Map every Acceptance Criterion to a Verification Plan row with an exact command and expected result.
7. Self-check: can a builder who reads only the Spec and the files it cites implement this, and are all unknowns written as questions rather than guessed?
8. Return the Spec with the assumptions that need human sign-off. At Tier 3, or whenever open questions remain, the Spec waits for human approval before any build.

## Definition of Done

- A Research Brief exists, supplied or produced here, and the Spec cites it.
- The Spec has all seven sections, at least one Non-Goal, and every Acceptance Criterion mapped to a verification command.
- Open questions and assumptions are listed for sign-off, not buried in the design.
- No production code was changed.
