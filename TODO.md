# To do

## Analyze the Windows 0.27.2 probe results

session-skills 0.27.2. Probe worktree: `C:/Dev/Temp/backstopprobe/w`.

### What matched

- Step 4, PowerShell tool: push refused; `Repo: C:/Dev/Temp/backstopprobe/w`.
- Step 4, Bash tool: push refused; `Repo: C:/Dev/Temp/backstopprobe/w`.
  Both report a `C:/...` path, so the `pwd -W` fix holds under both shells.
- Step 5, Bash tool: `git push ../o.git HEAD:refs/heads/main` succeeded
  (`* [new branch] HEAD -> main`).

### What differed

- Step 5, the Bash tool result for the push carried no "end the reply with
  the next step" injection and no visible toast about a skipped `tool.call`
  hook. The only extra line was the harness's `Shell cwd was reset to
  C:\Dev\Temp\backstopprobe\w`.
- One oddity worth flagging: at session start, before any tool ran, the
  initial system context already included a `tool.call hook additional
  context: This command pushed work. End the reply with the next step...`
  line. It fired on prompt submit, not after the push, and it did not
  reappear on the actual push call.

### Still open

- Whether that prompt-submit-time "pushed work" injection is a stale
  carry-over from a prior session or a new misfire of the `tool.call` hook
  under `cc-plugin-sec-default`'s skip path.
- No `tool.call`-skipped toast was observed; unclear whether that means the
  hook ran, was silently skipped, or the toast surface is suppressed in
  this harness.
