# Ask eval cases

Each case is an invented question about a small invented project, framed so that the point that
changes the answer is not in the question, while the project shows it. Nothing here comes from a
real project.

- `case.json`: the `question`, and `points`, each with a unique `point` label, `summary`, and
  `terms`.
- `repo/`: the project, committed as the one commit of a fresh repository.
- An answer or a ruling raises a point when its text matches one of the point's `terms`, regular
  expressions matched without regard to case. No term may match the question. Terms may match
  `repo/`, where the point is meant to be found.

`npm run eval:ask -- check` checks every case's terms without running a question.
