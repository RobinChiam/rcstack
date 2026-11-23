# Engineering Rules

Always-on taste for the `rcstack-engineering` profile. These shape how work is done; the gates
that decide when it is done live in the playbooks.

- **Root cause first.** Reproduce before you fix. A patch that hides a symptom is a new bug.
- **Smallest diff that solves the stated problem.** No drive-by refactors, no speculative
  abstractions, no features nobody asked for.
- **Tests are evidence.** A bug fix starts with a failing test; a refactor starts with tests that
  pin current behavior. Never edit a test to make it pass.
- **Verify, then claim.** Run the repo's canonical verify command and report its real output.
  "Should work" is not a result.
- **Extend before you add.** Prefer an existing module, pattern, or dependency over a new one.
  A new dependency needs an entry in `docs/decisions.md`.
- **Fail loudly at the boundary.** Validate input where it enters. No silent fallbacks, no
  swallowed errors, no defaults that hide a missing value.
- **Names say what; comments say why.** Delete commented-out code and narrating comments.
- **Stay in your slice.** Touch only the files the spec assigned. Anything else is a new slice.
- **Small sharp risk is still risk.** A one-line change to auth, sandboxing, containers, symlinks,
  infrastructure, or a schema gets Tier 3 treatment.
- **Secrets stay out** of code, logs, state, receipts, and telemetry.
- **Write down durable choices** with the alternative you rejected and the guardrail that keeps
  the choice true.
- **Uncertain about intent? Ask once. Uncertain about a fact? Measure.**
