# To do

## Analyze the Windows pre-push backstop probe results

Run on 2026-11-08, Windows 11, session-skills 0.27.1, Claude Code 2.1.319,
git 2.56.0.windows.4.

### Matched the probe

No `the pre-push backstop is off` toast at startup. `git hook list pre-push`
and `git config --get-all hook.sessionskills.command` read as documented
under the Bash, PowerShell, and Monitor tools, with forward slashes in the
command path. `git hook run` on the `held` remote was refused with exit 1
under Bash and PowerShell, and silent with exit 0 on `o ../o.git`.
`sh plugins/session-skills/hooks/pre-push.test.sh` in Git Bash: `49 pass,
0 fail`.

### Differed from the probe

1. The `Repo:` line in the refusal differs by shell. Same hook, same
   working directory, but the path is shown as `C:/Dev/Temp/backstopprobe/w`
   under Bash and `/tmp/backstopprobe/w` under PowerShell. The second is
   Git for Windows' MSYS translation of the same path. Decide whether to
   pin the shown path to a canonical form.

2. `git push held …` was refused up front under both shells, with no
   permission prompt. The refusal text includes a bypass command of the
   form `git -C C:/Dev/Temp/backstopprobe/w -c hook.sessionskills.enabled=false
   push held HEAD:refs/heads/main`, and that bypass is then denied by the
   auto-mode classifier before any permission prompt. The step 6
   instruction to "decline at the permission prompt" no longer applies:
   update the probe wording, or change how the bypass is surfaced.

3. The `tool.check` hook is shadowed by `cc-plugin-sec-default` on this
   machine. The toast reads `session-skills: its tool.check hook was
   skipped. "cc-plugin-sec-default" runs first and sent the event on past
   it.`. Separate from the pre-push hook under test, but relevant to how
   pushes are stopped before git runs.

### Open: step 7

Inconclusive. After `claude plugin disable session-skills@ianbrandt` and
`claude --plugin-dir "$env:TEMP\it's here\session-skills"`, no pre-push
hook was registered: `git hook list pre-push` returned `warning: no hooks
found` and the config value was empty. The `--plugin-dir` form did not
inject the backstop in that session, so the copy's path under `it's here`
was never exercised. Does `--plugin-dir` run the plugin's hooks at all,
or does backstop registration depend on the installed-plugin code path?
