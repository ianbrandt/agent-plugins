# To do

## Check the per-tool skipped-check refusal on Windows in the default permission mode

The 2026-11-08 run on 0.27.5 was intercepted by auto mode, the default for a fresh `claude` on
this machine, before session-skills' `tool.call` backstop ran. These are the same steps, run in
the default permission mode on 0.28.0. No step pushes to a real remote.

1. In PowerShell 7, pull the coding-skills clone, update the plugin, and record the versions.
   `claude plugin list` should show session-skills 0.28.0:

   ```powershell
   claude plugin marketplace update ianbrandt
   claude plugin update session-skills@ianbrandt
   claude plugin list
   ```

2. In the clone, run the tests. All 218 pass on the Mac. Paste the full output of any test that
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

4. Start Claude in `w` in the default permission mode:

   ```powershell
   claude --permission-mode default
   ```

   Ask Claude to run these two with the PowerShell tool, in order, and to paste each tool result.
   Note when the toast about a skipped `tool.check` hook appears, and on which call:

   ```
   git status
   git config remote.held.url https://example.com/x.git
   ```

   `git status` should run. Where the toast appeared on it, the config write should be refused,
   starting with `Command refused: session-skills' permission check did not run` and including
   `Retry through the Bash tool`. If a permission prompt appears instead, answer No and record
   that: it means the PowerShell `tool.check` ran.

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

Still held. The draft's claim that "later `Bash` and `PowerShell` tool calls still reach the
plugin's `tool.check` hook normally" is not backed by observation on 2.1.319. The 2026-11-08
probe was blocked by auto mode before session-skills' `tool.call` backstop ran. The plain `Push
refused:` text on an earlier PowerShell `git push` is no evidence either way, since that refusal
is returned before `tool.check` fires. In the draft the toast fires at session start, but in one
session it came on the second PowerShell call. The draft is on hold until the probe item above
has results.

Draft to file at <https://github.com/anthropics/claude-code/issues>:

```draft
Title: `cc-plugin-sec-default` fires a `tool.check` skipped-hook toast at session start, with no visible skip on later shell calls

Observed in Claude Code 2.1.319 on a managed Windows 11 machine (Team / Enterprise sign-in).

At session start a toast fires with text like:

    <plugin-name>: its tool.check hook was skipped. "cc-plugin-sec-default" runs first and sent the event on past it.

Within the same session, later `Bash` and `PowerShell` tool calls still reach the plugin's `tool.check` hook normally: a hook that returns `{ decision: 'ask' }` raises a native permission prompt, and a hook that returns `{ decision: 'deny' }` refuses with its reason. The toast fires once at session start and no further skip is visible on later calls.

A separate observation on an earlier session, with session-skills 0.27.3 on the same build, had every `PowerShell` `tool.check` call skipped for the whole session (Bash was unaffected). The behavior is therefore not stable session-to-session.

Expected: either the skip fires consistently (every call to the affected tool, so a user plugin can detect it and fall back) or not at all. The session-start toast without a visible persistent skip is confusing for a plugin that depends on `tool.check` for permission prompts, since it says the hook was skipped but the hook runs anyway for later calls.

Context: session-skills (<https://github.com/ianbrandt/agent-plugins/tree/main/plugins/session-skills>) is a plugin whose `tool.check` hook asks the user before a push to a public remote. The plugin's DESIGN.md "Native events only" section records the measurements.
```

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

Clear this item in a commit with the results in its message, including any error text, and push.

## Switch the Windows machine from claudex-loop to Confer

Do this after the item above passes. On the Windows machine:

1. Install Confer from the `ianbrandt` marketplace. `claude plugin list` should show Confer 0.12.5:

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

Clear this item in a commit with the results in its message, and push.
