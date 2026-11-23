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

Prove that this machine can run rcstack as its profiles describe: every capability resolves to a live model, every builder has a reachable independent reviewer, and every harness link points at the installed dist.

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
   ACP shell bridge when the orchestration tools are absent). In a standalone CLI harness there is
   nothing to discover: report `degraded_single_harness` and skip to step 7.
5. **Resolve every binding.** For each capability in each profile, match `driver_kind` to a live
   provider and `model` to a live catalog id: names are equal after lowercasing and dropping every
   non-alphanumeric character, compared with the live label, the live id, or the provider display
   name followed by the label. Check that each `options` key exists for that model. Walk
   `secondary` and `fallback` the same way. Mark each as resolved, unavailable, or resolved through
   its chain.
6. **Prove reviewer reachability.** For every builder model in `review_matrix`, resolve its
   `primary` (and `tier1_primary`) and `fallback` reviewers, plus `default_fallback`. Flag any
   builder whose reviewers are all unreachable: Tier 2 and Tier 3 work built by it cannot reach
   its assurance floor on this machine.
7. **Check harness links.** For each of `~/.agents/skills`, `~/.claude/skills`, `~/.codex/skills`,
   `~/.gemini/skills`, and `~/.cursor/skills`, and each of the five skills, the entry must be a
   symlink to `~/.rcstack/dist/skills/<skill>`. Report missing links, links pointing anywhere else
   (especially into a source checkout), dangling rcstack links, and non-symlink collisions.
8. **Repair only with approval.** Missing or misdirected links are fixed by re-running the
   installer, which the human starts. Never replace a non-symlink, never edit files under
   `~/.rcstack/dist/`, and never write a provider instance id into a profile.
9. **Print the setup report:** install metadata, one line per profile (valid or the error), the
   resolution table, reviewer reachability, link status, and the exact next action for each problem.

## Definition of Done

- Every machine-local profile passed `verify.mjs --profile`, or its failure was reported verbatim.
- Every capability binding is marked resolved, resolved through its chain, or unavailable.
- Every builder model has a reachable reviewer that is not itself, or the gap is flagged.
- All 25 harness links were checked against `~/.rcstack/dist/skills/<skill>`.
- Nothing under `~/.rcstack/` or any harness directory was changed without explicit approval.
