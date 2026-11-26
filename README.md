<img src="assets/icon.svg" width="64" height="64" alt="">

# rcstack

A personal multi-model agent workflow kit: one front-door router (`/rcstack`), a small
library of portable skills, and deterministic gates that decide when work is done. Built for
**T3 Code** (multi-provider orchestration through `orchestrator_capabilities` and
`delegate_task`), and it degrades to honest single-harness execution in standalone CLIs
(Claude Code, Codex CLI, Antigravity, Cursor).

Version `0.2.1`. Requires Node.js `>=20`, `bash`, and `git`. No npm dependencies.
`specs/initialization-build/spec.md` is the canonical system specification; `AGENTS.md` is the repo law.

## How it works

You ask `/rcstack` for something. `rc-router` then:

1. **Loads context** — the active profile, the domain rules, the target repo's `AGENTS.md` and
   `docs/decisions.md`, the feature's spec directory under `specs/`, and any task state
   (reconciled against git; git always wins).
2. **Classifies** — picks a profile, a risk tier (`0`-`3`), the assurance floor that tier demands,
   and one of 13 playbooks.
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

## Project planning

Ask `rc-router` to help shape a new project idea. The planning playbook helps you model the
problem, select the first milestone, define done, and agree on tests in chat. Ask to save the
agreed milestone when you want a spec written. Ask separately when you want implementation
to begin.

Use `docs/` for guides and reference material. Record durable choices in
[the decisions log](docs/decisions.md) and add an entry under **Unreleased** in the
[changelog](CHANGELOG.md) for each change merged to `main`.

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

The validator enforces the listed contents of closed directories such as `skills/`, `profiles/`,
`contracts/`, and `scripts/`. The `docs/` directory can hold additional documentation alongside
the required decisions log. The root allows custom entries such as `.archive/` and `LICENSE`.
The reserved root entries `playbooks`, `SPEC.md`, `spec.md`, and `node_modules` fail verification.

Inside the owned directories, paths that git ignores and does not track (an editor's scratch
file, `.DS_Store`) are skipped. Git decides what is ignored; a tracked file is always judged.
`node scripts/verify.mjs --include-ignored` judges those paths too, and the installer always runs
it that way, because it copies whole directories into `dist/`.

## Install

Download `install.sh` from the [v0.2.1 release](https://github.com/RobinChiam/rcstack/releases/tag/v0.2.1)
and run `bash install.sh`. It downloads the matching release archive over HTTPS and installs
it under `~/.rcstack`. Release installs also require `curl` and `tar`.

From a source checkout:

```bash
bash adapters/install.sh --dry-run    # print the plan; changes nothing
bash adapters/install.sh              # promote into ~/.rcstack/dist and link the 5 skills
```

The installer verifies the source first and refuses to overwrite any non-symlink in a harness
directory. During an upgrade, it uses an atomic exchange when available. Otherwise, it moves the
old installation aside and then moves the replacement into place, so `dist/` can be briefly absent.
A new installation seeds `~/.rcstack/profiles/rcstack-main.yaml` and initializes the
`~/.rcstack/runtime/` shadow Git repository. The router uses the consolidated file if present,
then an existing legacy local domain file, then the shipped defaults. Upgrades preserve your
machine-local profiles.

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
| engineering | `project-planning` | 0 | A0 |
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

## Risk tiers and assurance

The **risk tier** describes the work and selects the workflow. The **required assurance** is the
minimum evidence that workflow calls for. **Achieved assurance** describes the evidence currently
on record for the result. A task can require stronger evidence than its usual floor.

| Risk tier | Typical work | Usual floor |
| --- | --- | --- |
| **T0** | Read-only lookup, explanation, or a planning discussion in chat | **A0** |
| **T1** | Quick, reversible work such as a prototype, UI polish, or a practice session | **A1** |
| **T2** | Work people will rely on, such as a feature, bug fix, refactor, or research report | **A2** |
| **T3** | Changes to sensitive boundaries, such as installers, auth, infrastructure, schemas, or rcstack's verifier | **A3** |

| Risk tier | Achieved A0 | Achieved A1 | Achieved A2 | Achieved A3 |
| --- | --- | --- | --- | --- |
| **T0** | **Expected.** The read-only answer or plan is the deliverable. | Outside the normal T0 workflow. | Outside the normal T0 workflow. | Outside the normal T0 workflow. |
| **T1** | Below the usual floor. The shipped **Socratic session** explicitly uses T1/A0. | **Meets the usual floor.** Mechanical checks passed. | Above the usual floor if the stronger evidence was actually collected and admitted. | Above the usual floor if the hardened evidence and audit were collected and admitted. |
| **T2** | Gap. Mechanical verification is missing for the current result. | Gap. Mechanical checks passed, but the behavioral tests or qualifying audit are still missing. | **Meets the usual floor.** Tests and independent audit support the change. | Exceeds the usual floor. A task can also explicitly require A3. |
| **T3** | Gap. Mechanical verification is missing for the current result. | Gap. Mechanical checks alone leave both behavioral and hardened assurance unmet. | Gap. Behavioral assurance is established, but hardened evidence or the stricter audit is still missing. | **Meets the required floor.** The hardened checks and cross-family audit support the change. |

### How assurance is calculated

The [Work Receipt](contracts/work-receipt.md) records the base and head commits, changed files,
verification command and exit code, passed check classes, and any open audit findings. The
[receipt gate](scripts/rc-receipt.mjs) validates the fields and types, checks the claimed range
and exact file list against Git, checks the allowed paths when supplied, requires a clean
working tree, and requires a recorded successful verification command. It computes assurance
for admitted receipts using this ladder.

| Level | Evidence |
| --- | --- |
| **A0** | The current result has no admitted mechanical evidence. This also covers read-only work without a receipt. |
| **A1** | The recorded verification command exited `0` and `mechanical` checks passed, such as formatting, lint, or type checks. |
| **A2** | A1 plus passing `behavioral` tests for the changed paths and an independent audit with zero open Blockers. |
| **A3** | A2 plus passing `hardened` checks and a cross-family audit with zero open Blockers or Majors. Hardened checks target edge cases, security, or runtime behavior. |

Audit counts stay `null` until an independent audit runs. That caps unaudited work at A1.
The router enforces reviewer independence and records the audit result. The receipt gate
computes the level from the recorded check classes and finding counts.

### How the floor is enforced

For stateful work, only an integrated receipt spanning the task's base commit to the current
`HEAD` sets achieved assurance. Slice receipts document individual pieces of work. When
`HEAD` moves, the next state transition resets achieved assurance to A0 unless it admits a
new integrated receipt for the new head.

`rc-state.mjs` requires a clean tree and zero open state blockers before entering
`AWAITING_REVIEW` or `SHIPPED`. Below the required floor, it blocks the transition unless the
gap is explicitly acknowledged with `--ack-assurance-gap`. The router brings that decision to
the human, records the lower achieved level, puts an **ASSURANCE GAP** banner on the Review
Map, and logs the gap at closeout when the tier requires telemetry.

## State management

Tier 2 and Tier 3 workflows track one active task per repository and branch under
`~/.rcstack/runtime/state/`, in a local Git repository used for task history. The main
thread updates state through [rc-state.mjs](scripts/rc-state.mjs). Each update acquires a
lock, checks the expected revision, writes the new state atomically, and commits the change
to that history. A stale revision requires reading the latest state before retrying.

```text
TRIAGE → RESEARCHING → PLANNING → EXECUTING → VERIFYING → AUDITING → AWAITING_REVIEW → SHIPPED
```

Verification, audit, or human review can send work back to execution. A blocked task resumes
in the phase it left. `show` reads the committed task state. `reconcile` compares it with the
live Git branch, head, and working tree, reporting drift without writing. `close` removes
the active state after shipping while retaining its history in the local Git repository.

## Review Maps and type safety

rcstack uses **runtime validation** for the handoffs between agents. The profile schema
checks configuration types and allowed values. The receipt gate checks typed evidence and
its Git scope. The state manager checks state fields, revisions, allowed transitions, and
the assurance floor. These checks make malformed handoffs fail at the point they enter the
workflow.

The [Review Map](contracts/review-map.md) is the human-readable record of those checks. The
router prepares it at `AWAITING_REVIEW` with the required and achieved levels, changed files
in risk order, assumptions, audit findings and their disposition, and verification commands
and results. The verifier checks the required sections and fields in the Markdown contract.
The scripts enforce the validated inputs and state gates, and the map shows the evidence
behind the decision.

## Default model stack

Defined in `profiles/rcstack-main.yaml` with shared aliases and domain overrides. `fb` is the
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

## How the verifier works

[verify.mjs](scripts/verify.mjs) checks the repository against the system spec in three
cumulative slices. Running it with no arguments runs all three.

| Slice | What it checks |
| --- | --- |
| **1 · Foundation** | Required files, decision-log fields, feature-local spec layout, owned-tree boundaries, symlinks, and dependency rules. |
| **2 · Routing and contracts** | Strict YAML and schema validation for the consolidated profile and its domain projections, reviewer independence, contract structure, and playbook frontmatter, tier gates, and router-only boundaries. |
| **3 · Full repository** | All five skills, script and adapter syntax, the test suite inventory, and references between owned files. |

The verifier reports each check and exits `0` when all pass or `1` when any fail. In
repository mode it normally skips untracked paths ignored by Git. The installer passes
`--include-ignored` before copying directories. The profile and specs modes check narrower
inputs. Use `--domain` with `--profile` to print one validated domain projection as JSON.

```bash
node scripts/verify.mjs --slice=2
node scripts/verify.mjs --profile profiles/rcstack-main.yaml --domain engineering
node scripts/verify.mjs --specs specs
```

## Develop

```bash
node scripts/verify.mjs                 # repo invariants and contracts
node --test tests/*.test.mjs            # hermetic unit tests
bash adapters/install.sh --dry-run      # activation plan, no changes
```

All three must pass before a change is done. Durable choices are recorded in `docs/decisions.md`.
