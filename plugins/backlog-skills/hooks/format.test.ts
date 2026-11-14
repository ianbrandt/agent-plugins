// claude plugin test: the backlog format, the gate on Gated by, and the next free ID.
import { expect, test } from 'claude-code/testing'
import { branchId, claimable, gate, idsIn, nextId, nextSubId, parseBacklog, parseHeadings, scan, validateFiles } from './format'

const F = '```'

const BACKLOG = `# Backlog (local only)

Never commit or push this file. Highest ID used: R614

## R612: split roadmap-skills into a backlog and a plan

- Touches: \`plugins/roadmap-skills/**\`
- Gated by: R600
- Branch: \`claude/r612-backlog-and-plan-split\`

The problem in a sentence or two.

### R612.1: the parser

- Touches: \`plugins/backlog-skills/hooks/**\`

Prose.

#### Notes inside an item

${F}md
## R999: quoted, not an item
- Needs: user
${F}

## R614: writing-skills shows a toast during an ordinary session again
- Needs: user

Seen twice.

## R600: review eval cases hard enough to tell Confer's tiers apart

No fields.
`

const parsed = parseBacklog(BACKLOG)
const problems = (text: string) => parseBacklog(text).problems.map(p => [p.level, p.id, p.message])

test('the title, the banner, and the highest ID are read from above the first item', () => {
  expect(parsed.title).toBe('# Backlog (local only)')
  expect(parsed.banner).toBe('Never commit or push this file. Highest ID used: R614')
  expect(parsed.highest).toBe(614)
  expect(parsed.problems).toEqual([])
})

test('items and sub-items are read in file order, with their fields', () => {
  expect(parsed.items.map(i => [i.id, i.level, i.parent, i.title])).toEqual([
    ['R612', 2, undefined, 'split roadmap-skills into a backlog and a plan'],
    ['R612.1', 3, 'R612', 'the parser'],
    ['R614', 2, undefined, 'writing-skills shows a toast during an ordinary session again'],
    ['R600', 2, undefined, "review eval cases hard enough to tell Confer's tiers apart"],
  ])
  expect(parsed.items[0].fields).toEqual({
    Touches: '`plugins/roadmap-skills/**`', 'Gated by': 'R600', Branch: '`claude/r612-backlog-and-plan-split`',
  })
  expect(parsed.items[2].fields).toEqual({ Needs: 'user' })
  expect(parsed.items[3].fields).toEqual({})
})

test('an item spans its sub-items, and its own part ends at the first sub-item', () => {
  const [r612, sub, r614] = parsed.items
  expect(r612.line).toBe(5)
  expect(r612.start).toBe(BACKLOG.indexOf('## R612:'))
  expect(r612.end).toBe(BACKLOG.indexOf('## R614:'))
  expect(r612.ownEnd).toBe(BACKLOG.indexOf('### R612.1'))
  expect(sub.end).toBe(r612.end)
  expect(r612.text).toBe(BACKLOG.slice(r612.start, r612.end))
  expect(parsed.items[3].end).toBe(BACKLOG.length)
  expect(r614.ownEnd).toBe(r614.end)
})

test('a fenced block is code, and an unclosed one is a file-level problem', () => {
  expect(scan(`a\n${F}\nb\n${F}\nc`).lines.map(l => l.code)).toEqual([false, true, true, true, false])
  expect(scan(`a\n${F}js\nb`).unclosed).toBe(2)
  expect(problems(`# B\n\nHighest ID used: R1\n\n## R1: one\n\n${F}\n## R2: two\n`)).toEqual([['file', undefined, 'a fenced block is not closed']])
})

test('a merge conflict marker outside a fence is a file-level problem', () => {
  const text = `# B\n\nHighest ID used: R2\n\n## R1: one\n\n<<<<<<< HEAD\na\n=======\nb\n>>>>>>> main\n\n${F}\n=======\n${F}\n`
  expect(parseBacklog(text).problems.filter(p => p.level === 'file').map(p => p.line)).toEqual([7, 9, 11])
})

test('a heading that is not an item heading is a file-level problem', () => {
  const cases = ['## Order and dependencies', '## R12 no colon', '## R12.1: a sub-item at level two', '# Another title', '### R7: a top-level ID at level three']
  for (const h of cases) {
    const found = parseBacklog(`# B\n\nHighest ID used: R12\n\n## R1: one\n\n${h}\n`).problems
    expect(found.map(p => [p.level, p.line])).toEqual([['file', 7]])
  }
})

test('a sub-item under the wrong parent, or before any item, is a file-level problem', () => {
  expect(problems('# B\n\nHighest ID used: R2\n\n## R1: one\n\n### R2.1: not its parent\n').map(p => p[0])).toEqual(['file'])
  expect(problems('# B\n\nHighest ID used: R2\n\n### R2.1: no parent\n').map(p => p[0])).toEqual(['file'])
})

test('an ID twice in the backlog is a file-level problem', () => {
  expect(problems('# B\n\nHighest ID used: R2\n\n## R1: one\n\n## R1: again\n')).toEqual([['file', 'R1', 'R1 has two headings']])
})

test('the field list may follow the heading with no blank line, and a blank line ends it', () => {
  const b = parseBacklog('# B\n\nHighest ID used: R1\n\n## R1: one\n- Touches: a\n- Check: b\n\nProse.\n')
  expect(b.items[0].fields).toEqual({ Touches: 'a', Check: 'b' })
  expect(b.problems).toEqual([])
})

test('a field-shaped list elsewhere in an item is an item-level problem', () => {
  expect(problems('# B\n\nHighest ID used: R1\n\n## R1: one\n\nProse.\n\n- Touches: a\n')).toEqual([['item', 'R1', 'a field list that is not the first block after the heading']])
  expect(problems('# B\n\nHighest ID used: R1\n\n## R1: one\n\n- Touches: a\n\n- Gated by: R0\n').map(p => p[0])).toEqual(['item'])
  expect(problems(`# B\n\nHighest ID used: R1\n\n## R1: one\n\n${F}\n- Touches: a\n${F}\n`)).toEqual([])
})

test('"needs the user" in the heading or the first line of prose, with no Needs: user field, is an item-level problem', () => {
  expect(problems('# B\n\nHighest ID used: R1\n\n## R1: try a model (needs the user)\n').map(p => p[0])).toEqual(['item'])
  expect(problems('# B\n\nHighest ID used: R1\n\n## R1: one\n\n- Touches: a\n\nThis needs the user at the keyboard.\n').map(p => p[0])).toEqual(['item'])
  expect(problems('# B\n\nHighest ID used: R1\n\n## R1: one (needs the user)\n\n- Needs: user\n')).toEqual([])
  expect(problems('# B\n\nHighest ID used: R1\n\n## R1: one\n\nFirst line.\nIt needs the user later.\n')).toEqual([])
})

test('an unknown field key, prose above the first item, and an empty title are warnings', () => {
  expect(problems('# B\n\nHighest ID used: R2\n\nA paragraph.\n\n## R1: one\n\n- Owner: me\n\n## R2:\n')).toEqual([
    ['warning', undefined, 'prose above the first item'],
    ['warning', 'R1', 'an unknown field key: Owner'],
    ['warning', 'R2', 'an empty title'],
  ])
})

test('a field set twice is an item-level problem', () => {
  expect(problems('# B\n\nHighest ID used: R1\n\n## R1: one\n\n- Touches: a\n- Touches: b\n').map(p => p[0])).toEqual(['item'])
})

test('a file with CRLF line ends parses the same', () => {
  const crlf = parseBacklog(BACKLOG.replace(/\n/g, '\r\n'))
  expect(crlf.items.map(i => i.id)).toEqual(parsed.items.map(i => i.id))
  expect(crlf.items[0].fields.Touches).toBe('`plugins/roadmap-skills/**`')
  expect(crlf.problems).toEqual([])
})

const CHANGELOG = `# Roadmap changelog (local only)

## communication-skills plugin (LANDED 2026-08-11, \`6a23e6d\`)

### R2 follow-on, same day—the plugin boundary

## R13: the reply lint in bash and awk—BUILT-LOCAL 2026-09-11, branch \`claude/umber-finch\`

## R19: the PowerShell gate test fails on \`main\` (BUILT-LOCAL, 2026-09-20, branch \`claude/amber-otter\`)

## R123.1 and R123.2: the git 2.36 floor (BUILT-LOCAL, 2026-10-08)

## R556 to R558: parked (2026-11-08)

## R574: promote design findings from notes.local (2026-11-09, BUILT-LOCAL)

## R3, R7, and R9: three at once (PR-READY, 2026-11-10)

${F}
## R800: quoted (DONE, 2026-11-11)
${F}
`

test('changelog headings are read with their IDs, ranges, lists, and status', () => {
  expect(parseHeadings(CHANGELOG).map(h => [h.ids, h.level, h.status])).toEqual([
    [['R13'], 2, undefined],
    [['R19'], 2, 'BUILT-LOCAL'],
    [['R123.1', 'R123.2'], 2, 'BUILT-LOCAL'],
    [['R556', 'R557', 'R558'], 2, undefined],
    [['R574'], 2, undefined],
    [['R3', 'R7', 'R9'], 2, 'PR-READY'],
  ])
  expect(parseHeadings(CHANGELOG)[1].line).toBe(9)
  expect(parseHeadings(CHANGELOG)[1].title).toBe('the PowerShell gate test fails on `main` (BUILT-LOCAL, 2026-09-20, branch `claude/amber-otter`)')
})

test('a heading section runs to the next heading of its level or higher', () => {
  const declined = '# D\n\n## R556 to R558: lexer gaps\n\nwhy\n\n### R556: one\n\nx\n\n## R83: other\n'
  const [range, sub, other] = parseHeadings(declined)
  expect(range.text).toBe(declined.slice(declined.indexOf('## R556'), declined.indexOf('## R83')))
  expect(sub.ids).toEqual(['R556'])
  expect(sub.level).toBe(3)
  expect(other.text).toBe('## R83: other\n')
})

test('IDs are found on word boundaries', () => {
  expect(idsIn('R12, R120, R12.3, xR5, R12.3.4, refs/backlog/ids/R613, and (R7).')).toEqual(['R12', 'R120', 'R12.3', 'R613', 'R7'])
})

const files = (backlog: string, parked = '', declined = '', changelog = '') => ({
  backlog: parseBacklog(backlog), parked: parseHeadings(parked), declined: parseHeadings(declined), changelog: parseHeadings(changelog),
})
const levels = (ps: { level: string; id?: string }[]) => ps.map(p => [p.level, p.id])

test('an ID live in two of the backlog, parked, and declined files is a file-level problem', () => {
  expect(levels(validateFiles(files('# B\n\nHighest ID used: R9\n\n## R1: one\n\nnew text\n', '# P\n\n## R1: one\n\nold text\n')))).toEqual([['file', 'R1']])
  expect(levels(validateFiles(files('# B\n\nHighest ID used: R9\n', '# P\n\n## R5: one\n', '# D\n\n## R4 to R6: range\n')))).toEqual([['file', 'R5']])
})

test('an item in the backlog and the parked file with identical text is an interrupted move', () => {
  const item = '## R1: one\n\n- Touches: a\n\nbody\n'
  expect(levels(validateFiles(files(`# B\n\nHighest ID used: R9\n\n${item}`, `# P\n\n${item}`)))).toEqual([['item', 'R1']])
})

test('an ID in the changelog may also be open, parked, or declined', () => {
  expect(validateFiles(files('# B\n\nHighest ID used: R9\n\n## R1: one\n', '# P\n\n## R2: two\n', '', '# C\n\n## R1: one (PR-READY, 2026-11-14)\n\n## R2: two (DONE, 2026-11-01)\n'))).toEqual([])
})

test('a missing Highest ID used line, or one below an ID in any file, is a file-level problem', () => {
  expect(validateFiles(files('# B\n\n## R1: one\n')).map(p => p.message)).toEqual(['no Highest ID used line'])
  expect(levels(validateFiles(files('# B\n\nHighest ID used: R5\n', '', '', '# C\n\n## R6: later (DONE, 2026-11-01)\n')))).toEqual([['file', 'R6']])
  expect(levels(validateFiles(files('# B\n\nHighest ID used: R5\n\n## R5: one\n\n### R5.9: sub\n')))).toEqual([])
})

const LOCAL = '# B\n\nHighest ID used: R20\n\n## R1: open\n\n## R2: gated\n\n- Gated by: R10\n'
const ctx = (over: Record<string, unknown> = {}) => ({
  kind: 'local-only' as const,
  ...files(LOCAL, '# P\n\n## R3: parked\n', '# D\n\n## R4: declined\n',
    '# C\n\n## R10: filed (FILED, 2026-11-01)\n\n## R11: done (DONE, 2026-11-01)\n\n## R12: old—pushed to origin/main\n\n## R13: pr (PR-READY, 2026-11-01)\n\n## R13: merged (MERGED-UPSTREAM, 2026-11-05)\n'),
  ...over,
})

test('a gate on an item open in the backlog, parked, or declined is shut', () => {
  for (const id of ['R1', 'R3', 'R4']) expect(gate(id, ctx())).toBe('shut')
})

test('on a local-only backlog, a changelog record opens the gate unless its status is PR-READY, FILED, or DRAFTED', () => {
  expect(gate('R10', ctx())).toBe('shut')
  expect(gate('R11', ctx())).toBe('open')
  expect(gate('R12', ctx())).toBe('open')
  expect(gate('R14', ctx())).toBe('unknown')
})

// close_item after record_progress appends the final record below the PR-READY one.
test('the last changelog record for an ID decides the gate', () => {
  expect(gate('R13', ctx())).toBe('open')
})

test('on a tracked backlog, a deleted heading or a closed ref opens the gate, and open work elsewhere shuts it', () => {
  const t = (over: Record<string, unknown>) => ctx({ kind: 'tracked', changelog: undefined, ...over })
  expect(gate('R10', t({}))).toBe('unknown')
  expect(gate('R10', t({ deletedOnDefault: new Set(['R10']) }))).toBe('open')
  expect(gate('R10', t({ closedRefs: new Set(['R10']), branchIds: new Set(['R10']) }))).toBe('open')
  for (const key of ['reservedRefs', 'branchIds', 'claimIds']) expect(gate('R10', t({ [key]: new Set(['R10']) }))).toBe('shut')
})

test('an item is claimable when its gate is open and nothing else holds it', () => {
  const c = ctx()
  const [r1, r2] = c.backlog.items
  expect(claimable(r1, c)).toEqual({ gate: 'open', claimable: true, reasons: [] })
  expect(claimable(r2, c)).toEqual({ gate: 'shut', claimable: false, reasons: ['Gated by R10: shut'] })
  expect(claimable(r2, ctx({ changelog: [] })).gate).toBe('unknown')
})

test('a Branch field, a branch with commits, or an item-level problem makes an item not claimable', () => {
  const c = ctx({ backlog: parseBacklog('# B\n\nHighest ID used: R20\n\n## R5: one\n\n- Branch: x\n\n## R6: two (needs the user)\n\n## R7: three\n') })
  const [r1, r2, r3] = c.backlog.items
  expect(claimable(r1, c).reasons).toEqual(['a Branch field'])
  expect(claimable(r2, c).reasons).toEqual(['"needs the user" with no Needs: user field'])
  expect(claimable(r3, { ...c, inFlightIds: new Set(['R7']) }).reasons).toEqual(['a branch or worktree with commits the default branch lacks'])
})

test('an item that needs the user is claimable only in an attended run', () => {
  const c = ctx({ backlog: parseBacklog('# B\n\nHighest ID used: R20\n\n## R5: one\n\n- Needs: user\n') })
  expect(claimable(c.backlog.items[0], c).claimable).toBe(true)
  expect(claimable(c.backlog.items[0], c, { unattended: true }).reasons).toEqual(['Needs: user, in an unattended run'])
})

test('a Gated by with no ID in it, or a file-level problem, makes an item not claimable', () => {
  const c = ctx({ backlog: parseBacklog('# B\n\nHighest ID used: R20\n\n## R5: one\n\n- Gated by: the release\n\n## Notes\n') })
  expect(claimable(c.backlog.items[0], c).reasons).toEqual(['Gated by names no ID', 'a file-level problem in the backlog files'])
})

test('an interrupted move makes the item not claimable', () => {
  const item = '## R1: one\n\nbody\n'
  const c = ctx({ ...files(`# B\n\nHighest ID used: R9\n\n${item}`, `# P\n\n${item}`) })
  expect(claimable(c.backlog.items[0], c).claimable).toBe(false)
})

test('the ID is read from a branch name, in either case and with or without a prefix', () => {
  expect(['claude/r78-foo', 'r78-foo', 'R78', 'claude/R12.3-sub', 'worktree-r78-foo', 'main', 'claude/amber-heron', 'fix-r9-x'].map(branchId))
    .toEqual(['R78', 'R78', 'R78', 'R12.3', 'R78', undefined, undefined, undefined])
})

test('the next ID is one more than the highest in any source', () => {
  expect(nextId({ highest: 613 })).toBe('R614')
  expect(nextId({ highest: 613, ids: ['## R700: x', 'refs/backlog/closed/R650', 'R701.4'], branches: ['claude/r702-foo'] })).toBe('R703')
  expect(nextId({})).toBe('R1')
})

test('the next sub-item ID is one more than the highest under its parent', () => {
  expect(nextSubId('R12', { ids: ['R12.1', 'R12.3', 'R120.9', 'R1.7', 'refs/backlog/ids/R12.4'] })).toBe('R12.5')
  expect(nextSubId('R12', {})).toBe('R12.1')
})
