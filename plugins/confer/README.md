# Confer

Confer is a Claude Code plugin in which a Claude subagent and OpenAI's Codex each review a code
change or a plan, or answer a question, independently. Then they rule on each other's findings until
they agree.

Each round, each model agrees with or disputes every open point, or withdraws one of its own, with
evidence. Confer stops when no point is left in dispute, after a round in which no point was
resolved, conceded, or raised, or after eight rounds by default. Any point still disputed at the
end is reported with both positions, for you to decide.

## Install

You need Claude Code 2.1.317 or later and the [Codex CLI](https://github.com/openai/codex) 0.167.0
or later, signed in or set up for a provider.

1. Add the marketplace and install the plugin:

   ```shell
   /plugin marketplace add ianbrandt/confer
   /plugin install confer@confer
   ```

2. In a new session, check that `/confer:review`, `/confer:plan`, and `/confer:ask` are listed.

## Use

- Run `/confer:review` to review the current change. Pass a branch, commit, range, path, or PR
  number to review that instead, and `--fix` to fix the confirmed findings and review the fix.
- Run `/confer:plan <goal>` to work out the analysis, requirements, design, and plan for one
  increment or a roadmap with Claude, then review the document. Pass a file instead of a goal to
  review a document you already have. The file is revised between rounds.
- Run `/confer:ask <question>` to have both models answer a question and settle on one answer.

Confer picks the models and effort for each run from how complex and critical the work is, and
asks when it is unsure. Pass `--tier routine`, `complex`, `critical`, or `escalation` to set the
tier yourself.

The Codex model for each tier, the maximum number of rounds, and the review worktree are plugin
settings.

## Privacy and safety

- The code and documents under review are sent to Anthropic and to the provider Codex is set up
  for.
- On Windows, Codex runs with no OS sandbox, so outside PRs are better reviewed on macOS.

## Credits

Confer is a rewrite of [claudex-loop](https://github.com/chaseai-yt/claudex-loop) by
[Chase AI](https://chaseai.io), under the MIT License. See [LICENSE.md](LICENSE.md).
