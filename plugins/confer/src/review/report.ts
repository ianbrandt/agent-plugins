import { isConfirmed, issues } from './consensus'
import type { Phase, RunState } from './state'
import type { Finding, ReviewSide, Severity } from './types'

const sides: readonly ReviewSide[] = ['claude', 'codex']
const other = (side: ReviewSide): ReviewSide => (side === 'claude' ? 'codex' : 'claude')
const unique = <T>(items: T[]) => [...new Set(items.map(item => JSON.stringify(item)))].map(item => JSON.parse(item) as T)
const severities: Severity[] = ['high', 'medium', 'low']
const unresolved = ['open', 'disputed', 'needs-probe', 'inconclusive']

// An answer is stored as a finding, with the answer in fix and its reasons in evidence.
const view = (f: Finding, isAsk = false) => ({
  id: f.id,
  foundBy: f.side,
  phase: f.phase,
  status: f.status,
  ...(isAsk
    ? { answer: f.fix, reasons: f.evidence }
    : { severity: f.severity, path: f.path, ...(f.line !== undefined && { line: f.line }), evidence: f.evidence, fix: f.fix, ...(f.of !== undefined && { of: f.of }) }),
  rulings: isAsk ? f.rulings.map(({ severity, ...r }) => r) : f.rulings,
  ...(f.settled && { settled: f.settled }),
})

const agreedBy = (f: Finding) => (f.status === 'agreed' ? other(f.side) : 'probe')

// One entry per defect: the first finding of a group heads it. Findings of its phase are the same defect, found by both;
// findings of later phases report it as left in place by a fix.
function issue(group: Finding[], isAgreed: boolean, isAsk = false) {
  const [head, ...rest] = group
  const entry = (f: Finding) => ({ ...view(f, isAsk), ...(isAgreed && { agreedBy: agreedBy(f) }) })
  if (rest.length === 0) return entry(head!)
  const severity = group.map(f => f.severity).sort((a, b) => severities.indexOf(a) - severities.indexOf(b))[0]!
  const same = rest.filter(f => f.phase === head!.phase)
  const stillPresent = rest.filter(f => f.phase !== head!.phase)
  return {
    ...entry(head!),
    ...(same.length > 0 && { foundBy: 'both' }),
    ...(!isAsk && { severity }),
    ...(same.length > 0 && { same: same.map(entry) }),
    ...(stillPresent.length > 0 && { stillPresent: stillPresent.map(entry) }),
  }
}

function side(run: RunState, side: ReviewSide) {
  const attempts = run.attempts.filter(a => a.side === side)
  const replies = attempts.flatMap(a => (a.reply ? [a.reply] : []))
  const tokens: Record<string, number> = {}
  for (const a of attempts) for (const [key, value] of Object.entries(a.usage ?? {})) if (typeof value === 'number') tokens[key] = (tokens[key] ?? 0) + value
  // An attempt that ran with no usage recorded has an unknown cost.
  const priced = attempts.filter(a => a.usage !== undefined || a.status === 'replied' || a.agentId !== undefined)
  const rounds = new Set(attempts.map(a => `${a.phase}/${a.round}`))
  return {
    completed: ![...rounds].some(round => attempts.filter(a => `${a.phase}/${a.round}` === round && a.status === 'failed').length >= 2),
    requested: unique(run.phases.map(p => p[side])),
    resolvedModels: unique(attempts.flatMap(a => (a.resolvedModel ? [a.resolvedModel] : []))),
    tokens,
    costUsd: priced.some(a => a.costUsd == null) ? null : priced.reduce((sum, a) => sum + a.costUsd!, 0),
    coverage: unique(replies.flatMap(r => r.coverage)),
    limitations: unique(replies.flatMap(r => r.limitations)),
    failures: attempts.flatMap(a => (a.status === 'failed' ? [{ phase: a.phase, round: a.round, attempt: a.number, failure: a.failure }] : [])),
  }
}

// A plan run cancelled or expired while it waits for a revision, or an ask run that ended before its next round: its last round was applied, and the next has no attempt.
const isBetweenRounds = (run: RunState, p: Phase) => (run.design !== undefined || run.ask !== undefined) && p.stop === undefined && !run.attempts.some(a => a.phase === p.number && a.round === p.round)

export function report(run: RunState) {
  const isAsk = run.ask !== undefined
  const show = (f: Finding) => view(f, isAsk)
  const common = {
    ...(isAsk && { question: run.ask!.question }),
    outcome: run.status,
    ...(run.note !== undefined && { note: run.note }),
    base: run.base,
    phases: run.phases.map(p => ({
      phase: p.number,
      tier: p.tier,
      tree: p.tree,
      rounds: isBetweenRounds(run, p) ? p.round - 1 : p.round,
      stop: p.stop,
      ...(p.number > 0 && { selected: p.selected }),
      ...(p.outcomes && { fixOutcomes: p.outcomes }),
    })),
    limitations: [
      ...(run.submodules.length > 0 ? [`The submodules ${run.submodules.join(', ')} had uncommitted changes, which were not reviewed.`] : []),
      ...(run.nested.length > 0 ? [`The untracked nested repositories ${run.nested.join(', ')} were not reviewed.`] : []),
    ],
    sides: { claude: side(run, 'claude'), codex: side(run, 'codex') },
  }
  if (run.status === 'nothing-to-review') return { ...common, summary: 'Nothing to review' }
  if (run.status === 'failed' || run.phases.length === 0) return { ...common, summary: run.note ?? 'The review could not start.' }
  // Only the phase the run ended in can be unfinished: a fix phase starts after a complete review.
  const last = run.phases.at(-1)!
  const isUnfinished = run.status !== 'complete' && !isBetweenRounds(run, last) && (last.stop === undefined || run.findings.some(f => f.phase === last.number && f.status === 'needs-probe'))
  const findings = run.findings.filter(f => !isUnfinished || f.phase !== last.number)
  const fixed = new Set(run.phases.flatMap(p => Object.entries(p.outcomes ?? {}).flatMap(([id, outcome]) => (outcome === 'fixed' ? [id] : []))))
  const issueGroups = issues(findings.filter(isConfirmed))
  const isFixed = (group: Finding[]) => group.some(f => fixed.has(f.id))
  const confirmed = issueGroups.filter(g => !isFixed(g))
  const fixedGroups = issueGroups.filter(isFixed)
  const open = findings.filter(f => unresolved.includes(f.status))
  const isClean = run.status === 'complete' && findings.every(f => f.status === 'withdrawn' || f.status === 'refuted')
  const counts = `${confirmed.length} confirmed, ${open.length} unresolved${fixedGroups.length > 0 ? `, ${fixedGroups.length} fixed` : ''}.`
  const lists = {
    confirmed: confirmed.map(g => issue(g, true, isAsk)),
    unresolved: open.map(show),
    refuted: findings.filter(f => f.status === 'refuted').map(show),
    withdrawn: findings.filter(f => f.status === 'withdrawn').map(show),
    preexisting: findings.filter(f => f.status === 'preexisting').map(show),
    fixed: fixedGroups.map(g => issue(g, false)),
  }
  const waiting = !isBetweenRounds(run, last) ? '' : isAsk ? `The run ended ${run.status} before round ${last.round}. ` : `The run ended ${run.status} while waiting for a revision of the document. `
  if (!isUnfinished) return { ...common, summary: isClean ? 'No issues found' : `${waiting}${counts}`, ...lists }
  // A BLOCKED attempt's reply is stored, but only a reply the round accepted is reported.
  const accepted = (s: ReviewSide) =>
    last.stop !== undefined ? [] : run.attempts.filter(a => a.side === s && a.phase === last.number && a.round === last.round && a.status === 'replied')
  const unapplied = (s: ReviewSide) =>
    accepted(s).flatMap(a =>
      a.reply!.findings.map(f => ({ ...(isAsk ? { id: f.id, answer: f.fix, reasons: f.evidence } : f), foundBy: s, phase: a.phase, round: a.round, status: 'not ruled on' })),
    )
  // In an ask run, each answer has the accepted rulings of the unfinished round added, and a side's answers include any it adopted in that round.
  const rulings = isAsk ? sides.flatMap(s => accepted(s).flatMap(a => a.reply!.rulings.map(r => ({ ...r, side: s, round: a.round })))) : []
  const ruled = run.findings.map(f => (isAsk ? { ...f, rulings: [...f.rulings, ...rulings.filter(r => r.id === f.id)] } : f))
  const isAdopted = (f: Finding, s: ReviewSide) => rulings.some(r => r.id === f.id && r.side === s && r.ruling === 'agree')
  const positions = (s: ReviewSide) => ruled.filter(f => f.phase === last.number && (f.side === s || isAdopted(f, s))).map(show)
  const phase = last.number === 0 ? (isAsk ? 'the question' : run.design === undefined ? 'the review' : 'the plan review') : `fix review ${last.number}`
  return {
    ...common,
    summary: `The run ended ${run.status} during ${phase}, so its ${isAsk ? 'answers' : 'findings'} are single-reviewer: none of them was confirmed by both reviewers.${last.number > 0 ? ` Earlier phases: ${counts}` : ''}`,
    ...(last.number > 0 && lists),
    singleReviewer: Object.fromEntries(sides.map(s => [s, [...positions(s), ...unapplied(s)]])),
  }
}
