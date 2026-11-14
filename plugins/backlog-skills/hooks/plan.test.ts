// claude plugin test: the rule added to a prompt for each kind of backlog, and
// added again once the model no longer reads it.
import { expect, test } from 'claude-code/testing'
import { MIGRATION } from './tools'
import { BACKLOG, COMMON, MAIN, world } from './world'

const TRACKED = BACKLOG.replace(' (local only)', '').replace('Never commit or push this file. ', '')
function repo(on: any, files?: Record<string, string>) {
  const w = world(on, files)
  on('prompt.submit', (_$: any, e: any) => ({ text: e.text, context: e.context }))
  return w
}
const start = async ($: any) => (await $.prompt.submit({ text: 'hi' })).context ?? []

test('on a local-only backlog the rule lists the paths and asks for the item to be written before next-backlog-item', async ($: any, on: any) => {
  const w = repo(on)
  const [rule, ...more] = await start($)
  expect(more).toEqual([])
  expect(rule).toMatch(/^BACKLOG RULE ACTIVE\n\nThis repo's backlog is `\/repo\/BACKLOG.local.md`, in the primary checkout\./)
  expect(rule.indexOf('write the item with `write_item`')).toBeGreaterThan(rule.indexOf('`reserve_id`'))
  expect(rule.indexOf('Run `next-backlog-item <ID>`')).toBeGreaterThan(rule.indexOf('write the item with `write_item`'))
  expect(rule).toContain('Land through `land-and-wrap` only. Size is no exemption')
  expect(rule).toContain('Every change to the backlog files goes through the backlog-skills tools')
  expect(rule).toContain('Cite an item as `ID: Title`, as in `R12: Parser cache`, never as a bare ID.')
  w.files[`${MAIN}/PLAN.local.md`] = '# Plan\n'
  expect((await start($))[0]).toContain("This repo's backlog is `/repo/BACKLOG.local.md`, and its plan is `/repo/PLAN.local.md`, in the primary checkout.")
})

// A tracked backlog is edited on the item's branch, which next-backlog-item opens.
test('on a tracked backlog the item is written after next-backlog-item has opened its branch', async ($: any, on: any) => {
  const w = repo(on, { [`${MAIN}/BACKLOG.md`]: TRACKED, [`${MAIN}/PLAN.md`]: '# Plan\n' })
  w.tracked = ['BACKLOG.md']
  const [rule] = await start($)
  expect(rule).toContain("This repo's backlog is `/repo/BACKLOG.md`, and its plan is `/repo/PLAN.md`")
  const run = rule.indexOf('Run `next-backlog-item <ID>`')
  expect(run).toBeGreaterThan(rule.indexOf('Reserve an ID with `reserve_id`.'))
  expect(rule.indexOf("Write the item with `write_item` on the item's branch, once `next-backlog-item` has opened it.")).toBeGreaterThan(run)
  expect(rule).toContain('`ID: Title`')
})

test('in a migration kind the rule states what to do, and that the write tools refuse', async ($: any, on: any) => {
  const w = repo(on, { [`${MAIN}/ROADMAP.local.md`]: '# Roadmap\n' })
  expect(await start($)).toEqual([`BACKLOG RULE ACTIVE\n\n${MIGRATION['needs-migration']}`])
  expect(MIGRATION['needs-migration']).toContain('Offer the migration to the user, as described in `next-backlog-item` §8')
  w.files[`${COMMON}/backlog/migration/marker.json`] = '{"complete":false}'
  expect(await start($)).toEqual([`BACKLOG RULE ACTIVE\n\n${MIGRATION['partial-migration']}`])
  expect(MIGRATION['partial-migration']).toContain('Continue it with `migrate_backlog`')
  w.files[`${COMMON}/backlog/migration/marker.json`] = '{"complete":true,"tracked":true,"branch":"claude/migrate"}'
  w.refs.set('refs/heads/claude/migrate', 'c2')
  expect(await start($)).toEqual([`BACKLOG RULE ACTIVE\n\n${MIGRATION['migration-pending']}`])
  expect(MIGRATION['migration-pending']).toContain('Land that branch through `land-and-wrap` first')
  for (const kind of Object.keys(MIGRATION)) expect(MIGRATION[kind]).toContain('Until then the write tools refuse.')
})

test('nothing is added with no backlog, or in a fork without one', async ($: any, on: any) => {
  const w = repo(on, { [`${MAIN}/README.md`]: '' })
  expect(await start($)).toEqual([])
  w.upstream = true
  expect(await start($)).toEqual([])
})

// A lookup that failed is no answer, and the session still starts.
test('a lookup that failed is one line at session start', async ($: any, on: any) => {
  const w = repo(on)
  w.upstream = { exitCode: 128, stderr: 'fatal: bad config line 1 in file .git/config\n' }
  expect(await start($)).toEqual(['The backlog lookup failed, so it is not known whether this repo has a backlog: git remote get-url upstream in /repo: fatal: bad config line 1 in file .git/config'])
})

// The rule comes with a prompt, once the model no longer reads it.
function prompts(on: any) {
  const w = { read: [] as string[] }
  on('session.messages', () => ({ value: w.read.map(text => ({ role: 'user', content: [{ type: 'text', text }] })) }))
  return w
}

test('the rule is added to a prompt while the model does not read it', async ($: any, on: any) => {
  const r = repo(on)
  const w = prompts(on)
  const [rule] = await start($)
  expect(rule).toMatch(/^BACKLOG RULE ACTIVE\n/)
  w.read = [`<system-reminder>\n${rule}\n</system-reminder>`]
  expect(await start($)).toEqual([])
  delete r.files[`${MAIN}/BACKLOG.local.md`]
  r.files[`${MAIN}/README.md`] = ''
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
  const r = repo(on)
  const w = results(on)
  const [rule] = await start($)
  const runs = r.git.length
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
  expect(r.git).toHaveLength(runs)
})

test('with no backlog, nothing is added to a tool result', async ($: any, on: any) => {
  repo(on, { [`${MAIN}/README.md`]: '' })
  const w = results(on)
  expect(await start($)).toEqual([])
  w.read = ['a summary']
  expect(await call($)).toEqual([])
})
