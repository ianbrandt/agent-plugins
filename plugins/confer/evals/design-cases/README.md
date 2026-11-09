# Design eval cases

Each case is an invented document with gaps planted on purpose. Nothing here comes from a real project.

- `design.md`: the document reviewed with `/confer:plan`: an increment's analysis, requirements, and
  design, or a plan.
- `case.json`: `gaps`, each with a unique `defect` label, `severity`, `summary`, and `terms`.
- A point raises a gap when its evidence or fix matches one of the gap's `terms`, regular
  expressions matched without regard to case. No term may match `design.md`.

`npm run eval:design -- check` checks every case's terms without running a review.
