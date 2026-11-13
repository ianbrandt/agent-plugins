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

## Analyze the Confer worktree-cleanup probe results

Baseline before the new run: `0ee7848e` had `codex-p0-r1-a1-worktree` both listed in its
`state.json` and present on disk; no other run had a worktree listed or present; the probe repo at
`C:\Dev\Temp\confer-review-probe` had only its primary checkout registered as a git worktree.

The new run was `f487e0df` from `/confer:review --tier routine` in that repo. It ended `complete`
with "No issues found" in one round at tier routine (Claude Sonnet 5.5 high and Codex GPT-6.1-sol
medium).

### What matched

- `f487e0df`'s `state.json` lists no worktrees, and none is on disk under its run directory.
- Only the primary checkout is registered as a git worktree of the probe repo.

### What differed

- `codex-p0-r1-a1-worktree` under `0ee7848e` is still on disk and still listed in
  `0ee7848e/state.json` after `f487e0df` ran. The start-of-run sweep in Confer did not remove it.

### What is still open

- Why `0ee7848e`'s stray worktree is not removed at the start of a new run. One guess: the sweep
  covers worktrees listed by runs in a set of ended statuses that does not include `cancelled`, so
  this one survives.
- Whether the right fix is to extend the sweep to any `*-worktree` directory under a `cancelled`
  run's folder, or to remove this one by hand.
