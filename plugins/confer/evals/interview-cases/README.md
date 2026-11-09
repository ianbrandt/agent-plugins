# Interview eval cases

Each case is an invented goal for `/confer:plan` and a small invented project with constraints the
conductor has to find before it drafts the plan. Nothing here comes from a real project.

- `case.json`:
  - `goal`: the goal given to `/confer:plan`.
  - `file`: the path the plan is written to, which is given in one of the scripted answers.
  - `constraints`: what the project shows and the goal does not, each with a unique `constraint`
    label, `summary`, and `terms`.
  - `questions`: the questions the conductor should ask, each with a unique `question` label,
    `summary`, `terms`, and the scripted `answer`.
  - `needless`: questions the project already answers, each with `question`, `summary`, and
    `terms`.
  - `sections`: the sections the plan needs, each with `section` and `terms`.
- `repo/`: the project, committed as the one commit of a fresh repository.
- Terms are regular expressions matched without regard to case. A question's terms match the
  question itself, not the context around it. A section's terms match a heading of the file. No
  constraint term may match the goal or a scripted answer, and each constraint has a term that matches
  `repo/`.

`npm run eval:interview -- check` checks every case without running an interview.
