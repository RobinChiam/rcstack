---
# Canonical authoring template for playbooks. Copy this file to
# skills/rc-router/playbooks/<domain>/<playbook-name>.md and replace every <placeholder>.
# Adding a playbook is a spec change: update SPEC.md, docs/decisions.md and the canonical
# table in scripts/verify.mjs in the same change.
name: <playbook-name>            # Must equal the file name without ".md"
profile: rcstack-<domain>        # Must match the parent directory: engineering | study | research
entry_mode: router_only          # MUST ALWAYS be "router_only"
default_tier: <0-3>              # Integer; the profile's flags for this tier are binding
required_skills:                 # Subset of the 10 approved skills, each used in Workflow Phases
  - <rc-skill>
required_roles:                  # Abstract roles from profiles/schema.json; never model names
  - <abstract_role>
contracts:                       # Existing files under contracts/, each used in Workflow Phases
  - contracts/<contract>.md
---

# <Playbook Title> (`<domain>/<playbook-name>`)

<One or two sentences: what this workflow delivers and when the router selects it.>

## Router-Only Invocation Boundary

> **ROUTER-ONLY:** This playbook MUST ONLY be invoked by `rc-router` (`/rcstack`) after profile selection, risk-tier classification, and model resolution. Never execute this playbook standalone or bypass `rc-router`.

The router hands over the profile, the tier, the resolved role-to-model route, the reviewer, and the branch state. If any of these is missing, stop and return to `rc-router`.

## Do NOT Use When

- <Adjacent situation> — use `<other-playbook>` instead.
- <Adjacent situation> — run `<rc-skill>` directly instead.
- <Condition that means the tier is wrong> — stop and return to `rc-router` for re-classification.

## Workflow Phases

1. **<Phase name>** — `<rc-skill>` or `<abstract_role>`: <imperative instruction>. Output: `contracts/<contract>.md`.
2. **<Phase name>** — <...>. Name the builder of record here: the role whose model authored the audited artifact.
3. **<Gate phase>** — `rc-verify`: <what is proven and how>.
4. **<Audit phase, when the tier requires it>** — `rc-audit` with `independent_reviewer`: <what is reviewed>.
5. **<Closing phase, when the tier requires it>** — `rc-review-map`: <synthesis and telemetry>.

Authoring rules for this section:

- Use every entry of `required_skills`, `required_roles`, and `contracts` at least once, in backticks.
- Name abstract roles only. Concrete model names belong in `profiles/*.yaml`.
- State what happens when a gate fails (who gets the work back) and when to stop and escalate.

## Exit Gate & Definition of Done

- `rc-verify` passes on the final state, with commands and exit codes recorded in a Work Receipt.
- <Tier 2+> `rc-audit` returns `APPROVE` with zero open `Blocker` findings; every `Major` is fixed or listed for human approval.
- <Tier 2+> A Review Map per `contracts/review-map.md` is emitted and one telemetry row is appended.
- <Playbook-specific deliverable exists and where it lives.>
