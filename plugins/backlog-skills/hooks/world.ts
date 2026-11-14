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
  }
  let n = 0
  const zero = () => '0'.repeat(w.format === 'sha256' ? 64 : 40)
  on('session.repo', () => ({ value: { root: MAIN, remote: null, internal: false } }))
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: w.cwd }))
  on('clock.now', () => ({ value: w.t }))
  on('clock.sleep', (_$: any, e: any) => { w.t += e.ms; w.slept.push(e.ms); w.onSleep?.(); return { value: undefined } })
  const dirOf = (p: string) => p.replace(/\/[^/]*$/, '')
  on('fs.exists', (_$: any, e: any) => ({ value: e.path in w.files || Object.keys(w.files).some(f => f.startsWith(`${e.path}/`)) }))
  on('fs.read', (_$: any, e: any) => {
    if (!(e.path in w.files)) throw new Error(`ENOENT: ${e.path}`)
    return { value: w.files[e.path] }
  })
  on('fs.write', (_$: any, e: any) => {
    w.writes.push(e.path)
    w.files[e.path] = w.tear?.(e.path, e.text) ?? e.text
    return { value: undefined }
  })
  on('fs.list', (_$: any, e: any) => {
    const names = new Map<string, string>()
    for (const f of Object.keys(w.files)) {
      if (!f.startsWith(`${e.path}/`)) continue
      const rest = f.slice(e.path.length + 1)
      names.set(rest.split('/')[0], rest.includes('/') ? 'directory' : 'file')
    }
    if (!names.size) throw new Error(`ENOENT: ${e.path}`)
    return { value: [...names].map(([name, kind]) => ({ name, kind, size: 0, mtimeMs: 0, isLink: false })) }
  })
  on('process.run', (_$: any, e: any) => {
    const argv = e.argv as string[]
    expect(argv.slice(0, 3)).toEqual(['git', '-C', MAIN])
    expect(e.init?.cwd).toBe(MAIN)
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
    if (a[0] === 'ls-files') return ok(w.tracked.map(t => `${t}\n`).join(''))
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
