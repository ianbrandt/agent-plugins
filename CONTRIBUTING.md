# Contributing

How the plugins are built, tested, and released is in [DEVELOP.md](DEVELOP.md).

## Conventions

- Code is written test-first: a failing `*.test.ts` under `claude plugin test`, then the code that
  passes it.
- Performance questions, such as which model to use for a tier, are settled with evals. Eval cases
  are invented.
- A plugin's design decisions are in its `docs/DESIGN.md`.
- A plugin's `version` is raised only in a release, as described in
  [DEVELOP.md](DEVELOP.md#releases).

### Confer

- In tests, the models are replaced with recordings: `codex exec --json` output labeled with the
  Codex version it came from, and a fixture file for the Claude reviewer's reply. Real models run
  only in evals.
- Only the bare essentials go in Confer's `README.md`, `docs/`, and code comments. A reader who
  wants more can have an agent study the code.

## AI-assisted contributions

Issues, code, comments, commit messages, and PRs drafted with AI are welcome. These plugins are developed that way too. Think of it as ghostwriting, where you sign your name to what an agent drafted for you. Please read every line before you submit it, and be ready to explain and defend any detail in review. Otherwise you may be asked to rework a submission before it's reviewed.
