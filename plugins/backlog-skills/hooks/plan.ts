// The rule a session starts with, from find_backlog's kind (design D3, D6, D7).
import type { Repo } from './repo'
import { MIGRATION } from './tools'

const CITE = 'Cite an item as `ID: Title`, as in `R12: Parser cache`, never as a bare ID. The user is not reading the backlog beside the conversation.'

// A local-only backlog is in the primary checkout, so the item is written
// before next-backlog-item runs. A tracked one is edited on the item's branch,
// which next-backlog-item opens.
export function rule(repo: Pick<Repo, 'kind' | 'main' | 'paths' | 'files'>): string {
  const head = 'BACKLOG RULE ACTIVE\n\n'
  if (MIGRATION[repo.kind]) return head + MIGRATION[repo.kind]
  const { paths, main } = repo
  if (!paths) return ''
  const plan = repo.files.includes(paths.plan) ? `, and its plan is \`${main}/${paths.plan}\`` : ''
  const steps = repo.kind === 'tracked'
    ? `1. Reserve an ID with \`reserve_id\`.
2. Run \`next-backlog-item <ID>\`. The branch, and the landing, come from there.
3. Write the item with \`write_item\` on the item's branch, once \`next-backlog-item\` has opened it.`
    : `1. Reserve an ID with \`reserve_id\`, and write the item with \`write_item\`.
2. Run \`next-backlog-item <ID>\`. The branch, and the landing, come from there.`
  return `${head}This repo's backlog is \`${main}/${paths.backlog}\`${plan}, in the primary checkout.

A task the user states directly gets an item before the first edit to a file that will be committed:

${steps}

Run \`next-backlog-item\` even when a task-specific skill, such as an upgrade, covers the work: from
that skill you learn what to change, not where to make the change or how it leaves the branch.

Land through \`land-and-wrap\` only. Size is no exemption: a one-line change that will be committed
gets an item. A question answered by reading gets none.

Every change to the backlog files goes through the backlog-skills tools: \`write_item\`, \`set_field\`,
\`close_item\`, and the rest.

${CITE}`
}
