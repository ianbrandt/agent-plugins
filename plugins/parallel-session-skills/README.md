# parallel-session-skills

A [Claude Code](https://claude.ai/code) plugin for a repo that several sessions are working at once.
Each session sits in its own git worktree and can see none of the others' context, so the sessions
coordinate only through git and a shared claim ledger. The skills here cover writing to that ledger
and running several lanes from one conductor session.

## Skills

### `work-in-worktree`

Open a git worktree for a unit of work, and remove it once the work has landed. `session-skills`
puts work on a branch in the primary checkout by default, and one checkout has room for one unit of
work at a time. A worktree is opened in three cases: you ask for one, a conductor runs the work as
a lane, or the primary checkout is already on another unit's branch or has changed or untracked
files.

The `open_worktree` tool opens `.claude/worktrees/<id>-<name>` on a new branch, or on the branch
that work is already in flight on. It pulls Git LFS files, copies the primary checkout's
`permissions.ask` rules, and links the repo's local-only notes directory into the worktree.
`remove_worktree` removes the worktree the session's work was in, after its untracked files are
checked for anything worth keeping.

### `claim-a-lane`

Write a claim to the ledger before touching code, from a worktree or from a branch in the primary
checkout. The paths the session expects to edit
are listed in the claim, so whether two tasks are disjoint is settled by comparing globs instead of
guessing from the task names. No issue tracker can supply that fact: two Jira issues that both edit
a dependency manifest look unrelated in Jira. The skill also covers the dead-claim reap: a claim is
dead when `git worktree list` shows no worktree on its branch. Merge state cannot be used for this,
since a just-claimed session's branch tip equals the default branch. And the etiquette: never `git
worktree remove` a sibling's directory, because a live session between tasks looks the same as an
abandoned one.

The rule that costs the most when it's missed: an empty ledger is not evidence the work is free. A
session releases its claim when the session ends, whether or not the work is finished, so after an
ordinary handoff the work is in flight with no claim.

### `conduct-a-pipeline`

One session conducting several lanes at once, unattended: hold 2–5 file-disjoint units of work in
flight, build each in its own worktree via a background Workflow, and process each as it finishes,
refilling until the candidates run out. Everything in it that looks paranoid is there because
nobody is watching. A Workflow's self-reported `ready` has been wrong on a red tree, so the
conductor runs the build gate itself and treats a report that fails it as a failure. A Workflow that
dies sends no completion notification, so a watchdog covers the pipeline that went quiet rather than
finished. After a second real failure the unit is flagged and the run continues without it, and a
flagged unit stays out of later refills so it isn't re-picked and re-burned every pass.

Candidates come from a backlog plugin, and each finished unit is recorded there.

## What it needs

`session-skills`: `work-on-a-branch` fetches, locates the primary checkout, picks the ref a new
branch starts from, and resumes the branch work is already in flight on, and `land-and-wrap` gets
the work back out. This plugin fills the lease seam defined in `work-on-a-branch` §0. The
dependency runs one way: `session-skills` works alone and does not refer to any plugin that fills
its seams, but this plugin does not work without `session-skills`. Nothing in the manifest format
enforces that, so the check is in `work-in-worktree` and `claim-a-lane`, where the session is told
to stop and report when `work-on-a-branch` is absent.

A backlog plugin is optional on top of both. It supplies what is workable and where something is
already in flight. Disjointness is still checked in the ledger, because an issue tracker has no
record of which paths a task edits.

## How it is wired

The plugin registers five tools as `mcp__parallel-session-skills__<tool>`: two that open and remove
a worktree, and three that are the only way the ledger is read and written. Every claim stamped
with a session's id is deleted when that session ends. Nothing is added to a session's context at
its start. Claude Code 2.1.308 and git 2.36 or later are required. [DESIGN.md](docs/DESIGN.md)
covers each tool and the release at session end.
