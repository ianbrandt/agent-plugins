import type { Finding, FixOutcome, Reply, ReviewSide, Status } from './types'

type Outcome = 'confirmed' | 'refuted' | 'inconclusive'

const sides: readonly ReviewSide[] = ['claude', 'codex']
const prefixes: Record<ReviewSide, string> = { claude: 'C', codex: 'X' }
const otherSide = (side: ReviewSide): ReviewSide => (side === 'claude' ? 'codex' : 'claude')
// In a design, an agreed point is ruled on again against the next version.
const isPending = (f: Finding, phase: number, isDesign = false) =>
  f.phase === phase && (f.status === 'open' || f.status === 'disputed' || (isDesign && f.status === 'agreed'))

export function applyRound(
  findings: Finding[],
  step: { phase: number; round: number; replies: Record<ReviewSide, Reply>; isDesign?: boolean; isAsk?: boolean },
): { findings: Finding[]; changed: boolean } {
  const { phase, round, replies, isDesign = false } = step
  // In a question, a side that stands by a different answer than last round has moved, even when no status changes.
  let changed = step.isAsk === true && sides.some((side) => standsBy(findings, side, phase, round - 1) !== standsBy(findings, side, phase, round, replies[side]))
  const ruled = findings.map((f) => {
    if (!isPending(f, phase, isDesign)) return f
    const next = rule(f, round, replies, isDesign)
    if (next.status !== f.status) changed = true
    return next
  })

  const raised: Finding[] = []
  for (const side of sides) {
    let n = findings.filter((f) => f.side === side).length
    for (const reported of replies[side].findings) {
      const status: Status = reported.preexisting ? 'preexisting' : 'open'
      if (status === 'open') changed = true
      raised.push({ ...reported, id: `${prefixes[side]}${++n}`, side, phase, raisedInRound: round, status, disputes: 0, rulings: [] })
    }
  }
  return { findings: [...ruled, ...raised], changed }
}

// The answers a side agreed with or gave in a round, as one key.
function standsBy(findings: Finding[], side: ReviewSide, phase: number, round: number, reply?: Reply): string {
  const agreed = reply
    ? reply.rulings.filter((r) => r.ruling === 'agree').map((r) => r.id)
    : findings.filter((f) => f.phase === phase && f.rulings.some((r) => r.side === side && r.round === round && r.ruling === 'agree')).map((f) => f.id)
  const given = reply ? reply.findings.map((f) => `new ${f.id}`) : findings.filter((f) => f.phase === phase && f.side === side && f.raisedInRound === round).map((f) => f.id)
  return [...new Set([...agreed, ...given])].sort().join()
}

function rule(f: Finding, round: number, replies: Record<ReviewSide, Reply>, isDesign: boolean): Finding {
  const mine = replies[f.side].rulings.find((r) => r.id === f.id)
  const theirs = replies[otherSide(f.side)].rulings.find((r) => r.id === f.id)
  const rulings = [
    ...f.rulings,
    ...(mine ? [{ ...mine, side: f.side, round }] : []),
    ...(theirs ? [{ ...theirs, side: otherSide(f.side), round }] : []),
  ]
  if (mine?.ruling === 'withdraw') {
    // In a design, a withdrawal the other side still agrees with leaves the point in dispute.
    if (isDesign && theirs?.ruling === 'agree') return { ...f, rulings, status: 'disputed' }
    return { ...f, rulings, status: 'withdrawn' }
  }
  if (theirs?.ruling === 'agree') return { ...f, rulings, status: 'agreed', severity: theirs.severity ?? f.severity }
  if (theirs?.ruling === 'dispute') {
    const disputes = f.disputes + 1
    return { ...f, rulings, disputes, status: disputes >= 2 && !isDesign ? 'needs-probe' : 'disputed' }
  }
  return { ...f, rulings }
}

export function mustRule(findings: Finding[], side: ReviewSide, phase: number, isDesign = false): { own: string[]; other: string[] } {
  const pending = findings.filter((f) => isPending(f, phase, isDesign))
  return {
    own: pending.filter((f) => f.side === side).map((f) => f.id),
    other: pending.filter((f) => f.side !== side).map((f) => f.id),
  }
}

export function stopReason(
  findings: Finding[],
  step: { phase: number; round: number; changed: boolean; maxRounds: number; isDesign?: boolean; isAsk?: boolean },
): 'consensus' | 'stalled' | 'max-rounds' | undefined {
  const isConsensus = step.isAsk
    ? findings.some((f) => f.phase === step.phase && f.status === 'agreed')
    : !findings.some((f) => isPending(f, step.phase, step.isDesign))
  if (isConsensus) return 'consensus'
  if (!step.changed) return 'stalled'
  if (step.round >= step.maxRounds) return 'max-rounds'
  return undefined
}

export function settle(findings: Finding[], id: string, outcome: Outcome, evidence: string): Finding[] {
  const finding = findings.find((f) => f.id === id)
  if (finding === undefined) throw new Error(`There is no finding ${id}.`)
  if (finding.status !== 'needs-probe') throw new Error(`${id} is ${finding.status}, not needs-probe: only a disputed finding can be settled.`)
  return findings.map((f) => (f === finding ? { ...f, status: outcome, settled: { outcome, evidence } } : f))
}

export function isConfirmed(finding: Finding): boolean {
  return finding.status === 'agreed' || finding.status === 'confirmed'
}

// Confirmed findings grouped into issues: first by the `same` marks of agree rulings, then by `of`, which joins a
// fix review's finding to the issue of the finding it reports as still present.
// A `same` mark that would join two findings of one side is skipped.
export function issues(confirmed: Finding[]): Finding[][] {
  const groups = new Map(confirmed.map((f) => [f.id, [f]]))
  const join = (a: Finding[], b: Finding[]) => {
    if (a === b) return
    for (const m of b) groups.set(m.id, a)
    a.push(...b)
  }
  for (const f of confirmed) {
    for (const r of f.rulings) {
      const a = groups.get(f.id)!
      const b = r.same === undefined ? undefined : groups.get(r.same)
      if (b !== undefined && !a.some((x) => b.some((y) => x.side === y.side))) join(a, b)
    }
  }
  for (const f of confirmed) {
    const a = f.of === undefined ? undefined : groups.get(f.of)
    if (a !== undefined) join(a, groups.get(f.id)!)
  }
  const order = new Map(confirmed.map((f, i) => [f.id, i]))
  return [...new Set(groups.values())].map((g) => g.sort((x, y) => order.get(x.id)! - order.get(y.id)!)).sort((x, y) => order.get(x[0]!.id)! - order.get(y[0]!.id)!)
}

export function fixOutcomes(findings: Finding[], step: { phase: number; selected: string[]; isComplete: boolean }): Record<string, FixOutcome> {
  const outcome = (selected: string): FixOutcome => {
    const of = findings.filter((f) => f.phase === step.phase && f.of === selected)
    if (of.some(isConfirmed)) return 'still-present'
    if (step.isComplete && of.every((f) => f.status === 'withdrawn' || f.status === 'refuted')) return 'fixed'
    return 'unresolved'
  }
  return Object.fromEntries(step.selected.map((id) => [id, outcome(id)]))
}
