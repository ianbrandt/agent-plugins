# backlog-skills

A [Claude Code](https://claude.ai/code) plugin for working through a repo's backlog when you track
work in markdown files rather than GitHub issues. It replaces `roadmap-skills`.

## Files

A repo has a backlog of claimable items and, optionally, a plan: scope, audiences, triage policy,
and standing instructions. Build and test notes belong in `AGENTS.md` or the contributor docs.

| File | Tracked | Local-only |
|---|---|---|
| open items | `BACKLOG.md` | `BACKLOG.local.md` |
| parked items | `BACKLOG-PARKED.md` | `BACKLOG-PARKED.local.md` |
| declined items | `BACKLOG-DECLINED.md` | `BACKLOG-DECLINED.local.md` |
| done-records | git history | `BACKLOG-CHANGELOG.local.md` |
| plan | `PLAN.md` | `PLAN.local.md` |

The tracked files are for a repo you own. The local-only files are for an upstream OSS project you
contribute to through a fork, and are excluded in `.git/info/exclude`.

Each item is a `##` heading (sub-items `###`) with its ID and title, a short list of fields, then
prose:

```markdown
# Backlog

Highest ID used: R13

## R12: Parser cache

- Touches: `src/parser/**`
- Gated by: R9
- Needs: user
- Branch: `claude/r12-parser-cache`
- Check: `./gradlew :parser:test`

The problem in a sentence or two, and anything a session needs to start.
```

The skills change these files only through the plugin's tools, which take a lock, go through a
write journal, and refuse a write that would break the format. You can still edit the files by
hand: each tool checks them first and reports any problem. An item is cited as `ID: Title`
(`R12: Parser cache`), and a bare ID in a reply, a commit message, or a PR is flagged.

## Skills

### `next-backlog-item`

Claims the topmost claimable item that touches no file another session is working on, and builds it
test-first. An item is claimable when the items it is gated by have landed, it has no problem, and
no branch has it in flight. An optional hint (`/next-backlog-item R12`) prefers that item without
overriding those rules, and resumes it when it is already in flight. A task you state directly
("upgrade X") gets an item first.

In a repo that still has a `ROADMAP*` file, a one-time migration is offered first. The items are
converted to the new format, the header is moved into the plan, and rules already stated in the
plugin are left out. The `migrate_backlog` tool does the mechanical steps and can resume after an
interruption.

### `work-backlog`

Works through the backlog unattended. With `parallel-session-skills` installed, several items run
at once through its conductor. Without it, items run one at a time in the primary checkout, with
the same build gate, retries, and stop conditions.

## What It Pairs With

The branch and the landing are handled in `session-skills`, and the worktrees and the claim ledger
in `parallel-session-skills`. Both skills need `session-skills`. When there is no claim ledger,
`next-backlog-item` runs uncoordinated and says so in one line. Disjointness between sessions is
checked against the claim ledger, since which files a lane touches is a fact about the working
tree. Sequencing is in the backlog's `Gated by` fields, since it is known before any session starts.

## How It Is Wired

In a repo with a backlog, a short rule is added to the first prompt so that a task you state
directly gets an item, is started through `next-backlog-item`, and is landed through
`land-and-wrap`. Claude Code 2.1.308 or later and git 2.36 or later are required.
[DESIGN.md](docs/DESIGN.md) covers the tools, the lock, the journal, and the checks.
