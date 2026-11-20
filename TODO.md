# To do

## Analyze the Windows results of the Confer leftover worktree check

Checked on 2026-11-20 with Confer 0.17.3 already installed, so step 1 was not needed.

### What matched

- `0ee7848e`, cancelled, lists no worktrees in `state.json` and has no worktree directory on disk.
  Its only directories are `codex-p0-r1-a1` and `codex-p0-r1-a2`, from 2026-11-13.
- `git -C C:\Dev\Temp\confer-review-probe worktree list --porcelain` lists only the probe repo
  itself, on `main`.

### What differed

- The leftover worktree was already gone before step 3, so `/confer:review` was not run. Which run
  deleted it is not known: `state.json` was last written on 2026-11-13, but it lists no worktree.
- Two runs started on 2026-11-18, `6f6445f0` and `e908e486`, still have the status `running`, and
  each lists a `checkout` worktree that is on disk. The `*-worktree` filter of the step 2 command
  misses a directory with that name, so it shows nothing for them in the `OnDisk` column.

### What is still open

- Whether a sweep removes the `checkout` worktree of a run left at `running` after its session
  ended.

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

## Analyze the Windows results of the push prompt with the 0.35.2 ask rules deleted

Probed on 2026-11-20 with Claude Code 2.1.329 in an interactive session in this checkout, whose
`.claude/settings.local.json` now has only an allow rule. The clone has no
`session-skills.pushMode` set, so it is in confirm-push mode. The push was
`git -C C:\Dev\Temp\pushprobe\repo push origin main` to a local bare remote.

### What matched

- The push raised a permission prompt, and after the answer No the bare remote had no branches.
- No reword notice was printed. In a first run, answered Yes by mistake, the skip notice was
  printed, as expected: `session-skills: its tool.check hook was skipped.
  "cc-plugin-sec-default" runs first and sent the event on past it.` The permission record of
  that run is `{"decision":"accept","source":"user_temporary","grantScope":"once",
  "reasonCode":"other"}`, with no `rule:localSettings` reason code, so a settings rule no longer
  raises the prompt.

### What differed

- The prompt read "This command requires approval" instead of the hook's reason, as on the Mac,
  so the push mode is still not shown in the prompt.

### What is still open

- Nothing on this machine. The missing reason is the Claude Code defect filed on 2026-11-19.
