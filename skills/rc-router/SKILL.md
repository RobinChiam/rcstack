---
name: rc-router
description: Unified front-door router classifying risk tiers, loading playbooks, resolving live models, and gating delivery.
version: 0.1.0
entry_mode: front_door
capability: router
invokes_contracts:
  - contracts/research-brief.md
  - contracts/spec.md
  - contracts/work-receipt.md
  - contracts/audit-findings.md
  - contracts/review-map.md
invokes_scripts:
  - scripts/rc-state.mjs
  - scripts/rc-receipt.mjs
  - scripts/rc-log.mjs
---

# rc-router (`/rcstack`)

## Single Job

Turn one request into a classified, model-resolved run of exactly one playbook, and refuse to call it done until that playbook's exit gate holds.

## When to Use

- The human invokes `/rcstack`, or asks for work that will change code, notes, or a decision.
- A task is being resumed and state may exist for this repository and branch.
- Work in progress turns out riskier than it was classified and must be re-routed.

## Do NOT Use When

- **Tier 0 lookups.** A question answered by reading or recalling ("what does this function do",
  "where is this configured") gets a direct answer from `quick_lookup`. Skip the routing plan,
  state file, receipts, audit, Review Map, and telemetry. Heavy ceremony on a lookup is a defect.
- You are a delegated subagent inside a playbook phase. Do the phase, return its contract, and
  never route, re-classify, or touch state.
- The machine needs model discovery, profile validation, or harness links checked — use `rc-setup`.
- A repository needs its `AGENTS.md`, decisions log, checks, or CI created — use `rc-init`.
- The request is a repository health check with no task attached — use `rc-doctor`.
- The request is to learn from past runs — use `rc-retro`.

## Procedure

Installed paths: contracts are `~/.rcstack/dist/contracts/*`, scripts are
`~/.rcstack/dist/scripts/*`, playbooks are
`~/.rcstack/dist/skills/rc-router/playbooks/<domain>/<playbook>.md`. Run scripts with `node`.

1. **Load context.**
   - Pick the profile by domain, then read `~/.rcstack/profiles/<profile>.yaml`. If it is missing,
     fall back to `~/.rcstack/dist/defaults/profiles/<profile>.yaml` and say so.
   - Read `~/.rcstack/dist/rules/<domain>.md` and apply it for the whole run.
   - Read the target repository's `AGENTS.md` and `docs/decisions.md`. Repo law outranks this skill.
   - If the repository has a `specs/` directory, find the spec directory the request belongs to
     and read its `spec.md` and the `spec.md` of every parent directory, outermost first. A parent
     spec constrains its sub-specs.
   - Run `node ~/.rcstack/dist/scripts/rc-state.mjs reconcile --repo <repo>`. Exit `2` means
     drift: **git beats state**. Report the drift, trust `git status` and `git log`, and continue
     from what git shows. Never edit a state file by hand.

2. **Classify and route.** Assign all four before any work starts.
   - **Profile:** `rcstack-engineering` for software changes, `rcstack-study` for learning,
     `rcstack-research` for investigations and viability questions.
   - **Risk tier:** the highest row that applies.

     | Tier | Use when | Floor |
     | :--- | :--- | :--- |
     | 0 | Read-only lookup or explanation; nothing changes | `A0` |
     | 1 | Fast, easily reverted iteration: prototypes, UI polish, practice sessions | `A1` |
     | 2 | Anything that ships or that others rely on: features, fixes, refactors, reports | `A2` |
     | 3 | Auth, sandboxing, containers, symlinks, infrastructure, schemas, installers | `A3` |

   - **Tier 3 auto-escalation:** if any path the task targets or touches matches the profile's
     `tier3_path_patterns`, the tier is 3 and the playbook is `engineering/security-critical`.
     Re-check every Work Receipt's `files_touched` against the patterns; on a match run
     `rc-state.mjs transition --escalate-tier 3` and re-route. Escalation is one-way: only the
     human de-escalates.
   - **Playbook:** exactly one.

     | Request | Playbook |
     | :--- | :--- |
     | New capability with acceptance criteria | `engineering/feature-build` |
     | Something is broken | `engineering/bug-root-cause` |
     | Prototype, UI tweak, exploratory sketch | `engineering/vibe-iterate` |
     | Tier 3 path or security-sensitive change | `engineering/security-critical` |
     | Restructure without changing behavior | `engineering/refactor-pinned` |
     | Approved work needs a PR, CI, review triage | `engineering/ship-and-babysit` |
     | Repository hygiene that changes files | `engineering/garden-maintenance` |
     | Understand a topic from sources | `study/topic-deep-dive` |
     | Practice recall on known material | `study/recall-and-drill` |
     | Stress-test a mental model by questioning | `study/socratic-session` |
     | "Could this approach work?" answered by building | `research/viability-spike` |
     | A decision answered by reading and synthesis | `research/research-report` |

   - **Required assurance floor:** the playbook's `required_assurance`. After an escalation it is
     at least the new tier's floor.

3. **Discover live models.**
   - In T3 Code, call `orchestrator_capabilities` once per thread. If the orchestration tools are
     absent but the ACP shell bridge is available, use it for the same discovery and dispatch.
   - For each capability the playbook requires, take the profile binding and find a live provider
     with the same `driver_kind`. Map `model` to a live catalog id: two names match when they are
     equal after lowercasing and dropping every non-alphanumeric character, comparing the profile
     name with the live model's label, its id, or the provider's display name followed by the
     label. Pass the binding's `options` through unchanged. Never persist a provider instance id.
   - Walk each chain in order: the binding itself, then `secondary`, then `fallback`. A chain
     that runs out makes the run `BLOCKED`. Never fill a builder capability from outside its own
     chain, and never with a model that only appears as a reviewer.
   - **Reviewer:** the builder of record is the model that actually produced the diff. The
     `independent_reviewer` is `review_matrix[<builder>].primary` (`tier1_primary` at Tier 1 when
     present); if unreachable, that entry's `fallback`; for a builder with no entry,
     `default_fallback`. One audit has exactly one reviewer.
   - Prove `reviewer != builder` before dispatching anything. If no reviewer other than the
     builder is reachable, do not self-review: set `degraded_single_harness: true`, leave the
     audit counts `null` (the result tops out at `A1`), and carry an `ASSURANCE GAP`.
   - In a standalone CLI harness with no orchestrator, run every capability locally, set
     `degraded_single_harness: true`, and apply the same cap.

4. **Print the 3-line routing plan** before any work:

   ```text
   Profile: <profile> | Tier: T<0-3> (Assurance Floor: A<0-3>) | Playbook: <domain>/<playbook>
   Route: <capability -> model chain> | Reviewer: <model> (Builder: <model>)
   Exit Gate: <verify + receipt admission + audit + review map>
   ```

5. **Drive the state machine (Tier 2-3).** Tier 1 playbooks run without a state file.

   ```text
   TRIAGE -> RESEARCHING -> PLANNING -> EXECUTING <-> VERIFYING -> AUDITING -> AWAITING_REVIEW -> SHIPPED
                                             ^                       |
                                             +------ (Blocker) ------+
   (Any phase <-> BLOCKED)
   ```

   - **Open:** `rc-state.mjs init --repo <repo> --profile <profile> --playbook <playbook>
     --tier <n> --goal "<one line>"`. The floor comes from the playbook and tier;
     `--required-assurance <A>` can raise it, never lower it.
   - **Move:** `rc-state.mjs transition --repo <repo> --to <PHASE> --expected-rev <rev>`. A
     revision conflict means another writer moved the state: re-read it with `rc-state.mjs show`
     and decide again; never retry blindly. `BLOCKED` needs `--blocker "<reason>"` and returns
     only to the phase it left. A human change request at `AWAITING_REVIEW` returns to `EXECUTING`.
   - **Feature-local documents:** at `PLANNING` the spec is written to `specs/<feature>/spec.md`
     in the target repository; a sub-spec goes in a subdirectory of its parent spec's directory.
     Documents written before the audit (requirements, planning notes, the research brief) sit
     beside that `spec.md` and are committed with the work, inside the range the integrated
     receipt covers. The Review Map is not one of them: it is delivered at review and becomes
     the pull request body, because a file added after the integrated receipt would dirty the
     tree or reset the achieved assurance. Task state, telemetry, and Work Receipts never go there.
   - **Single writer (capability hiding):** only this main thread runs `rc-state.mjs`. Never put
     a `~/.rcstack/runtime/state/...` path, or the runtime directory, into a `delegate_task`
     brief. A brief carries the phase's contract, the slice and its allowed paths, the verify
     command, and the base commit. Subagents commit their work and return a Work Receipt only.
   - **Receipt admission:** every Work Receipt must pass `rc-receipt.mjs` before it counts.
     `rc-state.mjs transition --to <PHASE> --expected-rev <rev> --admit-receipt <file>
     --allowed-paths <slice globs>` runs the gate and records the result in one atomic step. A
     `REJECTED` receipt goes back to the builder with the gate's reasons, never into state or the
     Review Map.
   - **Audit:** dispatch the reviewer in a fresh context with the diff range, the spec, and
     `contracts/audit-findings.md` — not the builder's transcript. A `Blocker` returns the run to
     `EXECUTING`. When the audit is settled, write the integrated receipt for the whole range with
     the open finding counts and admit it. Only an integrated receipt — the task's base commit to
     the current `HEAD` — sets the achieved assurance; slice receipts are recorded but prove
     nothing about the whole, and any commit after it resets the achieved assurance to `A0`.
   - **Assurance shipping invariant:** achieved assurance must be at least the required floor.
     `rc-state.mjs` refuses `AWAITING_REVIEW` and `SHIPPED` below it, with open blockers, or with
     an uncommitted change in the working tree. If the repository lacks the
     checks to reach the floor, never fake confidence: tell the human, pass
     `--ack-assurance-gap`, put the **`ASSURANCE GAP`** banner on the Review Map, and log it.

6. **Close out.** At `AWAITING_REVIEW`, synthesize `contracts/review-map.md` and stop for the
   human. After approval: `--to SHIPPED`, append one row with `rc-log.mjs --json '<event>'`
   (fields in `contracts/telemetry-event.schema.json`) when the tier sets `log_telemetry`, then
   `rc-state.mjs close --repo <repo> --expected-rev <rev>`.

## Definition of Done

- The 3-line routing plan was printed before any work, with profile, tier, floor, and playbook.
- `reviewer != builder` was proven from the live catalog, or the run is flagged
  `degraded_single_harness` with an `ASSURANCE GAP`.
- Tier 2-3: every phase change went through `rc-state.mjs`, every Work Receipt was admitted by
  `rc-receipt.mjs`, and no state path left the main thread.
- The playbook's own exit gate holds.
- When the playbook produces a spec, the spec and the feature's documents are in its own
  directory under `specs/`, and nowhere else.
- Achieved assurance is at least the floor, or the `ASSURANCE GAP` banner is on the Review Map and
  in telemetry.
- The Review Map was delivered, the telemetry row was appended by `rc-log.mjs`, and the state was
  closed.
