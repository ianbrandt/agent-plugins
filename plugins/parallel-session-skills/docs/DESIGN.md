# parallel-session-skills design

How the plugin is wired, for anyone changing it. The [README](../README.md) covers using it.

## How it is wired

Nothing is added to a session's context at its start: nothing here applies to a session that never
opens a lane, and the skill descriptions are enough to trigger the three skills. The always-on cost
is the five tool definitions below.

One hooks module, `hooks/register.ts`, which is a Claude Code mod and needs Claude Code 2.1.308 or
later, the oldest version supported. No shell or interpreter is involved, and git is run directly.
The three ledger tools need git 2.36 or later, since the worktree list is read with `-z`.

Three tools are registered for the ledger, and in `claim-a-lane` it is read and written only through them.
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

## Worktrees

A branch in the primary checkout is where `session-skills` puts a unit of work. A worktree is for a
session that runs beside another, so the two tools for one are registered here, from
`hooks/worktree.ts`, and `work-in-worktree` is the skill that calls them. Both were in
`session-skills` through its 0.30.0.

- `open_worktree` opens `.claude/worktrees/<id>-<name>` on a new branch `claude/<id>-<name>`, pulls
  Git LFS files, and links the repo's local notes directory into the worktree: a junction on
  Windows, which needs no privilege, and a symbolic link elsewhere. It does not fetch. The `base`
  input is the ref that `find_checkouts` of `session-skills` returned, since one plugin's hooks
  module cannot call another's, and the rule for where a branch starts is kept in one place. With
  the `branch` input in place of `name`, `id`, and `base`, the worktree is opened on an existing
  branch: work in flight on a branch in no worktree, found while the primary checkout is busy.
- `open_worktree` also copies the `permissions.ask` list from the primary checkout's
  `.claude/settings.local.json` to the worktree's, where the worktree has no such file. On Windows a
  session started in a worktree reads only the worktree's file, and the push and post rules that
  `session-skills` writes are in that list. No other setting is copied.
- `remove_worktree` runs `git worktree remove` from the primary checkout, then deletes the
  worktree's directory where it is still on disk, as it is on Windows. A path outside
  `.claude/worktrees` is refused, and a path already unregistered is a no-op.

Both are checked by `hooks/worktree.test.ts`.
