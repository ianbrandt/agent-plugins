# To do

## Check the per-tool retry note on Windows

In session-skills 0.27.5, the refusal shown when `tool.check` was skipped for one shell tool
gives the other shell tool as the first retry, but only where that other tool is not itself in
the skipped set this session. The land-and-wrap skill was updated with the same guidance in §1.
On PowerShell, the retry note reads as follows: "Retry through the Bash tool"; and on Bash the
note text is "Retry through the PowerShell tool".

1. In PowerShell 7, pull the coding-skills clone, update the plugin, and record the versions.
   `claude plugin list` should show session-skills 0.27.5:

   ```powershell
   claude plugin marketplace update ianbrandt
   claude plugin update session-skills@ianbrandt
   claude plugin list
   ```

2. Set up the probe repo:

   ```powershell
   $d = Join-Path $env:TEMP backstopprobe; Remove-Item -Recurse -Force $d -ErrorAction Ignore
   New-Item -ItemType Directory $d | Out-Null; Set-Location $d
   git init -q w; Set-Location w; git commit -q --allow-empty -m x
   git remote add origin https://github.com/ianbrandt/no-such-backstop-probe.git
   git config session-skills.originVisibility public
   ```

3. Start `claude` in `w`, in the default permission mode (not auto). Ask Claude to run a Bash
   `git status` first, so Bash is observed as checked. Then ask Claude to run this with the
   PowerShell tool and paste the result:

   ```
   git push origin HEAD:refs/heads/main
   ```

   The refusal should include `Retry through the Bash tool`.

4. In the same session, ask Claude to retry the push through the Bash tool:

   ```
   git push origin HEAD:refs/heads/main
   ```

   A native permission prompt should appear. Answer No, and record whether the prompt appeared.

5. Remove the probe directory:

   ```powershell
   Set-Location $env:TEMP; Remove-Item -Recurse -Force (Join-Path $env:TEMP backstopprobe)
   ```

Bring the versions and each result back to the Mac as a results item under this heading.

## File a Claude Code bug on cc-plugin-sec-default's per-tool asymmetry

On a managed Windows machine running Claude Code 2.1.319, the native `tool.check` event is
routed to user plugins for `Bash` tool calls and short-circuited for `PowerShell` tool calls by
`cc-plugin-sec-default`. There is no risk-model reason for the asymmetry: both tools run
arbitrary shell commands, and both run `git push`. The side effect for user plugins is that a
`tool.check` hook that would raise a native permission prompt is bypassed on PowerShell on this
machine, and session-skills' `tool.call` backstop falls back to a chat / `!` refusal instead.

Draft to file at <https://github.com/anthropics/claude-code/issues>:

```draft
Title: `cc-plugin-sec-default` routes `tool.check` to user plugins for Bash but not for PowerShell on Windows

Observed in Claude Code 2.1.319 on a managed Windows 11 machine (Team / Enterprise sign-in).

The built-in `cc-plugin-sec-default` short-circuits the native `tool.check` event for `PowerShell` tool calls and lets it through to user plugins for `Bash` tool calls. A user plugin that returns `{ decision: 'ask' }` from `tool.check` to raise a native permission prompt therefore gets the prompt for Bash commands and not for PowerShell commands, even though both tools dispatch arbitrary shell commands with the same risk profile.

Minimal reproduction:
1. Install a plugin whose `tool.check` hook returns `{ decision: 'ask', reason: 'test' }` for both `Bash` and `PowerShell`.
2. Sign in to a Team or Enterprise account on Windows.
3. Call the Bash tool: the native permission prompt appears.
4. Call the PowerShell tool: no prompt appears; the plugin is sent a toast indicating that `tool.check` was skipped.

Expected: both shell tools route `tool.check` through user plugins the same way, or both short-circuit, with the asymmetry removed.

Context: session-skills (<https://github.com/ianbrandt/coding-skills/tree/main/plugins/session-skills>) is a plugin whose `tool.check` hook asks the user before a push to a public remote. On this managed machine the hook raises the prompt for Bash pushes and never for PowerShell pushes, which forces a chat / `!` fallback for PowerShell. The DESIGN.md "Native events only" section records the measurement.
```

## Out of scope, worth filing

Two tests fail on `claude plugin test ./plugins/session-skills` as of 2026-11-08, unrelated to the
0.27.5 edits above:

- `a visibility looked up for landing_facts is recorded for the hook, without the token`
- `origin's visibility is looked up and recorded at session start`

Both expect a recorded line to match `/^private \d+ https:\/\/github\.com\/o\/r\.git\n$/` and
receive `undefined`. The visibility recording path has drifted. Worth a lane of its own.
