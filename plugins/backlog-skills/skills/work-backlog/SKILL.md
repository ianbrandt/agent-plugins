---
name: work-backlog
description: >-
  Work through THIS repo's backlog unattended: derive the ordered candidate list
  from the backlog, build and land each item, and record it back into the
  backlog. With parallel-session-skills installed, several items run at once
  through its conduct-a-pipeline; without it, one item at a time in the primary
  checkout. Trigger on "work the backlog", "execute the roadmap", "backlog
  autopilot", "burn down the backlog", or any unattended multi-item run.
  Optional args: cap, max-items, lane hint. NOT for a single item, and NOT for
  resuming one item already in flight and partially built (both are
  next-backlog-item); not for reading or editing the backlog by hand, and not
  for the conductor loop itself (that's conduct-a-pipeline).
---

# Work backlog—the backlog as a candidate source

This skill is the backlog half of an unattended run. It needs `session-skills`—**check for it by
name, and stop if it is missing**: neither absence fails loudly on its own. Per-item mechanics come
from [`next-backlog-item`](../next-backlog-item/SKILL.md): finding the backlog (its §1), the
selection gates (its §3), and recording an item done (its §6).

Then check for `parallel-session-skills` by name:

- **Installed**: run its `conduct-a-pipeline`, which runs several lanes at once. The conductor
  loop—the in-flight cap, the fill loop, the watchdog, processing each completion, retries and
  flags, the build gate, and the stop conditions—is that skill's. This one supplies the candidates
  (§2) and records each item (§3).
- **Not installed**: run the one-lane loop in §4.

## 0. Arguments

`/work-backlog [cap] [max-items] [lane hint]`, all optional. **cap** and **max-items** are
`conduct-a-pipeline` §0's, passed straight through; in the one-lane loop only **max-items** applies.
**lane hint** is an ID or keyword that reorders candidates that already pass the gates, as in
`next-backlog-item` §3, and never relaxes one.

## 1. Before the run starts

Call `mcp__backlog-skills__find_backlog`. A repo with no backlog runs `next-backlog-item` §7's
bootstrap first, since a repo's first run is attended anyway, and stops if the new backlog has no
items. **Stop and report** when the kind is `needs-migration`, `partial-migration`, or
`migration-pending`: a migration is attended work. In a repo with an `upstream` remote, also stop
when `find_backlog` lists a missing plan or a plan with no House style section.

Read the plan before selecting candidates, and again before every build brief. On a fork, the
plan's **House style** section is the style guide every build brief includes: paste it verbatim,
since a pointer to it is not followed.

## 2. Deriving candidates

Candidates are re-derived after every completion. Call `mcp__backlog-skills__list_items` with
`unattended: true`, and take the claimable items in the order returned, the topmost first. An item
is claimable when its gates are open, it has no item-level problem, it has no `Branch` field, no
branch or worktree named for its ID has commits the default branch lacks, and it has no
`Needs: user`.

Everything else the conductor filters on—claimed, not disjoint, flagged or staged this run—is the
session layer's.

An item is done when `work-on-a-branch` §4 reports the branch in its `Branch` field as merged:
close it with `close_item` (`MERGED-UPSTREAM` on a fork), and remove the worktree if this run
created it.

## 3. Recording an item done

The conductor calls back here from its §2a, §2b, or §2c once a unit is green, and the one-lane loop
does the same at its landing step. Record the item with `next-backlog-item` §6's tools:

- **A tracked backlog**: `close_item` in the lane's worktree, committed as the final commit on the
  rebased tip. Every other lane edits the same file, so nothing else in the file changes. After the
  merge is confirmed, `confirm_landed`.
- **A local-only backlog**: `close_item` with the done-record, after the unit passes the build gate.
  On a fork the record has a status (`BUILT-LOCAL`, `DRAFTED`, `FILED`, `PR-READY`, or
  `MERGED-UPSTREAM`). The changelog is where the reasoning behind each item goes: record what the
  commit messages won't.
- **In `pr` mode**, the item stays open until its PR merges. On a tracked backlog the `close_item`
  commit goes in the PR. On a local-only backlog, call `record_progress` with `PR-READY`, or
  `FILED` where the run opened the PR. It sets `Branch`, so no later run picks the item again, and
  the item is closed under §2's merged-branch rule once the branch merges.

An item that turned out parked or declined goes through `park_item` or `decline_item`.

In every reply, the per-completion log line and the wrap-up included, cite an item as `ID: Title`.

## 4. The one-lane loop

Without `parallel-session-skills`, items run one at a time in the primary checkout, under the
conductor's rules restated for one lane:

1. **The gate** is the repo's full build, read from its contributor docs, plus the item's `Check`
   field where it has one. Where no build command is found, stop and report before the first item.
2. **Pick** the topmost candidate from §2, less any item that failed or was staged earlier in this
   run. The loop never resumes an item: an item with a branch is not claimable.
3. **Build and land** it through `next-backlog-item`, with this landing order in place of
   `land-and-wrap`'s:
   1. rebase onto the default branch;
   2. on a tracked backlog, commit the `close_item` deletion;
   3. run the gate on the rebased tip, with `land-and-wrap`'s skip for a disjoint change turned off;
   4. on a local-only backlog, call `close_item`, or `record_progress` in `pr` mode;
   5. fast-forward or push, following `land-and-wrap`. In `confirm-push`, the default, the work is
      left as local commits and the push is offered at the wrap-up.

   A gate failure therefore leaves a local-only item open, with no done-record.
4. **A failed build or check is retried once.** A second failure flags the item, which is skipped
   for the rest of the run. Before the next pick, commit the flagged item's work, untracked files
   included, as a WIP commit on its branch, set its `Branch` field on a local-only backlog, and switch
   the primary checkout back to the default branch. If any of that fails, stop and report.
5. **Stop** when no candidate is left, at **max-items**, after three flagged items, or on a finding
   that invalidates the plan.

## 5. Give the session a title

An unattended run covers several items, so `next-backlog-item` §4's per-item title doesn't apply.
**Give the session one title at the end of the run**, the way `session-skills`' session rules
specify: the landed items' IDs first, as a range or a list, then a short phrase for what the run
did, spelled out with no abbreviations—`R144 to R149: Plugin README cleanup`. Where the items share a
theme, state the theme. Items flagged or retried without landing don't enter the title.
