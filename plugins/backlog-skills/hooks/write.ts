// The tools that change the backlog files (design D4, D5). Each one takes the
// lock, settles the journal, refuses while the files have a file-level problem,
// and writes through the journal, a move's target before its source.
import { type Ctx, type FileName, type Item, ID, KEYS, STATUSES, fieldLine, nextSubId, parseBacklog, scan } from './format'
import { deleteItem } from './item'
import { placeOf, problemsOf, settleLocked, writeFiles } from './journal'
import { type Lock, blob, create, withLock } from './lock'
import { type Repo, type Texts, facts, git, load, run, why } from './repo'
import { MIGRATION, answer, checkId, problemLines, reserve } from './tools'

const ID_SCHEMA = { type: 'string', description: 'An item ID, such as R12 or R12.3.' }
const PATH = { type: 'string', description: "On a tracked backlog, the absolute path of BACKLOG.md in the worktree to change. Default: the primary checkout's." }
const POSITION_SCHEMA = { type: 'string', description: '"top", "bottom", "before <ID>", or "after <ID>": among the top-level items, or among its parent\'s sub-items for a sub-item.' }
const CLOSING = STATUSES.filter(s => s !== 'PR-READY' && s !== 'FILED')
const object = (properties: object, required: string[]) => ({ type: 'object', properties, required })

export const WRITE_TOOLS = [
  {
    name: 'write_item',
    description: 'Write a new item, with an ID from reserve_id, at a position. Or write a new sub-item under parent, which gets the next free sub-item ID. Or, with no position, replace an open item\'s title, fields, and body; its sub-items are kept. Raises Highest ID used where the new ID is above it.',
    inputSchema: object({
      id: ID_SCHEMA, parent: { ...ID_SCHEMA, description: 'For a new sub-item: the ID of its open top-level item. Leave out id.' },
      title: { type: 'string' },
      fields: { type: 'object', description: `Field values by key: ${KEYS.join(', ')}.`, additionalProperties: { type: 'string' } },
      body: { type: 'string', description: 'The prose after the fields. Headings of level 4 and deeper only.' },
      position: POSITION_SCHEMA, path: PATH,
    }, ['title']),
  },
  {
    name: 'set_field',
    description: 'Set or clear one field of an open item.',
    inputSchema: object({ id: ID_SCHEMA, key: { type: 'string', enum: KEYS }, value: { type: 'string', description: 'Leave out, or pass "", to clear the field.' }, path: PATH }, ['id', 'key']),
  },
  {
    name: 'move_item',
    description: 'Move an open item, with its sub-items, to a new position. A sub-item moves among its siblings.',
    inputSchema: object({ id: ID_SCHEMA, position: POSITION_SCHEMA, path: PATH }, ['id', 'position']),
  },
  {
    name: 'record_progress',
    description: 'Local-only backlog, in pr mode: append a PR-READY or FILED record for an item to the changelog, and set its Branch field. The item stays open.',
    inputSchema: object({
      id: ID_SCHEMA, status: { type: 'string', enum: ['PR-READY', 'FILED'] },
      branch: { type: 'string', description: 'The value of the Branch field, such as `claude/r12-parser-cache`.' },
      record: { type: 'string', description: 'The record\'s prose.' },
    }, ['id', 'status', 'branch']),
  },
  {
    name: 'close_item',
    description: 'Record a landed item done. On a local-only backlog: append the done-record to the changelog, with a heading for each sub-item, then delete the item and its sub-items. On a tracked backlog: delete them only, and commit the deletion on the item\'s branch. A repeated call after an interruption finishes the delete and writes no second record.',
    inputSchema: object({
      id: ID_SCHEMA, status: { type: 'string', enum: CLOSING, description: 'Local-only backlog only. Default: DONE.' },
      record: { type: 'string', description: 'Local-only backlog only: the done-record\'s prose.' }, path: PATH,
    }, ['id']),
  },
  {
    name: 'confirm_landed',
    description: 'Tracked backlog, once the landing is confirmed: move the reservation refs of the item and its sub-items to refs/backlog/closed/, so items gated on it open in this clone. Refuses while BACKLOG.md on the default branch still has a heading for the ID or a Highest ID used below it, or while a branch or worktree named for the ID has commits the default branch lacks.',
    inputSchema: object({ id: ID_SCHEMA }, ['id']),
  },
  {
    name: 'park_item',
    description: 'Append an open item, with its sub-items, to the parked file, then delete it from the backlog. A repeated call after an interruption finishes the delete.',
    inputSchema: object({ id: ID_SCHEMA, path: PATH }, ['id']),
  },
  {
    name: 'decline_item',
    description: 'Append an open item, with its sub-items, to the declined file, then delete it from the backlog. A repeated call after an interruption finishes the delete.',
    inputSchema: object({ id: ID_SCHEMA, path: PATH }, ['id']),
  },
  {
    name: 'reactivate_item',
    description: 'Move a parked or declined item, with its sub-items, into the backlog at a position, and report any problem it has as a backlog item.',
    inputSchema: object({ id: ID_SCHEMA, position: POSITION_SCHEMA, path: PATH }, ['id', 'position']),
  },
]

type Edit = { repo: Repo; lock: Lock; texts: Texts; ctx: Ctx; out: string[]; at: (f: FileName) => string; date: string; local: boolean }

const fail = (message: string): never => { throw new Error(message) }
const topOf = (id: string) => Number(/\d+/.exec(id)![0])
const pad = (n: number) => String(n).padStart(2, '0')
const or = (xs: string[]) => `${xs.slice(0, -1).join(', ')}, and ${xs.at(-1)}`

// The checkout to change: the primary checkout, or on a tracked backlog the
// worktree that has the given BACKLOG.md.
function rootOf(repo: Repo, path: unknown): string {
  if (path === undefined) return repo.main
  if (typeof path !== 'string') fail('path is not text')
  const { root, file } = placeOf(repo, path as string)
  if (file !== 'backlog') fail(`${path} is not the backlog file: pass the path of ${repo.paths!.backlog}`)
  if (repo.kind === 'local-only' && root !== repo.main) fail(`a local-only backlog is only in the primary checkout, ${repo.main}`)
  return root
}

async function editing($: any, e: any, fn: (x: Edit) => Promise<void>): Promise<string> {
  const repo = await facts($)
  if (!repo) fail('not inside a git repository')
  if (repo!.kind !== 'local-only' && repo!.kind !== 'tracked') fail(`the write tools refuse while the kind is ${repo!.kind}${MIGRATION[repo!.kind] ? `. ${MIGRATION[repo!.kind]}` : ''}`)
  const root = rootOf(repo!, e.path)
  return withLock($, repo!, async lock => {
    const out = await settleLocked($, repo!, lock)
    const { texts, ctx } = await load($, repo!, root)
    const file = problemsOf(ctx).filter(p => p.level === 'file')
    if (file.length) fail(`the backlog files have file-level problems, so nothing was written:\n${problemLines(repo!, file).join('\n')}`)
    const d = new Date(await $.clock.now())
    await fn({
      repo: repo!, lock, texts, ctx, out, at: f => `${root}/${repo!.paths![f]}`, local: repo!.kind === 'local-only',
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    })
    return out.join('\n')
  })
}

// Each file in the order given, so a move's target reads back before its source changes.
async function write($: any, x: Edit, files: [FileName, string][]): Promise<void> {
  x.out.push(...(await writeFiles($, x.repo, x.lock, files.map(([f, text]) => ({ path: x.at(f), text: tidy(text) })))))
}

// Inputs

function oneLine(v: unknown, what: string): string {
  if (typeof v !== 'string' || !v.trim()) fail(`${what} is empty`)
  if (/[\r\n]/.test(v as string)) fail(`${what} is more than one line`)
  return (v as string).trim()
}

// Prose for an item or a record. A heading of level 1 to 3 would end the item.
function prose(v: unknown, what: string): string {
  if (v === undefined) return ''
  if (typeof v !== 'string') fail(`${what} is not text`)
  const { lines, unclosed } = scan(v as string)
  if (unclosed) fail(`${what} has a fenced block that is not closed`)
  const h = lines.find(l => !l.code && /^ {0,3}#{1,3}(?:[ \t]|$)/.test(l.text))
  if (h) fail(`${what} has a heading of level 1 to 3 on line ${h.n}: an item's prose may use #### and deeper only`)
  return (v as string).replace(/^(?:[ \t]*\r?\n)+/, '').trimEnd()
}

function keyOf(v: unknown): string {
  if (typeof v !== 'string' || !KEYS.includes(v)) fail(`not a field key: ${JSON.stringify(v)}. The keys are ${or(KEYS)}`)
  return v as string
}

function fieldsOf(v: unknown): string[] {
  if (v === undefined) return []
  if (!v || typeof v !== 'object' || Array.isArray(v)) fail('fields is not an object of values by key')
  const given = v as Record<string, unknown>
  for (const k of Object.keys(given)) {
    keyOf(k)
    if (typeof given[k] !== 'string' || !(given[k] as string).trim()) fail(`the ${k} value is empty: leave the key out instead`)
  }
  return KEYS.filter(k => k in given).map(k => `- ${k}: ${oneLine(given[k], `the ${k} value`)}`)
}

const POSITION = new RegExp(`^(?:(top|bottom)|(before|after) (${ID}))$`)
function positionOf(v: unknown): string {
  if (typeof v !== 'string' || !POSITION.test(v.trim())) fail(`a position is "top", "bottom", "before <ID>", or "after <ID>", not ${JSON.stringify(v)}`)
  return (v as string).trim()
}

// Text

const tidy = (t: string) => t.replace(/\n*$/, '\n')
const append = (text: string, block: string) => `${tidy(text)}\n${block}`
const header = (title: string, local: boolean) => `# ${title}${local ? ' (local only)\n\nNever commit or push this file.' : ''}\n`

function render(level: number, id: string, title: string, fields: string[], body: string): string {
  return `${'#'.repeat(level)} ${id}: ${title}\n${fields.length ? `\n${fields.join('\n')}\n` : ''}${body ? `\n${body}\n` : ''}`
}

// `block` at `at`, the start of a heading line or the end of the text, with one blank line on each side.
function insert(text: string, at: number, block: string): string {
  const after = text.slice(at)
  return text.slice(0, at).replace(/\n*$/, '\n\n') + tidy(block) + (after ? `\n${after}` : '')
}
const splice = (text: string, start: number, end: number, block: string) => insert(text.slice(0, start) + text.slice(end), start, block)

// Where a position is among the top-level items, or among a parent's sub-items.
function offsetOf(text: string, items: Item[], position: string, parent?: Item): number {
  const [, end, side, id] = POSITION.exec(position)!
  const siblings = items.filter(i => i.parent === parent?.id && i.level === (parent ? 3 : 2))
  if (end === 'top') return parent ? parent.ownEnd : siblings[0]?.start ?? text.length
  if (end === 'bottom') return parent ? parent.end : text.length
  const to = siblings.find(i => i.id === id) ?? fail(`${id} is not ${parent ? `a sub-item of ${parent.id}` : 'an open item'} in the backlog`)
  return side === 'before' ? to.start : to.end
}

// The item's own section rebuilt with `key` set to `value`, or cleared when
// there is no value; undefined when there is nothing to clear. Other field
// lines and the prose are kept as they are.
function withField(text: string, item: Item, key: string, value?: string): string | undefined {
  const all = scan(text).lines
  const own = all.filter(l => l.at > item.start && l.at < item.ownEnd)
  let k = own.findIndex(l => l.text.trim())
  if (k < 0) k = own.length
  let j = k
  while (j < own.length && own[j].text.trim()) j++
  const block = own.slice(k, j)
  const isList = block.length > 0 && block.every(l => !l.code && fieldLine(l.text))
  const lines = isList ? block.map(l => l.text) : []
  const hits = lines.flatMap((l, i) => (fieldLine(l)!.key === key ? [i] : []))
  if (!hits.length && value === undefined) return undefined
  const set = value === undefined ? [] : [`- ${key}: ${value}`]
  // Of a key set twice, only the first line is kept.
  const fields = hits.length ? lines.flatMap((l, i) => (i === hits[0] ? set : hits.includes(i) ? [] : [l])) : [...lines, ...set]
  const bodyAt = (isList ? own[j] : own[0])?.at ?? item.ownEnd
  const body = text.slice(bodyAt, item.ownEnd).replace(/^(?:[ \t]*\r?\n)+/, '').trimEnd()
  const head = all.find(l => l.at === item.start)!.text
  return splice(text, item.start, item.ownEnd, `${head}\n${fields.length ? `\n${fields.join('\n')}\n` : ''}${body ? `\n${body}\n` : ''}`)
}

const itemOf = (ctx: Ctx, id: string) => ctx.backlog.items.find(i => i.id === id) ?? fail(`${id} is not in the backlog`)

// The tools

async function writeItem($: any, e: any): Promise<string> {
  if (e.parent !== undefined && e.id !== undefined) fail('pass parent for a new sub-item, or id, not both')
  const parentId = e.parent === undefined ? undefined : checkId(e.parent)
  const id = parentId ? '' : checkId(e.id)
  const title = oneLine(e.title, 'title')
  const fields = fieldsOf(e.fields)
  const body = prose(e.body, 'body')
  const position = e.position === undefined ? undefined : positionOf(e.position)
  return editing($, e, async x => {
    const { ctx, repo, out } = x
    const items = ctx.backlog.items
    let text = x.texts.backlog!
    if (parentId) {
      const parent = items.find(i => i.id === parentId && i.level === 2) ?? fail(`${parentId} is not an open top-level item in the backlog`)
      const at = offsetOf(text, items, position ?? 'bottom', parent)
      // D5: one past every Rn.m in the files, the refs, and the headings deleted on the default branch.
      const used = [...items.map(i => i.id), ...[ctx.parked, ctx.declined, ctx.changelog].flatMap(hs => hs?.flatMap(h => h.ids) ?? []),
        ...repo.reserved, ...repo.closed, ...(ctx.deletedOnDefault ?? [])]
      const { id: sub, lines } = await reserve($, repo, `${parentId}.`, Number(nextSubId(parentId, { ids: used }).split('.')[1]))
      out.push(...lines)
      text = insert(text, at, render(3, sub, title, fields, body))
    } else if (position === undefined) {
      const old = items.find(i => i.id === id) ?? fail(`${id} is not in the backlog: a new item needs a position`)
      if (e.fields === undefined || e.body === undefined) fail('a replacement replaces the fields and the body: pass both, {} and "" for none')
      text = splice(text, old.start, old.ownEnd, render(old.level, id, title, fields, body))
    } else {
      if (items.some(i => i.id === id)) fail(`${id} is already in the backlog: to replace its text, call again with no position`)
      if (id.includes('.')) fail(`${id} is a sub-item ID: a new sub-item is written with parent, and gets the next free ID`)
      const where = (['parked', 'declined', 'changelog'] as const).find(f => ctx[f]?.some(h => h.ids.includes(id)))
      if (where === 'parked' || where === 'declined') fail(`${id} is in the ${where} file: reactivate it with reactivate_item`)
      if (where || repo.closed.includes(id) || ctx.deletedOnDefault?.has(id)) fail(`${id} was used before, and an ID is never used twice`)
      if (!repo.reserved.includes(id)) fail(`${id} is not reserved: call reserve_id first`)
      text = insert(text, offsetOf(text, items, position), render(2, id, title, fields, body))
      // reserve_id raises the line on a local-only backlog only. On a tracked one it is raised here, on the item's branch.
      if (topOf(id) > (ctx.backlog.highest ?? 0)) {
        text = text.replace(/(Highest ID used:\s*`?[A-Z]+)\d+/, `$1${topOf(id)}`)
        out.push(`Highest ID used: R${topOf(id)}`)
      }
    }
    await write($, x, [['backlog', text]])
  })
}

async function setField($: any, e: any): Promise<string> {
  const id = checkId(e.id)
  const key = keyOf(e.key)
  const value = e.value === undefined || e.value === null || e.value === '' ? undefined : oneLine(e.value, 'value')
  return editing($, e, async x => {
    const text = withField(x.texts.backlog!, itemOf(x.ctx, id), key, value)
    if (text === undefined) x.out.push(`${id} has no ${key} field, so nothing was written`)
    else await write($, x, [['backlog', text]])
  })
}

async function moveItem($: any, e: any): Promise<string> {
  const id = checkId(e.id)
  const position = positionOf(e.position)
  return editing($, e, async x => {
    const item = itemOf(x.ctx, id)
    const text = x.texts.backlog!
    const rest = text.slice(0, item.start) + text.slice(item.end)
    const items = parseBacklog(rest).items
    const parent = items.find(i => i.id === item.parent)
    await write($, x, [['backlog', insert(rest, offsetOf(rest, items, position, parent), item.text)]])
  })
}

async function recordProgress($: any, e: any): Promise<string> {
  const id = checkId(e.id)
  if (e.status !== 'PR-READY' && e.status !== 'FILED') fail(`status is PR-READY or FILED, not ${JSON.stringify(e.status)}: close_item writes the final record`)
  const branch = oneLine(e.branch, 'branch')
  const record = prose(e.record, 'record')
  return editing($, e, async x => {
    if (!x.local) fail('a tracked backlog has no changelog: its item stays open until close_item')
    const item = itemOf(x.ctx, id)
    const changelog = append(x.texts.changelog ?? header('Changelog', true), `## ${id}: ${item.title} (${e.status}, ${x.date})\n${record ? `\n${record}\n` : ''}`)
    await write($, x, [['changelog', changelog], ['backlog', withField(x.texts.backlog!, item, 'Branch', branch)!]])
  })
}

async function closeItem($: any, e: any): Promise<string> {
  const id = checkId(e.id)
  if (e.status === 'PR-READY' || e.status === 'FILED') fail('a PR-READY or FILED record keeps the item open: call record_progress')
  if (e.status !== undefined && !CLOSING.includes(e.status)) fail(`status is one of ${or(CLOSING)}, not ${JSON.stringify(e.status)}`)
  const record = prose(e.record, 'record')
  return editing($, e, async x => {
    const { ctx, out } = x
    if (!x.local && (e.status !== undefined || e.record !== undefined)) fail('a tracked backlog has no changelog, and the deletion is the done-record: call again with no status or record')
    const item = ctx.backlog.items.find(i => i.id === id)
    if (!item) {
      const h = ctx.changelog?.find(h => h.ids.includes(id))
      fail(`${id} is not in the backlog${h ? `. The changelog has a record for it at line ${h.line}` : ''}`)
    }
    const { text, removed } = deleteItem(x.texts.backlog!, id)
    const writes: [FileName, string][] = []
    if (x.local) {
      const status = e.status ?? 'DONE'
      // D5: a record for the ID with this status is this call's own first write,
      // from a call that was interrupted before the delete.
      const done = ctx.changelog?.find(h => h.ids.length === 1 && h.ids[0] === id && h.status === status)
      if (done) out.push(`record: the changelog already has a ${status} record for ${id} at line ${done.line}, from an earlier call, so it was not written again`)
      else {
        const subs = ctx.backlog.items.filter(i => i.parent === id).map(s => `\n### ${s.id}: ${s.title}\n`).join('')
        writes.push(['changelog', append(x.texts.changelog ?? header('Changelog', true), `## ${id}: ${item!.title} (${status}, ${x.date})\n${record ? `\n${record}\n` : ''}${subs}`)])
      }
    }
    await write($, x, [...writes, ['backlog', text]])
    out.push('removed:', ...removed)
  })
}

async function moveOut($: any, e: any, to: 'parked' | 'declined'): Promise<string> {
  const id = checkId(e.id)
  return editing($, e, async x => {
    const { ctx, out } = x
    const item = ctx.backlog.items.find(i => i.id === id)
    if (!item) {
      const h = ctx[to]?.find(h => h.ids.includes(id))
      fail(`${id} is not in the backlog${h ? `. It is in the ${to} file at line ${h.line}` : ''}`)
    }
    const { text, removed } = deleteItem(x.texts.backlog!, id)
    // D5: the item's text in the target is this call's own first write.
    const there = ctx[to]?.find(h => h.ids.length === 1 && h.ids[0] === id && h.text.trimEnd() === item!.text.trimEnd())
    const writes: [FileName, string][] = []
    if (there) out.push(`${x.at(to)} already has ${id} with the same text, from an earlier call, so it was not written again`)
    else writes.push([to, append(x.texts[to] ?? header(to === 'parked' ? 'Parked' : 'Declined', x.local), item!.text)])
    await write($, x, [...writes, ['backlog', text]])
    out.push('removed:', ...removed)
  })
}

async function reactivate($: any, e: any): Promise<string> {
  const id = checkId(e.id)
  const position = positionOf(e.position)
  return editing($, e, async x => {
    const { ctx, out } = x
    const from = (['parked', 'declined'] as const).find(f => ctx[f]?.some(h => h.ids.includes(id))) ?? fail(`${id} is in neither the parked nor the declined file`)
    const hs = ctx[from]!.filter(h => h.ids.includes(id))
    const range = hs.find(h => h.ids.length > 1)
    if (range) fail(`${id} is in a heading for more than one ID in the ${from} file, line ${range.line}: split it by hand first`)
    // The heading's level follows the ID, since the parked and declined files have sub-items without parents.
    const block = hs[0].text.replace(/^ {0,3}#+/, id.includes('.') ? '###' : '##')
    const source = deleteItem(x.texts[from]!, id).text
    const items = ctx.backlog.items
    if (items.some(i => i.id === id)) {
      // Any other text there is a file-level problem, refused above.
      out.push(`the backlog already has ${id} with the same text, from an earlier call, so it was not written again`)
      return write($, x, [[from, source]])
    }
    const parentId = id.includes('.') ? id.split('.')[0] : undefined
    const parent = parentId && (items.find(i => i.id === parentId) ?? fail(`${id} is a sub-item, and its parent ${parentId} is not open in the backlog: reactivate the parent first`))
    const text = insert(x.texts.backlog!, offsetOf(x.texts.backlog!, items, position, parent || undefined), block)
    await write($, x, [['backlog', text], [from, source]])
    const found = parseBacklog(tidy(text)).problems.filter(p => p.id === id || p.id?.startsWith(`${id}.`))
    if (found.length) out.push(`${id} was checked as a backlog item, and has these problems:`, ...problemLines(x.repo, found))
  })
}

// D5: refuses until the landing is seen on the default branch, then moves the
// item's reservation refs, so its gate opens in this clone after a squash merge.
async function confirmLanded($: any, e: any): Promise<string> {
  const id = checkId(e.id)
  return editing($, e, async x => {
    const { repo, out } = x
    if (x.local) fail('a local-only backlog has no default branch to confirm against: close_item is the last step')
    const mine = (s: string) => s === id || s.startsWith(`${id}.`)
    const not = ', so the landing is not confirmed'
    const onDefault = parseBacklog(await git($, repo.main, 'show', `${repo.defaultRef}:BACKLOG.md`))
    const still = onDefault.items.map(i => i.id).filter(mine)
    if (still.length) fail(`BACKLOG.md on ${repo.defaultRef} still has a heading for ${still.join(', ')}${not}`)
    if ((onDefault.highest ?? 0) < topOf(id)) fail(`BACKLOG.md on ${repo.defaultRef} has ${onDefault.highest === undefined ? 'no Highest ID used line' : `Highest ID used R${onDefault.highest}, below ${id}`}${not}`)
    const flying = [...repo.inFlight].filter(mine)
    if (flying.length) fail(`a branch or worktree named for ${flying.join(', ')} has commits ${repo.defaultRef} lacks${not}`)
    // The closed ref is created first, so an interruption between the two leaves both refs, and the gate reads that as closed.
    for (const r of repo.reserved.filter(mine)) {
      const oid = (await git($, repo.main, 'rev-parse', '-q', '--verify', `refs/backlog/ids/${r}`)).trim()
      await create($, repo, `refs/backlog/closed/${r}`, oid)
      const d = await run($, repo.main, ['update-ref', '-d', `refs/backlog/ids/${r}`, oid])
      if (d.exitCode !== 0) fail(`git update-ref -d refs/backlog/ids/${r} in ${repo.main}: ${why(d)}`)
      out.push(`moved refs/backlog/ids/${r} to refs/backlog/closed/${r}`)
    }
    if (repo.reserved.includes(id)) return
    if (repo.closed.includes(id)) return void out.push(`refs/backlog/closed/${id} is already there, so nothing was moved`)
    // The ID was reserved in another clone, and the checks above show that it landed.
    await create($, repo, `refs/backlog/closed/${id}`, await blob($, repo.main, [`session ${await $.session.id().catch(() => '')}`, `time ${await $.clock.now()}`]))
    out.push(`created refs/backlog/closed/${id}: this clone has no reservation ref for ${id}`)
  })
}

export function writeTools(on: any) {
  const tool = (name: string) => ({ tool: `mcp__backlog-skills__${name}` })
  on('tool.call', tool('write_item'), async ($: any, e: any) => answer('write_item', () => writeItem($, e)))
  on('tool.call', tool('set_field'), async ($: any, e: any) => answer('set_field', () => setField($, e)))
  on('tool.call', tool('move_item'), async ($: any, e: any) => answer('move_item', () => moveItem($, e)))
  on('tool.call', tool('record_progress'), async ($: any, e: any) => answer('record_progress', () => recordProgress($, e)))
  on('tool.call', tool('close_item'), async ($: any, e: any) => answer('close_item', () => closeItem($, e)))
  on('tool.call', tool('confirm_landed'), async ($: any, e: any) => answer('confirm_landed', () => confirmLanded($, e)))
  on('tool.call', tool('park_item'), async ($: any, e: any) => answer('park_item', () => moveOut($, e, 'parked')))
  on('tool.call', tool('decline_item'), async ($: any, e: any) => answer('decline_item', () => moveOut($, e, 'declined')))
  on('tool.call', tool('reactivate_item'), async ($: any, e: any) => answer('reactivate_item', () => reactivate($, e)))
}
