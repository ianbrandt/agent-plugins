# session-skills

A [Claude Code](https://claude.ai/code) plugin for the two ends of a working session: getting a unit
of work onto its own branch, and getting it back off again. This plugin covers nothing a
session does between those two points.

## Skills

### `work-on-a-branch`

Fetch first, and branch from `origin/<default>` rather than a local default branch that is behind
it. There is no local way to tell whether the checkout is current. A stale branch point either
surfaces at push time as a rejected non-fast-forward, or never surfaces, and the work merges on top
of commits it was not written against. The same fetch guards a one-line edit to a file another
machine also edits. When the local default branch is ahead after the fetch, as it is while commits
are held for review before a push, the new branch is opened from it and includes those commits.

Pick up the branch work is already in flight on, or open a new one in the primary checkout. Work is
already in flight when any of three tells is present: a pin in the repo's backlog, an existing
branch with commits the default branch doesn't have, or a live lease where the repo runs a
concurrency plugin. Opening a second branch for work that already has one strands the first
branch's commits and silently restarts the work.

A branch in the primary checkout is the default place for work. There are two others:

- The default branch itself, when you ask for the work there. This is refused in a fork and where
  work lands as a pull request.
- A git worktree, which this plugin does not open. A concurrency plugin opens one when you ask for
  it, when the primary checkout is already on another unit's branch or has changed or untracked
  files, and for every unit of work where it is set that way. Without such a plugin, a session that finds the primary checkout busy stops and reports
  what is there.

A branch stays checked out in the primary checkout until its work is merged or its pull request is
opened, so a checkout on another branch has work in flight.

For a session that is in a worktree, a repo-root path handed over in context—from a git status
block, a memory, or a doc link—means the primary checkout, so taking it literally lands the
edit on the default branch instead of the session's branch. The fix for a file that lives only in
the primary checkout, such as an untracked backlog, is here too, along with the prune that keeps
merged branches from accumulating. That includes PR branches the host squashed or rebased on merge,
deleted only when their content is on the default branch.

### `land-and-wrap`

How work leaves its branch, decided by facts read off the clone instead of a mode declared in a
file in the tree. With no `upstream` remote the repo is the user's: work fast-forwards into the
default branch, or, where the default branch is protected, is pushed as a branch with a pull
request. An `upstream` remote means the repo is a fork of someone else's project, and the work
lands as a pull request against `upstream`.

Each clone has a push mode and a post mode, and both are the user's choice, whatever the repo's
visibility. In `confirm-push`, the default, every `git push` raises a permission prompt, in every
permission mode, after the commit range is shown in the reply. In `auto-push` a push runs unasked.
`confirm-post` and `auto-post` are the same for a PR, an issue, a comment, or a release written
with `gh` or `glab`, and a fork is always `confirm-post`. In an unattended run, work in a confirm
mode is left as local commits and draft files. To switch a clone, ask the session, for example
"switch this clone to auto-push": the `set_push_policy` tool asks for confirmation and writes the
mode.

None of these facts depends on the backlog, so a repo you own with an untracked, local-only roadmap
needs no special case.

A branch checked out in the primary checkout is merged by switching to the default branch and
fast-forwarding it, from a clean tree. For work in a worktree, the default branch is fast-forwarded
from the primary checkout, without a checkout where another branch is checked out there.

Then the wrap-up actions every session runs whether or not the work finished: stop stray background
tasks, release any lease, and leave the branch of unfinished work standing as the resume record.
The merged branch of landed work is deleted.

## What It Pairs With

Two seams that other plugins fill are defined in `work-on-a-branch` §0. A concurrency plugin
adds the half this plugin deliberately leaves out: a worktree for each session that runs beside
another, and a shared lease that keeps two or three sessions off each other's files, plus whatever
is built on top of it, such as an unattended conductor. A backlog plugin is where a session finds
what is workable, where something is already in flight, and how to record it done.

Used with neither, these skills still do the job: the user states the task, and the landing commit
is the record. The dependency runs one way—a plugin filling a seam references this one, never the
reverse—so no such plugin is mentioned here. The family map, with which plugins fill which seam, is
in the marketplace's README.

How the wrap-up reads once these actions are done is covered by `writing-skills`.

## How It Is Wired

The skills call five tools that the plugin registers as `mcp__session-skills__<tool>`, and the session
rules in [`hooks/rules.md`](hooks/rules.md) are added to the first prompt, and again after
`/clear` and compaction. The push and post modes are kept in per-clone `git config`, as
`session-skills.pushMode` and `session-skills.postMode`. For a confirm mode the plugin writes
`permissions.ask` rules to `.claude/settings.local.json` in the primary checkout and each worktree,
which also works under managed settings. A push inside a script or an alias matches no rule. In a
confirm mode a push or a post chained with another command is refused, so that the prompt shows
the push alone, and every push and post in a `claude -p` session is refused, since nobody can
answer the prompt there. The result of a `git push` includes a request for the next step, so the
reply is written with it in view. In the terminal the session title is set with `/rename` when the
turn ends, and that command shows as one line. Claude Code 2.1.314 or later is required.
[DESIGN.md](docs/DESIGN.md) covers each tool, how the session title is set, and why the rules are
loaded by a hook.

## Measuring It

[`evals/`](evals/) is a `claude plugin eval` suite of seven chat cases: how work lands in a fork, a
`confirm-push` clone, an `auto-push` clone, and a pull-request repo, a handoff after a landed unit,
no handoff mid-unit, and the session title block. Run it from the plugin directory:

```bash
claude plugin eval . --runs 4 --judge-model sonnet --no-publish -j 4
```

On 2026-11-11, with four runs per case, the plugin scored 1.00 and no plugin 0.46, a gap of +0.54.
Four cases scored higher with the plugin: the handoff after a landed unit, the `confirm-push`
landing case, and the session title, each 0.00 without it, and the `auto-push` landing case, 0.25
without it. The other three scored 1.00 in both arms: the fork and pull-request landing cases, and
no handoff mid-unit. Those three guard against the plugin making an agent post or stop where it
should not, and they measure nothing about the plugin's gain. The run cost $6.03 and took 212
seconds. The `auto-push` case scored 0.50 in that run and was run again after its grader was
changed to judge the push step and not a closing offer to carry out the plan.

## Platform

The tools run git by argument vector with no shell, so one implementation serves bash, Git Bash, and
PowerShell sessions. `find_checkouts` and `prune_branches` need git 2.36 or later, since the
worktree list is read with `-z`, and the merge check in `prune_branches` needs 2.43 or later. Most
of the commands left in the skills are single `git`, `gh`, or `glab` calls that read the same in
each. A few lines join two commands with `&&`, which Windows PowerShell 5.1 rejects, so there the
two are run as two calls. The check for stray processes is `pgrep` on macOS and Linux and
PowerShell's `Get-Process` on Windows.
