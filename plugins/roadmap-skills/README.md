# roadmap-skills

A [Claude Code](https://claude.ai/code) plugin for driving a repo's roadmap when
you track work as a roadmap file rather than GitHub issues.

## Skills

### `next-roadmap-item`

Claims the next unclaimed, file-disjoint item on the repo's roadmap and starts
building it test-first, coordinating with other concurrent sessions so they don't
collide.

The plan of record lives in one of two places, and this skill finds it:

- Tracked at the repo root, in a repo you own. The landing commit that
  deletes the item is the done-record, so there is no changelog.
- Local-only, for an upstream OSS project you contribute to via a fork. The
  roadmap and its companions are untracked, so the done-record is written to
  `ROADMAP-CHANGELOG.local.md` instead of git history.

Naming follows that split: tracked repos have `ROADMAP.md` plus
`ROADMAP-PARKED.md` and `ROADMAP-DECLINED.md` as needed; a local-only plan uses
the same names with a `.local.md` suffix, which marks the files as never committed
and keeps a shadow roadmap from colliding with an upstream project's real
`ROADMAP.md`. (`docs/roadmap.md` is honored as a legacy location.)

An item's probe scripts and run output go in a directory named for its ID, such
as `notes.local/R12/`. When the item lands, its findings are moved into the
design doc or the done-record and the directory is deleted, so only notes for
work still open or parked are left.

Where the plan lives is a separate question from how finished work lands. To
land it, `land-and-wrap` checks whether the repo is a fork, whether its default
branch is protected, whether its origin is public, and any `git config` override
the user set per clone. Work in a repo you own lands in its default branch even
when the roadmap is local-only.

An optional lane hint (`/next-roadmap-item R1`) biases the pick without
overriding the no-collision rules. Point the hint at an item that's already in
flight and partially built and the skill resumes it, continuing that item's
existing branch instead of opening a new one off the default branch. It finds
the branch from the pin in the roadmap or from the branch's name, not from the
claim ledger—a session releases its claim at wrap whether
or not its item finished.

### `execute-roadmap`

The roadmap half of an unattended run. The conductor loop—the in-flight cap,
the fill loop, retries, the build gate, the stop conditions—is
`parallel-session-skills`' `conduct-a-pipeline`, which works the same way
whatever the backlog is. This skill supplies the two inputs that loop takes from
the roadmap: the ordered candidate list (open, ungated, and on a fork not
flagged as requiring you present) and, once an item is green, deleting it from
the roadmap or appending its changelog entry, or, for a PR not yet merged,
pinning it to its branch.

The loop is kept in `parallel-session-skills` because a conductor with several
lanes open needs the disjointness check on the claim ledger, and none of that
work depends on the backlog being a markdown file.

## What it pairs with

The branch and landing are handled in `session-skills`, and a worktree and the
claim ledger in `parallel-session-skills`. This plugin is a backlog plugin for both: it
supplies what is workable, where an item is already in flight, and how a landed
item gets recorded, from a markdown file rather than an issue tracker. The
dependency runs one way: these skills call into those, never the reverse, so a
different backlog (issues, a tracker) plugs into the same seam without touching
it.

`next-roadmap-item` needs only `session-skills`. When there is no ledger to
read, it runs uncoordinated and reports that in one line. `execute-roadmap`
needs `parallel-session-skills` too, since the conductor loop is defined there.

Sequencing is recorded in the roadmap, because a gate between two items is
known before any session starts and is written only in the backlog. Which files
a lane touches is a fact about the working tree, so disjointness is checked
against the claim ledger.

## How it is wired

In a repo with a roadmap, a short rule is added to the first prompt so that a task you state directly
is given a roadmap item, started through `next-roadmap-item`, and landed through `land-and-wrap`. The skills call
two tools that the plugin registers, `find_roadmap` and `delete_item`. Claude Code 2.1.308 or
later is required, and `delete_item` also needs git 2.36 or later. [DESIGN.md](docs/DESIGN.md) covers
the rule, both tools, and how the roadmap is found.
