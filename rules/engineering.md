# Engineering Rules (always on)

Loaded by `rc-router` for every `rcstack-engineering` run and passed to every dispatched phase.
These are taste rules, not procedures: short, absolute, and checkable.

## Evidence

- Nothing "works" without a command, its exit code, and the output that proves it.
- Reproduce before fixing. A failing test or script comes before the change that fixes it.
- Fix root causes. Never patch a symptom, swallow an error, or weaken a test to get green.
- Read the code you are about to change, and the code that calls it, before editing.

## Scope

- Ship the smallest diff that satisfies the acceptance criteria. No drive-by refactors.
- One logical change per commit. A commit message says why, not what the diff already shows.
- No new dependency without a recorded decision. Prefer the standard library and existing code.
- Delete dead code, debug output, and commented-out blocks before handing off.

## Design

- Match the conventions of the surrounding code before introducing your own.
- Make illegal states unrepresentable; validate at boundaries and trust the inside.
- Prefer explicit data shapes and plain functions over clever abstractions and deep inheritance.
- Handle the failure path first. Errors carry enough context to act on without a debugger.
- Comments explain why a constraint exists, never narrate what the next line does.

## Safety

- Anything touching auth, sandboxing, containers, symlinks, infrastructure, or schema migrations
  is Tier 3. Stop and return to `rc-router` if you discover it mid-task.
- Destructive or outward-facing actions (delete, force-push, deploy, publish, send) need explicit
  human approval in the current session.
- Never commit secrets, tokens, personal data, or `.rcstack/state/`.

## Honesty

- Report what was actually run and what actually happened, including failures and skipped steps.
- State assumptions and trade-offs in the Work Receipt; do not bury them in the diff.
- When blocked or unsure, stop and say so. A clear question beats a confident guess.
