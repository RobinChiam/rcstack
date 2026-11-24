# Spec: Gitignore-aware validation with an open repository root

Tier 3 (it edits `scripts/verify.mjs` and `adapters/install.sh`). Required assurance `A3`.

## Problem Statement

`scripts/verify.mjs` judged everything on disk and allowed only a fixed list of root entries. A
local, git-ignored `.archive/` directory in an otherwise valid checkout therefore failed verify,
failed the tests that run verify on the checkout, and made `adapters/install.sh` refuse to
install. When this is done, a repository may hold custom top-level entries, and local files git
ignores do not fail the check, while everything the installer copies is still judged in full.

## Non-Goals

- Parsing `.gitignore`. Git is the only authority on what is ignored.
- Loosening any rule inside an owned directory. Their membership stays exact.
- Changing `scripts/rc-receipt.mjs`. Its boundary check reads the commit range and stays strict.
- Teaching the validator the `Ignored / Archived Paths:` list. It is guidance that `rc-doctor`
  and `rc-router` follow in target repositories.

## Data Shapes & Interfaces

- `OWNED_DIRS`: `assets`, `docs`, `specs`, `rules`, `profiles`, `contracts`, `skills`,
  `scripts`, `adapters`, `tests`. Structure, symbolic links and stray `playbooks` directories are
  judged only inside them (and for the root files `README.md` and `AGENTS.md`).
- `FORBIDDEN_ROOT_ENTRIES`: `playbooks`, `SPEC.md`, `spec.md`. With `node_modules`, these fail at
  the root whatever they are, ignored or not. `TOP_LEVEL_ENTRIES` is removed.
- `gitIgnoredPaths(dir): Set<string>`: the output of `git ls-files -z --others --ignored
  --exclude-standard --directory` run in `dir`. Paths are relative to `dir`; an ignored directory
  is one entry ending in `/`. Empty when git fails or `dir` is not in a worktree.
- `runVerify({ root, slice, includeIgnored = false })`, `runSpecsCheck({ specsPath, label,
  includeIgnored = false })`, and `checkSpecsTree(dir, label, { ignored })`.
- CLI: `--include-ignored`, valid with the repository mode and with `--specs`.
- `adapters/install.sh` runs `verify.mjs --root <source> --include-ignored --quiet`.

## Non-Overlapping File Slices

| Slice | Owns (exact paths or globs) | Depends on | Capability |
| :--- | :--- | :--- | :--- |
| S1 validator | `scripts/verify.mjs`, `tests/verify.test.mjs` | — | `security_builder` |
| S2 installer | `adapters/install.sh`, `tests/install.test.mjs` | S1 | `security_builder` |
| S3 documents | `AGENTS.md`, `README.md`, `docs/decisions.md`, `specs/**`, `skills/rc-init/SKILL.md`, `skills/rc-doctor/SKILL.md`, `skills/rc-router/SKILL.md` | S1 | `architect_blueprint` |

## Failure Modes

- An ignore rule hides a tracked file → impossible: only untracked paths are listed.
- An ignored, unreviewed file sits in a directory the installer copies → the installer's verify
  run includes ignored paths and refuses.
- An ignore rule is used to excuse a missing required file → an ignored path, or one inside an
  ignored directory, counts as absent in listings and direct lookups alike, so a required entry
  that is absent or ignored is reported missing. Forbidden entries (the root names above and a
  root `package.json` declaring dependencies) are looked up whether or not git ignores them.
- Git is absent, fails, or the root is not a worktree → the ignored set is empty and every path
  is judged.
- `GIT_DIR` or `GIT_WORK_TREE` in the environment points at another repository → those variables
  are removed for the git call.
- A repository config names an fsmonitor program → the call sets `core.fsmonitor=false`.
- A local ignore rule (`.git/info/exclude`, the user's excludes file) hides an untracked rogue
  file in an owned directory from a default run → accepted: such a file is never in a commit, so
  it cannot pass review or the receipt gate, and it cannot be installed. Residual risk: a default
  run on a developer machine does not report it.
- A custom top-level directory holds symbolic links, a `playbooks` tree or a `SPEC.md` → not
  judged; nothing outside the owned directories is installed or read as a rule.

## Acceptance Criteria

- [ ] A git-ignored `.archive/` holding arbitrary files, a stray `.md`, a `playbooks` tree and a
      symbolic link passes `node scripts/verify.mjs`.
- [ ] A tracked custom top-level directory passes, as does one outside any git worktree.
- [ ] A rogue directory in `skills/`, an extra playbook, script, profile or contract, and a
      top-level `playbooks/` (ignored or not) each fail, tracked or untracked.
- [ ] A tracked file matching an ignore pattern is still judged.
- [ ] `--include-ignored` reports ignored paths inside owned directories; the installer uses it.
- [ ] `--specs <dir>` skips ignored entries, and judges them with `--include-ignored`.

## Verification Plan

- Command: `node scripts/verify.mjs && node --test tests/*.test.mjs && bash adapters/install.sh --dry-run`
- Mechanical: `node --check` on every script and `bash -n` on the installer, both run by verify.
- Behavioral: the "custom top-level paths and git-ignored paths" suite in `tests/verify.test.mjs`
  and the ignored-path install test in `tests/install.test.mjs`.
- Hardened: verify and the installer dry run in a checkout that holds a real ignored `.archive/`;
  a fresh-context cross-family audit of the change.
