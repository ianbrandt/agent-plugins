// claude plugin test: the tools that change the backlog files, against the git
// and file system kept in memory in world.ts.
import { expect, test } from 'claude-code/testing'
import { BACKLOG, MAIN, call, text, world } from './world'

const LOCAL = `${MAIN}/BACKLOG.local.md`
const CHANGELOG = `${MAIN}/BACKLOG-CHANGELOG.local.md`
const PARKED = `${MAIN}/BACKLOG-PARKED.local.md`
const DECLINED = `${MAIN}/BACKLOG-DECLINED.local.md`
// Noon UTC, so the local date is the same in every time zone a test runs in.
const NOON = Date.UTC(2026, 10, 14, 12)
const HEAD = '# Backlog (local only)\n\nNever commit or push this file. Highest ID used: R2\n\n'
const SUBS = HEAD + '## R1: One\n\n### R1.1: Sub\n\nsub prose\n\n## R2: Two\n\n- Gated by: R1\n'

function local(on: any, files: Record<string, string> = {}) {
  const w = world(on, { [LOCAL]: BACKLOG, ...files })
  w.t = NOON
  return w
}

const TRACKED = '# Backlog\n\nHighest ID used: R2\n\n## R1: One\n\n## R2: Two\n'
const WT = '/wt/r3-x'
function tracked(on: any) {
  const w = world(on, { [`${MAIN}/BACKLOG.md`]: TRACKED, [`${WT}/BACKLOG.md`]: TRACKED })
  w.tracked = ['BACKLOG.md']
  w.worktrees.push({ path: WT, branch: 'claude/r3-x' })
  w.t = NOON
  return w
}

const failed = async ($: any, name: string, input: object) => {
  const ran = await call($, name, input)
  expect(ran.isError).toBe(true)
  return ran.text as string
}

// write_item

for (const [position, expected] of [
  ['top', HEAD.replace('R2', 'R3') + '## R3: Three\n\n- Touches: `a/**`\n\nWhy.\n\n## R1: One\n\n## R2: Two\n\n- Gated by: R1\n'],
  ['before R2', HEAD.replace('R2', 'R3') + '## R1: One\n\n## R3: Three\n\n- Touches: `a/**`\n\nWhy.\n\n## R2: Two\n\n- Gated by: R1\n'],
  ['after R1', HEAD.replace('R2', 'R3') + '## R1: One\n\n## R3: Three\n\n- Touches: `a/**`\n\nWhy.\n\n## R2: Two\n\n- Gated by: R1\n'],
  ['bottom', HEAD.replace('R2', 'R3') + '## R1: One\n\n## R2: Two\n\n- Gated by: R1\n\n## R3: Three\n\n- Touches: `a/**`\n\nWhy.\n'],
]) {
  test(`write_item writes a new item with a reserved ID at ${position}`, async ($: any, on: any) => {
    const w = local(on)
    w.refs.set('refs/backlog/ids/R3', 'o')
    const out = await text($, 'write_item', { id: 'R3', title: 'Three', fields: { Touches: '`a/**`' }, body: '\nWhy.\n\n', position })
    expect(out).toBe('Highest ID used: R3\nwrote /repo/BACKLOG.local.md')
    expect(w.files[LOCAL]).toBe(expected)
    expect(w.refs.has('refs/backlog/lock')).toBe(false)
  })
}

test('write_item refuses a new ID with no reservation, one already used, and one already open', async ($: any, on: any) => {
  const w = local(on, { [CHANGELOG]: '# Changelog\n\n## R1.5: x (DONE)\n', [PARKED]: '# Parked\n\n## R0: zero\n' })
  const add = (id: string) => failed($, 'write_item', { id, title: 'T', position: 'top' })
  expect(await add('R3')).toBe('write_item: R3 is not reserved: call reserve_id first')
  for (const id of ['R0', 'R1.5', 'R4']) w.refs.set(`refs/backlog/ids/${id}`, 'o')
  w.refs.set('refs/backlog/closed/R4', 'o')
  expect(await add('R0')).toBe('write_item: R0 is in the parked file: reactivate it with reactivate_item')
  expect(await add('R1.5')).toBe('write_item: R1.5 is a sub-item ID: a new sub-item is written with parent, and gets the next free ID')
  expect(await add('R4')).toBe('write_item: R4 was used before, and an ID is never used twice')
  expect(await add('R1')).toBe('write_item: R1 is already in the backlog: to replace its text, call again with no position')
  expect(await failed($, 'write_item', { id: 'R9', title: 'T' })).toBe('write_item: R9 is not in the backlog: a new item needs a position')
  expect(w.writes).toEqual([])
})

test('write_item validates every input before it writes', async ($: any, on: any) => {
  const w = local(on)
  w.refs.set('refs/backlog/ids/R3', 'o')
  const add = (input: object) => failed($, 'write_item', { id: 'R3', title: 'T', position: 'top', ...input })
  expect(await add({ id: 'r3' })).toBe('write_item: not an item ID: "r3"')
  expect(await add({ title: ' ' })).toBe('write_item: title is empty')
  expect(await add({ title: 'a\nb' })).toBe('write_item: title is more than one line')
  expect(await add({ position: 'middle' })).toBe('write_item: a position is "top", "bottom", "before <ID>", or "after <ID>", not "middle"')
  expect(await add({ position: 'after R7' })).toBe('write_item: R7 is not an open item in the backlog')
  expect(await add({ fields: { touches: 'a' } })).toBe('write_item: not a field key: "touches". The keys are Touches, Gated by, Needs, Branch, and Check')
  expect(await add({ fields: { Check: '' } })).toBe('write_item: the Check value is empty: leave the key out instead')
  expect(await add({ body: 'text\n\n## R9: smuggled\n' })).toBe('write_item: body has a heading of level 1 to 3 on line 3: an item\'s prose may use #### and deeper only')
  expect(await add({ body: '```\n## code\n' })).toBe('write_item: body has a fenced block that is not closed')
  expect(w.writes).toEqual([])
  // A heading inside a fenced block is prose.
  expect(await text($, 'write_item', { id: 'R3', title: 'T', position: 'bottom', body: '```sh\n# a comment\n```' })).toContain('wrote')
})

test('write_item writes a sub-item under its parent with the next free ID, reserved with a ref', async ($: any, on: any) => {
  const w = local(on, { [LOCAL]: SUBS })
  // R1.2 is reserved elsewhere, and another session takes R1.3 first.
  w.refs.set('refs/backlog/ids/R1.2', 'o')
  w.before = (_line, a) => { if (a[0] === 'update-ref' && a[1] === 'refs/backlog/ids/R1.3' && !w.refs.has(a[1])) w.refs.set(a[1], 'theirs') }
  expect(await text($, 'write_item', { parent: 'R1', title: 'Sub two', fields: { Check: '`make`' } }))
    .toBe('id: R1.4\nref: refs/backlog/ids/R1.4\nskipped, reserved by another session: R1.3\nwrote /repo/BACKLOG.local.md')
  expect(w.files[LOCAL]).toBe(SUBS.replace('## R2', '### R1.4: Sub two\n\n- Check: `make`\n\n## R2'))
  expect(await text($, 'write_item', { parent: 'R1', title: 'First', position: 'top' })).toContain('id: R1.5\n')
  expect(w.files[LOCAL]).toContain('## R1: One\n\n### R1.5: First\n\n### R1.1: Sub\n')
  expect(await failed($, 'write_item', { parent: 'R1.1', title: 'x' })).toBe('write_item: R1.1 is not an open top-level item in the backlog')
  expect(await failed($, 'write_item', { parent: 'R1', id: 'R1.9', title: 'x' })).toBe('write_item: pass parent for a new sub-item, or id, not both')
})

test('write_item replaces an item\'s text and keeps its sub-items, and needs fields and body to do it', async ($: any, on: any) => {
  const w = local(on, { [LOCAL]: SUBS })
  expect(await failed($, 'write_item', { id: 'R1', title: 'One' })).toBe('write_item: a replacement replaces the fields and the body: pass both, {} and "" for none')
  await text($, 'write_item', { id: 'R1', title: 'One, again', fields: { Needs: 'user' }, body: 'Now with prose.' })
  expect(w.files[LOCAL]).toBe(SUBS.replace('## R1: One\n', '## R1: One, again\n\n- Needs: user\n\nNow with prose.\n'))
  await text($, 'write_item', { id: 'R2', title: 'Two', fields: {}, body: '' })
  expect(w.files[LOCAL]).toMatch(/sub prose\n\n## R2: Two\n$/)
})

test('on a tracked backlog write_item writes the worktree\'s copy and raises Highest ID used', async ($: any, on: any) => {
  const w = tracked(on)
  w.refs.set('refs/backlog/ids/R3', 'o')
  expect(await text($, 'write_item', { id: 'R3', title: 'Three', position: 'bottom', path: `${WT}/BACKLOG.md` }))
    .toBe(`Highest ID used: R3\nwrote ${WT}/BACKLOG.md`)
  expect(w.files[`${WT}/BACKLOG.md`]).toBe(TRACKED.replace('R2\n\n## R1', 'R3\n\n## R1') + '\n## R3: Three\n')
  expect(w.files[`${MAIN}/BACKLOG.md`]).toBe(TRACKED)
  expect(await failed($, 'write_item', { id: 'R3', title: 'x', position: 'top', path: `${WT}/BACKLOG-PARKED.md` })).toBe(`write_item: ${WT}/BACKLOG-PARKED.md is not the backlog file: pass the path of BACKLOG.md`)
  expect(await failed($, 'write_item', { id: 'R3', title: 'x', position: 'top', path: '/elsewhere/BACKLOG.md' })).toContain('is not inside the primary checkout')
})

test('a local-only backlog is written only in the primary checkout', async ($: any, on: any) => {
  const w = local(on)
  w.worktrees.push({ path: WT, branch: 'claude/r3-x' })
  w.files[`${WT}/BACKLOG.local.md`] = BACKLOG
  expect(await failed($, 'set_field', { id: 'R1', key: 'Check', value: 'x', path: `${WT}/BACKLOG.local.md` })).toBe('set_field: a local-only backlog is only in the primary checkout, /repo')
})

test('every write tool refuses on a file-level problem, and in a migration kind', async ($: any, on: any) => {
  const w = local(on, { [LOCAL]: BACKLOG + '\n## R1: again\n' })
  expect(await failed($, 'set_field', { id: 'R2', key: 'Check', value: 'x' })).toBe('set_field: the backlog files have file-level problems, so nothing was written:\n  BACKLOG.local.md line 11 (file level): R1 has two headings')
  w.files = { [`${MAIN}/ROADMAP.local.md`]: '# Roadmap\n' }
  expect(await failed($, 'close_item', { id: 'R1' })).toContain('close_item: the write tools refuse while the kind is needs-migration. This repo still has an old roadmap.')
})

// set_field

test('set_field adds, replaces, and clears a field, and keeps the prose', async ($: any, on: any) => {
  const w = local(on, { [LOCAL]: HEAD + '## R1: One\n\nProse.\n\n## R2: Two\n\n- Gated by: R1\n- Check: `make`\n\nMore.\n' })
  expect(await text($, 'set_field', { id: 'R1', key: 'Branch', value: '`claude/r1-one`' })).toBe('wrote /repo/BACKLOG.local.md')
  expect(w.files[LOCAL]).toContain('## R1: One\n\n- Branch: `claude/r1-one`\n\nProse.\n\n## R2')
  await text($, 'set_field', { id: 'R2', key: 'Gated by', value: 'R1 and R0' })
  await text($, 'set_field', { id: 'R2', key: 'Touches', value: '`b/**`' })
  expect(w.files[LOCAL]).toContain('## R2: Two\n\n- Gated by: R1 and R0\n- Check: `make`\n- Touches: `b/**`\n\nMore.\n')
  for (const key of ['Gated by', 'Check', 'Touches']) await text($, 'set_field', { id: 'R2', key })
  expect(w.files[LOCAL]).toMatch(/## R2: Two\n\nMore.\n$/)
  expect(await text($, 'set_field', { id: 'R2', key: 'Needs', value: '' })).toBe('R2 has no Needs field, so nothing was written')
  expect(await failed($, 'set_field', { id: 'R2', key: 'Owner', value: 'me' })).toContain('set_field: not a field key: "Owner"')
  expect(await failed($, 'set_field', { id: 'R7', key: 'Check', value: 'x' })).toBe('set_field: R7 is not in the backlog')
})

test('set_field rewrites a field line in another spelling, and a key set twice', async ($: any, on: any) => {
  const w = local(on, { [LOCAL]: HEAD + '## R1: One\n\n-  **Check:** a\n- Touches: x\n- Check: b\n' })
  await text($, 'set_field', { id: 'R1', key: 'Check', value: 'c' })
  expect(w.files[LOCAL]).toBe(HEAD + '## R1: One\n\n- Check: c\n- Touches: x\n')
})

// move_item

test('move_item moves an item with its sub-items, or a sub-item among its siblings', async ($: any, on: any) => {
  const w = local(on, { [LOCAL]: SUBS + '\n### R2.1: Two sub\n' })
  expect(await text($, 'move_item', { id: 'R1', position: 'bottom' })).toBe('wrote /repo/BACKLOG.local.md')
  expect(w.files[LOCAL]).toBe(HEAD + '## R2: Two\n\n- Gated by: R1\n\n### R2.1: Two sub\n\n## R1: One\n\n### R1.1: Sub\n\nsub prose\n')
  await text($, 'move_item', { id: 'R1', position: 'before R2' })
  expect(w.files[LOCAL]).toBe(SUBS + '\n### R2.1: Two sub\n')
  expect(await failed($, 'move_item', { id: 'R1', position: 'after R1' })).toBe('move_item: R1 is not an open item in the backlog')
  expect(await failed($, 'move_item', { id: 'R1.1', position: 'before R2.1' })).toBe('move_item: R2.1 is not a sub-item of R1 in the backlog')
  await text($, 'write_item', { parent: 'R1', title: 'Sub two' })
  await text($, 'move_item', { id: 'R1.2', position: 'top' })
  expect(w.files[LOCAL]).toContain('## R1: One\n\n### R1.2: Sub two\n\n### R1.1: Sub\n\nsub prose\n\n## R2')
})

// record_progress

test('record_progress appends a PR-READY record, sets Branch, and keeps the item open, the changelog first', async ($: any, on: any) => {
  const w = local(on)
  expect(await text($, 'record_progress', { id: 'R2', status: 'PR-READY', branch: '`claude/r2-two`', record: 'PR #4 is ready.' }))
    .toBe('wrote /repo/BACKLOG-CHANGELOG.local.md\nwrote /repo/BACKLOG.local.md')
  expect(w.files[CHANGELOG]).toBe('# Changelog (local only)\n\nNever commit or push this file.\n\n## R2: Two (PR-READY, 2026-11-14)\n\nPR #4 is ready.\n')
  expect(w.files[LOCAL]).toBe(BACKLOG.replace('- Gated by: R1\n', '- Gated by: R1\n- Branch: `claude/r2-two`\n'))
  expect(w.writes.filter(p => !p.includes('/journal/'))).toEqual([CHANGELOG, LOCAL])
  await text($, 'record_progress', { id: 'R2', status: 'FILED', branch: '`claude/r2-two`' })
  expect(w.files[CHANGELOG]).toMatch(/PR #4 is ready.\n\n## R2: Two \(FILED, 2026-11-14\)\n$/)
  expect(await failed($, 'record_progress', { id: 'R2', status: 'DONE', branch: 'b' })).toBe('record_progress: status is PR-READY or FILED, not "DONE": close_item writes the final record')
  expect(await failed($, 'record_progress', { id: 'R2', status: 'FILED' })).toBe('record_progress: branch is empty')
})

test('record_progress refuses a tracked backlog', async ($: any, on: any) => {
  tracked(on)
  expect(await failed($, 'record_progress', { id: 'R1', status: 'PR-READY', branch: 'b' })).toBe('record_progress: a tracked backlog has no changelog: its item stays open until close_item')
})

// close_item

test('close_item on a local-only backlog appends the done-record with a heading per sub-item, then deletes the item', async ($: any, on: any) => {
  const w = local(on, { [LOCAL]: SUBS, [CHANGELOG]: '# Changelog\n\n## R0: Zero (DONE, 2026-11-01)\n' })
  expect(await text($, 'close_item', { id: 'R1', record: 'Built it.\n\nFound that X.' })).toBe([
    'wrote /repo/BACKLOG-CHANGELOG.local.md', 'wrote /repo/BACKLOG.local.md', 'removed:', '## R1: One', '### R1.1: Sub',
  ].join('\n'))
  expect(w.files[CHANGELOG]).toBe('# Changelog\n\n## R0: Zero (DONE, 2026-11-01)\n\n## R1: One (DONE, 2026-11-14)\n\nBuilt it.\n\nFound that X.\n\n### R1.1: Sub\n')
  expect(w.files[LOCAL]).toBe(HEAD + '## R2: Two\n\n- Gated by: R1\n')
  expect(w.writes.filter(p => !p.includes('/journal/'))).toEqual([CHANGELOG, LOCAL])
  expect(await failed($, 'close_item', { id: 'R1' })).toBe('close_item: R1 is not in the backlog. The changelog has a record for it at line 5')
})

test('close_item writes its record after a PR-READY or FILED one, and refuses those statuses itself', async ($: any, on: any) => {
  const w = local(on, { [CHANGELOG]: '# Changelog\n\n## R2: Two (PR-READY, 2026-11-01)\n\n## R2: Two (FILED, 2026-11-02)\n' })
  expect(await failed($, 'close_item', { id: 'R2', status: 'PR-READY' })).toBe('close_item: a PR-READY or FILED record keeps the item open: call record_progress')
  expect(await failed($, 'close_item', { id: 'R2', status: 'SHIPPED' })).toBe('close_item: status is one of BUILT-LOCAL, DRAFTED, MERGED-UPSTREAM, and DONE, not "SHIPPED"')
  await text($, 'close_item', { id: 'R2', status: 'MERGED-UPSTREAM', record: 'Merged.' })
  expect(w.files[CHANGELOG]).toMatch(/\(FILED, 2026-11-02\)\n\n## R2: Two \(MERGED-UPSTREAM, 2026-11-14\)\n\nMerged.\n$/)
  expect(w.files[LOCAL]).not.toContain('## R2')
})

test('a close_item retry after the record was written finishes the delete and writes no second record', async ($: any, on: any) => {
  const w = local(on, { [CHANGELOG]: '# Changelog\n' })
  // The backlog write fails once, after the record is safe. The engine reports a hook that threw as no answer.
  let fail = true
  w.tear = path => { if (path === LOCAL && fail) { fail = false; throw new Error('EIO: disk gone') } }
  expect(await failed($, 'close_item', { id: 'R2', record: 'Done.' })).toBe('close_item: no implementation for fs.write')
  expect(w.files[CHANGELOG]).toBe('# Changelog\n\n## R2: Two (DONE, 2026-11-14)\n\nDone.\n')
  expect(w.files[LOCAL]).toBe(BACKLOG)
  const out = await text($, 'close_item', { id: 'R2', record: 'Done, reworded.' })
  expect(out).toContain('record: the changelog already has a DONE record for R2 at line 3, from an earlier call, so it was not written again')
  expect(out).toContain('removed:\n## R2: Two')
  expect(w.files[CHANGELOG]).toBe('# Changelog\n\n## R2: Two (DONE, 2026-11-14)\n\nDone.\n')
  expect(w.files[LOCAL]).not.toContain('R2: Two')
})

test('close_item on a tracked backlog only deletes, in the worktree\'s copy', async ($: any, on: any) => {
  const w = tracked(on)
  expect(await failed($, 'close_item', { id: 'R2', path: `${WT}/BACKLOG.md`, status: 'DONE' })).toBe('close_item: a tracked backlog has no changelog, and the deletion is the done-record: call again with no status or record')
  expect(await text($, 'close_item', { id: 'R2', path: `${WT}/BACKLOG.md` })).toBe(`wrote ${WT}/BACKLOG.md\nremoved:\n## R2: Two`)
  expect(w.files[`${WT}/BACKLOG.md`]).toBe('# Backlog\n\nHighest ID used: R2\n\n## R1: One\n')
  expect(w.files[`${MAIN}/BACKLOG.md`]).toBe(TRACKED)
})

// park_item, decline_item

for (const [name, path, title] of [['park_item', PARKED, 'Parked'], ['decline_item', DECLINED, 'Declined']]) {
  test(`${name} appends the item to its file, then deletes it from the backlog`, async ($: any, on: any) => {
    const w = local(on, { [LOCAL]: SUBS })
    expect(await text($, name, { id: 'R1' })).toBe(`wrote ${path}\nwrote /repo/BACKLOG.local.md\nremoved:\n## R1: One\n### R1.1: Sub`)
    expect(w.files[path]).toBe(`# ${title} (local only)\n\nNever commit or push this file.\n\n## R1: One\n\n### R1.1: Sub\n\nsub prose\n`)
    expect(w.files[LOCAL]).toBe(HEAD + '## R2: Two\n\n- Gated by: R1\n')
    expect(w.writes.filter(p => !p.includes('/journal/'))).toEqual([path, LOCAL])
  })

  test(`a ${name} retry after the item was appended finishes the delete`, async ($: any, on: any) => {
    const w = local(on, { [path]: `# ${title}\n\n## R0: zero\n\n## R2: Two\n\n- Gated by: R1\n` })
    const before = w.files[path]
    expect(await text($, name, { id: 'R2' })).toBe(`${path} already has R2 with the same text, from an earlier call, so it was not written again\nwrote /repo/BACKLOG.local.md\nremoved:\n## R2: Two`)
    expect(w.files[path]).toBe(before)
    expect(w.files[LOCAL]).toBe(HEAD + '## R1: One\n')
  })
}

test('park_item on a tracked backlog writes the worktree\'s parked file', async ($: any, on: any) => {
  const w = tracked(on)
  await text($, 'park_item', { id: 'R1', path: `${WT}/BACKLOG.md` })
  expect(w.files[`${WT}/BACKLOG-PARKED.md`]).toBe('# Parked\n\n## R1: One\n')
  expect(w.files[`${WT}/BACKLOG.md`]).toBe('# Backlog\n\nHighest ID used: R2\n\n## R2: Two\n')
})

// reactivate_item

const PARKED_R0 = '# Parked\n\n## Old section\n\n## R0: Zero\n\n- Check: `x`\n\nWhy parked.\n\n### R0.1: Zero sub\n\n## R3 to R4: a range\n'

test('reactivate_item moves a parked item and its sub-items into the backlog, the backlog first', async ($: any, on: any) => {
  const w = local(on, { [LOCAL]: BACKLOG.replace('R2\n', 'R4\n'), [PARKED]: PARKED_R0 })
  expect(await text($, 'reactivate_item', { id: 'R0', position: 'after R1' })).toBe(`wrote /repo/BACKLOG.local.md\nwrote ${PARKED}`)
  expect(w.files[LOCAL]).toContain('## R1: One\n\n## R0: Zero\n\n- Check: `x`\n\nWhy parked.\n\n### R0.1: Zero sub\n\n## R2: Two')
  expect(w.files[PARKED]).toBe('# Parked\n\n## Old section\n\n## R3 to R4: a range\n')
  expect(w.writes.filter(p => !p.includes('/journal/'))).toEqual([LOCAL, PARKED])
  expect(await failed($, 'reactivate_item', { id: 'R4', position: 'top' })).toBe('reactivate_item: R4 is in a heading for more than one ID in the parked file, line 5: split it by hand first')
  expect(await failed($, 'reactivate_item', { id: 'R9', position: 'top' })).toBe('reactivate_item: R9 is in neither the parked nor the declined file')
})

test('reactivate_item checks the item in full: it reports item-level problems and refuses a file-level one', async ($: any, on: any) => {
  const w = local(on, {
    [LOCAL]: BACKLOG.replace('R2\n', 'R6\n'),
    [DECLINED]: '# Declined\n\n## R5: Needs the user\n\n## R6: Six\n\n### Notes\n\nfree-form\n',
  })
  expect(await text($, 'reactivate_item', { id: 'R5', position: 'top' })).toBe([
    `wrote /repo/BACKLOG.local.md`, `wrote ${DECLINED}`, 'R5 was checked as a backlog item, and has these problems:', '  BACKLOG.local.md line 5 (item level): "needs the user" with no Needs: user field',
  ].join('\n'))
  expect(await failed($, 'reactivate_item', { id: 'R6', position: 'top' })).toContain('nothing was written, since the new text has file-level problems the files did not have:\n  backlog line')
  expect(w.files[DECLINED]).toContain('## R6: Six')
})

test('a reactivate_item retry after the item was written to the backlog finishes the delete', async ($: any, on: any) => {
  const w = local(on, { [LOCAL]: BACKLOG.replace('R2\n', 'R5\n') + '\n## R5: Five\n', [PARKED]: '# Parked\n\n## R5: Five\n' })
  expect(await text($, 'reactivate_item', { id: 'R5', position: 'top' })).toBe(`the backlog already has R5 with the same text, from an earlier call, so it was not written again\nwrote ${PARKED}`)
  expect(w.files[PARKED]).toBe('# Parked\n')
  expect(w.files[LOCAL]).toBe(BACKLOG.replace('R2\n', 'R5\n') + '\n## R5: Five\n')
})

// confirm_landed

function landed(on: any) {
  const w = tracked(on)
  w.shown['refs/heads/main:BACKLOG.md'] = '# Backlog\n\nHighest ID used: R3\n\n## R1: One\n'
  for (const id of ['R3', 'R3.1', 'R30']) w.refs.set(`refs/backlog/ids/${id}`, `o${id}`)
  return w
}

test('confirm_landed moves the reservation refs of the item and its sub-items to refs/backlog/closed/', async ($: any, on: any) => {
  const w = landed(on)
  expect(await text($, 'confirm_landed', { id: 'R3' })).toBe('moved refs/backlog/ids/R3 to refs/backlog/closed/R3\nmoved refs/backlog/ids/R3.1 to refs/backlog/closed/R3.1')
  expect([...w.refs.keys()].filter(r => r.startsWith('refs/backlog/')).sort()).toEqual(['refs/backlog/closed/R3', 'refs/backlog/closed/R3.1', 'refs/backlog/ids/R30'])
  expect(w.refs.get('refs/backlog/closed/R3')).toBe('oR3')
  // A second call finds nothing left to move.
  expect(await text($, 'confirm_landed', { id: 'R3' })).toBe('refs/backlog/closed/R3 is already there, so nothing was moved')
})

test('confirm_landed refuses while the default branch has the heading or a lower Highest ID used, or a branch for the ID is in flight', async ($: any, on: any) => {
  const w = landed(on)
  w.shown['refs/heads/main:BACKLOG.md'] = '# Backlog\n\nHighest ID used: R3\n\n## R3: Three\n\n### R3.1: Sub\n'
  expect(await failed($, 'confirm_landed', { id: 'R3' })).toBe('confirm_landed: BACKLOG.md on refs/heads/main still has a heading for R3, R3.1, so the landing is not confirmed')
  w.shown['refs/heads/main:BACKLOG.md'] = '# Backlog\n\nHighest ID used: R2\n'
  expect(await failed($, 'confirm_landed', { id: 'R3' })).toBe('confirm_landed: BACKLOG.md on refs/heads/main has Highest ID used R2, below R3, so the landing is not confirmed')
  w.shown['refs/heads/main:BACKLOG.md'] = '# Backlog\n\nHighest ID used: R3\n'
  w.unmerged = ['claude/r3-x']
  expect(await failed($, 'confirm_landed', { id: 'R3' })).toBe('confirm_landed: a branch or worktree named for R3 has commits refs/heads/main lacks, so the landing is not confirmed')
  delete w.shown['refs/heads/main:BACKLOG.md']
  w.unmerged = []
  expect(await failed($, 'confirm_landed', { id: 'R3' })).toBe("confirm_landed: git show refs/heads/main:BACKLOG.md in /repo: fatal: invalid object name 'refs/heads/main:BACKLOG.md'")
  expect([...w.refs.keys()].filter(r => r.startsWith('refs/backlog/closed/'))).toEqual([])
})

test('confirm_landed with no reservation ref in this clone creates the closed ref, and refuses a local-only backlog', async ($: any, on: any) => {
  const w = landed(on)
  w.refs.delete('refs/backlog/ids/R3')
  w.refs.delete('refs/backlog/ids/R3.1')
  expect(await text($, 'confirm_landed', { id: 'R3' })).toBe('created refs/backlog/closed/R3: this clone has no reservation ref for R3')
  expect(w.refs.has('refs/backlog/closed/R3')).toBe(true)
  w.tracked = []
  w.files[LOCAL] = BACKLOG
  expect(await failed($, 'confirm_landed', { id: 'R1' })).toBe('confirm_landed: a local-only backlog has no default branch to confirm against: close_item is the last step')
})

test('delete_item is gone: close_item replaces it', async ($: any, on: any) => {
  local(on)
  const ran = await call($, 'delete_item', { path: LOCAL, id: 'R1' }).then(() => 'answered', (err: Error) => err.message)
  expect(ran).toBe('no implementation for tool.call')
})
