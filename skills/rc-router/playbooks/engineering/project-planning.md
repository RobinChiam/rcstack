---
name: project-planning
profile: rcstack-engineering
entry_mode: router_only
default_tier: 0
required_assurance: A0
required_capabilities:
  - architect_blueprint
contracts: []
---

# Project Planning

Helps a user turn an initial software project idea into an agreed first milestone with observable
success criteria and a test plan.

## Router-Only Invocation Boundary

> **ROUTER-ONLY:** This playbook MUST ONLY be invoked by `rc-router` (`/rcstack`) after profile selection, risk-tier classification, and live model resolution. Never execute this playbook standalone or bypass `rc-router`.

## Do NOT Use When

- The user asks to implement an agreed milestone or add a feature to an active project. Use
  `feature-build` or the route appropriate to the requested change.
- Existing behavior needs a fix. Use `bug-root-cause`.
- The user requests an experiment to resolve a feasibility question that discussion cannot settle.
  Use `viability-spike` as a separate task.

## Workflow Phases

1. **Intake.** Welcome the idea at its current level of detail. Restate the intended outcome in
   plain language. Read relevant existing project material if available. Keep drafts in chat and
   use read-only inspection throughout. Leave code, files, task state, and telemetry untouched.
2. **Clarify.** Ask a few focused questions when the answers could change the plan. Cover who has
   the problem, how it appears today, the expected behavior, and constraints or unknowns. Ask in
   small groups so the user can steer. Mark facts, assumptions, and decisions still to be made.
3. **Model the problem.** Break the problem into actors, inputs, decisions, outputs and
   boundaries as applicable. Walk through a normal case and a failure case. Where variables
   matter, vary one at a time and explain what happens. Ask the user to correct the model and
   explain how the proposed solution would work.
4. **Compare and choose.** Evaluate plausible approaches against the user's goals and constraints.
   Explain consequences in terms the user can judge, such as effort, ongoing maintenance,
   dependencies and risks. Challenge consequential assumptions with examples or counterexamples.
   Record which approach the user chooses and why. Carry unsettled issues forward explicitly.
5. **Scope the first milestone and define done.** Help the user choose the smallest useful result
   and what to defer. Ask them to state what someone must be able to observe when it is done.
   Record measurable outcomes, boundaries, and any dependency that could change the order.
6. **Design the tests and acceptance gates.** Map each outcome to a concrete scenario, fixture or
   observation, expected result, and pass condition. Include representative failure cases.
   Identify the existing checks that protect current behavior. For each future implementation
   slice, specify the first test to write and why it should fail against the baseline, followed
   by the checks that must pass before the slice is accepted. Label unresolved test design or
   feasibility questions before asking the user to approve the milestone.
7. **Confirm and hand off.** Present the chosen approach, first milestone, deferred work,
   dependencies, open decisions, and agreed acceptance gates in chat. Invite correction and
   record the user's agreement on what done means. A direction approval finishes the planning
   conversation. An explicit request to save a spec authorizes a separate spec-writing action
   with this handoff as input. An explicit implementation request goes through the appropriate
   delivery route. Use the normal router for further changes once the project is underway.

## Exit Gate & Definition of Done

- The user can explain who needs the project, how the chosen solution works, and why the first
  milestone comes first.
- The user confirms observable success criteria, and each criterion has a proposed test or
  acceptance check. Open decisions that affect scope or verification remain visible.
- The conversation ends with the plan in chat. Spec writing and implementation have their own
  entry points after this conversation.
