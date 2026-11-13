# Design

Confer has commands to plan, review, and answer a question, and none to build. It is a mod that
uses native events only. Under some managed settings, a user plugin's `classic.*` events and
`skill.prompt` are skipped, but mods still load and native events still run.

## The two sides

- Codex runs as a second harness, through `codex exec --json`. Running a GPT model as a Claude Code
  subagent through a proxy such as LiteLLM was considered and declined.
- The Claude side runs as a subagent, so its model and effort can differ from the session's.
  Its tools are `Read`, `Grep`, `Glob`, and `mcp__confer__git`, which runs read-only git commands.
  It has no Bash because it may read a hostile branch, and Bash is not sandboxed on macOS.
- The session that runs the rounds makes the `Agent` call for the Claude side, and the mod rewrites
  it in `agent.spawn`. A hook cannot wait for a subagent within its 10 s budget, and an `Agent`
  call made by a plugin is refused. `$.agent.spawn` takes no effort, so one reviewer agent type is
  registered per effort, `reviewer-low` through `reviewer-max`.
- The model and effort for both sides come from the run's tier ([references/tiers.md](../references/tiers.md)).
  Codex has no model aliases and passes the model id to its provider as given. The Codex model for
  each tier is therefore a plugin setting. The provider is set in Codex's config, never by Confer.
- Fable 5.2 runs the Claude side at the critical tier, at high, and at the escalation tier, at xhigh.
  On FrontierCode 2.0 in the 2026-11-09 launch post, Fable 5.2 scored 45.3% at high for $6.72
  a task, against 43.4% for $5.18 for Opus 5.5 at xhigh. At max it scored below its xhigh
  for about three times the cost, so it is not run at max at any tier.
- Before a critical or escalation run, Confer sends Fable 5.2 a one-line completion. Where that call
  is refused by the engine or answered with a 404, the run falls back to Opus 5.5, at xhigh for
  critical and max for escalation. A model set with `--claude-model` is never checked.
- Each side starts a fresh session every round.
- Confer checks `codex --version` against a minimum before a run starts.

## Rounds

- Each side agrees with or disputes every open point, or withdraws one of its own, with evidence.
  Each side sees the other's reply verbatim.
- The rulings are kept in one `state.json` per run. Consensus and the early stop are computed from
  that file, never judged by the session that runs the rounds.
- Codex runs inside the round's tool call, where nothing else is shown until the call returns. Each
  reviewer's start and end is written with `$.ui.log`, a transcript line the model does not see,
  which reaches a headless run as a `ui_log` message.
- Tokens and estimated cost for both sides are reported for each run, with no budget cap.
- In `/confer:ask`, each side answers in the first round without seeing the other's answer, and the
  session only relays. A draft to critique, or one side critiquing the other's first answer, anchors
  both on its framing. `/confer:plan` starts from the session's draft, since only that session can
  interview the user.

## Isolation

- Run files are kept under `~/.claude/tmp/confer/<run>/`, outside the checkout, and never
  versioned. A folder under review that contains that directory is refused.
- Where the OS does not enforce read-only, Codex runs in a detached worktree, so the checkout is
  never changed by a stray write. For a very large monorepo, the worktree can be turned off with
  the `worktree` setting. Codex's `--worktree` is not used: on 0.167, `git status --short` inside
  it showed none of a scratch repo's uncommitted or untracked changes, and the worktree was left on
  disk after exit.
- Two runs given the same `--findings` path can both write it, since the path is checked and then
  written, and `$.fs` has no exclusive create. A process per write would close the race, but
  PowerShell took 400 to 476 ms of the 1.5 s `session.end` chain, which would put each unattended
  Windows run's state save at risk.

## Codex constraints

- On Windows, Codex 0.167 refuses every command in its `read-only` sandbox, reads included. This
  was checked again on 0.167.1, with and without the `windows_sandbox_service` feature, which is
  under development there. Codex runs there with `--approve-for-me`, under which writes are possible: a file was created through `apply_patch` in
  a probe. `codex exec resume` has no `--approve-for-me` on 0.167, so a Codex session is never
  resumed. A PR, a branch of another remote or one that tracks a pull request, and a commit that no
  branch of `origin` or of the clone contains are reviewed there only after the user agrees in a
  question from `review_start`, which is not a tool input that the session could set for itself. A
  PR fetched into a local branch with no upstream is still taken for local work.
- On a Responses provider other than OpenAI, `--output-schema` with streaming and tools lost the
  function-call event, and the verdict arrived as plain text. Confer doesn't pass
  `--output-schema`, and validates Codex's output.
