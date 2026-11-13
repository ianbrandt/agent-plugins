# To do

## Switch the Windows machine from claudex-loop to Confer

The installed `confer@ianbrandt` reads its options from `pluginConfigs."confer@ianbrandt"`, so
the Tennex model ids apply there without `--codex-model`. On the Windows machine:

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

## Check what Confer left under `C:\Dev\.claude\tmp\confer`

Do this after the item above. After the Esc probe and `review_cancel`, run `0ee7848e` still had
`codex-p0-r1-a1-worktree` on disk. Run directories are kept for a week after a run ends by
design, so the ten older ones are expected. A worktree left inside one is not. On the Windows machine:

1. For each run directory, print its status, the worktrees listed in its `state.json`, and the
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

2. Run `git -C C:\Dev\Temp\confer-review-probe worktree list --porcelain`.
3. In `C:\Dev\Temp\confer-review-probe`, run `/confer:review --tier routine` once with the
   installed plugin. Starting a run removes worktrees that ended runs still list. Then repeat
   steps 1 and 2.

Replace this item with the output of each step.
