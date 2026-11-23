---
name: rc-doctor
description: Diagnoses a repository's health against its own law, then applies approved cures as atomic, verified commits.
version: 0.1.0
entry_mode: standalone_or_router
capability: gardener
invokes_contracts:
  - contracts/audit-findings.md
  - contracts/work-receipt.md
invokes_scripts:
  - scripts/verify.mjs
---

# rc-doctor

## Single Job

Find where a repository has drifted from its own rules, and fix only what the human approves, one revertible commit at a time.

## When to Use

- A repository feels unhealthy: checks fail or are missing, docs are stale, the same mistake keeps
  coming back.
- Before a large piece of work, to learn what state the repository is really in.
- `rc-router` invokes it from the `garden-maintenance` playbook.

## Do NOT Use When

- The repository was never bootstrapped — use `rc-init`.
- A cure changes behavior, spans several areas, or needs an independent audit — go through
  `rc-router`, which runs it under `garden-maintenance` with receipts and review.
- A cure touches a path matching the profile's `tier3_path_patterns` — go through `rc-router`,
  which routes it to `security-critical`.
- The problem is one known defect — ask `rc-router` for `bug-root-cause`.
- The machine's install, profiles, or harness links are the problem — use `rc-setup`.

## Procedure

1. **Diagnose, read-only.** Change nothing in this step.
   - Read `AGENTS.md` and `docs/decisions.md`. They define healthy for this repository.
   - Run the canonical verify command and record its exit code and failures.
   - Check each rule in `AGENTS.md` against the tree, and each `Guardrail` in the decisions log
     against the check it names: does that check exist, and does it run?
   - If the repository has a `specs/` directory, run
     `node ~/.rcstack/dist/scripts/verify.mjs --specs <repo>/specs` and report every violation.
     Also flag feature documents that sit outside their feature's spec directory.
   - Look for stale decisions, dead or missing checks, undocumented conventions, files the law
     forbids, and mistakes that recur in recent history.
2. **Report findings** in the shape of `contracts/audit-findings.md`: grouped as `Blocker`,
   `Major`, and `Nit`, each with a `file:line`, an `impact`, and a `concrete_fix`. Rank them. This
   report is a diagnosis, not an independent audit, and is never counted as one.
3. **Propose cures.** One cure per finding, each atomic and independently revertible. Mark every
   cure as *mechanical* (formatting, dead links, stale docs, wiring an existing check) or
   *substantive* (anything that changes behavior, an interface, or a guardrail).
4. **Wait for approval.** The human chooses which cures run. Nothing is cured without approval.
5. **Route what must be routed.** Substantive cures and any cure on a Tier 3 path go back to
   `rc-router`. Standalone, apply only approved mechanical cures.
6. **Cure atomically.** One approved cure per commit. Run the canonical verify command after each
   one; a cure that turns it red is reverted, not patched forward. When invoked by `rc-router`,
   return one `contracts/work-receipt.md` per cure and leave admission to the router.
7. **Prune by superseding.** A stale decision gets a new entry and is marked superseded. Never
   delete an entry.
8. **Promote repeat mistakes.** A mistake seen more than once becomes a deterministic check: a
   test, a lint rule, or a line in the verify command. Show that the new check fails on the
   mistake before relying on it.
9. **Report:** cures applied with commit ids, cures declined, cures routed, and the verify result.

## Definition of Done

- Diagnosis changed no file.
- Every finding has a `file:line`, an `impact`, and a `concrete_fix`.
- Every applied cure was approved, is exactly one commit, and left the verify command passing.
- Substantive and Tier 3 cures were handed to `rc-router`, not applied standalone.
- No decision entry was deleted, and each promoted check was shown to fail on its target mistake.
