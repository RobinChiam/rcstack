<img src="assets/icon.svg" width="64" height="64" alt="">

# rcstack-beta

A personal multi-model agent operating system: one front-door router, ten atomic skills, twelve
nested playbooks, and three routing profiles. It runs natively inside **T3 Code** (multi-provider
orchestration) and degrades gracefully in standalone CLI harnesses (Claude Code, Codex CLI,
Antigravity, Cursor).

- **Status:** `v0.1.0-beta`. `SPEC.md` is the canonical specification.
- **Runtime:** Node.js `>=20` (ESM, zero third-party `npm` dependencies) and POSIX `bash`.
- **Not activated by default:** nothing is linked into a harness until you run the installer.

## How It Works

Type `/rcstack <task>`. The router (`skills/rc-router/SKILL.md`) does four things in one pass and
prints them as a Routing Plan before any work starts:

1. **Profile** — `rcstack-engineering` (default), `rcstack-study`, or `rcstack-research`.
2. **Risk tier** — `T0` to `T3`, auto-escalating to `T3` when a touched path matches
   `tier3_path_patterns` in the profile or the `## Tier 3 Paths` section of the repo `AGENTS.md`.
3. **Playbook** — one of the twelve workflows under `skills/rc-router/playbooks/`.
4. **Models** — abstract roles resolved through the profile, with `reviewer != builder` verified
   before dispatch.

```text
Profile: <profile> | Tier: T<0-3> | Playbook: <domain>/<playbook>
Route: <role -> model chain> | Reviewer: <model> (builder: <model>)
Exit Gate: <required verification & review map artifacts>
```

In T3 Code the router delegates each phase to the resolved model and enforces a fresh-context
cross-model audit. In a single harness it runs the same phases locally and records
`degraded_single_harness: true` instead of pretending a self-review was independent.

## Layout

```text
rcstack-beta/
├── AGENTS.md            repo law for maintaining this repository
├── SPEC.md              canonical build specification
├── docs/decisions.md    living decisions log (DEC-NNN entries)
├── rules/               always-on taste rules per domain
├── profiles/            schema.json + three role-to-model routing profiles
├── contracts/           five handoff contracts + the telemetry event schema
├── skills/              ten atomic skills; playbooks nest under rc-router/playbooks/
├── adapters/install.sh  idempotent harness symlink installer (--dry-run)
└── scripts/             verify.mjs (validator) and log-telemetry.mjs (telemetry logger)
```

### The ten skills

| Skill | Entry mode | Job |
| :--- | :--- | :--- |
| `rc-router` | `front_door` | Route a request: profile, tier, playbook, models |
| `rc-init` | `standalone_or_router` | Bootstrap guardrails in a target repo |
| `rc-doctor` | `standalone_or_router` | Diagnose, then cure, repo hygiene problems |
| `rc-retro` | `standalone_or_router` | Monthly telemetry review and stack tuning |
| `rc-ground` | `router_dispatched` | Ground a task in a corpus or repo with citations |
| `rc-architect` | `router_dispatched` | Produce a merge-ready structural blueprint |
| `rc-verify` | `router_dispatched` | Deterministic lint, type, test, and runtime proof |
| `rc-audit` | `router_dispatched` | Fresh-context cross-model review |
| `rc-state` | `router_dispatched` | Decisions log and per-branch session state |
| `rc-review-map` | `router_dispatched` | Synthesize receipts into a Review Map and log telemetry |

### The twelve playbooks

| Domain | Playbook | Tier | Use for |
| :--- | :--- | :--- | :--- |
| engineering | `feature-build` | 2 | New behaviour delivered to spec |
| engineering | `bug-root-cause` | 2 | Reproduce first, fix the cause, add a guardrail |
| engineering | `vibe-iterate` | 1 | Prototypes, UI tweaks, spikes |
| engineering | `security-critical` | 3 | Auth, sandbox, containers, symlinks, infra, schema |
| engineering | `refactor-pinned` | 2 | Structural change under characterization tests |
| engineering | `ship-and-babysit` | 2 | Final verify, PR body, CI and review triage |
| engineering | `garden-maintenance` | 2 | Hygiene cures, decision pruning, new checks |
| study | `topic-deep-dive` | 2 | Grounded notes and a first-principles walkthrough |
| study | `recall-and-drill` | 1 | Flashcards, quizzes, spaced repetition |
| study | `socratic-session` | 1 | Guided questioning without giving answers away |
| research | `viability-spike` | 2 | Prior art plus a time-boxed throwaway prototype |
| research | `research-report` | 2 | Multi-source investigation into a cited report |

Playbooks are router-only: they are never linked into a harness and never run standalone.

## Role-to-Model Bindings

Skills and playbooks name abstract roles only. The profiles bind them to concrete models; this
section documents those bindings and must be kept in step with `profiles/*.yaml`.

### `rcstack-engineering`

| Abstract role | Primary | Secondary / paired | Fallback |
| :--- | :--- | :--- | :--- |
| `systems_research` | GPT 6.2 Astra | — | Gemini 4 Neon |
| `architect_blueprint` | Claude Fable 5.2 | — | GPT 6.2 Astra |
| `primary_builder` | Gemini 4 Neon | — | GPT 6.2 Sol |
| `security_builder` | Claude Opus 5.5 | — | GPT 6.2 Astra |
| `vibe_executor` | GPT 6.2 Sol | Gemini 4 Neon | Claude Sonnet 5.5 |
| `deep_grounding` | Gemini 4 Neon | paired: GPT 6.2 Astra; companion: Gemini Notebook | GPT 6.2 Astra |
| `quick_lookup` | Gemini 4 Hydrogen | `exclusive: true` | Gemini 4 Hydrogen |

### `rcstack-study` and `rcstack-research`

Same roles and primaries. Only these fallbacks differ from engineering:

| Abstract role | `rcstack-study` fallback | `rcstack-research` fallback |
| :--- | :--- | :--- |
| `systems_research` | Claude Fable 5.2 | Claude Opus 5.5 |
| `primary_builder` | Claude Sonnet 5.5 | GPT 6.2 Sol |

### Review matrix (all three profiles)

`independent_reviewer` is not a fixed model. It is resolved from the builder of record:

| Builder | Reviewer (primary) | Tier 1 reviewer | Fallback |
| :--- | :--- | :--- | :--- |
| Gemini 4 Neon | Claude Opus 5.5 | — | Cursor Grok 4.7 |
| Claude Opus 5.5 | Gemini 4 Neon | — | Cursor Grok 4.7 |
| GPT 6.2 Sol | Claude Opus 5.5 | Gemini 4 Neon | Cursor Grok 4.7 |
| Claude Sonnet 5.5 | Gemini 4 Neon | — | Cursor Grok 4.7 |
| GPT 6.2 Astra | Claude Opus 5.5 | — | Cursor Grok 4.7 |
| Claude Fable 5.2 | Gemini 4 Neon | — | Cursor Grok 4.7 |

`default_fallback` is Cursor Grok 4.7. Reviewers only review: a fallback reviewer is never
promoted to a builder role. `quick_lookup.exclusive: true` reserves Gemini 4 Hydrogen for Tier 0
lookups; it never builds, grounds, or reviews.

### Risk tiers

| Tier | Engineering name | Spec | Verify | Cross-model audit | Review Map | Telemetry |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 0 | `trivial_lookup` | no | no | no | no | no |
| 1 | `fast_iteration` | no | yes | no | no | no |
| 2 | `standard_delivery` | yes | yes | yes | yes | yes |
| 3 | `security_critical` | yes | yes | yes | yes | yes |

The gates are identical in all three profiles; only tier names and default roles differ. A
playbook must honour every gate its tier switches on.

## Contracts and Memory

Phases hand off through five Markdown contracts in `contracts/`: `research-brief.md`, `spec.md`,
`work-receipt.md`, `audit-findings.md`, and `review-map.md`. Tier 2+ runs end with a Review Map
and one telemetry row validated against `contracts/telemetry-event.schema.json`.

Memory has two layers:

- **`docs/decisions.md`** — committed, evergreen `DEC-NNN` entries with a rejected alternative
  and a guardrail each.
- **`.rcstack/state/<branch-slug>.md`** — ephemeral per-branch session state, globally
  gitignored and never committed.

## Verify

```bash
node scripts/verify.mjs             # full validation; exit 0 means every check group passed
node scripts/verify.mjs --slice=1   # repo skeleton and docs
node scripts/verify.mjs --slice=2   # + profiles, contracts, rules, router, playbooks
```

The validator prints `[PASS]` or `[FAIL]` per check group. Its behavioural checks of the
installer and the telemetry logger run against a throwaway sandbox `HOME`, never your real one.

## Telemetry

```bash
node scripts/log-telemetry.mjs --dry-run --json '{
  "schema_version": "1.0", "timestamp": "2026-11-23T12:00:00Z",
  "repo": "rcstack-beta", "branch": "main",
  "profile": "rcstack-engineering", "playbook": "engineering/feature-build", "risk_tier": 2,
  "builder_model": "Gemini 4 Neon", "reviewer_model": "Claude Opus 5.5",
  "degraded_single_harness": false, "first_pass_verify_passed": true,
  "audit_blockers": 0, "audit_majors": 1, "audit_nits": 3, "human_override": false
}'
```

Without `--dry-run` the row is appended to `~/.rcstack/telemetry.jsonl` (override with
`--file <path>`). Rows where `reviewer_model` equals `builder_model` are rejected. The payload
can also be piped on stdin.

## Activate

Activation is manual and deliberate. Run it from the checkout you intend to keep: the symlinks
point at this repository's absolute path.

```bash
bash adapters/install.sh --dry-run   # print every planned action; changes nothing
bash adapters/install.sh             # create the links and the gitignore entry
```

The installer links the ten skills into `~/.agents/skills`, `~/.claude/skills`, and
`~/.codex/skills`, and adds `.rcstack/state/` to your global gitignore. It is idempotent, updates
its own stale symlinks, and refuses to overwrite any real file or directory.

`/rcstack` is the router's trigger phrase. Harnesses that expose skills by directory name also
list it as `rc-router`.

## Maintain

Read `AGENTS.md` first. Record durable choices in `docs/decisions.md`. Change model bindings only
in `profiles/*.yaml` (and the tables above). Finish every change with `node scripts/verify.mjs`.
