# To do

## Pull the trimmed global CLAUDE.md on the Windows machine

In claude-usage 9d4a585, the rules that the plugins now cover are cut from `global/CLAUDE.md`. Update
the plugins before pulling, or a session there loses rules its installed plugins don't have yet.
On the Windows machine:

1. Update the plugins. `claude plugin list` should show `session-skills` 0.32.0,
   `parallel-session-skills` 0.5.0, and `roadmap-skills` 0.23.0 or later:

   ```shell
   claude plugin marketplace update ianbrandt
   claude plugin update session-skills@ianbrandt
   claude plugin update parallel-session-skills@ianbrandt
   claude plugin update roadmap-skills@ianbrandt
   ```

2. Run `git pull` in the clone of claude-usage, and check that `git log -1 --oneline` shows
   9d4a585 or later.

Clear this item in a commit once both steps pass.

## Analyze the Confer review results

- `claude --version` on the probe machine, before and after plugin update, is up to date; the
  installed `confer@ianbrandt` is at 0.14.5.

Step 2, baseline. First attempt with `claude --plugin-dir
C:\Dev\Repos\IanBrandt\agent-plugins\plugins\confer` ended incomplete: Codex failed twice with
`/responses: Invalid model name passed in model=gpt-6.1-sol`. The packaged default in
`plugins/confer/.claude-plugin/plugin.json` is `gpt-6.1-sol`, with no `bedrock-` prefix the
Tennex gateway requires. The four tier ids configured under
`pluginConfigs."confer@ianbrandt"` in `C:\Dev\.claude\settings.json` were not applied, because
Claude Code loads a plugin from `--plugin-dir` as a bare `confer`, not as `confer@ianbrandt`.
Rerun with `--codex-model bedrock-gpt-6.1-sol` passed on the command line: clean. Claude
`bedrock-claude-sonnet-5-5[1m]` at high and Codex `bedrock-gpt-6.1-sol` at medium each returned
no findings. Codex cost $0.0484.

Step 3, Esc probe. Partial pass. After Esc on the `Codex started` line, Codex aborted after 3s
with `confer: $.process.spawn(codex) aborted`, the Claude reviewer round still completed, no
`pwsh.exe` started by Codex was left in Task Manager after a minute, and `review_cancel`
returned status `cancelled`. Fail on worktree cleanup: `C:\Dev\.claude\tmp\confer\0ee7848e\`
was still on disk after the cancel, with `codex-p0-r1-a1-worktree`, `state.json`, and the
per-attempt trees intact. Ten older run directories from 2026-11-10 and 2026-11-12 were there
too, which points to a stale-worktree leak on cancel going back several days.

Step 4, UNC path. Fails. `/confer:review` run from
`\\localhost\c$\Dev\Temp\confer-review-probe`, after a `safe.directory` entry for that path
was added, ended incomplete on both sides:

- Codex: two attempts, each `fatal: detected dubious ownership in repository at
  '//localhost/c$/Dev/Temp/confer-review-probe'`. The per-attempt paths were
  `C:/Dev/.claude/tmp/confer/<run>/codex-p0-r1-a{1,2}-worktree`. A wildcard
  `safe.directory = '*'` would cover them, but then every repo on the machine is trusted.
- Claude reviewer: `Error: A plugin's agent.spawn hook set cwd on this spawn: cwd must be a
  local path with no ".." in it, whose every part can be examined.` The Confer worktree
  under `C:/Dev/.claude/tmp/confer/...` inherits the UNC identity from the primary checkout.

Also under UNC, non-blocking: `SessionStart` and `UserPromptSubmit` hook errors with
`node:internal/modules/package_json_reader:197`. A Claude Code harness issue, outside Confer.

The `safe.directory` entry added for step 4 was removed afterward.

Still open:

- The `--plugin-dir` pluginConfigs mismatch. One workaround is to add a bare `confer` key under
  `pluginConfigs` with the same options, and keep it in sync with `confer@ianbrandt`.
- The stale-worktree leak on cancel.
- Confer does not run against a UNC-mounted primary checkout on Windows.

## Switch the Windows machine from claudex-loop to Confer

Do this after the item above passes. On the Windows machine:

1. Install Confer from the `ianbrandt` marketplace. `claude plugin list` should show Confer 0.14.5:

   ```shell
   claude plugin marketplace update ianbrandt
   claude plugin install confer@ianbrandt
   ```

2. If claudex-loop or a `confer@confer` install from a local checkout is in the output of
   `claude plugin list`, uninstall it and remove its marketplace. Check the names with
   `claude plugin marketplace list`:

   ```shell
   claude plugin uninstall claudex-loop@claudex-loop
   claude plugin marketplace remove claudex-loop
   ```

3. Remove any lines about claudex-loop from `%USERPROFILE%\.claude\CLAUDE.md`.
4. In a new session, check that `/confer:review`, `/confer:plan`, and `/confer:ask` are listed.

Clear this item in a commit with the results in its message.
