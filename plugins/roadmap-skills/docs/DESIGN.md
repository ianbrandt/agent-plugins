# roadmap-skills design

How the plugin is wired, for anyone changing it. The [README](../README.md) covers using it.

## How it is wired

One hooks module, `hooks/register.ts`, which is a Claude Code mod and needs Claude Code 2.1.308 or
later, the oldest version supported. No shell or interpreter is involved, and git is run directly.
`delete_item` needs git 2.36 or later, since the worktree list is read with `-z`.

In a repo that has a roadmap, the module adds a short rule to the first prompt, and again once the model no longer reads it: a task the user states directly ("upgrade X") gets a roadmap item, is entered
through `next-roadmap-item`, and is landed through `land-and-wrap`. On a local-only roadmap the item is
written first. On a tracked one the ID is taken first and the item is written in the lane's worktree
once it is open. How the next free ID is found is in the rule too. Without the rule such a session
never loads a skill from this plugin, and it writes no item, opens no worktree, and decides the
landing from whatever standing instruction it finds. In a repo with no roadmap nothing is added.

Two tools are registered. `mcp__roadmap-skills__find_roadmap` is called from `next-roadmap-item` §1
and returns, from any worktree, the primary checkout, the kind of roadmap (local-only, tracked, a
fork with none yet, or none), and the absolute paths of the roadmap and of its changelog where it
has one.
`mcp__roadmap-skills__delete_item` is called from `next-roadmap-item` to delete a landed item: from the item's heading to the next heading of the same or a higher level,
with headings inside a fenced block skipped. The deletion is a pure function in `hooks/item.ts`,
checked by `claude plugin test` with `hooks/item.test.ts`.

The rule and `find_roadmap` share one lookup, in `hooks/plan.ts` with `hooks/plan.test.ts`: a
`ROADMAP.local.md` in the primary checkout, else a tracked `ROADMAP.md` or `docs/roadmap.md` in a
repo with no `upstream` remote. A fork's tracked `ROADMAP.md` is the upstream project's, so no rule
is added there. A remote is absent only where `git remote get-url` exits 2. Any other failure of
that command, or of `git ls-files`, is returned by `find_roadmap` as an error and added at session
start as one line in place of the rule, since the repo may have a roadmap.
