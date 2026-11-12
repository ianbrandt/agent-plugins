---
name: claim-a-lane
description: >-
  Keep two or three sessions working one repo at once off each other's files,
  when they coordinate only through git: orient against the sibling sessions,
  run the hygiene pass that reaps dead claims without killing a live sibling,
  and write a claim recording which paths this lane will touch. Two
  lanes collide when their declared paths overlap, which is the one fact no
  issue tracker can supply. Includes the tie-break for two sessions that claim
  the same thing, and the rule that a claim leases a session rather than the
  work. Trigger once the work's branch is checked out, in a worktree or in the
  primary checkout, and before writing any code, when
  another session may be working the same repo, and on "claim a lane" or "am I
  colliding with another session". NOT for opening the worktree itself
  (that's work-in-worktree), NOT for the fetch or the resume check (that's
  work-on-a-branch, in session-skills), NOT for choosing what to
  work on (that's the repo's backlog), and NOT for finishing and landing it
  (that's land-and-wrap).
---

# Claim a lane

You are probably one of 2–3 sessions working this repo at once, one on a branch in the primary
checkout and each of the others in its own git worktree, coordinating **only** through git and a shared claim ledger. Nobody can see anyone else's context.
Claim a lane whose file-touch set is disjoint from every other session's **before** you write code.

On a judgment call about the lane itself—what to claim, whose worktree to touch—follow these steps
over the repo's contributor docs, which govern the code and not the coordination between sessions.

**This skill fills `work-on-a-branch` §0's lease seam**, and requires it. `work-on-a-branch`, in
`session-skills`, locates `$MAIN`, resumes the branch the work is already in flight on, and prunes
merged branches in its §4. **If it is not among the available skills, stop and tell the user to
install `session-skills`**—nothing here fails loudly without it, and no manifest enforces the
dependency.

**A lane is a checkout on the work's branch, and `$WT` is its path**: a worktree that
`work-in-worktree`, in this plugin, opened, or the primary checkout while it is on a branch other
than `$DEFAULT` (`work-on-a-branch` §3). A session on a branch in the primary checkout writes a
claim like any other, since a sibling in a worktree compares its `touches` only against the claims
in the ledger. The primary checkout on `$DEFAULT` is no lane, and the tools refuse it: work the
user asked for on the default branch itself has no claim.

**The ledger is read and written through three tools**, registered by this plugin's hooks module:
`mcp__parallel-session-skills__read_ledger`, `write_claim`, and `release_claim`. Each one finds the
primary checkout by itself, from any worktree, so no step here depends on a shell variable that may
be unset. **If the tools are not listed, stop and tell the user**: hooks modules are off in this
session (a Claude Code older than 2.1.286, a managed policy, or an untrusted workspace), and with
them the release at session end. Do not write claim files by hand in their place.

## 1. Orient against siblings

```bash
git worktree list                            # who's around (worktrees ≈ sessions)
git log --oneline -15 "$DEFAULT"             # what just landed; $DEFAULT is work-on-a-branch §1's
```

Then call `read_ledger`. Its result has the ledger's resolved path, then one line per live claim, or
`no claims`. Lines about claims it reaped, or did not, come before the path.

The ledger is a **live lease board, not a log**: entries are
`{"item","branch","started","session","touches"}`, deleted by their own session at *its* finish—which
is not the work's finish. **Empty is normal, and it does
not mean the repo is idle**; the tells that do settle that are in `work-on-a-branch` §2.

## 2. Reap dead claims

The worktree prune and the merged-branch reap are `work-on-a-branch` §4's—they have nothing to do
with siblings, and a session working alone needs them too.

**Never `git worktree remove` a sibling's worktree**, not even a merged-and-clean one. A live
session between tasks looks identical to an abandoned one, and removing its directory kills it
mid-flight. Leftovers are harmless clutter the next `prune` reaps; when in doubt, leave it.

**Dead claims are reaped by `read_ledger` on every call**, and each one is listed in its result as
`reaped dead claim: <file>`. While a checkout is on a detached HEAD, as one stopped in a
rebase is, its branch is in no worktree's entry, so no claim that parses is reaped and the result
has the line `a worktree is detached, so no claim that parses was reaped`. A claim is dead when no worktree has its branch checked out, read from
`git worktree list` after a `git worktree prune`. Merge state is not the test: the tip of a branch
just claimed equals the default branch, so by merge state a lane just claimed would look dead.
Neither is the `.claude/worktrees/` directory: a worktree made by hand can be anywhere. A claim file
that does not parse is left for a minute before it is reaped, since a sibling may be writing it.
Never delete a claim file by hand.

Also—**only when the ledger is empty**—reap leftover Workflow-agent worktrees (`agent-*` / `wf_*`
directories), confirming an unmerged branch's content actually landed before removing it: diff-apply
integration leaves a branch looking unmerged when its content is already on the default branch.

## 3. Write the claim—before writing any code

A claim written later does not prevent a collision. Call `write_claim` with:

- `worktree`: the absolute path of `$WT`, the checkout the work is in: the lane's own worktree, or
  the primary checkout for a branch there. The claim is filed under the branch checked out there,
  and the primary checkout on `$DEFAULT` is refused.
- `item`: what you claimed, as a short phrase, such as `parser aggregation core`.
- `touches`: the paths and globs this lane expects to edit, such as `["src/parser/**",
  "docs/parsing.md"]`.

The session's id is stamped on the claim, which is how it is released if the session ends without
wrapping. The result is the whole ledger after the write: read it to confirm no clash. Its last
line is the instruction to call `read_ledger` once more before the first edit, explained below.

**`touches` is what makes disjointness checkable instead of guessed.** Two lanes collide when any
path one expects to edit falls inside a glob the other declared—compare before claiming, and treat
an overlap as a collision even when the two units of work are unrelated. It is a declared intent,
not a measurement, so it will sometimes be wrong: **when the work spreads past what you declared,
rewrite the claim** with another `write_claim` before editing the new paths. A lane that can't
predict its paths declares the broadest glob it might reach rather than a narrow lie.

Two files are collision seams almost everywhere and are worth declaring even for a one-line edit: a
dependency manifest, and—where the backlog is a file in the repo—the backlog file itself. Keep edits to both minimal, localized, and last.

If another claim is for the **same work**, the **lexicographically smaller branch name keeps it**;
the other backs off and picks something else. Write-then-check leaves you blind to a claim written
after your check, so **call `read_ledger` once more right before starting the work**; a clash found
then resolves by the same rule. On a re-pick, prefer work no live claim sits near.

**Resuming work already in flight: the lane already exists—only the lease may be missing.** The
branch and its checkout are already correct, so rename nothing. A claim for the work you are resuming
is **yours**, and re-picking on it is the bug this path exists to prevent. Whether or not a claim
for the branch is still in the ledger, call `write_claim` for the **existing** checkout: a claim
left by an earlier session is replaced with one stamped with this session's id. `release_claim`
refuses a claim stamped by another session, so a lane resumed without this write keeps the earlier
session's claim past the wrap.

## Releasing it

Your claim is released at **session** end, finished or not: a claim is a lease on the session, not
on the work's progress. `land-and-wrap` §4 runs this step.

Call `release_claim` with `worktree` set to `$WT`, the path the claim was written for, **written
out literally**. Re-deriving it from the session's own directory returns the primary checkout in a
session launched from the repo root, whichever checkout the work is in. A claim stamped by another
session is refused: that is the result when a worktree session passes the primary checkout while
another session's branch is checked out there. A branch with no claim is an error too, so a
release that removed nothing is never reported as done. The result lists the claims that remain.

**After a landing from the primary checkout, pass the primary checkout's path all the same.** The
checkout is back on `$DEFAULT` by then (`land-and-wrap` §2) and the work's branch is in no
worktree, so the tool releases the claims of this session that have no worktree. A sibling's
`read_ledger` in between reaps that claim as dead, and the error `no claim of this session` then
means it is already gone.

Release before removing the worktree. A path that is no longer a worktree of the repo has no branch
to look up, whether its directory was deleted or something made it again after the removal. For
such a path the tool also releases the claims of this session that have no worktree. Both cases are
refused while any checkout is detached. `git worktree prune` is run first, so a directory deleted without
`git worktree remove` is no longer listed.

At session end the hooks module also releases every claim stamped with this session's id, for a
session that ends without wrapping. It is a safety net and no substitute for releasing at wrap,
which hands the lane back immediately rather than whenever the session eventually exits. A claim
stamped by an earlier session, on a lane this session resumed without calling `write_claim`, is not
covered by it.
