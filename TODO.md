# To do

## Watch for the per-tool skip firing in a live session

Session-skills 0.27.5 was probed on Windows on 2026-11-08 in Claude Code 2.1.319. At session
start a toast fired saying `cc-plugin-sec-default` had sent `tool.check` past this plugin, and
yet a fresh PowerShell `git push` to a public remote in the same session was refused with the
plain `Push refused: Push held: origin is public [...]` text—no `Command refused:
session-skills' permission check did not run` prefix and no `Retry through the Bash tool` line.
So the skip fires for one event at session start but not for every PowerShell shell call on
this build, and the 0.27.5 observation-based retry had nothing to prepend.

What to watch for in later Windows sessions, and record under this heading on the Mac:

- A `git push`, `gh pr`, or `git config` refusal in PowerShell that starts with `Command
  refused: session-skills' permission check did not run`—the skipped-check path firing for a
  real shell call. Note whether `Retry through the Bash tool` is in the refusal.
- A refusal that starts with `Retry through the PowerShell tool` on a Bash call—the reverse
  skip, which has never been observed on 2.1.319.
- A session where the toast fires repeatedly rather than once at start.

No fresh probe to script until one of these shows up.

## File a Claude Code bug on cc-plugin-sec-default's per-tool asymmetry

On a managed Windows machine running Claude Code 2.1.319, the native `tool.check` event is
routed to user plugins for `Bash` tool calls and short-circuited for `PowerShell` tool calls by
`cc-plugin-sec-default`. There is no risk-model reason for the asymmetry: both tools run
arbitrary shell commands, and both run `git push`. The side effect for user plugins is that a
`tool.check` hook that would raise a native permission prompt is bypassed on PowerShell on this
machine, and session-skills' `tool.call` backstop falls back to a chat / `!` refusal instead.

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

## Out of scope, worth filing

Two tests fail on `claude plugin test ./plugins/session-skills` as of 2026-11-08, unrelated to the
0.27.5 edits above:

- `a visibility looked up for landing_facts is recorded for the hook, without the token`
- `origin's visibility is looked up and recorded at session start`

Both expect a recorded line to match `/^private \d+ https:\/\/github\.com\/o\/r\.git\n$/` and
receive `undefined`. The visibility recording path has drifted. Worth a lane of its own.
