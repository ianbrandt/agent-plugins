---
name: work-on-a-branch
description: >-
  Get a unit of work onto the right branch before touching code: fetch so the
  branch point is current rather than whatever the checkout was left at, locate
  the primary checkout, pick up the branch the work is already in flight on
  instead of opening a second one, and open a new branch in the primary checkout
  when it isn't. The work goes on the default branch itself only when the user
  asks for that, and into a worktree only through a concurrency plugin, when the
  user asks for one or the primary checkout is busy with other work. Includes
  the rules for a session that is in a worktree—a repo-root path handed over in
  context means the primary checkout, so taking it literally lands the edit on
  the default branch—plus how to edit a file that lives only there, the prune
  that keeps merged branches from piling up, squash- and rebase-merged PR
  branches included, and the three-question seam a backlog plugin fills. Trigger
  before creating a branch for a unit of work, when picking up work that may
  already be in flight, before editing a file another machine also edits, and on
  "start on this" or "am I starting from a stale checkout". NOT for opening a
  worktree or keeping several sessions off each other's files—that's a
  concurrency plugin's worktree skill and lane claim, where one is
  installed—NOT for choosing what to work on (that's the repo's backlog), and
  NOT for finishing and landing it (that's land-and-wrap).
---

# Work on a branch

A unit of work gets a branch, checked out in the primary checkout: the directory the repo was cloned
into. Get the work onto the right branch **before** you write code: pick up the branch it is already
in flight on, or open a new one.

There are two other places for the work, and neither is chosen unasked:

- **The default branch itself**, when the user asks for the work there (§3).
- **A worktree**, opened by a concurrency plugin: when the user asks for one, when a conductor runs
  the work as a lane, or when the primary checkout is busy with other work (§3).

On a judgment call about place—which checkout, which branch—follow these steps over the repo's
contributor docs, which apply to the code and not to where the code lands.

## 0. The two seams

Choosing *what* to work on is outside these skills. Where a repo keeps a backlog—a roadmap file, GitHub
issues, Jira—a plugin for it answers three questions, and how it stores the answers does not matter
here:

1. **What is workable?** Open work, with its prerequisites already met. Sequencing between units of
   work is the backlog's data: it is known before any session exists, and whether the thing that
   gates this one is done is recorded only in the backlog.
2. **Where is this already in flight?** A pin resolving a unit of work to a branch (§2).
3. **Record it done**, in whatever form that backlog uses (`land-and-wrap` §2, or §3 on a fork).

With no backlog plugin at all, these skills still work: the user states the task, and the landing
commit is the record. What does **not** come from a backlog is **disjointness**—whether two units of
work touch the same files. No issue tracker records that; it is the other seam's data.

**The lease seam.** A checkout has room for one unit of work at a time. Where several sessions work one
repo at once, a concurrency plugin gives each one after the first a worktree, and leases every one
of them a lane, the session on a branch in the primary checkout included. Such a
plugin has a skill that opens and removes a worktree, called its worktree skill below, and it is
the only way these skills open one. Use the plugin to check whether this
lane's files are disjoint from every sibling's and to read the lease evidence a dead session leaves
behind (§2), and release the lease at session end, whether or not the work is finished. How the plugin stores leases does not matter here. A session working alone, or a repo with
no such plugin, skips every lease step, and these skills still work.

## 1. Locate the checkout

Call `mcp__session-skills__find_checkouts` up front. It fetches, then returns the values these
skills refer to by name:

- **the primary checkout**, `$MAIN`;
- **the default branch**, `$DEFAULT`, the repo's integration branch (main/master/…);
- **the base for a new branch**, `$BASE`: `origin/$DEFAULT`, or `$DEFAULT` by the rule below;
- **the session's directory**, then every worktree with its branch and the number of commits it has
  that `$BASE` lacks. The primary checkout is the first row, so that row has the branch it is on;
- **each branch in no worktree** that has commits `$BASE` lacks, where there are any;
- **the number of changed or untracked paths** in the primary checkout, where there are any.

`$WT` is the checkout the work is in and `$BRANCH` its branch: both are settled in §2 or §3. `$WT`
is `$MAIN` itself unless the work is in a worktree. Shell state does not persist between calls, so
write each of these out as a literal path or name in every later command.

**There is no local way to tell whether the checkout is current**, a clean working tree least of
all: another machine, or another session, may have pushed since anyone last fetched here. Branching
from a stale `$DEFAULT` bakes the staleness into the branch, where it surfaces at push time as a
rejected non-fast-forward, or never surfaces and the work merges clean on top of commits it was not
written against.
Fetching costs one round trip at the start of the session and removes both cases. A fetch that
fails, offline or behind an expired credential, leaves `$BASE` as stale as before and looks
identical to a clean one. The tool returns it as a `warning:` line: repeat it in the reply rather
than reporting the branch point as current.

**Commits held on the local default branch are the one case for branching from it.** Where a push
has not run yet (`land-and-wrap` §1's `confirm-push` mode), the local default branch stays ahead of
`origin/$DEFAULT` until the user pushes. A branch opened from `origin/$DEFAULT` then lacks the held
commits and cannot fast-forward back into the local default branch. So after the fetch, a local
default branch that includes all of `origin/$DEFAULT` is the base. One that is only behind is the
ordinary stale checkout, and `origin/$DEFAULT` stays the base. One that has diverged is returned as a
`warning:` line and left for the user: the new branch starts from `origin/$DEFAULT` without the
local commits, and say so in the reply. In `pr` mode or on a fork the local default branch should never be ahead, so say so
there too when it is, since those commits would be in the pull request.

**A file written for another machine to read**—a handoff list, a shared to-do, a status note—is
where this matters most, because a second machine is meant to edit it. Fetch
before editing one even when the edit is a single line on the default branch.

## 2. Resume before you branch

When the task refers to something specific—a unit of work, an item ID, "keep going on the parser"—
establish whether it **already has a branch** before you create one. Check all three tells; any one
of them means the work is already in flight, and its existing branch is *your* branch:

1. **A pin in the backlog** (§0)—a note tying that unit of work to one branch is the durable
   in-flight record, and it outlives every session that touched it.
2. **An existing branch named for it**, with commits the default branch doesn't have: in §1's
   worktree rows, or in its list of branches in no worktree. A branch that starts with the work's
   backlog ID and a hyphen, after any `claude/`, counts (`claude/r78-` for R78, `abc-123-` for
   ABC-123, §3). So does a worktree directory that starts that way, whatever its branch is named.
   A branch named for it that the primary checkout is on counts with no commits yet: another
   session may have opened it a moment ago.
3. **A live lease on it**, where the repo runs a concurrency plugin (§0's lease seam)—how to read
   the ledger is in that plugin; consult it now, before deciding. A lease with a worktree that still
   exists catches only a session that died mid-flight.

**The lease is not the trigger, and an empty ledger is no evidence the work is free.** A lease
covers a session, not the work: the ordinary handoff—wrap up cleanly, resume next session—leaves the
work in flight with no lease at all. Tell 1 or 2 is what fires then, and they are the only two tells
a repo with no concurrency plugin has.

`$BRANCH` is then that branch, and `$WT` depends on where it is checked out:

- **In a worktree**: `$WT` is that worktree's path from §1's list, and §5 applies there.
- **In the primary checkout already**: `$WT` is `$MAIN`.
- **In no worktree**: switch the primary checkout to it, `git -C "$MAIN" switch "$BRANCH"`, and
  `$WT` is `$MAIN`. Where the primary checkout is busy by §3's test, never switch it. With a
  concurrency plugin's worktree skill, open a worktree on this existing branch, never on a new one.
  Without one, stop and report, as in §3.

Skip §3, and read the branch's state before writing anything:
`git -C "$WT" log --oneline "$BASE..HEAD"` and `git -C "$WT" status` show what already landed and
what is half-done. Build on those commits; don't redo them, and don't reset or rewrite them without
saying why.

**Opening a new branch instead strands that branch's commits and silently restarts the work**—
fatally so when the plan pins the work to one branch.

## 3. Open a branch—new work only

Take the first of these that applies.

1. **The session's directory is a worktree other than the primary checkout.** The host opened it
   for this session: that directory is `$WT`, its branch is `$BRANCH`, and nothing is opened. §5
   has the rules for working there.
2. **The user asked for a worktree, or a conductor is running this work as a lane.** Run
   the concurrency plugin's worktree skill (§0). Where no skill that opens a worktree is among the
   available skills, tell the user that a worktree needs a concurrency plugin, and stop.
3. **The primary checkout is busy**: its row in §1's list has a branch other than `$DEFAULT`, or §1
   reports changed or untracked paths there. Another session may be working in it, and a switch would put
   that session's next edits on your branch. Never switch a busy checkout, stash its changes, or
   commit them. Where a concurrency plugin's worktree skill is among the available skills, run it,
   and say in one line that the work is in a worktree because the primary checkout was busy. Where
   none is, stop and report the branch and the paths that are there. The checkout is free once the user says
   that no session is using it, or says to go ahead.
4. **The user asked for the work on the default branch.** Nothing is opened: `$WT` is `$MAIN` and
   `$BRANCH` is `$DEFAULT`. This case needs the user's request in this conversation, and it is
   refused where work lands as a pull request (`land-and-wrap` §1: a fork, or `pr` mode): say so,
   and open a branch. Where `$BASE` is `origin/$DEFAULT`, bring the local branch up to it first:
   `git -C "$MAIN" merge --ff-only "origin/$DEFAULT"`.
5. **Otherwise, open a branch in the primary checkout**, and `$WT` is `$MAIN`:

   ```bash
   git -C "$MAIN" switch -c claude/<id>-<name> --no-track "$BASE"
   ```

   - `<name>` is a short descriptive slug for this work, two to four lowercase words joined by
     hyphens (`parser-cache`, `retitle-trigger`). NOT a generic activity word like `roadmap-lap`,
     which every session picks, so the user learns nothing from the name.
   - `<id>` is §0's backlog ID in lowercase where the work has one (`r78`, or a Jira key such as
     `abc-123`), for §2's tell 2. Leave it and its hyphen out otherwise.
   - git refuses a name that is taken. Add a numeric suffix and run it again.
   - `--no-track` leaves the new branch with no upstream until `git push -u` sets one, and §4's
     gone-upstream check covers it from then on.

**Name the branch for its destination when the work lands as a pull request**: on a fork, or in a
repo whose landing mode is `pr` (`land-and-wrap` §1). A pushed branch becomes a pull request's head,
and a PR head name is permanent and visible to everyone who reviews it. Open it under the target
project's convention in place of `claude/`. Absent a stated convention, use a short descriptive
slug, as in `add-jvm-target-flag`. In a repo you own, keep the backlog ID in front of the slug, as
in `r78-add-jvm-target-flag`, since the name is then the only place §2's tell 2 finds the ID. **The
name chosen then is final**: filing an issue afterwards is not a reason to renumber it to
`fix-issue-<N>`, which desyncs the branch from anything that recorded the name.
In `merge` mode the `claude/` branch name is fine, since the name never leaves this machine. A
branch without that prefix is not removed by §4's merged-branch reap. Once pushed, it is deleted by
§4's gone-upstream check after its PR merges. One that was never pushed stays until the user removes
it.

**A branch stays checked out in the primary checkout until its work lands.** `land-and-wrap`
switches the checkout back to `$DEFAULT` for the merge, and after a pull request is opened.
Unfinished work stays checked out there, so the next session for other work finds the checkout
busy.

## 4. Hygiene—prune only

Cheap, safe, and worth running whichever of §2 or §3 you came through. None of it has anything to
do with other sessions; a session working alone accumulates the same merged branches.

Call `mcp__session-skills__prune_branches`. It never removes a worktree. In order, it:

1. fetches `origin` with `--prune`, and reads the refs it will compare against;
2. runs `git worktree prune`, which only drops worktrees with a directory that is already gone;
3. deletes each `claude/` and `worktree-` branch merged into `$DEFAULT`, leaving any that is checked
   out, in the primary checkout or in a worktree. The merge is read with
   `git for-each-ref --merged`, and the delete is `git branch -D`, since `-d` checks against the
   primary checkout's HEAD, which may be another branch;
4. checks each branch with an upstream that is gone.

Step 4 is for a PR branch the host squashed or rebased on merge, which `--merged` misses, so those
pile up. Once the host deletes the remote copy, the local branch's upstream is gone. That alone is no
proof of a merge: a declined PR with its branch deleted looks the same. So a branch is deleted only
when merging it into `origin/$DEFAULT` now would change nothing (`git merge-tree`, git 2.43+). The
same merge is then taken from each of the branch's commits, so that what the branch changed after
that commit is on `origin/$DEFAULT` too: a commit made after the host's merge that only undoes
part of it leaves the first merge with nothing to change. A merge commit whose tree differs from
the automatic merge of its parents is checked from that commit too, since a change made in the
merge itself is in no other commit. The repo's merge drivers are not run. Any check that fails
leaves the branch in place, and the line reads
`kept: <branch> (upstream gone, check failed: <git's message>)`, with `exit <code>` for the message
where git printed none, as when it crashed. A git before 2.41 fails that way on the `--attr-source`
option the merge is run with, and 2.41 and 2.42 have a crash on that option, fixed in 2.43. Step 4
checks nothing after a fetch that failed, where a merge driver is set in `.git/info/attributes`,
which git has no switch to turn off, or where the tree of `origin/$DEFAULT` or the empty tree cannot
be read: the result then has a `warning:` line to repeat in the reply.

`$DEFAULT` is read from `origin/HEAD`. The tools set it from the remote only where it is not the
name of a branch `origin` has, so one pointed at another branch on purpose is left alone. A default
branch the host renamed is found once step 1 has pruned the old remote-tracking ref. Where the host
made another branch the default and the old one is still there, `origin/HEAD` stays on the old one
and step 4 checks against it, until `git remote set-head origin --auto` is run. `main` is the guess
only where there is no `origin/HEAD`. Where a ref or the `origin` remote cannot be read, the tool
returns `check failed: <git's message>` and nothing is pruned, and an `origin/HEAD` that is a commit
and could not be set from the remote is an error with the command to set it: repeat either in the
reply and stop there.

The result has one line per branch: `deleted:`, `kept:`, `merged, still checked out:`, or `left:`
with git's reason where a deletion was refused.

A merge commit, a rebase merge, and a squash merge all pass. A declined PR, a squash the reviewer
edited, and a branch with a change committed since the merge print `kept`. List those in the wrap-up
and leave them. `merged, still checked out` is printed only for a branch with a gone upstream. A
merged `claude/` or `worktree-` branch that is checked out is skipped with no line. So after a
merge, call the tool once the branch is checked out nowhere: with the primary checkout back on
`$DEFAULT` (`land-and-wrap` §2), or with the worktree removed by the concurrency
plugin's worktree skill. List any `merged, still checked out` branch that is not yours in the
wrap-up.

**Never remove a sibling session's worktree.** A live session between tasks looks the same as an
abandoned one, and removing its directory kills it mid-flight.

## 5. When the work is in a worktree

This section applies where `$WT` is not `$MAIN`: the host opened a worktree for the session, or a
concurrency plugin opened one for the lane.

**Translate every context-supplied `<repo-root>/…` path to `$WT/…`** before any file read or edit.
A git status summary the host injects, memories, and doc links all contain the bare repo-root path,
and taking it literally silently lands edits on the default branch in the primary checkout. Reserve
`$MAIN` for files that live only there and for the final merge. After your first edit, confirm it
shows in `git -C "$WT" status` and NOT in `git -C "$MAIN" status`.

**Files that live only in the primary checkout.** An untracked backlog file, a local-only notes
directory, and any shared ledger a plugin keeps there never propagate to a worktree—that is the
design, one shared copy
rather than per-worktree forks of it. A worktree-guard hook, where the environment has one, blocks
file-edit tools against the primary checkout while a worktree session is active; that block is meant
for source files, not for these. Don't relocate the file to satisfy the guard. Make the edit
with the `mcp__session-skills__edit_primary_file` tool instead, passing the file's absolute path, the
passage to replace, and its replacement, or an empty passage to append. A passage that has drifted
or occurs twice is an error and nothing is written. Never write the whole file back from a copy read
earlier: another session's edit made in between is lost.

**Write durable notes to the primary checkout, never into the worktree.** `git worktree remove`
deletes a worktree's untracked files without a warning, and the loss shows up only when a later
session follows a reference to a note that is gone. Write a note to the repo's local-only notes
directory in `$MAIN` by its absolute path, unless the worktree has a link to that directory,
as one opened by a concurrency plugin may.

## Then what

You are on the right branch with `$MAIN`, `$WT`, `$BRANCH`, and `$DEFAULT` in hand. Two skills take
it from here, and neither is required to start:

- **the concurrency plugin filling §0's lease seam**—where one is installed, claim a lane and
  write its lease with the paths this work will touch, before writing code, whether the branch is
  in the primary checkout or in a worktree that plugin opened.
- **`land-and-wrap`**—when the work is committed and ready to leave the branch, and at the end of
  any session, finished or not.
