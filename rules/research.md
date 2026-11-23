# Research Rules (always on)

Loaded by `rc-router` for every `rcstack-research` run and passed to every dispatched phase.
The goal is a decision someone can defend, not a document that sounds thorough.

## Evidence

- Separate facts, inferences, and opinions, and label which is which.
- Every fact carries an exact citation. Prefer primary sources over summaries of them.
- Record the date and version of anything that changes: APIs, prices, benchmarks, papers.
- Numbers are reproducible: give the command, dataset, or calculation that produced them.

## Skepticism

- State the hypothesis and what would falsify it before looking for support.
- Seek the strongest counter-argument and the best alternative, then say why they lose.
- Absence of evidence is reported as absence, not as evidence of absence.
- Conflicting sources are shown side by side with a judgement on which to trust and why.

## Spikes

- A spike answers one question inside a fixed time box. Write both down before starting.
- Prototype code is disposable. It never ships; a viable result routes to a build playbook.
- Run untrusted code, credentials, and infrastructure experiments as Tier 3 only.
- Report what the prototype did not test as carefully as what it did.

## Reporting

- Lead with the recommendation and the confidence in it, then the evidence.
- State strengths, weaknesses, and failure modes for every option considered.
- Say what would change the recommendation and what it would cost to find out.
- Keep the report decision-ready: a reader can act on it without reading the appendix.
