// claude plugin test: the two worktree tools, against a faked git. The costly
// errors are a worktree opened from a ref that is not the base, a settings file
// written, which Claude Code refuses under managed settings, and a directory
// outside .claude/worktrees deleted.
import { expect, test } from 'claude-code/testing'

// A primary checkout at /repo. `git` answers a command, given without its
// `-C <dir>`, with its stdout, an exit code, a whole result, or nothing for an
// empty success. A program other than git cannot start unless `other` answers
// for it, and a `deny` from it is Claude Code's refusal. A file reads as empty
// unless `files` has it. The session's directory is a worktree that was
// removed, so no program starts unless it is run in /repo.
type Said = string | number | void | { exitCode: number; stdout: string; stderr: string }
function world(on: any, git: (argv: string) => Said, other?: (argv: string) => string | void | { deny: string }, paths: string[] = [], files: Record<string, string> = {}, root = '/repo') {
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
    if (typeof said === 'object') return 'deny' in said ? said : { value: said }
    return { value: typeof said === 'number' ? { exitCode: said, stdout: '', stderr: 'fatal: no' } : { exitCode: 0, stdout: said ? `${said}\n` : '', stderr: '' } }
  })
  return calls
}
const call = ($: any, name: string, input: object = {}) => $.tool.call({ tool: `mcp__parallel-session-skills__${name}`, ...input })
const held = (line: string) => (line.startsWith('show-ref') ? 1 : undefined)

test('open_worktree opens from the base it is given without a fetch, and links the notes directory', async ($: any, on: any) => {
  const calls = world(on, held, line => (line.startsWith('ln -s') ? '' : undefined), ['/repo/notes.local'])
  const text = (await call($, 'open_worktree', { base: 'main', name: 'parser-cache', id: 'R78' })).result
  expect(calls).toContain('worktree add --no-track /repo/.claude/worktrees/r78-parser-cache -b claude/r78-parser-cache refs/heads/main')
  expect(calls.filter(c => c.includes('fetch'))).toEqual([])
  expect(calls).toContain('ln -s /repo/notes.local /repo/.claude/worktrees/r78-parser-cache/notes.local')
  expect(text).toContain('worktree: /repo/.claude/worktrees/r78-parser-cache\nbranch: claude/r78-parser-cache\nopened from: main\n')
})

test('open_worktree takes a Jira-style ID with a hyphen', async ($: any, on: any) => {
  const calls = world(on, held, undefined, [])
  expect((await call($, 'open_worktree', { base: 'main', name: 'parser-cache', id: 'ABC-123' })).result).toContain('branch: claude/abc-123-parser-cache\n')
  expect(calls).toContain('worktree add --no-track /repo/.claude/worktrees/abc-123-parser-cache -b claude/abc-123-parser-cache refs/heads/main')
  for (const id of ['-ABC', 'ABC-', 'ABC--1', '..']) expect((await call($, 'open_worktree', { base: 'main', name: 'a-b', id })).isError).toBe(true)
})

test('open_worktree suffixes a name that a directory or a branch already has', async ($: any, on: any) => {
  const calls = world(on, line => (line === 'show-ref --verify --quiet refs/heads/claude/a-b-2' ? undefined : held(line)), undefined, ['/repo/.claude/worktrees/a-b'])
  expect((await call($, 'open_worktree', { base: 'main', name: 'a-b' })).result).toContain('branch: claude/a-b-3\n')
  expect(calls).toContain('worktree add --no-track /repo/.claude/worktrees/a-b-3 -b claude/a-b-3 refs/heads/main')
})

test('open_worktree refuses a name that is not lowercase words joined by hyphens, and reports a notes directory it could not link', async ($: any, on: any) => {
  const calls = world(on, held, undefined, ['/repo/notes.local'])
  for (const input of [{ name: 'Roadmap Lap' }, { name: '../x' }, { name: 'a-b', id: 'R1/..' }, { name: 'a-b', notes: '../etc' }]) {
    expect((await call($, 'open_worktree', { base: 'main', ...input })).isError).toBe(true)
  }
  expect(calls.filter(c => c.startsWith('worktree add'))).toEqual([])
  expect((await call($, 'open_worktree', { base: 'main', name: 'a-b' })).result).toContain('warning: notes.local was not linked')
})

test('open_worktree does not link the notes directory over one that is already in the worktree', async ($: any, on: any) => {
  const calls = world(on, held, line => (line.startsWith('ln -s') ? '' : undefined), ['/repo/notes.local', '/repo/.claude/worktrees/a-b/notes.local'])
  const text = (await call($, 'open_worktree', { base: 'main', name: 'a-b' })).result
  expect(text).toContain('warning: notes.local was not linked into the worktree, so write notes to /repo/notes.local: it is already there')
  expect(calls.filter(c => c.startsWith('ln'))).toEqual([])
})

test('open_worktree takes a notes name of letters, digits, dots, underscores, and hyphens only', async ($: any, on: any) => {
  const calls = world(on, held, line => (line.startsWith('ln -s') ? '' : undefined), ['/repo/notes.local', '/repo/notes_2-x'])
  for (const notes of ['notes&calc', '%X%', 'a b', '.', '..', '', 'a"b']) {
    const ran = await call($, 'open_worktree', { base: 'main', name: 'a-b', notes })
    expect(ran.isError).toBe(true)
    expect(ran.text).toContain('is not the name of a directory at the repo root')
  }
  expect(calls.filter(c => c.startsWith('worktree add'))).toEqual([])
  expect((await call($, 'open_worktree', { base: 'main', name: 'a-b', notes: 'notes_2-x' })).result).toContain('notes: /repo/.claude/worktrees/a-b/notes_2-x links to')
})

test('open_worktree links a Windows notes directory with a junction', async ($: any, on: any) => {
  const cmd = (line: string) => (line.startsWith('cmd') ? '' : undefined)
  const plain = world(on, held, cmd, ['C:/repo/notes.local'], {}, 'C:/repo')
  expect((await call($, 'open_worktree', { base: 'main', name: 'a-b' })).result).toContain('notes: C:/repo/.claude/worktrees/a-b/notes.local links to')
  expect(plain.filter(c => c.startsWith('cmd'))).toEqual(['cmd /c mklink /J C:\\repo\\.claude\\worktrees\\a-b\\notes.local C:\\repo\\notes.local'])
})

// Claude Code runs git with GIT_LFS_SKIP_SMUDGE=1, so `git worktree add` leaves LFS files as pointers.
test('open_worktree pulls LFS files where the repo has them, and reports a pull that failed', async ($: any, on: any) => {
  const lfs = { '/repo/.claude/worktrees/a-b/.gitattributes': '*.jar filter=lfs diff=lfs merge=lfs -text\n' }
  let pull: Said = undefined
  const calls = world(on, line => (line === 'lfs pull' ? pull : held(line)), undefined, Object.keys(lfs), lfs)
  expect((await call($, 'open_worktree', { base: 'main', name: 'a-b' })).result).not.toContain('warning')
  expect(calls.indexOf('lfs pull')).toBeGreaterThan(calls.findIndex(c => c.startsWith('worktree add')))
  pull = { exitCode: 1, stdout: '', stderr: "git: 'lfs' is not a git command.\n" }
  expect((await call($, 'open_worktree', { base: 'main', name: 'a-b' })).result).toContain("warning: LFS files were left as pointers, so run `git lfs pull` in the worktree: git: 'lfs' is not a git command.")
})

test('open_worktree pulls nothing where the repo has no LFS files', async ($: any, on: any) => {
  const files = { '/repo/.claude/worktrees/a-b/.gitattributes': '* text=auto\n' }
  const calls = world(on, held, undefined, Object.keys(files), files)
  expect((await call($, 'open_worktree', { base: 'main', name: 'a-b' })).result).toContain('worktree: /repo/.claude/worktrees/a-b\n')
  expect(calls.filter(c => c.startsWith('lfs'))).toEqual([])
})

// In an argument, cmd reads these as operators or expands them.
test('open_worktree runs no cmd for a Windows path with a character that cmd reads as an operator', async ($: any, on: any) => {
  const calls = world(on, held, line => (line.startsWith('cmd') ? '' : undefined), ['C:/my%X%repo/notes.local'], {}, 'C:/my%X%repo')
  const text = (await call($, 'open_worktree', { base: 'main', name: 'a-b' })).result
  expect(text).toContain('warning: notes.local was not linked into the worktree, so write notes to C:/my%X%repo/notes.local: ')
  expect(calls.filter(c => c.startsWith('cmd'))).toEqual([])
})

test('open_worktree opens from origin where that is the base, and refuses a base that is not a branch', async ($: any, on: any) => {
  const calls = world(on, line => (line === 'rev-parse --verify --quiet refs/heads/nope^{commit}' ? 1 : held(line)))
  expect((await call($, 'open_worktree', { name: 'a-b', base: 'origin/main' })).result).toContain('opened from: origin/main\n')
  expect(calls).toContain('worktree add --no-track /repo/.claude/worktrees/a-b -b claude/a-b refs/remotes/origin/main')
  for (const input of [{ name: 'c-d', base: 'nope' }, { name: 'c-d' }]) {
    const ran = await call($, 'open_worktree', input)
    expect(ran.isError).toBe(true)
    expect(ran.text).toContain('is not a branch here: pass the "base for a new branch" line')
  }
  expect(calls.filter(c => c.startsWith('worktree add') && c.includes('c-d'))).toEqual([])
})

// Work in flight on a branch that no worktree has, with the primary checkout
// busy: a new branch from the base would leave the branch's commits out.
test('open_worktree checks out an existing branch in place of opening a new one, and refuses one that is not there', async ($: any, on: any) => {
  const calls = world(on, line => (line === 'show-ref --verify --quiet refs/heads/claude/r78-parser-cache' || line === 'show-ref --verify --quiet refs/heads/feature/x' ? undefined : held(line)))
  const text = (await call($, 'open_worktree', { branch: 'claude/r78-parser-cache' })).result
  expect(text).toBe('worktree: /repo/.claude/worktrees/r78-parser-cache\nbranch: claude/r78-parser-cache\nprimary checkout: /repo')
  expect((await call($, 'open_worktree', { branch: 'feature/x' })).result).toContain('worktree: /repo/.claude/worktrees/feature-x\nbranch: feature/x\n')
  expect(calls.filter(c => c.startsWith('worktree add'))).toEqual(['worktree add /repo/.claude/worktrees/r78-parser-cache claude/r78-parser-cache', 'worktree add /repo/.claude/worktrees/feature-x feature/x'])
  const ran = await call($, 'open_worktree', { branch: 'claude/gone' })
  expect(ran.text).toBe('open_worktree: branch "claude/gone" is not a branch here')
})

test('open_worktree writes no settings file', async ($: any, on: any) => {
  const primary = '/repo/.claude/settings.local.json'
  const files: Record<string, string> = { [primary]: JSON.stringify({ permissions: { ask: ['Bash(git push *)'] } }) }
  world(on, held, undefined, [primary], files)
  expect((await call($, 'open_worktree', { name: 'a-b', base: 'main' })).result).not.toContain('warning')
  expect(Object.keys(files)).toEqual([primary])
})

// The message of Claude Code 2.1.328 for a command with the model's input in its arguments.
const REPEAT = 'this repeats a Bash call that is not allowed; serve an allowed call at tool.run'

test('a junction refused under managed settings is explained in the warning of open_worktree', async ($: any, on: any) => {
  world(on, held, line => (line.startsWith('cmd') ? { deny: REPEAT } : undefined), ['C:/repo/notes.local'], {}, 'C:/repo')
  expect((await call($, 'open_worktree', { base: 'main', name: 'a-b' })).result).toContain(`warning: notes.local was not linked into the worktree, so write notes to C:/repo/notes.local: Under managed settings, Claude Code refuses a plugin's command when one of its arguments is a string from a tool call in this turn that your permission rules would not allow as a Bash command. Claude Code said: parallel-session-skills: $.process.run: ${REPEAT}`)
})

test('remove_worktree unregisters a worktree and deletes its directory, and refuses a path outside .claude/worktrees', async ($: any, on: any) => {
  const at = '/repo/.claude/worktrees/a-b'
  const calls = world(on, held, line => (line.startsWith('rm -rf') ? '' : undefined), [at])
  expect((await call($, 'remove_worktree', { path: at })).result).toBe(`unregistered: ${at}\ndeleted: ${at}`)
  expect(calls).toEqual([`worktree remove ${at}`, `rm -rf ${at}`])
  for (const path of ['/repo', '/repo/.claude/worktrees/../..', '/elsewhere/.claude/worktrees/a-b', '']) {
    expect((await call($, 'remove_worktree', { path })).isError).toBe(true)
  }
  expect(calls.length).toBe(2)
})

test('remove_worktree is a no-op for a worktree already unregistered and with its directory gone', async ($: any, on: any) => {
  world(on, line => (line.startsWith('worktree remove') ? { exitCode: 128, stdout: '', stderr: "fatal: '/repo/.claude/worktrees/a-b' is not a working tree\n" } : held(line)))
  expect((await call($, 'remove_worktree', { path: '/repo/.claude/worktrees/a-b' })).result).toBe('already unregistered: /repo/.claude/worktrees/a-b\ndirectory already gone: /repo/.claude/worktrees/a-b')
})

// On Windows a directory a process is in cannot be deleted.
test('a permission denied from git worktree remove is explained as a process in the directory, and another failure is left as git reported it', async ($: any, on: any) => {
  let stderr = "error: failed to delete 'C:/repo/.claude/worktrees/a-b': Permission denied\n"
  world(on, line => (line.startsWith('worktree remove') ? { exitCode: 255, stdout: '', stderr } : held(line)), undefined, ['C:/repo/.claude/worktrees/a-b'], {}, 'C:/repo')
  expect((await call($, 'remove_worktree', { path: 'C:/repo/.claude/worktrees/a-b' })).text).toBe("remove_worktree: git worktree remove: a process is still in the directory, such as this session's shell after a cd into it. Move the shell out or close that process, then call the tool again. git said: error: failed to delete 'C:/repo/.claude/worktrees/a-b': Permission denied")
  stderr = "fatal: 'C:/repo/.claude/worktrees/a-b' contains modified or untracked files, use --force to delete it\n"
  expect((await call($, 'remove_worktree', { path: 'C:/repo/.claude/worktrees/a-b' })).text).toBe(`remove_worktree: git worktree remove: ${stderr.trim()}`)
})

test('a delete refused under managed settings is explained in the error of remove_worktree, with the command to finish it', async ($: any, on: any) => {
  const at = 'C:/repo/.claude/worktrees/a-b'
  world(on, held, line => (line.startsWith('cmd') ? { deny: REPEAT } : undefined), [at], {}, 'C:/repo')
  const ran = await call($, 'remove_worktree', { path: 'C:\\repo\\.claude\\worktrees\\a-b' })
  expect(ran.isError).toBe(true)
  expect(ran.text).toBe(`remove_worktree: deleting ${at}: the worktree is unregistered, but its directory is left. Delete it with your shell tool: cmd /c rd /s /q "C:\\repo\\.claude\\worktrees\\a-b" in PowerShell. Under managed settings, Claude Code refuses a plugin's command when one of its arguments is a string from a tool call in this turn that your permission rules would not allow as a Bash command. Claude Code said: parallel-session-skills: $.process.run: ${REPEAT}`)
})
