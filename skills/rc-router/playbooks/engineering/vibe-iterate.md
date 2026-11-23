---
name: vibe-iterate
profile: rcstack-engineering
entry_mode: router_only
default_tier: 1
required_skills:
  - rc-verify
required_roles:
  - vibe_executor
contracts:
  - contracts/work-receipt.md
---

# Vibe Iterate (`engineering/vibe-iterate`)

A rapid build-look-adjust loop for prototypes, UI tweaks, and spikes. It keeps deterministic verification and skips the Review Map ceremony.

## Router-Only Invocation Boundary

> **ROUTER-ONLY:** This playbook MUST ONLY be invoked by `rc-router` (`/rcstack`) after profile selection, risk-tier classification, and model resolution. Never execute this playbook standalone or bypass `rc-router`.

The router hands over the profile, the tier, the resolved role-to-model route, and the branch state. If any of these is missing, stop and return to `rc-router`.

## Do NOT Use When

- The result will be merged as production behaviour — use `feature-build`.
- A defect needs its cause proven — use `bug-root-cause`.
- Existing behaviour must be preserved through a restructure — use `refactor-pinned`.
- The question is whether an approach is viable at all — use `viability-spike` under the research profile.
- Any touched path matches a Tier 3 pattern — stop and return to `rc-router`, which selects `security-critical`.

## Workflow Phases

1. **Frame** — `vibe_executor` restates the goal in one line and sets a stop condition: a time box or a maximum number of iterations.
2. **Loop** — `vibe_executor` makes one small change, runs it, shows the result, and adjusts. Keep each diff small. Do not add dependencies, change shared contracts or schemas, or touch files outside the stated area.
3. **Verify** — `rc-verify`: before handing back, run the repo's lint, type, and test commands, or a runtime proof when no tests cover the area.
4. **Receipt** — `vibe_executor` emits one compact Work Receipt per `contracts/work-receipt.md`: what changed, the verification evidence, and what is still prototype quality.

Stop the loop and return to `rc-router` for re-classification when the work touches a Tier 3 path, grows past the stated area, or is about to be kept as production code.

## Exit Gate & Definition of Done

- `rc-verify` passes on the final state, with commands and exit codes in the Work Receipt.
- The Work Receipt marks the result as prototype quality and lists what a production version still needs.
- No dependency, shared contract, or Tier 3 path was changed.
