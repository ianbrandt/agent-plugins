// claude plugin test: where the plan of record is, the rule added to a prompt,
// and the tool that reports both.
import { expect, test } from 'claude-code/testing'
import { planOf } from './plan'

test('a local-only roadmap comes first, then the fork check, then a tracked one', () => {
  const none = { hasLocal: false, hasUpstream: false, tracked: [] }
  expect(planOf(none)).toEqual({ kind: 'none' })
  expect(planOf({ ...none, tracked: ['ROADMAP.md'] })).toEqual({ kind: 'tracked', roadmap: 'ROADMAP.md' })
  expect(planOf({ ...none, tracked: ['docs/roadmap.md'] })).toEqual({ kind: 'tracked', roadmap: 'docs/roadmap.md' })
  expect(planOf({ ...none, tracked: ['docs/roadmap.md', 'ROADMAP.md'] })).toEqual({ kind: 'tracked', roadmap: 'ROADMAP.md' })
  expect(planOf({ ...none, hasUpstream: true, tracked: ['ROADMAP.md'] })).toEqual({ kind: 'fork-without-roadmap' })
  expect(planOf({ hasLocal: true, hasUpstream: true, tracked: ['ROADMAP.md'] })).toEqual({
    kind: 'local-only', roadmap: 'ROADMAP.local.md', history: 'ROADMAP-CHANGELOG.local.md',
  })
})

// A repo as the module reads it: the primary checkout, the files in it, whether
// it has an upstream remote, and the roadmap paths git reports as tracked. Hooks
// are registered once per test, so a test changes the repo through `now`.
// `remote` and `listed` are a lookup of the upstream remote, and a list of the
// tracked paths, that failed: git's exit code and what it wrote to stderr.
type Failed = { exitCode: number; stderr: string }
type Repo = { root?: string; files?: string[]; hasUpstream?: boolean; tracked?: string[]; remote?: Failed; listed?: Failed }
function world(on: any, first: Repo) {
  const w = { now: first, argvs: [] as string[][], cwds: [] as unknown[] }
  on('session.repo', () => ({ value: w.now.root ? { root: w.now.root, remote: null, internal: false } : null }))
  on('fs.exists', (_$: any, e: any) => ({ value: (w.now.files ?? []).includes(String(e.path).replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')) }))
  on('process.run', (_$: any, e: any) => {
    w.argvs.push(e.argv)
    w.cwds.push(e.init?.cwd)
    const out = (exitCode: number, stdout = '') => ({ value: { exitCode, stdout, stderr: '' } })
    const failed = e.argv.includes('remote') ? w.now.remote : w.now.listed
    if (failed) return { value: { stdout: '', ...failed } }
    return e.argv.includes('remote') ? out(w.now.hasUpstream ? 0 : 2) : out(0, (w.now.tracked ?? []).map(p => p + '\n').join(''))
  })
  on('prompt.submit', (_$: any, e: any) => ({ text: e.text, context: e.context }))
  return w
}
const start = async ($: any) => (await $.prompt.submit({ text: 'hi' })).context ?? []
const FIND = 'mcp__roadmap-skills__find_roadmap'
const found = async ($: any) => (await $.tool.call({ tool: FIND })).result

test('the rule is added in a repo with a roadmap, read from the primary checkout', async ($: any, on: any) => {
  const w = world(on, { root: '/repo', files: ['/repo/ROADMAP.local.md'] })
  const added = await start($)
  expect(added).toHaveLength(1)
  expect(added[0]).toMatch(/^ROADMAP RULE ACTIVE\n\nThis repo's plan of record is `ROADMAP.local.md`, in the primary checkout at `\/repo`\./)
  expect(w.argvs).toHaveLength(2)
  expect(w.argvs.every(a => a[0] === 'git' && a[1] === '-C' && a[2] === '/repo')).toBe(true)
})

test('the rule has an item written as its ID with a few words of its heading', async ($: any, on: any) => {
  const w = world(on, { root: '/repo', files: ['/repo/ROADMAP.local.md'] })
  expect((await start($)).join('\n')).toContain('never as a bare ID')
  w.now = { root: '/repo', tracked: ['ROADMAP.md'] }
  expect((await start($)).join('\n')).toContain('never as a bare ID')
})

// A local-only roadmap is one file in the primary checkout, so an item written
// there is visible to every session at once. A tracked one is edited on the
// item's branch, which is not open until next-roadmap-item has run.
test('the item is written before next-roadmap-item on a local-only roadmap, and after it on a tracked one', async ($: any, on: any) => {
  const w = world(on, { root: '/repo', files: ['/repo/ROADMAP.local.md'] })
  const local = (await start($))[0]
  expect(local.indexOf('write it as a new item')).toBeGreaterThan(0)
  expect(local.indexOf('write it as a new item')).toBeLessThan(local.indexOf('Run `next-roadmap-item <Rn>`'))
  expect(local).toContain('edited in the primary checkout')
  expect(local).not.toContain('worktree directory names')
  w.now = { root: '/repo', tracked: ['ROADMAP.md'] }
  const tracked = (await start($))[0].replace(/\s+/g, ' ')
  expect(tracked.indexOf('Run `next-roadmap-item <Rn>`')).toBeGreaterThan(0)
  expect(tracked.indexOf('Run `next-roadmap-item <Rn>`')).toBeLessThan(tracked.indexOf("write the new item in `ROADMAP.md` on the item's branch"))
  expect(tracked).toContain('one more than the highest among that line, the roadmap, parked, and declined files, the branch and worktree directory names (`claude/r78-...`, `r78-...`), and the items in live claims')
  expect(tracked).not.toContain('edited in the primary checkout')
})

// A landed item is deleted from a tracked roadmap, so its ID is in no file a
// session reads. A local-only roadmap has a changelog with every ID in it.
test('on a tracked roadmap the highest ID used is a line in the header, first set from the headings git shows as deleted', async ($: any, on: any) => {
  const w = world(on, { root: '/repo', tracked: ['docs/roadmap.md'] })
  const tracked = (await start($))[0].replace(/\s+/g, ' ')
  expect(tracked).toContain('one line in the roadmap\'s header, `Highest ID used: R127`')
  expect(tracked).toContain("Where the roadmap has no such line, also read, this one time, the headings of the items that were deleted: `git -C \"/repo\" log -p --format= <default branch> -- docs/roadmap.md | grep -E '^-#+ R[0-9]+'`")
  const raise = tracked.indexOf('raise the `Highest ID used` line to the new ID, adding the line to the header where there is none')
  expect(raise).toBeGreaterThan(tracked.indexOf("write the new item in `docs/roadmap.md` on the item's branch"))
  expect(tracked.indexOf('Commit the edit there')).toBeGreaterThan(raise)
  expect(tracked).toContain('The line only goes up, and a merge conflict on it is settled by taking the higher number')
  w.now = { root: '/repo', files: ['/repo/ROADMAP.local.md'] }
  expect((await start($))[0]).not.toContain('Highest ID used')
})

test('nothing is added with no roadmap, in a fork with only a tracked one, or outside a repo', async ($: any, on: any) => {
  const w = world(on, { root: '/repo' })
  expect(await start($)).toEqual([])
  w.now = { root: '/repo', hasUpstream: true, tracked: ['ROADMAP.md'] }
  expect(await start($)).toEqual([])
  w.now = {}
  expect(await start($)).toEqual([])
})

test('the tool returns absolute paths in the primary checkout', async ($: any, on: any) => {
  const w = world(on, { root: '/repo', files: ['/repo/ROADMAP.local.md'] })
  expect(await found($)).toBe('main: /repo\nkind: local-only\nroadmap: /repo/ROADMAP.local.md\nhistory: /repo/ROADMAP-CHANGELOG.local.md')
  w.now = { root: '/repo', tracked: ['docs/roadmap.md'] }
  expect(await found($)).toBe('main: /repo\nkind: tracked\nroadmap: /repo/docs/roadmap.md')
  w.now = { root: '/repo', hasUpstream: true }
  expect(await found($)).toBe('main: /repo\nkind: fork-without-roadmap')
  w.now = {}
  expect(await found($)).toContain('kind: none')
})

// A process is started in the session's directory unless another is given, and
// a session that removed the worktree it had changed into has none.
test('git is run in the primary checkout, whatever the session\'s directory is', async ($: any, on: any) => {
  const w = world(on, { root: '/repo', files: ['/repo/ROADMAP.local.md'] })
  await found($)
  expect(w.cwds).toEqual(['/repo', '/repo'])
})

// git exits 2 for a remote it does not have. Any other failure is no answer,
// and Claude Code reports a git that crashed as exit 1 with no output.
test('the tool reports a lookup of the upstream remote that failed, and not a repo that is no fork', async ($: any, on: any) => {
  const w = world(on, { root: '/repo', tracked: ['ROADMAP.md'], remote: { exitCode: 128, stderr: 'fatal: bad config line 1 in file .git/config\n' } })
  const ran = await $.tool.call({ tool: FIND })
  expect(ran.isError).toBe(true)
  expect(ran.text).toBe('find_roadmap: git remote get-url upstream in /repo: fatal: bad config line 1 in file .git/config')
  w.now = { root: '/repo', tracked: ['ROADMAP.md'], remote: { exitCode: 1, stderr: '' } }
  expect((await $.tool.call({ tool: FIND })).text).toBe('find_roadmap: git remote get-url upstream in /repo: exit 1')
})

// A list that failed is not an empty one, and the session still starts.
test('a list of the tracked paths that failed is reported by the tool, and in one line at session start', async ($: any, on: any) => {
  const w = world(on, { root: '/repo', listed: { exitCode: 128, stderr: 'fatal: index file corrupt\r\nmore\r\n' } })
  const ran = await $.tool.call({ tool: FIND })
  expect(ran.isError).toBe(true)
  expect(ran.text).toBe('find_roadmap: git ls-files in /repo: fatal: index file corrupt')
  const lookup = 'The roadmap lookup failed, so it is not known whether this repo has a roadmap: '
  expect(await start($)).toEqual([`${lookup}git ls-files in /repo: fatal: index file corrupt`])
  w.now = { root: '/repo', remote: { exitCode: 1, stderr: '' } }
  expect(await start($)).toEqual([`${lookup}git remote get-url upstream in /repo: exit 1`])
})

// The rule comes with a prompt, once the model no longer reads it.
function prompts(on: any) {
  const w = { read: [] as string[] }
  on('session.messages', () => ({ value: w.read.map(text => ({ role: 'user', content: [{ type: 'text', text }] })) }))
  return w
}

test('the rule is added to a prompt while the model does not read it', async ($: any, on: any) => {
  const repo = world(on, { root: '/repo', files: ['/repo/ROADMAP.local.md'] })
  const w = prompts(on)
  const [rule] = await start($)
  expect(rule).toMatch(/^ROADMAP RULE ACTIVE\n/)
  w.read = [`<system-reminder>\n${rule}\n</system-reminder>`]
  expect(await start($)).toEqual([])
  repo.now = { root: '/repo' }
  expect(await start($)).toEqual([])
})

// The conversation read back: a string is a text block, as a prompt's context
// is, and `result` is the text of a tool result. `deny` refuses the next call.
function results(on: any) {
  const w = { read: [] as (string | { result: string })[], deny: false }
  on('session.messages', () => ({ value: w.read.map(t => ({ role: 'user', content: [typeof t === 'string' ? { type: 'text', text: t } : { type: 'tool_result', tool_use_id: 't', content: t.result }] })) }))
  on('tool.call', () => (w.deny ? { deny: 'not now' } : { result: 'ok' }))
  return w
}
const call = async ($: any, more: any = {}) => (await $.tool.call({ tool: 'Read', file_path: '/p/a.md', ...more })).context ?? []

test('the rule is added to one tool result after each compaction, until the model reads it there', async ($: any, on: any) => {
  const repo = world(on, { root: '/repo', files: ['/repo/ROADMAP.local.md'] })
  const w = results(on)
  const [rule] = await start($)
  const runs = repo.argvs.length
  w.read = [`<system-reminder>\n${rule}\n</system-reminder>`]
  expect(await call($)).toEqual([])
  w.read = ['a summary']
  expect(await call($, { agentId: 'w1' })).toEqual([])
  w.deny = true
  expect(await call($)).toEqual([])
  w.deny = false
  expect(await Promise.all([call($), call($)])).toEqual([[rule], []])
  // A second compaction before the model reads it back.
  w.read = ['another summary']
  expect(await call($)).toEqual([rule])
  w.read = ['a third summary', { result: `ok\n\n<system-reminder>\ntool.call hook additional context: ${rule}</system-reminder>` }]
  expect(await call($)).toEqual([])
  w.read = ['a fourth summary']
  expect(await call($)).toEqual([rule])
  // The rule found at the last prompt is used, so a tool call runs no git.
  expect(repo.argvs).toHaveLength(runs)
})

test('with no roadmap, nothing is added to a tool result', async ($: any, on: any) => {
  world(on, { root: '/repo' })
  const w = results(on)
  expect(await start($)).toEqual([])
  w.read = ['a summary']
  expect(await call($)).toEqual([])
})
