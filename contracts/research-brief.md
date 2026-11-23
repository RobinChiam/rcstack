# Contract: Research Brief

**Produced by:** `systems_research` or `deep_grounding`, during `RESEARCHING`.
**Consumed by:** `architect_blueprint`, to write `contracts/spec.md`.

A brief establishes what is true before anyone designs. It contains facts and their sources, not a
design. Every fact carries a citation a reader can open; anything without one goes under Open
Questions.

## Template

```markdown
# Research Brief: <topic>

## Goal

<One or two sentences: the decision or change this research serves.>

## Grounded Facts

- <fact> — `path/to/file.ext:42`
- <fact> — <https://example.org/doc#section> (accessed YYYY-MM-DD)
- <fact> — <document title>, p. <page>

## Constraints

- <hard limit the solution must respect, with its source>

## Open Questions

- <what is still unknown> — <who or what can answer it> — blocks planning: yes | no

## Recommended Approach

<The approach the facts support, in one paragraph, plus the strongest alternative and why it loses.>
```

## Rules

- **Goal** states the outcome, not the method.
- **Grounded Facts** cite an exact `file:line`, URL, or document page. No citation, no fact.
- Label inference as inference. Never present a guess as a finding.
- **Constraints** come from the repo (`AGENTS.md`, `docs/decisions.md`), the platform, or the human.
- **Open Questions** that block planning stop the run until the human answers them.
- **Recommended Approach** recommends; it does not specify files or interfaces. That is the spec's job.
