# To do

## Analyze the per-tool skipped-check refusal results

Run on 2026-11-08, Windows 11, Claude Code 2.1.319, PowerShell 7. `session-skills@ianbrandt`
0.27.5 installed; all 217 plugin tests pass.

### What matched

- `git status` ran unprompted and clean.
- Neither `git config remote.held.url https://example.com/x.git` write landed; after the probe,
  `git config --local --get remote.held.url` printed the GitHub URL set in step 3.
- A toast about `cc-plugin-sec-default` short-circuiting `tool.check` fired in the fresh session,
  as predicted in the draft for item 3.

### What differed

- The default permission mode in a freshly started `claude` on this machine is "auto mode", not
  the probe's "default". The PowerShell `git config` write was intercepted by auto mode with
  "Blocked by auto mode ∙ /permissions to review ∙ Auto mode: No reason provided", before any
  "Command refused: session-skills' permission check did not run / Retry through the Bash tool"
  text was reached in session-skills' `tool.call` backstop.
- The toast fired on the second PowerShell call, not at session start. In an earlier session on
  this machine the toast was recorded at session start, so the moment it first fires is not
  stable.
- The Bash call was interrupted (user answered No), so it is not clear whether the prompt came
  from the plugin's `tool.check` or from auto mode.

### What is still open

- The 0.27.5 chat / `!` fallback refusal text was not observed, because auto mode intercepted the
  test. A re-run in the default permission mode (switch via `/permissions` or
  `claude --permission-mode default`) is needed to confirm the backstop message.
- The question called out in item 3's draft—whether later Bash and PowerShell `tool.check`
  calls reach the plugin normally after the session-start toast—remains unresolved for the same
  reason.

## Analyze the pinned plugin install results

Run on Windows 11, Claude Code 2.1.319, PowerShell 7.

### What matched

- `claude plugin marketplace update ianbrandt` refreshed the cache cleanly.
- `claude plugin update writing-conventions@ianbrandt` and `claude plugin update
  ghostwriting-skills@ianbrandt` each reported already at the latest version, 0.55.0 and 0.13.0.
- `installed_plugins.json` on this machine is at
  `C:\Dev\.claude\plugins\installed_plugins.json`, not under `$HOME\.claude`, because
  `CLAUDE_CONFIG_DIR` is redirected to `C:\Dev\.claude`. In both entries:
  - `writing-conventions@ianbrandt` 0.55.0, `gitCommitSha`
    `04c4238bd7693ee7b38f528015f70bf2c75df269`.
  - `ghostwriting-skills@ianbrandt` 0.13.0, `gitCommitSha`
    `04c4238bd7693ee7b38f528015f70bf2c75df269`.
- The last paragraph of
  `C:\Dev\.claude\plugins\cache\ianbrandt\writing-conventions\0.55.0\hooks\rules.md`
  ends: "Make that edit in the marketplace repo this plugin ships from, never in the installed
  cache. Installed sessions get it after the plugin's next release, so apply the correction from
  memory for the rest of the session." No `version`-bump instruction remains.

### What differed

- The default `installed_plugins.json` path in step 2 of the probe was written for
  `$HOME\.claude`; on this machine it is redirected to `C:\Dev\.claude` through
  `CLAUDE_CONFIG_DIR`. Worth noting in the probe where it is re-run elsewhere.

### What is still open

Nothing. On this machine, the `git-subdir` source is allowed for both plugins in managed
settings, and each is pinned to the expected commit.

## File a Claude Code bug on cc-plugin-sec-default's per-tool asymmetry

On a managed Windows machine running Claude Code 2.1.319, the native `tool.check` event is
routed to user plugins for `Bash` tool calls and short-circuited for `PowerShell` tool calls by
`cc-plugin-sec-default`. There is no risk-model reason for the asymmetry: both tools run
arbitrary shell commands, and both run `git push`. The side effect for user plugins is that a
`tool.check` hook that would raise a native permission prompt is bypassed on PowerShell on this
machine, and session-skills' `tool.call` backstop falls back to a chat / `!` refusal instead.

Still held. The 2026-11-08 probe was intercepted by auto mode before session-skills' `tool.call`
backstop ran, so the draft's claim that "later `Bash` and `PowerShell` tool calls still reach
the plugin's `tool.check` hook normally" is not yet backed by observation on 2.1.319. A re-run
of the probe in the default permission mode (switch via `/permissions` or
`claude --permission-mode default`) is needed before the draft is filed. The same unconfirmed
claim appears in the session-skills DESIGN.md paragraph on 2.1.319, to correct on the Mac with
the probe results.

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
