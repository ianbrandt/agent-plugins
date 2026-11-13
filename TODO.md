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
