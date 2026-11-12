// Where a repo's plan of record is, and the rule a session starts with when it
// has one. The lookup order is next-roadmap-item §1's: a local-only roadmap
// first, then the fork check, then a tracked one. A fork's tracked ROADMAP.md is
// the upstream project's.
export type Plan = { kind: 'local-only' | 'tracked'; roadmap: string; history?: string } | { kind: 'fork-without-roadmap' | 'none' }

export function planOf(found: { hasLocal: boolean; hasUpstream: boolean; tracked: string[] }): Plan {
  if (found.hasLocal) return { kind: 'local-only', roadmap: 'ROADMAP.local.md', history: 'ROADMAP-CHANGELOG.local.md' }
  if (found.hasUpstream) return { kind: 'fork-without-roadmap' }
  const roadmap = ['ROADMAP.md', 'docs/roadmap.md'].find(p => found.tracked.includes(p))
  return roadmap ? { kind: 'tracked', roadmap } : { kind: 'none' }
}

// A local-only roadmap is one file in the primary checkout, so a new item is
// written there first. A tracked one is edited on the item's branch, so the
// ID is taken first and the item is written once the branch is open. A landed
// item is deleted from a tracked roadmap, so the highest ID ever used is kept as
// a line in its header. A local-only roadmap has a changelog with every ID in it.
export function rule(plan: { kind: 'local-only' | 'tracked'; roadmap: string }, main: string): string {
  const { roadmap } = plan
  const run = `Run \`next-roadmap-item <Rn>\`. The branch, a worktree and a claim where the work needs
   them, and the landing all come from there. Run it even when a task-specific skill, an upgrade or a refactor, covers the
   work: from that skill you learn what to change, not where to make the change or how it leaves
   the branch.`
  const steps = plan.kind === 'tracked'
    ? `1. Find the task in \`${roadmap}\`. If it is not there, take the next free \`Rn\` ID for it and write
   nothing yet: a tracked roadmap is edited on the item's branch, which is not open before
   step 2. A landed item is deleted from the roadmap, so the highest ID ever used is kept as one
   line in the roadmap's header, \`Highest ID used: R127\`. The next free ID is one more than the
   highest among that line, the roadmap, parked, and declined files, the branch and worktree
   directory names (\`claude/r78-...\`, \`r78-...\`), and the items in live claims. An item another
   session wrote is committed only on its branch, and an ID is never reused. Where the roadmap has no such line, also
   read, this one time, the headings of the items that were deleted:
   \`git -C "${main}" log -p --format= <default branch> -- ${roadmap} | grep -E '^-#+ R[0-9]+'\`
2. ${run}
3. For a task that had no item, write the new item in \`${roadmap}\` on the item's branch once
   that branch is open, at its priority position: the problem in a sentence or two, and the paths
   it touches. In the same edit, raise the \`Highest ID used\` line to the new ID, adding the line
   to the header where there is none. The line only goes up, and a merge conflict on it is settled
   by taking the higher number. Commit the edit there.
4. `
    : `1. Find the task in \`${roadmap}\`. If it is not there, write it as a new item at its priority
   position: the problem in a sentence or two, and the paths it touches. A local-only roadmap is
   edited in the primary checkout. Take the next free \`Rn\` ID, checked against the parked,
   declined, and changelog files too, since an ID is never reused.
2. ${run}
3. `
  return `ROADMAP RULE ACTIVE

This repo's plan of record is \`${roadmap}\`, in the primary checkout at \`${main}\`.

A task the user states directly is handled like an item picked off the roadmap. Before the first
edit to a file that will be committed:

${steps}Land through \`land-and-wrap\` only. When a standing instruction authorizes merging to the
   default branch, \`land-and-wrap\` §1 is still where you find out whether this repo is a fork and
   whether its work lands as a pull request.

Size is no exemption: a one-line change that will be committed gets an item. A question answered
by reading gets none, and neither does an edit to the roadmap files themselves.

In a reply, write an item as its ID with a few words of its heading, "R12, the parser cache", and
never as a bare ID. The user is not reading the roadmap beside the conversation.`
}
