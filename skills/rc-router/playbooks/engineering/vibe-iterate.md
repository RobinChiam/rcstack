---
name: vibe-iterate
profile: rcstack-engineering
entry_mode: router_only
default_tier: 1
required_assurance: A1
required_capabilities:
  - vibe_executor
contracts: []
---

# Vibe Iterate

Runs a fast, low-ceremony loop for prototypes, UI polish, and exploratory sketches that are cheap to throw away.

## Router-Only Invocation Boundary

> **ROUTER-ONLY:** This playbook MUST ONLY be invoked by `rc-router` (`/rcstack`) after profile selection, risk-tier classification, and live model resolution. Never execute this playbook standalone or bypass `rc-router`.

## Do NOT Use When

- The result will ship or others will depend on it — use `feature-build`.
- Any touched path matches `tier3_path_patterns` — use `security-critical`. Never iterate on one.
- You are chasing a defect in real code — use `bug-root-cause`.
- The question is whether an approach is viable at all and needs a written verdict — use
  `viability-spike`.

## Workflow Phases

1. **Frame** — one sentence: what is being tried and what "good enough" looks like. No state
   file, no spec.
2. **Loop** — `vibe_executor` makes a small change, shows it, and adjusts on feedback. Each
   iteration stays reviewable at a glance and inside the sketch's own files.
3. **Verify** — run the repo's fast mechanical verify (format, lint, static and type checks) on
   the result.
4. **Confirm** — reply in exactly two lines: what changed, and the verify command with its exit
   code.
5. **Escalate** — the moment the work touches a shared interface, persistent data, or a Tier 3
   path, or the human says "ship it", stop and return to `rc-router` for re-classification.

## Exit Gate & Definition of Done

- The mechanical verify exits `0`, which is `A1`. If the repository has no mechanical check, say
  so: the result is `A0` and the confirmation carries `ASSURANCE GAP`.
- The two-line confirmation was delivered.
- No state file, Review Map, or telemetry row was created; Tier 1 skips all three.
- Nothing outside the sketch's scope changed.
