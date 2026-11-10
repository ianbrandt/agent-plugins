# Confer

Confer is a Claude Code plugin in which Claude Code and Codex confer back and forth to reach
consensus on a plan, a code review, or the answer to a question.

Each side works on its own first, read-only. Then, each round, each side agrees with or disputes
every open point, or withdraws one of its own, with evidence. Confer stops when no point is left in
dispute, after a round in which no point was resolved, conceded, or raised, or after eight rounds by
default. Any point still disputed at the end is reported with both positions, for you to decide.

## Install

You need Claude Code 2.1.317 or later and the [Codex CLI](https://github.com/openai/codex) 0.167.0
or later, signed in or set up for a provider.

1. Add the marketplace and install the plugin:

   ```shell
   /plugin marketplace add ianbrandt/agent-plugins
   /plugin install confer@ianbrandt
   ```

2. In a new session, check that `/confer:review`, `/confer:plan`, and `/confer:ask` are listed.

## Use

### Review a change

Review the uncommitted changes in your checkout, untracked files included:

```shell
/confer:review
```

On a clean checkout, the commits on your branch since it left the default branch are reviewed
instead.

To review something else, pass it as the target:

```shell
/confer:review feature/rate-limit
/confer:review 4e1d2c7
/confer:review main...feature/rate-limit
/confer:review src/billing
/confer:review 1234
```

- A branch or commit is reviewed from where it left the default branch.
- `main...feature/rate-limit` reviews the branch from where the two diverged, and
  `main..feature/rate-limit` reviews the commits between them.
- A path limits the findings to that file or directory.
- A PR number needs the GitHub CLI, `gh`.

The confirmed findings come first in the report, each with a failure scenario or a source
reference. Then come the findings still disputed, with both positions, and the ones refuted or
withdrawn. Each side's models, tokens, and cost are listed last.

To fix the confirmed findings and have both sides review the fix, add `--fix`:

```shell
/confer:review --fix
```

Fixes are offered only for a review of the checkout or a path. Without `--fix`, you're asked which
findings to fix.

### Work out a plan

Give a goal, or a roadmap to plan:

```shell
/confer:plan Add rate limiting to the public API
```

1. Claude reads the code the goal touches, lists its assumptions, and asks about the decisions
   that change the outcome.
2. It writes the analysis, requirements, design, and plan to a file at a path you choose.
3. Claude and Codex critique the file, and Claude revises it between rounds until they agree.

To review a document you already have, pass its path:

```shell
/confer:plan docs/rate-limiting.md
```

### Ask a question

```shell
/confer:ask Should the session cache be keyed by user or by tenant?
```

Each side answers on its own first. Then they rule on each other's answers until they agree on one.

### Choose the models

Confer picks the models and effort for each run from how complex and critical the work is, and
asks when it is unsure. Set the tier yourself with `--tier`:

```shell
/confer:review --tier critical
```

The tiers are `routine`, `complex`, `critical`, and `escalation`. To override one side for a single
run, pass `--claude-model`, `--claude-effort`, `--codex-model`, or `--codex-effort`:

```shell
/confer:ask --codex-effort high Is this lock ordering safe?
```

The Codex model for each tier, the maximum number of rounds, and the review worktree are plugin
settings.

### Run with nobody watching

With `--findings`, the report is written to a file and no questions are asked, as in a headless run
with `claude -p`:

```shell
/confer:review --findings review.md
```

A plan run with `--findings` needs a document to review, since nobody is there to interview.

## Privacy and safety

- The code and documents under review are sent to the model providers Claude Code and Codex are
  configured to use.
- On Windows, Codex runs with no OS sandbox, so outside PRs are better reviewed on macOS.

## Credits

Confer is a rewrite of [claudex-loop](https://github.com/chaseai-yt/claudex-loop) by
[Chase AI](https://chaseai.io), under the MIT License. See [LICENSE.md](LICENSE.md).
