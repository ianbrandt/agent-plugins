# To do

## Check the per-tool skipped-check refusal on Windows

The 0.27.5 run on 2026-11-08 could not show a skip. A held push without the bypass is refused in
`tool.call` before `tool.check` runs, so its plain `Push refused` text is the same whether or not
the check would be skipped. A skip is also learned only after a call of that tool has run without
its check, and no PowerShell call ran before the push. The `permission check did not run` refusal
appears only on a command the check would ask about, such as a `git config` write to a remote,
after an earlier PowerShell call. The steps below are the 0.27.4 probe, which was not run, with
the retry note added. No step pushes to a real remote.

1. In PowerShell 7, pull the coding-skills clone, update the plugin, and record the versions.
   `claude plugin list` should show session-skills 0.27.5:

   ```powershell
   claude plugin marketplace update ianbrandt
   claude plugin update session-skills@ianbrandt
   claude plugin list
   ```

2. In the clone, run the tests. All 217 pass on the Mac. Paste the full output of any test that
   fails:

   ```powershell
   claude plugin test ./plugins/session-skills
   ```

3. Set up the probe repo:

   ```powershell
   $d = Join-Path $env:TEMP backstopprobe; Remove-Item -Recurse -Force $d -ErrorAction Ignore
   New-Item -ItemType Directory $d | Out-Null; Set-Location $d
   git init -q w; Set-Location w; git commit -q --allow-empty -m x
   git remote add held https://github.com/ianbrandt/no-such-backstop-probe.git
   ```

4. Start `claude` in `w`, in the default permission mode. Ask Claude to run these two with the
   PowerShell tool, in order, and to paste each tool result. Note when the toast about a skipped
   `tool.check` hook appears, and on which call:

   ```
   git status
   git config remote.held.url https://example.com/x.git
   ```

   `git status` should run. Where the toast appeared on it, the config write should be refused,
   starting with `Command refused: session-skills' permission check did not run` and including
   `Retry through the Bash tool`. If a permission prompt appears instead, answer No and record
   that.

5. Ask Claude to run the same config write with the Bash tool. A permission prompt should appear:
   answer No, and record whether it appeared.

6. In PowerShell, outside Claude, check that neither config write ran. It should print the GitHub
   URL:

   ```powershell
   git config --local --get remote.held.url
   ```

7. Remove the probe directory:

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

Held until the probe above has results. The 0.27.5 push refusal is decided before `tool.check`
runs, so it is not evidence that later calls reach `tool.check` normally, as stated in the draft.
The same statement is in the session-skills DESIGN.md paragraph on 2.1.319, to correct on the Mac
with the probe results.

Draft to file at <https://github.com/anthropics/claude-code/issues>:

```draft
Title: `cc-plugin-sec-default` fires a `tool.check` skipped-hook toast at session start, with no visible skip on later shell calls

Observed in Claude Code 2.1.319 on a managed Windows 11 machine (Team / Enterprise sign-in).

At session start a toast fires with text like:

    <plugin-name>: its tool.check hook was skipped. "cc-plugin-sec-default" runs first and sent the event on past it.

Within the same session, later `Bash` and `PowerShell` tool calls still reach the plugin's `tool.check` hook normally: a hook that returns `{ decision: 'ask' }` raises a native permission prompt, and a hook that returns `{ decision: 'deny' }` refuses with its reason. The toast fires once at session start and no further skip is visible on later calls.

A separate observation on an earlier session, with session-skills 0.27.3 on the same build, had every `PowerShell` `tool.check` call skipped for the whole session (Bash was unaffected). The behavior is therefore not stable session-to-session.

Expected: either the skip fires consistently (every call to the affected tool, so a user plugin can detect it and fall back) or not at all. The session-start toast without a visible persistent skip is confusing for a plugin that depends on `tool.check` for permission prompts, since it says the hook was skipped but the hook runs anyway for later calls.

Context: session-skills (<https://github.com/ianbrandt/coding-skills/tree/main/plugins/session-skills>) is a plugin whose `tool.check` hook asks the user before a push to a public remote. The plugin's DESIGN.md "Native events only" section records the measurements.
```
