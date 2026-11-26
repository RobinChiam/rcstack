---
name: rc-setup
description: Discovers live models, validates machine-local profiles, and checks that harness skill links point at the installed dist.
version: 0.1.0
entry_mode: standalone_or_router
capability: setup
invokes_contracts: []
invokes_scripts:
  - scripts/verify.mjs
---

# rc-setup

## Single Job

Prove that this machine can run rcstack as its profiles describe: every primary/chain capability, configured paired model, external companion, and independent reviewer is checked with explicit availability evidence, and every harness link points at the installed dist.

## When to Use

- Right after `adapters/install.sh` has run on a machine, and after every re-install.
- A profile in `~/.rcstack/profiles/` was edited.
- Providers or models changed, or `rc-router` reported a capability or reviewer it could not resolve.
- A harness cannot find an rcstack skill, or a skill looks stale.

## Do NOT Use When

- There is a task to do — use `rc-router`. Setup never routes, builds, or reviews work.
- rcstack is not installed (`~/.rcstack/install-meta.json` is missing). Stop and ask the human to
  run the installer from the source checkout; never run it for them unasked.
- A target repository needs bootstrapping — use `rc-init`.
- You want to change routing because of past results — use `rc-retro`, which proposes the diff.

## Procedure

1. **Confirm the install.** Read `~/.rcstack/install-meta.json` and report version, commit, and
   install time. Confirm `~/.rcstack/dist/skills/` holds exactly the five skills and
   `~/.rcstack/runtime/` is a git repository with no remote.
2. **Validate each machine-local profile.** For every `~/.rcstack/profiles/*.yaml` run
   `node ~/.rcstack/dist/scripts/verify.mjs --profile <file>`. It checks the strict YAML subset,
   the schema, review-matrix coverage, and `reviewer != builder`. A failing profile is reported
   with the validator's exact message and is not used.
3. **Show drift from the defaults.** Diff each profile against
   `~/.rcstack/dist/defaults/profiles/<profile>.yaml`. Report the differences; never overwrite a
   machine-local profile.
4. **Discover live models.** In T3 Code, call `orchestrator_capabilities` once per thread (use the
   ACP shell bridge when the orchestration tools are absent). When catalog discovery is unavailable
   (such as in a standalone CLI harness or a failed discovery call), report
   `degraded_single_harness` and still run steps 5 through 7: mark every catalog-dependent primary,
   `secondary`, `fallback`, `paired`, and `review_matrix` binding as `unverified` (never
   `unavailable`, because discovery could not check them), and still check configured external
   `companion` dependencies against observable evidence in the current environment.
5. **Resolve every binding and configured dependency.** For each capability in each profile, check
   and report three categories separately so a resolved primary or fallback never masks a missing or
   unchecked companion or paired model:
   - **Primary model and fallback chain (`secondary`, `fallback`):** match `driver_kind` to a live
     provider and `model` to a live catalog id: names are equal after lowercasing and dropping every
     non-alphanumeric character, compared with the live label, the live id, or the provider display
     name followed by the label. Check that each configured `options` key and value is supported for
     that model. Walk `secondary` and `fallback` the same way. Mark each capability's primary/chain
     status as `resolved`, `resolved through chain`, `unavailable` (catalog queried and no matching
     provider, model, and supported options were present), or `unverified` (catalog discovery
     unavailable).
   - **Configured `paired` models:** check and report every `paired` binding separately by profile,
     capability, and configured model name, even when the primary or fallback resolves. A `paired`
     model is `available` only when live discovery shows a matching `driver_kind`, matching `model`,
     and supported `options` (naming the matched live provider and catalog id as evidence). Mark it
     `unavailable` when discovery succeeded and no matching provider, model, or options exist, and
     `unverified` when catalog discovery is unavailable.
   - **Configured external `companion` dependencies (`driver_kind: "external"`):** check and report
     every `companion` separately by profile, capability, and configured name; a resolved primary,
     `secondary`, `fallback`, or `paired` model never satisfies an external companion. A companion
     is `available` only with observed evidence of the corresponding capability in the current
     environment (such as a live MCP server/tool, CLI binary, or configured integration exposing that
     capability), and the report must identify that exact evidence and whether it came from the live
     environment or a supplied inventory fixture. Mark it `unavailable` when the relevant check
     directly observes its absence (naming what was checked and found absent), and `unverified` when
     the dependency cannot be checked in the current environment (naming what evidence is missing).
6. **Prove reviewer reachability.** For every builder model in `review_matrix`, resolve its
   `primary` (and `tier1_primary`) and `fallback` reviewers, plus `default_fallback`. Mark each
   reviewer `available`, `unavailable`, or `unverified` (when catalog discovery is unavailable).
   Flag any builder whose reviewers are all unreachable or unverified: Tier 2 and Tier 3 work built
   by it cannot reach its assurance floor on this machine without a verified independent reviewer.
7. **Check harness links.** For each of `~/.agents/skills`, `~/.claude/skills`, `~/.codex/skills`,
   `~/.gemini/skills`, and `~/.cursor/skills`, and each of the five skills, the entry must be a
   symlink to `~/.rcstack/dist/skills/<skill>`. Report missing links, links pointing anywhere else
   (especially into a source checkout), dangling rcstack links, and non-symlink collisions.
8. **Repair only with approval.** Missing or misdirected links are fixed by re-running the
   installer, which the human starts. Never replace a non-symlink, never edit files under
   `~/.rcstack/dist/`, and never write a provider instance id into a profile.
9. **Print the setup report:** install metadata, one line per profile (valid or the error), the
   primary/chain resolution table, a separate table of configured `paired` models and external
   `companion` dependencies (each naming profile, capability, dependency role and name, status
   `available` / `unavailable` / `unverified`, and the exact evidence observed or missing, noting
   live environment vs. fixture), reviewer reachability, link status, and the exact next action for
   each `unavailable` or `unverified` item.

## Definition of Done

- Every machine-local profile passed `verify.mjs --profile`, or its failure was reported verbatim.
- Every capability's primary/chain binding is marked `resolved`, `resolved through chain`,
  `unavailable`, or `unverified`.
- Every configured `paired` model and external `companion` is reported separately by name as
  `available`, `unavailable`, or `unverified`, naming the observed evidence or what could not be
  checked.
- Every builder model has a reachable reviewer that is not itself, or the `unavailable`/`unverified`
  gap is flagged.
- All 25 harness links were checked against `~/.rcstack/dist/skills/<skill>`.
- Nothing under `~/.rcstack/` or any harness directory was changed without explicit approval.
