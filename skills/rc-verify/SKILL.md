---
name: rc-verify
description: Deterministic lint, type, test and runtime proof. Runs the real commands, records exit codes and reports exactly what passed, failed or was not run, without fixing anything. Use when rc-router dispatches a verify gate or the user explicitly asks to verify a change.
version: 0.1.0
entry_mode: router_dispatched
role: local_deterministic
invokes_contracts:
  - contracts/work-receipt.md
---

# rc-verify

## Single Job

Prove with deterministic commands — lint, types, tests, and runtime checks — whether the current state does what it claims, and report the evidence exactly.

## When to Use

- `rc-router` dispatches a verification gate of a playbook.
- A playbook step loop needs proof after each atomic step.
- The user explicitly asks to verify, test, or prove a specific change.

## Do NOT Use When

- Do NOT self-trigger this skill autonomously as part of a multi-step workflow outside `rc-router` (`/rcstack`). Run directly only when explicitly invoked by the user or dispatched by `rc-router`.
- The question is whether the design or reasoning is sound — use `rc-audit`.
- The goal is a repo-wide hygiene report — use `rc-doctor`.
- A check fails and needs fixing — report it; the fix belongs to the builder, not to this skill.
- Getting green would require weakening, skipping, or editing a test or check — never do that; report the failure.

## Procedure

Contract paths are relative to the rcstack root: the real path of this skill's directory, two levels up.

1. Identify what must be proven: the Spec's Verification Plan when one exists, otherwise the proof the dispatching phase names.
2. Discover commands in this order: the Verification Plan, the commands in the target repo `AGENTS.md`, then project manifests such as package scripts or a Makefile. Never invent a command; if no command exists for a claim, say so.
3. Run the checks cheapest first: format and lint, type check, unit tests, integration tests, then a runtime proof that executes the program, endpoint, or script and observes the result. For non-code artifacts, resolve every citation, recompute every number, and lint the structure.
4. Record for each check the exact command, its exit code, and a one-line result. Keep the relevant output excerpt for every failure.
5. Record whether everything passed on the first run, before any fix loop. This is the run's `first_pass_verify_passed` value.
6. On failure, stop and return the evidence to the role that produced the work. Do not edit code, tests, or configuration. Re-run a suspected flaky check once and report both results.
7. List every check that was not run, with the reason. Nothing is implied to have passed.
8. Write the results into the Verification Evidence section of the Work Receipt per `contracts/work-receipt.md`, or into a receipt of its own when run directly.

## Definition of Done

- Every claimed behaviour has a command with an exit code, or is listed as unverified.
- The first-pass result is recorded.
- The verdict is PASS only when every required command exited 0.
- This skill modified no file: `git status --short` is the same before and after.
