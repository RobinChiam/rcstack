---
name: security-critical
profile: rcstack-engineering
entry_mode: router_only
default_tier: 3
required_assurance: A3
required_capabilities:
  - systems_research
  - architect_blueprint
  - security_builder
  - independent_reviewer
contracts:
  - contracts/research-brief.md
  - contracts/spec.md
  - contracts/work-receipt.md
  - contracts/audit-findings.md
  - contracts/review-map.md
---

# Security Critical

The auto-escalated track for auth, sandboxing, containers, symlinks, infrastructure, schemas, and every path matching `tier3_path_patterns`.

## Router-Only Invocation Boundary

> **ROUTER-ONLY:** This playbook MUST ONLY be invoked by `rc-router` (`/rcstack`) after profile selection, risk-tier classification, and live model resolution. Never execute this playbook standalone or bypass `rc-router`.

## Do NOT Use When

- No path matches `tier3_path_patterns` and nothing touches a trust boundary — use
  `feature-build` or `bug-root-cause`.
- You want to try a risky idea — build it in a throwaway location with `viability-spike` first.
  Never use `vibe-iterate` on a Tier 3 path.
- The change is a behavior-preserving restructure of non-critical code — use `refactor-pinned`.

## Workflow Phases

1. **TRIAGE** — state is open at Tier 3, either from `rc-state.mjs init` or from
   `rc-state.mjs transition --escalate-tier 3`. List every Tier 3 path in scope and the trust
   boundary each one protects.
2. **RESEARCHING** — `systems_research` writes `contracts/research-brief.md`: current behavior
   cited by `file:line`, the threat model (who controls which input), existing guardrails and
   tests, and prior decisions that constrain the change.
3. **PLANNING** — `architect_blueprint` writes `contracts/spec.md` with failure modes expressed as
   attacks and misuse cases, and a verification plan that names the hardened evidence.
   **User sign-off pause:** move to `BLOCKED` with the reason "awaiting human sign-off on spec",
   present the spec, and resume only on explicit approval. No builder starts before sign-off.
4. **EXECUTING** — `security_builder` implements one slice at a time with the smallest possible
   diff and a test for each failure mode, adds no dependency without a decision, and returns
   `contracts/work-receipt.md`.
5. **VERIFYING** — run the canonical verify command plus the hardened checks the spec named
   (edge-case, security, or runtime proof). Admit each receipt through `rc-receipt.mjs`
   (`rc-state.mjs transition --admit-receipt`) with `--allowed-paths` set to the slice.
6. **AUDITING** — strict cross-family adversarial audit. The `independent_reviewer` comes from a
   different model family than the builder, works in a fresh context, and is briefed to break the
   change: bypasses, injection, path traversal, race windows, unsafe defaults, failing open. It
   returns `contracts/audit-findings.md`. Any `Blocker` or `Major` returns to `EXECUTING`. Then
   admit the integrated receipt with the open finding counts.
7. **AWAITING_REVIEW** — synthesize `contracts/review-map.md` with every Tier 3 path marked
   `[HIGH]` and a proposed decision entry for each changed guardrail. Stop for the human.
8. **SHIPPED** — after approval, append the telemetry row with `rc-log.mjs` and close the state.

## Exit Gate & Definition of Done

- Human sign-off on the spec was given before `EXECUTING` began.
- The canonical verify command exits `0`, and `mechanical`, `behavioral`, and `hardened` all passed.
- Every receipt was `ADMITTED` by `rc-receipt.mjs`; the integrated receipt is tagged `A3`.
- A cross-family reviewer that is not the builder audited in a fresh context; `0` open
  `Blocker`s and `0` open `Major`s.
- Without hardened evidence or a cross-family reviewer the run does not ship as `A3`: the Review
  Map carries an `ASSURANCE GAP` banner and the human decides.
- The Review Map and decision entry were delivered and the telemetry row was appended by
  `rc-log.mjs`.
