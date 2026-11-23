---
name: rc-init
description: Bootstrap rcstack guardrails in a target repository - an AGENTS.md with a Tier 3 Paths section, a decisions log and ignored branch state - without overwriting anything. Use when a repo is new to rcstack or rc-router reports missing guardrails.
version: 0.1.0
entry_mode: standalone_or_router
role: local_deterministic
invokes_contracts:
  - contracts/work-receipt.md
---

# rc-init

## Single Job

Create the minimum rcstack guardrails a target repository needs — repo law, a decisions log, and ignored branch state — without overwriting anything that already exists.

## When to Use

- A repository is being used with rcstack for the first time.
- `rc-router` reports that `AGENTS.md` or `docs/decisions.md` is missing in the target repo.
- The user asks to set up, or re-check, rcstack guardrails in the current repo.

## Do NOT Use When

- **Run directly:** the user explicitly asks to bootstrap or re-check guardrails in the current repo and no other task is in flight.
- **Defer to `rc-router`:** bootstrapping is one step of a larger task, or a file to be created or changed matches a Tier 3 pattern. Let the router's playbook decide when and how guardrails are created.
- The repo already has guardrails and the goal is to find hygiene problems — use `rc-doctor`.
- The goal is to install rcstack skills into a harness — that is `adapters/install.sh`, run by the human, never by this skill.
- An existing `AGENTS.md` or decisions log should be "reset" — this skill never overwrites; propose edits as a diff instead.

## Procedure

Contract paths are relative to the rcstack root: the real path of this skill's directory, two levels up. Everything else is in the target repo.

1. Confirm the current directory is the root of the target git repository (`git rev-parse --show-toplevel`). Stop if it is not a git repository.
2. Inventory, read-only: whether `AGENTS.md` exists and has a `## Tier 3 Paths` section; whether `docs/decisions.md` exists with at least one entry; whether branch state is ignored (`git check-ignore -q .rcstack/state/probe`); and which lint, type, and test commands the repo already defines.
3. Present the plan: files to create, sections to propose, and files that will be left untouched. When run directly, wait for the human's confirmation before writing.
4. Create a missing `AGENTS.md`, under 100 lines: what the repo is, the exact verification commands found in step 2, conventions observed in the code (never invented), and a `## Tier 3 Paths` section listing globs for this repo's auth, sandbox, container, symlink, infrastructure, and schema paths. Mark every guess `TODO(human)`. If `AGENTS.md` exists without the section, propose it as a diff and append only after approval.
5. Create a missing `docs/decisions.md` containing the entry template and a first `DEC-001` entry that records adopting rcstack guardrails, with all five fields: Date, Status, Decision, Rejected Alternative, Guardrail.
6. Check the ignore rule. If `.rcstack/state/` is not ignored, do not edit global git config or the global ignore file: tell the human to run `bash adapters/install.sh --dry-run` from the rcstack root and then activate, or offer a local entry in `.git/info/exclude`. Create `.rcstack/state/` only once it is ignored.
7. Verify: repeat the inventory, confirm `git status --short` lists only the intended new files, and confirm no `.rcstack/` path appears in it.
8. Emit a Work Receipt per `contracts/work-receipt.md`: files created, files skipped because they existed, commands run with exit codes, and every `TODO(human)` under Assumptions & Trade-offs.

## Definition of Done

- `AGENTS.md` exists with a `## Tier 3 Paths` section, or the receipt records that the human declined it.
- `docs/decisions.md` exists with at least one entry in the exact five-field template.
- `git check-ignore -q .rcstack/state/probe` exits 0, or the receipt records the ignore rule as outstanding.
- No pre-existing file was overwritten, and every change is listed in the Work Receipt.
