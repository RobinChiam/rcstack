# Contract: Research Brief

The upstream grounding and triage handoff. It separates what is known (with a citation) from what
is assumed, so the next role designs against facts instead of memory.

- **Produced by:** `deep_grounding` (via `rc-ground`) or `systems_research` (via `rc-architect`).
- **Consumed by:** `architect_blueprint`, any builder role, and `independent_reviewer`.

## Required Fields

| Field | Requirement |
| :--- | :--- |
| Goal | One or two sentences: the question to answer or the outcome to enable. |
| Grounded Facts | Numbered facts, each with an exact citation: `path:line`, URL with section or anchor, or document with page. |
| Open Questions | What could not be grounded, and what evidence would settle it. `None` if empty. |
| Constraints | Hard limits: decisions from `docs/decisions.md`, repo law, deadlines, compatibility, budget. |
| Recommended Approach | The proposed direction, the facts it rests on (by number), and the main alternative rejected. |

## Template

```markdown
# Research Brief: <topic>

- **Prepared by:** <abstract role> (<model that actually ran>)
- **Date:** <YYYY-MM-DD>
- **Corpus / scope:** <repos, directories, documents, or URLs examined>

## Goal
<What must be answered or enabled, in one or two sentences.>

## Grounded Facts
| # | Fact | Citation |
| :--- | :--- | :--- |
| F1 | <A single checkable statement> | `<path>:<line>` / <URL#anchor> / <document, p. N> |
| F2 | <...> | <...> |

## Open Questions
- Q1: <What is unknown> — would be settled by <evidence or experiment>.

## Constraints
- <Hard limit and its source, e.g. DEC-NNN or an AGENTS.md rule>

## Recommended Approach
<Direction in 2-5 sentences, citing the facts it depends on (F1, F2).>
- **Rejected alternative:** <Option and why it loses.>
```

## Rules

- A statement without a citation is not a Grounded Fact. Move it to Open Questions.
- Citations must be exact enough for a reviewer to land on the evidence in one step.
- Quote sparingly and verbatim; never paraphrase inside quotation marks.
- Record conflicting sources as a fact about the conflict; do not silently pick a side.
