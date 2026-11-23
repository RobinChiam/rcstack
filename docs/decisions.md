# Decisions Log — `rcstack-beta`

The evergreen record of choices that shape this repository. Managed through `rc-state`; checked by
`node scripts/verify.mjs`. Entries are never deleted: a reversed decision is marked
`Superseded by DEC-NNN` and the replacement explains why.

Every entry follows this exact template, with no extra fields or prose:

```markdown
### DEC-NNN: <Short Title>
- **Date:** YYYY-MM-DD
- **Status:** Accepted | Superseded by DEC-XXX
- **Decision:** <What we chose and why>
- **Rejected Alternative:** <What we explicitly ruled out and why>
- **Guardrail:** <Deterministic check, lint rule, or invariant enforcing this decision>
```

## Entries

### DEC-001: Two-tier layout with ten atomic skills and twelve nested playbooks
- **Date:** 2026-11-23
- **Status:** Accepted
- **Decision:** `skills/` holds exactly ten atomic skills, and the twelve playbooks plus `TEMPLATE.md` nest under `skills/rc-router/playbooks/{engineering,study,research}/`. Harnesses discover only the ten top-level skills, so a playbook can never be picked up as a standalone skill.
- **Rejected Alternative:** A flat layout with playbooks as top-level skills or a top-level `playbooks/` directory. It floods harness skill discovery with 22 entries and lets a model self-trigger a workflow without tier classification.
- **Guardrail:** `scripts/verify.mjs` groups 1.3, 1.4, 2.9, and 3.1 fail on any extra skill directory, any stray `playbooks` directory, and any playbook outside the approved 7/3/2 set; `adapters/install.sh` links only the ten named skills.

### DEC-002: Playbooks are router-only
- **Date:** 2026-11-23
- **Status:** Accepted
- **Decision:** Every playbook declares `entry_mode: router_only` and carries the verbatim `ROUTER-ONLY:` rule, so profile selection, risk-tier classification, and model resolution always happen in `rc-router` before a workflow starts. Orchestrated skills carry a matching router-dispatched boundary sentence.
- **Rejected Alternative:** Self-triggering playbooks that classify their own risk. Each one would re-implement routing, and reviewer selection could be skipped by entering a workflow midway.
- **Guardrail:** `scripts/verify.mjs` group 2.10 requires `entry_mode: router_only` and the verbatim boundary in all twelve playbooks, group 2.8 requires `rc-router` to reference every playbook, and groups 2.8 and 3.2 enforce the negative boundary for each skill `entry_mode`.

### DEC-003: Reviewer never equals builder
- **Date:** 2026-11-23
- **Status:** Accepted
- **Decision:** Each profile carries a `review_matrix` mapping every builder-capable model to a different primary and fallback reviewer, and the schema pins `allow_self_review_on_fallback` to `false`. When no distinct reviewer is reachable the run degrades visibly instead of reviewing itself.
- **Rejected Alternative:** Letting the building model review its own work in a fresh context when another provider is unavailable. Same-model review shares the builder's blind spots and reads as independent evidence when it is not.
- **Guardrail:** `scripts/verify.mjs` group 2.4 proves `primary`, `tier1_primary`, and `fallback` differ from the builder and from each other for all three profiles, group 2.3 proves the schema rejects weakened invariants, and `scripts/log-telemetry.mjs` rejects any row where `reviewer_model` equals `builder_model`.

### DEC-004: Zero-dependency validator with a strict YAML subset
- **Date:** 2026-11-23
- **Status:** Accepted
- **Decision:** `scripts/verify.mjs` and `scripts/log-telemetry.mjs` use Node.js built-ins only, with an in-repo strict YAML subset parser and JSON Schema subset validator. The parser rejects every construct another YAML parser could read differently, and the validator rejects schema keywords it does not enforce.
- **Rejected Alternative:** Depending on `npm` packages for YAML and JSON Schema. That adds an install step and a supply-chain surface to the guardrail that protects the stack, and breaks on a fresh machine before `npm install`.
- **Guardrail:** `scripts/verify.mjs` group 1.5 fails on any import that is not a `node:` built-in or sibling script, on any `package.json` dependency, and on a `node_modules` directory; group 2.1 fails on unsupported schema keywords.

### DEC-005: Model names live only in profiles and the README
- **Date:** 2026-11-23
- **Status:** Accepted
- **Decision:** Skills, playbooks, rules, contracts, the installer, and this log name abstract roles only; `profiles/*.yaml` binds roles to concrete models and `README.md` documents the binding. Swapping a model is a one-file profile edit.
- **Rejected Alternative:** Naming preferred models inline in skills and playbooks for readability. Every model release would then require editing dozens of files, and stale names would silently misroute work.
- **Guardrail:** `scripts/verify.mjs` group 1.6 scans for known model families and group 2.11 scans for every model string bound in the profiles, across `skills/`, `rules/`, `contracts/`, `adapters/`, `AGENTS.md`, and this file.

### DEC-006: Profile tier flags are binding on playbooks
- **Date:** 2026-11-23
- **Status:** Accepted
- **Decision:** A playbook must honour every gate its `default_tier` sets in its profile, and Tiers 2 and 3 keep spec, verify, cross-model audit, Review Map, and telemetry switched on in all three profiles. A playbook whose summary omits a gate still closes with it.
- **Rejected Alternative:** Per-playbook exemptions, such as a Tier 2 maintenance or research playbook that skips the audit or Review Map. The tier would stop predicting the ceremony a human can rely on.
- **Guardrail:** `scripts/verify.mjs` group 2.5 requires all five flags to be `true` for Tiers 2 and 3, and group 2.10 cross-checks each playbook's `required_skills`, `required_roles`, `contracts`, and exit gate against its tier flags.

### DEC-007: One schema validator, exported from the verifier
- **Date:** 2026-11-23
- **Status:** Accepted
- **Decision:** `scripts/log-telemetry.mjs` imports the JSON Schema subset validator from `scripts/verify.mjs`, which runs its checks only when executed directly. Telemetry rows and profiles are therefore judged by the same code that the validator probes.
- **Rejected Alternative:** Duplicating the validator in both scripts, or adding a shared library directory under `scripts/`. Duplicates drift apart, and an extra directory departs from the exact repository tree.
- **Guardrail:** `scripts/verify.mjs` group 1.5 restricts script imports to built-ins and sibling `./*.mjs` files, and group 3.3 runs `scripts/log-telemetry.mjs` end to end in a sandboxed home with accepted and rejected events.

### DEC-008: The installer plans before it acts and never overwrites real files
- **Date:** 2026-11-23
- **Status:** Accepted
- **Decision:** `adapters/install.sh` classifies every destination first and aborts before the first change if any destination is a real file or directory. It links only the ten named skills, appends at most one ignore pattern, never writes git config, and rejects unknown arguments so a mistyped `--dry-run` cannot install.
- **Rejected Alternative:** A single pass that links as it goes, or a force flag that replaces existing directories. A mid-run abort would leave a half-installed harness, and forced replacement could destroy a user's own skill.
- **Guardrail:** `scripts/verify.mjs` group 3.4 runs the installer with `--dry-run` in a sandboxed home across six scenarios (empty, already linked or linked elsewhere, real file in the way, mistyped flag, unusable global gitignore, aliased harness directories) and fails on any mutation, missing plan line, or zero exit after a conflict.

### DEC-009: The independent reviewer is an abstract role resolved by the review matrix
- **Date:** 2026-11-23
- **Status:** Accepted
- **Decision:** `independent_reviewer` is a valid abstract role for skills and playbooks but has no entry under a profile's `roles`; `rc-router` resolves it from `review_matrix` using the builder of record. The schema lists it in `$defs.abstract_role` alongside the seven profile roles.
- **Rejected Alternative:** A fixed `roles.independent_reviewer` model per profile. A single fixed reviewer would collide with itself whenever that model also builds.
- **Guardrail:** `scripts/verify.mjs` group 2.1 pins `$defs.abstract_role` to the seven profile roles plus `independent_reviewer`, and groups 2.10 and 3.2 reject any role outside that list.

### DEC-010: Validated paths hold no symbolic links
- **Date:** 2026-11-23
- **Status:** Accepted
- **Decision:** Everything the validator reads (`skills/`, `profiles/`, `contracts/`, `rules/`, `scripts/`, `adapters/`, `docs/`, `AGENTS.md`, `README.md`) must be a real file or directory. The repository is the target of the installer's symlinks and has no need to contain any itself.
- **Rejected Alternative:** Resolving symlinks inside the validator. Reading through a link while walking past it let linked content skip the model-name and cross-reference scans, and following links out of the tree would validate files that are not part of the repository.
- **Guardrail:** `scripts/verify.mjs` group 1.7 fails on any symbolic link under those paths, and group 1.3 uses `lstat` so a file, directory, or dangling link named `playbooks` is rejected.

### DEC-011: Tier 3 never completes without a cross-model audit
- **Date:** 2026-11-23
- **Status:** Accepted
- **Decision:** A Tier 3 run in a harness with no distinct reviewer still executes every phase up to and including `rc-verify`, then stops with the audit recorded as outstanding and handed to the human. This keeps the standalone degradation the spec requires while making sure security-critical work is never marked done on a self-review or on no review.
- **Rejected Alternative:** Refusing to start a Tier 3 run without a reachable reviewer, or letting it finish degraded with a sign-off note. The first blocks useful grounded, specified, and verified work in a single harness; the second would let unaudited security changes count as complete.
- **Guardrail:** `skills/rc-router/SKILL.md` and `skills/rc-router/playbooks/engineering/security-critical.md` state the same rule, the `security-critical` exit gate requires a non-null `reviewer_model`, and `scripts/log-telemetry.mjs` rejects any row whose reviewer equals its builder.
