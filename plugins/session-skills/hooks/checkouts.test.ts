// claude plugin test: where a new branch starts, the tools, the push and post
// modes, and the permission rules written for them, against a faked git. The
// costly errors are a branch opened without commits held on the local default
// branch, an unmerged branch deleted by the prune, and a clone in a confirm
// mode with no rule in its settings file.
import { expect, test } from 'claude-code/testing'
import { askRules, outward, pickBase, POST_RULES, PUSH_RULES, refLine } from './checkouts'

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

test('a ref is read from the line with its name, and no such line is a ref that is absent', () => {
  const head = 'refs/remotes/origin/HEAD'
  expect(refLine('', head)).toBeNull()
  expect(refLine('refs/heads/main \n', 'refs/heads/main')).toEqual({ symref: '' })
  expect(refLine(`${head} refs/remotes/origin/main\n`, head)).toEqual({ symref: 'refs/remotes/origin/main' })
  expect(refLine(`${head} \r\n`, head)).toEqual({ symref: '' })
  expect(refLine('refs/heads/main/topic \n', 'refs/heads/main')).toBeNull()
  expect(refLine('refs/heads/main \nrefs/heads/main/topic \n', 'refs/heads/main')).toEqual({ symref: '' })
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
  on('fs.write', (_$: any, e: any) => { files[posix(e.path)] = e.text; return { value: undefined } })
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
  world(on, line => (line === 'rev-parse --show-toplevel' ? 128 : line === 'config --get session-skills.pushMode' ? 'auto-push' : held(line)))
  expect((await call($, 'find_checkouts')).result).toContain('session directory: /repo/.claude/worktrees/removed\n')
  expect((await call($, 'prune_branches')).isError).toBeUndefined()
  expect((await call($, 'landing_facts')).result).toContain('push: auto-push (git config session-skills.pushMode)')
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
test('the tools report a lookup of origin that failed, and fetch and prune nothing', async ($: any, on: any) => {
  let said: Said = { exitCode: 128, stdout: '', stderr: 'fatal: bad config line 1 in file .git/config\n' }
  const calls = world(on, line => (line === 'remote get-url origin' ? said : reap(line)))
  for (const [name, input] of [['find_checkouts', {}], ['prune_branches', {}], ['landing_facts', {}]] as const) {
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
  const calls = world(on, held)
  await call($, 'find_checkouts')
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
  test(`the tools report a read of ${what} that failed, and set and prune nothing`, async ($: any, on: any) => {
    let said: Said = { exitCode: 128, stdout: '', stderr: 'fatal: unexpected line in .git/packed-refs: garbage\nmore\n' }
    const calls = world(on, line => (line === failing ? said : reap(line)))
    for (const [name, input] of [['find_checkouts', {}], ['prune_branches', {}]] as const) {
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
test('the tools report an origin/HEAD that is still not a symbolic ref, and prune nothing on a guess', async ($: any, on: any) => {
  const calls = world(on, line => (line.includes('fetch') ? 1 : line === READ + HEAD ? shown(line, '') : reap(line)))
  for (const [name, input] of [['find_checkouts', {}], ['prune_branches', {}]] as const) {
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

test('the rules are written for both shells, with a push under -C and a gh api write told by its flags', () => {
  for (const rule of ['Bash(git push *)', 'PowerShell(git push *)', 'Bash(git -C * push *)']) expect(PUSH_RULES).toContain(rule)
  for (const rule of ['Bash(gh pr create *)', 'PowerShell(glab mr note *)', 'Bash(gh release create *)', 'Bash(gh api -X *)', 'Bash(gh api * --field *)']) expect(POST_RULES).toContain(rule)
  for (const rule of ['Bash(gh pr view *)', 'Bash(gh api *)', 'Bash(glab mr list *)']) expect(POST_RULES).not.toContain(rule)
})

test('rules are added to a settings file beside what it has, and taken out without another key or rule', () => {
  expect(JSON.parse(askRules('', ['a', 'b'])!)).toEqual({ permissions: { ask: ['a', 'b'] } })
  const had = JSON.stringify({ model: 'x', permissions: { allow: ['Read'], ask: ['mine', 'a'] } })
  expect(JSON.parse(askRules(had, ['a', 'b'])!)).toEqual({ model: 'x', permissions: { allow: ['Read'], ask: ['mine', 'a', 'b'] } })
  expect(JSON.parse(askRules(had, [], ['a', 'b'])!)).toEqual({ model: 'x', permissions: { allow: ['Read'], ask: ['mine'] } })
  expect(askRules('{"permissions":{"ask":["a"]}}', [], ['a'])).toBe('{}\n')
  expect(askRules(had, ['a'])).toBeNull()
  expect(askRules('', [])).toBeNull()
  for (const text of ['[]', '{"permissions":{"ask":"a"}}']) expect(() => askRules(text, ['a']), text).toThrow()
  expect(() => askRules('{ not json', ['a'])).toThrow()
})

// A clone at /repo with a worktree, a git config, and a file system that is written to.
const LOCAL = '/repo/.claude/settings.local.json'
const WT_LOCAL = '/repo/.claude/worktrees/r1-a/.claude/settings.local.json'
function clone(on: any, config: Record<string, string>, files: Record<string, string> = {}, upstream = false, ignored = false) {
  const w = { files, asked: [] as string[], answer: 'Switch' as string | null, toasts: [] as string[], gone: '' }
  on('fs.exists', (_$: any, e: any) => ({ value: e.path in files || (!e.path.endsWith('.json') && e.path !== w.gone) }))
  on('fs.read', (_$: any, e: any) => {
    if (!(e.path in files)) throw new Error('ENOENT')
    return { value: files[e.path] }
  })
  on('fs.write', (_$: any, e: any) => { files[e.path] = e.text; return { value: undefined } })
  // $.ui.ask is a call of AskUserQuestion, and rejects where it is dismissed.
  on('tool.call', { tool: 'AskUserQuestion' }, (_$: any, e: any) => {
    const question = e.questions[0].question
    w.asked.push(question)
    if (w.answer === null) throw new Error('no one to ask')
    return { result: { questions: e.questions, answers: { [question]: w.answer } } }
  })
  on('ui.toast', (_$: any, e: any) => { w.toasts.push(e.text ?? String(e)); return { value: undefined } })
  on('session.start', (_$: any, e: any) => e)
  on('tool.register', () => ({ value: undefined }))
  on('env.get', () => ({ value: undefined }))
  on('session.repo', () => ({ value: { root: '/repo', remote: null, internal: false } }))
  on('session.cwd', () => ({ value: '/repo/.claude/worktrees/r1-a/src' }))
  on('process.run', (_$: any, e: any) => {
    const line = (e.argv as string[]).slice(3).join(' ')
    const said = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '' } })
    if (e.argv[0] !== 'git') throw new Error('ENOENT')
    if (line === 'remote get-url upstream') return upstream ? said('https://example.com/up/b.git\n') : said('', 2)
    if (line === 'remote get-url origin') return said('https://example.com/a/b.git\n')
    if (line.startsWith('config --get session-skills.')) return line.split('.')[1]! in config ? said(`${config[line.split('.')[1]!]}\n`) : said('', 1)
    if (line.startsWith('config session-skills.')) {
      const [key, value] = line.slice('config session-skills.'.length).split(' ')
      config[key!] = value!
      return said('')
    }
    if (line === 'rev-parse --show-toplevel') return said('/repo/.claude/worktrees/r1-a\n')
    if (line === 'worktree list --porcelain -z') return said(LIST)
    if (line.startsWith('check-ignore')) return said('', ignored ? 0 : 1)
    if (line === 'rev-parse --path-format=absolute --git-common-dir') return said('/repo/.git\n')
    return said('', 1)
  })
  return w
}
const asks = (text: string | undefined): string[] => (text ? JSON.parse(text).permissions?.ask ?? [] : [])

test('landing_facts reports the modes with where each was read, and a confirm mode where none is set', async ($: any, on: any) => {
  const config: Record<string, string> = {}
  clone(on, config)
  expect((await call($, 'landing_facts')).result).toBe('fork: no\npush: confirm-push (the default)\npost: confirm-post (the default)\nlanding: unknown')
  Object.assign(config, { pushMode: 'auto-push', postMode: 'auto-post', landing: 'merge' })
  expect((await call($, 'landing_facts')).result).toBe('fork: no\npush: auto-push (git config session-skills.pushMode)\npost: auto-post (git config session-skills.postMode)\nlanding: merge (git config)')
  // A mode that is set is read before a key of 0.29.0, and a value that is no mode is not read.
  Object.assign(config, { pushMode: 'confirm-push', postMode: 'auto', holdPublicPush: 'false', holdPrText: 'false' })
  expect((await call($, 'landing_facts')).result).toContain('push: confirm-push (git config session-skills.pushMode)\npost: auto-post (git config session-skills.holdPrText false)')
  delete config.pushMode
  expect((await call($, 'landing_facts')).result).toContain('push: auto-push (git config session-skills.holdPublicPush false)')
})

test('in a fork a post is always confirmed, the push follows its mode, and the landing is a pull request', async ($: any, on: any) => {
  clone(on, { pushMode: 'auto-push', postMode: 'auto-post', landing: 'merge', holdFork: 'false' }, {}, true)
  expect((await call($, 'landing_facts')).result).toBe('fork: yes, an upstream remote is set\npush: auto-push (git config session-skills.pushMode)\npost: confirm-post (always, in a fork)\nlanding: pr (a fork)')
  const ran = await call($, 'set_push_policy', { post: 'auto-post' })
  expect(ran.isError).toBe(true)
  expect(ran.text).toContain('a fork')
})

test('landing_facts reports a lookup of upstream that failed, and not that the repo is no fork', async ($: any, on: any) => {
  world(on, line => (line === 'remote get-url upstream' ? { exitCode: 1, stdout: '', stderr: '' } : line === 'remote get-url origin' ? 'https://example.com/a/b.git' : 1))
  const ran = await call($, 'landing_facts')
  expect(ran.isError).toBe(true)
  expect(ran.text).toBe('landing_facts: check failed: exit 1')
})

test('landing_facts reads a protected default branch, or a pull-request ruleset, as pr mode', async ($: any, on: any) => {
  const git = (line: string) => (line === 'remote get-url origin' ? 'https://github.com/a/b.git' : line.startsWith(READ) ? shown(line) : line === 'remote get-url upstream' ? 2 : 1)
  const gh = (isProtected: string, rules: string) => (line: string) =>
    line.includes('nameWithOwner') ? 'a/b' : line.includes('/rules/') ? rules : line.startsWith('gh api') ? isProtected : undefined
  let now = gh('', '')
  world(on, git, line => now(line))
  for (const [isProtected, rules, mode] of [['true', '', 'pr'], ['false', 'deletion\npull_request', 'pr'], ['false', 'deletion', 'merge']]) {
    now = gh(isProtected, rules)
    expect((await call($, 'landing_facts')).result).toContain(`landing: ${mode} (gh)`)
  }
})

test('a session start writes the rules of each confirm mode for the primary checkout and the directory it starts in', async ($: any, on: any) => {
  const w = clone(on, {}, { [LOCAL]: JSON.stringify({ permissions: { allow: ['Read'], ask: ['mine'] } }), '/repo/.git/info/exclude': '# local\n' })
  await $.session.start({ cwd: '/repo' })
  expect(asks(w.files[LOCAL])).toEqual(['mine', ...PUSH_RULES, ...POST_RULES])
  expect(JSON.parse(w.files[LOCAL]!).permissions.allow).toEqual(['Read'])
  expect(asks(w.files[WT_LOCAL])).toEqual([...PUSH_RULES, ...POST_RULES])
  expect(w.files['/repo/.git/info/exclude']).toBe('# local\n**/.claude/settings.local.json\n')
  expect(w.toasts).toEqual([])
})

test('a session start writes no rule for an auto mode, takes none out, and leaves an ignored file out of the exclude file', async ($: any, on: any) => {
  const before = JSON.stringify({ permissions: { ask: PUSH_RULES } })
  const w = clone(on, { pushMode: 'auto-push', postMode: 'auto-post' }, { [LOCAL]: before }, false, true)
  await $.session.start({ cwd: '/repo' })
  expect(w.files).toEqual({ [LOCAL]: before })
  delete w.files[LOCAL]
  await $.session.start({ cwd: '/repo' })
  expect(w.files).toEqual({})
})

test('a settings file that is not JSON is left as it is, and the user is told', async ($: any, on: any) => {
  const w = clone(on, {}, { [LOCAL]: '{ not json' })
  await $.session.start({ cwd: '/repo' })
  expect(w.files[LOCAL]).toBe('{ not json')
  expect(w.toasts.join()).toContain(LOCAL)
})

test('set_push_policy asks before a switch to an auto mode, then takes its rules out of every worktree', async ($: any, on: any) => {
  const config: Record<string, string> = {}
  const w = clone(on, config)
  await $.session.start({ cwd: '/repo' })
  const ran = await call($, 'set_push_policy', { push: 'auto-push' })
  expect(w.asked).toHaveLength(1)
  expect(w.asked[0]).toContain('auto-push')
  expect(config).toEqual({ pushMode: 'auto-push' })
  expect(asks(w.files[LOCAL])).toEqual(POST_RULES)
  expect(asks(w.files[WT_LOCAL])).toEqual(POST_RULES)
  expect(ran.result).toContain(`push: auto-push (git config session-skills.pushMode)\npost: confirm-post (the default)\nrules written: ${LOCAL}`)
  // Back to a confirm mode with no question, and the rules are written again.
  await call($, 'set_push_policy', { push: 'confirm-push' })
  expect(w.asked).toHaveLength(1)
  expect(asks(w.files[WT_LOCAL])).toEqual([...POST_RULES, ...PUSH_RULES])
  // Nothing is written into a worktree whose directory is gone.
  delete w.files[WT_LOCAL]
  w.gone = '/repo/.claude/worktrees/r1-a'
  await call($, 'set_push_policy', { post: 'confirm-post' })
  expect(w.files[WT_LOCAL]).toBeUndefined()
})

test('set_push_policy changes nothing when the user keeps the mode, when nobody can be asked, or for a value that is no mode', async ($: any, on: any) => {
  const config: Record<string, string> = {}
  const w = clone(on, config)
  w.answer = 'Keep confirming'
  expect((await call($, 'set_push_policy', { push: 'auto-push', post: 'auto-post' })).result).toContain('push: confirm-push')
  w.answer = null
  expect((await call($, 'set_push_policy', { post: 'auto-post' })).isError).toBe(true)
  expect((await call($, 'set_push_policy', { push: 'auto' })).isError).toBe(true)
  expect((await call($, 'set_push_policy', {})).isError).toBe(true)
  expect(config).toEqual({})
  expect(w.files).toEqual({})
})

// The reader behind the request for a next step.
// The reader behind the push and host-write holds.
const pushes = (cmd: string, shell = 'Bash') => outward(cmd, shell).pushes

test('a push is read with the directory it runs in, from -C or the last cd before it', () => {
  expect(pushes('git push')).toEqual([{ dir: undefined, force: false, dryRun: false }])
  expect(pushes('git -C "/other repo" push origin main')).toEqual([{ dir: '/other repo', remote: 'origin', force: false, dryRun: false }])
  expect(pushes('cd /a && git -C sub push')[0]!.dir).toBe('/a/sub')
  expect(pushes('cd /a; cd b\ngit -c x=y --no-pager push')[0]!.dir).toBe('/a/b')
  expect(pushes('cd "$WT" && git push')[0]!.dir).toBeNull()
  expect(pushes('sudo /usr/bin/git push up')[0]!.remote).toBe('up')
  expect(pushes('git push "$REMOTE" main')[0]!.remote).toBeNull()
  expect(pushes('git push --repo=up -o ci.skip main')[0]!.remote).toBe('up')
})

test('a force push is read in each of its forms, and a dry run or help is told apart', () => {
  for (const cmd of ['git push -f', 'git push -uf origin b', 'git push --force-with-lease', 'git push --mirror', 'git push origin +main', 'git push origin -- +main']) {
    expect(pushes(cmd)[0]!.force, cmd).toBe(true)
  }
  for (const cmd of ['git push -u origin main', 'git push origin main:main', 'git push --follow-tags']) expect(pushes(cmd)[0]!.force, cmd).toBe(false)
  for (const cmd of ['git push -n', 'git push --dry-run origin main', 'git push --help']) expect(pushes(cmd)[0]!.dryRun, cmd).toBe(true)
})

test('a push only mentioned in a quoted word, a comment, or a heredoc body is not read, unless a shell reads the body', () => {
  for (const cmd of ['git commit -m "then git push"', 'echo done # git push', 'git stash push -m x', "claude -p 'run git push'", "cat <<'EOF' > notes.md\ngit push -f\nEOF"]) {
    expect(pushes(cmd), cmd).toEqual([])
  }
  expect(pushes("git commit -m \"$(cat <<'EOF'\nIt's done \"now\nEOF\n)\" && git push")).toHaveLength(1)
  expect(pushes('bash <<EOF\ngit push\nEOF')).toHaveLength(1)
  expect(pushes('x=$((1<<2)); git push')).toHaveLength(1)
})

test('PowerShell escapes with a backtick and keeps a backslash in a path', () => {
  expect(pushes('git push `\n-f origin main', 'PowerShell')[0]!.force).toBe(true)
  expect(pushes('Set-Location C:\\work\\repo; git push', 'PowerShell')[0]!.dir).toBe('C:\\work\\repo')
  expect(pushes('git -C "C:\\a b" push', 'PowerShell')[0]!.dir).toBe('C:\\a b')
})

test('a redirection is not read as the remote', () => {
  for (const cmd of ['git push 2>&1 | tail -5', 'git push -u 2>&1', 'git push > /tmp/push.log 2>&1', 'git push >/dev/null', 'git push &>log']) {
    expect(pushes(cmd)[0]!.remote, cmd).toBeUndefined()
  }
  expect(pushes('git push 2>&1 | Select-Object -Last 5', 'PowerShell')[0]!.remote).toBeUndefined()
  expect(pushes('git push origin main 2>&1')[0]!.remote).toBe('origin')
})

test('a braced variable or a substitution stays in its word, and a push inside a substitution is read', () => {
  expect(pushes('git -C ${WT} push origin main')[0]!.dir).toBeNull()
  expect(pushes('git -C $(git rev-parse --show-toplevel) push origin main')[0]!.dir).toBeNull()
  expect(pushes('git -C `pwd` push origin main')[0]!.dir).toBeNull()
  expect(pushes('out=$(git push 2>&1)')).toHaveLength(1)
})

test('a PowerShell here-string body is not read, and the command after it is', () => {
  expect(pushes("$b = @'\nThis doesn't change behavior, so git push\n'@\ngit commit -m $b", 'PowerShell')).toEqual([])
  expect(outward('$b = @"\nA "quote\n"@\ngit push -f', 'PowerShell').pushes[0]!.force).toBe(true)
})
