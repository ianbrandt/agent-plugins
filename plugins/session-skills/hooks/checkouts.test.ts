// claude plugin test: where a new branch starts, the four tools, the push
// hold, and the host-write hold against a faked git. The costly errors are a branch opened without commits held on the
// local default branch, and an unmerged branch deleted by the prune.
import { expect, test } from 'claude-code/testing'
import { hostWrites, pickBase, pushTarget, refLine, visibility, worktreeName } from './checkouts'

test('a new branch starts from origin, except where the local default branch has everything origin has', () => {
  expect(pickBase('main', false, true, false, false)).toEqual({ base: 'main' })
  expect(pickBase('main', true, false, false, false)).toEqual({ base: 'origin/main' })
  expect(pickBase('main', true, true, true, true)).toEqual({ base: 'main' })
  expect(pickBase('main', true, true, true, false)).toEqual({ base: 'main' })
  expect(pickBase('main', true, true, false, true)).toEqual({ base: 'origin/main' })
  const diverged = pickBase('main', true, true, false, false)
  expect(diverged.base).toBe('origin/main')
  expect(diverged.warning).toContain('diverged')
  expect(pickBase('trunk', false, false, false, false).warning).toContain('neither origin/trunk nor trunk is a branch')
})

test('a visibility is one of three words, and anything else is dropped', () => {
  expect(visibility('PUBLIC\n')).toBe('public')
  expect(visibility('Private')).toBe('private')
  expect(visibility('internal')).toBe('internal')
  expect(visibility('HTTP 404: Not Found')).toBe('')
  expect(visibility('')).toBe('')
})

// Each line is what git 2.56.0 printed for that ref in a scratch repo.
test('a ref is read from the line with its name, and no such line is a ref that is absent', () => {
  const head = 'refs/remotes/origin/HEAD'
  expect(refLine('', head)).toBeNull()
  expect(refLine('refs/heads/main \n', 'refs/heads/main')).toEqual({ symref: '' })
  expect(refLine(`${head} refs/remotes/origin/main\n`, head)).toEqual({ symref: 'refs/remotes/origin/main' })
  expect(refLine(`${head} \r\n`, head)).toEqual({ symref: '' })
  expect(refLine('refs/heads/main/topic \n', 'refs/heads/main')).toBeNull()
  expect(refLine('refs/heads/main \nrefs/heads/main/topic \n', 'refs/heads/main')).toEqual({ symref: '' })
})

test('a worktree is named for its backlog ID, lowercased, then its slug', () => {
  expect(worktreeName('parser-cache', 'R78')).toBe('r78-parser-cache')
  expect(worktreeName('parser-cache')).toBe('parser-cache')
})

// A primary checkout at /repo. `git` answers a command, given without its
// `-C <dir>`, with its stdout, an exit code, a whole result, or nothing for an
// empty success. A program other than git cannot start unless `other` answers
// for it. A file reads as empty unless `files` has it. The session's directory
// is a worktree that was removed, so no program starts unless it is run in
// /repo.
type Said = string | number | void | { exitCode: number; stdout: string; stderr: string }
function world(on: any, git: (argv: string) => Said, other?: (argv: string) => string | void, paths: string[] = [], files: Record<string, string> = {}, root = '/repo') {
  const calls: string[] = []
  on('session.repo', () => ({ value: { root, remote: null, internal: false } }))
  on('session.cwd', () => ({ value: '/repo/.claude/worktrees/removed' }))
  // A drive-letter path is resolved against the test's directory on a POSIX host.
  // On Windows the engine gives a handler backslashes, and a drive letter on a path that had none.
  const given = (p: string) => p.replace(/\\/g, '/').replace(/^.*\/(?=[A-Za-z]:\/)/, '')
  const posix = (p: string) => (root.startsWith('/') ? given(p).replace(/^[A-Za-z]:/, '') : given(p))
  on('fs.exists', (_$: any, e: any) => ({ value: paths.includes(posix(e.path)) }))
  on('fs.read', (_$: any, e: any) => ({ value: files[posix(e.path)] ?? '' }))
  on('process.run', (_$: any, e: any) => {
    const argv = e.argv as string[]
    if (e.init?.cwd !== root) throw new Error(`ENOENT: no such file or directory, posix_spawn '${argv[0]}'`)
    const isGit = argv[0] === 'git'
    const line = (isGit ? argv.slice(3) : argv).join(' ')
    calls.push(line)
    const said = isGit ? git(line) : other?.(line)
    if (!isGit && said === undefined) throw new Error('ENOENT')
    if (typeof said === 'object') return { value: said }
    return { value: typeof said === 'number' ? { exitCode: said, stdout: '', stderr: 'fatal: no' } : { exitCode: 0, stdout: said ? `${said}\n` : '', stderr: '' } }
  })
  return calls
}
const call = ($: any, name: string, input: object = {}) => $.tool.call({ tool: `mcp__session-skills__${name}`, ...input })
// As git prints it with -z: every line ends in NUL, and so does each worktree's block.
const trees = (...branches: [string, string][]) => branches.map(([path, branch]) => `worktree ${path}\0HEAD 0\0branch refs/heads/${branch}\0\0`).join('')
const LIST = trees(['/repo', 'main'], ['/repo/.claude/worktrees/r1-a', 'claude/r1-a'])
const BASE = 'refs/remotes/origin/main'
const FETCH = 'fetch -q origin'
// The one way a ref is read. `shown` is git's line for a ref that is there: its
// name, then its target where the ref is symbolic, as origin/HEAD is.
const READ = 'for-each-ref --format=%(refname) %(symref) '
const HEAD = 'refs/remotes/origin/HEAD'
const shown = (line: string, head = BASE) => `${line.slice(READ.length)} ${line.endsWith(HEAD) ? head : ''}`
const GONE = 'for-each-ref --format=%(refname:lstrip=2)%09'

// Local main is ahead of origin/main: a push is held.
const held = (line: string) => {
  if (line.startsWith(READ)) return shown(line)
  if (line === `merge-base --is-ancestor refs/heads/main ${BASE}`) return 1
  if (line.startsWith('show-ref')) return 1
  if (line === 'worktree list --porcelain -z') return LIST
  if (line === 'rev-list --count refs/heads/main..refs/heads/claude/r1-a') return '3'
  if (line.startsWith('rev-list')) return '0'
}

// git prints a path as it is, so a newline in it is a newline in the list.
test('find_checkouts reports a worktree at a path with a newline in it', async ($: any, on: any) => {
  const list = trees(['/repo', 'main'], ['/repo/.claude/worktrees/r1\nx', 'claude/r1-x'])
  world(on, line => (line === 'worktree list --porcelain -z' ? list : held(line)))
  expect((await call($, 'find_checkouts')).result).toContain('  /repo  main\n  /repo/.claude/worktrees/r1\nx  claude/r1-x')
})

// git ends the path it prints with one newline, and anything before that is part of the path.
for (const [what, dir] of [['newline', '/repo/.claude/worktrees/r1\n'], ['space', '/repo/.claude/worktrees/r1 ']]) {
  test(`find_checkouts shows a session directory with a ${what} at its end whole`, async ($: any, on: any) => {
    world(on, line => (line === 'rev-parse --show-toplevel' ? dir : held(line)))
    expect((await call($, 'find_checkouts')).result).toContain(`session directory: ${dir}\nworktrees, the primary`)
  })
}

test('find_checkouts reports the base and each worktree, and a fetch that failed', async ($: any, on: any) => {
  world(on, line => (line === FETCH ? 1 : held(line)))
  const text = (await call($, 'find_checkouts')).result
  expect(text).toContain('primary checkout: /repo\ndefault branch: main\nbase for a new branch: main\n')
  expect(text).toContain('  /repo  main\n  /repo/.claude/worktrees/r1-a  claude/r1-a  3 commits not on main')
  expect(text).toContain('warning: fetch failed, so origin/main may be behind')
})

// A process is started in the session's directory unless another is given, and
// a session that removed the worktree it had changed into has none.
test('the tools answer after the session\'s directory is removed', async ($: any, on: any) => {
  world(on, line => (line === 'rev-parse --show-toplevel' ? 128 : line === 'config --get session-skills.originVisibility' ? 'public' : held(line)))
  expect((await call($, 'find_checkouts')).result).toContain('session directory: /repo/.claude/worktrees/removed\n')
  expect((await call($, 'prune_branches')).isError).toBeUndefined()
  expect((await call($, 'landing_facts')).result).toContain('origin visibility: public (git config)')
})

// A bare `git fetch` reads the remote of the current branch's upstream, which
// on a fork is the parent repo.
test('find_checkouts fetches origin by name, and fetches nothing where there is no origin', async ($: any, on: any) => {
  let origin = true
  const calls = world(on, line => (line === 'remote get-url origin' && !origin ? 2 : held(line)))
  await call($, 'find_checkouts')
  expect(calls.filter(c => c.includes('fetch'))).toEqual([FETCH])
  origin = false
  expect((await call($, 'find_checkouts')).result).not.toContain('warning')
  expect(calls.filter(c => c.includes('fetch'))).toEqual([FETCH])
})

// git exits 2 for a remote it does not have. Any other failure is no answer,
// and Claude Code reports a git that crashed as exit 1 with no output.
test('the tools report a lookup of origin that failed, and fetch, open, and prune nothing', async ($: any, on: any) => {
  let said: Said = { exitCode: 128, stdout: '', stderr: 'fatal: bad config line 1 in file .git/config\n' }
  const calls = world(on, line => (line === 'remote get-url origin' ? said : reap(line)), l => (l.startsWith('ln -s') ? '' : undefined))
  for (const [name, input] of [['find_checkouts', {}], ['open_worktree', { name: 'a-b' }], ['prune_branches', {}], ['landing_facts', {}]] as const) {
    const ran = await call($, name, input)
    expect(ran.isError).toBe(true)
    expect(ran.text).toBe(`${name}: check failed: fatal: bad config line 1 in file .git/config`)
  }
  said = { exitCode: 1, stdout: '', stderr: '' }
  expect((await call($, 'prune_branches')).text).toBe('prune_branches: check failed: exit 1')
  expect(calls.filter(c => c.includes('fetch') || c.startsWith('worktree') || c.startsWith('branch -') || c.includes('set-head'))).toEqual([])
})

// A repo that was pushed rather than cloned has no origin/HEAD until a fetch
// by git 2.48 or later, or `git remote set-head`, sets one.
test('find_checkouts reads the default branch after the fetch, and from the remote where origin/HEAD is not set', async ($: any, on: any) => {
  let set = false
  const calls = world(on, line => {
    if (line === 'remote set-head origin --auto') set = true
    if (line === READ + HEAD) return set ? shown(line, 'refs/remotes/origin/develop') : ''
    return held(line)
  })
  expect((await call($, 'find_checkouts')).result).toContain('default branch: develop\n')
  expect(calls.indexOf(FETCH)).toBeLessThan(calls.indexOf(READ + HEAD))
})

// An origin/HEAD set on purpose to another branch is the user's.
test('the tools leave alone an origin/HEAD that names a branch origin has', async ($: any, on: any) => {
  const calls = world(on, held, line => (line.startsWith('ln -s') ? '' : undefined))
  await call($, 'find_checkouts')
  await call($, 'open_worktree', { name: 'a-b' })
  await call($, 'prune_branches')
  expect(calls.filter(c => c.includes('set-head') || c.includes('followRemoteHEAD'))).toEqual([])
})

// `git for-each-ref refs/heads/main` also prints refs/heads/main/topic, and
// prints nothing for an origin/HEAD that is not there.
test('a branch with only branches under its name is not there, and main is the guess where origin/HEAD is absent', async ($: any, on: any) => {
  const calls = world(on, line => (line === 'remote get-url origin' ? 2 : line === READ + HEAD ? '' : line.startsWith(READ) ? `${line.slice(READ.length)}/topic ` : held(line)))
  const text = (await call($, 'find_checkouts')).result
  expect(text).toContain('default branch: main\n')
  expect(text).toContain('warning: neither origin/main nor main is a branch here')
  await call($, 'prune_branches')
  expect(calls.filter(c => c.startsWith('for-each-ref --merged'))).toEqual([])
})

// A read that fails is neither a ref that is there nor one that is absent.
// Claude Code reports a git that crashed as exit 1 with no output.
const changes = (calls: string[]) => calls.filter(c => c.startsWith('worktree add') || c.startsWith('worktree prune') || c.startsWith('branch -') || c.includes('set-head'))
for (const [what, failing] of [['origin/HEAD', READ + HEAD], ['the local default branch', `${READ}refs/heads/main`]]) {
  test(`the tools report a read of ${what} that failed, and open, set, and prune nothing`, async ($: any, on: any) => {
    let said: Said = { exitCode: 128, stdout: '', stderr: 'fatal: unexpected line in .git/packed-refs: garbage\nmore\n' }
    const calls = world(on, line => (line === failing ? said : reap(line)), l => (l.startsWith('ln -s') ? '' : undefined))
    for (const [name, input] of [['find_checkouts', {}], ['open_worktree', { name: 'a-b' }], ['prune_branches', {}]] as const) {
      const ran = await call($, name, input)
      expect(ran.isError).toBe(true)
      expect(ran.text).toBe(`${name}: check failed: fatal: unexpected line in .git/packed-refs: garbage`)
    }
    said = { exitCode: 1, stdout: '', stderr: '' }
    expect((await call($, 'prune_branches')).text).toBe('prune_branches: check failed: exit 1')
    expect(changes(calls)).toEqual([])
  })
}

// The fetch failed, so `git remote set-head` was not run, and origin/HEAD is
// still the commit that `git update-ref` wrote.
test('the tools report an origin/HEAD that is still not a symbolic ref, and open and prune nothing on a guess', async ($: any, on: any) => {
  const calls = world(on, line => (line.includes('fetch') ? 1 : line === READ + HEAD ? shown(line, '') : reap(line)))
  for (const [name, input] of [['find_checkouts', {}], ['open_worktree', { name: 'a-b' }], ['prune_branches', {}]] as const) {
    const ran = await call($, name, input)
    expect(ran.isError).toBe(true)
    expect(ran.text).toContain(`${name}: refs/remotes/origin/HEAD is not a symbolic ref, so the default branch is not known`)
  }
  expect(changes(calls)).toEqual([])
})

// A fetch with --prune by hand removed origin/dev, which origin/HEAD was set to
// on purpose. `git for-each-ref` prints nothing for that origin/HEAD, and `git
// symbolic-ref` still prints its target. The fetch here failed, so it was not
// set from the remote.
test('the default branch is the one a dangling origin/HEAD points at, and nothing is pruned against main on a guess', async ($: any, on: any) => {
  let said: Said = 'refs/remotes/origin/dev'
  const calls = world(on, line => {
    if (line.includes('fetch')) return 1
    if (line === `symbolic-ref -q ${HEAD}`) return said
    if (line.startsWith(READ) && !line.endsWith('/main')) return ''
    return reap(line)
  })
  expect((await call($, 'find_checkouts')).result).toContain('default branch: dev\n')
  expect((await call($, 'prune_branches')).result).toContain('warning: fetch failed')
  expect(calls.filter(c => c.startsWith('for-each-ref --merged'))).toEqual([])
  said = { exitCode: 128, stdout: '', stderr: 'fatal: bad config line 1 in file .git/config\n' }
  expect((await call($, 'prune_branches')).text).toBe('prune_branches: check failed: fatal: bad config line 1 in file .git/config')
  expect(calls.filter(c => c.startsWith('branch -') || c.includes('set-head'))).toEqual([])
})

test('open_worktree opens from a local default branch that is ahead, and links the notes directory', async ($: any, on: any) => {
  const calls = world(on, held, line => (line.startsWith('ln -s') ? '' : undefined), ['/repo/notes.local'])
  const text = (await call($, 'open_worktree', { name: 'parser-cache', id: 'R78' })).result
  expect(calls.indexOf(FETCH)).toBeLessThan(calls.indexOf('worktree add --no-track /repo/.claude/worktrees/r78-parser-cache -b claude/r78-parser-cache refs/heads/main'))
  expect(calls).toContain('ln -s /repo/notes.local /repo/.claude/worktrees/r78-parser-cache/notes.local')
  expect(text).toContain('worktree: /repo/.claude/worktrees/r78-parser-cache\nbranch: claude/r78-parser-cache\nopened from: main\n')
})

test('open_worktree takes a Jira-style ID with a hyphen', async ($: any, on: any) => {
  const calls = world(on, held, undefined, [])
  expect((await call($, 'open_worktree', { name: 'parser-cache', id: 'ABC-123' })).result).toContain('branch: claude/abc-123-parser-cache\n')
  expect(calls).toContain('worktree add --no-track /repo/.claude/worktrees/abc-123-parser-cache -b claude/abc-123-parser-cache refs/heads/main')
  for (const id of ['-ABC', 'ABC-', 'ABC--1', '..']) expect((await call($, 'open_worktree', { name: 'a-b', id })).isError).toBe(true)
})

test('open_worktree suffixes a name that a directory or a branch already has', async ($: any, on: any) => {
  const calls = world(on, line => (line === 'show-ref --verify --quiet refs/heads/claude/a-b-2' ? undefined : held(line)), undefined, ['/repo/.claude/worktrees/a-b'])
  expect((await call($, 'open_worktree', { name: 'a-b' })).result).toContain('branch: claude/a-b-3\n')
  expect(calls).toContain('worktree add --no-track /repo/.claude/worktrees/a-b-3 -b claude/a-b-3 refs/heads/main')
})

test('open_worktree refuses a name that is not lowercase words joined by hyphens, and reports a notes directory it could not link', async ($: any, on: any) => {
  const calls = world(on, held, undefined, ['/repo/notes.local'])
  for (const input of [{ name: 'Roadmap Lap' }, { name: '../x' }, { name: 'a-b', id: 'R1/..' }, { name: 'a-b', notes: '../etc' }]) {
    expect((await call($, 'open_worktree', input)).isError).toBe(true)
  }
  expect(calls.filter(c => c.startsWith('worktree add'))).toEqual([])
  expect((await call($, 'open_worktree', { name: 'a-b' })).result).toContain('warning: notes.local was not linked')
})

test('open_worktree does not link the notes directory over one that is already in the worktree', async ($: any, on: any) => {
  const calls = world(on, held, line => (line.startsWith('ln -s') ? '' : undefined), ['/repo/notes.local', '/repo/.claude/worktrees/a-b/notes.local'])
  const text = (await call($, 'open_worktree', { name: 'a-b' })).result
  expect(text).toContain('warning: notes.local was not linked into the worktree, so write notes to /repo/notes.local: it is already there')
  expect(calls.filter(c => c.startsWith('ln'))).toEqual([])
})

test('open_worktree takes a notes name of letters, digits, dots, underscores, and hyphens only', async ($: any, on: any) => {
  const calls = world(on, held, line => (line.startsWith('ln -s') ? '' : undefined), ['/repo/notes.local', '/repo/notes_2-x'])
  for (const notes of ['notes&calc', '%X%', 'a b', '.', '..', '', 'a"b']) {
    const ran = await call($, 'open_worktree', { name: 'a-b', notes })
    expect(ran.isError).toBe(true)
    expect(ran.text).toContain('is not the name of a directory at the repo root')
  }
  expect(calls.filter(c => c.startsWith('worktree add'))).toEqual([])
  expect((await call($, 'open_worktree', { name: 'a-b', notes: 'notes_2-x' })).result).toContain('notes: /repo/.claude/worktrees/a-b/notes_2-x links to')
})

test('open_worktree links a Windows notes directory with a junction', async ($: any, on: any) => {
  const cmd = (line: string) => (line.startsWith('cmd') ? '' : undefined)
  const plain = world(on, held, cmd, ['C:/repo/notes.local'], {}, 'C:/repo')
  expect((await call($, 'open_worktree', { name: 'a-b' })).result).toContain('notes: C:/repo/.claude/worktrees/a-b/notes.local links to')
  expect(plain.filter(c => c.startsWith('cmd'))).toEqual(['cmd /c mklink /J C:\\repo\\.claude\\worktrees\\a-b\\notes.local C:\\repo\\notes.local'])
})

// Claude Code runs git with GIT_LFS_SKIP_SMUDGE=1, so `git worktree add` leaves LFS files as pointers.
test('open_worktree pulls LFS files where the repo has them, and reports a pull that failed', async ($: any, on: any) => {
  const lfs = { '/repo/.claude/worktrees/a-b/.gitattributes': '*.jar filter=lfs diff=lfs merge=lfs -text\n' }
  let pull: Said = undefined
  const calls = world(on, line => (line === 'lfs pull' ? pull : held(line)), undefined, Object.keys(lfs), lfs)
  expect((await call($, 'open_worktree', { name: 'a-b' })).result).not.toContain('warning')
  expect(calls.indexOf('lfs pull')).toBeGreaterThan(calls.findIndex(c => c.startsWith('worktree add')))
  pull = { exitCode: 1, stdout: '', stderr: "git: 'lfs' is not a git command.\n" }
  expect((await call($, 'open_worktree', { name: 'a-b' })).result).toContain("warning: LFS files were left as pointers, so run `git lfs pull` in the worktree: git: 'lfs' is not a git command.")
})

test('open_worktree pulls nothing where the repo has no LFS files', async ($: any, on: any) => {
  const files = { '/repo/.claude/worktrees/a-b/.gitattributes': '* text=auto\n' }
  const calls = world(on, held, undefined, Object.keys(files), files)
  expect((await call($, 'open_worktree', { name: 'a-b' })).result).toContain('worktree: /repo/.claude/worktrees/a-b\n')
  expect(calls.filter(c => c.startsWith('lfs'))).toEqual([])
})

// In an argument, cmd reads these as operators or expands them.
test('open_worktree runs no cmd for a Windows path with a character that cmd reads as an operator', async ($: any, on: any) => {
  const calls = world(on, held, line => (line.startsWith('cmd') ? '' : undefined), ['C:/my%X%repo/notes.local'], {}, 'C:/my%X%repo')
  const text = (await call($, 'open_worktree', { name: 'a-b' })).result
  expect(text).toContain('warning: notes.local was not linked into the worktree, so write notes to C:/my%X%repo/notes.local: ')
  expect(calls.filter(c => c.startsWith('cmd'))).toEqual([])
})

// Every gone branch but feat-declined has the base's tree when merged.
// feat-undone has a commit, u2, that undoes part of what was merged, under a
// tip commit the base has. feat-merged has no commit of its own since the
// fork, as an ancestor of the base has none. feat-live has an upstream, and
// claude/r1-a is checked out. A merge-tree called any other way, as one that
// runs the repo's merge drivers is, returns the base's tree.
const MERGE = '-c merge.default=text -c core.attributesFile=/dev/null --attr-source=EMPTY merge-tree --write-tree'
const whole = (b: string) => `${MERGE} ${BASE} refs/heads/${b}`
const since = (b: string, c: string) => `${MERGE} --merge-base=${c}^ ${BASE} refs/heads/${b}`
const COMMITS: Record<string, string> = { 'feat-squash': 'c2\nc1', 'feat-undone': 'u3\nu2\nu1', 'claude/r1-a': 'r1' }
const reap = (line: string) => {
  if (line.startsWith(READ)) return shown(line)
  if (line.startsWith('for-each-ref --merged refs/heads/main')) return 'claude/done\nclaude/r1-a'
  if (line === `rev-parse --verify -q ${BASE}^{tree}`) return 'TREE'
  if (line === 'hash-object -t tree /dev/null') return 'EMPTY'
  if (line.endsWith('--git-common-dir')) return '/repo/.git'
  if (line.startsWith(GONE)) return 'feat-squash\t[gone]\nfeat-declined\t[gone]\nfeat-undone\t[gone]\nfeat-merged\t[gone]\nclaude/r1-a\t[gone]\nfeat-live\t[ahead 1]\nmain\t'
  if (line.startsWith(`merge-base ${BASE} `)) return 'FORK'
  if (line.startsWith('rev-list --no-merges --ancestry-path=FORK')) return COMMITS[line.split('..refs/heads/')[1]]
  if (line === whole('feat-declined') || line === since('feat-undone', 'u2')) return 'OTHER'
  if (line.includes('merge-tree')) return 'TREE'
  if (line === 'worktree list --porcelain -z') return LIST
}
const deleted = (calls: string[]) => calls.filter(c => c.startsWith('branch -'))

test('prune_branches deletes a merged branch, and one with a gone upstream and nothing the base lacks', async ($: any, on: any) => {
  const calls = world(on, reap)
  expect((await call($, 'prune_branches')).result).toBe([
    'deleted: claude/done (merged into main)',
    'deleted: feat-squash (upstream gone, content on origin/main)',
    'kept: feat-declined (upstream gone, content not on origin/main)',
    'kept: feat-undone (upstream gone, content not on origin/main)',
    'deleted: feat-merged (upstream gone, content on origin/main)',
    'merged, still checked out: claude/r1-a',
  ].join('\n'))
  expect(deleted(calls)).toEqual(['branch -D claude/done', 'branch -D feat-squash', 'branch -D feat-merged'])
  expect(calls).toContain(FETCH.replace('-q', '-q --prune'))
  expect(calls).toContain('for-each-ref --merged refs/heads/main --format=%(refname:lstrip=2) refs/heads/claude/* refs/heads/worktree-*')
})

// `git branch -d` checks the merge against HEAD, and the primary checkout is on another branch.
test('prune_branches deletes a branch merged into the default branch while the primary checkout is on another', async ($: any, on: any) => {
  const refused = { exitCode: 1, stdout: '', stderr: "error: the branch 'claude/done' is not fully merged\n" }
  world(on, line => (line === 'branch -d claude/done' ? refused : reap(line)))
  expect((await call($, 'prune_branches')).result).toContain('deleted: claude/done (merged into main)\n')
})

// The remote's default branch is develop, and its main is a release branch
// with everything hotfix has. There is no origin/HEAD until the fetch.
test('prune_branches reads the default branch after the fetch', async ($: any, on: any) => {
  const develop = 'refs/remotes/origin/develop'
  let fetched = false
  const calls = world(on, line => {
    if (line.includes('fetch')) fetched = true
    if (line === READ + HEAD) return fetched ? shown(line, develop) : ''
    if (line === `rev-parse --verify -q ${develop}^{tree}`) return 'TREE'
    if (line.startsWith('for-each-ref --merged')) return ''
    if (line.startsWith(GONE)) return 'hotfix\t[gone]'
    if (line.includes('merge-tree')) return line.includes(develop) ? 'OTHER' : 'TREE'
    return reap(line)
  })
  expect((await call($, 'prune_branches')).result).toBe('kept: hotfix (upstream gone, content not on origin/develop)')
  expect(deleted(calls)).toEqual([])
})

// `git update-ref` writes origin/HEAD as a commit, which resolves and names no
// branch. Read as it is, the default branch would be the guess, main.
test('prune_branches sets an origin/HEAD that is not a symbolic ref from the remote', async ($: any, on: any) => {
  const develop = 'refs/remotes/origin/develop'
  let set = false
  const calls = world(on, line => {
    if (line === 'remote set-head origin --auto') set = true
    if (line === READ + HEAD) return shown(line, set ? develop : '')
    if (line === `rev-parse --verify -q ${develop}^{tree}`) return 'TREE'
    if (line.startsWith('for-each-ref --merged')) return ''
    if (line.startsWith(GONE)) return 'hotfix\t[gone]'
    if (line.includes('merge-tree')) return line.includes(develop) ? 'OTHER' : 'TREE'
    return reap(line)
  })
  expect((await call($, 'prune_branches')).result).toBe('kept: hotfix (upstream gone, content not on origin/develop)')
  expect(deleted(calls)).toEqual([])
})

// The host renamed master to main. The prune removes origin/master, and
// origin/HEAD then points at nothing, which git does not print.
test('prune_branches finds a default branch the host renamed once the fetch has pruned the old one', async ($: any, on: any) => {
  let pruned = false
  let set = false
  const calls = world(on, line => {
    if (line === 'fetch -q --prune origin') pruned = true
    if (line === 'remote set-head origin --auto') set = true
    if (line === READ + HEAD) return set ? shown(line) : pruned ? '' : shown(line, 'refs/remotes/origin/master')
    if (line.startsWith('for-each-ref --merged')) return ''
    return line.startsWith(GONE) ? 'feat-squash\t[gone]' : reap(line)
  })
  expect((await call($, 'prune_branches')).result).toBe('deleted: feat-squash (upstream gone, content on origin/main)')
  expect(calls.filter(c => c.includes('set-head'))).toEqual(['remote set-head origin --auto'])
})

// One world a test, since no hook is added after the first call on `$`: the
// faked git reads `now`, which the test changes between calls.
test('prune_branches deletes no branch with a gone upstream when a check or the fetch fails', async ($: any, on: any) => {
  const one = (line: string) => (line.startsWith(GONE) ? 'feat-squash\t[gone]' : reap(line))
  let now = one
  const calls = world(on, line => now(line))
  const checks = [`rev-parse --verify -q ${BASE}^{tree}`, 'hash-object -t tree /dev/null', whole('feat-squash'), `merge-base ${BASE} refs/heads/feat-squash`, `rev-list --no-merges --ancestry-path=FORK ${BASE}..refs/heads/feat-squash`, since('feat-squash', 'c1')]
  for (const failing of checks) {
    now = line => (line === failing ? 128 : one(line))
    await call($, 'prune_branches')
  }
  now = line => (line.includes('merge-tree') ? 'TREE\nCONFLICT (content): s' : one(line))
  await call($, 'prune_branches')
  now = line => (line.includes('fetch') ? 1 : one(line))
  expect((await call($, 'prune_branches')).result).toContain('warning: fetch failed, so no branch with a gone upstream was checked')
  expect(deleted(calls)).toEqual(Array(checks.length + 2).fill('branch -D claude/done'))
})

// A conflict is a merge that has changes the base lacks: exit 1, with the tree
// it left. A merge that cannot run, as with a git before 2.41, is neither merged
// nor unmerged. Nor is a git that crashed, which Claude Code reports as exit 1
// with no output.
test('prune_branches keeps a branch with git\'s message where the merge cannot run, and with the base\'s content note where it conflicts', async ($: any, on: any) => {
  const one = (line: string) => (line.startsWith(GONE) ? 'feat-squash\t[gone]' : reap(line))
  let now = one
  const calls = world(on, line => now(line))
  now = line => (line === whole('feat-squash') ? 128 : one(line))
  expect((await call($, 'prune_branches')).result).toContain('kept: feat-squash (upstream gone, check failed: fatal: no)')
  now = line => (line === since('feat-squash', 'c1') ? 129 : one(line))
  expect((await call($, 'prune_branches')).result).toContain('kept: feat-squash (upstream gone, check failed: fatal: no)')
  const usage = { exitCode: 129, stdout: '', stderr: "error: unknown option `write-tree'\nusage: git merge-tree <base-tree> <branch1> <branch2>\n" }
  now = line => (line === whole('feat-squash') ? usage : one(line))
  expect((await call($, 'prune_branches')).result).toBe("deleted: claude/done (merged into main)\nkept: feat-squash (upstream gone, check failed: error: unknown option `write-tree')")
  now = line => (line === whole('feat-squash') ? { exitCode: 2, stdout: '', stderr: '' } : one(line))
  expect((await call($, 'prune_branches')).result).toContain('kept: feat-squash (upstream gone, check failed: exit 2)')
  now = line => (line === whole('feat-squash') ? { exitCode: 1, stdout: '', stderr: '' } : one(line))
  expect((await call($, 'prune_branches')).result).toContain('kept: feat-squash (upstream gone, check failed: exit 1)')
  now = line => (line === whole('feat-squash') ? { exitCode: 1, stdout: 'OTHER\n\nCONFLICT (content): Merge conflict in s\n', stderr: '' } : one(line))
  expect((await call($, 'prune_branches')).result).toContain('kept: feat-squash (upstream gone, content not on origin/main)')
  expect(deleted(calls)).toEqual(Array(6).fill('branch -D claude/done'))
})

test('prune_branches keeps a branch with git\'s message where merge-base or rev-list fails', async ($: any, on: any) => {
  const one = (line: string) => (line.startsWith(GONE) ? 'feat-squash\t[gone]' : reap(line))
  let now = one
  const calls = world(on, line => now(line))
  const list = `rev-list --no-merges --ancestry-path=FORK ${BASE}..refs/heads/feat-squash`
  const merges = `rev-list --merges --ancestry-path=FORK ${BASE}..refs/heads/feat-squash`
  for (const failing of [`merge-base ${BASE} refs/heads/feat-squash`, list, merges]) {
    now = line => (line === failing ? 128 : one(line))
    expect((await call($, 'prune_branches')).result).toContain('kept: feat-squash (upstream gone, check failed: fatal: no)')
  }
  now = line => (line === list ? { exitCode: 129, stdout: '', stderr: '' } : one(line))
  expect((await call($, 'prune_branches')).result).toContain('kept: feat-squash (upstream gone, check failed: exit 129)')
  // The merge has run by then, so the two have a commit in common, and exit 1 is not git's answer.
  now = line => (line === `merge-base ${BASE} refs/heads/feat-squash` ? { exitCode: 1, stdout: '', stderr: '' } : one(line))
  expect((await call($, 'prune_branches')).result).toContain('kept: feat-squash (upstream gone, check failed: exit 1)')
  expect(deleted(calls)).toEqual(Array(5).fill('branch -D claude/done'))
})

// feat-hand has a merge commit, M, with a tree that differs from the automatic
// merge of its parents: it was amended to undo part of the merged work.
// feat-clean has a merge commit, N, that is the automatic merge, as one made by
// `git merge origin/main` is. The merge repeated from M finds what the base lacks.
test('prune_branches checks a merge commit with a change of its own, and skips one with none', async ($: any, on: any) => {
  const git = (line: string) => {
    if (line.startsWith(GONE)) return 'feat-hand\t[gone]\nfeat-clean\t[gone]'
    if (line.startsWith('rev-list --no-merges --ancestry-path=FORK')) return 'c1'
    if (line.startsWith('rev-list --merges --ancestry-path=FORK')) return line.endsWith('feat-hand') ? 'M' : 'N'
    if (line === 'rev-parse M^@') return 'P1\nP2'
    if (line === 'rev-parse N^@') return 'Q1\nQ2'
    if (line === 'rev-parse M^{tree}') return 'HAND'
    if (line === 'rev-parse N^{tree}') return 'AUTO'
    if (line === `${MERGE} P1 P2` || line === `${MERGE} Q1 Q2`) return 'AUTO'
    if (line === since('feat-hand', 'M')) return 'OTHER'
    return reap(line)
  }
  const calls = world(on, git)
  expect((await call($, 'prune_branches')).result).toContain('kept: feat-hand (upstream gone, content not on origin/main)')
  expect(calls).toContain(since('feat-clean', 'c1'))
  expect(calls).not.toContain(since('feat-clean', 'N'))
  expect(deleted(calls)).toContain('branch -D feat-clean')
  expect(deleted(calls)).not.toContain('branch -D feat-hand')
})

test('prune_branches keeps a branch whose merge commits cannot be listed, or that has a merge of three parents', async ($: any, on: any) => {
  const over: Record<string, string | number> = {}
  const calls = world(on, line => over[line] ?? (line.startsWith(GONE) ? 'feat-x\t[gone]' : line.startsWith('rev-list --no-merges --ancestry-path=FORK') ? 'c1' : reap(line)))
  const list = 'rev-list --merges --ancestry-path=FORK refs/remotes/origin/main..refs/heads/feat-x'
  over[list] = 128
  expect((await call($, 'prune_branches')).result).toContain('kept: feat-x')
  over[list] = 'M'
  over['rev-parse M^@'] = 'P1\nP2\nP3'
  over[since('feat-x', 'M')] = 'OTHER'
  expect((await call($, 'prune_branches')).result).toContain('kept: feat-x')
  expect(calls).not.toContain(`${MERGE} P1 P2`)
  expect(deleted(calls)).not.toContain('branch -D feat-x')
})

test('prune_branches reports that nothing was checked when the base tree or the empty tree cannot be read', async ($: any, on: any) => {
  let failing = ''
  world(on, line => (line === failing ? 128 : reap(line)))
  failing = `rev-parse --verify -q ${BASE}^{tree}`
  expect((await call($, 'prune_branches')).result).toContain('warning: no branch with a gone upstream was checked: the tree of origin/main could not be read')
  failing = 'hash-object -t tree /dev/null'
  expect((await call($, 'prune_branches')).result).toContain('warning: no branch with a gone upstream was checked: the empty tree could not be read')
})

test('prune_branches has no warning in a repo with no origin', async ($: any, on: any) => {
  world(on, line => (line === 'remote get-url origin' ? 2 : line === `rev-parse --verify -q ${BASE}^{tree}` ? 128 : reap(line)))
  expect((await call($, 'prune_branches')).result).toBe('deleted: claude/done (merged into main)')
})

test('prune_branches checks the gone upstreams where there is no local default branch', async ($: any, on: any) => {
  const calls = world(on, line => (line === `${READ}refs/heads/main` ? '' : line.startsWith('for-each-ref --merged') ? 128 : reap(line)))
  expect((await call($, 'prune_branches')).isError).toBeFalsy()
  expect(deleted(calls)).toEqual(['branch -D feat-squash', 'branch -D feat-merged'])
})

// git has no switch that turns off the drivers set in this one file.
test('prune_branches checks no gone upstream where a merge driver is set in .git/info/attributes', async ($: any, on: any) => {
  const files = { '/repo/.git/info/attributes': '# no merge=ours here\n*.txt text\n' }
  const calls = world(on, reap, undefined, [], files)
  expect((await call($, 'prune_branches')).result).toContain('deleted: feat-squash')
  files['/repo/.git/info/attributes'] += ' ver.txt\tmerge=ours\n'
  expect((await call($, 'prune_branches')).result).toBe('deleted: claude/done (merged into main)\nwarning: a merge driver is set in .git/info/attributes, so no branch with a gone upstream was checked')
  expect(deleted(calls)).toEqual(['branch -D claude/done', 'branch -D feat-squash', 'branch -D feat-merged', 'branch -D claude/done'])
})

// On a file system that ignores case, `git checkout Feat-Squash` leaves HEAD at
// refs/heads/Feat-Squash for the branch feat-squash, and git deletes that
// branch from under the worktree.
test('prune_branches leaves a branch that a worktree has checked out under another capitalization', async ($: any, on: any) => {
  const list = trees(...['Claude/Done', 'Feat-Squash', 'feat-upper'].map((b): [string, string] => [`/repo/${b}`, b]))
  const git = (line: string) => (line === 'worktree list --porcelain -z' ? list : line.startsWith(GONE) ? 'feat-squash\t[gone]\nFeat-Upper\t[gone]' : reap(line))
  const calls = world(on, git)
  expect((await call($, 'prune_branches')).result).toBe('deleted: claude/r1-a (merged into main)\nmerged, still checked out: feat-squash\nmerged, still checked out: Feat-Upper')
  expect(deleted(calls)).toEqual(['branch -D claude/r1-a'])
})

test('landing_facts reads git config first, and is unknown where no host tool is installed', async ($: any, on: any) => {
  const config: Record<string, string> = { originVisibility: 'Private', landing: 'pr', holdFork: 'false', holdPrText: 'true' }
  const git = (line: string) => {
    if (line === 'remote get-url origin') return 'https://example.com/a/b.git'
    if (line === 'remote get-url upstream') return 2
    if (line.startsWith('config --get')) return config[line.split('.')[1]] ?? 1
    if (line.startsWith(READ)) return shown(line)
  }
  const calls = world(on, git)
  expect((await call($, 'landing_facts')).result).toBe('fork: no\norigin visibility: private (git config)\nlanding mode: pr (git config)\nholds lifted: holdFork')
  expect(calls.filter(c => c.startsWith('gh') || c.startsWith('glab'))).toEqual([])
  for (const key of Object.keys(config)) delete config[key]
  expect((await call($, 'landing_facts')).result).toBe('fork: no\norigin visibility: unknown\nlanding mode: unknown\nholds lifted: none')
})

test('landing_facts reports a lookup of upstream that failed, and not that the repo is no fork', async ($: any, on: any) => {
  world(on, line => (line === 'remote get-url upstream' ? { exitCode: 1, stdout: '', stderr: '' } : line === 'remote get-url origin' ? 'https://example.com/a/b.git' : 1))
  const ran = await call($, 'landing_facts')
  expect(ran.isError).toBe(true)
  expect(ran.text).toBe('landing_facts: check failed: exit 1')
})

test('landing_facts reads a protected default branch, or a pull-request ruleset, as pr mode', async ($: any, on: any) => {
  const git = (line: string) => (line === 'remote get-url origin' ? 'https://github.com/a/b.git' : line.startsWith(READ) ? shown(line) : line === 'remote get-url upstream' ? undefined : 1)
  const gh = (isProtected: string, rules: string) => (line: string) =>
    line.includes('visibility') ? 'PUBLIC' : line.includes('nameWithOwner') ? 'a/b' : line.includes('/rules/') ? rules : line.startsWith('gh api') ? isProtected : undefined
  let now = gh('', '')
  world(on, git, line => now(line))
  for (const [isProtected, rules, mode] of [['true', '', 'pr'], ['false', 'deletion\npull_request', 'pr'], ['false', 'deletion', 'merge']]) {
    now = gh(isProtected, rules)
    expect((await call($, 'landing_facts')).result).toBe(`fork: yes, an upstream remote is set\norigin visibility: public (gh)\nlanding mode: ${mode} (gh)\nholds lifted: none`)
  }
})

test('a push is read with the directory it runs in, from -C or the last cd before it, and a dry run is told apart', () => {
  expect(pushTarget('git push')).toEqual({ dir: undefined, dryRun: false, force: false })
  expect(pushTarget('git -C "/a b" push origin main')).toEqual({ dir: '/a b', dryRun: false, force: false })
  expect(pushTarget(`cd /x && git fetch && cd '/y' && git push -u origin b`)).toEqual({ dir: '/y', dryRun: false, force: false })
  expect(pushTarget('cd /x && git -C /z push')?.dir).toBe('/z')
  expect(pushTarget('git push --dry-run')?.dryRun).toBe(true)
  expect(pushTarget('git push -n origin main')?.dryRun).toBe(true)
  expect(pushTarget('git push origin main && git log -n 1')?.dryRun).toBe(false)
  // A path with a shell variable in it cannot be read, so the session's repo is checked.
  expect(pushTarget('cd /x; git push')?.dir).toBe('/x')
  expect(pushTarget('Set-Location /x; git push')?.dir).toBe('/x')
  expect(pushTarget('pushd /x && git push')?.dir).toBe('/x')
  expect(pushTarget('cd "$WT" && git push')?.dir).toBeUndefined()
  expect(pushTarget('echo "git push"')).toBeNull()
  expect(pushTarget('claude -p "git -C /z push" && git push')).toEqual({ dir: undefined, dryRun: false, force: false })
  expect(pushTarget(`git commit -F - <<'EOF'\nThen git -C /z push it\nEOF\ncd /y && git push`)?.dir).toBe('/y')
})

// The engine's own verdict beneath the plugin is an allow.
const verdict = ($: any, command: string, tool = 'Bash') => $.tool.check({ tool, input: { command } })
function pushWorld(on: any, config: Record<string, string>, upstream = false) {
  on('tool.check', () => ({ decision: 'allow' }))
  return world(on, line => {
    if (line === 'remote get-url origin') return 'https://example.com/a/b.git'
    if (line === 'remote get-url upstream') return upstream ? 'https://example.com/up/b.git' : 2
    if (line.startsWith('config --get')) return config[line.split('.')[1]] ?? 1
  })
}

test('a push to a public origin, or of unknown visibility, is put to the user, in either shell', async ($: any, on: any) => {
  const config: Record<string, string> = { originVisibility: 'public' }
  pushWorld(on, config)
  for (const tool of ['Bash', 'PowerShell']) {
    const held = await verdict($, 'git push origin main', tool)
    expect(held.decision).toBe('ask')
    expect(held.reason).toContain('origin is public')
    expect(held.reason).toContain('git config session-skills.holdPublicPush false')
  }
  delete config.originVisibility
  expect((await verdict($, 'git push')).reason).toContain("origin's visibility is unknown")
})

test('a push to a private origin, with the public hold lifted, or a dry run, is not held', async ($: any, on: any) => {
  const config: Record<string, string> = { originVisibility: 'private' }
  const calls = pushWorld(on, config)
  expect((await verdict($, 'git push')).decision).toBe('allow')
  Object.assign(config, { originVisibility: 'public', holdPublicPush: 'false' })
  expect((await verdict($, 'git push')).decision).toBe('allow')
  delete config.holdPublicPush
  calls.length = 0
  expect((await verdict($, 'git push --dry-run origin main')).decision).toBe('allow')
  expect((await verdict($, 'git log origin/main..main')).decision).toBe('allow')
  expect(calls).toEqual([])
})

test('a fork holds a push until holdFork is lifted, and then by visibility', async ($: any, on: any) => {
  const config: Record<string, string> = { originVisibility: 'public' }
  pushWorld(on, config, true)
  expect((await verdict($, 'git push')).reason).toContain('git config session-skills.holdFork false')
  config.holdFork = 'false'
  expect((await verdict($, 'git push')).reason).toContain('holdPublicPush')
  config.originVisibility = 'private'
  expect((await verdict($, 'git push')).decision).toBe('allow')
})

test('the hold is read in the directory the push runs in, and a failed read holds the push', async ($: any, on: any) => {
  on('tool.check', () => ({ decision: 'allow' }))
  on('session.repo', () => ({ value: { root: '/repo', remote: null, internal: false } }))
  const dirs: string[] = []
  on('process.run', (_$: any, e: any) => {
    dirs.push(e.argv[2])
    const line = e.argv.slice(3).join(' ')
    if (line === 'remote get-url upstream') return { value: { exitCode: e.argv[2] === '/broken' ? 128 : 2, stdout: '', stderr: 'fatal: no' } }
    return { value: { exitCode: 0, stdout: line.includes('originVisibility') ? 'private\n' : 'https://example.com/a/b.git\n', stderr: '' } }
  })
  expect((await verdict($, 'git -C "/other repo" push')).decision).toBe('allow')
  expect(new Set(dirs)).toEqual(new Set(['/other repo']))
  dirs.length = 0
  expect((await verdict($, 'git push')).decision).toBe('allow')
  expect(new Set(dirs)).toEqual(new Set(['/repo']))
  const failed = await verdict($, 'cd /broken && git push')
  expect(failed.decision).toBe('ask')
  expect(failed.reason).toContain('could not be checked')
})

test('a held push never reaches the shell when nobody can allow it, and a refusal underneath stands', async ($: any, on: any) => {
  pushWorld(on, { originVisibility: 'public' })
  let ran = 0
  on('tool.call', { tool: 'Bash' }, () => { ran++; return { result: {} } })
  const refused = await $.tool.call({ tool: 'Bash', command: 'git push' })
  expect(refused.deny ?? refused.isError).toBeTruthy()
  expect(ran).toBe(0)
})

test('a force push is told apart by --force*, a -f in a short-flag group, or a + refspec', () => {
  for (const cmd of ['git push --force', 'git push --force-with-lease origin b', 'git push --force-with-lease=b:abc123 origin b', 'git push -qf origin b', 'git push -f', 'git push origin +main', 'git -C /x push origin +b:b']) {
    expect(pushTarget(cmd)?.force).toBe(true)
  }
  for (const cmd of ['git push origin main', 'git push -u origin fix-force', 'git push -q origin b && git log --force', 'git commit -m "push --force later" && git push']) {
    expect(pushTarget(cmd)?.force).toBe(false)
  }
})

test('a force push is put to the user whatever the holds, but a dry run is not', async ($: any, on: any) => {
  const config: Record<string, string> = { originVisibility: 'private' }
  pushWorld(on, config)
  const forced = await verdict($, 'git push --force-with-lease origin b')
  expect(forced.decision).toBe('ask')
  expect(forced.reason).toContain('Force push')
  expect(forced.reason).not.toContain('Push held')
  config.originVisibility = 'public'
  const both = await verdict($, 'git push -f origin b')
  expect(both.reason).toContain('Force push')
  expect(both.reason).toContain('holdPublicPush')
  expect((await verdict($, 'git push --dry-run --force origin b')).decision).toBe('allow')
})

const hostWrite = (cmd: string) => hostWrites(cmd)[0] ?? null
test('a host write from gh or glab is read from the command, with its directory and whether it opens a PR', () => {
  expect(hostWrite('gh pr create --title x --body-file f')).toEqual({ what: 'gh pr create', dir: undefined, prCreate: true, otherRepo: false })
  expect(hostWrite(`cd '/y' && glab mr create -s b -b main`)).toEqual({ what: 'glab mr create', dir: '/y', prCreate: true, otherRepo: false })
  expect(hostWrite('gh pr create -R o/r')?.otherRepo).toBe(true)
  expect(hostWrite('gh pr --repo=o/r create')?.otherRepo).toBe(true)
  expect(hostWrites('gh pr create --fill && gh issue comment 1 -b x').map(w => w.what)).toEqual(['gh pr create', 'gh issue comment'])
  const writes: [string, string][] = [
    ['gh issue comment 12 --body-file f', 'gh issue comment'],
    ['gh release create v1 --notes x', 'gh release create'],
    ['gh pr -R o/r merge 3 --squash', 'gh pr merge'],
    ['gh pr view 3 && gh pr merge 3', 'gh pr merge'],
    ['/opt/homebrew/bin/gh pr review 3 --approve', 'gh pr review'],
    ['x=$(gh workflow run ci.yml)', 'gh workflow run'],
    ['glab mr note 3 -m hi', 'glab mr note'],
    ['glab issue create -t x', 'glab issue create'],
    ['glab ci run', 'glab ci run'],
    ['gh api -X PATCH repos/o/r/issues/1', 'gh api PATCH'],
    ['gh api repos/o/r/issues -f title=x', 'gh api POST'],
    ['gh api --input body.json repos/o/r/issues', 'gh api POST'],
    ['gh api --method=DELETE repos/o/r/labels/x', 'gh api DELETE'],
    ['gh api -XPUT repos/o/r/subscription', 'gh api PUT'],
    [`gh api -X 'post' repos/o/r/issues`, 'gh api POST'],
    ['glab api projects/1/issues -F title=x', 'glab api POST'],
    [`gh api graphql -f query='mutation { addComment(input: {}) { clientMutationId } }'`, 'gh api graphql'],
    ['gh api graphql -F query=@q.graphql', 'gh api graphql'],
  ]
  for (const [cmd, what] of writes) expect(hostWrite(cmd)?.what).toBe(what)
  for (const cmd of [
    'gh pr view 3', 'gh pr list --state open', 'gh repo view --json visibility', 'glab mr view 3', 'gh run view 9 --log',
    'gh api repos/o/r', 'gh api -X GET search/issues -f q=x', `gh api graphql -f query='query { viewer { login } }'`,
    'echo "gh pr create"', `git commit -m 'run gh pr merge later'`, 'ghx pr create', 'gh issue list --search "gh pr merge"',
    `git commit -F - <<'EOF'\ngh pr merge 3\nEOF`, 'gh', 'gh pr',
  ]) expect(hostWrite(cmd)).toBeNull()
})

test('a host write is put to the user whatever the visibility, in either shell', async ($: any, on: any) => {
  pushWorld(on, { originVisibility: 'private', holdPrText: 'false' })
  for (const tool of ['Bash', 'PowerShell']) {
    const held = await verdict($, 'gh issue comment 1 --body-file c.md', tool)
    expect(held.decision).toBe('ask')
    expect(held.reason).toContain('`gh issue comment` writes to the remote host')
  }
  expect((await verdict($, 'gh pr merge 3')).decision).toBe('ask')
  expect((await verdict($, 'gh pr view 3')).decision).toBe('allow')
})

test('a PR or MR is opened unasked only with holdPrText lifted, in its own repo, and past the fork hold', async ($: any, on: any) => {
  const config: Record<string, string> = { originVisibility: 'private' }
  pushWorld(on, config, true)
  const held = await verdict($, 'gh pr create --title x --body-file b.md')
  expect(held.decision).toBe('ask')
  expect(held.reason).toContain('git config session-skills.holdFork false')
  config.holdFork = 'false'
  expect((await verdict($, 'gh pr create --title x --body-file b.md')).reason).toContain('git config session-skills.holdPrText false')
  config.holdPrText = 'false'
  expect((await verdict($, 'gh pr create --title x --body-file b.md')).decision).toBe('allow')
  expect((await verdict($, 'glab mr create -s b -b main')).decision).toBe('allow')
  expect((await verdict($, 'gh pr create -R up/b --title x')).decision).toBe('ask')
  expect((await verdict($, 'gh pr create --fill && gh pr comment --body x')).reason).toContain('`gh pr comment`')
})

test('a push and a host write in one command are both put to the user', async ($: any, on: any) => {
  pushWorld(on, { originVisibility: 'public' })
  const both = await verdict($, 'git push -u origin b && gh pr create --fill')
  expect(both.reason).toContain('holdPublicPush')
  expect(both.reason).toContain('holdPrText')
})

// Each command here was missed by a list of write verbs, in an adversarial pass with live probes.
test('a gh or glab subcommand is a write unless it reads or acts on this machine, however the command is written', () => {
  for (const [cmd, what] of [
    ['gh pr new --fill', 'gh pr new'],
    ['glab mr new -t x --fill --yes', 'glab mr new'],
    ['gh discussion create --title x', 'gh discussion create'],
    ['gh agent-task create "fix the bug"', 'gh agent-task create'],
    ['url="$(gh pr merge 3 --squash)"', 'gh pr merge'],
    ['echo "`gh pr merge 3`"', 'gh pr merge'],
    ["# Post the review (it's long)\ngh pr comment 3 --body-file c.md", 'gh pr comment'],
    ["$body = @'\nIt's done\n'@\ngh pr comment 3 --body $body", 'gh pr comment'],
    [`cut -d'"' -f1 x; gh pr merge 3`, 'gh pr merge'],
    ['gh api repos/o/r/issues/1/comments \\\n  -f body=hi', 'gh api POST'],
    ['gh api repos/$(gh repo view --json nameWithOwner -q .nameWithOwner)/issues -f title=x', 'gh api POST'],
    ['glab api projects/1/uploads --form file=@a.png', 'glab api POST'],
    ['& "C:\\Program Files\\GitHub CLI\\gh.exe" pr merge 3', 'gh pr merge'],
  ]) expect(hostWrites(cmd).map(w => w.what)).toContain(what)
  for (const cmd of ['gh pr create \\\n  --repo up/r --fill', 'gh pr create -Rup/r --fill', 'GH_REPO=up/r gh pr create --fill', 'gh pr create --body (Get-Content b.md -Raw) --repo up/r']) {
    expect(hostWrite(cmd)?.otherRepo).toBe(true)
  }
  expect(hostWrite('gh pr new --fill')?.prCreate).toBe(true)
  expect(hostWrite('Set-Location /fork; gh pr create --fill')?.dir).toBe('/fork')
  expect(hostWrite('{ cd /fork; gh pr create --fill; }')?.dir).toBe('/fork')
  for (const cmd of ['gh pr create --help', 'glab mr merge -h', 'gh auth status', 'gh extension install o/gh-x', 'gh pr checks 3 --watch', 'glab ci trace', 'gh run watch 9', '# then gh pr merge 3']) {
    expect(hostWrite(cmd)).toBeNull()
  }
})
