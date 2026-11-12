---
name: execute-roadmap
description: >-
  Work through THIS repo's roadmap unattended: derive the ordered candidate list
  from the roadmap, hand it to parallel-session-skills' conduct-a-pipeline, and
  record each finished item back into the roadmap and its changelog. Trigger on "execute
  the roadmap", "roadmap autopilot", "burn down the roadmap", or any unattended
  multi-item run. Optional args: cap, max-items, lane hint. NOT for a single item,
  and NOT for resuming one item already in flight and partially built (both are
  next-roadmap-item); not for reading or editing the roadmap by hand, and not for
  the conductor loop itself (that's conduct-a-pipeline).
---

# Execute roadmap—the roadmap as a candidate source

This skill is the roadmap half of an unattended run. The conductor loop—the in-flight cap, the fill
loop, the watchdog, processing each completion, retries and flags, the build gate, and the stop
conditions—lives in `parallel-session-skills`' `conduct-a-pipeline`. Run that skill; this one
supplies the two inputs it takes from the backlog and consumes its output.

It requires both `session-skills` and `parallel-session-skills` installed—**check for both by name,
and stop if either is missing**. A run that finds `conduct-a-pipeline` but not `work-on-a-branch`
gets all the way to opening a worktree with no base to open it from, once per lane, unattended.
Neither absence fails loudly on its own. Per-item mechanics are
inherited the same way: [`next-roadmap-item`](../next-roadmap-item/SKILL.md) for finding the plan of
record (its §1) and the selection gates (its §3), `work-in-worktree` for each lane's worktree, `claim-a-lane`
for the ledger, `land-and-wrap` for landing.

## 0. Arguments

`/execute-roadmap [cap] [max-items] [lane hint]`—all optional. **cap** and **max-items** are
`conduct-a-pipeline` §0's, passed straight through. **lane hint** = an R-number or keyword biasing
candidate order, with the same non-override semantics as next-roadmap-item's hint (its §3): it
reorders candidates that already pass the gates and never relaxes one.

## 1. Before the pipeline starts

Find the plan of record (next-roadmap-item §1). A repo with no roadmap at all runs its §7 bootstrap
first—that interview is allowed here, since a repo's first roadmap run is inherently attended—and if
the fresh roadmap has no items, stop without starting a pipeline.

On a fork, the roadmap header's **House style block** is the style guide `conduct-a-pipeline` §2
requires in every build brief. Paste it verbatim; the style is not applied when the brief has only
a pointer to it.

## 2. Deriving candidates

Per `conduct-a-pipeline` §2, candidates are re-derived after every completion from the backlog's
ordered workable list. From the roadmap that is:

- **Open items only**—the active burndown. Parked, deferred, and declined items live in the
  `ROADMAP-PARKED` / `ROADMAP-DECLINED` variants and are never candidates.
- **Ungated**—an item whose stated prerequisite hasn't landed is not workable yet. Sequencing is the
  roadmap's data and is recorded nowhere else.
- **Not user-present**—on a fork, items the roadmap header flags as requiring the user (upstream
  outreach, packaging) are never claimable unattended. Skip them; they are the user's to run.
- **In roadmap order**, priority-descending, so fills take the topmost eligible items first. Order
  is not encoded in the `Rn` IDs.

Everything else the conductor filters on—claimed, not disjoint, already in flight, flagged or staged
this run—is the session layer's and needs nothing from here.

The roadmap's **pin** is `work-on-a-branch` §2's tell 1: a branch or worktree recorded in an item's
entry is the durable in-flight record, and it is why an unclaimed item is not automatically free. A
pin for a branch that `work-on-a-branch` §4 reports as merged (or whose content is already on
`origin/$DEFAULT`) marks the item done rather than in flight: delete it, append its done-record to `$HISTORY`
(`MERGED-UPSTREAM` on a fork), and remove the worktree if this run created it (`next-roadmap-item`
§2 has the same rule).

## 3. Recording an item done

The conductor calls back here from its §2a, §2b, or §2c once a unit is green. In roadmap form:

The roadmap is forward-only either way: **delete the item once its work has merged**, never migrate
it to a done-list, never annotate it "landed". Delete it with next-roadmap-item §6's tool, which
stops at the next heading: other lanes add items while this one runs. An item that turned out
parked or declined moves to the parked or declined file instead, created on first need. What varies
is where the done-record goes, and that follows **the plan's location** (next-roadmap-item §1), plus
the `pr` exception below:

- **A tracked roadmap**: git history is the done-record—the deletion itself. This edit is the final
  fresh commit on the rebased tip, per `conduct-a-pipeline` §2a or §2b—minimal and localized, since
  every other lane is editing the same file.
- **A local-only roadmap** (every fork, and any owned repo keeping its plan off the record): the
  files are untracked and live only in the primary checkout, so there is no commit to make—delete
  the item and **append its done-record to the changelog** through `work-on-a-branch` §5's
  primary-checkout edit mechanics, once the unit passes the build gate. On a fork the entry includes
  a status keyword (`BUILT-LOCAL` / `DRAFTED` / `FILED` / `PR-READY` / `MERGED-UPSTREAM`, per
  next-roadmap-item §6). The changelog records the reasoning behind each item: capture what commit
  messages won't.

**In `pr` mode** (`conduct-a-pipeline` §2b) the item stays in the roadmap until its PR merges, so a
declined PR leaves it open (next-roadmap-item §6). On a tracked roadmap the deletion commit goes in
the PR, so the item still reads as open on the default branch with no pin attached; the in-flight
tell there is the item's worktree, named for its ID (`conduct-a-pipeline` §2's Fill paragraph), for as
long as it exists. On a local-only roadmap, append the changelog entry now under `PR-READY`, or
`FILED` where the conductor opened the PR, and pin the item to its branch in place of deleting it.
The pin is `work-on-a-branch` §2's tell 1, so no later run re-picks the item, and the same merged-pin
rule as §2 above clears it once the branch merges.

In every reply, the per-completion log line and the wrap-up included, an item is its ID with a few
words of its heading—"R12, the parser cache"—and never a bare ID. The user is not reading the
roadmap beside the conversation.

## 4. Give the session a title

An unattended run covers several items, so the per-item title of `next-roadmap-item` §4 doesn't
apply—**give the session one title at the end of the run**, the way `session-skills`' session rules
specify. Those rules load with the first prompt and state the one way this session sets its title.

The title is always the literal prefix `Execute Roadmap: `, then a short phrase summarizing the items
that landed, **spelled out with no abbreviations**—`Execute Roadmap: Claim ledger and
worktree prune`. Summarize what the run did, not how many items it took: state the two or three that
account for most of the run, and where the items share a theme, state the theme instead. Items
flagged or retried without landing don't enter the title.
