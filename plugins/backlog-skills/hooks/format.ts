// The backlog files' format (design D4), the gate on `Gated by`, and the next
// free ID. Plain functions over text, with no I/O.

export const KEYS = ['Touches', 'Gated by', 'Needs', 'Branch', 'Check']
export const ID = '[A-Z]+\\d+(?:\\.\\d+)?'
// On a word boundary, so R12 matches neither inside R120 nor as the start of R12.3.
const BOUNDED = `(?<!\\w)${ID}(?!\\w|\\.\\d)`
export const idsIn = (text: string): string[] => text.match(new RegExp(BOUNDED, 'g')) ?? []
const top = (id: string) => Number(/\d+/.exec(id)![0])

export type Line = { text: string; at: number; n: number; code: boolean }
export type FileName = 'backlog' | 'parked' | 'declined' | 'changelog'
// `line` is a line of `file`.
export type Problem = { level: 'file' | 'item' | 'warning'; file?: FileName; id?: string; line: number; message: string }
export type Item = {
  id: string; title: string; level: 2 | 3; parent?: string; fields: Record<string, string>
  line: number; start: number; end: number; ownEnd: number; text: string
}
export type Backlog = { title?: string; banner?: string; highest?: number; items: Item[]; problems: Problem[] }
export type Heading = { ids: string[]; level: 2 | 3; line: number; title: string; status?: string; text: string }

// Splits text into lines and marks each line of a fenced block, its fences
// included, as code. The fence rules are deleteItem's in item.ts.
export function scan(text: string): { lines: Line[]; unclosed?: number } {
  const lines: Line[] = []
  let fence = ''
  let opened = 0
  let at = 0
  let n = 0
  for (const raw of text.split('\n')) {
    n++
    let code = !!fence
    if (fence) {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t\r]*$/.exec(raw)?.[1]
      if (close && close[0] === fence[0] && close.length >= fence.length) fence = ''
    } else {
      const open = /^ {0,3}(?:(`{3,})[^`]*|(~{3,}.*))$/.exec(raw)
      if (open) {
        fence = open[1] ?? open[2].match(/^~+/)![0]
        opened = n
        code = true
      }
    }
    lines.push({ text: raw.replace(/\r$/, ''), at, n, code })
    at += raw.length + 1
  }
  return { lines, unclosed: fence ? opened : undefined }
}

// Every `#` to `###` heading outside a fenced block, with the end of its section:
// the next heading of the same or a higher level.
function headings(text: string, lines: Line[]) {
  const heads = lines.flatMap(line => {
    const h = line.code ? null : /^ {0,3}(#{1,3})(?:[ \t]+(.*?))?[ \t]*$/.exec(line.text)
    return h ? [{ line, level: h[1].length, rest: h[2] ?? '' }] : []
  })
  return heads.map((h, i) => ({
    ...h,
    next: heads[i + 1]?.line.at ?? text.length,
    end: heads.slice(i + 1).find(x => x.level <= h.level)?.line.at ?? text.length,
  }))
}

const FIELD = /^- ([A-Za-z][A-Za-z ]*?):(?:[ \t]+(.*?))?[ \t]*$/
const SHAPED = new RegExp(`^\\s*[-*+] (?:${KEYS.join('|')}):`)
const NEEDS = /needs the user/i

export function parseBacklog(text: string): Backlog {
  const { lines, unclosed } = scan(text)
  const problems: Problem[] = []
  const add = (level: Problem['level'], line: number, message: string, id?: string) => problems.push({ level, file: 'backlog', id, line, message })
  if (unclosed) add('file', unclosed, 'a fenced block is not closed')
  for (const l of lines) if (!l.code && /^(?:<{7}|>{7}|\|{7})(?: |$)|^={7}$/.test(l.text)) add('file', l.n, 'a merge conflict marker')

  const heads = headings(text, lines)
  const first = lines.find(l => l.text.trim())
  const titled = heads[0]?.level === 1 && heads[0].line === first
  const out: Backlog = { title: titled ? first!.text : undefined, items: [], problems }

  // Above the first item: the title, and one line with the banner and the highest ID.
  const itemsAt = heads[titled ? 1 : 0]?.line.at ?? text.length
  const preamble = lines.filter(l => l.at < itemsAt && l.text.trim() && !(titled && l === first))
  const banner = preamble.find(l => /Highest ID used:/.test(l.text)) ?? preamble[0]
  if (banner) {
    out.banner = banner.text
    const h = /Highest ID used:\s*`?[A-Z]+(\d+)/.exec(banner.text)
    if (h) out.highest = Number(h[1])
  }
  const extra = preamble.find(l => l !== banner)
  if (extra) add('warning', extra.n, 'prose above the first item')

  let parent: Item | undefined
  const seen = new Set<string>()
  for (const h of heads) {
    if (titled && h === heads[0]) continue
    const m = new RegExp(`^(${ID}):(?:[ \\t]+(.*))?$`).exec(h.rest)
    const id = m?.[1]
    const sub = id?.includes('.')
    const malformed = !m || h.level === 1 || (h.level === 2 && sub) || (h.level === 3 && (!sub || parent?.id !== id!.split('.')[0]))
    if (malformed) {
      add('file', h.line.n, `a heading that is not an item heading: ${h.line.text.trim()}`)
      if (h.level < 3) parent = undefined
      continue
    }
    if (seen.has(id!)) add('file', h.line.n, `${id} has two headings`, id)
    seen.add(id!)
    const item: Item = {
      id: id!, title: (m[2] ?? '').trim(), level: h.level as 2 | 3, parent: h.level === 3 ? parent!.id : undefined, fields: {},
      line: h.line.n, start: h.line.at, end: h.end, ownEnd: h.next, text: text.slice(h.line.at, h.end),
    }
    if (h.level === 2) parent = item
    out.items.push(item)
    if (!item.title) add('warning', h.line.n, 'an empty title', id)

    // The field list is the first block after the heading; a blank line ends it.
    const body = lines.filter(l => l.at > h.line.at && l.at < h.next)
    let k = body.findIndex(l => l.text.trim())
    if (k < 0) k = body.length
    let j = k
    while (j < body.length && body[j].text.trim()) j++
    const block = body.slice(k, j)
    const isList = block.length > 0 && block.every(l => !l.code && FIELD.test(l.text))
    if (isList) {
      for (const l of block) {
        const [, key, value = ''] = FIELD.exec(l.text)!
        if (!KEYS.includes(key)) add('warning', l.n, `an unknown field key: ${key}`, id)
        else if (key in item.fields) add('item', l.n, `${key} is set twice`, id)
        else item.fields[key] = value
      }
    }
    const rest = isList ? body.slice(j) : body.slice(k)
    const shaped = rest.find(l => !l.code && SHAPED.test(l.text))
    if (shaped) add('item', shaped.n, 'a field list that is not the first block after the heading', id)
    const prose = rest.find(l => !l.code && l.text.trim())
    if ((NEEDS.test(item.title) || (prose && NEEDS.test(prose.text))) && item.fields.Needs?.trim().toLowerCase() !== 'user') {
      add('item', h.line.n, '"needs the user" with no Needs: user field', id)
    }
  }
  problems.sort((a, b) => a.line - b.line)
  return out
}

const STATUS = /\((BUILT-LOCAL|DRAFTED|FILED|PR-READY|MERGED-UPSTREAM|DONE)[,)]/

// The IDs in `R3`, `R3 to R5`, `R3 and R7`, or `R3, R7, and R9`, or none when
// the text is none of these.
function idList(s: string): string[] | undefined {
  const out: string[] = []
  for (const part of s.split(/, and |, | and /)) {
    const [a, b, ...more] = part.split(' to ')
    if (more.length || !new RegExp(`^${ID}$`).test(a)) return undefined
    if (b === undefined) { out.push(a); continue }
    // A range runs over top-level IDs, or over the sub-items of one parent.
    const [pa, na] = /^(.*?)(\d+)$/.exec(a)!.slice(1)
    const r = /^(.*?)(\d+)$/.exec(b)
    if (!r || r[1] !== pa || Number(r[2]) < Number(na) || Number(r[2]) - Number(na) > 1000) return undefined
    for (let n = Number(na); n <= Number(r[2]); n++) out.push(pa + n)
  }
  return out
}

// For the parked, declined, and changelog files: every `##` or `###` heading
// that starts with an ID, a range, or a list of IDs. Any other heading is skipped.
export function parseHeadings(text: string): Heading[] {
  return headings(text, scan(text).lines).flatMap(h => {
    const m = /^([^:]+):(?:[ \t]+(.*))?$/.exec(h.rest)
    const ids = h.level > 1 && m ? idList(m[1]) : undefined
    if (!ids) return []
    const title = (m![2] ?? '').trim()
    return [{ ids, level: h.level as 2 | 3, line: h.line.n, title, status: STATUS.exec(title)?.[1], text: text.slice(h.line.at, h.end) }]
  })
}

export type Files = { backlog: Backlog; parked?: Heading[]; declined?: Heading[]; changelog?: Heading[] }

// The problems that take more than one file to find. The changelog is left out
// of the duplicate check, since an ID there may also be open, parked, or declined.
export function validateFiles(f: Files): Problem[] {
  const problems: Problem[] = []
  const live: [FileName, Heading[]][] = [['parked', f.parked ?? []], ['declined', f.declined ?? []]]
  for (const item of f.backlog.items) {
    for (const [name, hs] of live) {
      const h = hs.find(x => x.ids.includes(item.id))
      if (!h) continue
      const moved = h.ids.length === 1 && h.text.trimEnd() === item.text.trimEnd()
      problems.push(moved
        ? { level: 'item', file: 'backlog', id: item.id, line: item.line, message: `${item.id} is in the backlog and the ${name} file with the same text: a move was interrupted` }
        : { level: 'file', file: 'backlog', id: item.id, line: item.line, message: `${item.id} is in the backlog and the ${name} file (line ${h.line})` })
    }
  }
  for (const h of f.declined ?? []) {
    for (const id of h.ids) {
      if (f.parked?.some(p => p.ids.includes(id))) problems.push({ level: 'file', file: 'declined', id, line: h.line, message: `${id} is in the parked and the declined file (declined line ${h.line})` })
    }
  }
  const all: [FileName, string, number][] = [
    ...f.backlog.items.map(i => ['backlog', i.id, i.line] as [FileName, string, number]),
    ...[...live, ['changelog', f.changelog ?? []] as [FileName, Heading[]]].flatMap(([name, hs]) => hs.flatMap(h => h.ids.map(id => [name, id, h.line] as [FileName, string, number]))),
  ]
  if (f.backlog.highest === undefined) problems.push({ level: 'file', file: 'backlog', line: 1, message: 'no Highest ID used line' })
  else {
    const over = all.filter(([, id]) => top(id) > f.backlog.highest!)
    for (const [name, id, line] of over) problems.push({ level: 'file', file: name, id, line, message: `Highest ID used is R${f.backlog.highest}, below ${id} in the ${name} file (line ${line})` })
  }
  return problems
}

export type Gate = 'open' | 'shut' | 'unknown'
export type Ctx = Files & {
  kind: 'local-only' | 'tracked'
  deletedOnDefault?: Set<string>; closedRefs?: Set<string>; reservedRefs?: Set<string>
  branchIds?: Set<string>; claimIds?: Set<string>; inFlightIds?: Set<string>
}

// D4's steps for resolving `Gated by`. Callers treat 'unknown' as shut.
export function gate(id: string, ctx: Ctx): Gate {
  const listed = (hs?: Heading[]) => !!hs?.some(h => h.ids.includes(id))
  if (ctx.backlog.items.some(i => i.id === id) || listed(ctx.parked) || listed(ctx.declined)) return 'shut'
  if (ctx.kind === 'local-only') {
    // Records are appended, so the last one is the latest: a final record after a PR-READY one opens the gate.
    const last = ctx.changelog?.filter(h => h.ids.includes(id)).at(-1)
    if (last) return ['PR-READY', 'FILED', 'DRAFTED'].includes(last.status ?? '') ? 'shut' : 'open'
  } else {
    if (ctx.deletedOnDefault?.has(id) || ctx.closedRefs?.has(id)) return 'open'
    if (ctx.reservedRefs?.has(id) || ctx.branchIds?.has(id) || ctx.claimIds?.has(id)) return 'shut'
  }
  return 'unknown'
}

const RANK: Gate[] = ['open', 'shut', 'unknown']

// The `list_items` row in D5: whether an item can be picked, and each reason it cannot.
export function claimable(item: Item, ctx: Ctx, { unattended = false } = {}): { gate: Gate; claimable: boolean; reasons: string[] } {
  const reasons: string[] = []
  let worst: Gate = 'open'
  const gatedBy = item.fields['Gated by']
  if (gatedBy !== undefined) {
    const ids = idsIn(gatedBy)
    if (!ids.length) { worst = 'unknown'; reasons.push('Gated by names no ID') }
    for (const id of ids) {
      const g = gate(id, ctx)
      if (g !== 'open') reasons.push(`Gated by ${id}: ${g}`)
      if (RANK.indexOf(g) > RANK.indexOf(worst)) worst = g
    }
  }
  const problems = [...ctx.backlog.problems, ...validateFiles(ctx)]
  if (problems.some(p => p.level === 'file')) reasons.push('a file-level problem in the backlog files')
  for (const p of problems) if (p.level === 'item' && p.id === item.id) reasons.push(p.message)
  if (item.fields.Branch !== undefined) reasons.push('a Branch field')
  if (ctx.inFlightIds?.has(item.id)) reasons.push('a branch or worktree with commits the default branch lacks')
  if (unattended && item.fields.Needs?.trim().toLowerCase() === 'user') reasons.push('Needs: user, in an unattended run')
  return { gate: worst, claimable: reasons.length === 0, reasons }
}

// `claude/r78-foo`, `r78-foo`, and Claude Code's `worktree-r78-foo`: the last path segment starts with the ID.
export function branchId(name: string): string | undefined {
  const m = /(?:^|\/)(?:worktree-)?r(\d+(?:\.\d+)?)(?:-[^/]*)?$/i.exec(name)
  return m ? `R${m[1]}` : undefined
}

export type IdSources = { highest?: number; ids?: Iterable<string>; branches?: Iterable<string> }

// Every R-ID in `ids` (each may be any text, such as a heading, a ref, or a claim) and in the branch names.
function rIds(s: IdSources): string[] {
  return [...[...s.ids ?? []].flatMap(idsIn), ...[...s.branches ?? []].flatMap(b => branchId(b) ?? [])].filter(id => /^R\d/.test(id))
}

export function nextId(s: IdSources): string {
  return `R${Math.max(s.highest ?? 0, ...rIds(s).map(top)) + 1}`
}

export function nextSubId(parent: string, s: IdSources): string {
  const subs = rIds(s).filter(id => id.startsWith(parent + '.')).map(id => Number(id.slice(parent.length + 1)))
  return `${parent}.${Math.max(0, ...subs) + 1}`
}
