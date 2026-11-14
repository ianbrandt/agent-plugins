// Which kind of backlog a repo has (design D3), from facts read elsewhere: the
// first row of D3's table that matches.
export type Kind = 'partial-migration' | 'migration-pending' | 'local-only' | 'tracked' | 'needs-migration' | 'fork-without-backlog' | 'none'
export type Paths = { backlog: string; parked: string; declined: string; changelog?: string; plan: string }

export type Facts = {
  // The migration marker under <git common dir>/backlog/migration/, where there is one.
  marker?: { complete: boolean; tracked: boolean; branch?: string }
  // Paths at the root of the primary checkout that exist, and those git tracks.
  files: string[]
  tracked: string[]
  hasUpstream: boolean
  backlogOnDefault?: boolean
  branchExists?: boolean
  // Tracked ROADMAP.md or docs/roadmap.md files with an Rn item heading or a Highest ID used line.
  oldTracked?: string[]
}

const LOCAL: Paths = { backlog: 'BACKLOG.local.md', parked: 'BACKLOG-PARKED.local.md', declined: 'BACKLOG-DECLINED.local.md', changelog: 'BACKLOG-CHANGELOG.local.md', plan: 'PLAN.local.md' }
const TRACKED: Paths = { backlog: 'BACKLOG.md', parked: 'BACKLOG-PARKED.md', declined: 'BACKLOG-DECLINED.md', plan: 'PLAN.md' }

export function kindOf(f: Facts): { kind: Kind; paths?: Paths; report: string[] } {
  const report: string[] = []
  const m = f.marker
  if (m && !m.complete) return { kind: 'partial-migration', report }
  if (m?.tracked && !f.backlogOnDefault) {
    if (f.branchExists) return { kind: 'migration-pending', report }
    report.push(`a stale migration marker: its branch ${m.branch ?? '(not recorded)'} is gone, and BACKLOG.md is not on the default branch`)
  }
  // A fork's tracked roadmap is the upstream project's, so only a non-fork's counts.
  const old = [...f.files.filter(p => /^ROADMAP(-.*)?\.local\.md$/.test(p)), ...(f.hasUpstream ? [] : f.oldTracked ?? [])]
  const found = (kind: Kind, paths: Paths) => {
    for (const p of old) report.push(`an old roadmap file is still here: ${p}`)
    return { kind, paths, report }
  }
  if (f.files.includes('BACKLOG.local.md')) return found('local-only', LOCAL)
  if (f.tracked.includes('BACKLOG.md') && !f.hasUpstream) return found('tracked', TRACKED)
  if (old.length) return { kind: 'needs-migration', report }
  return { kind: f.hasUpstream ? 'fork-without-backlog' : 'none', report }
}
