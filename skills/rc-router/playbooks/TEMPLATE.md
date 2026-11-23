---
name: <playbook-name>
profile: <rcstack-engineering | rcstack-study | rcstack-research>
entry_mode: router_only
default_tier: <0-3>
required_assurance: <A0 | A1 | A2 | A3>
required_capabilities:
  - <abstract_capability>
contracts:
  - contracts/<contract>.md
---

# <Playbook Title>

<One sentence: what this playbook delivers and for which kind of request.>

## Router-Only Invocation Boundary

> **ROUTER-ONLY:** This playbook MUST ONLY be invoked by `rc-router` (`/rcstack`) after profile selection, risk-tier classification, and live model resolution. Never execute this playbook standalone or bypass `rc-router`.

## Do NOT Use When

- <Adjacent situation this playbook does not own> — use `<other-playbook-or-skill>`.

## Workflow Phases

1. **<PHASE>** — <who (an abstract capability, never a model) does what, producing which contract,
   checked by which script>.

## Exit Gate & Definition of Done

- <A hard, checkable condition: a command's exit code, an admitted receipt, an audit verdict.>

<!--
Authoring rules (delete this comment in a real playbook):
- `name` equals the file name; `profile` matches the parent directory.
- `default_tier` and `required_assurance` are fixed by the system spec, section 2.4.
- `required_capabilities` come from the profile's capabilities, plus independent_reviewer.
- `contracts` lists every contract a phase produces; write `contracts: []` when there are none.
- Honour every gate the profile sets for the default tier: list the contract, name the capability,
  and use the script (rc-state.mjs, rc-receipt.mjs, rc-log.mjs, the repo's verify command).
- Keep the four `##` headings exactly as written, in this order, and keep the ROUTER-ONLY rule verbatim.
- Never name a concrete model.
-->
