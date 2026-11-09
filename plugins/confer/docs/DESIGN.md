# Design

Confer has commands to plan, review, and answer a question, and none to build. It is a mod that
uses native events only. Under some managed settings, a user plugin's `classic.*` events and
`skill.prompt` are skipped, but mods still load and native events still run.

## The two sides

- Codex runs as a second harness, through `codex exec --json`. Running a GPT model as a Claude Code
  subagent through a proxy such as LiteLLM was considered and declined.
- The Claude side runs as a subagent, so its model and effort can differ from the session's.
  Its tools are `Read`, `Grep`, `Glob`, and `mcp__confer__git`, which runs read-only git commands.
- The model and effort for both sides come from the run's tier ([references/tiers.md](../references/tiers.md)).
  Codex has no model aliases and passes the model id to its provider as given. The Codex model for
  each tier is therefore a plugin setting. The provider is set in Codex's config, never by Confer.
- Each side starts a fresh session every round.
- Confer checks `codex --version` against a minimum before a run starts.

## Rounds

- Each side agrees with or disputes every open point, or withdraws one of its own, with evidence.
  Each side sees the other's reply verbatim.
- The rulings are kept in one `state.json` per run. Consensus and the early stop are computed from
  that file, never judged by the session that runs the rounds.
- Tokens and estimated cost for both sides are reported for each run, with no budget cap.

## Isolation

- Run files are kept under `~/.claude/tmp/confer/<run>/`, outside the checkout, and never
  versioned. A folder under review that contains that directory is refused.
- Where the OS does not enforce read-only, Codex runs in a detached worktree, so the checkout is
  never changed by a stray write. For a very large monorepo, the worktree can be turned off with
  the `worktree` setting.

## Codex constraints

- On Windows, Codex 0.167 refuses every command in its `read-only` sandbox. Codex runs there with
  `--approve-for-me`, under which writes are possible: a file was created through `apply_patch` in
  a probe. `codex exec resume` has no `--approve-for-me` on 0.167, so a Codex session is never
  resumed.
- On a Responses provider other than OpenAI, `--output-schema` with streaming and tools lost the
  function-call event, and the verdict arrived as plain text. Confer doesn't pass
  `--output-schema`, and validates Codex's output.
