// claude plugin test: the deletion of a landed item, and the tool that runs it.
import { expect, test } from 'claude-code/testing'
import { deleteItem } from './item'

const ROADMAP = `# Roadmap

## R10: other

body

## R102: landed

Quotes \`s.index('## Order and dependencies')\` mid-line and R103.

### R102.1: sub

x

## R103: later one

a

## Order and dependencies

R102 first.
`

test('an item is deleted up to the next heading of its level, with its sub-items', () => {
  const { text, removed } = deleteItem(ROADMAP, 'R102')
  expect(removed).toEqual(['## R102: landed', '### R102.1: sub'])
  expect(text).toBe(ROADMAP.replace(/## R102: landed[\s\S]*?(?=## R103)/, ''))
})

test('an ID that is the start of another ID matches only its own item', () => {
  expect(deleteItem(ROADMAP, 'R10').removed).toEqual(['## R10: other'])
  expect(deleteItem(ROADMAP, 'R102.1').removed).toEqual(['### R102.1: sub'])
})

test('the last section is deleted to the end of the file', () => {
  const { text, removed } = deleteItem(ROADMAP, 'Order')
  expect(removed).toEqual(['## Order and dependencies'])
  expect(text.endsWith('a\n\n')).toBe(true)
})

test('an ID with no heading, or with two, is refused', () => {
  expect(() => deleteItem(ROADMAP, 'R999')).toThrow('R999: 0 headings')
  expect(() => deleteItem(ROADMAP + '\n## R10: again\n', 'R10')).toThrow('R10: 2 headings')
})

test('a heading inside a fenced block does not end the item', () => {
  const F = '```'
  const s = `## R1: one\n\n${F}md\n## R2: quoted\n${F}\n\ntail\n\n## R3: three\n`
  expect(deleteItem(s, 'R1')).toEqual({ text: '## R3: three\n', removed: ['## R1: one'] })
})

test('an indented code block, or a line of inline code that starts with backticks, opens no fence', () => {
  const F = '```'
  expect(deleteItem(`## R1: one\n\n    ${F}\n\n## R2: two\nkeep\n`, 'R1').text).toBe('## R2: two\nkeep\n')
  expect(deleteItem(`## R1: one\n\n${F}git merge-tree${F} is used here\n\n## R2: two\nkeep\n`, 'R1').text).toBe('## R2: two\nkeep\n')
})

test('a fence still open at the end of the text is refused', () => {
  expect(() => deleteItem('## R1: one\n\n```\n## R2: two\n', 'R1')).toThrow('not closed')
})

test('a line with an info string does not close a fence', () => {
  const F = '```'
  const s = `## R1: one\n\n${F}md\n${F}js\n## R2: quoted\n${F}\n\n## R3: three\n`
  expect(deleteItem(s, 'R1').text).toBe('## R3: three\n')
})

// A checkout with core.autocrlf has a carriage return at the end of each line.
test('a fence closes in a file with CRLF line ends, and with a tab after it', () => {
  expect(deleteItem('## R1: one\r\n```\r\ncode\r\n```\r\n## R2: two\r\n', 'R1').text).toBe('## R2: two\r\n')
  expect(deleteItem('## R1: one\n```\ncode\n```\t\n## R2: two\n', 'R1').text).toBe('## R2: two\n')
})

const TOOL = 'mcp__roadmap-skills__delete_item'
const PATH = '/repo/ROADMAP.local.md'

// The primary checkout is /repo, and the files are the ones in it.
// `worktrees` are the linked ones git lists, which can be anywhere.
// `failed` is a list git did not print: its exit code and what it wrote to stderr.
function world(on: any, files: Record<string, string>, worktrees: string[] = [], failed?: { exitCode: number; stderr: string }) {
  const w = { files, reads: 0, wrote: false, read: (path: string): string => w.files[path] }
  // As git prints it with -z: every line ends in NUL, and so does each worktree's block.
  on('process.run', () => ({ value: failed ? { ...failed, stdout: '' } : { exitCode: 0, stdout: ['/repo', ...worktrees].map(p => `worktree ${p}\0HEAD 0\0\0`).join(''), stderr: '' } }))
  on('session.repo', () => ({ value: { root: '/repo', remote: null, internal: false } }))
  // On Windows the engine gives a handler the path with a drive letter and backslashes.
  const posix = (p: string) => p.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')
  on('fs.read', (_$: any, e: any) => { w.reads++; return { value: w.read(posix(e.path)) } })
  on('fs.write', (_$: any, e: any) => { w.wrote = true; w.files[posix(e.path)] = e.text; return { value: undefined } })
  return w
}

test('the tool rewrites the file and returns the headings removed', async ($: any, on: any) => {
  const w = world(on, { [PATH]: ROADMAP })
  const ran = await $.tool.call({ tool: TOOL, path: PATH, id: 'R102' })
  expect(ran.result).toBe('removed:\n## R102: landed\n### R102.1: sub')
  expect(w.files[PATH]).toBe(deleteItem(ROADMAP, 'R102').text)
})

test('the tool writes nothing when the ID is refused', async ($: any, on: any) => {
  const w = world(on, { [PATH]: ROADMAP })
  const ran = await $.tool.call({ tool: TOOL, path: PATH, id: 'R999' })
  expect(ran.isError).toBe(true)
  expect(ran.text).toContain('R999: 0 headings')
  expect(w.wrote).toBe(false)
})

test('an empty or blank ID is refused', async ($: any, on: any) => {
  const w = world(on, { [PATH]: ROADMAP })
  for (const id of ['', '  ']) {
    const ran = await $.tool.call({ tool: TOOL, path: PATH, id })
    expect(ran.isError).toBe(true)
    expect(ran.text).toContain('empty')
  }
  expect(w.wrote).toBe(false)
})

test('a path outside the primary checkout, or with a .. segment, is refused', async ($: any, on: any) => {
  const w = world(on, { '/other/ROADMAP.md': ROADMAP, '/repo/.claude/worktrees/x/ROADMAP.md': ROADMAP })
  for (const path of ['/other/ROADMAP.md', '/repo/../other/ROADMAP.md', '/repo\\..\\x', '/repository/ROADMAP.md']) {
    const ran = await $.tool.call({ tool: TOOL, path, id: 'R102' })
    expect(ran.isError).toBe(true)
    expect(ran.text).toContain('not inside the primary checkout')
  }
  expect(w.wrote).toBe(false)
  const ok = await $.tool.call({ tool: TOOL, path: '/repo/.claude/worktrees/x/ROADMAP.md', id: 'R102' })
  expect(ok.text).not.toContain('not inside')
})

// A tracked roadmap is edited in the lane's worktree, and a worktree the host
// opened or one made by hand is not under the primary checkout.
test('a path in a worktree outside the primary checkout is taken', async ($: any, on: any) => {
  const w = world(on, { '/work/wt/r5/ROADMAP.md': ROADMAP, '/work/wt/r50/ROADMAP.md': ROADMAP }, ['/work/wt/r5'])
  expect((await $.tool.call({ tool: TOOL, path: '/work/wt/r5/ROADMAP.md', id: 'R102' })).result).toContain('removed:')
  expect((await $.tool.call({ tool: TOOL, path: '/work/wt/r50/ROADMAP.md', id: 'R102' })).text).toContain('not inside the primary checkout')
  expect(w.files['/work/wt/r50/ROADMAP.md']).toBe(ROADMAP)
})

// git prints a path as it is, so a newline in it is a newline in the list.
test('a path in a worktree at a path with a newline in it is taken', async ($: any, on: any) => {
  const w = world(on, { '/work/wt/r5\nx/ROADMAP.md': ROADMAP }, ['/work/wt/r5\nx'])
  expect((await $.tool.call({ tool: TOOL, path: '/work/wt/r5\nx/ROADMAP.md', id: 'R102' })).result).toContain('removed:')
  expect(w.files['/work/wt/r5\nx/ROADMAP.md']).toBe(deleteItem(ROADMAP, 'R102').text)
})

// A failed list is not an empty one. git before 2.36 rejects -z with exit 129
// and its usage text, and Claude Code reports a git that crashed as exit 1 with
// no output.
for (const [what, failed, message] of [
  ['rejects -z', { exitCode: 129, stderr: "error: unknown switch `z'\nusage: git worktree add [<options>] <path> [<commit-ish>]\n   or: git worktree list [<options>]\n" }, "error: unknown switch `z'"],
  ['rejects -z, with CRLF line ends', { exitCode: 129, stderr: "error: unknown switch `z'\r\nusage: git worktree add [<options>] <path> [<commit-ish>]\r\n" }, "error: unknown switch `z'"],
  ['crashes', { exitCode: 1, stderr: '' }, 'exit 1'],
] as const) {
  test(`the tool reports a worktree list that failed when git ${what}, and writes nothing`, async ($: any, on: any) => {
    const w = world(on, { '/work/wt/r5/ROADMAP.md': ROADMAP, [PATH]: ROADMAP }, ['/work/wt/r5'], failed)
    for (const path of ['/work/wt/r5/ROADMAP.md', PATH]) {
      const ran = await $.tool.call({ tool: TOOL, path, id: 'R102' })
      expect(ran.isError).toBe(true)
      expect(ran.text).toBe(`delete_item: git worktree list in /repo: ${message}`)
    }
    expect(w.wrote).toBe(false)
  })
}

test('the tool writes nothing when the file changed after it was first read', async ($: any, on: any) => {
  const w = world(on, { [PATH]: ROADMAP })
  w.read = () => (w.reads === 1 ? ROADMAP : ROADMAP + '\n## R104: added meanwhile\n')
  const ran = await $.tool.call({ tool: TOOL, path: PATH, id: 'R102' })
  expect(ran.isError).toBe(true)
  expect(ran.text).toContain('changed')
  expect(w.wrote).toBe(false)
})
