<img src="assets/icon.svg" width="64" height="64" alt="">

# rcstack-beta

A personal multi-model agent operating system: one front-door router (`/rcstack`), a small
library of portable skills, and deterministic gates that decide when work is done. Built for
**T3 Code** (multi-provider orchestration through `orchestrator_capabilities` and
`delegate_task`), and it degrades to honest single-harness execution in standalone CLIs
(Claude Code, Codex CLI, Antigravity, Cursor).

Version `0.1.0-beta`. Requires Node.js `>=20`, `bash`, and `git`. No npm dependencies.
`specs/initialization-build/spec.md` is the canonical system specification; `AGENTS.md` is the repo law.

## How it works

You ask `/rcstack` for something. `rc-router` then:

1. **Loads context** — the active profile, the domain rules, the target repo's `AGENTS.md` and
   `docs/decisions.md`, the feature's spec directory under `specs/`, and any task state
   (reconciled against git; git always wins).
2. **Classifies** — picks a profile, a risk tier (`0`-`3`), the assurance floor that tier demands,
   and one of 12 playbooks.
3. **Resolves live models** — maps each abstract capability in the profile to a model that is
   actually reachable, and proves the reviewer is not the builder before dispatching anything.
4. **Prints a 3-line routing plan**, then drives the playbook through its exit gate.

Skills and playbooks never name a model. Only `profiles/*.yaml` binds capabilities to models.

## Three directories

| Where | What | Who writes it |
| :--- | :--- | :--- |
| This checkout | Source: skills, playbooks, profiles, contracts, scripts | You, through reviewed changes |
| `~/.rcstack/` | Installed runtime: `dist/` (read-only copy), `profiles/` (yours), `runtime/` (state + telemetry) | `adapters/install.sh` and the scripts |
| Target repos | `AGENTS.md`, `docs/decisions.md`, `specs/`, checks, CI — no rcstack state | `rc-init`, then normal work |

Harness skill directories (`~/.agents/skills`, `~/.claude/skills`, `~/.codex/skills`,
`~/.gemini/skills`, `~/.cursor/skills`) symlink only to `~/.rcstack/dist/skills/<skill>`, never
into this checkout. Editing the source cannot change a live session; only an install can.

## Feature specs

Each feature keeps its spec and its working documents in its own directory under `specs/`:

```text
specs/
└── <feature>/
    ├── spec.md              # required in every directory
    ├── requirements.md      # anything else the task needs
    ├── planning.md
    └── <sub-feature>/       # a sub-spec, nested inside its parent
        └── spec.md
```

Every directory under `specs/` holds a `spec.md`, so a sub-spec always sits inside its parent
spec's directory, and a parent spec constrains its sub-specs. The system specification is one of them, and it stays the canonical
specification; a feature spec describes one change on top of it. `specs/` is source-only: it is
never installed, and it never holds task state or telemetry. Check any repository's tree with
`node scripts/verify.mjs --specs <dir>`.

## Custom and ignored paths

The validator fixes the contents of the directories rcstack owns (`skills/`, `profiles/`,
`contracts/`, `scripts/`, ...) and nothing else. The repository root is open: a custom top-level
entry such as `.archive/` or `LICENSE` is never listed or read, tracked or not. Only `playbooks`,
`SPEC.md`, `spec.md` and `node_modules` are refused there.

Inside the owned directories, paths that git ignores and does not track (an editor's scratch
file, `.DS_Store`) are skipped. Git decides what is ignored; a tracked file is always judged.
`node scripts/verify.mjs --include-ignored` judges those paths too, and the installer always runs
it that way, because it copies whole directories into `dist/`.

## Install

```bash
bash adapters/install.sh --dry-run    # print the plan; changes nothing
bash adapters/install.sh              # promote into ~/.rcstack/dist and link the 5 skills
```

The installer verifies the source first and refuses to overwrite any non-symlink in a harness
directory. During an upgrade, it uses an atomic exchange when available. Otherwise, it moves the
old installation aside and then moves the replacement into place, so `dist/` can be briefly absent.
It seeds `~/.rcstack/profiles/*.yaml` only when missing and initializes the `~/.rcstack/runtime/`
shadow git repo. Re-running it is safe. Edit your routing in `~/.rcstack/profiles/`.

## Skills

| Skill | Job |
| :--- | :--- |
| `rc-router` | Front door: classify, route, resolve live models, gate delivery |
| `rc-setup` | Discover live models, paired models, and companions; validate profiles; check harness links |
| `rc-init` | Bootstrap a target repo with opt-in modules |
| `rc-doctor` | Diagnose a repo, then apply approved atomic cures |
| `rc-retro` | Turn telemetry into concrete profile and skill tuning diffs |

## Playbooks

Router-only. Never invoked directly.

| Domain | Playbook | Tier | Floor |
| :--- | :--- | :--- | :--- |
| engineering | `feature-build` | 2 | A2 |
| engineering | `bug-root-cause` | 2 | A2 |
| engineering | `vibe-iterate` | 1 | A1 |
| engineering | `security-critical` | 3 | A3 |
| engineering | `refactor-pinned` | 2 | A2 |
| engineering | `ship-and-babysit` | 2 | A2 |
| engineering | `garden-maintenance` | 2 | A2 |
| study | `topic-deep-dive` | 2 | A2 |
| study | `recall-and-drill` | 1 | A1 |
| study | `socratic-session` | 1 | A0 |
| research | `viability-spike` | 2 | A2 |
| research | `research-report` | 2 | A2 |

`study/socratic-session` at default Tier 1/`A0` is the sole playbook exempt from `require_verify`.
Escalating any active task to Tier 3 atomically persists the `rcstack-engineering` / `security-critical`
(`T3`/`A3`) route.

## Assurance ladder

Assurance is computed from evidence by `scripts/rc-receipt.mjs`. Nobody rates their own confidence.

| Level | Meaning | Evidence |
| :--- | :--- | :--- |
| `A0` Speculative | Reasoning or lookup only | No deterministic check ran |
| `A1` Mechanical | Format, lint, static and type checks pass | Verify command exited `0`, `mechanical` passed |
| `A2` Behavioral | `A1` plus tests on the changed paths | `behavioral` passed and an independent audit has 0 open Blockers |
| `A3` Hardened | `A2` plus edge-case, security, or runtime proof | `hardened` passed and a cross-family audit has 0 open Blockers or Majors |

Tier `N` normally requires at least `A<N>`. The Socratic session uses its listed A0 floor at Tier 1.
Work that cannot reach its floor ships only under an explicit
`ASSURANCE GAP` banner on the Review Map, and the gap is logged.

## Default model stack

Shipped in `profiles/` and seeded into `~/.rcstack/profiles/` on first install. `fb` is the
fallback, `sec` the secondary.

| Capability | Engineering | Study | Research |
| :--- | :--- | :--- | :--- |
| `systems_research` | GPT 6.2 Astra (fb Gemini 4 Neon) | GPT 6.2 Astra (fb Claude Fable 5.2) | GPT 6.2 Astra (fb Claude Opus 5.5) |
| `architect_blueprint` | Claude Fable 5.2 (fb GPT 6.2 Astra) | same | same |
| `primary_builder` | Claude Opus 5.5 (sec Gemini 4 Neon, fb GPT 6.2 Sol) | Gemini 4 Neon (fb Claude Sonnet 5.5) | Gemini 4 Neon (fb GPT 6.2 Sol) |
| `security_builder` | Gemini 4 Neon (sec Claude Opus 5.5, fb GPT 6.2 Astra) | Claude Opus 5.5 (fb GPT 6.2 Astra) | Claude Opus 5.5 (fb GPT 6.2 Astra) |
| `vibe_executor` | Claude Fable 5.2 (sec Gemini 4 Neon, fb GPT 6.2 Sol) | GPT 6.2 Sol (sec Gemini 4 Neon, fb Claude Sonnet 5.5) | GPT 6.2 Sol (sec Gemini 4 Neon, fb Claude Sonnet 5.5) |
| `deep_grounding` | Gemini 4 Carbon (paired GPT 6.2 Astra, fb GPT 6.2 Astra) | Gemini 4 Neon (paired GPT 6.2 Astra, companion Gemini Notebook, fb GPT 6.2 Astra) | Gemini 4 Neon (paired GPT 6.2 Astra, companion Gemini Notebook, fb GPT 6.2 Astra) |
| `quick_lookup` | Gemini 4 Hydrogen (exclusive) | same | same |

Reviewers come from `review_matrix`, keyed by whoever built the work:

| Builder | Reviewer | Fallback reviewer |
| :--- | :--- | :--- |
| Gemini 4 Neon | Claude Opus 5.5 | Cursor Grok 4.7 |
| Claude Opus 5.5 | Gemini 4 Neon | Cursor Grok 4.7 |
| GPT 6.2 Sol | Claude Opus 5.5 (Tier 1: Gemini 4 Neon) | Cursor Grok 4.7 |
| Claude Sonnet 5.5 | Gemini 4 Neon | Cursor Grok 4.7 |
| GPT 6.2 Astra | Claude Opus 5.5 | Cursor Grok 4.7 |
| Claude Fable 5.2 | Gemini 4 Neon | Cursor Grok 4.7 |

Cursor Grok 4.7 reviews only; it is never bound to a builder capability. `reviewer != builder`
cannot be switched off by any profile; degraded single-harness runs log `reviewers: []` with empty
audit counts and cap at `A1`.

## Deterministic tools

| Script | Purpose |
| :--- | :--- |
| `scripts/verify.mjs` | Validates this repo against the system spec (`--slice=1|2|3`), one profile (`--profile`), or one specs tree (`--specs`); skips git-ignored paths unless `--include-ignored` |
| `scripts/rc-state.mjs` | Locked, revision-checked task state with a shadow git commit per transition |
| `scripts/rc-receipt.mjs` | 4-point Work Receipt admission gate; computes `A0`-`A3` |
| `scripts/rc-log.mjs` | Schema-validated JSONL telemetry appender |

Every script takes explicit path flags (`--root`, `--runtime-dir`, `--repo`, `--file`), so the
tests in `tests/` run entirely inside temporary directories.

## Develop

```bash
node scripts/verify.mjs                 # repo invariants and contracts
node --test tests/*.test.mjs            # hermetic unit tests
bash adapters/install.sh --dry-run      # activation plan, no changes
```

All three must pass before a change is done. Durable choices are recorded in `docs/decisions.md`.
