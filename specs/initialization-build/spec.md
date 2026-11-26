# `rcstack-beta` Technical Specification (`specs/initialization-build/spec.md`)

**Status:** Canonical System Specification (`0.2.1`)
**Runtime Requirement:** Node.js `>=20` (ESM, zero third-party `npm` runtime dependencies; built-in `node:test`) + POSIX `bash` + `git`

`rcstack-beta` is a personal multi-model agent operating system, portable skills library, and unified front-door router built natively for **T3 Code** (multi-provider orchestration via `orchestrator_capabilities` / `delegate_task` + ACP shell fallback) with graceful single-harness degradation in standalone CLIs (**Claude Code**, **Codex CLI**, **Antigravity**, **Cursor**).

---

## 1. Three-Directory Architecture & Exact Repository Tree

`rcstack-beta` strictly separates **source code**, **installed machine runtime**, and **target project repositories** so dogfooding (`rcstack` building `rcstack`) never breaks the live environment mid-session.

### A. Source Repository (`rcstack-beta` — normal git repo, dev machine only)

```text
rcstack-beta/
├── README.md
├── AGENTS.md                                   # Repo law (<100 lines) + verify command for rcstack-beta
├── docs/                                      # Open to guides and reference material
│   └── decisions.md                            # Evergreen Living Decisions Log for rcstack-beta
├── specs/                                      # Every spec, each in its own directory (section 1.D)
│   ├── initialization-build/spec.md            # Canonical system specification (this document)
│   └── <feature>/                              # spec.md + the task's other documents (requirements.md, planning.md, ...)
│       ├── spec.md
│       └── <sub-feature>/spec.md               # Sub-spec, nested inside its parent spec's directory
├── rules/                                      # Concise always-on personal taste rules per variation
│   ├── engineering.md
│   ├── study.md
│   └── research.md
├── profiles/                                   # Default profile templates + JSON Schema (seed ~/.rcstack/profiles/)
│   ├── schema.json
│   └── rcstack-main.yaml                       # Consolidated domain routing
├── contracts/                                  # Canonical handoff & output schemas (never copied into target repos)
│   ├── research-brief.md
│   ├── spec.md
│   ├── work-receipt.md
│   ├── audit-findings.md
│   ├── review-map.md
│   └── telemetry-event.schema.json
├── skills/                                     # EXACTLY 5 top-level registered skills (ONLY these are symlinked)
│   ├── rc-router/                              # [1/5] Unified front-door router (/rcstack)
│   │   ├── SKILL.md
│   │   └── playbooks/                          # EXACTLY 13 nested playbooks (+ TEMPLATE.md)
│   │       ├── TEMPLATE.md
│   │       ├── engineering/                    # 8 engineering playbooks
│   │       │   ├── feature-build.md            # [1/13]
│   │       │   ├── bug-root-cause.md           # [2/13]
│   │       │   ├── vibe-iterate.md             # [3/13]
│   │       │   ├── security-critical.md        # [4/13]
│   │       │   ├── refactor-pinned.md          # [5/13]
│   │       │   ├── ship-and-babysit.md         # [6/13]
│   │       │   ├── garden-maintenance.md       # [7/13]
│   │       │   └── project-planning.md         # [8/13]
│   │       ├── study/                          # 3 study playbooks
│   │       │   ├── topic-deep-dive.md          # [9/13]
│   │       │   ├── recall-and-drill.md         # [10/13]
│   │       │   └── socratic-session.md         # [11/13]
│   │       └── research/                       # 2 research playbooks
│   │           ├── viability-spike.md          # [12/13]
│   │           └── research-report.md          # [13/13]
│   ├── rc-setup/SKILL.md                       # [2/5] Live T3 model discovery, profile validation & symlink sync
│   ├── rc-init/SKILL.md                        # [3/5] Modular opt-in bootstrapper for target repos
│   ├── rc-doctor/SKILL.md                      # [4/5] Diagnose -> Approved Atomic Cure repo gardener
│   └── rc-retro/SKILL.md                       # [5/5] Telemetry analysis -> concrete profile/skill tuning diffs
├── scripts/                                    # Zero-dep deterministic tools & repo validator
│   ├── verify.mjs                              # Repo invariant & contract validator (--slice=1|2|3)
│   ├── rc-state.mjs                            # Atomic locked single-writer state mutator + shadow git
│   ├── rc-receipt.mjs                          # 4-point deterministic Work Receipt admission gate
│   └── rc-log.mjs                              # Schema-validated JSONL telemetry appender
├── adapters/
│   ├── install.sh                              # Atomic promoter into ~/.rcstack/dist/ + harness symlinker
│   ├── release-install.sh                      # Standalone release installer template
│   └── build-release.sh                        # Package a verified tagged release
└── tests/                                      # Built-in `node --test` suites (hermetic tmpdir tests)
    ├── verify.test.mjs
    ├── rc-state.test.mjs
    ├── rc-receipt.test.mjs
    ├── rc-log.test.mjs
    └── install.test.mjs
```

### B. Installed Runtime Home (`~/.rcstack/` — exists on EVERY machine, managed by `adapters/install.sh`)

```text
~/.rcstack/
├── install-meta.json                           # { version, commit_sha, source: "local"|"release", installed_at }
├── dist/                                       # Atomically replaced on install/promote (read-only)
│   ├── rules/
│   ├── defaults/profiles/                      # Upstream default templates + schema.json
│   ├── contracts/
│   ├── scripts/
│   └── skills/                                 # Stable installed skills (EXCLUSIVE symlink target!)
│       ├── rc-router/
│       ├── rc-setup/
│       ├── rc-init/
│       ├── rc-doctor/
│       └── rc-retro/
├── profiles/                                   # Machine-active profiles (seeded on 1st install, NEVER clobbered)
│   └── rcstack-main.yaml                       # Consolidated domain routing
└── runtime/                                    # Local-only shadow git repo (`git init` inside, NEVER pushed)
    ├── .git/
    ├── state/
    │   └── <repo-slug>/
    │       └── <branch-slug>.md                # Ephemeral Active Task State (schema_version: 1, deleted on ship)
    └── telemetry.jsonl                         # Append-only local performance log across all repos
```

All harness skill directories symlink **exclusively to `~/.rcstack/dist/skills/<skill>`** (never into the dev repo):
- `~/.agents/skills/<skill>` → `~/.rcstack/dist/skills/<skill>`
- `~/.claude/skills/<skill>` → `~/.rcstack/dist/skills/<skill>`
- `~/.codex/skills/<skill>` → `~/.rcstack/dist/skills/<skill>`
- `~/.gemini/skills/<skill>` → `~/.rcstack/dist/skills/<skill>`
- `~/.cursor/skills/<skill>` → `~/.rcstack/dist/skills/<skill>`

### C. Target Project Repositories (`<project-repo>/`, including `rcstack-beta` itself)
Clean git repos bootstrapped via `rc-init` (`AGENTS.md`, `docs/decisions.md`, the `specs/` layout, strict checks, canonical `verify`, CI workflow). A feature's durable documents live under `specs/` (section 1.D). **Zero** ephemeral `rcstack` runtime state ever enters a target repository: task state, telemetry, and Work Receipts stay in `~/.rcstack/runtime/`.

### D. Feature-Local Specs (`<project-repo>/specs/`, including `rcstack-beta` itself)
Every spec lives in its own directory under `specs/`, together with the documents written while changing and implementing it. The system specification is one of them: `specs/initialization-build/spec.md` (this document) is canonical, and every other spec describes one change on top of it. No spec lives anywhere else in the repository.

```text
specs/
└── <feature>/                                  # A spec directory
    ├── spec.md                                 # Required in every spec directory
    ├── requirements.md                         # Optional: any other file the task needs
    ├── planning.md
    └── <sub-feature>/                          # Optional sub-spec, nested to any depth
        └── spec.md
```

- `specs/` holds only directories, and every directory under it, at any depth, MUST contain a `spec.md`. A sub-spec therefore always sits inside its parent spec's directory: `specs/<feature>/<sub-feature>/spec.md` requires `specs/<feature>/spec.md`.
- Directory names are lowercase kebab-case, and `spec.md` is a non-empty regular file. Any other regular file MAY sit beside it (`requirements.md`, `planning.md`, a research brief). No symbolic links. These documents are committed with the work, before the integrated receipt; the Review Map is delivered at review as the pull request body and is not written into the repository.
- A parent spec constrains its sub-specs. Documents about changing or implementing a feature live in that feature's directory and nowhere else in the repository.
- `rc-router` reads the spec directory a request belongs to (its `spec.md` and every parent `spec.md`) while loading context, and at `PLANNING` writes the spec of `contracts/spec.md` to `specs/<feature>/spec.md`.
- `specs/` is durable and committed. It is never staged into `~/.rcstack/dist/`, and it never holds task state, telemetry, or Work Receipts.

### Hard Structural Invariants
1. **Exact 5 Top-Level Skills:** `skills/` MUST contain ONLY `rc-router`, `rc-setup`, `rc-init`, `rc-doctor`, and `rc-retro`.
2. **Router-Only Playbooks:** Playbooks MUST live ONLY under `skills/rc-router/playbooks/{engineering,study,research}/`. No top-level `playbooks/` directory is permitted.
3. **Model-Agnostic Skills & Playbooks:** Concrete model names (`GPT 6.2`, `Claude Opus`, `Claude Fable`, `Claude Sonnet`, `Gemini 4`, `Cursor Grok`, `Gemini Notebook`) MUST NEVER appear inside `skills/` or `skills/rc-router/playbooks/`. Only `profiles/*.yaml` (and overview docs in `README.md`) bind abstract capabilities to concrete models.
4. **Feature-Local Specs:** Every directory under `specs/` MUST contain a `spec.md`, so a sub-spec always lives inside its parent spec's directory. `specs/` MUST NEVER be installed into `~/.rcstack/dist/` or hold runtime state.

---

## 2. Skill & Playbook Contracts

### 2.1 Top-Level Skills (`skills/<name>/SKILL.md`)

Required YAML frontmatter:
```yaml
---
name: rc-router
description: Unified front-door router classifying risk tiers, loading playbooks, resolving live models, and gating delivery.
version: 0.1.0
entry_mode: front_door              # Enum: front_door (rc-router only) | standalone_or_router (other 4 skills)
capability: router                  # Abstract capability or lifecycle role
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
```

**Mandatory Markdown sections (exact `##` headings):**
1. `## Single Job` — One sentence defining the skill's sole responsibility.
2. `## When to Use` — Explicit trigger conditions.
3. `## Do NOT Use When` — Explicit negative boundaries (e.g., `rc-init`/`rc-doctor`/`rc-setup`/`rc-retro` must specify when to defer to `rc-router`; `rc-router` must specify skipping heavy ceremony for Tier 0 lookups).
4. `## Procedure` — Imperative, model-agnostic steps referencing `contracts/*`, `scripts/*`, and `~/.rcstack/profiles/*.yaml`.
5. `## Definition of Done` — Hard verifiable exit criteria.

### 2.2 `rc-router` Execution Engine (`skills/rc-router/SKILL.md`)
`rc-router` (`/rcstack`) is the single front-door orchestrator:
1. **Load Context:** Resolve the selected domain from `~/.rcstack/profiles/rcstack-main.yaml`, a legacy machine-local domain profile, or installed consolidated defaults, in that order, `~/.rcstack/dist/rules/<domain>.md`, target repo `AGENTS.md` and `docs/decisions.md`, the spec directory the request belongs to under `specs/` (its `spec.md` and every parent `spec.md`), and run `rc-state.mjs reconcile` against `git status`/`git log` (**Git beats state**).
2. **Classify & Route:** Assign Profile (`rcstack-engineering` | `rcstack-study` | `rcstack-research`), Risk Tier (`0`–`3`, auto-escalating to Tier 3 on `tier3_path_patterns` matches and persisting `rcstack-engineering` / `security-critical`), Required Assurance Floor (`A0`–`A3`), and Playbook. On resume, load the profile and playbook selected by active committed state and observe the Tier 3 spec sign-off pause before continuing implementation.
   - Route initial project planning to `engineering/project-planning` only when read-only reconciliation reports no active state or no Git repository exists yet. This route emits no spec, task state, receipt, or telemetry. An explicit request to save the agreed spec is a separate writing action under the repo rules, with its own tier and verification. Implementation requires a separate request. Direct lookups retain the lookup route.
3. **Discover Live Models:** In T3 Code, call `orchestrator_capabilities` once per thread (using ACP fallback if MCP tools are absent), map portable `driverKind` + `model` + `options` from the active profile, and verify `reviewer != builder` before dispatching. In standalone CLIs, degrade cleanly to single-harness local execution and flag `degraded_single_harness: true` (logging `reviewers: []`, empty audit counts, and `achieved_assurance` capped at `A1`). `rc-setup` checks and reports configured `paired` models and external `companion` dependencies separately from primary/fallback chains, distinguishing observed availability, observed absence (`unavailable`), and missing check evidence (`unverified`).
4. **Print 3-Line Routing Plan:**
   ```text
   Profile: <profile> | Tier: T<0-3> (Assurance Floor: A<0-3>) | Playbook: <domain>/<playbook>
   Route: <capability -> model chain> | Reviewer: <model> (Builder: <model>)
   Exit Gate: <verify + receipt admission + audit + review map>
   ```
5. **Drive State Machine (Tier 2–3):**
   ```text
   TRIAGE -> RESEARCHING -> PLANNING -> EXECUTING <-> VERIFYING -> AUDITING -> AWAITING_REVIEW -> SHIPPED
                                             ^                       |
                                             +------ (Blocker) ------+
   (Any phase <-> BLOCKED)
   ```
   - **Single-Writer Enforcement (Capability Hiding):** Never pass `~/.rcstack/runtime/state/...` paths into `delegate_task` briefs. Subagents return Work Receipts only; only the main thread invokes `scripts/rc-state.mjs`.
   - **Receipt Admission:** Every Tier 2–3 subagent Work Receipt MUST pass `scripts/rc-receipt.mjs` before admission into state or the Review Map.
   - **Assurance Shipping Invariant:** Target `Achieved Assurance >= Required Assurance(Risk Tier)`. If a repo lacks checks to reach the floor, NEVER fake confidence — surface an explicit **`ASSURANCE GAP`** banner on the Review Map and log it to telemetry.

### 2.3 Nested Playbooks (`skills/rc-router/playbooks/<domain>/<playbook>.md`)

Required YAML frontmatter (all 13 playbooks, excluding `TEMPLATE.md`):
```yaml
---
name: feature-build
profile: rcstack-engineering        # Must match parent directory domain
entry_mode: router_only             # MUST ALWAYS be "router_only"
default_tier: 2                     # Integer 0..3
required_assurance: A2              # Enum: A0 | A1 | A2 | A3
required_capabilities:
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

**Mandatory Markdown sections (exact `##` headings):**
1. `## Router-Only Invocation Boundary` — MUST contain the exact verbatim rule:
   > **ROUTER-ONLY:** This playbook MUST ONLY be invoked by `rc-router` (`/rcstack`) after profile selection, risk-tier classification, and live model resolution. Never execute this playbook standalone or bypass `rc-router`.
2. `## Do NOT Use When` — Explicit negative boundaries pointing to alternative playbooks or top-level skills.
3. `## Workflow Phases` — Numbered state-machine phases referencing abstract capabilities, contracts, and deterministic scripts (`rc-state.mjs`, `rc-receipt.mjs`, `rc-log.mjs`) with zero hardcoded model names.
4. `## Exit Gate & Definition of Done` — Hard verification, assurance floor, audit, Review Map, and telemetry gates.

### 2.4 Canonical 13 Playbooks
- **`engineering/` (`rcstack-engineering`):**
  1. `feature-build` (`T2`, `A2`): state init → `systems_research` brief → `architect_blueprint` spec → `primary_builder` slices + `rc-receipt` → integrated `verify` → fresh-context cross-model audit → Review Map + `rc-log`.
  2. `bug-root-cause` (`T2`, `A2`): failing reproduction test first → isolate root cause (no symptom patches) → fix + `rc-receipt` → `verify` → cross-model audit → harden guardrail + Review Map + `rc-log`.
  3. `vibe-iterate` (`T1`, `A1`): fast `vibe_executor` loop for prototypes/UI/spikes → `verify` → 2-line confirmation (skips state file, Review Map, telemetry).
  4. `security-critical` (`T3`, `A3`): auto-escalated auth/sandbox/containers/symlinks/infra/schema track → `systems_research` → `architect_blueprint` (**user sign-off pause**) → `security_builder` + `rc-receipt` → integrated `verify` → strict cross-family adversarial audit → Review Map + `rc-log`.
  5. `refactor-pinned` (`T2`, `A2`): characterization tests pinning behavior → atomic structural steps → `verify` per step → cross-model audit → Review Map + `rc-log`.
  6. `ship-and-babysit` (`T2`, `A2`): final `verify` + unslop pass → PR body from Review Map → safe CI/review triage → close state + `rc-log`.
  7. `garden-maintenance` (`T2`, `A2`): invoke `rc-doctor` (`Diagnose` → approved atomic `Cure` commits) → prune stale `docs/decisions.md` → promote repeat mistakes into deterministic checks.
  8. `project-planning` (`T0`, `A0`): `architect_blueprint` guides initial project planning in chat through problem modeling, a user-selected milestone, and tests and acceptance gates agreed before spec writing.
- **`study/` (`rcstack-study`):**
  9. `topic-deep-dive` (`T2`, `A2`): `deep_grounding` (ingest + curate citations) → `architect_blueprint` (note structure & study guide) → `systems_research` (first-principles walkthrough) → `independent_reviewer` (source/citation fact-audit).
  10. `recall-and-drill` (`T1`, `A1`): active-recall flashcards, edge-case quizzes, spaced-repetition schedule (`primary_builder` / `vibe_executor`).
  11. `socratic-session` (`T1`, `A0`): guided questioning & mental-model stress-testing without giving away answers prematurely (`vibe_executor`). Sole canonical exception to `require_verify` at its default `T1`/`A0`, because it produces no checkable artifact.
- **`research/` (`rcstack-research`):**
  12. `viability-spike` (`T2`, `A2`): `deep_grounding` prior art → time-boxed throwaway prototype (`primary_builder` or `security_builder`) → `verify` → strengths, weaknesses, and failure modes report.
  13. `research-report` (`T2`, `A2`): multi-source investigation (`deep_grounding` + `systems_research`) → `architect_blueprint` synthesis → adversarial devil's-advocate `independent_reviewer` critique → cited decision report + Review Map + `rc-log`.

---

## 3. Profiles, Risk Tiers, Assurance Ladder & Schemas (`profiles/`)

### 3.1 Strict Zero-Dep YAML Subset
All `profiles/*.yaml` MUST use 2-space indentation (NO tabs), block mappings, block sequences (`- item`), comments (`#`), integers, booleans, and plain/double-quoted strings (no anchors `&`/`*`, tags, or block scalars `|`/`>`).

### 3.2 `profiles/schema.json` Contract
JSON Schema (Draft 2020-12) constraining:
- `schema_version`: const `"1.0"`
- `profile`: enum `["rcstack-engineering", "rcstack-study", "rcstack-research"]`
- `domain`: enum `["engineering", "study", "research"]`
- `description`: non-empty string
- `invariants`:
  - `require_reviewer_not_equal_builder`: const `true`
  - `require_fresh_context_audit`: const `true`
  - `allow_self_review_on_fallback`: const `false`
- `tier3_path_patterns`: array of glob strings (e.g., `auth/**`, `sandbox/**`, `infra/**`, `**/Dockerfile*`, `adapters/install.sh`, `scripts/verify.mjs`, `scripts/rc-receipt.mjs`, `scripts/rc-state.mjs`, `profiles/schema.json`)
- `capabilities`: object with required abstract keys (`systems_research`, `architect_blueprint`, `primary_builder`, `security_builder`, `vibe_executor`, `deep_grounding`, `quick_lookup`). Each binding uses **portable** descriptors (`driver_kind`, `model`, optional `options`, `fallback` — NEVER machine-specific `providerInstanceId` UUIDs).
- `review_matrix`: map of `<builder_model>` → `{ primary, tier1_primary?, fallback }` plus `default_fallback`.
  - **Enforced Invariants:** Every model referenced in `primary_builder`, `security_builder`, `vibe_executor`, `systems_research`, or `architect_blueprint` (primary, secondary, fallback) MUST have an entry in `review_matrix`. For every entry: `primary !== builder`, `tier1_primary !== builder` (if present), `fallback !== builder`, and `primary !== fallback`.
- `risk_tiers`: keys `"0"`, `"1"`, `"2"`, `"3"`, each containing `name`, `required_assurance` (`A0`..`A3`), `default_capabilities`, `require_spec`, `require_state_file`, `require_verify`, `require_receipt_gate`, `require_cross_model_audit`, `require_review_map`, `log_telemetry`.

The shipped 2.0 document uses the consolidated schema definition in `profiles/schema.json`.
It defines an alias catalog, shared invariants and gates, and three domains. Domain capability
overrides replace complete bindings. Each domain supplies its tier capability order.
Expansion resolves aliases and applies the default reviewer fallback where needed. All three
resulting profiles pass the 1.0 schema and semantic checks. Their logical IDs are unchanged.
Use `verify.mjs --profile <file> --domain <domain>` to obtain a validated JSON projection.
A legacy 1.0 machine-local domain file remains supported.

### 3.3 Exact Model Stack Mappings (Shipped in All 3 Profile Templates)

| Capability | `rcstack-engineering.yaml` | `rcstack-study.yaml` | `rcstack-research.yaml` |
| :--- | :--- | :--- | :--- |
| `systems_research` | `GPT 6.2 Astra` *(fb: `Gemini 4 Neon`)* | `GPT 6.2 Astra` *(fb: `Claude Fable 5.2`)* | `GPT 6.2 Astra` *(fb: `Claude Opus 5.5`)* |
| `architect_blueprint` | `Claude Fable 5.2` *(fb: `GPT 6.2 Astra`)* | `Claude Fable 5.2` *(fb: `GPT 6.2 Astra`)* | `Claude Fable 5.2` *(fb: `GPT 6.2 Astra`)* |
| `primary_builder` | `Claude Opus 5.5` *(sec: `Gemini 4 Neon`, fb: `GPT 6.2 Sol`)* | `Gemini 4 Neon` *(fb: `Claude Sonnet 5.5`)* | `Gemini 4 Neon` *(fb: `GPT 6.2 Sol`)* |
| `security_builder` | `Gemini 4 Neon` *(sec: `Claude Opus 5.5`, fb: `GPT 6.2 Astra`)* | `Claude Opus 5.5` *(fb: `GPT 6.2 Astra`)* | `Claude Opus 5.5` *(fb: `GPT 6.2 Astra`)* |
| `vibe_executor` | `Claude Fable 5.2` *(sec: `Gemini 4 Neon`, fb: `GPT 6.2 Sol`)* | `GPT 6.2 Sol` *(sec: `Gemini 4 Neon`, fb: `Claude Sonnet 5.5`)* | `GPT 6.2 Sol` *(sec: `Gemini 4 Neon`, fb: `Claude Sonnet 5.5`)* |
| `deep_grounding` | `Gemini 4 Carbon` *(paired: `GPT 6.2 Astra`, fb: `GPT 6.2 Astra`)* | `Gemini 4 Neon` *(paired: `GPT 6.2 Astra`, companion: `Gemini Notebook`, fb: `GPT 6.2 Astra`)* | `Gemini 4 Neon` *(paired: `GPT 6.2 Astra`, companion: `Gemini Notebook`, fb: `GPT 6.2 Astra`)* |
| `quick_lookup` | `Gemini 4 Hydrogen` *(`exclusive: true`)* | Same | Same |

**Strict `review_matrix` (all 3 profiles, `reviewer != builder`):**
- `Gemini 4 Neon` → `primary: Claude Opus 5.5`, `fallback: Cursor Grok 4.7`
- `Claude Opus 5.5` → `primary: Gemini 4 Neon`, `fallback: Cursor Grok 4.7`
- `GPT 6.2 Sol` → `primary: Claude Opus 5.5`, `tier1_primary: Gemini 4 Neon`, `fallback: Cursor Grok 4.7`
- `Claude Sonnet 5.5` → `primary: Gemini 4 Neon`, `fallback: Cursor Grok 4.7`
- `GPT 6.2 Astra` → `primary: Claude Opus 5.5`, `fallback: Cursor Grok 4.7`
- `Claude Fable 5.2` → `primary: Gemini 4 Neon`, `fallback: Cursor Grok 4.7`
- `default_fallback`: `Cursor Grok 4.7`

### 3.4 Risk Tiers (`0`–`3`) × Deterministic Assurance Ladder (`A0`–`A3`)
Assurance is **mechanically derived from evidence**, never LLM self-rated confidence:
- **`A0` (Speculative — Tier 0 floor):** Reasoning/lookup only; no deterministic check ran.
- **`A1` (Mechanical — default Tier 1 floor, with the Socratic exception in section 2.4):** Format + lint + static/type checks pass (exit `0`).
- **`A2` (Behavioral — Tier 2 floor):** `A1` + automated unit/integration tests covering changed paths pass + independent audit with `0` open `Blocker`s.
- **`A3` (Hardened — Tier 3 floor):** `A2` + targeted edge-case/security/runtime proof + independent cross-family adversarial audit with `0` open `Blocker`s or `Major`s.

---

## 4. Handoff & Memory Contracts (`contracts/` & Three-Layer State)

1. **`contracts/research-brief.md`:** Goal, Grounded Facts (exact file/URL/page citations), Constraints, Open Questions, Recommended Approach.
2. **`contracts/spec.md`:** Problem Statement, Non-Goals, Data Shapes & Interfaces, Non-Overlapping File Slices, Failure Modes, Acceptance Criteria, Verification Plan. Written to `specs/<feature>/spec.md` in the target repository (section 1.D).
3. **`contracts/work-receipt.md`:** Compact structured subagent receipt (~10–15 lines) validated by `scripts/rc-receipt.mjs`:
   - `slice` (1-line owned scope), `base_sha`, `head_sha`, `files_touched` (exact paths), `verify_cmd`, `verify_exit_code`, `checks_passed` (subset of `["mechanical", "behavioral", "hardened"]`), `audit_blockers`, `audit_majors`, `assumptions`, `review_hotspot` (top 1–2 `file:line` anchors).
4. **`contracts/audit-findings.md`:** Metadata (`builder_model`, `reviewer_model`, `fresh_context: true`, `diff_scope`), Findings grouped strictly by `Blocker` / `Major` / `Nit` (`file:line`, `impact`, `concrete_fix`), Verdict (`APPROVE` | `CHANGES_REQUESTED`).
5. **`contracts/review-map.md`:** Human review artifact synthesized by `rc-router` at `AWAITING_REVIEW` (reusable verbatim as PR body):
   - **Header Bar** (Profile, Tier, **Achieved vs. Required Assurance** + explicit `ASSURANCE GAP` banner if short, slices, verify attempts), **Executive Delta** (3 bullets), **Risk-Ranked Reading Order** (`[HIGH]` → `[MED]` → `[SKIM]` with `file:line`), **Assumptions & Tradeoffs Checklist**, **Cross-Model Audit Ledger**, **Verification Matrix**, **Proposed `docs/decisions.md` Entry**.
6. **`contracts/telemetry-event.schema.json`:** JSON Schema (`schema_version: 1`) for `~/.rcstack/runtime/telemetry.jsonl`:
   - Required fields: `schema_version` (`1`), `ts` (ISO-8601 UTC), `repo`, `branch`, `profile`, `playbook`, `risk_tier` (`0..3`), `required_assurance` (`A0..A3`), `achieved_assurance` (`A0..A3`), `builders` (non-empty string array), `reviewers` (string array), `degraded_single_harness` (boolean), `verify_attempts` (int `>= 0`), `audit_accepted` (object `<model>: int`), `audit_dismissed` (object `<model>: int`), `overridden` (boolean), `escalated_from_tier` (int `0..3` or `null`).
   - Degraded single-harness rows (`degraded_single_harness: true`) MUST carry `reviewers: []`, empty `audit_accepted` and `audit_dismissed`, and `achieved_assurance` of `A0` or `A1`. Historical degraded rows remain readable as recorded and supply no independent reviewer evidence to `rc-retro`.
7. **Evergreen Repo Truth (`docs/decisions.md`):**
   Every entry MUST include `Date`, `Status`, `Decision`, **`Rejected Alternative`**, and **`Guardrail`**.
8. **Ephemeral Active Task State (`~/.rcstack/runtime/state/<repo-slug>/<branch-slug>.md`):**
   YAML frontmatter (`schema_version: 1`, `rev`, `repo`, `branch`, `profile`, `playbook`, `risk_tier`, `required_assurance`, `achieved_assurance`, `phase`, `base_sha`, `head_sha`, `verify_attempts`, `updated_at`) + Markdown body (`Active Goal`, `Admitted Receipts`, `Next Step`, `Open Blockers`). Mutated **exclusively** by `scripts/rc-state.mjs`.

---

## 5. Deterministic Scripts, Installer & Hermetic Tests

All scripts under `scripts/` MUST be zero-dependency Node.js `>=20` ESM and expose testable CLI flags so `tests/` run hermetically in temporary directories without touching `~/.rcstack/`.

### 5.1 `scripts/verify.mjs`
Supports `--slice=1`, `--slice=2`, or `--slice=3` (default `3`). Exits `0` on full pass, `1` on any error, printing `[PASS]`/`[FAIL]` diagnostics.
- **Slice 1+ Checks:** `README.md`, `AGENTS.md`, `docs/decisions.md` (at least one `DEC-` entry with `Rejected Alternative:` + `Guardrail:`), `scripts/verify.mjs` exist; no top-level `playbooks/` directory; any directories under `skills/` are a strict subset of the approved 5 (`rc-router`, `rc-setup`, `rc-init`, `rc-doctor`, `rc-retro`). The system spec exists at `specs/initialization-build/spec.md`, the repository root holds no `playbooks`, `SPEC.md` or `spec.md` entry, and a `specs/` tree, when present, follows the feature-local layout of section 1.D (`--specs <dir>` runs that one check on any repository). Exact membership is enforced inside the closed subtrees of the section 1.A tree. `docs/` permits additional files and subdirectories under the owned-tree rules, and `docs/decisions.md` remains required and validated. The root itself is open, so any other top-level entry (for example `.archive/`), tracked or not, is neither listed nor read. Paths that git ignores and does not track are skipped, as reported by `git ls-files --others --ignored --exclude-standard`; a tracked file is never skipped, and outside a git worktree nothing is. `--include-ignored` turns the skipping off, and `adapters/install.sh` always passes it, because it copies whole directories.
- **Slice 2+ Checks:** `profiles/schema.json` valid JSON; `profiles/rcstack-main.yaml` parses via the strict zero-dependency YAML parser and all three projections satisfy `profiles/schema.json` and the **`reviewer != builder` invariant**; all 6 `contracts/*` exist (`telemetry-event.schema.json` valid JSON); all 3 `rules/*.md` exist; `skills/rc-router/SKILL.md` passes skill contract + negative-boundary + zero-model-name checks; `skills/rc-router/playbooks/` contains `TEMPLATE.md` and ONLY the exact 13 approved playbooks, each passing frontmatter, `entry_mode === "router_only"`, verbatim `ROUTER-ONLY:` boundary, `## Do NOT Use When`, valid `required_capabilities` & `contracts` refs, profile tier-gate enforcement (with `study/socratic-session` at default `T1`/`A0` as the sole exception to `require_verify`, never by `A0` label alone), and zero hardcoded model names.
- **Slice 3 (Full Default) Checks:** All 5 exact top-level skills exist and pass frontmatter, headings, negative boundaries, and zero-model-name checks; `scripts/rc-state.mjs`, `scripts/rc-receipt.mjs`, `scripts/rc-log.mjs` exist and pass `node --check`; `adapters/install.sh` exists, is executable (`chmod +x`), and passes `bash -n`; `tests/*.test.mjs` exist; all cross-references across skills, playbooks, contracts, scripts, and profiles resolve to real files.

### 5.2 `scripts/rc-state.mjs`
The state CLI rejects initialization for `project-planning` before any runtime writes.

Atomic single-writer state mutator + local shadow git controller (`--runtime-dir <path>` defaults to `~/.rcstack/runtime`):
- Ensures `<runtime-dir>` is initialized as a local-only git repo (`git init` if missing, no remote configured).
- Acquires an atomic lock (`mkdir` or exclusive `O_CREAT|O_EXCL` lockfile with stale-lock check), verifies optimistic revision (`--expected-rev N`), writes temp file + atomic `rename`, increments `rev: N -> N+1`, and creates a local shadow git commit (`state(<repo>/<branch>): <OLD_PHASE> -> <NEW_PHASE> (rev <N>, <Ax>)`).
- Subcommands: `init`, `transition` (where `--escalate-tier 3` atomically sets `profile: rcstack-engineering`, `playbook: security-critical`, `risk_tier: 3`, and `required_assurance: A3` in one shadow commit while preserving the first `escalated_from_tier`; lower-tier escalations and direct Tier 3 `init` retain their selected route; legacy committed states with `risk_tier: 3` and `escalated_from_tier` present the effective route on `show` without writing, persist it on the next successful mutation, and roll back failed commits to the original committed bytes), `show`, `reconcile` (compares state `head_sha` against live repo `git status`/`git rev-parse HEAD` — reporting drift where git beats state), `close` (`git rm` state file + commit on `SHIPPED`).

### 5.3 `scripts/rc-receipt.mjs`
4-point deterministic Work Receipt admission gate (`--receipt <file|->`, `--repo <path>`, optional `--allowed-paths <glob,glob>`):
1. **Schema Completeness:** All required fields present and typed correctly.
2. **Git Boundary & Cleanliness:** Verifies `git diff --name-only <base_sha>..<head_sha>` exactly matches `files_touched`, every touched file is within `--allowed-paths` (when provided), and working tree is clean (`git status --porcelain` empty).
3. **Command Proof:** `verify_cmd` non-empty and `verify_exit_code === 0`.
4. **Mechanical Assurance Tagging:** Computes `A0` / `A1` / `A2` / `A3` strictly from verified evidence (`verify_exit_code === 0`, `checks_passed`, `audit_blockers`, `audit_majors`) and prints structured JSON admission output; exits `0` on `ADMITTED`, `1` on `REJECTED` with exact failure reasons.

### 5.4 `scripts/rc-log.mjs`
Validates a JSON telemetry payload (`--json '<payload>'` or `stdin`) against `contracts/telemetry-event.schema.json` (plus rejects self-review where `reviewers` overlaps `builders` unless independent multi-builder cross-review covers every builder on a non-degraded run, rejects any `degraded_single_harness: true` row with non-empty `reviewers`, non-empty `audit_accepted`/`audit_dismissed`, or `achieved_assurance` above `A1`, and rejects unaudited `A2`/`A3` rows) and appends one compact JSONL line to `<runtime-dir>/telemetry.jsonl` (`--file <path>` override, `--dry-run` supported).

### 5.5 `adapters/install.sh`
Idempotent POSIX `bash` promoter & harness linker (`set -euo pipefail`):
- Flags: `--from-local` (default), `--dry-run` (zero mutations), `--home <dir>` (default `$HOME`, used by `tests/install.test.mjs` for hermetic testing), `--rcstack-home <dir>` (default `$HOME/.rcstack`).
- Stages `rules/`, `profiles/` (into `defaults/profiles/`), `contracts/`, `scripts/`, and `skills/` into a temporary staging dir inside `~/.rcstack/` and atomically swaps into `~/.rcstack/dist/`. Nothing else is staged: `specs/`, `docs/`, and `tests/` are source-only.
- Writes `~/.rcstack/install-meta.json` (`version`, `commit_sha`, `source: "local"`, `installed_at`).
- Seeds `~/.rcstack/profiles/rcstack-main.yaml` when no local consolidated or legacy profile
  exists. Existing profile files are preserved.
- Release packaging takes a tagged commit, includes the source tree required by verify, and
  generates an installer pinned to the tag and archive digest. The release installer verifies
  the download before promotion and records the packaged commit with source `release`.
- Initializes `~/.rcstack/runtime/` with `git init` if `.git` is missing.
- Symlinks ONLY the **5 top-level skills** from `~/.rcstack/dist/skills/<skill>` into `~/.agents/skills`, `~/.claude/skills`, `~/.codex/skills`, `~/.gemini/skills`, and `~/.cursor/skills`.
- If a destination exists and is a non-symlink file/directory, refuses to overwrite and exits non-zero.

### 5.6 `tests/` (`node --test`)
Hermetic unit tests (zero external deps, zero writes outside `os.tmpdir()`) verifying:
- `verify.test.mjs`: passes on valid repo; fails on rogue skill, hardcoded model name in skill/playbook, missing `ROUTER-ONLY:`, `reviewer == builder`, or a directory under `specs/` without a `spec.md`.
- `rc-state.test.mjs`: `init` → `transition` (shadow git commit + `rev` increment) → optimistic rev conflict rejection → `reconcile` → `close`.
- `rc-receipt.test.mjs`: admits valid clean-tree receipt with correct `A1/A2/A3` tag; rejects dirty tree, out-of-bounds file diff, non-zero exit code, or missing fields.
- `rc-log.test.mjs`: validates & appends valid JSONL row; rejects malformed schema or self-review violation.
- `install.test.mjs`: tests `--dry-run` (zero writes), `--from-local` promote into temp `--home`, verifies harness symlinks point to `<rcstack-home>/dist/skills/*` (NOT source repo), verifies existing user profile edits are preserved on re-run (idempotency), verifies non-symlink collision refusal, and verifies `specs/` is never staged into `dist/`.

---

## 6. Phased Build Order (Vertical Slices)

Build strictly in 3 sequential vertical slices. Verify each slice before advancing:

- **Slice 1 — Foundation & Validator First:**
  - Clean repo skeleton, `AGENTS.md`, `README.md`, `specs/initialization-build/spec.md`, initial `docs/decisions.md` (recording the 3-directory split, 5-skill layout, router-only playbooks, `A0–A3` assurance, shadow-git state, and `reviewer != builder`), and complete `scripts/verify.mjs` (`--slice=1|2|3`).
  - **Gate:** `node scripts/verify.mjs --slice=1` passes with 0 errors.
- **Slice 2 — Profiles, Contracts, Rules, `rc-router` & 13 Playbooks:**
  - `profiles/schema.json`, `profiles/rcstack-main.yaml`, all 6 `contracts/*`, all 3 `rules/*.md`, `skills/rc-router/SKILL.md`, `skills/rc-router/playbooks/TEMPLATE.md`, and all 13 nested playbooks.
  - **Gate:** `node scripts/verify.mjs --slice=2` passes with 0 errors.
- **Slice 3 — Remaining 4 Skills, Deterministic Scripts, Installer & Unit Tests:**
  - `skills/{rc-setup,rc-init,rc-doctor,rc-retro}/SKILL.md`, `scripts/{rc-state,rc-receipt,rc-log}.mjs`, `adapters/install.sh`, and `tests/*.test.mjs`.
  - **Gate:** `node scripts/verify.mjs`, `node --test tests/*.test.mjs`, and `bash adapters/install.sh --dry-run` all pass with 0 errors.
