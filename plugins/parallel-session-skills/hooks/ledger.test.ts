// claude plugin test: the claim ledger's rules, the three tools, and the release
// at session end. The costly errors are a sibling's live claim deleted, which
// ends its lane, and a claim left behind, which nothing expires.
import { expect, test } from 'claude-code/testing'
import { dead, fileOf, ownedBy, parse } from './ledger'

const claim = (branch: string, session = 'SIBLING', touches = ['src/**']) =>
  JSON.stringify({ item: 'x', branch, started: '2026-01-01T00:00:00Z', session, touches }) + '\n'
const entry = (name: string, text: string, mtimeMs = 0) => ({ name, text, mtimeMs })

test('a claim file is named for its branch', () => {
  expect(fileOf('claude/r1-teal-marten')).toBe('claude-r1-teal-marten.json')
})

test('a claim written by the earlier printf is still read', () => {
  expect(parse('{ "item": "a", "branch": "claude/a", "started": "s", "session": "S", "touches": ["a/**"] }\n')?.branch).toBe('claude/a')
  expect(parse('{ "item": "a" }')).toBeNull()
  expect(parse('{ "item": "a", "bran')).toBeNull()
})

test('a claim is dead when its branch is in no worktree, whatever its age', () => {
  const list = [entry('a.json', claim('claude/a')), entry('b.json', claim('claude/b'))]
  expect(dead(list, ['main', 'claude/a'], 10).map(e => e.name)).toEqual(['b.json'])
})

test('with a worktree detached, no claim that parses is dead', () => {
  const list = [entry('b.json', claim('claude/b')), entry('t.json', '{ "item": "a", "bran', 1_000)]
  expect(dead(list, ['main'], 62_000, true).map(e => e.name)).toEqual(['t.json'])
})

test('a file that does not parse is dead only after a minute', () => {
  const torn = [entry('t.json', '{ "item": "a", "bran', 1_000)]
  expect(dead(torn, [], 30_000)).toEqual([])
  expect(dead(torn, [], 62_000).map(e => e.name)).toEqual(['t.json'])
})

test('an empty session id matches no claim', () => {
  const list = [entry('a.json', claim('claude/a', '')), entry('b.json', claim('claude/b', 'MINE')), entry('c.json', '{ "branch": "claude/c" }')]
  expect(ownedBy(list, '')).toEqual([])
  expect(ownedBy(list, 'MINE').map(e => e.name)).toEqual(['b.json'])
})

// A primary checkout at /repo on main, worktrees by path and branch, and the
// ledger's files. With a `/repo` entry in `worktrees`, the primary checkout is on
// that branch, and `def` is the branch origin/HEAD points at, or null where
// there is no origin/HEAD. `git clean` deletes from `files`, as git does on disk. The
// session's directory is a worktree that was removed, so git starts only when
// it is run in /repo. A worktree in `stale` had its directory deleted without
// `git worktree remove`, so git lists it until a prune. A directory in `other`
// is in no list: under /repo it is part of the primary checkout, and anywhere
// else it is a repo of its own.
function world(on: any, worktrees: Record<string, string>, files: Record<string, string>, session = 'MINE', other: Record<string, string> = {}) {
  const posix = (p: string) => p.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')
  const dir = '/repo/.claude/claims/'
  const w = { files, worktrees, now: 1_000_000, root: '/repo' as string | null, torn: null as { name: string; text: string } | null, writing: null as string | null, stale: {} as Record<string, string>, sessionId: session, def: 'main' as string | null, mode: null as string | null }
  on('session.repo', () => ({ value: w.root ? { root: w.root, remote: null, internal: false } : null }))
  on('session.id', () => ({ value: w.sessionId }))
  on('clock.now', () => ({ value: w.now }))
  on('fs.list', (_$: any, e: any) => {
    if (posix(e.path) + '/' !== dir || Object.keys(w.files).length === 0) throw new Error('ENOENT')
    return { value: Object.keys(w.files).map(name => ({ name, kind: 'file', size: 1, mtimeMs: 0, isLink: false })) }
  })
  on('fs.read', (_$: any, e: any) => {
    const name = posix(e.path).slice(dir.length)
    // A claim being rewritten reads as torn text once.
    if (w.torn?.name === name) { const { text } = w.torn; w.torn = null; return { value: text } }
    // A claim with a write still in progress reads as torn every time, and has that write's time.
    if (w.writing === name) return { value: '{ "item": "a", "bran' }
    return { value: w.files[name] }
  })
  on('fs.stat', (_$: any, e: any) => ({ value: { kind: 'file', size: 1, mtimeMs: w.writing === posix(e.path).slice(dir.length) ? w.now : 0, isLink: false } }))
  on('fs.exists', (_$: any, e: any) => {
    const path = posix(e.path)
    return { value: path.startsWith(dir) ? path.slice(dir.length) in w.files : path === '/repo' || path in w.worktrees || path in other }
  })
  on('fs.write', (_$: any, e: any) => { w.files[posix(e.path).slice(dir.length)] = e.text; return { value: undefined } })
  on('process.run', (_$: any, e: any) => {
    if (e.init?.cwd !== '/repo') throw new Error("ENOENT: no such file or directory, posix_spawn 'git'")
    const [, , cwd, ...argv] = e.argv as string[]
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: exitCode ? 'fatal' : '' } })
    const all = { '/repo': 'main', ...w.worktrees }
    if (argv[0] === 'rev-parse') {
      // A path with a drive letter is found in any letter case, and printed in the case it was given.
      const given = cwd.replace(/\\/g, '/')
      if (/^[A-Za-z]:\//.test(given) && Object.keys(all).some(p => p.toLowerCase() === given.toLowerCase())) return out(given + '\n')
      if (posix(cwd) in all) return out(posix(cwd) + '\n')
      return posix(cwd) in other ? out((posix(cwd).startsWith('/repo/') ? '/repo' : posix(cwd)) + '\n') : out('', 128)
    }
    if (argv.join(' ') === 'config --get parallel-session-skills.checkoutMode') return w.mode ? out(`${w.mode}\n`) : out('', 1)
    if (argv[0] === 'symbolic-ref') return w.def ? out(`origin/${w.def}\n`) : out('', 1)
    if (argv.join(' ') === 'worktree prune') w.stale = {}
    // As git does with -z: every line ends in NUL, and so does each worktree's block.
    if (argv.join(' ') === 'worktree list --porcelain -z') {
      return out(Object.entries({ ...all, ...w.stale }).map(([p, b]) => `worktree ${p}\0HEAD 0\0${b === 'HEAD' ? 'detached' : `branch refs/heads/${b}`}\0\0`).join(''))
    }
    if (argv[0] === 'clean') delete w.files[argv[argv.length - 1].replace(':(literal).claude/claims/', '')]
    return out('')
  })
  on('session.end', () => ({ sessionId: w.sessionId }))
  return w
}
const worktreeByDefault = '\ncheckout: worktree (the default)'
const call = ($: any, name: string, input: object = {}) => $.tool.call({ tool: `mcp__parallel-session-skills__${name}`, ...input })

test('read_ledger deletes dead claims and returns the live ones', async ($: any, on: any) => {
  const w = world(on, { '/wt/a': 'claude/a' }, { 'claude-a.json': claim('claude/a'), 'claude-gone.json': claim('claude/gone') })
  expect((await call($, 'read_ledger')).result).toBe(`reaped dead claim: claude-gone.json\nledger: /repo/.claude/claims\n${claim('claude/a').trim()}${worktreeByDefault}`)
  expect(Object.keys(w.files)).toEqual(['claude-a.json'])
})

test('read_ledger reaps no claim while a linked worktree is detached, such as in a rebase', async ($: any, on: any) => {
  const w = world(on, { '/wt/a': 'HEAD' }, { 'claude-gone.json': claim('claude/gone') })
  const ran = await call($, 'read_ledger')
  expect(ran.result).toBe(`a worktree is detached, so no claim that parses was reaped\nledger: /repo/.claude/claims\n${claim('claude/gone').trim()}${worktreeByDefault}`)
  expect(Object.keys(w.files)).toEqual(['claude-gone.json'])
  w.worktrees = { '/wt/a': 'claude/a' }
  expect((await call($, 'read_ledger')).result).toContain('reaped dead claim: claude-gone.json')
})

test('a claim that was torn when first read, and whole when read again, is kept', async ($: any, on: any) => {
  const w = world(on, { '/wt/a': 'claude/a' }, { 'claude-a.json': claim('claude/a') })
  w.torn = { name: 'claude-a.json', text: '{ "item": "a", "bran' }
  expect((await call($, 'read_ledger')).result).toBe(`ledger: /repo/.claude/claims\n${claim('claude/a').trim()}${worktreeByDefault}`)
  expect(Object.keys(w.files)).toEqual(['claude-a.json'])
})

test('a claim that is whole but for a branch in no worktree is still reaped after the second read', async ($: any, on: any) => {
  const w = world(on, { '/wt/a': 'claude/a' }, { 'claude-gone.json': claim('claude/gone') })
  w.torn = { name: 'claude-gone.json', text: '{ "item": "a", "bran' }
  expect((await call($, 'read_ledger')).result).toContain('reaped dead claim: claude-gone.json')
  expect(w.files).toEqual({})
})

test('a claim torn on both reads by a write that began after the ledger was listed is kept', async ($: any, on: any) => {
  const w = world(on, { '/wt/a': 'claude/a' }, { 'claude-a.json': claim('claude/a') })
  w.writing = 'claude-a.json'
  expect((await call($, 'read_ledger')).result).not.toContain('reaped')
  expect(Object.keys(w.files)).toEqual(['claude-a.json'])
})

test('a file that parses on neither read and is a minute old is reaped', async ($: any, on: any) => {
  const w = world(on, { '/wt/a': 'claude/a' }, { 'junk.json': '{ "item": "a", "bran' })
  expect((await call($, 'read_ledger')).result).toContain('reaped dead claim: junk.json')
  expect(w.files).toEqual({})
})

test('read_ledger reports an empty or absent ledger with its path', async ($: any, on: any) => {
  world(on, {}, {})
  expect((await call($, 'read_ledger')).result).toBe(`ledger: /repo/.claude/claims\nno claims${worktreeByDefault}`)
})

test('read_ledger prints the checkout mode and where it was read, with an unknown value read as the default', async ($: any, on: any) => {
  const w = world(on, {}, {})
  w.mode = 'primary'
  expect((await call($, 'read_ledger')).result).toMatch(/\ncheckout: primary \(git config parallel-session-skills\.checkoutMode\)$/)
  w.mode = 'worktree'
  expect((await call($, 'read_ledger')).result).toMatch(/\ncheckout: worktree \(git config parallel-session-skills\.checkoutMode\)$/)
  w.mode = 'Primary'
  expect((await call($, 'read_ledger')).result).toMatch(/\ncheckout: worktree \(the default\)$/)
})

test("write_claim files the claim under the worktree's branch with this session's id", async ($: any, on: any) => {
  const w = world(on, { '/wt/a': 'claude/a', '/wt/b': 'claude/b' }, { 'claude-b.json': claim('claude/b') })
  const ran = await call($, 'write_claim', { worktree: '/wt/a', item: 'parser core', touches: ['src/parser/**', 'docs/parsing.md'] })
  expect(JSON.parse(w.files['claude-a.json'])).toEqual({
    item: 'parser core', branch: 'claude/a', started: '1970-01-01T00:16:40Z', session: 'MINE', touches: ['src/parser/**', 'docs/parsing.md'],
  })
  expect(ran.result).toContain(claim('claude/b').trim())
  expect(ran.result).toContain('"branch":"claude/a"')
})

// A claim written by a sibling after this result is in no list the session has read.
test('write_claim ends its result with the instruction to read the ledger again before the first edit', async ($: any, on: any) => {
  world(on, { '/wt/a': 'claude/a' }, {})
  const lines = (await call($, 'write_claim', { worktree: '/wt/a', item: 'x', touches: [] })).result.split('\n')
  expect(lines[lines.length - 1]).toBe('call read_ledger once more before the first edit: a claim written after this one is not listed here')
})

// git prints a path as it is, so a newline in it is a newline in the list.
test('write_claim and read_ledger take a worktree at a path with a newline in it', async ($: any, on: any) => {
  const path = '/wt/a\nb'
  const w = world(on, { [path]: 'claude/a' }, {})
  expect((await call($, 'write_claim', { worktree: path, item: 'x', touches: [] })).isError).toBeUndefined()
  expect(Object.keys(w.files)).toEqual(['claude-a.json'])
  expect((await call($, 'read_ledger')).result).not.toContain('reaped')
  expect(Object.keys(w.files)).toEqual(['claude-a.json'])
})

test('release_claim takes a worktree at a path with a newline in it', async ($: any, on: any) => {
  const path = '/wt/a\nb'
  const w = world(on, { [path]: 'claude/a' }, { 'claude-a.json': claim('claude/a', 'MINE') })
  expect((await call($, 'release_claim', { worktree: path })).result).toContain('released: claude-a.json')
  expect(w.files).toEqual({})
})

// git ends the path it prints with one newline, and the rest is the path.
test('write_claim and release_claim take a worktree at a path that ends in a newline or a space', async ($: any, on: any) => {
  const w = world(on, { '/wt/a\n': 'claude/a', '/wt/b ': 'claude/b' }, {})
  for (const [path, name] of [['/wt/a\n', 'claude-a.json'], ['/wt/b ', 'claude-b.json']]) {
    expect((await call($, 'write_claim', { worktree: path, item: 'x', touches: [] })).isError).toBeUndefined()
    expect(Object.keys(w.files)).toEqual([name])
    expect((await call($, 'release_claim', { worktree: path })).result).toContain(`released: ${name}`)
    expect(w.files).toEqual({})
  }
})

test('write_claim and release_claim take a Windows worktree path in another letter case', async ($: any, on: any) => {
  const w = world(on, { 'C:/Wt/a': 'claude/a' }, { 'claude-a.json': claim('claude/a', 'MINE') })
  expect((await call($, 'release_claim', { worktree: 'c:\\wt\\a' })).result).toBe('released: claude-a.json\nledger: /repo/.claude/claims\nno claims')
  expect((await call($, 'write_claim', { worktree: 'c:\\wt\\a', item: 'x', touches: [] })).isError).toBeUndefined()
  expect(Object.keys(w.files)).toEqual(['claude-a.json'])
})

test('the primary checkout, a detached HEAD, and a path that is no worktree are refused',async ($: any, on: any) => {
  const w = world(on, { '/wt/d': 'HEAD' }, {})
  for (const [worktree, why] of [['/repo', 'is the primary checkout'], ['/wt/d', 'detached HEAD'], ['/nowhere', 'rev-parse']]) {
    // A path that does not exist is a worktree that was removed, and release_claim treats it as that.
    for (const name of worktree === '/nowhere' ? ['write_claim'] : ['write_claim', 'release_claim']) {
      const ran = await call($, name, { worktree, item: 'x', touches: [] })
      expect(ran.isError).toBe(true)
      expect(ran.text).toContain(why)
    }
  }
  expect(w.files).toEqual({})
})

test("a repo that is not this one's worktree is refused, even on a claimed branch name", async ($: any, on: any) => {
  const w = world(on, { '/wt/a': 'claude/a' }, { 'claude-a.json': claim('claude/a', 'SIBLING') }, 'MINE', { '/other': 'claude/a' })
  for (const name of ['write_claim', 'release_claim']) {
    const ran = await call($, name, { worktree: '/other', item: 'x', touches: [] })
    expect(ran.isError).toBe(true)
    expect(ran.text).toContain('is not a worktree of this repo')
  }
  expect(w.files).toEqual({ 'claude-a.json': claim('claude/a', 'SIBLING') })
})

test('with the primary checkout detached, the first linked worktree can claim and release', async ($: any, on: any) => {
  const w = world(on, { '/repo': 'HEAD', '/wt/a': 'claude/a' }, {})
  const refused = await call($, 'write_claim', { worktree: '/repo', item: 'x', touches: [] })
  expect(refused.text).toContain('is the primary checkout')
  expect((await call($, 'write_claim', { worktree: '/wt/a', item: 'x', touches: [] })).isError).toBeUndefined()
  expect(Object.keys(w.files)).toEqual(['claude-a.json'])
  expect((await call($, 'release_claim', { worktree: '/wt/a' })).result).toContain('released: claude-a.json')
  expect(w.files).toEqual({})
})

// A unit of work is on a branch in the primary checkout unless a worktree was opened for it.
test('the primary checkout on a branch other than the default can claim and release', async ($: any, on: any) => {
  const w = world(on, { '/repo': 'claude/r1', '/wt/a': 'claude/a' }, { 'claude-a.json': claim('claude/a') })
  expect((await call($, 'write_claim', { worktree: '/repo', item: 'x', touches: ['src/**'] })).isError).toBeUndefined()
  expect(JSON.parse(w.files['claude-r1.json'])).toEqual({ item: 'x', branch: 'claude/r1', started: '1970-01-01T00:16:40Z', session: 'MINE', touches: ['src/**'] })
  expect((await call($, 'read_ledger')).result).not.toContain('reaped')
  expect((await call($, 'release_claim', { worktree: '/repo' })).result).toBe(`released: claude-r1.json\nledger: /repo/.claude/claims\n${claim('claude/a').trim()}`)
})

test('the default branch is read from origin/HEAD, and is main where there is none', async ($: any, on: any) => {
  const w = world(on, { '/repo': 'trunk' }, {})
  w.def = 'trunk'
  const refused = await call($, 'write_claim', { worktree: '/repo', item: 'x', touches: [] })
  expect(refused.text).toContain('is the primary checkout, on its default branch trunk')
  w.worktrees = { '/repo': 'main' }
  expect((await call($, 'write_claim', { worktree: '/repo', item: 'x', touches: [] })).isError).toBeUndefined()
  expect(Object.keys(w.files)).toEqual(['main.json'])
  w.def = null
  expect((await call($, 'write_claim', { worktree: '/repo', item: 'x', touches: [] })).text).toContain('on its default branch main')
})

// A rebase in the primary checkout leaves it detached, with its branch in no worktree's entry.
test('read_ledger reaps no claim while the primary checkout is detached', async ($: any, on: any) => {
  const w = world(on, { '/repo': 'HEAD' }, { 'claude-r1.json': claim('claude/r1', 'MINE') })
  expect((await call($, 'read_ledger')).result).toContain('a worktree is detached')
  expect(Object.keys(w.files)).toEqual(['claude-r1.json'])
})

// A worktree session that passes the primary checkout's path by mistake has given another session's lane.
test("release_claim leaves a claim that is another session's", async ($: any, on: any) => {
  const files = { 'claude-r1.json': claim('claude/r1', 'SIBLING'), 'claude-a.json': claim('claude/a', 'SIBLING'), 'claude-t.json': '{ "item": "a", "bran' }
  const w = world(on, { '/repo': 'claude/r1', '/wt/a': 'claude/a', '/wt/t': 'claude/t' }, { ...files })
  for (const [worktree, name] of [['/repo', 'claude-r1.json'], ['/wt/a', 'claude-a.json'], ['/wt/t', 'claude-t.json']]) {
    const ran = await call($, 'release_claim', { worktree })
    expect(ran.isError).toBe(true)
    expect(ran.text).toContain(`${name} is not this session's claim`)
  }
  expect(w.files).toEqual(files)
})

// After a landing the primary checkout is on the default branch again, and the work's branch is in no worktree.
test("the primary checkout back on its default branch releases this session's claims with no worktree", async ($: any, on: any) => {
  const w = world(on, { '/wt/a': 'claude/a' }, { 'claude-r1.json': claim('claude/r1', 'MINE'), 'claude-a.json': claim('claude/a', 'MINE'), 'claude-b.json': claim('claude/b') })
  const ran = await call($, 'release_claim', { worktree: '/repo' })
  expect(ran.result).toContain('released: claude-r1.json (/repo is the primary checkout, on its default branch main,')
  expect(Object.keys(w.files)).toEqual(['claude-a.json', 'claude-b.json'])
  const again = await call($, 'release_claim', { worktree: '/repo' })
  expect(again.isError).toBe(true)
  expect(again.text).toContain('no claim of this session')
  expect(Object.keys(w.files)).toEqual(['claude-a.json', 'claude-b.json'])
})

test("release_claim deletes the lane's claim and no other", async ($: any, on: any) => {
  const w = world(on, { '/wt/a': 'claude/a', '/wt/b': 'claude/b' }, { 'claude-a.json': claim('claude/a', 'MINE'), 'claude-b.json': claim('claude/b') })
  expect((await call($, 'release_claim', { worktree: '/wt/a' })).result).toBe(`released: claude-a.json\nledger: /repo/.claude/claims\n${claim('claude/b').trim()}`)
  expect(Object.keys(w.files)).toEqual(['claude-b.json'])
  const again = await call($, 'release_claim', { worktree: '/wt/a' })
  expect(again.isError).toBe(true)
  expect(again.text).toContain('no claim claude-a.json')
})

test("the end of a session deletes that session's claims and no other", async ($: any, on: any) => {
  const w = world(on, {}, {
    'a.json': claim('claude/a', 'MINE'), 'b.json': claim('claude/b', 'SIBLING'), 'c.json': '{ "item": "no session", "branch": "claude/c" }', 'd.json': claim('claude/d', ''),
  })
  w.sessionId = 'NOBODY'; await $.session.end({ reason: 'other' })
  w.sessionId = '';       await $.session.end({ reason: 'other' })
  expect(Object.keys(w.files)).toEqual(['a.json', 'b.json', 'c.json', 'd.json'])
  w.sessionId = 'MINE';   await $.session.end({ reason: 'other' })
  expect(Object.keys(w.files)).toEqual(['b.json', 'c.json', 'd.json'])
  w.root = null
  w.sessionId = 'SIBLING'; await $.session.end({ reason: 'other' })
  expect(Object.keys(w.files)).toEqual(['b.json', 'c.json', 'd.json'])
})

// A process is started in the session's directory unless another is given.
test("a claim is released after the lane's worktree is removed, by the tool and at session end", async ($: any, on: any) => {
  const w = world(on, {}, { 'claude-a.json': claim('claude/a', 'MINE'), 'claude-b.json': claim('claude/b', 'MINE') })
  const ran = await call($, 'release_claim', { worktree: '/wt/a' })
  expect(ran.result).toContain('released: claude-a.json, claude-b.json')
  expect(ran.result).toContain('/wt/a is not a worktree of this repo')
  expect(w.files).toEqual({})
  w.files['claude-c.json'] = claim('claude/c', 'MINE')
  w.sessionId = 'MINE'
  await $.session.end({ reason: 'other' })
  expect(w.files).toEqual({})
})

// A conductor has one claim a lane, all with its own session id.
test("a removed worktree's release leaves this session's claim for a worktree that still stands", async ($: any, on: any) => {
  const w = world(on, { '/wt/b': 'claude/b' }, { 'claude-a.json': claim('claude/a', 'MINE'), 'claude-b.json': claim('claude/b', 'MINE') })
  expect((await call($, 'release_claim', { worktree: '/wt/a' })).result).toContain('released: claude-a.json (')
  expect(Object.keys(w.files)).toEqual(['claude-b.json'])
})

// A lane stopped in a rebase is listed as detached, so its branch is in no
// worktree's entry and its claim cannot be told from the removed lane's.
test("a removed worktree's release deletes nothing while another worktree is detached", async ($: any, on: any) => {
  const w = world(on, { '/wt/b': 'HEAD' }, { 'claude-a.json': claim('claude/a', 'MINE'), 'claude-b.json': claim('claude/b', 'MINE') })
  const ran = await call($, 'release_claim', { worktree: '/wt/a' })
  expect(ran.isError).toBe(true)
  expect(ran.text).toContain('a worktree is detached')
  expect(Object.keys(w.files)).toEqual(['claude-a.json', 'claude-b.json'])
})

test("a removed worktree's release leaves another session's claim, and with none of this session's it is an error", async ($: any, on: any) => {
  const w = world(on, {}, { 'claude-a.json': claim('claude/a', 'SIBLING'), 'claude-b.json': claim('claude/b', 'MINE') })
  expect((await call($, 'release_claim', { worktree: '/wt/gone' })).result).toContain('released: claude-b.json')
  expect(Object.keys(w.files)).toEqual(['claude-a.json'])
  const again = await call($, 'release_claim', { worktree: '/wt/gone' })
  expect(again.isError).toBe(true)
  expect(again.text).toContain('no claim of this session')
  expect(Object.keys(w.files)).toEqual(['claude-a.json'])
})

// A build daemon can make a removed worktree's directory again, and under the
// primary checkout git reads that directory as the primary checkout.
test('a directory made again after its worktree was removed is released as a removed worktree', async ($: any, on: any) => {
  const w = world(on, { '/wt/b': 'claude/b' }, { 'claude-a.json': claim('claude/a', 'MINE'), 'claude-b.json': claim('claude/b', 'MINE') }, 'MINE', { '/repo/.claude/worktrees/a': '' })
  expect((await call($, 'release_claim', { worktree: '/repo/.claude/worktrees/a' })).result).toContain('released: claude-a.json (')
  expect(Object.keys(w.files)).toEqual(['claude-b.json'])
})

test('a worktree deleted without `git worktree remove` is pruned before its claim is released', async ($: any, on: any) => {
  const w = world(on, { '/wt/b': 'claude/b' }, { 'claude-a.json': claim('claude/a', 'MINE'), 'claude-b.json': claim('claude/b', 'MINE') })
  w.stale = { '/wt/a': 'claude/a' }
  expect((await call($, 'release_claim', { worktree: '/wt/a' })).result).toContain('released: claude-a.json (')
  expect(Object.keys(w.files)).toEqual(['claude-b.json'])
})

test('a path that is missing under a worktree that still stands releases nothing', async ($: any, on: any) => {
  const w = world(on, { '/wt/b': 'claude/b' }, { 'claude-a.json': claim('claude/a', 'MINE'), 'claude-b.json': claim('claude/b', 'MINE') })
  expect((await call($, 'release_claim', { worktree: '/wt/b/build' })).isError).toBe(true)
  expect(Object.keys(w.files)).toEqual(['claude-a.json', 'claude-b.json'])
})
