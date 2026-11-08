# session-skills

A [Claude Code](https://claude.ai/code) plugin for the two ends of a working session: getting a unit
of work into its own git worktree, and getting it back out again. This plugin covers nothing a
session does between those two points.

## Skills

### `work-in-worktree`

Fetch first, and branch from `origin/<default>` rather than a local default branch that is behind
it. There is no local way to tell whether the checkout is current. A stale branch point either
surfaces at push time as a rejected non-fast-forward, or never surfaces, and the work merges on top
of commits it was not written against. The same fetch guards a one-line edit to a file another
machine also edits. When the local default branch is ahead after the fetch, as it is while commits
are held for review before a push, the new branch is opened from it and includes those commits.

Adopt the worktree work is already in flight on, or open a fresh one. Work is already in flight
when any of three tells is present: a pin in the repo's backlog, an existing worktree with commits
the default branch doesn't have, or a live lease where the repo runs a concurrency plugin. Opening a
second worktree on work that already has one strands the first branch's commits and silently
restarts the work.

The rule that costs the most when it's missed: a repo-root path handed over in context—from a git
status block, a memory, or a doc link—means the **primary checkout**, so taking it literally lands
the edit on the default branch instead of the session's branch. The fix for a file that lives only
in the primary checkout, such as an untracked backlog, is here too, along with the prune that keeps
stale worktree registrations and merged branches from accumulating. That includes PR branches the
host squashed or rebased on merge, deleted only when their content is on the default branch.

### `land-and-wrap`

How work leaves a worktree, decided by facts read off the repo instead of a mode declared in a
file. An `upstream` remote means the repo is a fork of someone else's project: the work is never
merged or pushed, and nothing is written to the remote host, whether GitHub, GitLab, or Bitbucket.
Issue and PR text is drafted as local files for the user to post. No `upstream` means the repo is
the user's. Work then fast-forwards into the default branch, or, where the default branch is
protected, is pushed as a branch with a pull request that is opened only after the user's go on its
title and body. The push depends on `origin`'s visibility, going out when private and waiting for
the user's explicit go when public. Visibility and landing mode are each read from a per-clone
`git config` value, with `gh` as a shortcut for both and `glab` for visibility, and the user is
asked once when none of them returns a value. The fork hold, the public-push hold, and the wait on
PR text each have a per-clone `git config` override that only the user sets.

None of these facts depends on the backlog, so a repo you own with an untracked, local-only roadmap
needs no special case.

Then the wrap-up actions every session runs whether or not the work finished: stop stray background
tasks, release any lease, and leave the branch and worktree of unfinished work standing as the
resume record. The worktree of landed work is removed, and its merged branch is deleted.

## What it pairs with

Two seams that other plugins fill are defined in `work-in-worktree` §0. A **concurrency plugin**
adds the half this plugin deliberately leaves out: a shared lease that keeps two or three sessions
off each other's files, plus whatever it builds on top, an unattended conductor for one. A **backlog
plugin** is where a session finds what is workable, where something is already in flight, and how to
record it done.

Used with neither, these skills still do the job: the user states the task, and the landing commit
is the record. The dependency runs one way—a plugin filling a seam references this one, never the
reverse—so no such plugin is mentioned here. The family map, with which plugins fill which seam, is
in the marketplace's README.

`writing-conventions` governs how the wrap-up reads once these actions are done.

## How it is wired

The skills call six tools that the plugin registers as `mcp__session-skills__<tool>`, and the session
rules in [`hooks/rules.md`](hooks/rules.md) are added to the first prompt, and again after
`/clear` and compaction. A force push or a push that a hold in `land-and-wrap` applies to is
refused with the command to run instead, which turns the session's `pre-push` hook off for that
push and is put to the user in the permission prompt. A write to the host through `gh` or `glab`,
such as a comment or a merge, is put to the user there too, in any permission mode. A push run inside another program, such as a release
script, meets a `pre-push` hook the plugin adds for the session, which refuses it unless the remote
is on this machine or known to be private. The result of a `git push` includes a request for the
next step, so the reply is written with it in view. In the terminal the session title is set with `/rename` when the
turn ends, and that command shows as one line. Claude Code
2.1.314 or later is required. [DESIGN.md](DESIGN.md) covers each tool, how the session title is
set, and why the rules are loaded by a hook.

## Measuring it

[`evals/`](evals/) is a `claude plugin eval` suite of seven chat cases: how work lands in a fork, a
public repo, a pull-request repo, and a repo of unknown visibility, a handoff after a landed unit, no
handoff mid-unit, and the session title block. Run it from the plugin directory:

```bash
claude plugin eval . --runs 4 --judge-model sonnet --no-publish -j 4
```

On 2026-10-08, with four runs per case, the plugin scored 1.00 and no plugin 0.43, a gap of +0.57.
Four cases scored 0.00 without the plugin and 1.00 with it: the handoff after a landed unit, the
public-repo and pull-request landing cases, and the session title. The other three scored 1.00 in
both arms: the fork and unknown-visibility landing cases, and no handoff mid-unit. Those three guard
against the plugin making an agent act where it should hold, and they measure nothing about the
plugin's gain. The run cost $5.70 and took 209 seconds.

## Platform

The tools run git by argument vector with no shell, so one implementation serves bash, Git Bash, and
PowerShell sessions. `find_checkouts` and `prune_branches` need git 2.36 or later, since the
worktree list is read with `-z`, and the merge check in `prune_branches` needs 2.43 or later. Most
of the commands left in the skills are single `git`, `gh`, or `glab` calls that read the same in
each. A few lines join two commands with `&&`, which Windows PowerShell 5.1 rejects, so there the
two are run as two calls. The check for stray processes is `pgrep` on macOS and Linux and
PowerShell's `Get-Process` on Windows. On Windows the notes directory is linked as a junction, which
needs no privilege. After a removal there, git leaves the worktree's directory on disk with the
junction inside, and `remove_worktree` deletes the directory in the same tool call.
