# Four corrections to rcstack routing and reporting

## Problem Statement

A resumed Tier 3 escalation can recover the previous playbook. A degraded telemetry row can credit the builder as its own reviewer. The verifier grants a playbook exception by assurance level even though only the Socratic session requires it. Setup can report readiness without checking the paired model or external companion that a playbook consumes. The evidence at base `909e7bb` is in [the research brief](research-brief.md).

## Non-Goals

Direct task initialization, lower-tier routing, installer behavior and historical record migration are outside this change. The four fixes use the current CLI flags and data formats.

## Data Shapes & Interfaces

1. **Tier 3 escalation.** A successful `transition --escalate-tier 3` atomically sets the engineering profile, the `security-critical` playbook, tier 3 and floor A3. Preserve the first `escalated_from_tier` and the existing rules for phase, revision, HEAD and achieved assurance. For old committed tasks with both tier 3 and an escalation marker, recover the same route from those fields. Both forms of `show` present the effective route. Reads do not write. The next successful state update persists it through the normal lock, revision check and shadow commit. Failed writes roll back to the actual previous committed text. A task initialized directly at Tier 3 lacks the escalation marker and retains its selected route. The router loads the selected profile and playbook on resume and observes the existing Tier 3 sign-off before continuing implementation.
2. **Degraded telemetry.** A new row marked `degraded_single_harness` carries `reviewers: []`, empty accepted and dismissed audit counts, and achieved assurance of A0 or A1. Invalid rows are rejected before append. Independent multi-builder cross-review remains valid on audited runs. Historical rows stay readable as recorded. A historical degraded row supplies no independent reviewer evidence for retrospective analysis.
3. **Socratic verification.** Section 2.4 of the system spec designates `study/socratic-session` at its default Tier 1/A0 as the sole exception to `require_verify`, because the session produces no checkable artifact. Identify the exception by the canonical playbook and scope it to that gate. Profile gates still govern other Tier 1 playbooks and any escalated run.
4. **Setup evidence.** Report each configured paired model and external companion separately from the primary model and its fallback chain. A paired model requires a matching provider, model and supported options. A companion requires evidence of the corresponding capability in the current environment. Identify that evidence in the report. Report an observed absence as unavailable and a dependency that could not be checked as unverified. Apply the same distinction when catalog discovery is unavailable.

## Non-Overlapping File Slices

| Slice | Owned paths | Depends on | Capability |
| --- | --- | --- | --- |
| Planning | `specs/router-guardrails/**` | None | `architect_blueprint` |
| Canonical rules | `specs/initialization-build/spec.md`, `docs/decisions.md`, `AGENTS.md`, `README.md` | Signed spec | `security_builder` |
| Escalation | `scripts/rc-state.mjs`, `tests/rc-state.test.mjs`, `skills/rc-router/SKILL.md` | Canonical rules | `security_builder` |
| Telemetry | `scripts/rc-log.mjs`, `tests/rc-log.test.mjs`, `contracts/telemetry-event.schema.json`, `skills/rc-retro/SKILL.md` | Canonical rules | `security_builder` |
| Playbook verification | `scripts/verify.mjs`, `tests/verify.test.mjs` | Canonical rules | `security_builder` |
| Setup reporting | `skills/rc-setup/SKILL.md` | Canonical rules | `security_builder` |

Record the changed guardrails and their checks in the decisions log before changing enforcement. Limit guide edits to statements affected by these four rules.

## Failure Modes

- Another writer wins the revision or a shadow commit fails during escalation. Readers must see one complete committed route. Raw history must still describe the original run.
- An older committed state and its working copy disagree about the route. Derive the effective route only from committed state. A stale caller cannot persist a change.
- Reviewer identities or finding counts imply that a degraded run had an independent audit. Reject the row and preserve the log bytes.
- An assurance label alone disables verification, or the Socratic exception disables another gate. Test the gate itself as well as the playbook's tier and floor.
- A primary model or fallback resolves while its paired model or companion is missing. Setup must report the missing or unverified dependency by name.

## Acceptance Criteria

- [ ] Escalating an engineering, study or research task to Tier 3 produces the same persisted engineering/security-critical route in one shadow commit. A stale revision or failed commit preserves the prior state. A lower-tier escalation retains its route.
- [ ] A legacy escalated state reports the effective route through plain and JSON show. Reads leave the shadow history untouched. An ordinary successful transition persists the route while preserving receipt history and earned assurance subject to the usual HEAD reset.
- [ ] The telemetry CLI accepts honest degraded A0/A1 rows, rejects reviewer identities, finding counts and A2/A3 claims on degraded rows, and accepts valid independent cross-review. Appending a valid row leaves earlier rows intact.
- [ ] Verify passes the shipped Socratic playbook, enforces its other enabled gates and reports the verification-gate failure for an ordinary Tier 1 playbook that omits verification. An A0 label alone never qualifies a playbook for the exception.
- [ ] Exercise the setup instructions against representative inventory with a reachable paired model and an unavailable companion, and against an environment where discovery is unavailable. The report distinguishes observed availability, absence and missing evidence for each configured dependency.

## Verification Plan

Run `node scripts/verify.mjs`, `node --test tests/*.test.mjs` and `bash adapters/install.sh --dry-run`. Exercise the state and telemetry CLIs with temporary runtime directories and files. Cover legacy committed state, revision conflicts, failed shadow commits and rejected appends. Check setup output against the supplied inventory. Record whether each observation came from a fixture or the live environment. A fresh cross-family reviewer checks the integrated diff against these criteria. The integrated receipt covers the task base through the implementation head and must reach A3.
