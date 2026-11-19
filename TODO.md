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

## Make session-skills and parallel-session-skills work under managed settings

On a machine with managed settings, Claude Code refuses two kinds of call from these plugins, and
the confirm-push and confirm-post prompts are lost in worktree sessions as a result. Start a
session in the repo root at Opus + Extra with this prompt:

```
On managed machines, Claude Code's cc-plugin-sec-default guard blocks two things that session-skills and parallel-session-skills depend on. (1) It refuses a plugin outside the org's policy that writes .claude/settings*.json ($.fs.write), or that passes such a path in a $.process.run/spawn argv or stdin. set_push_policy can't write its permissions.ask rules, and open_worktree can't copy them into a new worktree, so worktree sessions lose the push/post prompts. (2) It refuses a plugin's $.process.run unless the user's permission rules would allow it as a Bash call ("this repeats a Bash call that is not allowed"). remove_worktree's directory delete fails this way. Confirm (2) from the guard's code in claude.exe, find every plugin command it affects, then design how confirm-push and confirm-post keep working and how both plugins report a refusal clearly, without writing settings or working around the guard. Build it with tests. Also: when git worktree remove fails with "Permission denied", have remove_worktree's error give the hint from work-in-worktree SKILL.md:134 (a process, such as the session's shell, is still in the directory).
```

## Add a convention for managed-settings refusals to AGENTS.md

When Claude Code refuses a plugin call under managed settings, the plugin reports the refusal with
an explanation and never reshapes its input to get past the check. Add that to `AGENTS.md`, then
decide whether the `ls-files` call at `plugins/confer/src/codex/run.ts:281-290` stays. It is a
read, but it was written to keep the settings file path out of the arguments Claude Code checks.

## Record a PowerShell stdin trap with the powershell skill

In PowerShell 7.6 on Windows, a string piped into a native command arrives with a CRLF line
ending. `git check-ignore --stdin` keeps the `\r` as part of the path and exits 1 for an ignored
path, while the same path read from an LF file matches. Run `/powershell:powershell` to record it.

## Decide whether to release Confer with the refusal explanation

`main` has `fd693f8` and `5556b3e`, which explain a managed-settings refusal of the Codex start.
The installed Confer 0.17.2 does not have them, so a refused round still shows only Claude Code's
raw message.
