# Contributing

## Conventions

- Code is written test-first: a failing `*.test.ts` under `claude plugin test`, then the code that
  passes it.
- In tests, the models are replaced with recordings: `codex exec --json` output labeled with the
  Codex version it came from, and a fixture file for the Claude reviewer's reply. Real models run
  only in evals.
- Performance questions, such as which model to use for a tier, are settled with evals under
  `evals/`. Eval cases are invented.
- The design decisions behind Confer are in [docs/DESIGN.md](docs/DESIGN.md).
- Only the bare essentials go in `README.md`, `docs/`, and code comments. A reader who wants more
  can have an agent study the code.
- `version` in `.claude-plugin/plugin.json` is raised only in a release, as described in the
  repo's [README](../../README.md#releases).

## Building

You need Node.js and Claude Code 2.1.317 or later. Run these commands in this folder.

1. Install TypeScript:

   ```shell
   npm ci
   ```

2. Type-check, test, and validate the plugin:

   ```shell
   npm run typecheck
   claude plugin test
   claude plugin validate .
   ```

`test.sh` at the repo root runs the same checks for every plugin, and CI runs it on Linux, macOS,
and Windows, under Claude Code 2.1.317 and the latest release.

The plugin API of Claude Code 2.1.317 is declared in `types/claude-code/index.d.ts`. To update
that file, replace it with `.claude-plugin/types/claude-code/index.d.ts`, which Claude Code
writes when you run `claude --plugin-dir .` in this folder.

## AI-assisted contributions

Issues, code, comments, commit messages, and PRs drafted with AI are welcome. Confer is developed that way too. Think of it as ghostwriting, where you sign your name to what an agent drafted for you. Please read every line before you submit it, and be ready to explain and defend any detail in review. Otherwise you may be asked to rework a submission before it's reviewed.
