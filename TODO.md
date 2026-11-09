# To do

## Analyze the Windows backstop refusal probe results

Ran on Claude Code 2.1.319, PowerShell 7.6.9, session-skills 0.27.3 (already latest in the
marketplace).

### What matched

- The Bash `git push held HEAD:refs/heads/main` call was refused. The deniers were listed as
  cc-plugin-sec-default, session-skills, and cc-plugin-privacy, with the normal held-push message:
  "Push refused: Push held: the visibility of the remote `held` is unknown…". No backstop wording
  appeared. On Bash, session-skills' own `tool.check` ran normally.

### What differed

- The PowerShell `gh pr merge 1` call ran to completion. A task notification was shown mid-call:
  "session-skills: its `tool.check` hook was skipped. `cc-plugin-sec-default` runs first and sent
  the event on past it." No `tool.call` refusal followed; the command exited 1 only because gh is
  not on PATH.
- The Bash `git config hook.sessionskills.enabled false` call ran. The write landed, confirmed
  outside Claude: `git config --local --get hook.sessionskills.enabled` returned `false` with
  exit 0. No `tool.call` refusal.

### What is still open

- Why no backstop refusal appears in `tool.call` on this managed Windows setup even when
  `tool.check` is observed as skipped. On the PowerShell call the skip was reported in the same
  turn, yet the command still ran.
- Whether the backstop's state is scoped per tool kind rather than per session. On Bash, both
  `git status` and `git push held` had `tool.check` running normally, with no "skip" recorded for
  the Bash side, so the later `git config` write went through unflagged.
