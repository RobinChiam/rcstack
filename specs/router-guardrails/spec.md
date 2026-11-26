# Spec: Router guardrails — persisted Tier 3 route, honest degraded telemetry, a named Socratic exception, and setup evidence

Tier 3 (it edits `scripts/rc-state.mjs` and `scripts/verify.mjs`). Required assurance `A3`.
Facts and line references are in `research-brief.md` beside this file. Base: `909e7bb`.

## Problem Statement

Four places record something other than the rule users rely on:

1. **Escalation keeps the old route.** `rc-state.mjs transition --escalate-tier 3` raises the tier
   and the floor but leaves `profile` and `playbook` alone, so a later session recovers
   `feature-build` at Tier 3 / `A3` and resumes the wrong playbook.
2. **Degraded telemetry names an auditor that did not audit.** `rc-log.mjs` accepts a
   `degraded_single_harness` row whose `reviewers` list holds the sole builder, although DEC-006
   says a degraded run was not independently reviewed.
3. **The Socratic exception is implicit.** `verify.mjs` skips `require_verify` for any playbook
   whose `required_assurance` is `A0`, instead of for the one playbook the system spec exempts.
4. **Setup reports half of a binding.** `rc-setup` walks `secondary` and `fallback` but never
   reports `paired` models or the external `companion` that `topic-deep-dive` consumes.

Fixed means: `show` after a Tier 3 escalation reports `rcstack-engineering` /
`security-critical` / Tier 3 / at least `A3`; a degraded row carries no reviewer and no finding
counts; only `study/socratic-session` skips `require_verify`; and the setup report states, for
every paired model and companion, what was observed or that nothing was.

## Non-Goals

- `init --tier 3` with a playbook other than `security-critical`, and escalation to Tier 1 or 2.
  Neither changes here; only `--escalate-tier 3` re-routes.
- New state frontmatter keys, a new telemetry field, a `schema_version` bump, or new CLI flags.
- Rewriting, deleting or re-validating existing `telemetry.jsonl` rows or shadow-git history.
- De-escalation. It stays a human action outside the state script.
- Router behavior when a paired model or companion is missing. Setup reports; it does not route.
- Editing `skills/rc-router/playbooks/study/socratic-session.md`, any profile, or
  `profiles/schema.json`. No installer activation.

## Data Shapes & Interfaces

### C1 — `rc-state.mjs transition --escalate-tier 3`

In the same locked write and the same shadow commit as the tier change:

| Field | After the transition |
| :--- | :--- |
| `profile` | `rcstack-engineering`, whatever profile the task started in |
| `playbook` | `security-critical` |
| `risk_tier` | `3` |
| `required_assurance` | the higher of its current value and `A3` |
| `escalated_from_tier` | unchanged if already set, else the tier before this transition |
| `achieved_assurance`, `phase`, `base_sha`, receipts already admitted | untouched by the re-route |

One line is appended to `Admitted Receipts`, like the existing `Evidence reset:` note:
`Route escalated: <old profile>/<old playbook> Tier <n> -> rcstack-engineering/security-critical Tier 3`.
It is the only record of the original route. The rule is a constant in the script (the Tier 3
route), not a flag, so no caller can pick another playbook. All other flags of the same call
(`--to`, `--blocker`, `--admit-receipt`, ...) keep their meaning. A failed shadow commit restores
the previous text, as today.

**Stale escalated state** is a committed state with `risk_tier: 3`, `escalated_from_tier` set, and
`profile`/`playbook` other than `rcstack-engineering`/`security-critical` (written before this
change).

- Readers repair nothing (DEC-005). `show --json` and the `state` object of `reconcile` add
  `stale_route: true`; `reconcile` adds a drift entry with code `STALE_ROUTE` and exits `2`.
- `transition` refuses every request on it with `STALE_ROUTE` and exit `1`, naming the repair,
  except the repair itself: `transition --expected-rev <N> --escalate-tier 3`, alone or with
  `--to BLOCKED --blocker`. On a stale state, and only there, `--escalate-tier 3` is accepted at
  Tier 3. It sets `profile` and `playbook`, raises the floor to at least `A3`, leaves
  `escalated_from_tier`, `achieved_assurance`, `phase` and every earlier receipt line as they are,
  bumps `rev`, commits, and appends
  `Route repaired: <old profile>/<old playbook> -> rcstack-engineering/security-critical (escalated before the route was persisted)`.
- `close --abandon` still works on a stale state; `close` of a `SHIPPED` one is unchanged.
- Nothing is back-dated: no earlier shadow commit, receipt line, timestamp or assurance value is
  rewritten, and no receipt or audit is invented for work done under the old route.

**Stale revisions.** A caller holding a `rev` read before an escalation or repair gets
`REV_CONFLICT`, re-reads, and sees the new route. A non-stale Tier 3 state still rejects
`--escalate-tier 3` as "escalation is one-way".

### C2 — `rc-log.mjs` degraded rows

Cross-field rule in `semanticErrors`; the schema's shape and `schema_version: 1` stay.

- `degraded_single_harness: true` requires `reviewers: []`, `audit_accepted: {}` and
  `audit_dismissed: {}`. Each violation is its own error. The `A1` cap is unchanged.
- The flag no longer excuses an overlap between `builders` and `reviewers`. An overlap is valid
  only as cross-pairing in a non-degraded row: several builders, each with a reviewer other than
  itself. That rule and its `A2`/`A3` requirements are unchanged.
- `contracts/telemetry-event.schema.json`: only the `reviewers` and `degraded_single_harness`
  descriptions change, to say a degraded row lists no reviewer.
- Existing rows are never read back by the appender, so historical degraded rows that name a
  reviewer stay in place. `rc-retro` counts a degraded row as unaudited and ignores its
  `reviewers` and finding counts.

### C3 — `verify.mjs` gate exemption

`TIER_GATES` drops `unlessAssurance`. The `require_verify` entry carries
`exemptPlaybooks: ['study/socratic-session']`. A gate is skipped only when the playbook's domain
and name match an exempt entry **and** its `default_tier` and `required_assurance` equal that
playbook's canonical `PLAYBOOKS` row (Tier 1, `A0`). Every other gate applies to it as to any
playbook.

### C4 — `rc-setup` report

- Step 5 resolves `paired` exactly like `secondary` and `fallback`. The status vocabulary gains
  `unverified`. Evidence for `resolved` is the live provider and catalog id that matched.
- A `companion` with `driver_kind: "external"` is not in the orchestrator catalog and is never
  marked from it. It is `available` only with evidence observed in this session (the tool or
  connector that exposes it, named in the report); `unavailable` when a probe ran and did not find
  it; otherwise `unverified`. A profile binding is never evidence.
- In a standalone CLI harness (no discovery) every paired model and companion is `unverified`.
- The report gains two tables, separate from the capability resolution table: **Paired models**
  and **External companions**, each row `profile | capability | name | status | evidence`, with
  the playbook that consumes it when the status is not `resolved`/`available`.
- `verify.mjs` adds one Slice 3 check: for each of `paired` and `companion` bound in any
  `profiles/*.yaml`, `skills/rc-setup/SKILL.md` names that key in backticks in its `Procedure`.

## Non-Overlapping File Slices

| Slice | Owns (exact paths or globs) | Depends on | Capability |
| :--- | :--- | :--- | :--- |
| S1 spec | `specs/router-guardrails/**` | — | `architect_blueprint` |
| S2 state route | `scripts/rc-state.mjs`, `tests/rc-state.test.mjs` | S1 | `security_builder` |
| S3 telemetry | `scripts/rc-log.mjs`, `tests/rc-log.test.mjs`, `contracts/telemetry-event.schema.json` | S1 | `security_builder` |
| S4 setup skill | `skills/rc-setup/SKILL.md` | S1 | `primary_builder` |
| S5 verifier | `scripts/verify.mjs`, `tests/verify.test.mjs` | S4 | `security_builder` |
| S6 law and documents | `AGENTS.md`, `README.md`, `docs/decisions.md`, `specs/initialization-build/spec.md`, `skills/rc-router/SKILL.md`, `skills/rc-retro/SKILL.md`, `skills/rc-router/playbooks/engineering/security-critical.md` | S2, S3, S5 | `architect_blueprint` |

S6 edits, and nothing else:

- `docs/decisions.md`: one new entry, **DEC-016**, covering all four guardrail changes. It amends
  DEC-005 and DEC-009 (escalation re-routes; stale route is refused), DEC-006 (degraded rows list
  no reviewer), and names the `require_verify` exemption and the setup-report check. No entry is
  deleted or rewritten.
- `specs/initialization-build/spec.md`: §2.2 step 2 (escalation persists the route), §2.4 item 10
  (the sole `require_verify` exemption), §4 telemetry and §5.4 (replace "unless
  `degraded_single_harness: true`" with the C2 rule), §5.1 (exemption, setup check), §5.2 (C1 and
  `STALE_ROUTE`), and the `rc-setup` description (paired and companion evidence).
- `AGENTS.md`: the "honour every gate" rule gains the single named exception.
- `skills/rc-router/SKILL.md`: after `--escalate-tier 3`, re-read state, load the engineering
  profile and rules, and continue in `security-critical`; when the phase is past `PLANNING`, pass
  `--to BLOCKED --blocker` in the same call and hold for the human's spec sign-off; repair a
  `STALE_ROUTE` before anything else; a degraded row is logged with empty `reviewers` and counts.
- `security-critical.md` TRIAGE: an escalated state already names this playbook.
- `skills/rc-retro/SKILL.md`: the C2 reading of historical degraded rows.
- `README.md`: only where it restates a changed rule.

## Failure Modes

- A session resumes after escalation and reads the old playbook → route, tier and floor land in
  one commit; no committed revision holds a mixed route after this change.
- A study or research task touches a Tier 3 path → the same re-route applies; `profile` and
  `playbook` stay a valid pair, so state validation and the telemetry profile rule keep holding.
- A caller tries to keep working on a stale escalated state → every transition but the repair is
  refused; `reconcile` reports it before any work.
- The repair is used to launder history → it changes only `profile`, `playbook` and the floor, and
  appends a note; achieved assurance is not raised and still resets when `HEAD` moves.
- `--escalate-tier 3` is replayed on a healthy Tier 3 state to rewrite it → rejected as today.
- Escalation lands mid-`EXECUTING`, past the sign-off phase → the state machine has no way back
  to `PLANNING`, so the router blocks in the same call and the human signs off before returning.
- A degraded run pads `reviewers` with a second model to look audited → rejected; the row must
  have none.
- A self-reviewing sole builder sets the degraded flag to pass → rejected by both rules.
- The stricter rule breaks honest cross-pairing → the non-degraded path is untouched and pinned.
- A future `A0` playbook silently loses its verify step → the exemption matches one identity.
- The Socratic playbook's tier or floor drifts while it keeps the exemption → the canonical-row
  match fails and the gate applies.
- Setup marks a companion available because the profile says so → only observed evidence counts;
  without it the row reads `unverified`.
- The setup instructions later drop `paired` or `companion` → the new Slice 3 check fails.

## Acceptance Criteria

- [ ] From `feature-build` Tier 2, `transition --escalate-tier 3` then `show --json` reports
      `rcstack-engineering`, `security-critical`, `risk_tier: 3`, `required_assurance: "A3"`,
      `escalated_from_tier: 2`, and one `Route escalated:` receipt line; one shadow commit was added.
- [ ] The same holds starting from `topic-deep-dive` and from `research-report`.
- [ ] A floor already raised above the tier floor is never lowered by escalation or repair.
- [ ] `--escalate-tier 2` from Tier 1 leaves `profile` and `playbook` unchanged.
- [ ] A fixture state committed with the old shape (Tier 3, `escalated_from_tier`, `feature-build`)
      shows `stale_route: true`, makes `reconcile` exit `2` with `STALE_ROUTE`, and is refused by
      `--to`, `--admit-receipt`, `--next` and `--resolve-blockers` with the state unchanged.
- [ ] The repair on that fixture sets the route, keeps `escalated_from_tier`, `achieved_assurance`,
      `phase` and earlier receipt lines byte-identical, and appends one `Route repaired:` line; a
      second repair is rejected as one-way.
- [ ] A pre-escalation `--expected-rev` returns `REV_CONFLICT`; a forced commit failure during
      escalation restores the previous route.
- [ ] `rc-log.mjs` rejects a degraded row with any reviewer (builder, other, or both) or any
      finding count, at every assurance level, and writes nothing.
- [ ] It accepts a degraded row with `reviewers: []`, empty counts and `A0` or `A1`, and still
      rejects it at `A2` and `A3`.
- [ ] Non-degraded cross-pairing (`Alpha`/`Beta` reviewing each other) is accepted as before; a
      sole builder listed as reviewer is rejected with or without the flag.
- [ ] Appending to a file that already holds an old degraded row with a reviewer succeeds and
      leaves that row byte-identical.
- [ ] The unchanged `socratic-session.md` passes verify. A fixture playbook other than it, at a
      tier that sets `require_verify`, with `required_assurance: A0` and no verify step, fails with
      the `require_verify` gate error.
- [ ] A Socratic fixture whose profile turns on another Tier 1 gate (for example `log_telemetry`)
      fails on that gate; one whose `default_tier` or `required_assurance` differs from Tier 1 /
      `A0` fails on `require_verify`.
- [ ] `skills/rc-setup/SKILL.md` keeps its five sections, resolves `paired`, and defines the two
      tables and the `available` / `unavailable` / `unverified` rule of C4, with no model name.
- [ ] A fixture `rc-setup` skill that omits `` `paired` `` or `` `companion` `` fails verify.
- [ ] DEC-016 exists with all five fields; the system spec, `AGENTS.md` and the three skills no
      longer state the superseded rules.

## Verification Plan

- Command: `node scripts/verify.mjs && node --test tests/*.test.mjs && bash adapters/install.sh --dry-run`
- Mechanical: `node scripts/verify.mjs` (structure, schemas, playbook gates, model-agnostic
  surfaces, `node --check`) on every slice head.
- Behavioral: the criteria above as tests in `tests/rc-state.test.mjs`, `tests/rc-log.test.mjs`
  and `tests/verify.test.mjs`, driven through the CLIs. The existing escalation test and the
  existing degraded test are rewritten to the new rule, not deleted.
- Hardened (Tier 3 only): in `os.tmpdir()` with `--runtime-dir`, `--file` and `--root` only — the
  stale-state fixture committed straight into a temporary shadow repository; a hand-edited
  working file claiming the new route (readers still see the committed one); the lock-contention
  and commit-failure paths during escalation; and a symlinked telemetry file still refused.
- Limits: the setup report itself is prose executed by a model, so its evidence rule is checked by
  the reviewer reading S4 and by the one mechanical check in C4, not by a behavioral test.
- Gate: the human signs off on this spec before S2–S6 start. The audit is cross-model in a fresh
  context; the integrated receipt runs `909e7bb..HEAD`.
