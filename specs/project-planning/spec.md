# Project planning playbook

## Problem Statement

An early project idea can reach feature implementation before the user has chosen the problem,
understood the approach, or defined success. Add a router-only engineering playbook that helps
the user make those decisions and agree on acceptance gates before the first implementation spec
is written.

## Non-Goals

This change covers initial project planning. Routing for changes to active projects, implementation,
profile consolidation, documentation directory policy, and release automation are separate work.

## Data Shapes & Interfaces

Register `engineering/project-planning` at Tier 0/A0 with `architect_blueprint`. The router
distinguishes a planning request from a direct lookup and uses only the planning capability
during the conversation. The playbook has no file output. Its chat handoff gives the user's
problem and success criteria, the chosen approach and trade-offs, first milestone, deferred scope,
dependencies and open questions, acceptance gates, and tests in implementation order.

Select the read-only planning route before any state initialization. A path discussed as part
of an idea is context for the plan. Apply path-based escalation when the user requests work
that targets or changes the path. Requests to resume or change an active project use its
existing route or the route for the new change.

The [playbook](../../skills/rc-router/playbooks/engineering/project-planning.md) describes the phases and stopping rules. Treat its phases
as conversation steps. An explicit request to save the first milestone as a spec ends this
planning route and authorizes a separate spec-writing action under the repository's rules. Use
the existing spec contract and the approved handoff as inputs. Implementation starts on an
explicit request and routes by the milestone's actual risk. The approval to write a spec does not
authorize starting a builder.

A0 describes the evidence produced by the planning session. The planned acceptance gates concern
future implementation. The project-planning route has no state, receipt, telemetry, or code
mutation. The normal approval and verification rules still apply when implementation is requested.

## Non-Overlapping File Slices

| Slice | Owned paths | Depends on | Capability |
| --- | --- | --- | --- |
| Planning | `specs/project-planning/**` | | `architect_blueprint` |
| Canonical rules | `specs/initialization-build/spec.md`, `docs/decisions.md`, `AGENTS.md`, `README.md` | Signed spec | `security_builder` |
| Playbook and routing | `skills/rc-router/SKILL.md`, `skills/rc-router/playbooks/engineering/project-planning.md` | Canonical rules | `security_builder` |
| Validation | `scripts/verify.mjs`, `tests/verify.test.mjs`, `scripts/rc-state.mjs`, `tests/rc-state.test.mjs`, `tests/install.test.mjs` | Canonical rules | `security_builder` |

Update the canonical inventory and add a decision for the new routing boundary before changing
the verifier. The shared playbook registry also feeds the state CLI. Reject init for
`project-planning` before opening runtime state and update the unknown-playbook diagnostic to
avoid a hard-coded count. Keep the telemetry enum as the list of routes that can emit telemetry.
Existing persisted state and telemetry remain valid.

## Failure Modes

- A vague idea launches implementation or persists notes before the user has made the key
  decisions. Route planning intent first and keep the session in chat, with a distinct save and
  build handoff.
- An ordinary lookup is routed into a planning interview. Route by intent and preserve direct
  answers to straightforward questions.
- A proposed approach is presented as agreed fact. Name its assumptions and ask the user to
  choose after working through alternatives and their consequences.
- Tests become an afterthought. Agree on observable outcomes and how to demonstrate them before
  an implementation spec is written. Turn unknown test methods into explicit open decisions.
- A request adds a feature or changes an active project. Use the normal change route and the
  existing project spec as context.

## Acceptance Criteria

- [ ] An initial project idea, even one sentence long, reaches the planning conversation. A
      well-developed idea proceeds with only questions that could change a planning decision.
- [ ] The router selects `engineering/project-planning` and `architect_blueprint` at Tier 0/A0
      while direct lookups still use the lookup route.
- [ ] The user reviews the problem model, chooses the approach and defines done in terms they
      can explain. The agent proposes measurable tests and acceptance gates before spec authoring.
- [ ] Drafting, revising, and approving the direction create no repository files or runtime state
      and launch no implementation. Direct state init for the planning route is rejected before
      writes. A request to save authorizes only the agreed spec handoff.
- [ ] Requests to change an active project route through the normal project workflows.
- [ ] Source verification, installation dry-run and hermetic tests pass with the expanded
      inventory. Installed distribution includes the playbook beneath the existing router skill.

## Verification Plan

Run `node scripts/verify.mjs`, `node --test tests/*.test.mjs`, and
`bash adapters/install.sh --dry-run`. Add a regression for the canonical name and tier in the
existing verifier suite. In disposable fixtures, walk the router and playbook through a vague
idea, an already-developed idea, direction approval, an explicit spec-only request, a simple
lookup, and a change request for an active project. Compare repository and runtime contents across
the read-only cases. Distinguish instruction-level observations from deterministic checks.
Use the Tier 3 spec sign-off and independent cross-family audit for the implementation.
