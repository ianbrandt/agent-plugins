# backlog-skills design

How the plugin is wired, for anyone changing it. The [README](../README.md) covers using it.

## How it is wired

One hooks module, `hooks/register.ts`, which is a Claude Code mod and needs Claude Code 2.1.308 or
later. No shell or interpreter is involved, and git is run directly. Git 2.36 or later is needed,
since the worktree list is read with `-z`.

| File | What is in it |
|---|---|
| `format.ts` | the parser and validator for the backlog files, gate resolution, and the next free ID |
| `kind.ts` | which kind of backlog a repo has, from facts read by `repo.ts` |
| `repo.ts` | the facts read from git and the files: the primary checkout, the default branch, refs, branches, worktrees, claims, and deleted headings |
| `lock.ts` | the lock every write takes |
| `journal.ts` | the write journal and the settling of an interrupted write |
| `tools.ts`, `write.ts` | the tools that read the backlog, and the tools that change it |
| `cite.ts`, `command.ts` | the check for bare IDs, and the reading of commit and PR text out of a command |
| `plan.ts` | the rule added at session start |
| `item.ts` | the deletion of one item, used by the tools that close or move an item |

## Finding the backlog

`find_backlog` reads the primary checkout from any worktree and returns the first kind that
matches:

| Kind | Condition |
|---|---|
| `partial-migration` | a migration marker that is not complete |
| `migration-pending` | a complete marker for a tracked migration, with `BACKLOG.md` not yet on the default branch and the migration's branch still present |
| `local-only` | `BACKLOG.local.md` |
| `tracked` | `BACKLOG.md` tracked, in a repo with no `upstream` remote |
| `needs-migration` | an old `ROADMAP*.local.md`, or with no `upstream` remote, a tracked `ROADMAP.md` or `docs/roadmap.md` with item headings |
| `fork-without-backlog` | an `upstream` remote |
| `none` | none of the above |

A remote is absent only where `git remote get-url` exits 2. Any other failure is returned as an
error, and added at session start as one line in place of the rule, since the repo may have a
backlog. With an `upstream` remote, a missing plan or a plan with no House style section is listed
among the problems.

## The format

The backlog is checked on every tool call. A file-level problem (an unclosed fence, a conflict
marker, a malformed item heading, an ID live in two files, or a `Highest ID used` line that is
missing or too low) makes every write tool refuse until it is fixed. An item-level problem makes
that item unclaimable. A warning is only reported. A write that would add a file-level problem the
file did not already have is refused before anything is written.

Fields are read from the first block after an item's heading. A key spelled with other case or
spacing, or in bold, is read as the field it matches, with a warning. `Gated by` accepts IDs,
ranges (`R11 to R13`), and lists.

A gate on a local-only backlog is open when the ID has a changelog record and is open in no file.
The record's status does not matter: under `roadmap-skills`, an item got a `PR-READY` record and was
deleted after its merge with no further record, and `close_item` always appends the final record
before it deletes. On a tracked backlog the gate is open when the ID's heading was deleted on the
default branch, or when the clone has the ref `refs/backlog/closed/<ID>`, which is written by
`confirm_landed` after a landing. The gate is shut for an ID with no evidence either way.

## Writing

Every write tool holds the ref `refs/backlog/lock` for its read, change, and write. Git refuses to
create a ref that exists, from any worktree, so the ref works as a lock. A lock older than a minute
is broken with a compare-and-swap. The wait stops at 10 seconds, since a hook's budget is 10
seconds of clock time.

Each file a tool rewrites goes through a journal under `<git common dir>/backlog/journal/`: the new
content and a copy of the old are written and read back before the file is touched, and the file is
read back after. The fs API has no delete, so a settled entry is overwritten with a tombstone. An
entry left by an interrupted call is settled at the start of the next call: a file cut short is
saved as `.found` and written again, and a file a person edited in the meantime is kept, with the old
copy saved as `.prev`. Saved files are numbered rather than overwritten.

A tool that writes two files writes the target first and reads it back before it changes the
source. A retry of `close_item`, `park_item`, `decline_item`, or `reactivate_item` finds its own
first write and finishes the delete. `record_progress` has no such check, so a retry after an
interruption appends a second record.

`reserve_id` creates `refs/backlog/ids/<ID>` the same way as the lock, so two sessions never get one
ID. The refs are not pushed. A sub-item's ID is reserved the same way.

## Citations

A reply is read when the turn completes, and a note listing each bare ID is added to the next
prompt.
Commit messages and PR titles and bodies are read out of `git commit`, `gh pr create`, and
`gh pr edit` commands in Bash and PowerShell, including heredocs and named files, and a command
with a bare ID is refused. The check applies to subagents too. A message from an editor, a variable, or a
substitution cannot be read, so the command passes with a one-line note. A command inside `bash -c`,
`sh -c`, `eval`, `xargs`, or `timeout` is not read.

## The session-start rule

In a repo with a backlog, a short rule is added to the first prompt, and again once the model no
longer reads it. It includes the backlog's and the plan's paths, the steps for a task the user states
directly, and the citation form. In the three migration kinds, instructions for the migration are added in its place. In a repo
with no backlog nothing is added.
