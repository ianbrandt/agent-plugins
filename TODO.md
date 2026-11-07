# To do

## Gate a held push at tool-call time

`land-and-wrap` holds a push to a public origin by default, lifted per clone with `git config
session-skills.holdPublicPush false`. The hold today is advisory, read from the skill text, and a
session that pushes without invoking the skill does not see it: on 2026-11-06 this session pushed a
cleared TODO straight to `origin/main` on this public repo, under `session-skills.landing=merge`
and with no hold lifted.

The one `git push` hook in `plugins/session-skills/hooks/register.ts` around line 514 runs after
the push and only appends a next-step prompt. Turn it into a pre-call gate on `Bash` and
`PowerShell`:

- When the command matches the push regex, the caller is not a subagent, and `landing_facts`
  reports a push-blocking hold still in effect (`holdPublicPush` on a public origin, or `holdFork`
  on a fork), deny the call with a short reason that names the hold and the `git config` line that
  lifts it.
- Keep the existing next-step injection for the pushes that are allowed through.
- Cover `--dry-run` and a detached-HEAD worktree in the test file alongside the existing cases in
  `register.test.ts`.

A cheaper alternative, if a hard deny reads as too strict: inject the hold's text as pre-call
context so a human sees it at the moment of the push rather than after.
