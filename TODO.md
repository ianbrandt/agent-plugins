# To do

## Switch the Windows machine from claudex-loop to Confer

The installed `confer@ianbrandt` reads its options from `pluginConfigs."confer@ianbrandt"`, so
the Tennex model ids apply there without `--codex-model`. On the Windows machine:

1. Install Confer from the `ianbrandt` marketplace. `claude plugin list` should show Confer 0.15.0:

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

## Check that Confer 0.15.0 removes the leftover worktree under `0ee7848e`

Confer 0.15.0 deletes a leftover worktree directory that git no longer lists, which 0.14.5 kept
on every sweep. On the Windows machine:

1. Update Confer. `claude plugin list` should show Confer 0.15.0:

   ```shell
   claude plugin marketplace update ianbrandt
   claude plugin update confer@ianbrandt
   ```

2. For each run directory, print its status, the worktrees listed in its `state.json`, and the
   worktree directories on disk:

   ```powershell
   Get-ChildItem C:\Dev\.claude\tmp\confer -Directory | ForEach-Object {
     $s = Get-Content "$($_.FullName)\state.json" -Raw | ConvertFrom-Json
     [pscustomobject]@{
       Run = $_.Name; Status = $s.status
       Listed = $s.resources.worktrees -join ', '
       OnDisk = (Get-ChildItem $_.FullName -Directory -Filter '*-worktree').Name -join ', '
     }
   } | Format-Table -AutoSize -Wrap
   ```

3. In a new session in `C:\Dev\Temp\confer-review-probe`, run `/confer:review --tier routine`
   once. Then repeat step 2, and run
   `git -C C:\Dev\Temp\confer-review-probe worktree list --porcelain`.

Expected: `0ee7848e` lists no worktrees and has none on disk. Replace this item with the output
of each step.

## Analyze the Mac results of the session-skills confirm-push prompt

Probed on 2026-11-19 with Claude Code 2.1.328 in auto mode. The latest release, session-skills
0.35.2, predates `b8bdcf8`, so each session loaded the hook from this checkout with
`--plugin-dir plugins/session-skills`, which overrides the installed copy.

### What matched

- In the primary checkout, `git push origin main` raised a permission prompt. After the answer
  no, the bare remote had no branches.
- In the worktree, `git push origin wt` raised a prompt too, and `wt` never reached the remote.
- In the debug log, the hook reads the clone's git config and settles `tool.check` before the
  prompt, with no auto-mode classifier call. Headless, the same push logged `ask -> deny by
  plugin session-skills: This clone is in confirm-push mode, so you confirm each push.`, and the
  model got that reason.
- With `session-skills.pushMode` set to `auto-push`, the same push ran headless with no prompt.
  The classifier allows this push, so the confirm-push prompts came from the hook.

### What differed

The prompt read "This command requires approval" instead of the hook's reason. According to the
type documentation of `ToolCheckResult.reason`, the dialog shows a hook's reason on an ask, so
the missing text is a Claude Code defect rather than a session-skills one. A line sent with
`$.ui.notice` from the hook, before or after the prompt opened, never appeared under it either.
The prompt and the confirmation are enough, so the defect goes to Claude Code with `/bug` and
nothing changes in session-skills.

### What is still open

- The confirm-post prompt, as for `gh pr create`, was not probed.

## Record a PowerShell stdin trap with the powershell skill

In PowerShell 7.6 on Windows, a string piped into a native command arrives with a CRLF line
ending. `git check-ignore --stdin` keeps the `\r` as part of the path and exits 1 for an ignored
path, while the same path read from an LF file matches. Run `/powershell:powershell` to record it.

## Decide whether to release Confer with the refusal explanation

`main` has `fd693f8` and `5556b3e`, which explain a managed-settings refusal of the Codex start.
The installed Confer 0.17.2 does not have them, so a refused round still shows only Claude Code's
raw message.
