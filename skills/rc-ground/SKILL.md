---
name: rc-ground
description: Ground a task in a large corpus or repository and return a Research Brief in which every fact carries an exact citation. Use when rc-router dispatches a grounding phase or the user explicitly asks to ground a question in sources.
version: 0.1.0
entry_mode: router_dispatched
role: deep_grounding
invokes_contracts:
  - contracts/research-brief.md
---

# rc-ground

## Single Job

Ground a task in its corpus or repository and return a Research Brief in which every fact carries an exact citation.

## When to Use

- `rc-router` dispatches the grounding phase of a playbook.
- The user explicitly asks to ground a question or topic in named sources or a codebase.
- A large body of files or documents must be read before anything is designed or written.

## Do NOT Use When

- Do NOT self-trigger this skill autonomously as part of a multi-step workflow outside `rc-router` (`/rcstack`). Run directly only when explicitly invoked by the user or dispatched by `rc-router`.
- The answer is one known fact or a single file lookup — answer directly at Tier 0.
- The task is to design the solution — use `rc-architect`.
- The task is to judge finished work — use `rc-audit`.
- The task is to write notes, a report, or code — this skill's only output is the Research Brief.

## Procedure

Contract paths are relative to the rcstack root: the real path of this skill's directory, two levels up.

1. Confirm the handoff: the goal or question, the corpus scope (paths, documents, URLs), the constraints, and the output contract `contracts/research-brief.md`. If the scope is missing, ask the dispatcher instead of guessing.
2. Inventory the corpus before reading deeply: what is in scope, how large it is, what is out of scope, and anything that cannot be read.
3. Read the primary sources that matter in full, holding whole files and documents in context rather than fragments. When the profile declares `paired_with` or `companion_tools` for `deep_grounding`, use them as the profile specifies, to cross-check extraction and never as an uncited source.
4. Extract facts. Each is a single checkable statement with an exact citation: `path:line`, a URL with its section or anchor, or a document with its page. Quote verbatim where wording matters.
5. Record disagreement between sources as a fact about the disagreement. Record gaps as Open Questions, each with the evidence that would settle it.
6. Re-open every citation once and confirm it supports the fact as written. Fix or drop any that does not.
7. Fill the Research Brief template completely: Goal, Grounded Facts, Open Questions, Constraints (including relevant `docs/decisions.md` entries), and Recommended Approach with the rejected alternative.
8. Return the brief to the dispatcher and stop. Do not start designing or building.

## Definition of Done

- A Research Brief exists with all five sections filled.
- Every Grounded Fact has a citation that was re-opened and confirmed.
- Unsupported statements appear only under Open Questions.
- The corpus scope, and anything in scope that was not read, is stated.
