# Research brief for the four approved repository fixes

## Goal

Make persisted routing, reviewer attribution, playbook verification, and setup reporting agree with the rules users rely on.

## Grounded Facts

- The router requires the engineering security-critical playbook when a target path requires Tier 3. The transition updates the tier, escalation history and assurance floor. A temporary task escalated from feature-build subsequently reported feature-build, Tier 3 and A3 through the show command. See skills/rc-router/SKILL.md:77, scripts/rc-state.mjs:801 and tests/rc-state.test.mjs:435.
- The telemetry caller supplies reviewer identities and the degraded flag. The existing test accepts a degraded A1 row naming the sole builder as reviewer. DEC-006 requires independent reviewer attribution. See scripts/rc-log.mjs:48, tests/rc-log.test.mjs:192 and docs/decisions.md:96.
- The canonical Socratic session is Tier 1/A0 and produces no checkable artifact. The study profile sets require_verify for Tier 1. The verifier currently applies the exception by assurance level. See specs/initialization-build/spec.md:244, profiles/rcstack-study.yaml:134, skills/rc-router/playbooks/study/socratic-session.md:41 and scripts/verify.mjs:216.
- Setup relies on operator-visible evidence from the catalog. Its instructions enumerate secondary and fallback models. The study profile separately binds a paired model and an external companion that the deep-dive workflow consumes. See skills/rc-setup/SKILL.md:48, profiles/rcstack-study.yaml:72 and skills/rc-router/playbooks/study/topic-deep-dive.md:39.

## Constraints

The protected state writer controls the route recovered by a subsequent session. The protected verifier controls whether a playbook satisfies its profile gates. State revision and atomic-write guarantees come from DEC-005. Schema and guardrail changes require new decisions under AGENTS.md:12. Use temporary homes and runtime directories for tests under AGENTS.md:85.

## Open Questions

The written spec needs human sign-off before implementation under the security-critical playbook. The four requested outcomes are already approved.

## Recommended Approach

Keep the existing state transition and telemetry interfaces. Verify persisted output through the ordinary CLI, preserve legitimate multi-builder review, name the Socratic exception explicitly and report each configured dependency with its own availability evidence. Editing the documentation alone would leave the reproduced state and telemetry behaviors in place.
