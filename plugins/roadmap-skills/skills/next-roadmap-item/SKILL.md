---
name: next-roadmap-item
description: >-
  Claim the next unclaimed, non-colliding item on THIS repo's roadmap and start
  building it. Finds the plan of record in either place it lives—tracked at the
  repo root, or untracked and local-only for an OSS project contributed to via a
  fork—and bootstraps one if the repo has none. Trigger on "tackle a roadmap
  item", "claim a task and get going", or starting work without colliding with
  the other sessions. Also resumes an item already in flight and partially
  built—more building on an in-flight item is this skill, which picks up that
  item's existing branch. An optional lane hint ("R1") only biases the pick.
  Also the way into a task the user states directly ("upgrade X", "fix Y") in a
  repo that has a roadmap: the task gets an item, written first on a local-only
  roadmap and on the item's branch on a tracked one, and this skill runs on
  that item's ID. NOT for reading, summarizing, or editing the roadmap, and NOT for the branch
  mechanics themselves (that's work-on-a-branch), a worktree or the claim ledger (that's
  work-in-worktree and claim-a-lane), or landing finished work (that's land-and-wrap).
---

# Next roadmap item—parallel-safe session cold-start

Pick one item off this repo's roadmap and build it, without colliding with the other sessions
working the same repo right now.

**In a reply, an item is its ID with a few words of its heading**—"R12, the parser cache"—and never
a bare ID. The user is not reading the roadmap beside the conversation, so they learn nothing from
`R12` alone. This holds for every item mentioned, including one filed in passing and one left open
in the wrap-up.

This skill is a **backlog plugin**: it fills the backlog seam `work-on-a-branch` §0 defines,
using a markdown roadmap in place of an issue tracker. What is workable (§3), where an item is
already in flight (§2), and how a landed item is recorded (§6). Everything else about the session
belongs to four skills this one calls rather than copies:

- **`work-on-a-branch`**—picking up or opening the item's branch, in the primary checkout by
  default, and the primary-checkout path rules.
- **`claim-a-lane`**—the shared claim ledger and sibling etiquette, where the repo runs one—and
  **`work-in-worktree`**, the worktree for an item worked beside another session. Both ship in
  `parallel-session-skills`.
- **`land-and-wrap`**—how finished work leaves its branch, and what every session does at its end.

**Take sequencing from the roadmap and disjointness from the claim ledger.** A gate ("R3 waits on
R2") is known before any session exists and is recorded only in the roadmap. Whether two items
collide on the same files is a fact about the working tree, and it is settled by the `touches` globs
in the claim ledger, not by reading item names.

## 1. Find the plan of record

Two places it can live, and the fork check comes first: an upstream project's `ROADMAP.md` must
never be mistaken for yours.

Call the `mcp__roadmap-skills__find_roadmap` tool. It reads the primary checkout from any worktree
and returns a `kind`, with absolute paths for `roadmap` and `history` where there are any. `$ROADMAP`
and `$HISTORY` below are those two paths.
A tracked roadmap is read at `$ROADMAP` and edited at the same repo-relative path under `$WT`, where
the edit is committed. Only a local-only roadmap is edited in the primary checkout.

- `local-only`: `ROADMAP.local.md` exists. `$HISTORY` is `ROADMAP-CHANGELOG.local.md` beside it.
- `tracked`: `ROADMAP.md` or `docs/roadmap.md` is tracked in a repo with no `upstream` remote. There
  is no `$HISTORY`, since git history is the done-record.
- `fork-without-roadmap`: an `upstream` remote and no shadow roadmap yet. See §7.
- `none`: no roadmap anywhere. See §7.

**Naming, at the repo root.** Tracked: `ROADMAP.md`, plus `ROADMAP-PARKED.md` and
`ROADMAP-DECLINED.md` as needed. Local-only: the same names suffixed `.local.md`—the never-commit
signal, and it keeps a shadow roadmap from colliding with an upstream project's real `ROADMAP.md`—plus
`ROADMAP-CHANGELOG.local.md`. Parked and declined files are created on first need, never as
empty stubs. Migrate a legacy `docs/roadmap.md` to the root in a grooming commit when the ledger is
empty.

**The done-record follows the plan's location; `pr` mode only delays it (§6).** A tracked roadmap
needs no changelog: the landing commit that deletes the item *is* the record. A local-only roadmap is
untracked, so it is not in git history and is recorded in `$HISTORY` instead.

Both files live **only in the primary checkout** when they are untracked, which is by design—one
shared plan, not per-worktree copies. `work-on-a-branch` §5 has the mechanics for editing a
primary-checkout file from a session in a worktree.

**This is not the same question as how work lands.** That is determined from the repo, as
described in `land-and-wrap` §1: fork-ness, the landing mode, and the per-clone push
and post modes. Work in a repo you own lands in its default branch even when the roadmap is
local-only.

## 2. Get onto the item's branch

Run **`work-on-a-branch`** now: locate `$MAIN`, then resume the item's in-flight branch or open a
new one. Where `parallel-session-skills` is installed, the branch is in a worktree by default
(`work-in-worktree` §1). Otherwise it is in the primary checkout unless that skill's §3 sends the
work to a worktree. If the skill is not among the available
skills, **stop and tell the user to install `session-skills`**—nothing below fails loudly without
it, so proceeding just edits the default branch in the primary checkout.

Whether this run is a resume is determined by `work-on-a-branch` §2's resume tells, and **tell 1 is
an item's own text in `$ROADMAP`**: a build rule pinning the item to one branch or worktree is the
durable in-flight record, outliving every session that touched it. **A pin for a branch that
`work-on-a-branch` §4 reports as merged (or whose content is already on `origin/$DEFAULT`) marks the
item done, not in flight**: delete it and append its done-record to `$HISTORY` (`MERGED-UPSTREAM` on
a fork) rather than resuming it.

Run `work-on-a-branch` §4's prune too. Then run **`claim-a-lane`**'s §1 and §2—orient against
siblings, reap dead claims—and come back here to pick. Writing the claim (its §3) happens after
the pick, not before, and **wherever the work is**: a session on a branch in the primary checkout
writes one too, filed under that branch, or a sibling in a worktree has nothing to compare its
`touches` against. `claim-a-lane`
ships in `parallel-session-skills`; where it isn't installed the repo has no ledger, so **say so in
one line** and skip every ledger step below. The pick then rests on the roadmap's gates alone.

## 3. Pick a disjoint, unclaimed item

Choose an **unclaimed** item that is **workable**—its gates met—and whose file-touch set is
**disjoint** from every live claim's `touches` globs (`claim-a-lane` §3). Write the paths you
expect to edit into your own claim; `$ROADMAP` itself is the seam every item eventually touches, so
declare it and keep the edit minimal, localized, and last.

- **Only the active burndown is pickable.** Items are claimable to-dos with stable `Rn` IDs
  (sub-items `Rn.m`); an ID is never reused and an item keeps it for life. Parked, deferred,
  declined, and out-of-scope work lives in the parked or declined file—don't go fishing there.
- **Gates are the part of the dependency graph recorded in the roadmap.** An item tagged as gated
  is not workable until its prerequisite lands—skip it, or claim the prerequisite instead. Tag new
  items the same way, stating the item that gates them, so a later session doesn't have to infer
  the edge from prose.
- **Prefer an independent slice**, and record the collision seam an item is known to touch so the
  next session can declare it in `touches` without re-deriving it. Disjointness applies within a
  lane too.
- **The roadmap is priority-ordered, top-down**, optionally in coarse bands (Now / Next / Later).
  Order is not encoded in `Rn` IDs, so R17 above R3 is normal. **Absent a lane hint, take the
  topmost item that passes these gates.** Insert new items at their priority position; end-of-band
  is fine.
  Wholesale reordering is grooming work for an empty ledger, never a rider on a landing.
- **Items the roadmap's header flags as requiring the user present**—typically upstream outreach and
  packaging—are **never claimable unattended**. Skip them.

**A lane hint (free text after the skill name—an R-number, sub-item, or keyword) reorders candidates
that already pass those gates; it never relaxes them.** Match it against item IDs and headings:

- unclaimed and disjoint → take it;
- claimed or colliding → prefer a *disjoint sub-item in the same lane*, else fall back to normal
  selection. Either way **say so out loud**: the hinted item, why it couldn't be honored, what you
  picked instead;
- matches nothing → note that briefly, then pick as if unhinted.

If everything worthwhile is claimed, don't force a collision: wait for a session to finish (its
claim disappears, or a commit lands), then pick. A hint doesn't change this.

**A task the user stated directly, with no item yet.** The item is new: the next free ID, at its
priority position, with the problem and the paths it touches. On a local-only roadmap, write it
before anything else. On a tracked roadmap, take the ID before §2 and write the item now, in the
copy under `$WT`, raise the `Highest ID used` line to the new ID in the same edit, and commit it
there: the item's branch is where a tracked roadmap is edited, and it was not open before §2. Then it is a hinted pick like any other, and the gates above still
apply to it. The same instruction is added to the first prompt by this plugin's hook, in every repo
that has a roadmap, because a session handed "upgrade X" does not otherwise reach this skill.

**The next free ID.** An ID is never reused. On a local-only roadmap, check the parked, declined,
and changelog files beside the roadmap: the changelog has the ID of every landed item.

A tracked roadmap has no changelog, and a landed item is deleted from it, so the highest ID ever
used is kept as one line in the roadmap's header:

```
Highest ID used: R127
```

An item written in another lane is committed only on that lane's branch, so the next free ID is one
more than the highest among that line, the roadmap, parked, and declined files, the branch and
worktree directory names (`claude/r78-...`, `r78-...`), and the items in live claims.

- **Raise the line in the commit that writes a new item**, to that item's ID. A sub-item does not
  change it.
- **The line only goes up.** A merge conflict on it is settled by taking the higher number.
- **Where the roadmap has no such line**, also read, this one time, the headings of the items that
  were deleted on the default branch, and add the line to the header in the commit that writes the
  new item:

  ```
  git -C "$MAIN" log -p --format= <default branch> -- <the roadmap's path in the repo> | grep -E '^-#+ R[0-9]+'
  ```

**Resuming an item already in flight.** The pick is already made—skip these gates entirely. A claim
on the item you are resuming is *yours*, not a collision, and re-picking on it is the bug
`claim-a-lane`'s resume path exists to prevent.

Then write the claim, per `claim-a-lane` §3—where the repo has a ledger at all.

## 4. Give the session a descriptive title

As soon as the claim lands and any tiebreaker re-pick settles, **title the session the way
`session-skills`' session rules specify**. Those rules load with the first prompt and include the one way
this session sets its title.

The title is always the claimed item's `Rn` ID, a colon, then a short noun phrase for the
deliverable, starting with a capital letter and **spelled out with no abbreviations**—`R1: Aggregation
core`, never the phrase alone and never the ID alone. A sub-item keeps its own `Rn.m`. The title
stays for the rest of the session unless the work turned out to be something else.

**A session that goes on to claim more items is titled again, with every ID first.** A run of
consecutive IDs is written as a range, and others are listed, then one phrase covers the work:
`R144 to R149: Plugin README cleanup`, `R3 and R7: Ledger reap`.
## 5. Emit the tier plan—never pause

Model and effort are the **user's controls**: **start building immediately, no pause, no
end-of-turn checkpoint.** The main loop stays at the settings the session launched with;
escalate by **delegation, not the session pickers**.

Immediately after the title, emit a one-line **tier plan** stating the stages **this item
has**, then execute it. Two decisions go into it, and they are independent:

- **How much verification the item needs.** The question: **would this repo's test suite catch this
  item going silently wrong?** A loud suite lets the implement stage run cheap and the verify run at
  High, or not at all. A silent failure mode—transform or rewrite machinery—puts the weight on
  design and adversarial-verify, at the Critical tier.
- **What runs each stage.** Inline in the main loop, a delegated agent, or a Workflow. A single
  roadmap item is usually a linear design → build → verify, which the main loop plus one or two
  agents handles with nothing to script. Reach for a **Workflow** when there is fan-out, a loop
  until some condition holds, or several units to drive deterministically. A mechanical lap—polish,
  a doc move, roadmap grooming—stays inline at launch settings: `Tier plan: inline.`

**State a model and an effort for every delegated stage, and pass both.** The `Agent` tool takes
`effort` from Claude Code 2.1.292 on, and a Workflow `agent()` takes it too.

Write the plan against the item in front of you. One derived from a real item reads like this:

`Tier plan: inline design and implementation (the trace is already settled), then one
adversarial-verify agent at Extra against the merge logic.`

The plan is a forecast, so restate each stage's tier in the message that launches it, and say so
when a planned stage turns out not to run.

`tier-model-and-effort` has the tiers and the per-stage override syntax; take each tier's model and
effort from it, or from the table in the session's rules, rather than from memory, since model names
age faster than the rules around them.

## 6. Build it, then land it

**Before the first edit, call `mcp__parallel-session-skills__read_ledger` once more**, where the
repo has a ledger. A claim written after yours is seen only then, and `claim-a-lane` §3 has the rule
for a clash.

Work **test-first per THIS repo's conventions**—a failing test first, then match the repo's
style. For a repo you own that means its `CLAUDE.md`, `CONTRIBUTING`, and design docs. For a fork it
means the **House style block** in `$ROADMAP`'s header, distilled from the project's `CONTRIBUTING`,
`.editorconfig`, and observed neighbors; **paste that block verbatim into every implementation-agent
brief**. When in doubt, match the neighboring file, not your habits.

**Orchestrate substantial items** with delegated agents—design → implement test-first → adversarial
review → re-verify—scaled to size. *This instruction is itself the opt-in, so the orchestration runs
even if the session never enabled `ultracode`*; it grants orchestration only, not extra effort. Keep
small items (a one-file tweak, a doc move) inline. Reach for the **Workflow tool** in the
cases listed in §5—fan-out, a loop until some condition holds, several units driven
deterministically—rather than as the default vehicle for a single item.

Then hand off to **`land-and-wrap`** for how the work leaves its branch and what the session does
at its end. Two things are left to this skill:

- **Bring the docs.** Finishing an item includes every piece of documentation it touches—the
  subsystem's design doc plus any user-facing surface.
- **Keep an item's notes in one directory, and clear it out when the item lands.** Probe scripts,
  run output, plan revisions, and review rounds for an item go in a directory named for its ID in
  the repo's local-only notes directory, such as `notes.local/R12/`, written in the primary
  checkout as described in `work-on-a-branch` §5. When the item lands, move each finding a later
  session needs into the design doc or the done-record, move a harness a later item will run again
  into the repo beside what it checks, and delete the directory. Keep the notes of a parked item,
  and any directory named in the text of an open or parked item.
- **Record the item done, forward-only.** On a tracked roadmap, **delete** the landed item in its
  own final commit; never migrate it to a done-list, never annotate it "landed". On a local-only
  roadmap, delete it too and **append a done-record to `$HISTORY`**, which is a *reasoning
  archive*: mechanism notes, corrections, refuted hypotheses, the local-to-upstream sha and number
  map, and findings a later session should not have to re-derive, under a status keyword
  (`BUILT-LOCAL` / `DRAFTED` / `FILED` / `PR-READY` / `MERGED-UPSTREAM`). Free-form append, no rigid
  schema. An item that turned out parked or declined moves to the parked or declined file instead.
  In `pr` mode (`land-and-wrap` §1) the item stays in the roadmap until its PR merges, so a declined
  PR leaves it open. On a tracked roadmap the deletion commit goes in the PR. On a local-only
  roadmap, append the done-record now under `PR-READY`, or `FILED` once the PR is open, and pin the
  item to its branch; the session that prunes the branch after the merge deletes the item.

- **Record what was found in passing.** A defect or a gap noticed while building this item, and
  outside it, becomes a new item with the next free ID (§3) at its priority position, never a fix
  smuggled into the one in hand. Raise it in the reply as well, since the user may want it
  discussed or deferred rather than queued.

**Delete a landed item with the `mcp__roadmap-skills__delete_item` tool**, passing the absolute
path of the roadmap and the item's ID: `$ROADMAP` in the primary checkout for a local-only roadmap, the
copy under `$WT` for a tracked one. The tool deletes from the item's
heading to the next heading of the same or a higher level, sub-items included, and returns the
headings it removed. Other sessions add items while this one builds, so the item below yours when
you picked is not necessarily the one below it now, and an untracked roadmap has no history to
restore from. A mention of the item elsewhere in the roadmap, such as a gate on another item, is
edited separately.

**A claim is released at session end even when the item isn't finished.** The unfinished item's
resume record is its branch, plus its worktree where it has one and its pin in `$ROADMAP`; leave
all of it standing and state the branch in the wrap-up. The next session's entry point is `/next-roadmap-item <Rn>`, or
`/execute-roadmap` for an unattended run—§2's resume path picks up that item's existing branch from
the ID alone, launched from the primary checkout, so the handoff includes no branch, no worktree
path, and no account of what was already built.

## 7. Bootstrapping a repo with no roadmap

Runs when §1 finds no plan of record—the **one attended exception to §5's never-pause rule**: **ask
(AskUserQuestion) about anything that isn't obvious** rather than guessing, whether that's which
family, the initial items, fork wiring, or a gate command. One-time setup; afterwards proceed from
§2 if the new roadmap has items, otherwise report the bootstrap and stop.

An `upstream` remote means the local-only family. No `upstream` and the user owns the repo means the
tracked family. Ambiguous, ask.

### 7a. Local-only (an OSS fork)

1. **Confirm the fork wiring**: `origin` is your fork on the remote host, `upstream` is the real
   project, ideally with `git remote set-url --push upstream no_push`. If the remotes aren't wired
   that way, propose the rewiring and ask before touching remotes.
2. **Exclude the local-only artifacts**—per-clone and uncommitted; never touch the tracked
   `.gitignore`. Append these lines to `.git/info/exclude` with a file edit. `notes.local/` is
   created by the first note written there:
   ```
   # Local-only planning artifacts (never commit/push upstream)
   /ROADMAP*.local.md
   /.claude/
   /notes.local
   ```
3. **Stamp out `ROADMAP.local.md`** with a header containing the per-repo config as prose—this
   header *is* the config:
   - a one-line banner: local-only, excluded via `.git/info/exclude`, never commit or push;
   - a **forward-only** note pointing landed work at `ROADMAP-CHANGELOG.local.md`;
   - the fork and upstream remote names;
   - the **binding guardrails**: nothing is pushed to `upstream`, every post there is confirmed by
     the user (`land-and-wrap` §3), and which items require the user present;
   - a **House style** section distilled from the project's `CONTRIBUTING`, `.editorconfig`, and a
     read of neighboring source—mechanical gate command, comment conventions, test framework and
     naming, commit-message convention, **branch-naming convention** (read recent branch and
     merged-PR head names, e.g. `git ls-remote --heads upstream`), em-dash and other prose rules—to
     be pasted verbatim into every implementation-agent brief.
4. **Create `ROADMAP-CHANGELOG.local.md`** as the empty done-record companion.
5. **Seed the items**: ask the user what they are. Scope is theirs to set—don't invent a plan from
   the codebase unasked—then write them in priority order with stable `Rn` IDs.

### 7b. Tracked (a repo you own)

1. **Stamp out root `ROADMAP.md`** with a short header: the `Rn` ID scheme (stable, never reused, an
   item keeps its ID for life; the claim unit is the item, sub-items `Rn.m`), §3's priority-order
   rule, a forward-only note—git history is the done-record, so landed items are deleted and
   parked or declined items move to their own file—and the `Highest ID used: R<n>` line of §3,
   set to the highest ID among the seeded items once they are written.
2. **Seed the items**: same as §7a step 5.
3. **Commit the roadmap on the default branch.** It's tracked; that's what puts it in this family.
