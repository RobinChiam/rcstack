# Consolidated profile and release installer

## Problem Statement

The three profiles repeat common policy and model descriptors. A target machine also needs a way
to install a tagged release from one Bash script. The user approved the model routing draft and
requested consolidation, a merge to main, a push, and publication of version 0.2.1.

## Non-Goals

Changing role names, changing default routing, removing Git from the local runtime, overwriting
machine-local profiles, and automatic release publication on every merge are outside this release.

## Data Shapes & Interfaces

- The shipped configuration is `profiles/rcstack-main.yaml` (schema 2.0), with a model catalog,
  shared capability bindings, whole-binding domain overrides, domain-specific tier orders, shared
  tier gates and a shared review matrix. A domain resolves to the existing schema 1.0 profile
  shape and retains its existing profile ID in playbooks, state and telemetry.
- The profile verifier validates the consolidated document and its three projections. It also
  accepts legacy documents. A domain-selecting verifier command prints the checked projection as
  JSON for the router and setup. The router selects the local consolidated file first, followed
  by the legacy local file for the domain, followed by the shipped consolidated defaults.
  An invalid selected profile is an error.
- The installer seeds the consolidated file in a new install. On upgrade it preserves legacy
  profiles and only seeds the consolidated file if there are no legacy files to shadow. Existing
  consolidated files take precedence and are never overwritten.
- The annotated tag `v0.2.1` identifies the merged commit. Package verified source from the tag
  into a versioned archive. The release's standalone Bash installer embeds the matching tag,
  commit and archive checksum, downloads the asset over HTTPS, checks its digest, then invokes
  the existing installer from the unpacked source. It uses temporary storage and leaves no
  target changes on download or checksum failure. Release install metadata includes the tagged
  commit with source `release`. The repository installer retains its existing local dry-run.

## Non-Overlapping File Slices

| Slice | Paths | Depends on |
| --- | --- | --- |
| Policy and release guides | `README.md`, `CHANGELOG.md`, `docs/decisions.md`, `specs/initialization-build/spec.md`, `specs/consolidated-profile-release/**` | Approved scope |
| Configuration and validation | `profiles/**`, `scripts/verify.mjs`, `tests/verify.test.mjs` | Policy |
| Router and profile consumers | `skills/rc-router/SKILL.md`, `skills/rc-setup/SKILL.md`, `skills/rc-retro/SKILL.md` | Validation |
| Installer and release packaging | `adapters/**`, `tests/install.test.mjs` | Validation |

## Failure Modes

Unknown aliases, review overlap, and malformed domain overrides must fail before routing.
Missing local overrides use shipped defaults. Absent or corrupt release assets must fail
before promotion. Reinstalling must preserve custom profiles and runtime state.

## Acceptance Criteria

- [ ] Each projected domain matches the existing shipped routing, reviewer and tier policies.
- [ ] Validation rejects malformed consolidated profiles and accepts valid legacy files.
- [ ] Fresh installs create 25 harness links and seed one profile. Upgrades keep existing profiles.
- [ ] The standalone script installs the tagged release without a checkout and rejects a bad
      archive without touching the destination.
- [ ] All three main gates pass, the reviewed tree is merged and pushed, and the published GitHub
      release contains the matching script and archive.

## Verification Plan

Run `node scripts/verify.mjs`, `node --test tests/*.test.mjs`, and
`bash adapters/install.sh --dry-run`. Check compatibility with the previous tagged defaults,
including tier gates. Test the publisher outputs and a release installation using temporary homes.
Request an independent Tier 3 audit before pushing the implementation.
