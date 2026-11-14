---
name: next-backlog-item
description: >-
  Claim the next unclaimed, non-colliding item in THIS repo's backlog and start
  building it. Finds the backlog in either place it lives—tracked at the repo
  root, or untracked and local-only for an OSS project contributed to via a
  fork—offers the migration of an old roadmap, and bootstraps a backlog if the
  repo has none. Trigger on "tackle a backlog item", "next roadmap item",
  "claim a task and get going", or starting work without colliding with the
  other sessions. Also resumes an item already in flight and partially
  built—more building on an in-flight item is this skill, which picks up that
  item's existing branch. An optional lane hint ("R1") only biases the pick.
  Also the way into a task the user states directly ("upgrade X", "fix Y") in a
  repo that has a backlog: the task gets an item, and this skill runs on that
  item's ID. NOT for reading or summarizing the backlog, and NOT for the branch
  mechanics themselves (that's work-on-a-branch), a worktree or the claim ledger
  (that's work-in-worktree and claim-a-lane), or landing finished work (that's
  land-and-wrap).
---

# Next backlog item—parallel-safe session cold-start

Pick one item off this repo's backlog and build it, without colliding with the other sessions
working the same repo right now.

**Cite an item as `ID: Title`**, as in `R12: Parser cache`, never as a bare ID. The user is not
reading the backlog beside the conversation. A hook checks replies, commit messages, and PR text
for bare IDs. An ID in a code span, a field line such as `Gated by: R600`, a range or list followed
by one title (`R3 and R7: Ledger reap`), and a later mention of an ID already cited with its title
are exempt.

This skill is a **backlog plugin**: it fills the backlog seam `work-on-a-branch` §0 defines, using
markdown files in place of an issue tracker. Everything else about the session belongs to the
skills this one calls rather than copies:

- **`work-on-a-branch`**—picking up or opening the item's branch, and the primary-checkout path
  rules.
- **`claim-a-lane`** and **`work-in-worktree`**, from `parallel-session-skills`—the shared claim
  ledger, and the worktree for an item worked beside another session.
- **`land-and-wrap`**—how finished work leaves its branch, and what every session does at its end.

**Every change to the backlog files goes through a tool** of this plugin: `reserve_id`,
`write_item`, `set_field`, `move_item`, `record_progress`, `close_item`, `confirm_landed`,
`park_item`, `decline_item`, and `reactivate_item`. Never edit them by hand or with
`edit_primary_file`. A write through a tool takes a lock, goes through a journal so an
interruption loses nothing, and is refused when it would break the format. The one exception: a git conflict in a tracked
backlog file is resolved by hand, keeping the higher `Highest ID used`, and the next tool call
validates the result.

## 1. Find the backlog

Call `mcp__backlog-skills__find_backlog`. It reads the primary checkout from any worktree and
returns a `kind`, the absolute paths of the files that kind has, and any problems found.

| Kind | What to do |
|---|---|
| `local-only` | `BACKLOG.local.md` and its companions, untracked, in the primary checkout. |
| `tracked` | `BACKLOG.md` in a repo with no `upstream` remote. Edited on the item's branch, under `$WT`. |
| `needs-migration` | An old `ROADMAP*` file. Offer §8's migration to the user and stop until they answer. |
| `partial-migration` | Continue §8's migration with `migrate_backlog`. |
| `migration-pending` | A tracked migration waits on its branch. Land that branch first (`land-and-wrap`). |
| `fork-without-backlog`, `none` | §7's bootstrap. |

Every write tool refuses in the three migration kinds.

**The plan** is the optional `PLAN.md` beside a tracked backlog, or `PLAN.local.md` beside a
local-only one, at the path `find_backlog` returns. Scope, audiences, triage policy, and the
user's standing instructions go there, and on a fork the remotes, the guardrails, and the House style
section too. Read it when you pick an item (§3), when you resume one before building, and when you
triage a finding (§6). In a repo with an `upstream` remote, a missing plan, or a plan with no House
style section, is listed among `find_backlog`'s problems; fix that with the user before building.

**This is not the same question as how work lands.** That comes from the clone, as described in
`land-and-wrap` §1: fork-ness, the landing mode, and the push and post modes.

## 2. Get onto the item's branch

Run **`work-on-a-branch`** now: locate `$MAIN`, then resume the item's in-flight branch or open a
new one. If the skill is not among the available skills, **stop and tell the user to install
`session-skills`**: nothing below fails loudly without it.

An item's `Branch` field is `work-on-a-branch` §2's tell 1, the durable in-flight record. **When
`work-on-a-branch` §4 reports that branch as merged**, or its content is already on
`origin/$DEFAULT`, the item is done, not in flight: close it with `close_item` (`MERGED-UPSTREAM` on
a fork) rather than resuming it.

Run `work-on-a-branch` §4's prune too. Then run **`claim-a-lane`** §1 and §2 and come back here to
pick. The claim (its §3) is written after the pick, wherever the work is. Where
`parallel-session-skills` is not installed, say so in one line and skip every ledger step below.

## 3. Pick an item

Call `mcp__backlog-skills__list_items`. It returns the open items in priority order, top-down, with
their fields, each gate's state, and whether the item is claimable, with the reasons when it is not.
**Take the topmost claimable item with `Touches` globs disjoint from every live claim's
`touches`** (`claim-a-lane` §3). Declare the backlog file in your own claim when the item will
change it on a tracked backlog.

The fields, one `- Key: value` line each, right after the item's heading:

- `Touches`: the paths the item expects to edit. Copy them into your claim.
- `Gated by`: the items that must land first. A gated item is not claimable.
- `Needs: user`: never claimable unattended.
- `Branch`: the item is in flight on that branch.
- `Check`: a command the item's work must pass, beside the repo's build.

**A lane hint** (free text after the skill name—an ID, a sub-item, or a keyword) reorders candidates
that already pass those gates; it never relaxes them. Match it against item IDs and titles:

- claimable and disjoint → take it;
- not claimable or colliding → prefer a disjoint sub-item of the same item, else fall back to the
  normal pick. Either way **say so**: the hinted item, why it could not be honored, and what you
  picked instead;
- matches nothing → note that briefly, then pick as if unhinted.

If everything worthwhile is claimed, don't force a collision: wait for a session to finish, then
pick. A hint doesn't change this.

**A task the user stated directly, with no item yet.** Call `reserve_id`. On a local-only backlog,
write the item with `write_item` at its priority position now: the problem in a sentence or two,
and its `Touches`. On a tracked backlog, write it with `write_item` in the copy under `$WT` once §2
has opened the branch, and commit it there; `write_item` raises `Highest ID used` in the same
write. Then it is a hinted pick like any other.

**Resuming an item already in flight.** The pick is already made—skip these gates. A claim on the
item you are resuming is yours, not a collision.

Then write the claim, per `claim-a-lane` §3, where the repo has a ledger.

## 4. Give the session a descriptive title

As soon as the claim lands, **title the session the way `session-skills`' session rules specify**.
The title is the item's citation: its ID, a colon, then a short noun phrase for the deliverable,
starting with a capital letter and **spelled out with no abbreviations**—`R1: Aggregation core`. A
sub-item keeps its own `Rn.m`. A session that goes on to claim more items is titled again with
every ID first: a run of consecutive IDs as a range, others as a list, then one phrase for the
work—`R144 to R149: Plugin README cleanup`, `R3 and R7: Ledger reap`.

## 5. Emit the tier plan—never pause

Model and effort are the **user's controls**: **start building immediately, no pause, no
end-of-turn checkpoint.** The main loop stays at the settings the session launched with; escalate
by **delegation, not the session pickers**.

Immediately after the title, emit a one-line **tier plan** stating the stages **this item has**,
then execute it. Two decisions go into it:

- **How much verification the item needs.** Would this repo's test suite catch this item going
  silently wrong? A loud suite lets the implement stage run cheap. A silent failure mode—transform
  or rewrite machinery—puts the weight on design and adversarial-verify, at the Critical tier.
- **What runs each stage.** Inline, a delegated agent, or a Workflow. A single item is usually a
  linear design → build → verify that the main loop plus one or two agents handles. Reach for a
  Workflow for fan-out, a loop until some condition holds, or several units driven
  deterministically. A mechanical lap stays inline at launch settings: `Tier plan: inline.`

**State a model and an effort for every delegated stage, and pass both.** Take each tier's model and
effort from `tier-model-and-effort` or the session's rules table, never from memory. Restate each
stage's tier in the message that launches it, and say so when a planned stage does not run.

## 6. Build it, then land it

**Before the first edit, call `mcp__parallel-session-skills__read_ledger` once more**, where the
repo has a ledger. A claim written after yours is seen only then, and `claim-a-lane` §3 has the rule
for a clash.

Work **test-first per this repo's conventions**: for a repo you own, its `CLAUDE.md`, `AGENTS.md`,
`CONTRIBUTING`, and design docs; for a fork, the plan's House style section, which is pasted verbatim
into every implementation brief. When in doubt, match the neighboring file.

**Orchestrate substantial items** with delegated agents—design → implement test-first →
adversarial review → re-verify—scaled to size. *This instruction is itself the opt-in*, so the
orchestration runs even if the session never enabled `ultracode`; it grants orchestration only, not
extra effort. Keep small items inline.

Then hand off to **`land-and-wrap`** for how the work leaves its branch. This skill keeps four
things:

- **Bring the docs.** Finishing an item includes every piece of documentation it touches.
- **Keep an item's notes in one directory**, named for its ID in the repo's local-only notes
  directory (`notes.local/R12/`). When the item lands, move each finding a later session needs into
  a design doc or the done-record, move a harness a later item will run again into the repo, and
  delete the directory. Keep the notes of a parked item, and any directory an open item names.
- **Record the item done.** Call `close_item` with the item's ID and, on a local-only backlog, its
  done-record: mechanism notes, corrections, refuted hypotheses, the local-to-upstream commit and PR
  map, and findings a later session should not have to re-derive, under a status (`BUILT-LOCAL`,
  `DRAFTED`, `MERGED-UPSTREAM`, or `DONE`, the default). `PR-READY` and `FILED` are written by
  `record_progress` instead. On a tracked backlog the deletion is the
  done-record: call `close_item` in the copy under `$WT` and commit it as the branch's last commit.
  After the landing is confirmed—after the merge in direct mode, or when the merged branch is
  pruned in `pr` mode—call `confirm_landed`, so items gated on this one open in this clone. An item
  that turned out parked or declined goes through `park_item` or `decline_item` instead.
- **In `pr` mode** (`land-and-wrap` §1) the item stays open until its PR merges. On a local-only
  backlog, call `record_progress` with `PR-READY`, or `FILED` once the PR is open: it appends the
  record and sets `Branch`. The session that prunes the merged branch calls `close_item`. On a
  tracked backlog the `close_item` commit goes in the PR.
- **Record what was found in passing.** A defect or gap outside the item becomes a new item
  (`reserve_id`, then `write_item` at its priority position, after reading the plan's triage
  policy), never a fix smuggled into the one in hand. Raise it in the reply as well.

**A claim is released at session end even when the item isn't finished.** The resume record is the
item's branch, its worktree where it has one, and on a local-only backlog its `Branch` field: set it
with `set_field` and state the branch in the wrap-up. The next session's entry point is
`/next-backlog-item <ID>`, or `/work-backlog` for an unattended run.

## 7. Bootstrapping a repo with no backlog

Runs when §1 returns `fork-without-backlog` or `none`—the **one attended exception to §5's
never-pause rule**: **ask (AskUserQuestion) about anything that isn't obvious**. An `upstream`
remote means local-only; no `upstream` and a repo the user owns means tracked; ambiguous, ask.

The files hold no rule already stated in this plugin's skills or its session-start rule: not the ID
scheme, the priority order, or the forward-only rule.

### 7a. Local-only (an OSS fork)

1. **Confirm the fork wiring**: `origin` is the user's fork, `upstream` is the real project, ideally
   with `git remote set-url --push upstream no_push`. Propose any rewiring and ask before touching
   remotes.
2. **Exclude the local-only files** in `.git/info/exclude`, never the tracked `.gitignore`:

   ```
   /BACKLOG*.local.md
   /PLAN*.local.md
   /notes.local
   /.claude/
   ```

3. **Write `BACKLOG.local.md`**: the title line `# Backlog (local only)`, then one line,
   `Never commit or push this file. Highest ID used: R0`, then the items.
4. **Write `PLAN.local.md`**: the fork and upstream remote names; the guardrails (nothing is pushed
   to `upstream`, every post there is confirmed by the user, which items need the user); and a
   **House style** section distilled from the project's `CONTRIBUTING`, `.editorconfig`, and
   neighboring source—the gate command, comment conventions, test framework and naming, commit
   message and branch-naming conventions (read `git ls-remote --heads upstream`), and prose rules.
5. **Seed the items**: ask the user what they are. Scope is theirs to set. Write each with
   `reserve_id` and `write_item`, in priority order.

### 7b. Tracked (a repo you own)

1. **Write `BACKLOG.md`**: the title line `# Backlog`, then one line, `Highest ID used: R0`.
2. **Seed the items** as in §7a step 5. A `PLAN.md` is written only when the user has scope,
   audiences, or standing instructions to record.
3. **Commit the files on the default branch.**

## 8. Migrating an old roadmap

Offered when §1 returns `needs-migration`, and continued when it returns `partial-migration`.
Attended, once per repo. Ask the user before starting, and tell them to stop any other session
still working the repo on the old roadmap rule.

`mcp__backlog-skills__migrate_backlog` does every mechanical part: the preconditions (an empty claim
ledger, no `BACKLOG*` or `PLAN*` file yet, and on a tracked roadmap no item branches with
unmerged commits), the exclusions, the marker, the backup, each write with its hash, validation,
the check that the new files hold the same IDs as the old ones, and the deletion of the old files.
Call it first with no text to get the old files and their IDs. Then supply, per destination, the
converted text:

- **The backlog**: each item as `## ID: Title` (sub-items `### ID: Title`) followed by its field
  lines. Convert touches, gate, pin, and check prose, and "(needs the user)" in a heading, into
  fields where the text is unambiguous, and list each conversion you could not make. Drop section
  and band headings and list them.
- **The parked, declined, and changelog files** are copied by the tool with their names changed.
- **The plan**: the old header, leaving out every rule this plugin already states. List each
  passage you left out or could not place, with its line range in the old file, for the user.

On a tracked roadmap the migration is one commit on its own branch, landed through
`land-and-wrap`; until it is on the default branch, `find_backlog` returns `migration-pending`.
An interrupted migration is continued by calling `migrate_backlog` again.
