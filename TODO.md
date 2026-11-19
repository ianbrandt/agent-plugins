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

## Check the confirm-push prompt of the session-skills hook on the Mac

session-skills now raises the confirm-push and confirm-post prompts from a `tool.check` hook, in
place of `permissions.ask` rules in `.claude/settings.local.json`. It was probed only headless, on
the Windows machine. Once session-skills is released with the hook, on the Mac:

1. Update session-skills, and check its version in `claude plugin list`:

   ```shell
   claude plugin marketplace update ianbrandt
   claude plugin update session-skills@ianbrandt
   ```

2. Make a scratch repo with a bare remote and a worktree, and print its directory:

   ```bash
   p=$(mktemp -d)
   git init -q --bare "$p/remote.git"
   git init -q -b main "$p/repo"
   git -C "$p/repo" commit -q --allow-empty -m one
   git -C "$p/repo" remote add origin "$p/remote.git"
   git -C "$p/repo" worktree add -q "$p/repo/.claude/worktrees/wt" -b wt
   echo "$p"
   ```

3. In `$p/repo`, start `claude --permission-mode auto` and send `Run git push origin main`.
   Expected: a permission prompt with "This clone is in confirm-push mode, so you confirm each
   push." Answer no. Then `git -C "$p/remote.git" branch` prints nothing.
4. Repeat step 3 in `$p/repo/.claude/worktrees/wt` with `Run git push origin wt`.
5. Delete the scratch repo with `rm -rf "$p"`.

Replace this item with what each of steps 3 and 4 showed.

## Record a PowerShell stdin trap with the powershell skill

In PowerShell 7.6 on Windows, a string piped into a native command arrives with a CRLF line
ending. `git check-ignore --stdin` keeps the `\r` as part of the path and exits 1 for an ignored
path, while the same path read from an LF file matches. Run `/powershell:powershell` to record it.

## Decide whether to release Confer with the refusal explanation

`main` has `fd693f8` and `5556b3e`, which explain a managed-settings refusal of the Codex start.
The installed Confer 0.17.2 does not have them, so a refused round still shows only Claude Code's
raw message.
