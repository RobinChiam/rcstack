# `rcstack-beta` Technical Specification (`SPEC.md`)



**Status:** Canonical Greenfield Build Specification (`v0.1.0-beta`)  

**Runtime Requirement:** Node.js `>=20` (ESM, zero third-party `npm` runtime dependencies) + POSIX `bash`



`rcstack-beta` is a Single Source of Truth (SSOT) personal multi-model agent operating system, portable skills library, and unified front-door router designed to run natively inside **T3 Code** (multi-provider orchestration) while degrading gracefully in standalone CLI harnesses (**Claude Code**, **Codex CLI**, **Antigravity**, **Cursor**).



---



## 1. Exact Repository Tree (2-Tier Layout)



The repository MUST match this exact structure: **10 top-level atomic skills** under `skills/` and **12 nested playbooks** (+ `TEMPLATE.md`) strictly under `skills/rc-router/playbooks/`.



```text

rcstack-beta/

├── README.md

├── AGENTS.md

├── SPEC.md                                     # Copy of this specification (optional reference)

├── docs/

│   └── decisions.md                            # Living Decisions Log for rcstack-beta

├── rules/

│   ├── engineering.md                          # Concise always-on taste rules for engineering

│   ├── study.md                                # Concise always-on taste rules for study

│   └── research.md                             # Concise always-on taste rules for research

├── profiles/

│   ├── schema.json                             # JSON Schema (Draft 2020-12) for profiles/*.yaml

│   ├── rcstack-engineering.yaml                # Model routing + tiers 0–3 + review matrix

│   ├── rcstack-study.yaml                      # Model routing + tiers 0–3 + review matrix

│   └── rcstack-research.yaml                   # Model routing + tiers 0–3 + review matrix

├── contracts/

│   ├── research-brief.md                       # Upstream grounding/triage handoff contract

│   ├── spec.md                                 # Merge-ready structural blueprint contract

│   ├── work-receipt.md                         # Subagent execution proof contract

│   ├── audit-findings.md                       # Fresh-context cross-model audit contract

│   ├── review-map.md                           # Risk-ranked human Review Map contract

│   └── telemetry-event.schema.json             # JSON Schema for ~/.rcstack/telemetry.jsonl rows

├── skills/

│   ├── rc-router/                              # [1/10] Unified front-door router (/rcstack)

│   │   ├── SKILL.md

│   │   └── playbooks/

│   │       ├── TEMPLATE.md                     # Canonical authoring template for playbooks

│   │       ├── engineering/                    # 7 engineering playbooks

│   │       │   ├── feature-build.md            # [1/12]

│   │       │   ├── bug-root-cause.md           # [2/12]

│   │       │   ├── vibe-iterate.md             # [3/12]

│   │       │   ├── security-critical.md        # [4/12]

│   │       │   ├── refactor-pinned.md          # [5/12]

│   │       │   ├── ship-and-babysit.md         # [6/12]

│   │       │   └── garden-maintenance.md       # [7/12]

│   │       ├── study/                          # 3 study playbooks

│   │       │   ├── topic-deep-dive.md          # [8/12]

│   │       │   ├── recall-and-drill.md         # [9/12]

│   │       │   └── socratic-session.md         # [10/12]

│   │       └── research/                       # 2 research playbooks

│   │           ├── viability-spike.md          # [11/12]

│   │           └── research-report.md          # [12/12]

│   ├── rc-init/SKILL.md                        # [2/10] Bootstrap target repo guardrails

│   ├── rc-doctor/SKILL.md                      # [3/10] Diagnose -> Cure repo hygiene audit

│   ├── rc-ground/SKILL.md                      # [4/10] 1M-ctx corpus/repo grounding + citations

│   ├── rc-architect/SKILL.md                   # [5/10] Merge-ready structural blueprint

│   ├── rc-verify/SKILL.md                      # [6/10] Deterministic lint/type/test/runtime proof

│   ├── rc-audit/SKILL.md                       # [7/10] Fresh-context cross-model code/sec review

│   ├── rc-state/SKILL.md                       # [8/10] docs/decisions.md + .rcstack/state/<branch>.md

│   ├── rc-review-map/SKILL.md                  # [9/10] Synthesize Work Receipts -> Review Map + log

│   └── rc-retro/SKILL.md                       # [10/10] Monthly telemetry review & stack tuning

├── adapters/

│   └── install.sh                              # Idempotent harness symlink installer (--dry-run)

└── scripts/

    ├── verify.mjs                              # Deterministic repo validator (zero npm deps)

    └── log-telemetry.mjs                       # Validates & appends row to ~/.rcstack/telemetry.jsonl

```



### Structural Invariants

- **No rogue top-level skills:** `skills/` MUST contain ONLY the exact 10 directories listed above.

- **No misplaced playbooks:** Playbooks MUST live ONLY inside `skills/rc-router/playbooks/{engineering,study,research}/`. No top-level `playbooks/` directory is permitted.

- **Model-agnosticism:** Concrete model names (`GPT 6.2`, `Claude Opus`, `Claude Fable`, `Claude Sonnet`, `Gemini 4`, `Cursor Grok`, `Gemini Notebook`) MUST NEVER appear inside `skills/` or `skills/rc-router/playbooks/`. Only `profiles/*.yaml` (and documentation in `README.md`) bind abstract roles to concrete models.



---



## 2. Skill & Playbook Contracts



### 2.1 Top-Level Atomic Skills (`skills/<name>/SKILL.md`)



Every top-level `SKILL.md` MUST begin with valid YAML frontmatter:



```yaml

---

name: rc-audit

description: Run a fresh-context cross-model review enforcing reviewer != builder and emitting Blocker/Major/Nit findings.

version: 0.1.0

entry_mode: router_dispatched   # Enum: front_door | standalone_or_router | router_dispatched

role: independent_reviewer      # Abstract role name from profiles/schema.json (or "router" / "local_deterministic")

invokes_contracts:

  - contracts/audit-findings.md

---

```



**Exact `entry_mode` assignments across the 10 skills:**

- `front_door`: `rc-router`

- `standalone_or_router`: `rc-init`, `rc-doctor`, `rc-retro`

- `router_dispatched`: `rc-ground`, `rc-architect`, `rc-verify`, `rc-audit`, `rc-state`, `rc-review-map`



**Mandatory Markdown sections (exact `##` heading titles):**

1. `## Single Job` — One crisp sentence defining the skill's sole responsibility.

2. `## When to Use` — Concise bullet criteria for valid invocation.

3. `## Do NOT Use When` — Explicit negative boundaries:

   - For all `router_dispatched` skills, this section MUST contain the explicit boundary sentence:

     > Do NOT self-trigger this skill autonomously as part of a multi-step workflow outside `rc-router` (`/rcstack`). Run directly only when explicitly invoked by the user or dispatched by `rc-router`.

   - For `standalone_or_router` skills, explicitly state when to run directly vs. when to defer to `rc-router`.

   - For `rc-router`, explicitly state when NOT to invoke routing ceremony (e.g., Tier 0 trivial one-line edits or direct user-invoked standalone checks).

4. `## Procedure` — Imperative, numbered, model-agnostic execution steps referencing `contracts/*` and abstract roles.

5. `## Definition of Done` — Concrete, verifiable exit criteria (files, evidence, or contract output required before completion).



### 2.2 `rc-router` Specific Behavior (`skills/rc-router/SKILL.md`)

`rc-router` (invoked via `/rcstack`) owns **both** playbook selection AND model routing in a single pass:

1. Identify target profile (`rcstack-engineering`, `rcstack-study`, or `rcstack-research`; default `rcstack-engineering`).

2. Load `profiles/<profile>.yaml`, `rules/<domain>.md`, repo `AGENTS.md`, `docs/decisions.md`, and `.rcstack/state/<branch>.md` (if present).

3. Classify **Risk Tier (`0`–`3`)**, automatically escalating to **Tier 3** if touched/target paths match any glob in `tier3_path_patterns` from the active profile or repo `AGENTS.md`.

4. Select the matching nested playbook under `skills/rc-router/playbooks/<domain>/<playbook>.md`.

5. Resolve concrete models from `profiles/<profile>.yaml`, verifying `reviewer != builder` before dispatch.

6. Print a compact **Routing Plan** before executing:

   ```text

   Profile: <profile> | Tier: T<0-3> | Playbook: <domain>/<playbook>

   Route: <role -> model chain> | Reviewer: <model> (builder: <model>)

   Exit Gate: <required verification & review map artifacts>

   ```

7. **Environment-aware execution:**

   - **T3 Code (orchestrator tools present):** Call `orchestrator_capabilities` once per thread, dispatch phases via `delegate_task` with `contracts/` handoff packets, and enforce fresh-context cross-model `rc-audit` (`reviewer != builder`). If a configured model is unavailable, use the profile's declared fallback; never silently self-review.

   - **Standalone CLI (Claude Code, Codex CLI, Cursor, Antigravity without cross-provider tools):** Execute the same playbook phases, contracts, and `rc-verify` gates locally in single-harness mode without attempting unavailable cross-provider calls; note `degraded_single_harness: true` in the Review Map / telemetry event.



### 2.3 Nested Playbooks (`skills/rc-router/playbooks/<domain>/<playbook>.md`)



Every nested playbook (all 12 files, excluding `TEMPLATE.md`) MUST begin with valid YAML frontmatter:



```yaml

---

name: feature-build

profile: rcstack-engineering     # Must match parent directory domain

entry_mode: router_only          # MUST ALWAYS be "router_only"

default_tier: 2                  # Integer 0..3

required_skills:

  - rc-state

  - rc-architect

  - rc-verify

  - rc-audit

  - rc-review-map

required_roles:

  - systems_research

  - architect_blueprint

  - primary_builder

  - independent_reviewer

contracts:

  - contracts/research-brief.md

  - contracts/spec.md

  - contracts/work-receipt.md

  - contracts/audit-findings.md

  - contracts/review-map.md

---

```



**Mandatory Markdown sections (exact `##` heading titles):**

1. `## Router-Only Invocation Boundary` — MUST include the exact verbatim boundary rule:

   > **ROUTER-ONLY:** This playbook MUST ONLY be invoked by `rc-router` (`/rcstack`) after profile selection, risk-tier classification, and model resolution. Never execute this playbook standalone or bypass `rc-router`.

2. `## Do NOT Use When` — Explicit negative boundaries naming which other playbook or skill handles adjacent tasks.

3. `## Workflow Phases` — Numbered sequence composing `required_skills`, `required_roles`, and `contracts` (zero concrete model names).

4. `## Exit Gate & Definition of Done` — Hard completion gates (e.g., passing `rc-verify`, zero open `Blocker` findings in `rc-audit`, emitted `Review Map` + telemetry row for Tier 2+).



### 2.4 Canonical 12 Playbooks Summary

- **`engineering/` (`rcstack-engineering`):**

  1. `feature-build` (Tier 2): `rc-state` → `rc-architect` (`systems_research` → `architect_blueprint`) → build (`primary_builder`) → `rc-verify` → `rc-audit` → `rc-review-map`.

  2. `bug-root-cause` (Tier 2): reproduce with failing test first → isolate root cause (no symptom patches) → fix → `rc-verify` → `rc-audit` → harden guardrail + `rc-state` / `rc-review-map`.

  3. `vibe-iterate` (Tier 1): rapid loop (`vibe_executor`) for prototypes/UI tweaks/spikes; keeps `rc-verify`, skips Review Map ceremony.

  4. `security-critical` (Tier 3): auto-escalated auth/sandbox/containers/symlinks/infra/schema track; `systems_research` → `architect_blueprint` → `security_builder` → `rc-verify` → strict cross-model `rc-audit` → `rc-review-map`.

  5. `refactor-pinned` (Tier 2): characterization tests pinning existing behavior → small atomic structural steps → `rc-verify` per step → `rc-audit` → `rc-review-map`.

  6. `ship-and-babysit` (Tier 2): final `rc-verify` + unslop pass → generate PR body from `rc-review-map` → triage CI/review feedback safely.

  7. `garden-maintenance` (Tier 2): `rc-doctor` (`Diagnose` → approved atomic `Cure` commits) → prune stale `docs/decisions.md` via `rc-state` → promote repeat issues into deterministic checks.

- **`study/` (`rcstack-study`):**

  8. `topic-deep-dive` (Tier 2): `rc-ground` (ingest + curate citations) → `architect_blueprint` (note structure & study guide) → `systems_research` (first-principles walkthrough) → `rc-audit` (source/citation fact-audit).

  9. `recall-and-drill` (Tier 1): convert grounded notes into active-recall flashcards, edge-case quizzes, and spaced-repetition schedule (`primary_builder` / `vibe_executor`).

  10. `socratic-session` (Tier 1): guided questioning and mental-model stress-testing without giving away answers prematurely (`vibe_executor`).

- **`research/` (`rcstack-research`):**

  11. `viability-spike` (Tier 2): `rc-ground` prior art → time-boxed throwaway prototype (`primary_builder` or `security_builder`) → `rc-verify` → evaluate strengths, weaknesses, and failure modes.

  12. `research-report` (Tier 2): deep multi-source investigation (`deep_grounding` + `systems_research`) → `architect_blueprint` synthesis → adversarial devil's-advocate `rc-audit` → decision-ready cited report + `rc-review-map`.



---



## 3. Profiles & Schemas (`profiles/`)



### 3.1 Strict YAML Subset Rule

Because `scripts/verify.mjs` has zero external `npm` dependencies, all `profiles/*.yaml` files MUST use a clean, strict YAML subset:

- 2-space indentation only (NO tabs).

- Mappings (`key: value`), nested maps, block sequences (`- item` or `- key: value`), comments (`#`), booleans (`true`/`false`), integers, and plain or double-quoted strings.

- No YAML anchors (`&`/`*`), tags, or multi-line block scalars (`|`/`>`) inside `profiles/*.yaml`.



### 3.2 `profiles/schema.json` Contract

`profiles/schema.json` (JSON Schema Draft 2020-12) MUST define and constrain:

- `schema_version`: const `"1.0"`

- `profile`: enum `["rcstack-engineering", "rcstack-study", "rcstack-research"]`

- `domain`: enum `["engineering", "study", "research"]`

- `description`: non-empty string

- `invariants`:

  - `require_reviewer_not_equal_builder`: const `true`

  - `require_fresh_context_audit`: const `true`

  - `allow_self_review_on_fallback`: const `false`

- `tier3_path_patterns`: array of glob strings (e.g., `auth/**`, `sandbox/**`, `infra/**`, `**/Dockerfile*`, `adapters/install.sh`, `scripts/verify.mjs`, `profiles/schema.json`)

- `roles`: object with required abstract role keys:

  - `systems_research` (`primary`, `fallback`)

  - `architect_blueprint` (`primary`, `fallback`)

  - `primary_builder` (`primary`, `fallback`)

  - `security_builder` (`primary`, `fallback`)

  - `vibe_executor` (`primary`, `secondary`, `fallback`)

  - `deep_grounding` (`primary`, `paired_with`, `companion_tools`, `fallback`)

  - `quick_lookup` (`primary`, `exclusive`: boolean)

- `review_matrix`: map of `<builder_model_name>` → `{ primary, tier1_primary?, fallback }` plus required `default_fallback` string.

  - Every model appearing as `primary`, `secondary`, or `fallback` in `primary_builder`, `security_builder`, `vibe_executor`, `systems_research`, or `architect_blueprint` MUST have an entry in `review_matrix`.

  - Invariant enforced by `scripts/verify.mjs`: for every entry `builder -> { primary, tier1_primary?, fallback }`, `primary !== builder`, `tier1_primary !== builder`, `fallback !== builder`, and `primary !== fallback`.

- `risk_tiers`: object with keys `"0"`, `"1"`, `"2"`, `"3"`, each containing:

  - `name` (string)

  - `default_roles` (array of valid role names)

  - `require_spec` (boolean)

  - `require_verify` (boolean)

  - `require_cross_model_audit` (boolean)

  - `require_review_map` (boolean)

  - `log_telemetry` (boolean)



### 3.3 Exact Model Mappings Across Profiles



#### A. `profiles/rcstack-engineering.yaml`

| Abstract Role | Primary | Secondary / Paired | Fallback |

| :--- | :--- | :--- | :--- |

| `systems_research` | `GPT 6.2 Astra` | — | `Gemini 4 Neon` |

| `architect_blueprint` | `Claude Fable 5.2` | — | `GPT 6.2 Astra` |

| `primary_builder` | `Gemini 4 Neon` | — | `GPT 6.2 Sol` |

| `security_builder` | `Claude Opus 5.5` | — | `GPT 6.2 Astra` |

| `vibe_executor` | `GPT 6.2 Sol` | `Gemini 4 Neon` | `Claude Sonnet 5.5` |

| `deep_grounding` | `Gemini 4 Neon` | paired: `GPT 6.2 Astra`; companions: `["Gemini Notebook"]` | `GPT 6.2 Astra` |

| `quick_lookup` | `Gemini 4 Hydrogen` | `exclusive: true` | `Gemini 4 Hydrogen` |



**`review_matrix` (`reviewer != builder` enforced):**

- `Gemini 4 Neon` → `primary: Claude Opus 5.5`, `fallback: Cursor Grok 4.7`

- `Claude Opus 5.5` → `primary: Gemini 4 Neon`, `fallback: Cursor Grok 4.7`

- `GPT 6.2 Sol` → `primary: Claude Opus 5.5`, `tier1_primary: Gemini 4 Neon`, `fallback: Cursor Grok 4.7`

- `Claude Sonnet 5.5` → `primary: Gemini 4 Neon`, `fallback: Cursor Grok 4.7`

- `GPT 6.2 Astra` → `primary: Claude Opus 5.5`, `fallback: Cursor Grok 4.7`

- `Claude Fable 5.2` → `primary: Gemini 4 Neon`, `fallback: Cursor Grok 4.7`

- `default_fallback`: `Cursor Grok 4.7`



**Risk Tiers (`0`–`3`):**

- **Tier `0` (`trivial_lookup`):** `quick_lookup`; `require_spec: false`, `require_verify: false`, `require_cross_model_audit: false`, `require_review_map: false`, `log_telemetry: false`.

- **Tier `1` (`fast_iteration`):** `vibe_executor`, `primary_builder`; `require_spec: false`, `require_verify: true`, `require_cross_model_audit: false`, `require_review_map: false`, `log_telemetry: false`.

- **Tier `2` (`standard_delivery`):** `systems_research`, `architect_blueprint`, `primary_builder`; `require_spec: true`, `require_verify: true`, `require_cross_model_audit: true`, `require_review_map: true`, `log_telemetry: true`.

- **Tier `3` (`security_critical`):** `systems_research`, `architect_blueprint`, `security_builder`; `require_spec: true`, `require_verify: true`, `require_cross_model_audit: true`, `require_review_map: true`, `log_telemetry: true`.



#### B. `profiles/rcstack-study.yaml`

Uses the exact same schema and `review_matrix` invariant:

- `deep_grounding`: `Gemini 4 Neon` (paired: `GPT 6.2 Astra`, companions: `["Gemini Notebook"]`, fallback: `GPT 6.2 Astra`)

- `architect_blueprint` (study guides & note structures): `Claude Fable 5.2` (fallback: `GPT 6.2 Astra`)

- `systems_research` (first-principles derivations): `GPT 6.2 Astra` (fallback: `Claude Fable 5.2`)

- `primary_builder` (flashcards, quizzes, spaced-repetition schedules): `Gemini 4 Neon` (fallback: `Claude Sonnet 5.5`)

- `security_builder` (rigorous formal/exam proof checks): `Claude Opus 5.5` (fallback: `GPT 6.2 Astra`)

- `vibe_executor` (Socratic & active-recall drills): `GPT 6.2 Sol` (secondary: `Gemini 4 Neon`, fallback: `Claude Sonnet 5.5`)

- `quick_lookup`: `Gemini 4 Hydrogen` (`exclusive: true`)

- `review_matrix`: same strict `reviewer != builder` pairings (citation & factual accuracy audit; fallback `Cursor Grok 4.7`).



#### C. `profiles/rcstack-research.yaml`

Uses the exact same schema and `review_matrix` invariant:

- `deep_grounding` (prior art & corpus synthesis): `Gemini 4 Neon` (paired: `GPT 6.2 Astra`, companions: `["Gemini Notebook"]`, fallback: `GPT 6.2 Astra`)

- `systems_research` (hypotheses, trade-offs, failure modes): `GPT 6.2 Astra` (fallback: `Claude Opus 5.5`)

- `architect_blueprint` (decision-ready research report): `Claude Fable 5.2` (fallback: `GPT 6.2 Astra`)

- `primary_builder` (viability spike prototype): `Gemini 4 Neon` (fallback: `GPT 6.2 Sol`)

- `security_builder` (sandboxed/high-risk spike): `Claude Opus 5.5` (fallback: `GPT 6.2 Astra`)

- `vibe_executor` (rapid experiment iteration): `GPT 6.2 Sol` (secondary: `Gemini 4 Neon`, fallback: `Claude Sonnet 5.5`)

- `quick_lookup`: `Gemini 4 Hydrogen` (`exclusive: true`)

- `review_matrix`: same strict `reviewer != builder` pairings (adversarial devil's-advocate critique; fallback `Cursor Grok 4.7`).



---



## 4. Handoff & Memory Contracts (`contracts/` & Memory Layer)



All 6 contract files under `contracts/` MUST define explicit required fields and a copy-pasteable template.



### 4.1 `contracts/work-receipt.md`

Every subagent or build phase emits a compact, evidence-backed **Work Receipt**:

- **Metadata:** `task_id`, `role`, `model_used`, `risk_tier`, `branch`, `commit_or_diff_scope`

- **Summary of Changes:** concise bullet list with exact file paths (`path:line` where relevant)

- **Verification Evidence:** exact commands run + exit codes + short pass/fail stdout summary (no hand-waving)

- **Assumptions & Trade-offs:** explicit list of non-obvious decisions requiring human sign-off

- **Known Risks / Follow-ups:** anything deferred or uncovered



### 4.2 `contracts/review-map.md`

Synthesized by `rc-review-map` from all Work Receipts + `rc-audit` findings for Tier 2/3 runs:

1. **Executive Delta:** 2–3 lines stating what changed and why.

2. **Risk-Ranked Reading Order:** table ordered High → Medium → Low risk (`File / Area`, `Risk`, `Why It Matters`, `Focus Question for Human`).

3. **Assumptions Requiring Approval:** numbered yes/no sign-off items.

4. **Cross-Model Audit Ledger:** Builder model, Reviewer model (`reviewer != builder`), counts of `Blocker / Major / Nit`, and disposition of every Blocker/Major.

5. **Verification Matrix:** table of commands executed (`Command`, `Result`, `Scope`).

6. **Telemetry Confirmation:** confirmation that 1 JSONL row was appended via `scripts/log-telemetry.mjs`.



### 4.3 Other Canonical Contracts

- **`contracts/research-brief.md`:** Goal, Grounded Facts (with exact file/URL/page citations), Open Questions, Constraints, Recommended Approach.

- **`contracts/spec.md`:** Problem Statement, Non-Goals, Data Shapes & Interfaces, Module Boundaries, Failure Modes, Acceptance Criteria, Verification Plan.

- **`contracts/audit-findings.md`:** Metadata (`builder_model`, `reviewer_model`, `diff_scope`, `fresh_context: true`), Findings grouped strictly by `Blocker` / `Major` / `Nit` (each with `file:line`, `impact`, `concrete_fix`), and Verdict (`APPROVE` | `CHANGES_REQUESTED`).

- **`contracts/telemetry-event.schema.json`:** JSON Schema for `~/.rcstack/telemetry.jsonl` rows (see Section 5.2).



### 4.4 Two-Layer Memory Contracts

1. **Evergreen Living Decisions Log (`docs/decisions.md` — committed to repo):**

   Every entry MUST follow this exact template:

   ```markdown

   ### DEC-NNN: <Short Title>

   - **Date:** YYYY-MM-DD

   - **Status:** Accepted | Superseded by DEC-XXX

   - **Decision:** <What we chose and why>

   - **Rejected Alternative:** <What we explicitly ruled out and why>

   - **Guardrail:** <Deterministic check, lint rule, or invariant enforcing this decision>

   ```

2. **Ephemeral Branch State (`.rcstack/state/<branch-slug>.md` — globally gitignored, never committed):**

   Managed by `rc-state` for cross-session continuity:

   ```markdown

   # Branch State: <branch>

   - **Updated:** <ISO-8601 timestamp>

   - **Profile / Tier / Playbook:** <profile> | T<0-3> | <domain>/<playbook>

   - **Active Goal:** <1–2 sentences>

   - **Completed Phases:** <checklist with commit SHAs or receipt refs>

   - **Next Step:** <exact next action for a resumed session>

   - **Open Blockers / Assumptions:** <list or "None">

   ```



---



## 5. Deterministic Scripts & Installer



### 5.1 `scripts/verify.mjs`

Zero external dependencies (Node.js `>=20` ESM). Supports `--slice=1`, `--slice=2`, or `--slice=3` (default: full validation = `3`). Exits `0` on full pass, `1` on any error, printing structured `[PASS]` / `[FAIL]` diagnostics per check group.



**Mandatory validation checks:**

1. **Slice 1+ Checks (Repo Skeleton & Docs):**

   - Required base files exist: `README.md`, `AGENTS.md`, `docs/decisions.md`, `scripts/verify.mjs`.

   - `docs/decisions.md` contains at least one valid `DEC-` entry with `Rejected Alternative:` and `Guardrail:`.

   - No forbidden top-level `playbooks/` directory exists.

   - Any directories currently under `skills/` are a strict subset of the 10 approved skill names.

2. **Slice 2+ Checks (Profiles, Contracts, Router, Playbooks):**

   - `profiles/schema.json` parses as valid JSON; all 3 profile YAMLs (`rcstack-engineering.yaml`, `rcstack-study.yaml`, `rcstack-research.yaml`) parse cleanly using a strict zero-dep YAML parser (rejecting tabs and malformed syntax) and conform to every required field, enum, and type in `profiles/schema.json`.

   - **`reviewer != builder` invariant:** For all 3 profiles, every model assigned to `primary_builder`, `security_builder`, `vibe_executor`, `systems_research`, or `architect_blueprint` (primary, secondary, fallback) MUST exist in `review_matrix`, AND for every entry in `review_matrix`, `primary !== builder`, `tier1_primary !== builder` (if present), `fallback !== builder`, and `primary !== fallback`.

   - All 6 files under `contracts/` exist; `contracts/telemetry-event.schema.json` parses as valid JSON.

   - `skills/rc-router/SKILL.md` passes full skill frontmatter + required headings + negative-boundary checks.

   - `skills/rc-router/playbooks/` contains `TEMPLATE.md` and ONLY the exact 12 approved playbooks across `engineering/` (7), `study/` (3), `research/` (2).

   - Every playbook passes: valid frontmatter (`name`, `profile` matching domain, `entry_mode === "router_only"`, `default_tier` 0–3, valid `required_skills` within approved 10, valid `required_roles` defined in `profiles/schema.json`, existing `contracts` paths), all 4 mandatory `##` headings, verbatim `ROUTER-ONLY:` negative boundary under `## Router-Only Invocation Boundary`, and **zero hardcoded model names**.

3. **Slice 3 (Full Default) Checks (All Atomic Skills, Rules, Telemetry, Installer):**

   - All 10 exact top-level skill directories exist under `skills/` (no missing, no extras), each with valid `SKILL.md` frontmatter (`name` matching folder, exact `entry_mode` per Section 2.1, valid `role`, valid `invokes_contracts` paths), all 5 mandatory `##` headings, required `rc-router` negative boundary on all `router_dispatched` skills, and **zero hardcoded model names**.

   - All 3 `rules/{engineering,study,research}.md` exist and are non-empty.

   - `scripts/log-telemetry.mjs` exists and passes `node --check`.

   - `adapters/install.sh` exists, is executable (`chmod +x`), passes `bash -n`, and supports `--dry-run`.

   - Cross-reference integrity: every `contracts/*`, `profiles/*`, `rules/*`, and `skills/*` path referenced in frontmatter or `rc-router` resolves to a real file.



### 5.2 `scripts/log-telemetry.mjs`

Zero-dependency Node.js ESM CLI that validates a telemetry event against `contracts/telemetry-event.schema.json` and atomically appends one newline-delimited JSON line to `~/.rcstack/telemetry.jsonl` (creating `~/.rcstack/` if missing; overridable via `--file <path>` for testing).



**Required fields in `contracts/telemetry-event.schema.json`:**

- `schema_version`: `"1.0"`

- `timestamp`: ISO-8601 UTC string

- `repo`: string (repo basename/slug)

- `branch`: string

- `profile`: `"rcstack-engineering" | "rcstack-study" | "rcstack-research"`

- `playbook`: string (e.g., `"engineering/feature-build"`)

- `risk_tier`: integer `0..3`

- `builder_model`: string

- `reviewer_model`: string (`!== builder_model` when non-null, or `null` if Tier 0/1 / degraded single harness)

- `degraded_single_harness`: boolean

- `first_pass_verify_passed`: boolean

- `audit_blockers`: integer `>= 0`

- `audit_majors`: integer `>= 0`

- `audit_nits`: integer `>= 0`

- `human_override`: boolean

- `notes`: optional string



Supports both `--json '<payload>'` and piped `stdin`, plus `--dry-run` (validates and prints without writing).



### 5.3 `adapters/install.sh`

Idempotent POSIX `bash` installer (`set -euo pipefail`) with `--dry-run` support:

- Resolves the absolute path of the `rcstack-beta` repository dynamically (`SCRIPT_DIR` / `REPO_ROOT`).

- Target harness skill directories:

  - `~/.agents/skills`

  - `~/.claude/skills`

  - `~/.codex/skills`

- For each of the **10 top-level skill directories** in `$REPO_ROOT/skills/*` (and ONLY top-level directories, never flattening `rc-router/playbooks/`):

  - Creates target parent directory if missing.

  - If destination does not exist → creates symlink `<target>/<skill> -> $REPO_ROOT/skills/<skill>`.

  - If destination is already a symlink pointing to the exact same source → logs `[OK] already linked` (idempotent).

  - If destination is a symlink pointing elsewhere → updates symlink cleanly (or prints planned update in `--dry-run`).

  - If destination exists and is a real file or directory (NOT a symlink) → **refuses to overwrite**, prints a clear error, and exits non-zero.

- Ensures `.rcstack/state/` is listed in the user's global gitignore (`git config --global core.excludesFile`, defaulting to `~/.config/git/ignore` if unset), creating/appending idempotently (or printing planned change in `--dry-run`).

- With `--dry-run`: makes **zero filesystem or git config mutations** and prints every planned action clearly.



---



## 6. Phased Build Order (Vertical Slices)



Build strictly in 3 sequential vertical slices. Do NOT start the next slice until the current slice passes verification.



- **Slice 1 — Foundation & Validator First:**

  - Create clean repo skeleton, `AGENTS.md` (repo law for maintaining `rcstack-beta`, <100 lines), `README.md`, initial `docs/decisions.md` (recording key architecture choices: 2-tier layout, router-only playbooks, `reviewer != builder`, zero-dep validator), and complete `scripts/verify.mjs` (supporting `--slice=1|2|3`).

  - **Gate:** `node scripts/verify.mjs --slice=1` passes with 0 errors.

- **Slice 2 — Profiles, Contracts, Router & Playbooks:**

  - Create `profiles/schema.json`, `profiles/rcstack-{engineering,study,research}.yaml`, all 6 `contracts/*`, `rules/{engineering,study,research}.md`, `skills/rc-router/SKILL.md`, `skills/rc-router/playbooks/TEMPLATE.md`, and all 12 nested playbooks.

  - **Gate:** `node scripts/verify.mjs --slice=2` passes with 0 errors.

- **Slice 3 — Remaining Atomic Skills, Telemetry & Installer:**

  - Create the remaining 9 top-level skills (`rc-init`, `rc-doctor`, `rc-ground`, `rc-architect`, `rc-verify`, `rc-audit`, `rc-state`, `rc-review-map`, `rc-retro`), `scripts/log-telemetry.mjs`, and `adapters/install.sh`.

  - **Gate:** `node scripts/verify.mjs` (full default check), `node scripts/log-telemetry.mjs --dry-run` smoke test, and `bash adapters/install.sh --dry-run` all pass with 0 errors.
