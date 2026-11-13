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

## Run `/confer:review` once on the Windows machine

`/confer:review` has run against real models on macOS, but never on Windows. On the Windows
machine:

1. Pull `main` in the clone of this repo, and run `npm ci` in `plugins/confer`.
2. In a small Git repository with one uncommitted edit, start
   `claude --plugin-dir <clone>/plugins/confer` and run `/confer:review --tier routine`. The review
   should end with a report from both reviewers. Codex starts there through the `codex.cmd` shim,
   with no shell.
3. Run it again, and press Esc after a line ending in `Codex started (...)` is printed in the
   transcript. Within a minute, no `pwsh.exe` started by Codex should be left in Task Manager. Then ask Claude to cancel the review, and check that the
   worktree under `%USERPROFILE%\.claude\tmp\confer\<run>\` is gone.
4. Run step 2 from a UNC path to the same repository, such as `\\localhost\c$\<path>`.

Clear this item in a commit with the results in its message, including any error text.

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
