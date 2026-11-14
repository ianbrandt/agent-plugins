// claude plugin test: which kind of backlog a repo has, from facts read elsewhere.
import { expect, test } from 'claude-code/testing'
import { kindOf } from './kind'

const none = { files: [], tracked: [], hasUpstream: false }
const LOCAL = { backlog: 'BACKLOG.local.md', parked: 'BACKLOG-PARKED.local.md', declined: 'BACKLOG-DECLINED.local.md', changelog: 'BACKLOG-CHANGELOG.local.md', plan: 'PLAN.local.md' }
const TRACKED = { backlog: 'BACKLOG.md', parked: 'BACKLOG-PARKED.md', declined: 'BACKLOG-DECLINED.md', plan: 'PLAN.md' }

test('a repo with nothing is none, and one with an upstream remote is a fork without a backlog', () => {
  expect(kindOf(none)).toEqual({ kind: 'none', report: [] })
  expect(kindOf({ ...none, hasUpstream: true })).toEqual({ kind: 'fork-without-backlog', report: [] })
})

test('a local-only backlog comes before a tracked one, and gets the local-only paths', () => {
  expect(kindOf({ ...none, files: ['BACKLOG.local.md', 'BACKLOG.md'], tracked: ['BACKLOG.md'] })).toEqual({ kind: 'local-only', paths: LOCAL, report: [] })
  expect(kindOf({ ...none, files: ['BACKLOG.local.md'], hasUpstream: true }).kind).toBe('local-only')
})

test('a tracked BACKLOG.md is a tracked backlog only with no upstream remote', () => {
  expect(kindOf({ ...none, files: ['BACKLOG.md'], tracked: ['BACKLOG.md'] })).toEqual({ kind: 'tracked', paths: TRACKED, report: [] })
  expect(kindOf({ ...none, files: ['BACKLOG.md'], tracked: ['BACKLOG.md'], hasUpstream: true }).kind).toBe('fork-without-backlog')
  expect(kindOf({ ...none, files: ['BACKLOG.md'] }).kind).toBe('none')
})

test('an old local-only roadmap needs migration, in a fork too', () => {
  for (const f of ['ROADMAP.local.md', 'ROADMAP-PARKED.local.md']) {
    expect(kindOf({ ...none, files: [f], hasUpstream: true }).kind).toBe('needs-migration')
  }
})

test('an old tracked roadmap with items needs migration only with no upstream remote', () => {
  expect(kindOf({ ...none, oldTracked: ['docs/roadmap.md'] }).kind).toBe('needs-migration')
  expect(kindOf({ ...none, oldTracked: ['ROADMAP.md'], hasUpstream: true }).kind).toBe('fork-without-backlog')
})

test('an incomplete marker is a partial migration, ahead of every other row', () => {
  expect(kindOf({ ...none, files: ['BACKLOG.local.md'], marker: { complete: false, tracked: false } }).kind).toBe('partial-migration')
})

test('a complete tracked marker is pending until BACKLOG.md is on the default branch', () => {
  const marker = { complete: true, tracked: true, branch: 'claude/r9-migrate' }
  expect(kindOf({ ...none, marker, branchExists: true }).kind).toBe('migration-pending')
  expect(kindOf({ ...none, files: ['BACKLOG.md'], tracked: ['BACKLOG.md'], marker, branchExists: true, backlogOnDefault: true })).toEqual({ kind: 'tracked', paths: TRACKED, report: [] })
})

test('a complete tracked marker with its branch gone is reported as stale, and the kind is taken from the rows below', () => {
  const found = kindOf({ ...none, files: ['ROADMAP.local.md'], marker: { complete: true, tracked: true, branch: 'claude/r9-migrate' } })
  expect(found.kind).toBe('needs-migration')
  expect(found.report).toEqual(['a stale migration marker: its branch claude/r9-migrate is gone, and BACKLOG.md is not on the default branch'])
})

test('a complete local-only marker is not reported', () => {
  expect(kindOf({ ...none, files: ['BACKLOG.local.md'], marker: { complete: true, tracked: false } })).toEqual({ kind: 'local-only', paths: LOCAL, report: [] })
})

test('a backlog beside an old roadmap file keeps the backlog kind, and the old file is reported', () => {
  expect(kindOf({ ...none, files: ['BACKLOG.local.md', 'ROADMAP.local.md'] }).report).toEqual(['an old roadmap file is still here: ROADMAP.local.md'])
  const tracked = kindOf({ ...none, files: ['BACKLOG.md'], tracked: ['BACKLOG.md'], oldTracked: ['ROADMAP.md'] })
  expect(tracked.kind).toBe('tracked')
  expect(tracked.report).toEqual(['an old roadmap file is still here: ROADMAP.md'])
})

// A fork's tracked ROADMAP.md is the upstream project's.
test("a fork's tracked roadmap is not reported beside a local-only backlog", () => {
  expect(kindOf({ ...none, files: ['BACKLOG.local.md'], oldTracked: ['ROADMAP.md'], hasUpstream: true }).report).toEqual([])
})
