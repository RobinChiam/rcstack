---
name: rc-state
description: Maintain the two memory layers - evergreen decisions in docs/decisions.md and ephemeral per-branch session state in .rcstack/state/<branch>.md. Use when rc-router loads or records state, or the user explicitly asks to record a decision or save and resume a session.
version: 0.1.0
entry_mode: router_dispatched
role: local_deterministic
invokes_contracts:
  - contracts/work-receipt.md
---

# rc-state

## Single Job

Keep the two memory layers current: evergreen decisions in `docs/decisions.md` and ephemeral per-branch state in `.rcstack/state/<branch-slug>.md`.

## When to Use

- `rc-router` dispatches it at the start of a playbook to load state, or at the end to record the outcome.
- A durable decision was made or reversed and must outlive the session.
- A session is ending mid-task and the next one needs an exact resume point.
- The user explicitly asks to record a decision, or to save or resume branch state.

## Do NOT Use When

- Do NOT self-trigger this skill autonomously as part of a multi-step workflow outside `rc-router` (`/rcstack`). Run directly only when explicitly invoked by the user or dispatched by `rc-router`.
- The goal is to record what a phase did and proved — that is a Work Receipt, not state.
- The goal is a human-facing summary of a finished run — use `rc-review-map`.
- The target repo has no decisions log yet — use `rc-init` first.
- The item is transient task detail — keep it out of the decisions log; and never keep a durable decision only in branch state.

## Procedure

Contract paths are relative to the rcstack root: the real path of this skill's directory, two levels up. Both memory layers live in the target repo.

1. Resolve the branch with `git rev-parse --abbrev-ref HEAD` and derive the slug: lowercase, with every character outside `a-z`, `0-9`, `.`, `_`, `-` replaced by `-`. The state file is `.rcstack/state/<branch-slug>.md`.
2. Before writing state, confirm it is ignored: `git check-ignore -q .rcstack/state/<branch-slug>.md` must exit 0. If it does not, stop and report; never write state that could be committed.
3. **Load.** Read `docs/decisions.md` (accepted entries are binding constraints) and the state file if it exists. Return the Active Goal, Completed Phases, Next Step, and Open Blockers to the dispatcher.
4. **Record branch state.** Rewrite the whole state file as a snapshot, using exactly this template and referencing Work Receipts by `task_id`:

   ```markdown
   # Branch State: <branch>
   - **Updated:** <ISO-8601 timestamp>
   - **Profile / Tier / Playbook:** <profile> | T<0-3> | <domain>/<playbook>
   - **Active Goal:** <1–2 sentences>
   - **Completed Phases:** <checklist with commit SHAs or receipt refs>
   - **Next Step:** <exact next action for a resumed session>
   - **Open Blockers / Assumptions:** <list or "None">
   ```

5. **Record a decision.** Append to `docs/decisions.md` with the next free `DEC-NNN`, using exactly this template. Record only choices that constrain future work, each with a real rejected alternative and a guardrail that can fail:

   ```markdown
   ### DEC-NNN: <Short Title>
   - **Date:** YYYY-MM-DD
   - **Status:** Accepted | Superseded by DEC-XXX
   - **Decision:** <What we chose and why>
   - **Rejected Alternative:** <What we explicitly ruled out and why>
   - **Guardrail:** <Deterministic check, lint rule, or invariant enforcing this decision>
   ```

6. **Prune.** When a decision no longer holds, set its status to `Superseded by DEC-NNN` and add the superseding entry. Never delete or renumber an entry.
7. **Clean up.** When a branch is merged or deleted, carry any durable decision into the log, then remove that branch's state file.
8. Report every file read and written, with paths, so the caller can cite it in a Work Receipt per `contracts/work-receipt.md`.

## Definition of Done

- The state file matches the template exactly, names a concrete Next Step, and is not tracked by git.
- Every new decision uses the exact template with the next free id, and no entry was deleted.
- `git status --short` shows no `.rcstack/` path.
- The dispatcher received the loaded goal, completed phases, next step, and blockers.
