---
name: work-in-worktree
description: >-
  Get a unit of work into the right git worktree before touching code: fetch so
  the branch point is current rather than whatever the checkout was left at,
  locate the primary checkout and your own worktree, adopt the worktree the work
  is already in flight on instead of opening a second one, and open a fresh
  worktree and branch when it isn't. Includes the rule that costs the most when
  it is missed—a repo-root path handed over in context means the primary
  checkout, so taking it literally lands the edit on the default branch—plus
  how to edit a file that lives only there, the prune that keeps stale worktrees
  and merged branches from piling up, squash- and rebase-merged PR branches
  included, and the three-question seam a backlog
  plugin fills. Trigger before creating a worktree or branch for a unit
  of work, when picking up work that may already be in flight, before editing a
  file another machine also edits, and on "start on this in a worktree" or "am
  I starting from a stale checkout". NOT for keeping several sessions off each
  other's files—that's a concurrency plugin's lane claim, where one is installed—NOT for
  choosing what to work on (that's the repo's backlog), and NOT for finishing
  and landing it (that's land-and-wrap).
---

# Work in a worktree

You work in your own git worktree, never in the checkout the repo was cloned into. Get the work into
the right one **before** you write code: adopt the worktree it is already in flight on, or open a
fresh one.

On a judgment call about place—which tree, which branch, whose worktree to touch—follow these steps
over the repo's contributor docs, which apply to the code and not to where the code lands.

**When other sessions are working the same repo at once**, this is half the job: a concurrency
plugin (§0's lease seam) adds the shared lease that keeps two lanes off the same files. Nothing here
needs it, and a session working alone skips it.

## 0. The two seams

These skills don't decide *what* to work on. Where a repo keeps a backlog—a roadmap file, GitHub
issues, Jira—a plugin for it answers three questions, and how it stores the answers does not matter
here:

1. **What is workable?** Open work, with its prerequisites already met. Sequencing between units of
   work is the backlog's data: it is known before any session exists, and whether the thing that
   gates this one is done is recorded only in the backlog.
2. **Where is this already in flight?** A pin resolving a unit of work to a branch or worktree (§2).
3. **Record it done**, in whatever form that backlog uses (`land-and-wrap` §2, or §3 on a fork).

With no backlog plugin at all, these skills still work: the user states the task, and the landing
commit is the record. What does **not** come from a backlog is **disjointness**—whether two lanes
touch the same files. No issue tracker records that; it is the other seam's data.

**The lease seam.** Where several sessions work one repo at once, a concurrency plugin leases each
session a lane. Use it to check whether this lane's files are disjoint from every sibling's and to
read the lease evidence a dead session leaves behind (§2), and release the lease at session end,
finished or not—a lease covers the session, not the work. How the plugin stores leases does not
matter here. A session working alone, or a repo with no such plugin, skips every lease step, and
these skills still work.

## 1. Locate the two checkouts

A repo has one main (non-worktree) checkout; you **work in your own worktree**. Call
`mcp__session-skills__find_checkouts` up front. It fetches, then returns the values these skills
refer to by name:

- **the primary checkout**, `$MAIN`;
- **the default branch**, `$DEFAULT`, the repo's integration branch (main/master/…);
- **the base for a new branch**, `$BASE`: `origin/$DEFAULT`, or `$DEFAULT` by the rule below;
- **the session's directory**, then every worktree with its branch and the number of commits it has
  that `$BASE` lacks, the primary checkout first.

`$WT` is your own worktree and `$BRANCH` its branch: one from that list (§2), or the one opened in
§3. Shell state does not persist between calls, so write each of these out as a literal path or name
in every later command.

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
where this bites hardest, because a second machine editing it is the purpose of the file. Fetch
before editing one even when no worktree is involved and the edit is a single line.

## 2. Resume before you branch

When the task refers to something specific—a unit of work, an item ID, "keep going on the parser"—
establish whether it **already has a branch** before you create one. Check all three tells; any one
of them means the work is already in flight, and its existing worktree is *your* worktree:

1. **A pin in the backlog** (§0)—a note tying that unit of work to one branch or worktree is the
   durable in-flight record, and it outlives every session that touched it.
2. **An existing worktree or branch named for it** (§1's worktree list), with commits the
   default branch doesn't have. A worktree directory starting with the work's backlog ID and a
   hyphen counts (`r78-` for R78, `abc-123-` for ABC-123, §3), whatever its branch is named.
3. **A live lease on it**, where the repo runs a concurrency plugin (§0's lease seam)—how to read
   the ledger is in that plugin; consult it now, before deciding. A lease with a worktree that still
   exists catches only a session that died mid-flight.

**The lease is not the trigger, and an empty ledger is no evidence the work is free.** A lease
covers a session, not the work: the ordinary handoff—wrap up cleanly, resume next session—leaves the
work in flight with no lease at all. Tell 1 or 2 is what fires then, and they are the only two tells
a repo with no concurrency plugin has.

`$WT` is then that worktree's path from §1's list and `$BRANCH` its checked-out branch. Skip §3, and
read the branch's state before writing anything: `git -C "$WT" log --oneline "$BASE..HEAD"` and
`git -C "$WT" status` show what already landed and what is half-done. Build on those commits; don't redo them,
and don't reset or rewrite them without saying why.

**Opening a fresh worktree instead strands that branch's commits and silently restarts the work**—
fatally so when the plan pins the work to one branch.

## 3. Open your own worktree—new lanes only

Where §1's session directory is already a worktree other than the primary checkout, the host opened
it for this session: that directory is `$WT`, and nothing is opened. In the primary checkout, call
`mcp__session-skills__open_worktree` now, and never edit under `$MAIN`:

- `name`: a short descriptive slug for this work, two to four lowercase words (`parser-cache`,
  `retitle-trigger`). NOT a generic activity word like `roadmap-lap`, which every session picks, so
  siblings collide and the user learns nothing from the name.
- `id`: §0's backlog ID where the work has one (`R78`, or a Jira key such as `ABC-123`), for §2's
  tell 2. Omit it otherwise.
- `notes`: the repo's local-only notes directory, where it is not named `notes.local`.

The tool fetches, takes `$BASE` by §1's rule, and opens `$MAIN/.claude/worktrees/<id>-<name>` on a new
branch `claude/<id>-<name>` with no upstream. Those are the directory and the branch prefix Claude
Code uses. A name a sibling already took gets a numeric suffix. `$WT` and `$BRANCH` are the
`worktree:` and `branch:` lines returned, which may differ from the name passed.

**LFS files are pulled where `filter=lfs` is set in the root `.gitattributes`.** Claude Code runs git
with `GIT_LFS_SKIP_SMUDGE=1`, so `git worktree add` leaves pointer files, and the tool then runs
`git lfs pull` in the new worktree. A pull that fails is returned as a warning.

**`--no-track` leaves the new branch with no upstream** until `git push -u` sets one, and §4's
gone-upstream check covers it from then on.

**Prefix the name with the work's backlog ID** where it has one, keeping the slug as the suffix. In `pr` mode the branch is renamed, and where the backlog record is a tracked file the work
stays open with no pin until its PR merges, so while the PR is open the ID appears only in the
worktree directory, for §2's tell 2.

**Name the branch for its destination when the work lands as a pull request**: on a fork, or in a
repo whose landing mode is `pr` (`land-and-wrap` §1). A pushed branch becomes a pull request's head,
and a PR head name is permanent and visible to everyone who reviews it. Rename the `claude/` branch
to the target project's convention now, before anything records it—`git -C "$WT" branch -m
add-jvm-target-flag`. Absent a stated convention, a short descriptive slug. **The name
chosen then is final**: filing an issue afterwards is not a reason to renumber it to
`fix-issue-<N>`, which desyncs the branch from its worktree directory and from anything else that
recorded the name.
In `merge` mode the `claude/` branch name is fine, since the name never leaves this machine. A
renamed branch is not removed by §4's merged-branch reap. Once pushed, it is deleted by §4's gone-upstream
check after its PR merges. A branch that was never pushed stays until the user removes it.

**Translate every context-supplied `<repo-root>/…` path to `$WT/…`** before any file read or edit.
A git status summary the host injects, memories, and doc links all contain the bare repo-root path,
and taking it literally silently lands edits on the default branch in the primary checkout. Reserve
`$MAIN` for files that live only there and for the final merge. After your first edit, confirm it
shows in `git -C "$WT" status` and NOT in `git -C "$MAIN" status`.

**Files that live only in the primary checkout.** An untracked backlog file, a local-only notes
directory, and any shared ledger a plugin keeps there never propagate to a worktree—that is the
design, one shared copy
rather than per-worktree forks of it. A worktree-guard hook, where the environment has one, blocks
file-edit tools against the primary checkout while a worktree session is active; that is right for
source files and wrong for this family. Don't relocate the file to satisfy the guard. Make the edit
with the `mcp__session-skills__edit_primary_file` tool instead, passing the file's absolute path, the
passage to replace, and its replacement, or an empty passage to append. A passage that has drifted
or occurs twice is an error and nothing is written. Never write the whole file back from a copy read
earlier: another session's edit made in between is lost.

**Write durable notes to the primary checkout, never into the worktree.** `git worktree remove`
deletes a worktree's untracked files without a warning, and the loss shows up only when a later
session follows a reference to a note that is gone. `open_worktree` links a local-only notes
directory into the new worktree, as a junction on Windows and a symbolic link elsewhere, so existing
write paths land in `$MAIN`. Nothing is linked where that directory is absent. A link that could not
be made is returned as a `warning:` line, and a worktree the host opened has none: in both cases
write notes to the directory in `$MAIN` by its absolute path. **An
exclude pattern with a trailing slash does not match the link**: `/notes.local/` matches only
a directory, so the link shows as untracked in every new worktree. Write the pattern as
`/notes.local`.

## 4. Hygiene—prune only

Cheap, safe, and worth running whichever of §2 or §3 you came through. None of it has anything to
do with other sessions; a session working alone accumulates the same stale worktree registrations
and merged branches.

Call `mcp__session-skills__prune_branches`. It never removes a worktree. In order, it:

1. fetches `origin` with `--prune`, and reads the refs it will compare against;
2. runs `git worktree prune`, which only drops worktrees with a directory that is already gone;
3. deletes each `claude/` and `worktree-` branch merged into `$DEFAULT`, leaving any that is checked
   out in a worktree. The merge is read with `git for-each-ref --merged`, and the delete is
   `git branch -D`, since `-d` checks against the primary checkout's HEAD, which may be another
   branch;
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
merged `claude/` or `worktree-` branch that is checked out is skipped with no line, so after a
merge, remove your own worktree by the rules below, then call the tool. List any
`merged, still checked out` branch that is not yours in the wrap-up.

**Never `git worktree remove` a worktree you didn't create.** A live session between tasks looks
identical to an abandoned one, and removing its directory kills it mid-flight. Leftovers are
harmless clutter the next `prune` reaps; when in doubt, leave it.

**Before removing your own worktree, list its untracked files** and move anything real to `$MAIN`
first. They are the `??` lines of this command; disregard build output such as `build/`, `.gradle/`,
and `.kotlin/`:

```bash
git -C "$WT" status --porcelain -uall
```

Then remove it with `mcp__session-skills__remove_worktree`, passing `$WT` as `path`. The tool runs
`git worktree remove` from the primary checkout and, on Windows where the directory is left on
disk with the notes junction inside, deletes the directory. The delete does not follow the
junction, so the notes in `$MAIN` are untouched. A retry on a path already unregistered is a
no-op. Where `git worktree remove` exits 255 with `Permission denied`, a process is still sitting
in the directory; close that process and call the tool again.

A concurrency plugin adds its own hygiene on top of this (§0's lease seam).

## Then what

You are in the right tree with `$MAIN`, `$WT`, `$BRANCH`, and `$DEFAULT` in hand. Two skills take it
from here, and neither is required to start:

- **the concurrency plugin filling §0's lease seam**—when other sessions are working this repo,
  claim a lane and write its lease with the paths this lane will touch, before writing code.
- **`land-and-wrap`**—when the work is committed and ready to leave the branch, and at the end of
  any session, finished or not.
