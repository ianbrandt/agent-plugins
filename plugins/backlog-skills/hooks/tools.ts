// The tools that find and read the backlog, and reserve_id (design D3, D5, D6).
import { ID, type Item, type Problem, claimable, idsIn, nextId, parseHeadings, scan } from './format'
import { problemsOf, settle, settleLocked, writeFiles } from './journal'
import { blob, create, withLock } from './lock'
import { type Loaded, type Repo, NAMES, facts, load } from './repo'

const ID_SCHEMA = { type: 'string', description: 'An item ID, such as R12 or R12.3.' }
export const TOOLS = [
  {
    name: 'find_backlog',
    description: "Find this repo's backlog from any worktree. Returns the primary checkout, the kind, the absolute paths of the backlog files and the plan, and any problems found in them.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'reserve_id',
    description: 'Take the next free item ID, so no other session gets it. On a local-only backlog this also raises the Highest ID used line.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_items',
    description: 'List the open items in order, with their fields, the state of each gate, and whether each item can be claimed and why not.',
    inputSchema: { type: 'object', properties: { unattended: { type: 'boolean', description: 'True in an unattended run, where an item with Needs: user cannot be claimed.' } } },
  },
  {
    name: 'read_item',
    description: 'Read one item by its ID, from the backlog, the parked or declined file, or the changelog.',
    inputSchema: { type: 'object', properties: { id: ID_SCHEMA }, required: ['id'] },
  },
  {
    name: 'find_mentions',
    description: 'List the lines in the backlog files and the plan that cite an ID.',
    inputSchema: { type: 'object', properties: { id: ID_SCHEMA }, required: ['id'] },
  },
]

// What to do in each migration kind, as stated in the session-start rule (D3).
export const MIGRATION: Record<string, string> = {
  'partial-migration': 'A migration of this repo\'s roadmap was started and did not finish. Continue it with migrate_backlog before any other backlog work. Until then the write tools refuse.',
  'migration-pending': 'The migration is committed on its branch, and BACKLOG.md is not on the default branch yet. Land that branch first. Until then the write tools refuse.',
  'needs-migration': 'This repo still has an old roadmap. Offer the migration to the user, and run it with migrate_backlog if they agree. Until then the write tools refuse.',
}

const relOf = (repo: Repo, p: Problem) => (p.file && repo.paths?.[p.file]) || 'backlog'
export const problemLines = (repo: Repo, ps: Problem[]) => ps.map(p => `  ${relOf(repo, p)} line ${p.line} (${p.level} level): ${p.message}`)

// D6: in a repo with an upstream remote, the plan holds the House style section.
async function houseStyle($: any, repo: Repo, plan: string | undefined): Promise<string[]> {
  if (!repo.hasUpstream || !repo.paths) return []
  const at = `${repo.main}/${repo.paths.plan}`
  if (plan === undefined) return [`no plan at ${at}: a repo with an upstream remote needs one, with a House style section`]
  const has = scan(plan).lines.some(l => !l.code && /^ {0,3}#{1,6}[ \t]+House style\b/i.test(l.text))
  return has ? [] : [`the plan at ${at} has no House style section`]
}

async function findBacklog($: any): Promise<string> {
  const repo = await facts($)
  if (!repo) return 'kind: none\nNot inside a git repository.'
  const out = await settle($, repo)
  out.push(`main: ${repo.main}`, `kind: ${repo.kind}`)
  if (repo.paths) {
    for (const k of [...NAMES, 'plan'] as const) if (repo.paths[k]) out.push(`${k}: ${repo.main}/${repo.paths[k]}`)
    const { ctx, texts } = await load($, repo)
    const ps = problemsOf(ctx)
    if (ps.length) out.push('problems:', ...problemLines(repo, ps))
    repo.report.push(...(await houseStyle($, repo, texts.plan)))
  }
  if (repo.report.length) out.push('report:', ...repo.report.map(r => `  ${r}`))
  if (MIGRATION[repo.kind]) out.push(MIGRATION[repo.kind])
  return out.join('\n')
}

// A repo with a backlog the tools can read, the journal settled first.
async function open($: any): Promise<{ repo: Repo; loaded: Loaded; out: string[] }> {
  const repo = await facts($)
  if (!repo) throw new Error('not inside a git repository')
  if (!repo.paths) throw new Error(`this repo has no backlog to read: its kind is ${repo.kind}${MIGRATION[repo.kind] ? `. ${MIGRATION[repo.kind]}` : ''}`)
  const out = await settle($, repo)
  const loaded = await load($, repo)
  const file = problemsOf(loaded.ctx).filter(p => p.level === 'file')
  if (file.length) out.push('file-level problems, so every write tool refuses until they are fixed:', ...problemLines(repo, file))
  return { repo, loaded, out }
}

const fieldLines = (i: Item, pad: string) => Object.entries(i.fields).map(([k, v]) => `${pad}  - ${k}: ${v}`)

async function listItems($: any, unattended: boolean): Promise<string> {
  const { repo, loaded: { ctx }, out } = await open($)
  const items = ctx.backlog.items
  if (!items.length) out.push('no open items')
  for (const i of items) {
    const c = claimable(i, ctx, { unattended })
    // A sub-item is indented under its parent.
    const pad = i.level === 3 ? '  ' : ''
    out.push(`${pad}${i.id}: ${i.title}`, `${pad}  gate: ${c.gate}; claimable: ${c.claimable ? 'yes' : `no (${c.reasons.join('; ')})`}`, ...fieldLines(i, pad))
  }
  const other = problemsOf(ctx).filter(p => p.level !== 'file')
  if (other.length) out.push('other problems:', ...problemLines(repo, other))
  return out.join('\n')
}

export const checkId = (id: unknown): string => {
  if (typeof id !== 'string' || !new RegExp(`^${ID}$`).test(id)) throw new Error(`not an item ID: ${JSON.stringify(id)}`)
  return id
}

async function readItem($: any, input: any): Promise<string> {
  const id = checkId(input.id)
  const { repo, loaded: { ctx }, out } = await open($)
  const at = (k: string) => `${repo.main}/${(repo.paths as any)[k]}`
  const hits: string[] = []
  const item = ctx.backlog.items.find(i => i.id === id)
  if (item) hits.push(`${at('backlog')} line ${item.line}:`, item.text.trimEnd())
  for (const k of ['parked', 'declined', 'changelog'] as const) {
    for (const h of ctx[k]?.filter(h => h.ids.includes(id)) ?? []) hits.push(`${at(k)} line ${h.line}:`, h.text.trimEnd())
  }
  if (!hits.length) throw new Error(`${id} is in none of the backlog files`)
  return [...out, ...hits].join('\n')
}

async function findMentions($: any, input: any): Promise<string> {
  const id = checkId(input.id)
  const { repo, loaded: { texts }, out } = await open($)
  const hits: string[] = []
  for (const k of [...NAMES, 'plan'] as const) {
    const text = texts[k]
    if (text === undefined) continue
    // A heading with a range, such as `R3 to R5`, cites every ID in it.
    const ranged = new Set(k === 'backlog' || k === 'plan' ? [] : parseHeadings(text).filter(h => h.ids.includes(id)).map(h => h.line))
    text.split('\n').forEach((l, n) => {
      if (ranged.has(n + 1) || idsIn(l).includes(id)) hits.push(`${repo.main}/${repo.paths![k]}:${n + 1}: ${l.replace(/\r$/, '')}`)
    })
  }
  return [...out, ...(hits.length ? hits : [`no mentions of ${id}`])].join('\n')
}

// Creates refs/backlog/ids/<prefix><n>, or the ref for the first number past
// it that no other session took first. write_item reserves sub-items with it.
export async function reserve($: any, repo: Repo, prefix: string, n: number): Promise<{ id: string; lines: string[] }> {
  const own = await blob($, repo.main, [`session ${await $.session.id().catch(() => '')}`, `time ${await $.clock.now()}`])
  const skipped: string[] = []
  for (; !(await create($, repo, `refs/backlog/ids/${prefix}${n}`, own)); n++) {
    skipped.push(`${prefix}${n}`)
    if (skipped.length >= 100) throw new Error(`refs/backlog/ids/ already has the next 100 IDs, ${skipped[0]} to ${prefix}${n}`)
  }
  const id = `${prefix}${n}`
  return { id, lines: [`id: ${id}`, `ref: refs/backlog/ids/${id}`, ...(skipped.length ? [`skipped, reserved by another session: ${skipped.join(', ')}`] : [])] }
}

// D5: the next ID past every source, held with a ref under refs/backlog/ids/.
// A ref another session created first is skipped for the next number.
async function reserveId($: any): Promise<string> {
  const repo = await facts($)
  if (!repo) throw new Error('not inside a git repository')
  if (repo.kind !== 'local-only' && repo.kind !== 'tracked') throw new Error(`no ID can be reserved while the kind is ${repo.kind}${MIGRATION[repo.kind] ? `. ${MIGRATION[repo.kind]}` : ''}`)
  return withLock($, repo, async lock => {
    const out = await settleLocked($, repo, lock)
    const { ctx, texts } = await load($, repo)
    const file = problemsOf(ctx).filter(p => p.level === 'file')
    if (file.length) throw new Error(`the backlog files have file-level problems, so no ID was reserved:\n${problemLines(repo, file).join('\n')}`)
    const headings = [ctx.parked, ctx.declined, ctx.changelog].flatMap(hs => hs?.flatMap(h => h.ids) ?? [])
    let n = Number(nextId({
      highest: ctx.backlog.highest,
      ids: [...ctx.backlog.items.map(i => i.id), ...headings, ...repo.reserved, ...repo.closed, ...repo.claimIds],
      branches: [...repo.branches, ...repo.worktrees.slice(1).map(w => w.path.split('/').pop()!)],
    }).slice(1))
    const { id, lines } = await reserve($, repo, 'R', n)
    out.push(...lines)
    n = Number(id.slice(1))
    if (repo.kind === 'local-only') {
      const path = `${repo.main}/${repo.paths!.backlog}`
      const text = texts.backlog!.replace(/(Highest ID used:\s*`?[A-Z]+)\d+/, `$1${n}`)
      out.push(...(await writeFiles($, repo, lock, [{ path, text }])), `Highest ID used: R${n}`)
    }
    return out.join('\n')
  })
}

// Each tool's error is its result, marked as an error.
export const answer = async (name: string, fn: () => Promise<string>) => {
  try {
    return { result: await fn() }
  } catch (err) {
    const text = `${name}: ${(err as Error).message}`
    return { result: text, text, isError: true }
  }
}

export function tools(on: any) {
  const tool = (name: string) => `mcp__backlog-skills__${name}`
  on('tool.call', { tool: tool('find_backlog') }, async ($: any) => answer('find_backlog', () => findBacklog($)))
  on('tool.call', { tool: tool('reserve_id') }, async ($: any) => answer('reserve_id', () => reserveId($)))
  on('tool.call', { tool: tool('list_items') }, async ($: any, e: any) => answer('list_items', () => listItems($, e.unattended === true)))
  on('tool.call', { tool: tool('read_item') }, async ($: any, e: any) => answer('read_item', () => readItem($, e)))
  on('tool.call', { tool: tool('find_mentions') }, async ($: any, e: any) => answer('find_mentions', () => findMentions($, e)))
}
