# Spec: Feature-local specs under `specs/`

Tier 3 (it edits `scripts/verify.mjs`). Required assurance `A3`.

## Problem Statement

A feature's spec and the documents written while changing and implementing it have no home in the
repository. `DEC-012` closed the repository root and moved specs outside it, so:

- a change and the design it implements are not reviewed, versioned, or found together;
- requirements and planning notes scatter into chat, pull request text, or `docs/`;
- creating a `specs/` directory makes `node scripts/verify.mjs` fail, and because
  `adapters/install.sh` promotes only a source that passes verify, it also blocks installation.

When this is done, every feature has its own directory under `specs/` that holds its `spec.md` and
whatever else the task needs, a feature can be split into sub-specs nested beneath it, the
validator enforces that shape, and the installer installs with `specs/` present.

## Non-Goals

- A second copy of the system spec (`specs/initialization-build/spec.md`). It stays canonical; a feature spec describes one
  change on top of it. When a feature changes the system contract, the system spec changes with it.
- Enforcing the section template of `contracts/spec.md` on every `spec.md`. The validator checks
  the tree's shape, not the prose inside it.
- Installing `specs/`. It is source-only and never enters `~/.rcstack/dist/`.
- Storing runtime artifacts. Task state, telemetry, and Work Receipts stay in `~/.rcstack/runtime/`.
- Supporting folders without a `spec.md`. Every directory under `specs/` is a spec directory.
- Restoring earlier specs. No historical spec is migrated into `specs/` by this change.

## Data Shapes & Interfaces

**Layout**

```text
specs/
└── <feature>/                  # a spec directory
    ├── spec.md                 # required
    ├── requirements.md         # optional: any file the task needs
    ├── planning.md             # optional
    └── <sub-feature>/          # optional sub-spec, to any depth
        ├── spec.md             # required
        └── ...
```

**Rules**

1. `specs/` holds only directories.
2. Every directory under `specs/`, at any depth, contains a regular file `spec.md`. A sub-spec
   therefore always sits inside its parent spec's directory; `specs/a/b/spec.md` cannot exist
   without `specs/a/spec.md`.
3. Directory names are lowercase kebab-case: `[a-z0-9]+(-[a-z0-9]+)*`.
4. `spec.md` is a non-empty regular file. Its prose is not judged.
5. Any other regular file may sit beside `spec.md`. No symbolic links, pipes, sockets, or devices.
6. A parent spec constrains its sub-specs; a sub-spec narrows its parent and never contradicts it.
7. Documents about changing or implementing a feature live in that feature's directory and
   nowhere else in the repository. They are committed with the work, before the integrated
   receipt. The Review Map is the exception: it is delivered at review as the pull request body,
   because a file added after the integrated receipt would dirty the tree or reset the assurance.

**Validator** (`scripts/verify.mjs`)

- `TOP_LEVEL_ENTRIES` gains `specs`. (Superseded by `DEC-015`: the root is now open, and `specs`
  is one of the owned directories; see `specs/gitignore-aware-validation/spec.md`.)
- `export function checkSpecsTree(dir, label = 'specs'): string[]` returns one message per
  violation of rules 1-5; an empty list means the tree is valid. An empty or missing `dir` is
  reported as missing, never resolved to another directory.
- Slice 1 runs it on `<root>/specs` when that directory exists. A target repository may have no
  `specs/` at all; this repository always has one, because its system spec lives there.
- `node scripts/verify.mjs --specs <dir>` validates any specs tree, so `rc-init` and `rc-doctor`
  can check a target repository from the installed `dist`. It exits `0` or `1` like every mode.
- The cross-reference check treats `specs/...` paths in documentation as references that must
  resolve. The contents of feature specs are not scanned: a spec may name files that do not exist
  yet. The system spec is the exception, because it describes the repository as it is.

**Installer** (`adapters/install.sh`): no change. It stages `rules/`, `profiles/`, `contracts/`,
`scripts/`, and `skills/` only.

## Non-Overlapping File Slices

| Slice | Owns (exact paths or globs) | Depends on | Capability |
| :--- | :--- | :--- | :--- |
| S1 validator | `scripts/verify.mjs`, `tests/verify.test.mjs` | — | `security_builder` |
| S2 installer proof | `tests/install.test.mjs` | S1 | `security_builder` |
| S3 system contract | `specs/initialization-build/spec.md`, `AGENTS.md`, `README.md`, `docs/decisions.md`, `contracts/spec.md`, `skills/rc-router/SKILL.md`, `skills/rc-init/SKILL.md`, `skills/rc-doctor/SKILL.md` | S1 | `architect_blueprint` |
| S4 this feature's documents | `specs/feature-local-specs/**` | — | `architect_blueprint` |

`scripts/verify.mjs` matches `tier3_path_patterns`, so the whole change is Tier 3.

## Failure Modes

- A sub-feature folder is created without a `spec.md` → rule 2 fails verify and names the folder.
- A `spec.md` is placed under a folder that is not a spec directory → the same rule reports the
  folder that is missing its `spec.md`.
- A loose file or a symbolic link is dropped into `specs/` → rules 1 and 5 fail verify.
- A directory named with spaces or capitals → rule 3 fails verify.
- A feature spec about playbooks is named `playbooks` → allowed: the rule against stray
  `playbooks` directories applies outside `specs/` only.
- The validator misreads a document while judging its prose (a heading inside fenced code, YAML
  frontmatter, nested fences) → it does not judge prose at all. Rule 4 only asks for a non-empty
  file, which needs no Markdown parser.
- A named pipe or other special file sits beside a spec → rule 5 fails verify, without reading it.
- The validator loosens the closed root more than intended → only `specs` is added to
  `TOP_LEVEL_ENTRIES`, and a test asserts other stray root entries still fail.
- The installer starts copying `specs/` into `dist/` → `tests/install.test.mjs` asserts the exact
  contents of `dist/` while the source contains `specs/`.
- An invalid specs tree is promoted → the installer's verify preflight refuses it before changing
  anything; a test covers this.
- Runtime state is written into a spec directory → not mechanically detectable; it stays a rule
  in `AGENTS.md` and `rc-router`, and is a residual risk.

## Acceptance Criteria

- [ ] `node scripts/verify.mjs` passes with `specs/feature-local-specs/spec.md` present.
- [ ] It fails, naming the path, for: a loose file in `specs/`; a directory without `spec.md` at
      any depth; a name that is not kebab-case; an empty `spec.md`; a `spec.md` that is not a
      regular file; a pipe or other special file; a symbolic link.
- [ ] `specs/a/spec.md` with `specs/a/b/spec.md`, plus `requirements.md` and `planning.md` beside
      either, passes.
- [ ] A stray root entry other than `specs` still fails. (Withdrawn by `DEC-015`.)
- [ ] `node scripts/verify.mjs --specs <dir>` exits `0` for a valid tree and `1` for an invalid one.
- [ ] `bash adapters/install.sh --home <temp home>` installs into `<temp home>/.rcstack`, links
      all 5 skills into all 5 harness directories, and `dist/` contains no `specs/`.
- [ ] The system spec, `AGENTS.md`, and `docs/decisions.md` describe the layout; `DEC-012` is superseded.

## Verification Plan

- Command: `node scripts/verify.mjs && node --test tests/*.test.mjs && bash adapters/install.sh --dry-run`
- Mechanical: `node --check` on every script and `bash -n` on the installer, both run by verify.
- Behavioral: `tests/verify.test.mjs` (layout rules, `--specs`, the closed root) and
  `tests/install.test.mjs` (install with `specs/` present; refusal on an invalid tree).
- Hardened: a real install into a throwaway home, checking every link target and that the
  installed scripts run from `dist/`; a fresh-context cross-family audit of the change.
