---
name: work-in-worktree
description: >-
  Open a git worktree for a unit of work, for sessions that run side by side in
  one repo, and remove it once the work has landed. A branch in the primary
  checkout is the default place for work (work-on-a-branch, in session-skills),
  and a worktree is opened only when the user asks for one, when a conductor
  runs the work as a lane, or when the primary checkout is busy with another
  unit's branch or with changed or untracked files. Includes the naming rules, what the
  open_worktree tool sets up in the new worktree, and the check before a
  worktree is removed. Trigger on "in a worktree", "in parallel", "start on
  this while the other session runs", when work-on-a-branch finds the primary
  checkout busy, and before removing a worktree. NOT for the fetch, the resume
  check, or the branch prune (that's work-on-a-branch), NOT for the claim ledger
  (that's claim-a-lane, which runs next), and NOT for landing (that's
  land-and-wrap).
---

# Work in a worktree

Only one unit of work is in a checkout at a time. A second session in the same repo needs a checkout
of its own, and that is a git worktree: a second working directory on its own branch, sharing the
repo's history.

**This skill requires `work-on-a-branch`, in `session-skills`**, and runs from its §3: that skill
fetches, locates `$MAIN`, `$DEFAULT`, and `$BASE`, and checks whether the work is already in flight
on a branch or in a worktree. **If it is not among the available skills, stop and tell the user to
install `session-skills`.** Work that is already in flight is resumed on its branch, by that
skill's §2, and no second branch is opened for it.

## 1. When a worktree is opened

Only in these three cases. In any other, the work goes on a branch in the primary checkout.

- **The user asked for one**: "in a worktree", "in parallel", "while the other session runs".
- **A conductor is running the work as a lane** (`conduct-a-pipeline`).
- **The primary checkout is busy**, by `work-on-a-branch` §3's test: it is on a branch other than
  `$DEFAULT`, or it has changed or untracked paths. Say in one line that the work is in a worktree for
  that reason.

## 2. Open it

Call `mcp__parallel-session-skills__open_worktree`, and never edit under `$MAIN`:

- `name`: a short descriptive slug for this work, two to four lowercase words (`parser-cache`,
  `retitle-trigger`). NOT a generic activity word like `roadmap-lap`, which every session picks, so
  siblings collide and the user learns nothing from the name.
- `id`: the work's backlog ID where it has one (`R78`, or a Jira key such as `ABC-123`), for
  `work-on-a-branch` §2's tell 2. Omit it otherwise.
- `base`: `$BASE`, exactly as the `base for a new branch` line of
  `mcp__session-skills__find_checkouts` has it. The tool does not fetch, so call `find_checkouts`
  first where this session has not.
- `notes`: the repo's local-only notes directory, where it is not named `notes.local`.

**For work already in flight on a branch that no worktree has**, pass `branch` with that branch's
name in place of `name`, `id`, and `base`. The worktree is opened on the existing branch, with its
commits. A new branch from `$BASE` would leave them out and restart the work.

The tool opens `$MAIN/.claude/worktrees/<id>-<name>` on a new branch `claude/<id>-<name>` with no
upstream. Those are the directory and the branch prefix Claude Code uses. A name a sibling already
took gets a numeric suffix. `$WT` and `$BRANCH` are the `worktree:` and `branch:` lines returned,
which may differ from the name passed.

Three more things are set up in the new worktree, and each failure is returned as a `warning:` line
to repeat in the reply:

- **LFS files are pulled where `filter=lfs` is set in the root `.gitattributes`.** Claude Code runs
  git with `GIT_LFS_SKIP_SMUDGE=1`, so `git worktree add` leaves pointer files, and the tool then
  runs `git lfs pull` in the new worktree.
- **The primary checkout's `permissions.ask` rules are copied** to the worktree's
  `.claude/settings.local.json`. On Windows a session started in a worktree reads only that file,
  and the rules `session-skills` writes for a push or a post are among them.
- **The local-only notes directory is linked into the worktree**, as a junction on Windows and a
  symbolic link elsewhere, so existing write paths land in `$MAIN`. Nothing is linked where that
  directory is absent. Where the link could not be made, write notes to the directory in `$MAIN` by
  its absolute path. **An exclude pattern with a trailing slash does not match the link**:
  `/notes.local/` matches only a directory, so the link shows as untracked in every new worktree.
  Write the pattern as `/notes.local`.

**Rename the branch now when the work lands as a pull request**, by `work-on-a-branch` §3's naming
rule, before anything records the `claude/` name: `git -C "$WT" branch -m add-jvm-target-flag`. The
backlog ID stays in the worktree directory's name, which is where `work-on-a-branch` §2's tell 2
finds it while the PR is open.

Working inside the worktree follows `work-on-a-branch` §5: translate every repo-root path to
`$WT`, edit a file that is only in the primary checkout with
`mcp__session-skills__edit_primary_file`, and keep durable notes in `$MAIN`.

**Then run `claim-a-lane`**, before writing code.

## 3. Remove it

A worktree stays until its work has landed: after the merge in `merge` mode, and after the PR has
merged in `pr` mode or on a fork, since review fixes go on the same branch (`land-and-wrap` §2).

**Remove only the worktree this session's work was in**: one it opened, resumed the work in
(`work-on-a-branch` §2), or was started in by the host. Never a sibling's, not even a merged and
clean one. A live
session between tasks looks identical to an abandoned one, and removing its directory kills it
mid-flight. Leftovers are harmless clutter that the next prune reaps; when in doubt, leave it.

**Before removing your own worktree, release its claim** (`claim-a-lane`), then **list its
untracked files** and move anything real to `$MAIN` first. They are the `??` lines of this command;
disregard build output such as `build/`, `.gradle/`, and `.kotlin/`:

```bash
git -C "$WT" status --porcelain -uall
```

Then call `mcp__parallel-session-skills__remove_worktree`, passing `$WT` as `path`. The tool runs
`git worktree remove` from the primary checkout and, on Windows where the directory is left on
disk with the notes junction inside, deletes the directory. The delete does not follow the
junction, so the notes in `$MAIN` are untouched. A retry on a path already unregistered is a
no-op. Where `git worktree remove` exits 255 with `Permission denied`, a process is still sitting
in the directory; close that process and call the tool again. A session started inside the worktree
removes it the same way, but a shell left sitting in a removed directory fails on its next call and
restarts in the home directory.

Then call `mcp__session-skills__prune_branches`, which deletes the merged branch now that it is
checked out nowhere. Do not run `git branch -d` in its place.
