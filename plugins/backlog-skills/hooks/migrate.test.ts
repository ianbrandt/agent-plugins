// claude plugin test: migrate_backlog, against the git and file system kept in
// memory in world.ts.
import { expect, test } from 'claude-code/testing'
import { COMMON, MAIN, call, text, world } from './world'

const NOON = Date.UTC(2026, 10, 14, 12)
const MARKER = `${COMMON}/backlog/migration/marker.json`
const BACKUP = `${MAIN}/notes.local/backlog-migration/2026-11-14`
const EXCLUDE = `${COMMON}/info/exclude`

const ROAD = '# Roadmap (local only)\n\nA standing rule.\n\n## Active burndown\n\n### R3: Three (needs the user)\n\nTouches `a/**`.\n\n### R2—Two\n\nProse.\n'
const PARKED = '# Roadmap: parked (local only)\n\n## R1: One (parked 2026-11-01)\n\nWhy.\n\n### R1.1—a sub\n'
const CHANGELOG = '# Roadmap changelog (local only)\n\n## R0: zero—BUILT-LOCAL 2026-08-11\n\n## R4: Four (DONE, 2026-11-01)\n'
const ITEMS = '## R3: Three\n\n- Touches: `a/**`\n- Needs: user\n\n## R2: Two\n\nProse.\n'
const NEW = '# Backlog (local only)\n\nNever commit or push this file. Highest ID used: R4\n\n' + ITEMS

function local(on: any, files: Record<string, string> = {}) {
  const w = world(on, {
    [`${MAIN}/ROADMAP.local.md`]: ROAD, [`${MAIN}/ROADMAP-PARKED.local.md`]: PARKED, [`${MAIN}/ROADMAP-CHANGELOG.local.md`]: CHANGELOG, ...files,
  })
  w.t = NOON
  return w
}

const failed = async ($: any, input: object) => {
  const ran = await call($, 'migrate_backlog', input)
  expect(ran.isError).toBe(true)
  return ran.text as string
}
const marker = (w: { files: Record<string, string> }) => JSON.parse(w.files[MARKER])

// The first call

test('with no text, the tool returns the preconditions, the destinations, and each old file\'s IDs and numbered header, and writes nothing', async ($: any, on: any) => {
  const w = local(on)
  const out = await text($, 'migrate_backlog')
  expect(w.writes).toEqual([])
  expect(out).toContain('migration: local-only, in /repo\nmarker: none yet\npreconditions:\n  ok: the claim ledger is empty\n  ok: no BACKLOG* or PLAN* file but the migration\'s\n  not checked: no other session')
  expect(out).toContain([
    'destinations:', '  /repo/BACKLOG.local.md: the backlog text', '  /repo/BACKLOG-PARKED.local.md: a copy of ROADMAP-PARKED.local.md',
    '  /repo/BACKLOG-CHANGELOG.local.md: a copy of ROADMAP-CHANGELOG.local.md', '  /repo/PLAN.local.md: the plan text', 'Highest ID used will be R4.',
  ].join('\n'))
  expect(out).toContain('  /repo/ROADMAP.local.md: IDs R3, R2\n  header, lines 1 to 6:\n    1: # Roadmap (local only)\n    2: \n    3: A standing rule.\n    4: \n    5: ## Active burndown\n    6: \n')
  expect(out).toContain('  /repo/ROADMAP-PARKED.local.md: IDs R1, R1.1\n')
  expect(out).toContain('BACKLOG-PARKED.local.md: headings that start with an ID but are not written as `ID: Title`, so the tools do not read them: R1.1 line 7')
  expect(out).toContain('BACKLOG-CHANGELOG.local.md: records with no recognized status, which open the gates of their IDs: R0 line 3')
  expect(out).toContain('Next, call migrate_backlog again with:\n- backlog, unless kept: the items of ROADMAP.local.md')
})

// Preconditions

for (const [what, files, expected] of [
  ['a live claim', { [`${MAIN}/.claude/claims/x.json`]: JSON.stringify({ item: 'R9: x', branch: 'main' }) }, 'the claim ledger in /repo/.claude/claims is not empty: x.json (main)'],
  ['a claim that does not parse', { [`${MAIN}/.claude/claims/x.json`]: '{' }, 'the claim ledger in /repo/.claude/claims is not empty: x.json does not parse'],
  ['a plan already there', { [`${MAIN}/PLAN.md`]: 'x' }, '/repo has PLAN.md, which the migration did not write'],
  ['an old file the migration does not know', { [`${MAIN}/ROADMAP-NOTES.local.md`]: 'x' }, 'files the migration does not know: ROADMAP-NOTES.local.md'],
] as [string, Record<string, string>, string][]) {
  test(`${what} is reported by the first call, and refuses the run with nothing written`, async ($: any, on: any) => {
    const w = local(on, files)
    expect(await text($, 'migrate_backlog')).toContain(`not met: ${expected}`)
    expect(await failed($, { backlog: ITEMS, plan: '' })).toContain(`nothing was written, since these preconditions are not met:\n  ${expected}`)
    expect(w.writes).toEqual([])
  })
}

test('a local-only roadmap refuses a branch or a commit message', async ($: any, on: any) => {
  local(on)
  expect(await failed($, { backlog: ITEMS, plan: '', branch: 'x' })).toContain('a local-only roadmap is not committed: leave out branch and message')
})

test('the tool refuses a repo whose kind is not a migration kind', async ($: any, on: any) => {
  world(on)
  expect(await failed($, {})).toBe('migrate_backlog: there is no old roadmap to migrate: the kind is local-only')
})

// The steps, local-only

test('a local-only migration writes the exclusions, the marker, the backup, and the new files, then deletes the old files', async ($: any, on: any) => {
  const w = local(on, { [EXCLUDE]: '# git ls-files\n/notes.local' })
  const out = await text($, 'migrate_backlog', { backlog: `\n${ITEMS}\n\n`, plan: 'Scope.\n' })
  expect(w.files[`${MAIN}/BACKLOG.local.md`]).toBe(NEW)
  expect(w.files[`${MAIN}/BACKLOG-PARKED.local.md`]).toBe(PARKED)
  expect(w.files[`${MAIN}/BACKLOG-CHANGELOG.local.md`]).toBe(CHANGELOG)
  expect(w.files[`${MAIN}/PLAN.local.md`]).toBe('Scope.\n')
  expect(w.files[EXCLUDE]).toBe('# git ls-files\n/notes.local\n/BACKLOG*.local.md\n/PLAN*.local.md\n')
  expect(w.git.filter(l => l.startsWith('check-ignore'))).toEqual([
    'check-ignore -q --no-index -- notes.local', 'check-ignore -q --no-index -- BACKLOG.local.md', 'check-ignore -q --no-index -- BACKLOG-PARKED.local.md',
    'check-ignore -q --no-index -- BACKLOG-DECLINED.local.md', 'check-ignore -q --no-index -- BACKLOG-CHANGELOG.local.md', 'check-ignore -q --no-index -- PLAN.local.md',
  ])
  for (const [name, t] of [['ROADMAP.local.md', ROAD], ['ROADMAP-PARKED.local.md', PARKED], ['ROADMAP-CHANGELOG.local.md', CHANGELOG]]) {
    expect(w.files[`${BACKUP}/${name}`]).toBe(t)
    expect(`${MAIN}/${name}` in w.files).toBe(false)
  }
  expect(w.git).toContain('clean -f -x -q -- :(top,literal)ROADMAP.local.md')
  const m = marker(w)
  expect(m).toMatchObject({ complete: true, tracked: false, backup: BACKUP, old: ['ROADMAP.local.md', 'ROADMAP-PARKED.local.md', 'ROADMAP-CHANGELOG.local.md'] })
  expect(Object.keys(m.dests)).toEqual(['BACKLOG.local.md', 'BACKLOG-PARKED.local.md', 'BACKLOG-CHANGELOG.local.md', 'PLAN.local.md'])
  for (const d of Object.values(m.dests) as any[]) expect(d.hash).toMatch(/^h\d+$/)
  expect(out).toContain('added /BACKLOG*.local.md, /PLAN*.local.md to /repo/.git/info/exclude\n')
  expect(out).toContain('deleted /repo/ROADMAP-CHANGELOG.local.md\nThe migration is complete.')
  expect(w.refs.has('refs/backlog/lock')).toBe(false)
  expect(await text($, 'find_backlog')).toContain('kind: local-only')
})

test('a plan of "" writes no plan file, and leaving the plan out refuses the run', async ($: any, on: any) => {
  const w = local(on)
  expect(await failed($, { backlog: ITEMS })).toBe('migrate_backlog: nothing was written: pass plan, or "" for no plan, since PLAN.local.md is not written yet')
  expect(w.writes).toEqual([])
  expect(await text($, 'migrate_backlog', { backlog: ITEMS, plan: '' })).toContain('no plan: PLAN.local.md was not written')
  expect(`${MAIN}/PLAN.local.md` in w.files).toBe(false)
  expect(marker(w).dests['PLAN.local.md']).toEqual({ started: true, none: true })
})

test('the new backlog\'s file-level problems refuse the run with nothing written, and its other problems are reported', async ($: any, on: any) => {
  const w = local(on)
  expect(await failed($, { backlog: `${ITEMS}\n## R3: again\n`, plan: '' })).toContain('nothing was written, since the new files have file-level problems:\n  BACKLOG.local.md line 14 (file level): R3 has two headings')
  expect(w.writes).toEqual([])
  const out = await text($, 'migrate_backlog', { backlog: ITEMS.replace('Three\n', 'Three (needs the user)\n').replace('- Needs: user\n', ''), plan: '' })
  expect(out).toContain('problems in the new backlog files, to fix with the write tools:\n  BACKLOG.local.md line 5 (item level): "needs the user" with no Needs: user field')
})

test('text above the first item is refused', async ($: any, on: any) => {
  local(on)
  expect(await failed($, { backlog: `# Backlog\n\n${ITEMS}`, plan: '' })).toContain('backlog has text above its first item heading')
})

test('IDs that differ between the old roadmap and the new backlog refuse the run, listed both ways, with nothing written', async ($: any, on: any) => {
  const w = local(on)
  const out = await failed($, { backlog: ITEMS.replace('## R2: Two', '## R5: Five'), plan: '' })
  expect(out).toContain('nothing was written, since the IDs in the new backlog differ from those in ROADMAP.local.md:\n  missing from the new backlog: R2\n  not in the old roadmap: R5')
  expect(w.writes).toEqual([])
})

// Reruns

test('a run interrupted after the first destination is continued: the backlog is kept, and the rest is written', async ($: any, on: any) => {
  const w = local(on)
  w.tear = (path: string) => { if (path.endsWith('BACKLOG-PARKED.local.md')) throw new Error('EIO') }
  await failed($, { backlog: ITEMS, plan: 'Scope.' })
  expect(marker(w).complete).toBe(false)
  expect(marker(w).dests['BACKLOG-PARKED.local.md']).toEqual({ started: true })
  expect(await text($, 'find_backlog')).toContain('kind: partial-migration')
  w.tear = undefined
  const first = await text($, 'migrate_backlog')
  expect(first).toContain('marker: /repo/.git/backlog/migration/marker.json, from a migration that did not finish')
  expect(first).toContain('/repo/BACKLOG.local.md: kept, written by an earlier call and unchanged')
  const writes = w.writes.filter(p => p.endsWith('/BACKLOG.local.md')).length
  const out = await text($, 'migrate_backlog', { plan: 'Scope.' })
  expect(out).toContain('kept /repo/BACKLOG.local.md, written by an earlier call')
  expect(w.writes.filter(p => p.endsWith('/BACKLOG.local.md')).length).toBe(writes)
  expect(w.files[`${MAIN}/BACKLOG-PARKED.local.md`]).toBe(PARKED)
  expect(marker(w).complete).toBe(true)
  expect(`${MAIN}/ROADMAP.local.md` in w.files).toBe(false)
})

test('a destination started with no hash, or changed after its write, is saved as .found, numbered, and written again', async ($: any, on: any) => {
  const w = local(on)
  const partial = { complete: false, tracked: false, backup: BACKUP, old: ['ROADMAP.local.md', 'ROADMAP-PARKED.local.md', 'ROADMAP-CHANGELOG.local.md'], dests: { 'BACKLOG.local.md': { started: true } } }
  w.files[MARKER] = JSON.stringify(partial)
  w.files[`${MAIN}/BACKLOG.local.md`] = '# Backlog (lo'
  w.files[`${BACKUP}/BACKLOG.local.md.found`] = 'older'
  expect(await text($, 'migrate_backlog')).toContain('/repo/BACKLOG.local.md: the backlog text. The file there now will be saved as BACKLOG.local.md.found in')
  // A rerun needs the backlog text again, since the file was never finished.
  expect(await failed($, { plan: '' })).toContain('pass backlog, since BACKLOG.local.md is not written yet')
  const out = await text($, 'migrate_backlog', { backlog: ITEMS, plan: '' })
  expect(out).toContain(`saved /repo/BACKLOG.local.md as ${BACKUP}/BACKLOG.local.md.found.2`)
  expect(w.files[`${BACKUP}/BACKLOG.local.md.found.2`]).toBe('# Backlog (lo')
  expect(w.files[`${MAIN}/BACKLOG.local.md`]).toBe(NEW)

  // A hand edit after a recorded write is kept for the user the same way.
  const done = marker(w)
  w.files[MARKER] = JSON.stringify({ ...done, complete: false })
  w.files[`${MAIN}/BACKLOG.local.md`] = NEW + 'edited\n'
  await text($, 'migrate_backlog', { backlog: ITEMS, plan: '' })
  expect(w.files[`${BACKUP}/BACKLOG.local.md.found.3`]).toBe(NEW + 'edited\n')
  expect(w.files[`${MAIN}/BACKLOG.local.md`]).toBe(NEW)
})

test('a marker that does not parse is refused', async ($: any, on: any) => {
  const w = local(on)
  w.files[MARKER] = '{"complete":false'
  expect(await failed($, {})).toContain('the migration marker /repo/.git/backlog/migration/marker.json does not parse')
})

test('a stale marker is replaced by a new migration', async ($: any, on: any) => {
  const w = local(on)
  w.files[MARKER] = JSON.stringify({ complete: true, tracked: true, branch: 'gone' })
  expect(await text($, 'find_backlog')).toContain('kind: needs-migration')
  expect(await text($, 'migrate_backlog')).toContain('marker: none yet. The old marker at /repo/.git/backlog/migration/marker.json will be replaced')
  expect(await text($, 'migrate_backlog', { backlog: ITEMS, plan: '' })).toContain('replaced the marker of an earlier migration')
  expect(marker(w)).toMatchObject({ complete: true, tracked: false })
})

// Tracked

const TROAD = '# Roadmap\n\nHighest ID used: R5\n\n## Lane\n\n### R2—Two\n\nProse.\n'
const TITEMS = '## R2: Two\n\nProse.\n'
const TPARKED = '# Parked\n\n### R4—Four\n'

function tracked(on: any, branch = 'claude/backlog-migration') {
  const w = world(on, { [`${MAIN}/ROADMAP.md`]: TROAD, [`${MAIN}/ROADMAP-PARKED.md`]: TPARKED })
  w.tracked = ['ROADMAP.md', 'ROADMAP-PARKED.md']
  for (const t of w.tracked) w.head.add(t)
  w.worktrees[0].branch = branch
  w.refs.set(`refs/heads/${branch}`, 'c1')
  w.t = NOON
  return w
}

test('a tracked migration needs a branch other than the default one, checked out, and a message', async ($: any, on: any) => {
  const w = tracked(on, 'main')
  expect(await text($, 'migrate_backlog')).toContain('not met: branch: pass branch, a branch other than main checked out in the primary checkout or a worktree')
  expect(await failed($, { backlog: TITEMS, plan: '', branch: 'main', message: 'm' })).toContain('branch: main is the default branch')
  expect(await failed($, { backlog: TITEMS, plan: '', branch: 'other', message: 'm' })).toContain('branch: other is not checked out')
  expect(await failed($, { backlog: TITEMS, plan: '', branch: 'other' })).toContain('message: pass the commit message')
  expect(w.writes).toEqual([])
})

test('a tracked migration refuses item branches in flight and old files with changes not committed', async ($: any, on: any) => {
  const w = tracked(on)
  w.unmerged = ['claude/r2-two', 'claude/backlog-migration']
  w.status = ' M ROADMAP.md\n'
  const out = await failed($, { backlog: TITEMS, plan: '', branch: 'claude/backlog-migration', message: 'm' })
  expect(out).toContain('branches or worktrees with commits the default branch lacks, which edit the roadmap: R2')
  expect(out).toContain('the old roadmap files have changes that are not committed:\n M ROADMAP.md')
  expect(w.writes).toEqual([])
})

test('a tracked migration writes the files, removes the old ones, and commits them on its branch', async ($: any, on: any) => {
  const w = tracked(on)
  const out = await text($, 'migrate_backlog', { backlog: TITEMS, plan: 'Scope.', branch: 'claude/backlog-migration', message: 'Move the roadmap to a backlog' })
  expect(w.files[`${MAIN}/BACKLOG.md`]).toBe('# Backlog\n\nHighest ID used: R5\n\n' + TITEMS)
  expect(w.files[`${MAIN}/BACKLOG-PARKED.md`]).toBe(TPARKED)
  expect(w.files[`${MAIN}/PLAN.md`]).toBe('Scope.\n')
  expect(w.files[EXCLUDE]).toBe('/notes.local\n')
  expect(Object.keys(w.files).some(p => p.includes('notes.local/backlog-migration'))).toBe(false)
  expect(w.commits).toEqual([{ message: 'Move the roadmap to a backlog', paths: ['BACKLOG.md', 'BACKLOG-PARKED.md', 'PLAN.md', 'ROADMAP.md', 'ROADMAP-PARKED.md'] }])
  expect([...w.head].sort()).toEqual(['BACKLOG-PARKED.md', 'BACKLOG.md', 'PLAN.md'])
  expect(marker(w)).toMatchObject({ complete: true, tracked: true, branch: 'claude/backlog-migration' })
  expect(out).toContain('committed c2 on claude/backlog-migration\nThe migration is complete. find_backlog returns migration-pending until claude/backlog-migration lands')
  expect(await text($, 'find_backlog')).toContain('kind: migration-pending')
})

test('a tracked migration interrupted after its commit finishes without a second commit', async ($: any, on: any) => {
  const w = tracked(on)
  let once = true
  w.before = line => {
    if (line === 'rev-parse HEAD' && once) { once = false; return { exitCode: 1, stderr: 'fatal: boom' } }
    if (line.startsWith('rev-list -1 HEAD --')) return 'c9\n'
  }
  w.shown = { 'c9^:ROADMAP.md': TROAD, 'c9^:ROADMAP-PARKED.md': TPARKED }
  const input = { plan: '', branch: 'claude/backlog-migration', message: 'm' }
  expect(await failed($, { ...input, backlog: TITEMS })).toContain('fatal: boom')
  expect(marker(w).complete).toBe(false)
  expect(await text($, 'migrate_backlog', { ...input, run: true })).toContain('The migration is complete')
  expect(w.commits).toHaveLength(1)
})

test('a tracked migration in a worktree writes there', async ($: any, on: any) => {
  const w = tracked(on, 'main')
  const WT = '/wt/backlog-migration'
  w.worktrees.push({ path: WT, branch: 'claude/m' })
  w.refs.set('refs/heads/claude/m', 'c1')
  w.files[`${WT}/ROADMAP.md`] = TROAD
  w.files[`${WT}/ROADMAP-PARKED.md`] = TPARKED
  await text($, 'migrate_backlog', { backlog: TITEMS, plan: '', branch: 'claude/m', message: 'm' })
  expect(w.files[`${WT}/BACKLOG.md`]).toContain('## R2: Two')
  expect(`${MAIN}/BACKLOG.md` in w.files).toBe(false)
  expect(w.files[`${MAIN}/ROADMAP.md`]).toBe(TROAD)
})

test('a tracked roadmap with no Highest ID used line takes the highest ID deleted on the default branch too', async ($: any, on: any) => {
  const w = tracked(on)
  w.files[`${MAIN}/ROADMAP.md`] = TROAD.replace('Highest ID used: R5\n\n', '')
  w.log = '-### R9—Nine\n+x\n'
  expect(await text($, 'migrate_backlog', { branch: 'claude/backlog-migration', message: 'm' })).toContain('Highest ID used will be R9.')
})
