# parallel-session-skills design

How the plugin is wired, for anyone changing it. The [README](../README.md) covers using it.

## How it is wired

Nothing is added to a session's context at its start: nothing here applies to a session that never
opens a lane, and the skill descriptions are enough to trigger both skills. The always-on cost is the
three tool definitions below.

One hooks module, `hooks/register.ts`, which is a Claude Code mod and needs Claude Code 2.1.308 or
later, the oldest version supported. No shell or interpreter is involved, and git is run directly.
All three tools need git 2.36 or later, since the worktree list is read with `-z`.

Three tools are registered, and in `claim-a-lane` the ledger is read and written only through them.
With `mcp__parallel-session-skills__read_ledger`, dead claims are deleted and the live ones
returned. With `write_claim`, a claim is filed under the branch checked out in a worktree and
stamped with the session's id, and `release_claim` deletes it. The primary checkout is found from
any worktree, and it is refused as a lane. A claim file is deleted with `git clean` on its literal
path, because a hooks module has no call that deletes a file and git is on every machine these
skills run on.

At session end every claim stamped with the ending session's id is deleted, so a session that dies
or exits without wrapping hands its lane back anyway. That is a safety net: `land-and-wrap` still
releases at wrap, which returns the lane immediately instead of whenever the session exits. Where
hooks modules are off (a managed policy, or an untrusted workspace) the tools are not listed
either, and in `claim-a-lane` the session is told to stop and report it.

The ledger's rules are pure functions in `hooks/ledger.ts`. They are checked, with the tools and the
session-end release, by `claude plugin test` with `hooks/ledger.test.ts`.
