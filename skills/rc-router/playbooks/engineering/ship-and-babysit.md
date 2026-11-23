---
name: ship-and-babysit
profile: rcstack-engineering
entry_mode: router_only
default_tier: 2
required_assurance: A2
required_capabilities:
  - primary_builder
  - independent_reviewer
contracts:
  - contracts/spec.md
  - contracts/work-receipt.md
  - contracts/audit-findings.md
  - contracts/review-map.md
---

# Ship and Babysit

Takes approved work across the line: a final verify, an unslop pass, a pull request built from the Review Map, and safe CI and review triage until it lands.

## Router-Only Invocation Boundary

> **ROUTER-ONLY:** This playbook MUST ONLY be invoked by `rc-router` (`/rcstack`) after profile selection, risk-tier classification, and live model resolution. Never execute this playbook standalone or bypass `rc-router`.

## Do NOT Use When

- The work has not passed its own playbook's audit and human review — return to that playbook
  (`feature-build`, `bug-root-cause`, `refactor-pinned`, or `security-critical`).
- CI exposes a real defect — use `bug-root-cause`.
- A reviewer asks for new behavior — use `feature-build`.

## Workflow Phases

1. **Entry check** — `rc-state.mjs show` reports this branch at `AWAITING_REVIEW` with the human's
   approval, and `rc-state.mjs reconcile` reports no drift. Re-read the approved
   `contracts/spec.md`: every acceptance criterion still holds.
2. **Final verify** — run the repo's canonical verify command on the exact head being shipped.
3. **Unslop pass** — `primary_builder` removes debug output, dead code, narrating comments, and
   generated noise. If anything changes, the delta is a slice: back through `EXECUTING`, then
   `VERIFYING` with its `contracts/work-receipt.md` admitted by `rc-receipt.mjs`, then `AUDITING`,
   where the `independent_reviewer` returns `contracts/audit-findings.md` on the delta.
4. **Pull request** — the body is `contracts/review-map.md`, verbatim. Push and open the pull
   request only on the human's explicit go-ahead.
5. **Babysit** — triage CI and review comments. Safe actions only: rerun a flaky job, fix lint,
   apply a reviewer's nit. Each fix is a slice with a receipt. Anything that changes behavior or
   touches a Tier 3 path stops this playbook and goes back to `rc-router`.
6. **SHIPPED** — once merged: `rc-state.mjs transition --to SHIPPED`, append the telemetry row
   with `rc-log.mjs`, then `rc-state.mjs close`.

## Exit Gate & Definition of Done

- The canonical verify command exits `0` on the shipped head, and CI is green on it.
- Every change made here has a receipt `ADMITTED` by `rc-receipt.mjs` and was audited by a
  reviewer that is not its builder; `0` open `Blocker`s.
- Achieved assurance is at least `A2`, or the pull request body carries the `ASSURANCE GAP` banner.
- The pull request body is the Review Map; nothing was pushed without the human's go-ahead.
- The telemetry row was appended by `rc-log.mjs` and the state was closed with `rc-state.mjs close`.
