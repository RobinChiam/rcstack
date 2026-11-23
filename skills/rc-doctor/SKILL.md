---
name: rc-doctor
description: Diagnose then Cure repo hygiene audit. Runs a read-only Diagnose pass that reports evidence-backed findings, then applies only human-approved fixes as atomic Cure commits. Use for periodic health checks or when a repo feels neglected.
version: 0.1.0
entry_mode: standalone_or_router
role: primary_builder
invokes_contracts:
  - contracts/work-receipt.md
---

# rc-doctor

## Single Job

Audit a repository's hygiene in a read-only Diagnose pass, then apply only human-approved fixes as atomic Cure commits.

## When to Use

- A periodic health check is due, or the repo has not been checked since a large change landed.
- Guardrails, docs, or the decisions log look stale or contradict the code.
- `rc-router` dispatches it from the `garden-maintenance` playbook.
- The user asks what is wrong with the repo's hygiene.

## Do NOT Use When

- **Run directly:** for a Diagnose pass at any time, since it changes nothing; and for Cure only when the human explicitly asks and every approved cure is trivial hygiene with no behaviour change.
- **Defer to `rc-router`:** cures are wanted as tracked maintenance, or any cure changes code behaviour or touches a Tier 3 path. The router selects `garden-maintenance`, which adds verification, a cross-model audit, and a Review Map.
- The repo has no guardrails at all — use `rc-init` first.
- A specific diff needs a correctness review — use `rc-audit`.
- A change needs proof that it works — use `rc-verify`.
- A known defect needs fixing — that is the `bug-root-cause` playbook, through `rc-router`.

## Procedure

Contract paths are relative to the rcstack root: the real path of this skill's directory, two levels up. Everything else is in the target repo.

**Diagnose (read-only)**

1. Record the branch and `git status --short`. Change nothing in this mode.
2. Run the deterministic checks first and record each command with its exit code: the verification commands named in `AGENTS.md`, and the repo's own validator if it has one.
3. Inspect each hygiene area and collect evidence:
   - **Guardrails** — `AGENTS.md` exists, is under 100 lines, has a `## Tier 3 Paths` section, and its commands still run.
   - **Decisions** — `docs/decisions.md` entries follow the template; flag entries the code contradicts and guardrails that no longer exist.
   - **Branch state** — files under `.rcstack/state/` for merged or deleted branches; any state file tracked by git.
   - **Docs drift** — documented commands that fail, broken relative links, descriptions of code that has moved.
   - **Debris** — dead files, leftover debug output, committed build artefacts, ownerless TODOs.
   - **Repeat issues** — anything that also appeared in a previous Diagnose.
4. Report the findings as a table: id, area, evidence (`path:line` or command output), severity (High, Medium, Low), proposed cure, and the risk of that cure. A finding without evidence is dropped.

**Cure (only after approval)**

5. Ask the human which findings to cure. Unapproved findings stay in the report untouched.
6. Apply each approved cure as one atomic commit, or as one isolated change set when the human has not authorized commits. Never bundle cures.
7. Re-run the deterministic checks after every cure. Revert a cure that turns a check red, and report it.
8. Emit a Work Receipt per `contracts/work-receipt.md`: cures applied, findings left open, and the verification evidence.

## Definition of Done

- Diagnose: a findings table exists with evidence for every row, and `git status --short` is identical before and after.
- Cure: only approved cures were applied, one atomic change each, with the deterministic checks passing after each.
- A Work Receipt lists cured and remaining findings with verification evidence.
- Every repeat issue is flagged for promotion to a deterministic check.
