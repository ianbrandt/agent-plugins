// claude plugin test: IDs cited without their titles.
import { expect, test } from 'claude-code/testing'
import { bareIds } from './cite'
import { BACKLOG, world } from './world'

const known = new Set(['R3', 'R7', 'R9', 'R12', 'R12.3', 'R144', 'R149', 'R600'])
const F = '```'

test('an ID with its title is cited, and one without it is bare', () => {
  expect(bareIds('R12: Parser cache is done.', known)).toEqual([])
  expect(bareIds('R12 is done, and R7 next.', known)).toEqual(['R12', 'R7'])
  expect(bareIds('R12:', known)).toEqual(['R12'])
})

test('an ID that is not in the backlog files or the changelog does not count', () => {
  expect(bareIds('R5 and R13 are not known.', known)).toEqual([])
})

test('an ID matches on a word boundary, and a sub-item ID is its own ID', () => {
  expect(bareIds('R120 and R1234 and xR12', known)).toEqual([])
  expect(bareIds('R12.3 is bare.', known)).toEqual(['R12.3'])
  expect(bareIds('R12.3: Sub is cited, and R12 is not.', known)).toEqual(['R12'])
})

test('an ID in a code span or a fenced block is exempt', () => {
  expect(bareIds('Run `next-backlog-item R12` now, or ``R7``.', known)).toEqual([])
  expect(bareIds(`${F}\ngit log R12\n${F}\nR9 after.`, known)).toEqual(['R9'])
})

test('a field line is exempt', () => {
  expect(bareIds('- Gated by: R600\nGated by: R12\n* Needs: R7', known)).toEqual([])
})

test('a range or a list of IDs followed by one title is cited', () => {
  expect(bareIds('R144 to R149: Plugin README cleanup', known)).toEqual([])
  expect(bareIds('R3 and R7: Ledger reap', known)).toEqual([])
  expect(bareIds('R3, R7, and R9: three at once', known)).toEqual([])
  expect(bareIds('R3 and R7 are both bare.', known)).toEqual(['R3', 'R7'])
})

test('a later mention of an ID cited earlier is exempt, and an earlier one is not', () => {
  expect(bareIds('R12: Parser cache landed. R12 also fixed the cache.', known)).toEqual([])
  expect(bareIds('R12 landed. R12: Parser cache is done.', known)).toEqual(['R12'])
})

test('a bare ID is listed once', () => {
  expect(bareIds('R7, then R7 again.', known)).toEqual(['R7'])
})

// Regressions from an adversarial review of the parser.

test('an ID in a tilde fence is exempt in a message with CRLF line ends', () => {
  expect(bareIds('Fix the parser\r\n\r\n~~~\r\ngit log R12\r\n~~~\r\n', known)).toEqual([])
})

test('a lone backtick does not hide an ID in a later paragraph', () => {
  expect(bareIds('A backtick ` starts a substitution in bash.\n\nR12 is next.\n\nThen run `make`.', known)).toEqual(['R12'])
})

test('an ID in underscore emphasis counts', () => {
  expect(bareIds('_R12_ is next, and __R7__ after.', known)).toEqual(['R12', 'R7'])
})

test('an ID inside a cited range is cited', () => {
  expect(bareIds('R3 to R9: Ledger cleanup. Then R7 is done.', known)).toEqual([])
})

// The two hooks, against the repo in world.ts: R1 is One and R2 is Two.

const SHELL = { ran: [] as string[] }
function shell(on: any, files?: Record<string, string>) {
  const w = world(on, files)
  SHELL.ran = []
  on('tool.call', (_$: any, e: any) => { SHELL.ran.push(e.command); return { result: 'ok' } })
  on('turn.complete', (_$: any, e: any) => ({ text: e.answer }))
  on('prompt.submit', (_$: any, e: any) => ({ text: e.text, context: e.context }))
  return w
}
const run = ($: any, command: string, more: object = {}) => $.tool.call({ tool: 'Bash', command, ...more })

test('a commit with a bare ID is refused before it runs, with the ID and its title', async ($: any, on: any) => {
  shell(on)
  const ran = await run($, 'git commit -m "Fix R1"')
  expect(ran.deny).toBe('Not run. In the commit message, R1 appeared without a title: write `R1: One`. Cite each item as `ID: Title`, never as a bare ID, and run the command again.')
  expect(SHELL.ran).toEqual([])
})

test('a commit that cites each ID with its title, or names no known ID, runs untouched', async ($: any, on: any) => {
  shell(on)
  expect(await run($, 'git commit -m "Fix R1: One" -m "R1 also covers R9."')).toEqual({ result: 'ok' })
  expect(await run($, "git commit -m 'Bump the parser' -m 'Run `next-backlog-item R2`.'")).toEqual({ result: 'ok' })
  expect(SHELL.ran).toHaveLength(2)
})

test('a chained commit, git -C, a second -m, --amend, and a heredoc are each checked', async ($: any, on: any) => {
  shell(on)
  for (const cmd of [
    'git add x && git commit -m "Fix R1"',
    'git -C /repo commit -m "Fix R2"',
    'git commit -m "Subject" -m "Closes R2."',
    'git commit --amend -m "R1 again"',
    "git commit -m \"$(cat <<'EOF'\nFix R1\n\nBody.\nEOF\n)\"",
    "git commit -F - <<'EOF'\nFix R2\nEOF",
  ]) expect((await run($, cmd)).deny).toContain('appeared without a title')
  expect(SHELL.ran).toEqual([])
})

test('a message file is read from the command\'s directory', async ($: any, on: any) => {
  const w = shell(on)
  w.files['/repo/sub/msg.txt'] = 'Fix R2\n'
  expect((await run($, 'cd sub && git commit -F msg.txt')).deny).toContain('write `R2: Two`')
  w.cwd = '/repo/sub'
  expect((await run($, 'git commit --file=msg.txt')).deny).toContain('R2')
  w.files['/repo/sub/msg.txt'] = 'R2: Two\n'
  expect(await run($, 'git commit --file=msg.txt')).toEqual({ result: 'ok' })
})

test('a PR title or body with a bare ID is refused, through Bash and PowerShell', async ($: any, on: any) => {
  const w = shell(on)
  expect((await run($, 'gh pr create --title "Parser cache" --body "Closes R1."')).deny).toContain('In the PR title and body, R1 appeared')
  w.files['/repo/b.md'] = 'R2 is done.'
  expect((await run($, 'gh pr edit 3 --body-file b.md')).deny).toContain('R2')
  expect((await $.tool.call({ tool: 'PowerShell', command: "git commit -m 'Fix R1'" })).deny).toContain('R1')
  expect((await $.tool.call({ tool: 'PowerShell', command: "@'\nFix R2\n'@ | git commit -F -" })).deny).toContain('R2')
})

// The rule hook skips a subagent's calls; this one does not.
test("a subagent's commit is checked too", async ($: any, on: any) => {
  shell(on)
  expect((await run($, 'git commit -m "Fix R1"', { agentId: 'a1' })).deny).toContain('R1')
})

test('a message that cannot be read runs with a one-line note', async ($: any, on: any) => {
  shell(on)
  const note = 'backlog-skills did not check the commit message for bare item IDs: '
  expect(await run($, 'git commit -m "$MSG"')).toEqual({ result: 'ok', context: [`${note}a value is built from a variable or a substitution.`] })
  expect(await run($, 'git commit --amend')).toEqual({ result: 'ok', context: [`${note}the message comes from an editor.`] })
  expect(await run($, 'git commit -F gone.txt')).toEqual({ result: 'ok', context: [`${note}/repo/gone.txt could not be read.`] })
  expect(await run($, 'git commit --amend --no-edit')).toEqual({ result: 'ok' })
})

test('with no backlog, a commit with an ID runs untouched', async ($: any, on: any) => {
  shell(on, { '/repo/README.md': '' })
  expect(await run($, 'git commit -m "Fix R1"')).toEqual({ result: 'ok' })
})

// A tracked backlog's new item is on its branch, in the worktree.
test("on a tracked backlog the IDs of the worktree's backlog count", async ($: any, on: any) => {
  const tracked = BACKLOG.replace(' (local only)', '').replace('Never commit or push this file. ', '')
  const w = shell(on, { '/repo/BACKLOG.md': tracked, '/repo/.claude/worktrees/r3-x/BACKLOG.md': `${tracked}\n## R3: Three\n` })
  w.tracked = ['BACKLOG.md']
  w.worktrees.push({ path: '/repo/.claude/worktrees/r3-x', branch: 'claude/r3-x' })
  expect(await run($, 'git commit -m "Fix R3"')).toEqual({ result: 'ok' })
  w.cwd = '/repo/.claude/worktrees/r3-x'
  expect((await run($, 'git commit -m "Fix R3"')).deny).toContain('write `R3: Three`')
})

const reply = ($: any, answer: string, more: object = {}) => $.turn.complete({ answer, reason: 'answer', isAborted: false, durationMs: 1, turnId: 't1', ...more })
const next = async ($: any) => ((await $.prompt.submit({ text: 'next' })).context ?? []).filter((c: string) => !c.startsWith('BACKLOG RULE ACTIVE'))

test('a bare ID in a reply is listed in a note on the next prompt, once', async ($: any, on: any) => {
  const w = shell(on, { '/repo/BACKLOG.local.md': BACKLOG, '/repo/BACKLOG-CHANGELOG.local.md': '# Changelog\n\n## R7: Seven (DONE, 2026-11-01)\n' })
  await reply($, 'R1 is done, R7 too, and R2: Two is next. R9 is no item.')
  expect(await next($)).toEqual(['BACKLOG CITATION NOTE: in the last reply, R1, R7 appeared without a title. Cite an item as `ID: Title`, here `R1: One`, `R7: Seven`, never as a bare ID: the user is not reading the backlog beside the conversation.'])
  expect(await next($)).toEqual([])
  await reply($, 'R1: One is done.')
  expect(await next($)).toEqual([])
  // A subagent's reply and an interrupted turn are not read, and a clean reply clears the note.
  await reply($, 'R1 is done.', { agentId: 'a1' })
  await reply($, 'R1 is done.', { reason: 'aborted', isAborted: true })
  expect(await next($)).toEqual([])
  await reply($, 'R1 is done.')
  await reply($, 'All clean.')
  expect(await next($)).toEqual([])
  delete w.files['/repo/BACKLOG.local.md']
  await reply($, 'R1 is done.')
  expect(await next($)).toEqual([])
})
