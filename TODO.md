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
The prompt and the confirmation are enough, so nothing changes in session-skills. The defect was
filed with Claude Code's `/bug` on 2026-11-19.

- Headless in auto mode, the debug log for `gh pr create` in a scratch clone has `ask -> deny
  by plugin session-skills: This clone is in confirm-post mode, so you confirm each post.` from
  `tool.check`, the same path as the push prompt. With `session-skills.postMode` set to
  `auto-post`, the same command ran and failed in gh, since the clone has no GitHub remote.

### What is still open

- The confirm-post prompt was probed only headless, not in an interactive session.

## Analyze the Windows results of the session-skills confirm-push prompt under managed settings

Probed on 2026-11-19 and 2026-11-20 with Claude Code 2.1.329 and session-skills 0.36.0, in
interactive auto mode sessions in this checkout, with a push from a scratch repo to a local bare
remote.

### What matched

- `git push` and `gh pr create` each raised a permission prompt and ran only after a Yes there.
  The permission record of each in the transcript is `{"decision":"accept","source":
  "user_temporary","ruleSource":"localSettings","grantScope":"once","reasonCode":
  "rule:localSettings"}`, the record of a Yes in the prompt.
- A push chained with a `git status` was refused by the `tool.call` hook, before any prompt.
- Headless, a push was refused, in this checkout and in `C:\Dev\Temp\askprobe\repo`.

### What differed

- The prompt was raised by the `permissions.ask` rules of 0.35.2 and earlier, which are still in
  this checkout's `.claude/settings.local.json`: `Rule PowerShell(git -C * push *) from project
  local settings overrides auto mode.` No push mode is in that text, so the first push was taken
  for one that ran with no prompt.
- Two notices were printed before the prompt: `session-skills: its tool.check hook was skipped.
  "cc-plugin-sec-default" runs first and sent the event on past it.`, then `session-skills tried
  to reword an ask rule in your settings from a PowerShell call (PowerShell(git -C * push *)); the
  ask rule holds over the plugins you install (allowModsToOverrideDenyRules)`.
- In the 2.1.329 binary, the `tool.check` hook of `cc-plugin-sec-default` checks the call again
  without the plugins a person installs when one of them answers differently from the verdict
  beneath and is no stricter. That second check prints the skip notice. The guard keeps the second
  verdict where it comes from a settings rule, a classic hook, a setting, or a deny, so the rule's
  ask replaced the plugin's. In `askprobe\repo`, with no such rules, the verdict beneath was a
  plain ask, and the plugin's ask was kept.

### What is still open

- After the old rules are deleted from `.claude/settings.local.json` by hand, the reword notice
  stops and the plugin's prompt is shown. The skip notice is still printed, since the guard checks
  the call again whenever the plugin's ask differs from the plain ask beneath. That case was not
  probed interactively on this machine.

## Record a PowerShell stdin trap with the powershell skill

In PowerShell 7.6 on Windows, a string piped into a native command arrives with a CRLF line
ending. `git check-ignore --stdin` keeps the `\r` as part of the path and exits 1 for an ignored
path, while the same path read from an LF file matches. Run `/powershell:powershell` to record it.

## Check the push prompt on Windows now that the 0.35.2 ask rules are deleted

On 2026-11-20 the `permissions.ask` rules of session-skills 0.30.0 through 0.35.2 were deleted
from four `.claude/settings.local.json` files under `C:\Dev`: in `ai`,
`Repos\IanBrandt\agent-plugins`, `Repos\jregw`, and `Temp\confer-review-probe`. Each file had all
138 rules in `PUSH_RULES` and `POST_RULES` and no other ask rule. Every other setting was kept,
and a search of `C:\Dev` finds no file with the rules now. On the Windows machine:

1. In a new interactive auto mode session in this checkout, run
   `git -C <scratch repo> push origin <branch>` against a local bare remote, and answer No.

Replace this item with the prompt's text and the notices printed.

## Run test.sh with Git Bash on Windows

In PowerShell on the Windows machine, `bash` is WSL's `C:\WINDOWS\system32\bash.exe`. There
`claude` resolves to the npm shim but `node` does not, so `bash ./test.sh` reports the grader and
tier checks as failing. Under Git Bash every check passes, but no count is printed on the
`eval regex graders:` line, likely because `.` in `grep -E '^. pass '` matches one byte of the
multibyte `ℹ` there.

1. In the Checks section of `DEVELOP.md`, add that on Windows the script is run with Git Bash:

   ```powershell
   & 'C:\Program Files\Git\bin\bash.exe' ./test.sh
   ```

2. Make the grader count in `test.sh` print under Git Bash, and run the script there to check it.

Clear this item in the commit that makes those changes.
