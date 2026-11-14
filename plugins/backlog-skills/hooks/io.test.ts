// claude plugin test: the lock, the journal, and the tools that find, read, and
// reserve IDs in the backlog, against a git and a file system kept in memory.
import { expect, test } from 'claude-code/testing'
import { parseBacklog } from './format'
import { addedFileProblems, placeOf, problemsOf } from './journal'
import { filesOf } from './repo'

const MAIN = '/repo'
const COMMON = '/repo/.git'
const J = `${COMMON}/backlog/journal`
const BACKLOG = '# Backlog (local only)\n\nNever commit or push this file. Highest ID used: R2\n\n## R1: One\n\n## R2: Two\n\n- Gated by: R1\n'
const Z = '0'.repeat(40)

type Failed = { exitCode: number; stdout?: string; stderr: string }
// A repo at /repo. `refs` maps a full ref to its object, and `objects` an
// object to its text. `before` runs ahead of every git command and may answer
// it instead. `t` is the clock, moved by each sleep.
function world(on: any, files: Record<string, string> = { [`${MAIN}/BACKLOG.local.md`]: BACKLOG }) {
  const w = {
    files, t: 1_000_000, slept: [] as number[], git: [] as string[], format: 'sha1',
    upstream: false as boolean | Failed, tracked: [] as string[],
    refs: new Map<string, string>([['refs/heads/main', 'c1']]), originHead: undefined as string | undefined,
    objects: new Map<string, string>(), worktrees: [{ path: MAIN, branch: 'main' }] as { path: string; branch?: string; head?: string }[],
    unmerged: [] as string[], log: '', ancestor: 0,
    before: undefined as undefined | ((line: string, argv: string[]) => Failed | string | void),
    writes: [] as string[], tear: undefined as undefined | ((path: string, text: string) => string | void),
    onSleep: undefined as undefined | (() => void),
  }
  let n = 0
  const zero = () => '0'.repeat(w.format === 'sha256' ? 64 : 40)
  on('session.repo', () => ({ value: { root: MAIN, remote: null, internal: false } }))
  on('session.id', () => ({ value: 's1' }))
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
    if (a[0] === 'merge-base') return w.ancestor === 0 ? ok() : fail(w.ancestor, '')
    throw new Error(`unexpected git ${line}`)
  })
  return w
}

const call = async ($: any, name: string, input: object = {}) => $.tool.call({ tool: `mcp__backlog-skills__${name}`, ...input })
const text = async ($: any, name: string, input: object = {}) => (await call($, name, input)).result as string
const lockCalls = (w: { git: string[] }) => w.git.filter(l => l.includes('refs/backlog/lock'))

// find_backlog

test('find_backlog returns the kind and the absolute paths of a local-only backlog', async ($: any, on: any) => {
  world(on)
  expect(await text($, 'find_backlog')).toBe([
    'main: /repo', 'kind: local-only', 'backlog: /repo/BACKLOG.local.md', 'parked: /repo/BACKLOG-PARKED.local.md',
    'declined: /repo/BACKLOG-DECLINED.local.md', 'changelog: /repo/BACKLOG-CHANGELOG.local.md', 'plan: /repo/PLAN.local.md',
  ].join('\n'))
})

test('a tracked backlog has no changelog path', async ($: any, on: any) => {
  const w = world(on, { [`${MAIN}/BACKLOG.md`]: BACKLOG.replace(' (local only)', '').replace('Never commit or push this file. ', '') })
  w.tracked = ['BACKLOG.md']
  const found = await text($, 'find_backlog')
  expect(found).toContain('kind: tracked\nbacklog: /repo/BACKLOG.md\nparked: /repo/BACKLOG-PARKED.md\ndeclined: /repo/BACKLOG-DECLINED.md\nplan: /repo/PLAN.md')
  expect(found).not.toContain('changelog')
})

test('find_backlog reports problems by file and line', async ($: any, on: any) => {
  world(on, { [`${MAIN}/BACKLOG.local.md`]: BACKLOG, [`${MAIN}/BACKLOG-PARKED.local.md`]: '# Parked\n\n## R7: later\n' })
  expect(await text($, 'find_backlog')).toContain('problems:\n  BACKLOG-PARKED.local.md line 3 (file level): Highest ID used is R2, below R7 in the parked file (line 3)')
})

test('the migration kinds come with what to do, and no paths', async ($: any, on: any) => {
  const w = world(on, { [`${MAIN}/ROADMAP.local.md`]: '# Roadmap\n' })
  const needs = await text($, 'find_backlog')
  expect(needs).toContain('kind: needs-migration\n')
  expect(needs).toContain('Offer the migration to the user')
  expect(needs).not.toContain('backlog:')
  w.files[`${COMMON}/backlog/migration/marker.json`] = '{"complete":false'
  expect(await text($, 'find_backlog')).toContain('kind: partial-migration\nA migration of this repo')
})

test('with an upstream remote, a missing plan or one with no House style section is reported', async ($: any, on: any) => {
  const w = world(on)
  w.upstream = true
  expect(await text($, 'find_backlog')).toContain('report:\n  no plan at /repo/PLAN.local.md: a repo with an upstream remote needs one, with a House style section')
  w.files[`${MAIN}/PLAN.local.md`] = '# Plan\n\n```\n## House style\n```\n'
  expect(await text($, 'find_backlog')).toContain('report:\n  the plan at /repo/PLAN.local.md has no House style section')
  w.files[`${MAIN}/PLAN.local.md`] = '# Plan\n\n## House style\n\nTabs.\n'
  expect(await text($, 'find_backlog')).not.toContain('report:')
})

test('a lookup of the upstream remote that failed is an error, and not a repo that is no fork', async ($: any, on: any) => {
  const w = world(on)
  w.upstream = { exitCode: 128, stderr: 'fatal: bad config\n' }
  const ran = await call($, 'find_backlog')
  expect(ran.isError).toBe(true)
  expect(ran.text).toBe('find_backlog: git remote get-url upstream in /repo: fatal: bad config')
})

// reserve_id

test('reserve_id takes the next ID past every source, creates its ref, and raises Highest ID used', async ($: any, on: any) => {
  const w = world(on, {
    [`${MAIN}/BACKLOG.local.md`]: BACKLOG,
    [`${MAIN}/BACKLOG-CHANGELOG.local.md`]: '# Changelog\n\n## R2: Two (DONE, 2026-11-01)\n',
    [`${MAIN}/.claude/claims/claude-r4-x.json`]: JSON.stringify({ item: 'R4: x', branch: 'claude/r4-x' }),
  })
  w.refs.set('refs/heads/claude/r3-y', 'c2')
  w.refs.set('refs/heads/claude/r4-x', 'c3')
  w.refs.set('refs/backlog/closed/R2', 'o')
  w.worktrees.push({ path: '/wt/r4-x', branch: 'claude/r4-x' })
  const out = await text($, 'reserve_id')
  expect(out).toContain('id: R5\nref: refs/backlog/ids/R5\nwrote /repo/BACKLOG.local.md\nHighest ID used: R5')
  expect(w.refs.has('refs/backlog/ids/R5')).toBe(true)
  expect(w.files[`${MAIN}/BACKLOG.local.md`]).toBe(BACKLOG.replace('R2\n\n## R1', 'R5\n\n## R1'))
  expect(w.refs.has('refs/backlog/lock')).toBe(false)
  // A second call counts the ref and the raised line.
  expect(await text($, 'reserve_id')).toContain('id: R6\n')
})

test('a ref another session created first is skipped for the next number', async ($: any, on: any) => {
  const w = world(on)
  w.before = (_line, a) => {
    if (a[0] === 'update-ref' && a[1] === 'refs/backlog/ids/R3' && !w.refs.has(a[1])) w.refs.set(a[1], 'theirs')
  }
  const out = await text($, 'reserve_id')
  expect(out).toContain('id: R4\n')
  expect(out).toContain('skipped, reserved by another session: R3')
  expect(w.refs.get('refs/backlog/ids/R3')).toBe('theirs')
  expect(w.files[`${MAIN}/BACKLOG.local.md`]).toContain('Highest ID used: R4')
})

test('an update-ref that fails for another reason is an error, not a taken ID', async ($: any, on: any) => {
  const w = world(on)
  w.before = (_line, a) => (a[0] === 'update-ref' && a[1].startsWith('refs/backlog/ids/') ? { exitCode: 128, stderr: 'fatal: disk full' } : undefined)
  const ran = await call($, 'reserve_id')
  expect(ran.text).toBe('reserve_id: git update-ref refs/backlog/ids/R3 in /repo: fatal: disk full')
  expect(w.files[`${MAIN}/BACKLOG.local.md`]).toBe(BACKLOG)
  expect(w.refs.has('refs/backlog/lock')).toBe(false)
})

test('on a tracked backlog reserve_id only creates the ref', async ($: any, on: any) => {
  const tracked = BACKLOG.replace(' (local only)', '').replace('Never commit or push this file. ', '')
  const w = world(on, { [`${MAIN}/BACKLOG.md`]: tracked })
  w.tracked = ['BACKLOG.md']
  w.log = '-## R7: gone\n+## R2: Two\n'
  expect(await text($, 'reserve_id')).toBe('id: R3\nref: refs/backlog/ids/R3')
  expect(w.files[`${MAIN}/BACKLOG.md`]).toBe(tracked)
})

test('reserve_id refuses for a migration kind and on a file-level problem, and reserves nothing', async ($: any, on: any) => {
  const w = world(on, { [`${MAIN}/ROADMAP.local.md`]: '# Roadmap\n' })
  expect((await call($, 'reserve_id')).text).toContain('reserve_id: no ID can be reserved while the kind is needs-migration')
  w.files = { [`${MAIN}/BACKLOG.local.md`]: BACKLOG + '\n## R2: again\n' }
  const ran = await call($, 'reserve_id')
  expect(ran.text).toBe('reserve_id: the backlog files have file-level problems, so no ID was reserved:\n  BACKLOG.local.md line 11 (file level): R2 has two headings')
  expect([...w.refs.keys()].filter(r => r.startsWith('refs/backlog/'))).toEqual([])
})

test('a SHA-256 repo gets a null object ID of 64 zeros', async ($: any, on: any) => {
  const w = world(on)
  w.format = 'sha256'
  expect(await text($, 'reserve_id')).toContain('id: R3\n')
})

// The lock

test('a held lock is waited for with backoff, then taken', async ($: any, on: any) => {
  const w = world(on)
  w.objects.set('theirs', `session s2\ntime ${w.t}\n`)
  w.refs.set('refs/backlog/lock', 'theirs')
  w.onSleep = () => { if (w.slept.length === 3) w.refs.delete('refs/backlog/lock') }
  expect(await text($, 'reserve_id')).toContain('id: R3\n')
  expect(w.slept).toEqual([50, 100, 200])
  expect(w.refs.has('refs/backlog/lock')).toBe(false)
})

// A hook's budget is 10 s and counts clock waits, so the waits stop at 8 s
// even where git is fast; where git is slow, 10 s on the clock ends the wait.
for (const [per, sleeps] of [[0, 11], [2_000, 4]]) {
  test(`a lock held throughout is an error, with ${per} ms per attempt`, async ($: any, on: any) => {
    const w = world(on)
    w.refs.set('refs/backlog/lock', 'theirs')
    w.before = line => {
      // The holder keeps its lock fresh.
      w.objects.set('theirs', `session s2\ntime ${w.t}\n`)
      if (line.startsWith('update-ref refs/backlog/lock')) w.t += per
    }
    const ran = await call($, 'reserve_id')
    expect(ran.text).toContain('reserve_id: another session holds refs/backlog/lock (blob theirs)')
    expect(w.slept.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(8_000)
    expect(w.slept).toHaveLength(sleeps)
    expect(w.refs.get('refs/backlog/lock')).toBe('theirs')
    expect(w.files[`${MAIN}/BACKLOG.local.md`]).toBe(BACKLOG)
  })
}

test('a lock older than a minute is broken with a compare-and-swap', async ($: any, on: any) => {
  const w = world(on)
  w.objects.set('stale', `session s2\ntime ${w.t - 61_000}\n`)
  w.refs.set('refs/backlog/lock', 'stale')
  expect(await text($, 'reserve_id')).toContain('id: R3\n')
  expect(lockCalls(w)).toContain(`update-ref refs/backlog/lock ${w.git.find(l => l.startsWith('update-ref refs/backlog/lock'))!.split(' ')[2]} stale`)
  expect(w.slept).toEqual([])
  expect(w.refs.has('refs/backlog/lock')).toBe(false)
})

test('a lock with no time in its blob is not broken', async ($: any, on: any) => {
  const w = world(on)
  w.objects.set('odd', 'something else\n')
  w.refs.set('refs/backlog/lock', 'odd')
  expect((await call($, 'reserve_id')).isError).toBe(true)
  expect(w.refs.get('refs/backlog/lock')).toBe('odd')
})

test('a caller that lost the lock before the write writes nothing', async ($: any, on: any) => {
  const w = world(on)
  // Another session breaks the lock once the ID ref is made.
  w.before = (_line, a) => {
    if (a[0] === 'update-ref' && a[1] === 'refs/backlog/ids/R3') w.refs.set('refs/backlog/lock', 'theirs')
  }
  const ran = await call($, 'reserve_id')
  expect(ran.text).toBe('reserve_id: the lock refs/backlog/lock was lost before /repo/BACKLOG.local.md was written, so nothing was written')
  expect(w.files[`${MAIN}/BACKLOG.local.md`]).toBe(BACKLOG)
  expect(w.writes).toEqual([])
  expect(w.refs.get('refs/backlog/lock')).toBe('theirs')
})

test('a caller that lost the lock while it made the journal entry writes nothing to the file', async ($: any, on: any) => {
  const w = world(on)
  w.tear = (path, t) => { if (path.endsWith('.json') && t.includes('"ready"')) w.refs.set('refs/backlog/lock', 'theirs') }
  expect((await call($, 'reserve_id')).text).toContain('was lost before /repo/BACKLOG.local.md was written, so nothing was written')
  expect(w.files[`${MAIN}/BACKLOG.local.md`]).toBe(BACKLOG)
})

test('a caller that lost the lock during the write reports a possible lost update and leaves the entry', async ($: any, on: any) => {
  const w = world(on)
  w.tear = path => { if (path === `${MAIN}/BACKLOG.local.md`) w.refs.set('refs/backlog/lock', 'theirs') }
  const ran = await call($, 'reserve_id')
  expect(ran.text).toContain('the lock was lost while /repo/BACKLOG.local.md was written, so another session may have written it too')
  expect(JSON.parse(w.files[`${J}/${encodeURIComponent(`${MAIN}/BACKLOG.local.md`)}.json`]).state).toBe('ready')
})

// The journal

const ENTRY = `${J}/${encodeURIComponent(`${MAIN}/BACKLOG.local.md`)}`
const NEW = BACKLOG.replace('Highest ID used: R2', 'Highest ID used: R9')

test('a write goes through the journal and leaves a tombstone and the copy', async ($: any, on: any) => {
  const w = world(on)
  await text($, 'reserve_id')
  expect(w.writes).toEqual([`${ENTRY}.json`, `${ENTRY}.copy`, `${ENTRY}.json`, `${MAIN}/BACKLOG.local.md`, `${ENTRY}.json`])
  expect(w.files[`${ENTRY}.json`]).toBe('{"state":"done"}')
  expect(w.files[`${ENTRY}.copy`]).toBe(BACKLOG)
})

test('a write that does not read back is restored from the copy and is an error', async ($: any, on: any) => {
  const w = world(on)
  let torn = false
  w.tear = (path, t) => (path === `${MAIN}/BACKLOG.local.md` && !torn ? ((torn = true), t.slice(0, 10)) : undefined)
  const ran = await call($, 'reserve_id')
  expect(ran.text).toBe('reserve_id: /repo/BACKLOG.local.md did not read back as written. Its content from before the call was restored.')
  expect(w.files[`${MAIN}/BACKLOG.local.md`]).toBe(BACKLOG)
  expect(w.files[`${ENTRY}.json`]).toBe('{"state":"done"}')
})

// An entry left by a call that was interrupted, then any tool call.
async function settled($: any, on: any, entry: object | string, file: string | undefined, copy = BACKLOG) {
  const files: Record<string, string> = {
    [`${ENTRY}.json`]: typeof entry === 'string' ? entry : JSON.stringify({ path: `${MAIN}/BACKLOG.local.md`, existed: true, new: NEW, ...entry }),
    [`${ENTRY}.copy`]: copy,
    [`${MAIN}/other`]: '',
  }
  if (file !== undefined) files[`${MAIN}/BACKLOG.local.md`] = file
  const w = world(on, files)
  const out = await text($, 'list_items')
  return { w, out }
}

test('an entry that never got to ready is discarded, and the file is not touched', async ($: any, on: any) => {
  const { w, out } = await settled($, on, { state: 'preparing' }, BACKLOG)
  expect(out).toContain('journal: /repo/BACKLOG.local.md: the write never started, so the entry was discarded')
  expect(w.files[`${MAIN}/BACKLOG.local.md`]).toBe(BACKLOG)
  expect(w.files[`${ENTRY}.json`]).toBe('{"state":"done"}')
})

test('a file with the new or the old content is kept', async ($: any, on: any) => {
  const { out } = await settled($, on, { state: 'ready' }, NEW)
  expect(out).toContain('journal: /repo/BACKLOG.local.md: the file has the new content, so it was kept')
})

test('a file with the content from before the write is kept', async ($: any, on: any) => {
  const { w, out } = await settled($, on, { state: 'ready' }, BACKLOG)
  expect(out).toContain('the file has the content from before the write, so it was kept')
  expect(w.files[`${MAIN}/BACKLOG.local.md`]).toBe(BACKLOG)
})

test('a write cut short is saved as .found and written again', async ($: any, on: any) => {
  const { w, out } = await settled($, on, { state: 'ready' }, NEW.slice(0, 20))
  expect(out).toContain(`the write was cut short, so the partial file was saved as ${J}/BACKLOG.local.md.found and the new content was written again`)
  expect(w.files[`${J}/BACKLOG.local.md.found`]).toBe(NEW.slice(0, 20))
  expect(w.files[`${MAIN}/BACKLOG.local.md`]).toBe(NEW)
})

test('a file edited by hand is kept, the copy is saved as .prev, and saved files are numbered', async ($: any, on: any) => {
  const edited = BACKLOG + '\n## R3: by hand\n'
  const files = {
    [`${ENTRY}.json`]: JSON.stringify({ state: 'ready', path: `${MAIN}/BACKLOG.local.md`, existed: true, new: NEW }),
    [`${ENTRY}.copy`]: BACKLOG,
    [`${J}/BACKLOG.local.md.prev`]: 'an older one',
    [`${MAIN}/BACKLOG.local.md`]: edited.replace('R2\n\n## R1', 'R3\n\n## R1'),
  }
  const w = world(on, files)
  const out = await text($, 'find_backlog')
  expect(out).toContain(`journal: /repo/BACKLOG.local.md: the file has neither the old nor the new content after an interrupted write, most likely from a hand edit. It was kept, the content from before the write was saved as ${J}/BACKLOG.local.md.prev.2. Tell the user`)
  expect(w.files[`${J}/BACKLOG.local.md.prev`]).toBe('an older one')
  expect(w.files[`${J}/BACKLOG.local.md.prev.2`]).toBe(BACKLOG)
})

test('a missing file that existed before is a conflict, and is not written again', async ($: any, on: any) => {
  const files = {
    [`${ENTRY}.json`]: JSON.stringify({ state: 'ready', path: `${MAIN}/BACKLOG.local.md`, existed: true, new: NEW }),
    [`${ENTRY}.copy`]: BACKLOG,
    [`${MAIN}/ROADMAP.local.md`]: 'x',
  }
  const w = world(on, files)
  expect(await text($, 'find_backlog')).toContain('journal: /repo/BACKLOG.local.md: the file is missing after an interrupted write')
  expect(`${MAIN}/BACKLOG.local.md` in w.files).toBe(false)
})

test('an entry with its directory gone, or one that does not parse, is discarded', async ($: any, on: any) => {
  const w = world(on)
  w.files[`${J}/gone.json`] = JSON.stringify({ state: 'ready', path: '/elsewhere/BACKLOG.md', existed: true, new: 'x' })
  w.files[`${J}/torn.json`] = '{"state":"rea'
  const out = await text($, 'find_backlog')
  expect(out).toContain('journal: /elsewhere/BACKLOG.md: its directory is gone, so the entry was discarded')
  expect(out).toContain(`journal: ${J}/torn.json did not parse, so it was discarded`)
  expect(w.files[`${J}/torn.json`]).toBe('{"state":"done"}')
})

test('with only tombstones in the journal, a read tool takes no lock', async ($: any, on: any) => {
  const w = world(on)
  w.files[`${ENTRY}.json`] = '{"state":"done"}'
  expect(await text($, 'list_items')).not.toContain('journal:')
  expect(lockCalls(w)).toEqual([])
})

// The check every write makes

test('a write is refused when it adds a file-level problem, and not for one the file already had', () => {
  const before = problemsOf(filesOf({ backlog: BACKLOG + '\n```\n' }))
  const moved = problemsOf(filesOf({ backlog: '\n\n' + BACKLOG + '\nmore prose\n\n```\n' }))
  expect(addedFileProblems(before, moved)).toEqual([])
  const worse = problemsOf(filesOf({ backlog: BACKLOG + '\n## R1: again\n\n```\n' }))
  expect(addedFileProblems(before, worse).map(p => p.message)).toEqual(['R1 has two headings'])
  expect(addedFileProblems([], problemsOf(filesOf({ backlog: '# B\n' }))).map(p => [p.file, p.message])).toEqual([['backlog', 'no Highest ID used line']])
})

test('a write path must be a backlog file in the primary checkout or a worktree, the innermost checkout winning', () => {
  const repo: any = {
    main: MAIN, worktrees: [{ path: MAIN }, { path: `${MAIN}/.claude/worktrees/r5-x` }, { path: '/wt/r6' }],
    paths: { backlog: 'BACKLOG.md', parked: 'BACKLOG-PARKED.md', declined: 'BACKLOG-DECLINED.md', plan: 'PLAN.md' },
  }
  expect(placeOf(repo, `${MAIN}/.claude/worktrees/r5-x/BACKLOG.md`)).toEqual({ root: `${MAIN}/.claude/worktrees/r5-x`, file: 'backlog' })
  expect(placeOf(repo, '/wt/r6/BACKLOG-PARKED.md')).toEqual({ root: '/wt/r6', file: 'parked' })
  expect(() => placeOf(repo, '/elsewhere/BACKLOG.md')).toThrow('is not inside the primary checkout')
  expect(() => placeOf(repo, `${MAIN}/../repo/BACKLOG.md`)).toThrow('is not inside the primary checkout')
  expect(() => placeOf(repo, `${MAIN}/PLAN.md`)).toThrow("is not one of this repo's backlog files")
})

// list_items, read_item, find_mentions

test('list_items gives each item its gate and whether it can be claimed', async ($: any, on: any) => {
  const w = world(on, {
    [`${MAIN}/BACKLOG.local.md`]: BACKLOG.replace('R2\n', 'R4\n') + '\n## R3: Three\n\n- Needs: user\n- Touches: `a/**`\n\n## R4: Four\n',
  })
  w.unmerged = ['claude/r4-four']
  w.refs.set('refs/heads/claude/r4-four', 'c9')
  const out = await text($, 'list_items', { unattended: true })
  expect(out).toBe([
    'R1: One', '  gate: open; claimable: yes',
    'R2: Two', '  gate: shut; claimable: no (Gated by R1: shut)', '  - Gated by: R1',
    'R3: Three', '  gate: open; claimable: no (Needs: user, in an unattended run)', '  - Needs: user', '  - Touches: `a/**`',
    'R4: Four', '  gate: open; claimable: no (a branch or worktree with commits the default branch lacks)',
  ].join('\n'))
  expect(await text($, 'list_items')).toContain('R3: Three\n  gate: open; claimable: yes')
  w.files[`${MAIN}/BACKLOG.local.md`] += '\n### R4.1: Sub\n\n- Check: `make`\n'
  expect(await text($, 'list_items')).toContain('\n  R4.1: Sub\n    gate: open; claimable: yes\n    - Check: `make`')
})

test('a worktree on a detached head named for an ID is in flight when its commit is not on the default branch', async ($: any, on: any) => {
  const w = world(on, { [`${MAIN}/BACKLOG.local.md`]: BACKLOG })
  w.worktrees.push({ path: '/wt/r1-one', head: 'c5' })
  w.ancestor = 1
  expect(await text($, 'list_items')).toContain('R1: One\n  gate: open; claimable: no (a branch or worktree with commits the default branch lacks)')
})

test('on a tracked backlog a heading deleted on the default branch opens a gate, and the search is cached by the tip', async ($: any, on: any) => {
  const w = world(on, { [`${MAIN}/BACKLOG.md`]: '# Backlog\n\nHighest ID used: R9\n\n## R2: Two\n\n- Gated by: R7\n' })
  w.tracked = ['BACKLOG.md']
  w.originHead = 'refs/remotes/origin/main'
  w.refs.set('refs/remotes/origin/main', 'c7')
  w.log = 'diff --git a/BACKLOG.md b/BACKLOG.md\n--- a/BACKLOG.md\n-## R7: gone\n-### R7.1: sub\n'
  expect(await text($, 'list_items')).toContain('R2: Two\n  gate: open; claimable: yes')
  expect(w.git).toContain('log -p -U0 --format= -G^# refs/remotes/origin/main -- BACKLOG.md ROADMAP.md docs/roadmap.md')
  expect(JSON.parse(w.files[`${COMMON}/backlog/deleted.json`])).toEqual({ tip: 'c7', ids: ['R7', 'R7.1'] })
  w.git = []
  await text($, 'list_items')
  expect(w.git.filter(l => l.startsWith('log'))).toEqual([])
  w.refs.set('refs/remotes/origin/main', 'c8')
  await text($, 'list_items')
  expect(w.git.filter(l => l.startsWith('log'))).toHaveLength(1)
})

test('a live claim shuts a gate on a tracked backlog, and a claim for a branch in no worktree does not', async ($: any, on: any) => {
  const w = world(on, {
    [`${MAIN}/BACKLOG.md`]: '# Backlog\n\nHighest ID used: R9\n\n## R2: Two\n\n- Gated by: R7\n',
    [`${MAIN}/.claude/claims/claude-r7-x.json`]: JSON.stringify({ item: 'R7: x', branch: 'claude/r7-x' }),
  })
  w.tracked = ['BACKLOG.md']
  expect(await text($, 'list_items')).toContain('gate: unknown')
  w.worktrees.push({ path: '/wt/r7-x', branch: 'claude/r7-x' })
  expect(await text($, 'list_items')).toContain('claimable: no (Gated by R7: shut)')
})

test('read_item finds an item in the backlog, the parked file, or the changelog', async ($: any, on: any) => {
  const w = world(on, {
    [`${MAIN}/BACKLOG.local.md`]: BACKLOG,
    [`${MAIN}/BACKLOG-PARKED.local.md`]: '# Parked\n\n## R0: zero\n\nlater\n',
    [`${MAIN}/BACKLOG-CHANGELOG.local.md`]: '# Changelog\n\n## R1: One (PR-READY, 2026-11-01)\n\nopened\n',
  })
  expect(await text($, 'read_item', { id: 'R2' })).toBe('/repo/BACKLOG.local.md line 7:\n## R2: Two\n\n- Gated by: R1')
  expect(await text($, 'read_item', { id: 'R0' })).toBe('/repo/BACKLOG-PARKED.local.md line 3:\n## R0: zero\n\nlater')
  expect(await text($, 'read_item', { id: 'R1' })).toBe('/repo/BACKLOG.local.md line 5:\n## R1: One\n/repo/BACKLOG-CHANGELOG.local.md line 3:\n## R1: One (PR-READY, 2026-11-01)\n\nopened')
  expect((await call($, 'read_item', { id: 'R8' })).text).toBe('read_item: R8 is in none of the backlog files')
  expect((await call($, 'read_item', { id: '../x' })).text).toBe('read_item: not an item ID: "../x"')
  expect(w.writes).toEqual([])
})

test('find_mentions lists the lines that cite an ID, in the plan and in a heading with a range', async ($: any, on: any) => {
  world(on, {
    [`${MAIN}/BACKLOG.local.md`]: BACKLOG.replace('R2\n', 'R5\n'),
    [`${MAIN}/BACKLOG-DECLINED.local.md`]: '# Declined\n\n## R3 to R5: three\n',
    [`${MAIN}/PLAN.local.md`]: '# Plan\n\nR1 first, not R10 or R1.2.\n',
  })
  expect(await text($, 'find_mentions', { id: 'R1' })).toBe([
    '/repo/BACKLOG.local.md:5: ## R1: One', '/repo/BACKLOG.local.md:9: - Gated by: R1', '/repo/PLAN.local.md:3: R1 first, not R10 or R1.2.',
  ].join('\n'))
  expect(await text($, 'find_mentions', { id: 'R4' })).toBe('/repo/BACKLOG-DECLINED.local.md:3: ## R3 to R5: three')
  expect(await text($, 'find_mentions', { id: 'R9' })).toBe('no mentions of R9')
})

test('the read tools refuse where there is no backlog', async ($: any, on: any) => {
  world(on, { [`${MAIN}/x`]: '' })
  expect((await call($, 'list_items')).text).toBe('list_items: this repo has no backlog to read: its kind is none')
})

test('a problem is reported with its file', () => {
  expect(parseBacklog('# B\n\n## R1: one\n\n## R1: two\n').problems.map(p => p.file)).toEqual(['backlog'])
})
