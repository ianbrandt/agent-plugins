// IDs written without their titles (design D7). An item is cited as `ID: Title`.
import { sent } from './command'
import { GROUP, KEYS, idList, idsIn, scan } from './format'
import { facts, filesOf, readTexts } from './repo'

const FIELD_LINE = new RegExp(`^\\s*(?:[-*+]\\s+)?(?:${KEYS.join('|')}):`)

// Each ID in `known` that appears in `text` without its title, in order, once.
export function bareIds(text: string, known: Set<string>): string[] {
  const prose = scan(text).lines
    .filter(l => !l.code && !FIELD_LINE.test(l.text))
    .map(l => l.text)
    .join('\n')
    // A code span ends in its paragraph. shortcut: it closes on the next run of as many backticks, not of exactly as many.
    .replace(/(`+)(?:(?!\n[ \t]*\n)[\s\S])*?\1/g, ' ')
  const cited = new Set<string>()
  const bare: string[] = []
  for (const m of prose.matchAll(new RegExp(GROUP, 'g'))) {
    const titled = /^:[ \t]+\S/.test(prose.slice(m.index! + m[0].length))
    // Every ID in a cited range counts as cited. In a bare one, only the IDs written are reported.
    for (const id of (titled && idList(m[0])) || idsIn(m[0])) {
      if (!known.has(id)) continue
      if (titled) cited.add(id)
      else if (!cited.has(id) && !bare.includes(id)) bare.push(id)
    }
  }
  return bare
}

// Each ID in the backlog files and the changelog, with its title. On a tracked
// backlog an item is written on its branch, so the files of the worktree each
// directory is in are read too. undefined when the repo has no backlog.
export async function knownIds($: any, dirs: (string | undefined)[]): Promise<Map<string, string> | undefined> {
  const repo = await facts($)
  if (!repo?.paths) return undefined
  const roots = new Set([repo.main])
  for (const d of dirs.map(d => d?.replace(/\\/g, '/'))) {
    const w = repo.worktrees.filter(w => d && (d === w.path || d.startsWith(`${w.path}/`))).sort((a, b) => b.path.length - a.path.length)[0]
    if (w && repo.kind === 'tracked') roots.add(w.path)
  }
  const known = new Map<string, string>()
  for (const root of roots) {
    const texts = await readTexts($, repo.paths, root).catch(err => { if (root === repo.main) throw err })
    if (!texts) continue
    const f = filesOf(texts)
    for (const i of f.backlog.items) known.set(i.id, i.title)
    for (const h of [f.parked, f.declined, f.changelog].flatMap(hs => hs ?? [])) {
      for (const id of h.ids) if (!known.has(id)) known.set(id, h.title.replace(/\s*\([^()]*\)\s*$/, ''))
    }
  }
  return known
}

const cited = (ids: string[], known: Map<string, string>) => ids.map(id => `\`${id}: ${known.get(id) || 'Title'}\``).join(', ')

// The two checks of D7. A reply is read when the turn ends, and the note goes
// with the next prompt. A commit message or a PR's text is read before the
// command runs, in a subagent's calls too.
// shortcut: kept in memory, so a hot reload between a reply and the next prompt drops its note; move it to $.state if that shows up.
const notes = new Map<string, string>()

// The note on the last reply in this session, once.
export async function replyNote($: any): Promise<string | undefined> {
  const session = await $.session.id().catch(() => '')
  const note = notes.get(session)
  notes.delete(session)
  return note
}

export function citations(on: any) {
  on('turn.complete', async ($: any, e: any, next: any) => {
    if (e.agentId || e.reason !== 'answer') return next(e)
    const session = await $.session.id().catch(() => '')
    notes.delete(session)
    const answer = String(e.answer ?? '')
    if (idsIn(answer).length) {
      const known = await knownIds($, [await $.session.cwd().catch(() => undefined)]).catch(() => undefined)
      const bare = known ? bareIds(answer, new Set(known.keys())) : []
      if (bare.length) notes.set(session, `BACKLOG CITATION NOTE: in the last reply, ${bare.join(', ')} appeared without a title. Cite an item as \`ID: Title\`, here ${cited(bare, known!)}, never as a bare ID: the user is not reading the backlog beside the conversation.`)
    }
    return next(e)
  })
  on('tool.call', { tool: 'Bash' }, command)
  on('tool.call', { tool: 'PowerShell' }, command)
}

// Refuses a commit or a PR with a bare ID in its text, before it runs.
async function command($: any, e: any, next: any) {
  const cwd = await $.session.cwd().catch(() => undefined)
  const found = sent(String(e.command ?? ''), e.tool === 'PowerShell' ? 'pwsh' : 'bash', cwd)
  const said: string[] = []
  const refused: string[] = []
  let known: Map<string, string> | undefined | null = null
  for (const s of found) {
    const texts = [...s.texts]
    for (const f of s.files) {
      const t = await $.fs.read(f).catch(() => undefined)
      if (t === undefined) s.unread.push(`${f} could not be read`)
      else texts.push(String(t))
    }
    // A value that cannot be read may hold the title of an ID cited later, so the whole text passes.
    if (s.unread.length) { said.push(`backlog-skills did not check ${s.what} for bare item IDs: ${[...new Set(s.unread)].join('; ')}.`); continue }
    const text = texts.join('\n\n')
    if (!idsIn(text).length) continue
    if (known === null) {
      known = await knownIds($, [cwd, ...found.map(f => f.dir)]).catch(err => {
        said.push(`backlog-skills did not check ${s.what} for bare item IDs: the backlog could not be read: ${(err as Error).message}`)
        return undefined
      })
    }
    const bare = known ? bareIds(text, new Set(known.keys())) : []
    if (bare.length) refused.push(`In ${s.what}, ${bare.join(', ')} appeared without a title: write ${cited(bare, known!)}`)
  }
  if (refused.length) return { deny: `Not run. ${refused.join('. ')}. Cite each item as \`ID: Title\`, never as a bare ID, and run the command again.` }
  const ran = await next(e)
  return said.length && ran.deny === undefined ? { ...ran, context: [...(ran.context ?? []), said.join('\n')] } : ran
}
