# Changelog

## Unreleased

## 0.2.1 — 2026-11-26

- Consolidate model routing into `rcstack-main.yaml` with shared defaults and domain overrides.
- Validate each effective domain and preserve existing machine-local profiles on upgrades.
- Install a tagged GitHub Release from one Bash script with a pinned archive digest.

## 0.2.0 — 2026-11-26

### Added

- The router can guide initial project planning in chat, from problem modeling and trade-offs
  through an agreed first milestone and its acceptance tests.

### Changed

- The docs directory accepts guides and reference material. The decisions log remains required.
- Setup reports paired models and external companion tools separately, with evidence for each
  availability result.
- Verification exempts only the default Tier 1/A0 Socratic session from its tier's
  verification gate.

### Fixed

- Tier 3 escalation now saves the security-critical route with the new tier and assurance floor.
  Older escalated tasks recover the correct route on resume.
- Degraded telemetry requires empty reviewer and finding records and rejects claims above A1.
  Historical degraded rows are excluded from reviewer metrics.
- The router examples use the bare playbook name accepted by the state CLI. The installer guide
  explains the brief absence of the distribution directory during the two-rename upgrade fallback.
