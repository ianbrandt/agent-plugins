// The git and file system kept in memory that the I/O tests run against.
import { expect } from 'claude-code/testing'

export const MAIN = '/repo'
export const COMMON = '/repo/.git'
export const J = `${COMMON}/backlog/journal`
export const BACKLOG = '# Backlog (local only)\n\nNever commit or push this file. Highest ID used: R2\n\n## R1: One\n\n## R2: Two\n\n- Gated by: R1\n'

type Failed = { exitCode: number; stdout?: string; stderr: string }
// A repo at /repo. `refs` maps a full ref to its object, and `objects` an
// object to its text. `before` runs ahead of every git command and may answer
// it instead. `t` is the clock, moved by each sleep.
export function world(on: any, files: Record<string, string> = { [`${MAIN}/BACKLOG.local.md`]: BACKLOG }) {
  const w = {
    files, t: 1_000_000, slept: [] as number[], git: [] as string[], format: 'sha1',
    upstream: false as boolean | Failed, tracked: [] as string[],
    refs: new Map<string, string>([['refs/heads/main', 'c1']]), originHead: undefined as string | undefined,
    objects: new Map<string, string>(), worktrees: [{ path: MAIN, branch: 'main' }] as { path: string; branch?: string; head?: string }[],
    unmerged: [] as string[], log: '', ancestor: 0,
    // `git show <ref>:<path>`, by its argument.
    shown: {} as Record<string, string>,
    before: undefined as undefined | ((line: string, argv: string[]) => Failed | string | void),
    writes: [] as string[], tear: undefined as undefined | ((path: string, text: string) => string | void),
    onSleep: undefined as undefined | (() => void),
    cwd: MAIN,
    // Paths that fs.list reports as symbolic links.
    links: new Set<string>(),
    // The index and HEAD, by path from a checkout's root, for migrate_backlog's commit.
    head: new Set<string>(), staged: new Set<string>(), commits: [] as { message: string; paths: string[] }[], status: '',
  }
  let n = 0
  const zero = () => '0'.repeat(w.format === 'sha256' ? 64 : 40)
  on('session.repo', () => ({ value: { root: MAIN, remote: null, internal: false } }))
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: w.cwd }))
  on('clock.now', () => ({ value: w.t }))
  on('clock.sleep', (_$: any, e: any) => { w.t += e.ms; w.slept.push(e.ms); w.onSleep?.(); return { value: undefined } })
  const dirOf = (p: string) => p.replace(/\/[^/]*$/, '')
  // On Windows a handler receives the path with a drive letter and backslashes.
  const posix = (p: string) => p.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')
  on('fs.exists', (_$: any, { path }: any) => ({ value: posix(path) in w.files || Object.keys(w.files).some(f => f.startsWith(`${posix(path)}/`)) }))
  on('fs.read', (_$: any, e: any) => {
    const path = posix(e.path)
    if (!(path in w.files)) throw new Error(`ENOENT: ${path}`)
    return { value: w.files[path] }
  })
  on('fs.write', (_$: any, e: any) => {
    const path = posix(e.path)
    w.writes.push(path)
    w.files[path] = w.tear?.(path, e.text) ?? e.text
    return { value: undefined }
  })
  on('fs.list', (_$: any, e: any) => {
    const path = posix(e.path)
    const names = new Map<string, string>()
    for (const f of Object.keys(w.files)) {
      if (!f.startsWith(`${path}/`)) continue
      const rest = f.slice(path.length + 1)
      names.set(rest.split('/')[0], rest.includes('/') ? 'directory' : 'file')
    }
    if (!names.size) throw new Error(`ENOENT: ${path}`)
    return { value: [...names].map(([name, kind]) => ({ name, kind, size: 0, mtimeMs: 0, isLink: w.links.has(`${path}/${name}`) })) }
  })
  on('process.run', (_$: any, e: any) => {
    const argv = e.argv as string[]
    expect(argv.slice(0, 2)).toEqual(['git', '-C'])
    const root = argv[2]
    expect(w.worktrees.map(t => t.path)).toContain(root)
    expect(e.init?.cwd).toBe(root)
    const a = argv.slice(3)
    const line = a.join(' ')
    w.git.push(line)
    const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '' } })
    const fail = (exitCode: number, stderr = 'fatal: no') => ({ value: { exitCode, stdout: '', stderr } })
    const said = w.before?.(line, a)
    if (typeof said === 'string') return ok(said)
    if (said) return { value: { stdout: '', ...said } }
    if (line === 'rev-parse --path-format=absolute --git-common-dir --show-object-format') return ok(`${COMMON}\n${w.format}\n`)
    if (line === 'remote get-url upstream') return typeof w.upstream === 'object' ? { value: { stdout: '', ...w.upstream } } : w.upstream ? ok('u\n') : fail(2)
    const paths = a.slice(a.indexOf('--') + 1)
    if (a[0] === 'ls-files') return ok(w.tracked.filter(t => paths.includes(t)).map(t => `${t}\n`).join(''))
    if (line === 'hash-object --stdin') return ok(`h${[...String(e.init.stdin)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)}\n`)
    if (a[0] === 'check-ignore') {
      const globs = (w.files[`${COMMON}/info/exclude`] ?? '').split('\n').filter(l => l.startsWith('/'))
      const hit = globs.some(g => new RegExp(`^${g.slice(1).replace(/\./g, '\\.').replace(/\*/g, '[^/]*')}$`).test(a[4]))
      return hit ? ok() : fail(1, '')
    }
    if (a[0] === 'clean') {
      const name = a[5].replace(':(top,literal)', '')
      if (!w.tracked.includes(name)) delete w.files[`${root}/${name}`]
      return ok()
    }
    // shortcut: a path already in HEAD is taken as unchanged, since HEAD's content is not kept here.
    if (a[0] === 'add') { for (const p of paths) { if (!w.tracked.includes(p)) w.tracked.push(p); if (!w.head.has(p)) w.staged.add(p) } return ok() }
    if (a[0] === 'rm') {
      for (const p of paths) if (w.tracked.includes(p)) { delete w.files[`${root}/${p}`]; w.tracked = w.tracked.filter(t => t !== p); w.staged.add(p) }
      return ok()
    }
    if (line.startsWith('diff --cached --quiet')) return paths.some(p => w.staged.has(p)) ? fail(1, '') : ok()
    if (a[0] === 'commit') {
      w.commits.push({ message: a[a.indexOf('-m') + 1], paths })
      for (const p of paths) { if (`${root}/${p}` in w.files) w.head.add(p); else w.head.delete(p); w.staged.delete(p) }
      return ok()
    }
    if (a[0] === 'status') return ok(w.status)
    if (line === 'rev-parse HEAD') return ok('c2\n')
    if (a[0] === 'cat-file' && a[1] === '-e' && a[2].startsWith('HEAD:')) return w.head.has(a[2].slice(5)) ? ok() : fail(128)
    if (line.startsWith('for-each-ref --format=%(objectname)')) {
      const rows = [...w.refs].map(([r, o]) => `${o} ${r} \n`)
      if (w.originHead) rows.push(`x refs/remotes/origin/HEAD ${w.originHead}\n`)
      return ok(rows.join(''))
    }
    if (line.startsWith('for-each-ref --format=%(refname) --no-merged=')) return ok(w.unmerged.map(b => `refs/heads/${b}\n`).join(''))
    if (line === 'worktree list --porcelain -z') return ok(w.worktrees.map(t => `worktree ${t.path}\0${t.head ? `HEAD ${t.head}\0` : ''}${t.branch ? `branch refs/heads/${t.branch}\0` : 'detached\0'}\0`).join(''))
    if (line === 'hash-object -w --stdin') {
      const oid = `b${++n}`.padEnd(w.format === 'sha256' ? 64 : 40, '0')
      w.objects.set(oid, e.init.stdin)
      return ok(`${oid}\n`)
    }
    if (a[0] === 'update-ref' && a[1] === '-d') {
      if (w.refs.get(a[2]) !== a[3]) return fail(1)
      w.refs.delete(a[2])
      return ok()
    }
    if (a[0] === 'update-ref') {
      const [, ref, oid, old] = a
      if (/^0+$/.test(old)) expect(old).toHaveLength(zero().length)
      if (old === zero() ? w.refs.has(ref) : w.refs.get(ref) !== old) return fail(128, `fatal: cannot lock ref '${ref}'`)
      w.refs.set(ref, oid)
      return ok()
    }
    if (line.startsWith('rev-parse -q --verify ')) return w.refs.has(a[3]) ? ok(`${w.refs.get(a[3])}\n`) : fail(1, '')
    if (a[0] === 'cat-file' && a[1] === '-p') return w.objects.has(a[2]) ? ok(w.objects.get(a[2])) : fail(128)
    if (a[0] === 'cat-file' && a[1] === '-e') return fail(128)
    if (a[0] === 'log') return ok(w.log)
    if (a[0] === 'show') return a[1] in w.shown ? ok(w.shown[a[1]]) : fail(128, `fatal: invalid object name '${a[1]}'`)
    if (a[0] === 'merge-base') return w.ancestor === 0 ? ok() : fail(w.ancestor, '')
    throw new Error(`unexpected git ${line}`)
  })
  return w
}

export const call = async ($: any, name: string, input: object = {}) => $.tool.call({ tool: `mcp__backlog-skills__${name}`, ...input })
export const text = async ($: any, name: string, input: object = {}) => (await call($, name, input)).result as string
export const lockCalls = (w: { git: string[] }) => w.git.filter(l => l.includes('refs/backlog/lock'))
