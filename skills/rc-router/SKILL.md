---
name: rc-router
description: Unified front door for /rcstack. Selects the profile, classifies the risk tier, picks the playbook and resolves reviewer-safe models in one pass, then drives the playbook to its exit gate. Use when the user types /rcstack or asks to route a multi-phase task through rcstack.
version: 0.1.0
entry_mode: front_door
role: router
invokes_contracts:
  - contracts/research-brief.md
  - contracts/spec.md
  - contracts/work-receipt.md
  - contracts/audit-findings.md
  - contracts/review-map.md
  - contracts/telemetry-event.schema.json
---

# rc-router (`/rcstack`)

## Single Job

Turn one request into a printed Routing Plan — profile, risk tier, playbook, and a reviewer-safe model route — and drive the selected playbook to its exit gate.

## When to Use

- The user types `/rcstack`, with or without a task description.
- A task needs more than one phase: grounding, blueprint, build, verification, audit, or a Review Map.
- A task touches, or might touch, a Tier 3 path.
- A session resumes a branch that has a state file under `.rcstack/state/`.

## Do NOT Use When

- **Tier 0 trivial work** — a one-line edit, typo fix, rename, or factual lookup with no behaviour change. Do it directly: no Routing Plan, no playbook, no receipts. A path that matches a Tier 3 pattern is never Tier 0.
- **Direct standalone checks** — the user explicitly invokes `rc-init`, `rc-doctor`, or `rc-retro`, or names one skill to run on its own. Run that skill directly without routing ceremony.
- **Inside a dispatched phase** — never re-enter `rc-router` from a playbook phase or a delegated task. A phase that discovers a tier or scope change stops and reports back to the routing session, which re-routes.
- **No deliverable** — questions about rcstack itself, or open-ended discussion with nothing to build, learn, or decide.

## Procedure

Paths under `profiles/`, `rules/`, `contracts/`, `scripts/`, and `skills/` are relative to the rcstack root: the real path of this skill's directory, two levels up (this holds through installer symlinks). `AGENTS.md`, `docs/decisions.md`, and `.rcstack/state/` belong to the target repo being worked on.

1. **Identify the profile.** An explicit user choice wins. Otherwise pick by the nature of the deliverable, defaulting to `rcstack-engineering`.

   | Profile | Deliverable | Profile file | Rules | Playbooks |
   | :--- | :--- | :--- | :--- | :--- |
   | `rcstack-engineering` (default) | Working software | `profiles/rcstack-engineering.yaml` | `rules/engineering.md` | `skills/rc-router/playbooks/engineering/` |
   | `rcstack-study` | Understanding in the learner's head | `profiles/rcstack-study.yaml` | `rules/study.md` | `skills/rc-router/playbooks/study/` |
   | `rcstack-research` | A decision backed by evidence | `profiles/rcstack-research.yaml` | `rules/research.md` | `skills/rc-router/playbooks/research/` |

2. **Load context.** Read, in order: the profile file, the domain rules file, the target repo `AGENTS.md`, `docs/decisions.md`, and `.rcstack/state/<branch-slug>.md` if present. When a state file exists, resume from its Next Step instead of re-planning. Missing `AGENTS.md` or `docs/decisions.md` in a target repo is a finding: offer `rc-init`, then continue.

3. **Classify the Risk Tier (0-3).** Use the tier definitions in the profile's `risk_tiers`.

   | Tier | Meaning | Typical signals |
   | :--- | :--- | :--- |
   | 0 | Trivial lookup or one-line edit | No behaviour change, nothing to verify |
   | 1 | Fast iteration | Prototype, UI tweak, drill; reversible; no shared contract changes |
   | 2 | Standard delivery | Anything kept or merged: features, fixes, refactors, notes, reports |
   | 3 | Security-critical or high-stakes | Auth, sandbox, containers, symlinks, infra, schema, graded or formal work |

   - **Auto-escalate to Tier 3** when any touched or target path matches a glob in the profile's `tier3_path_patterns` or in the `## Tier 3 Paths` section of the target repo `AGENTS.md`. Globs match repo-relative paths: `*` stays within one path segment and `**` spans any number of segments, including none.
   - The user may raise a tier. Nobody may lower a tier below a path match.
   - Between two plausible tiers, take the higher.
   - If the result is Tier 0, state `Tier: T0 — handled directly` in one line, answer with the `quick_lookup` role, and stop.

4. **Select the playbook.** Choose exactly one. The run's tier is the higher of the classified tier and the playbook's `default_tier`.

   | Playbook file | Default tier | Select when |
   | :--- | :--- | :--- |
   | `skills/rc-router/playbooks/engineering/feature-build.md` | 2 | New or changed behaviour delivered to a spec |
   | `skills/rc-router/playbooks/engineering/bug-root-cause.md` | 2 | Something is broken and the cause is not yet proven |
   | `skills/rc-router/playbooks/engineering/vibe-iterate.md` | 1 | Prototype, UI tweak, or throwaway spike in a fast loop |
   | `skills/rc-router/playbooks/engineering/security-critical.md` | 3 | Any engineering run classified Tier 3 |
   | `skills/rc-router/playbooks/engineering/refactor-pinned.md` | 2 | Structure changes while behaviour must stay identical |
   | `skills/rc-router/playbooks/engineering/ship-and-babysit.md` | 2 | A built and audited change needs shipping and CI or review triage |
   | `skills/rc-router/playbooks/engineering/garden-maintenance.md` | 2 | Repo hygiene, stale decisions, recurring issues |
   | `skills/rc-router/playbooks/study/topic-deep-dive.md` | 2 | Learn a topic from sources into grounded notes |
   | `skills/rc-router/playbooks/study/recall-and-drill.md` | 1 | Turn grounded notes into flashcards, quizzes, and a schedule |
   | `skills/rc-router/playbooks/study/socratic-session.md` | 1 | Stress-test a mental model through guided questions |
   | `skills/rc-router/playbooks/research/viability-spike.md` | 2 | Find out whether an approach can work, with a prototype |
   | `skills/rc-router/playbooks/research/research-report.md` | 2 | Investigate a question into a cited, decision-ready report |

   - An engineering run at Tier 3 always uses `security-critical`.
   - A study or research run at Tier 3 keeps its playbook, applies every Tier 3 gate, and binds the building role to `security_builder`.
   - If no playbook fits, say so and ask; do not improvise a workflow.

5. **Resolve models.** Bind every role in the playbook's `required_roles` from the profile.

   - For each role other than `independent_reviewer`: use `roles.<role>.primary`; if that model is unavailable here, use `secondary` when declared, then `fallback`. Never bind a model the profile does not declare for that role.
   - The **builder of record** is the model bound to the role the playbook names as builder of record: the author of the artifact that gets audited.
   - `independent_reviewer` is resolved from `review_matrix`, never from `roles`: take the builder of record's entry and use `primary` (at Tier 1, `tier1_primary` when declared); if that model is unavailable use the entry's `fallback`; if the builder has no entry use `default_fallback`.
   - Verify `reviewer != builder`, comparing names without regard to case or spacing. If the check fails, or no declared reviewer is reachable, do not dispatch an audit and do not self-review: apply the standalone rules in step 7, or stop and report.
   - Reviewers only review. Never promote a `review_matrix` model into a building role because a builder is unavailable.
   - When `quick_lookup` declares `exclusive: true`, its model serves Tier 0 lookups only and is never bound to another role.

6. **Print the Routing Plan** before executing anything, exactly in this shape:

   ```text
   Profile: <profile> | Tier: T<0-3> | Playbook: <domain>/<playbook>
   Route: <role -> model chain> | Reviewer: <model> (builder: <model>)
   Exit Gate: <required verification & review map artifacts>
   ```

   Build the Exit Gate line from the tier flags (`require_spec`, `require_verify`, `require_cross_model_audit`, `require_review_map`, `log_telemetry`) and the playbook's own exit gate.

7. **Execute, environment-aware.** Follow the playbook's Workflow Phases in order.

   - **Orchestrated (T3 Code, orchestrator tools present):** call `orchestrator_capabilities` once per thread, then dispatch each phase via `delegate_task` to the resolved model with a handoff packet: the phase goal and playbook phase number, the abstract role and tier, the input contracts already filled (Research Brief, Spec, Work Receipts), the contract under `contracts/` to fill as output, the domain rules and repo law that apply, and the evidence required to exit. Dispatch `rc-audit` in a fresh context with only the Spec, the diff scope, and the verification evidence, never the builder's reasoning. If a configured model is unavailable, use the fallback the profile declares; never silently self-review.
   - **Standalone single harness (no cross-provider tools):** run the same phases, contracts, and `rc-verify` gates locally without attempting cross-provider calls. Record the model that actually ran in each Work Receipt. If the harness can run a different model in a fresh context, use it for `rc-audit` and keep `reviewer != builder`. Otherwise issue no Audit Findings: mark the audit outstanding, record the reviewer as `none` in the Review Map ledger and as `reviewer_model: null` in the telemetry event, and put "cross-model audit not performed" first under Assumptions Requiring Approval. Note `degraded_single_harness: true` in the Review Map and the telemetry event.
   - A Tier 3 run never completes without a cross-model audit. When no distinct reviewer is reachable it still runs every phase up to and including `rc-verify`, then stops: the audit is recorded as outstanding and handed to the human, and no Review Map or telemetry row marks the run done until a different model has audited it.
   - A phase that fails its gate goes back to the role that produced the work. After two failed loops on the same gate, stop and report instead of trying a third time.

8. **Close out.** Confirm every item of the playbook's exit gate with evidence, have `rc-state` record the outcome and any new decision, and report the artifacts produced. If the run stopped early, record the blocker and the exact next step in the branch state.

## Definition of Done

- The Routing Plan was printed before any phase was dispatched.
- `reviewer != builder` was verified, or the run was halted or explicitly marked degraded.
- The playbook's exit gate is met with evidence, or the run stopped with the blocker and next step recorded through `rc-state`.
- For Tier 2 and Tier 3: a Review Map per `contracts/review-map.md` exists and one telemetry row was appended via `scripts/log-telemetry.mjs`.
- No phase ran outside its playbook order, and no tier was lowered below a path match.
