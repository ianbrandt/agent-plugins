// Facts about the repo read from git and the primary checkout, and the backlog
// files parsed into the context the gates and the claimable check take.
import { type Ctx, type FileName, type Files, GROUP, branchId, idsGrouped, idsIn, parseBacklog, parseHeadings, scan } from './format'
import { type Kind, type Paths, kindOf } from './kind'

export type Run = { exitCode: number; stdout: string; stderr: string; isStdoutTruncated?: boolean }
export type Worktree = { path: string; branch?: string; head?: string }
export type Repo = {
  main: string; common: string; zero: string
  hasUpstream: boolean; tracked: string[]; files: string[]
  // The default branch as a full ref (origin's copy where there is one) and its tip.
  defaultRef: string; tip: string
  // IDs with a ref under refs/backlog/ids/ and refs/backlog/closed/.
  reserved: string[]; closed: string[]
  // Local and origin branch names, and every worktree, the primary checkout first.
  branches: string[]; worktrees: Worktree[]
  inFlight: Set<string>; claimIds: Set<string>
  kind: Kind; paths?: Paths; report: string[]
}

// The first line git wrote for a command that failed, or its exit code: Claude
// Code reports a git that crashed as exit 1 with no output.
export const why = (r: { exitCode: number; stderr: string }) => String(r.stderr).trim().split(/\r?\n/)[0] || `exit ${r.exitCode}`

// git in the primary checkout, which is also the process's directory: nothing
// starts in a worktree a session has removed.
export function run($: any, main: string, argv: string[], stdin?: string): Promise<Run> {
  return $.process.run(['git', '-C', main, ...argv], stdin === undefined ? { cwd: main } : { cwd: main, stdin })
}

export async function git($: any, main: string, ...argv: string[]): Promise<string> {
  const r = await run($, main, argv)
  if (r.exitCode !== 0) throw new Error(`git ${argv.join(' ')} in ${main}: ${why(r)}`)
  // A cut-off list would read as a shorter one.
  if (r.isStdoutTruncated) throw new Error(`git ${argv.join(' ')} in ${main}: the output was cut off`)
  return String(r.stdout)
}

const lines = (s: string) => s.split(/\r?\n/).filter(Boolean)
const base = (p: string) => p.replace(/\\/g, '/').replace(/\/$/, '').split('/').pop() ?? ''
function read($: any, path: string): Promise<string | undefined> {
  return $.fs.read(path).catch(() => undefined)
}

// Refuses a write to `path` when the file, or a directory between `base` and
// it, is a symbolic link: a committed link would send the write outside the repo.
export async function noLink($: any, base: string, path: string): Promise<void> {
  // For a path outside `base`, such as an old marker's backup, only the file is checked.
  let dir = path.startsWith(`${base}/`) ? base : path.replace(/\/[^/]*$/, '')
  for (const part of path.slice(dir.length + 1).split('/')) {
    const listed: any[] = await $.fs.list(dir).catch(() => [])
    if (listed.some(f => f.name === part && f.isLink)) throw new Error(`${dir}/${part} is a symbolic link, so nothing was written through it`)
    dir = `${dir}/${part}`
  }
}

// With -z each field ends in NUL, so a newline in a path stays in it.
function worktreesOf(out: string): Worktree[] {
  const found: Worktree[] = []
  for (const l of out.split('\0')) {
    if (l.startsWith('worktree ')) found.push({ path: l.slice('worktree '.length).replace(/\\/g, '/').replace(/\/$/, '') })
    else if (l.startsWith('HEAD ') && found.length) found[found.length - 1].head = l.slice('HEAD '.length)
    else if (l.startsWith('branch refs/heads/') && found.length) found[found.length - 1].branch = l.slice('branch refs/heads/'.length)
  }
  return found
}

// origin/HEAD where it is set, else main, else master. origin's copy is used
// where there is one: a heading deleted only on a local branch not yet pushed
// leaves the gate shut, and a branch merged only there is still in flight.
function defaultOf(refs: Map<string, string>, symref?: string): string {
  const name = symref?.replace(/^refs\/remotes\/origin\//, '')
  for (const n of name ? [name] : ['main', 'master']) {
    for (const r of [`refs/remotes/origin/${n}`, `refs/heads/${n}`]) if (refs.has(r)) return r
  }
  throw new Error('the default branch is not known: there is no origin/HEAD, main, or master')
}

export async function facts($: any): Promise<Repo | null> {
  const main = (await $.session.repo())?.root?.replace(/\\/g, '/').replace(/\/$/, '')
  if (!main) return null
  const [common, format] = lines(await git($, main, 'rev-parse', '--path-format=absolute', '--git-common-dir', '--show-object-format'))
  // git exits 2 for a remote it does not have. Any other failure throws: a repo
  // not known to be a fork is not known to own its backlog.
  const upstream = await run($, main, ['remote', 'get-url', 'upstream'])
  if (upstream.exitCode !== 0 && upstream.exitCode !== 2) throw new Error(`git remote get-url upstream in ${main}: ${why(upstream)}`)
  const tracked = lines(await git($, main, 'ls-files', '--', 'BACKLOG.md', 'ROADMAP.md', 'docs/roadmap.md'))
  const files = (await $.fs.list(main)).map((f: any) => f.name as string)

  const refs = new Map<string, string>()
  let symref: string | undefined
  for (const l of lines(await git($, main, 'for-each-ref', '--format=%(objectname) %(refname) %(symref)', 'refs/heads', 'refs/remotes/origin', 'refs/backlog'))) {
    const [oid, ref, sym] = l.split(' ')
    if (ref === 'refs/remotes/origin/HEAD') symref = sym || undefined
    else refs.set(ref, oid)
  }
  const under = (prefix: string) => [...refs.keys()].filter(r => r.startsWith(prefix)).map(r => r.slice(prefix.length))
  const branches = [...under('refs/heads/'), ...under('refs/remotes/origin/')]
  const worktrees = worktreesOf(await git($, main, 'worktree', 'list', '--porcelain', '-z'))

  const marker = await markerOf($, common)
  const kindFacts = {
    marker, files, tracked, hasUpstream: upstream.exitCode === 0,
    oldTracked: await oldTracked($, main, tracked),
    backlogOnDefault: undefined as boolean | undefined, branchExists: undefined as boolean | undefined,
  }
  // A repo with no commits has no default branch, and only the migration rows need one before the tip.
  let defaultRef = ''
  let tip = ''
  try { defaultRef = defaultOf(refs, symref); tip = refs.get(defaultRef)! } catch (err) { if (marker?.tracked) throw err }
  if (marker?.tracked) {
    const on = await run($, main, ['cat-file', '-e', `${defaultRef}:BACKLOG.md`])
    if (on.exitCode !== 0 && on.exitCode !== 128) throw new Error(`git cat-file -e ${defaultRef}:BACKLOG.md in ${main}: ${why(on)}`)
    kindFacts.backlogOnDefault = on.exitCode === 0
    kindFacts.branchExists = !!marker.branch && refs.has(`refs/heads/${marker.branch}`)
  }
  const { kind, paths, report } = kindOf(kindFacts)
  if (kind === 'local-only' || kind === 'tracked') defaultOf(refs, symref)

  return {
    main, common: common.replace(/\\/g, '/').replace(/\/$/, ''), zero: '0'.repeat(format === 'sha256' ? 64 : 40),
    hasUpstream: upstream.exitCode === 0, tracked, files, defaultRef, tip,
    reserved: under('refs/backlog/ids/'), closed: under('refs/backlog/closed/'), branches, worktrees,
    inFlight: defaultRef ? await inFlight($, main, defaultRef, worktrees) : new Set(),
    claimIds: await claimIds($, main, worktrees),
    kind, paths, report,
  }
}

// The marker migrate_backlog writes. One that does not parse is a migration
// that did not finish.
async function markerOf($: any, common: string): Promise<{ complete: boolean; tracked: boolean; branch?: string } | undefined> {
  const text = await read($, `${common}/backlog/migration/marker.json`)
  if (text === undefined) return undefined
  try {
    const m = JSON.parse(text)
    return { complete: m.complete === true, tracked: m.tracked === true, branch: typeof m.branch === 'string' ? m.branch : undefined }
  } catch {
    return { complete: false, tracked: false }
  }
}

// A tracked ROADMAP.md or docs/roadmap.md with an Rn item heading or a Highest
// ID used line. One that cannot be read counts, so a migration is offered.
async function oldTracked($: any, main: string, tracked: string[]): Promise<string[]> {
  const old: string[] = []
  for (const p of tracked.filter(t => t !== 'BACKLOG.md')) {
    const text = await read($, `${main}/${p}`)
    if (text === undefined || /^ {0,3}#{2,3}[ \t]+R\d+|Highest ID used/m.test(text)) old.push(p)
  }
  return old
}

// IDs of branches and worktrees named for an ID that have commits the default
// branch lacks. A worktree's directory counts as well as its branch.
async function inFlight($: any, main: string, defaultRef: string, worktrees: Worktree[]): Promise<Set<string>> {
  const unmerged = lines(await git($, main, 'for-each-ref', '--format=%(refname)', `--no-merged=${defaultRef}`, 'refs/heads', 'refs/remotes/origin'))
    .map(r => r.replace(/^refs\/(heads|remotes\/origin)\//, ''))
  const ids = new Set(unmerged.flatMap(b => branchId(b) ?? []))
  for (const w of worktrees.slice(1)) {
    const id = branchId(base(w.path))
    if (!id || ids.has(id)) continue
    if (w.branch) { if (unmerged.includes(w.branch)) ids.add(id); continue }
    if (!w.head) continue
    const r = await run($, main, ['merge-base', '--is-ancestor', w.head, defaultRef])
    if (r.exitCode === 1) ids.add(id)
    else if (r.exitCode !== 0) throw new Error(`git merge-base --is-ancestor ${w.head} ${defaultRef} in ${main}: ${why(r)}`)
  }
  return ids
}

export type Claim = { file: string; branch: string; item: string }

// The live claims in parallel-session-skills' ledger, where there is one. A
// claim is live while a worktree has its branch checked out, and every claim is
// while any worktree is detached, per the ledger's rule. A file that
// does not parse may be a claim being written, and is listed as unread.
export async function claims($: any, main: string, worktrees: Worktree[]): Promise<{ live: Claim[]; unread: string[] }> {
  const dir = `${main}/.claude/claims`
  const listed: any[] = await $.fs.list(dir).catch(() => [])
  const branches = worktrees.map(w => w.branch)
  const detached = worktrees.some(w => !w.branch)
  const out = { live: [] as Claim[], unread: [] as string[] }
  for (const f of listed.filter(f => f.kind === 'file' && f.name.endsWith('.json'))) {
    let c: any
    try { c = JSON.parse((await read($, `${dir}/${f.name}`)) ?? '') } catch {}
    if (!c || typeof c.branch !== 'string') out.unread.push(f.name)
    else if (detached || branches.includes(c.branch)) out.live.push({ file: f.name, branch: c.branch, item: String(c.item ?? '') })
  }
  return out
}

// IDs in the live claims, from each claim's item text and its branch name.
async function claimIds($: any, main: string, worktrees: Worktree[]): Promise<Set<string>> {
  const ids = new Set<string>()
  for (const c of (await claims($, main, worktrees)).live) for (const id of [...idsIn(c.item), branchId(c.branch) ?? '']) if (id) ids.add(id)
  return ids
}

// The IDs with a ## or ### heading deleted on the default branch, in the
// backlog or an old roadmap path, cached by the default branch's tip.
export async function deletedOnDefault($: any, repo: Repo): Promise<Set<string>> {
  const cache = `${repo.common}/backlog/deleted.json`
  try {
    const c = JSON.parse((await read($, cache)) ?? '')
    if (c.tip === repo.tip && Array.isArray(c.ids)) return new Set(c.ids)
  } catch {}
  const out = await git($, repo.main, 'log', '-p', '-U0', '--format=', '-G^#', repo.defaultRef, '--', 'BACKLOG.md', 'ROADMAP.md', 'docs/roadmap.md')
  // Old roadmaps also have headings such as `### R12—Title`, so the heading's leading IDs count, whatever follows them.
  const led = new RegExp(`^-#{2,3}[ \\t]+(${GROUP})`)
  const ids = new Set(lines(out).flatMap(l => led.exec(l)?.[1] ?? []).flatMap(idsGrouped))
  await noLink($, repo.common, cache)
  await $.fs.write(cache, JSON.stringify({ tip: repo.tip, ids: [...ids] }))
  return ids
}

export type Texts = Partial<Record<FileName | 'plan', string>>
export const NAMES: FileName[] = ['backlog', 'parked', 'declined', 'changelog']

// The backlog files under `root` (the primary checkout unless a worktree is
// given), with a missing parked, declined, or changelog file read as none.
export async function readTexts($: any, paths: Paths, root: string): Promise<Texts> {
  const texts: Texts = {}
  for (const name of [...NAMES, 'plan'] as const) {
    const p = paths[name]
    if (p) texts[name] = await read($, `${root}/${p}`)
  }
  if (texts.backlog === undefined) throw new Error(`${root}/${paths.backlog} cannot be read`)
  return texts
}

export const filesOf = (t: Texts): Files => ({
  backlog: parseBacklog(t.backlog ?? ''),
  parked: t.parked === undefined ? undefined : parseHeadings(t.parked),
  declined: t.declined === undefined ? undefined : parseHeadings(t.declined),
  changelog: t.changelog === undefined ? undefined : parseHeadings(t.changelog),
  // D4: a fence left open is a file-level problem in every backlog file. parseBacklog reports the backlog's.
  unclosed: Object.fromEntries((['parked', 'declined', 'changelog'] as const).flatMap(k => {
    const at = t[k] === undefined ? undefined : scan(t[k]!).unclosed
    return at ? [[k, at]] : []
  })),
})

export type Loaded = { texts: Texts; ctx: Ctx }

// Everything format.ts's gate and claimable take, for a repo with a backlog.
export async function load($: any, repo: Repo, root = repo.main): Promise<Loaded> {
  if (!repo.paths) throw new Error(`this repo has no backlog the tools can read: its kind is ${repo.kind}`)
  const texts = await readTexts($, repo.paths, root)
  const tracked = repo.kind === 'tracked'
  return {
    texts,
    ctx: {
      ...filesOf(texts), kind: tracked ? 'tracked' : 'local-only',
      deletedOnDefault: tracked ? await deletedOnDefault($, repo) : undefined,
      closedRefs: new Set(repo.closed), reservedRefs: new Set(repo.reserved),
      branchIds: new Set([...repo.branches, ...repo.worktrees.slice(1).map(w => base(w.path))].flatMap(b => branchId(b) ?? [])),
      claimIds: repo.claimIds, inFlightIds: repo.inFlight,
    },
  }
}
