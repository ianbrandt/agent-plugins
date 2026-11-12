# To do

## Report when the Codex reviewer starts and finishes in Confer

`review_round` runs both reviewers inside one MCP tool call, so only the call start and the call
end reach the parent Claude session, with no event between. On the Windows machine this made the
item #2 step 3 probe impractical: there is no in-session signal for when to press Esc. The
workaround was an external PowerShell poll on `codex.exe` and `pwsh.exe` process trees and on new
directories under `%USERPROFILE%\.claude\tmp\confer`, but a plain in-session event is worth having
on its own.

Scope the design first before writing code. Open questions:

1. Where the event lands in the parent session: an MCP progress notification during the
   `review_round` call, a plugin-authoring hook, a status line, a toast, or a pane. The
   plugin-authoring skill lists these; check which one is rendered inline by Claude Code, so the
   user reads it without widening a pane.
2. What events to emit. At minimum: Codex launched, Codex returned, each round boundary. Claude
   reviewer launch and return too, for symmetry.
3. How to include the run id and the tier so a user watching two reviews at once can tell them
   apart.

The code change points are in `src/codex/run.ts` for the Codex boundaries and in `src/review/review.ts`
for the round boundaries. Add a test for the new output, and update `README.md` if the surface
chosen is user-visible.

After this lands and is released, pick the probe back up on the Windows machine: `/confer:review`
item #2 step 3 (Esc mid-run, then cancel), then step 4 (UNC path).

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
3. Run it again and press Esc while Codex is running. Within a minute, no `pwsh.exe` started by
   Codex should be left in Task Manager. Then ask Claude to cancel the review, and check that the
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
