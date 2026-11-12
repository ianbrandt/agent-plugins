import { expect, test } from 'claude-code/testing'
import { applyRound, fixOutcomes, isConfirmed, issues, mustRule, settle, stopReason } from './consensus'
import type { Finding, ReportedFinding, Reply, Ruling, RulingKind } from './types'

const reported = (id: string, change: Partial<ReportedFinding> = {}): ReportedFinding => ({
  id,
  severity: 'medium',
  path: 'src/a.ts',
  evidence: `evidence for ${id}`,
  fix: `fix for ${id}`,
  ...change,
})
const reply = (findings: ReportedFinding[] = [], rulings: Ruling[] = []): Reply => ({ findings, rulings, coverage: ['src'], limitations: [] })
const rule = (id: string, ruling: RulingKind, change: Partial<Ruling> = {}): Ruling => ({ id, ruling, evidence: `${ruling} ${id}`, ...change })
const status = (findings: Finding[]) => Object.fromEntries(findings.map((f) => [f.id, f.status]))

// Round 1 of phase 1: Claude reports C1 and C2, Codex reports X1.
const round1 = applyRound([], { phase: 1, round: 1, replies: { claude: reply([reported('a'), reported('b')]), codex: reply([reported('z')]) } })

test('new findings are prefixed by side and start open', () => {
  expect(round1.changed).toBe(true)
  expect(round1.findings).toEqual([
    { ...reported('a'), id: 'C1', side: 'claude', phase: 1, raisedInRound: 1, status: 'open', disputes: 0, rulings: [] },
    { ...reported('b'), id: 'C2', side: 'claude', phase: 1, raisedInRound: 1, status: 'open', disputes: 0, rulings: [] },
    { ...reported('z'), id: 'X1', side: 'codex', phase: 1, raisedInRound: 1, status: 'open', disputes: 0, rulings: [] },
  ])
  expect(stopReason(round1.findings, { phase: 1, round: 1, changed: round1.changed, maxRounds: 5 })).toBeUndefined()
})

test('a round with no findings at all ends in consensus', () => {
  const { findings, changed } = applyRound([], { phase: 1, round: 1, replies: { claude: reply(), codex: reply() } })

  expect(findings).toEqual([])
  expect(changed).toBe(false)
  expect(stopReason(findings, { phase: 1, round: 1, changed, maxRounds: 5 })).toBe('consensus')
})

test('each side rules on the open findings of the phase, its own apart', () => {
  expect(mustRule(round1.findings, 'claude', 1)).toEqual({ own: ['C1', 'C2'], other: ['X1'] })
  expect(mustRule(round1.findings, 'codex', 1)).toEqual({ own: ['X1'], other: ['C1', 'C2'] })
  expect(mustRule(round1.findings, 'codex', 2)).toEqual({ own: [], other: [] })
})

test('a ruling agreed by the other side wins, at its severity when it sets one', () => {
  const { findings, changed } = applyRound(round1.findings, {
    phase: 1,
    round: 2,
    replies: {
      claude: reply([], [rule('C1', 'agree'), rule('C2', 'agree'), rule('X1', 'agree', { severity: 'high' })]),
      codex: reply([], [rule('X1', 'agree'), rule('C1', 'agree'), rule('C2', 'agree')]),
    },
  })

  expect(changed).toBe(true)
  expect(status(findings)).toEqual({ C1: 'agreed', C2: 'agreed', X1: 'agreed' })
  expect(findings.map((f) => f.severity)).toEqual(['medium', 'medium', 'high'])
  expect(findings[2]!.rulings).toEqual([
    { ...rule('X1', 'agree'), side: 'codex', round: 2 },
    { ...rule('X1', 'agree', { severity: 'high' }), side: 'claude', round: 2 },
  ])
  expect(findings.every(isConfirmed)).toBe(true)
  expect(stopReason(findings, { phase: 1, round: 2, changed, maxRounds: 5 })).toBe('consensus')
})

test('a severity on an agree with your own finding leaves its severity as reported', () => {
  const { findings } = applyRound(round1.findings, {
    phase: 1,
    round: 2,
    replies: {
      claude: reply([], [rule('C1', 'agree'), rule('C2', 'agree'), rule('X1', 'agree')]),
      codex: reply([], [rule('X1', 'agree', { severity: 'high' }), rule('C1', 'agree'), rule('C2', 'agree')]),
    },
  })

  expect(findings[2]).toMatchObject({ id: 'X1', status: 'agreed', severity: 'medium' })
})

test('a reporter withdraw beats an agree from the other side in the same round', () => {
  const { findings } = applyRound(round1.findings, {
    phase: 1,
    round: 2,
    replies: {
      claude: reply([], [rule('C1', 'withdraw'), rule('C2', 'agree'), rule('X1', 'agree')]),
      codex: reply([], [rule('X1', 'agree'), rule('C1', 'agree'), rule('C2', 'agree')]),
    },
  })

  expect(status(findings)).toEqual({ C1: 'withdrawn', C2: 'agreed', X1: 'agreed' })
  expect(isConfirmed(findings[0]!)).toBe(false)
})

test('a finding disputed in round 2 and again in round 3 needs a probe', () => {
  const round2 = applyRound(round1.findings, {
    phase: 1,
    round: 2,
    replies: {
      claude: reply([reported('c')], [rule('C1', 'agree'), rule('C2', 'withdraw'), rule('X1', 'agree')]),
      codex: reply([], [rule('X1', 'agree'), rule('C1', 'dispute'), rule('C2', 'dispute')]),
    },
  })
  expect(status(round2.findings)).toEqual({ C1: 'disputed', C2: 'withdrawn', X1: 'agreed', C3: 'open' })
  expect(round2.findings[0]!.disputes).toBe(1)
  expect(mustRule(round2.findings, 'codex', 1)).toEqual({ own: [], other: ['C1', 'C3'] })
  expect(stopReason(round2.findings, { phase: 1, round: 2, changed: round2.changed, maxRounds: 5 })).toBeUndefined()

  const round3 = applyRound(round2.findings, {
    phase: 1,
    round: 3,
    replies: {
      claude: reply([], [rule('C1', 'agree'), rule('C3', 'agree')]),
      codex: reply([], [rule('C1', 'dispute'), rule('C3', 'dispute')]),
    },
  })

  expect(status(round3.findings)).toEqual({ C1: 'needs-probe', C2: 'withdrawn', X1: 'agreed', C3: 'disputed' })
  expect(round3.findings[0]!.disputes).toBe(2)
  expect(round3.findings[0]!.rulings.map((r) => `${r.side} ${r.ruling} ${r.round}`)).toEqual([
    'claude agree 2',
    'codex dispute 2',
    'claude agree 3',
    'codex dispute 3',
  ])
  expect(stopReason(round3.findings, { phase: 1, round: 3, changed: round3.changed, maxRounds: 3 })).toBe('max-rounds')
  expect(stopReason(round3.findings, { phase: 1, round: 3, changed: round3.changed, maxRounds: 4 })).toBeUndefined()
})

test('applying a round leaves its inputs as they were', () => {
  const before = JSON.stringify(round1.findings)
  applyRound(round1.findings, {
    phase: 1,
    round: 2,
    replies: {
      claude: reply([reported('c')], [rule('C1', 'agree'), rule('C2', 'agree'), rule('X1', 'dispute')]),
      codex: reply([], [rule('X1', 'agree'), rule('C1', 'agree'), rule('C2', 'agree')]),
    },
  })

  expect(JSON.stringify(round1.findings)).toBe(before)
})

test('the stop is consensus before stalled, and stalled before max-rounds', () => {
  const open = round1.findings

  expect(stopReason(open, { phase: 1, round: 5, changed: false, maxRounds: 5 })).toBe('stalled')
  expect(stopReason(open, { phase: 1, round: 5, changed: true, maxRounds: 5 })).toBe('max-rounds')
  expect(stopReason(open, { phase: 2, round: 5, changed: false, maxRounds: 5 })).toBe('consensus')
})

test('ids continue across rounds and phases, and a fix phase rules only on its own findings', () => {
  const phase1 = applyRound(round1.findings, {
    phase: 1,
    round: 2,
    replies: {
      claude: reply([], [rule('C1', 'agree'), rule('C2', 'agree'), rule('X1', 'agree')]),
      codex: reply([], [rule('X1', 'agree'), rule('C1', 'agree'), rule('C2', 'agree')]),
    },
  }).findings
  const phase2 = applyRound(phase1, {
    phase: 2,
    round: 1,
    replies: {
      claude: reply([reported('a', { of: 'X1' }), reported('old', { preexisting: true })]),
      codex: reply([reported('a', { of: 'C1' })]),
    },
  })

  expect(phase2.findings.slice(3).map((f) => [f.id, f.phase, f.status, f.of])).toEqual([
    ['C3', 2, 'open', 'X1'],
    ['C4', 2, 'preexisting', undefined],
    ['X2', 2, 'open', 'C1'],
  ])
  expect(mustRule(phase2.findings, 'claude', 2)).toEqual({ own: ['C3'], other: ['X2'] })
})

test('preexisting findings are never ruled on and never keep the loop going', () => {
  const { findings, changed } = applyRound([], {
    phase: 2,
    round: 1,
    replies: { claude: reply([reported('old', { preexisting: true })]), codex: reply() },
  })

  expect(status(findings)).toEqual({ C1: 'preexisting' })
  expect(changed).toBe(false)
  expect(mustRule(findings, 'codex', 2)).toEqual({ own: [], other: [] })
  expect(stopReason(findings, { phase: 2, round: 1, changed, maxRounds: 5 })).toBe('consensus')
})

test('a probe settles only a finding that needs one', () => {
  const probed: Finding = { ...round1.findings[0]!, status: 'needs-probe', disputes: 2 }
  const settled = settle([probed, round1.findings[1]!], 'C1', 'confirmed', 'the test fails')

  expect(settled[0]).toEqual({ ...probed, status: 'confirmed', settled: { outcome: 'confirmed', evidence: 'the test fails' } })
  expect(probed.status).toBe('needs-probe')
  expect(isConfirmed(settled[0]!)).toBe(true)
  expect(isConfirmed(settle([probed], 'C1', 'refuted', 'the caller checks it')[0]!)).toBe(false)
  expect(() => settle(settled, 'C2', 'refuted', 'no')).toThrow('C2 is open, not needs-probe: only a disputed finding can be settled.')
  expect(() => settle(settled, 'C9', 'refuted', 'no')).toThrow('There is no finding C9.')
})

test('a selected finding is fixed, still present, or unresolved by the findings of the fix phase', () => {
  const of = (id: string, ofId: string, change: Partial<Finding>): Finding => ({
    ...round1.findings[0]!,
    ...change,
    id,
    of: ofId,
    phase: 2,
  })
  const findings = [
    ...round1.findings,
    of('C3', 'C1', { status: 'agreed' }),
    of('X2', 'C1', { status: 'withdrawn' }),
    of('C4', 'C2', { status: 'withdrawn' }),
    of('X3', 'C2', { status: 'refuted' }),
    of('C5', 'X1', { status: 'confirmed' }),
    of('X4', 'C9', { status: 'inconclusive' }),
  ]
  const selected = ['C1', 'C2', 'X1', 'C9', 'C8']

  expect(fixOutcomes(findings, { phase: 2, selected, isComplete: true })).toEqual({
    C1: 'still-present',
    C2: 'fixed',
    X1: 'still-present',
    C9: 'unresolved',
    C8: 'fixed',
  })
  expect(fixOutcomes(findings, { phase: 2, selected, isComplete: false })).toEqual({
    C1: 'still-present',
    C2: 'unresolved',
    X1: 'still-present',
    C9: 'unresolved',
    C8: 'unresolved',
  })
  expect(fixOutcomes(findings, { phase: 3, selected: ['C1'], isComplete: true })).toEqual({ C1: 'fixed' })
})

test('findings a same mark links are one issue, in the order raised', () => {
  const ids = (groups: Finding[][]) => groups.map((g) => g.map((f) => f.id))
  const ruled = (claude: Ruling[], codex: Ruling[]) =>
    applyRound(round1.findings, { phase: 1, round: 2, replies: { claude: reply([], claude), codex: reply([], codex) } }).findings
  const agreeAll = [rule('C1', 'agree'), rule('C2', 'agree')]

  const linked = ruled([...agreeAll, rule('X1', 'agree', { same: 'C1' })], [rule('X1', 'agree'), rule('C1', 'agree'), rule('C2', 'agree')])
  expect(ids(issues(linked.filter(isConfirmed)))).toEqual([['C1', 'X1'], ['C2']])
  expect(linked.find((f) => f.id === 'X1')!.rulings.map((r) => r.same)).toContain('C1')

  const chained = ruled([...agreeAll, rule('X1', 'agree', { same: 'C1' })], [rule('X1', 'agree'), rule('C1', 'agree'), rule('C2', 'agree', { same: 'X1' })])
  expect(ids(issues(chained.filter(isConfirmed)))).toEqual([['C1'], ['C2', 'X1']])
})

test('a group has at most one finding per side', () => {
  const { findings } = applyRound(round1.findings, {
    phase: 1,
    round: 2,
    replies: {
      claude: reply([], [rule('C1', 'agree'), rule('C2', 'agree'), rule('X1', 'agree')]),
      codex: reply([], [rule('X1', 'agree'), rule('C1', 'agree', { same: 'X1' }), rule('C2', 'agree', { same: 'X1' })]),
    },
  })

  expect(issues(findings.filter(isConfirmed)).map((g) => g.map((f) => f.id))).toEqual([['C1', 'X1'], ['C2']])
})

test('a same mark links only confirmed findings', () => {
  const { findings } = applyRound(round1.findings, {
    phase: 1,
    round: 2,
    replies: {
      claude: reply([], [rule('C1', 'agree'), rule('C2', 'agree'), rule('X1', 'agree', { same: 'C1' })]),
      codex: reply([], [rule('X1', 'agree'), rule('C1', 'dispute'), rule('C2', 'agree')]),
    },
  })

  expect(issues(findings.filter(isConfirmed)).map((g) => g.map((f) => f.id))).toEqual([['C2'], ['X1']])
})

test('a fix-phase finding joins the issue of the finding in its `of`', () => {
  const agreed = (f: Finding, change: Partial<Finding> = {}): Finding => ({ ...f, status: 'agreed', ...change })
  const [c1, c2, x1] = round1.findings
  const phase2 = (id: string, side: 'claude' | 'codex', change: Partial<Finding>): Finding =>
    agreed({ ...c1!, id, side, phase: 2 }, change)
  const findings = [
    agreed(c1!),
    agreed(c2!),
    agreed(x1!, { rulings: [{ ...rule('X1', 'agree', { same: 'C1' }), side: 'claude', round: 2 }] }),
    phase2('C3', 'claude', { of: 'C1' }),
    phase2('X2', 'codex', { of: 'C1' }),
    phase2('X3', 'codex', { rulings: [{ ...rule('X3', 'agree', { same: 'C3' }), side: 'claude', round: 2 }] }),
  ]

  expect(issues(findings).map((g) => g.map((f) => f.id))).toEqual([['C1', 'X1', 'C3', 'X2', 'X3'], ['C2']])
})

// Design mode: round 1 raises C1 and X1; in round 2 each is agreed by its other side.
const designRound2 = applyRound(round1.findings.filter((f) => f.id !== 'C2'), {
  phase: 1,
  round: 2,
  isDesign: true,
  replies: { claude: reply([], [rule('C1', 'agree'), rule('X1', 'agree')]), codex: reply([], [rule('X1', 'agree'), rule('C1', 'agree')]) },
})
const stepOf = (changed: boolean) => ({ phase: 1, round: 3, changed, maxRounds: 5, isDesign: true })

test('an agreed point of a design is ruled on again', () => {
  expect(status(designRound2.findings)).toEqual({ C1: 'agreed', X1: 'agreed' })
  expect(mustRule(designRound2.findings, 'claude', 1, true)).toEqual({ own: ['C1'], other: ['X1'] })
  expect(mustRule(designRound2.findings, 'claude', 1)).toEqual({ own: [], other: [] })
})

test('a second dispute keeps a point of a design disputed', () => {
  const dispute = (findings: Finding[], round: number) =>
    applyRound(findings, { phase: 1, round, isDesign: true, replies: { claude: reply([], [rule('C1', 'agree')]), codex: reply([], [rule('C1', 'dispute')]) } }).findings
  const twice = dispute(dispute(round1.findings, 2), 3)

  expect(twice.find((f) => f.id === 'C1')).toMatchObject({ status: 'disputed', disputes: 2 })
})

test('a round of a design in which only agreed and disputed points keep their status stalls', () => {
  const disputed = applyRound(round1.findings, {
    phase: 1,
    round: 2,
    isDesign: true,
    replies: { claude: reply([], [rule('C1', 'agree'), rule('C2', 'agree'), rule('X1', 'agree')]), codex: reply([], [rule('X1', 'agree'), rule('C1', 'agree'), rule('C2', 'dispute')]) },
  })
  const again = applyRound(disputed.findings, {
    phase: 1,
    round: 3,
    isDesign: true,
    replies: { claude: reply([], [rule('C1', 'agree'), rule('C2', 'agree'), rule('X1', 'agree')]), codex: reply([], [rule('X1', 'agree'), rule('C1', 'agree'), rule('C2', 'dispute')]) },
  })

  expect(status(disputed.findings)).toEqual({ C1: 'agreed', C2: 'disputed', X1: 'agreed' })
  expect(again.changed).toBe(false)
  expect(stopReason(again.findings, stepOf(again.changed))).toBe('stalled')
})

test('a design has no consensus while a point is agreed, and has it once every point is withdrawn', () => {
  expect(stopReason(designRound2.findings, stepOf(true))).toBeUndefined()

  const withdrawn = applyRound(designRound2.findings, {
    phase: 1,
    round: 3,
    isDesign: true,
    replies: { claude: reply([], [rule('C1', 'withdraw'), rule('X1', 'dispute')]), codex: reply([], [rule('X1', 'withdraw'), rule('C1', 'dispute')]) },
  })

  expect(status(withdrawn.findings)).toEqual({ C1: 'withdrawn', X1: 'withdrawn' })
  expect(stopReason(withdrawn.findings, stepOf(withdrawn.changed))).toBe('consensus')
})

test('in a design, a withdrawn point is resolved only when the other side does not agree with it in that round', () => {
  const ruled = (theirs: Ruling[]) =>
    applyRound(designRound2.findings, { phase: 1, round: 3, isDesign: true, replies: { claude: reply([], [rule('C1', 'withdraw'), rule('X1', 'agree')]), codex: reply([], theirs) } })
  const disputes = ruled([rule('X1', 'agree'), rule('C1', 'dispute')])
  const agrees = ruled([rule('X1', 'agree'), rule('C1', 'agree')])
  const silent = ruled([rule('X1', 'agree')])

  expect(status(disputes.findings)).toMatchObject({ C1: 'withdrawn' })
  expect(status(silent.findings)).toMatchObject({ C1: 'withdrawn' })
  expect(status(agrees.findings)).toMatchObject({ C1: 'disputed' })
  expect(agrees.findings.find(f => f.id === 'C1')!.rulings.map(r => r.ruling)).toEqual(['agree', 'agree', 'withdraw', 'agree'])
  expect(stopReason(agrees.findings, stepOf(agrees.changed))).toBeUndefined()
})

// A question: round 1 gives Claude's answer C1 and Codex's answer X1.
const answers1 = applyRound([], { phase: 0, round: 1, isDesign: true, isAsk: true, replies: { claude: reply([reported('a')]), codex: reply([reported('z')]) } })
const askRound = (findings: Finding[], round: number, claude: Ruling[], codex: Ruling[]) =>
  applyRound(findings, { phase: 0, round, isDesign: true, isAsk: true, replies: { claude: reply([], claude), codex: reply([], codex) } })
const askStop = (result: { findings: Finding[]; changed: boolean }, round: number) =>
  stopReason(result.findings, { phase: 0, round, changed: result.changed, maxRounds: 8, isDesign: true, isAsk: true })

test('an answer both sides agree with is consensus', () => {
  const adopted = askRound(answers1.findings, 2, [rule('C1', 'agree'), rule('X1', 'dispute')], [rule('X1', 'withdraw'), rule('C1', 'agree')])

  expect(status(adopted.findings)).toEqual({ C1: 'agreed', X1: 'withdrawn' })
  expect(askStop(adopted, 2)).toBe('consensus')
})

test('two answers joined by same are consensus', () => {
  const same = askRound(answers1.findings, 2, [rule('C1', 'agree'), rule('X1', 'agree', { same: 'C1' })], [rule('X1', 'agree'), rule('C1', 'agree')])

  expect(status(same.findings)).toEqual({ C1: 'agreed', X1: 'agreed' })
  expect(askStop(same, 2)).toBe('consensus')
})

test('answers adopted crosswise are both disputed, and the round counts as a change', () => {
  const crosswise = askRound(answers1.findings, 2, [rule('C1', 'withdraw'), rule('X1', 'agree')], [rule('X1', 'withdraw'), rule('C1', 'agree')])

  expect(status(crosswise.findings)).toEqual({ C1: 'disputed', X1: 'disputed' })
  expect(crosswise.changed).toBe(true)
  expect(askStop(crosswise, 2)).toBeUndefined()
})

test('a crosswise swap from two disputed answers is a change', () => {
  const disputed = askRound(answers1.findings, 2, [rule('C1', 'agree'), rule('X1', 'dispute')], [rule('X1', 'agree'), rule('C1', 'dispute')])
  const swapped = askRound(disputed.findings, 3, [rule('C1', 'withdraw'), rule('X1', 'agree')], [rule('X1', 'withdraw'), rule('C1', 'agree')])

  expect(status(disputed.findings)).toEqual({ C1: 'disputed', X1: 'disputed' })
  expect(status(swapped.findings)).toEqual({ C1: 'disputed', X1: 'disputed' })
  expect(swapped.changed).toBe(true)
  expect(askStop(swapped, 3)).toBeUndefined()
})

test('a round of a question in which no answer moves stalls, and max-rounds comes after', () => {
  const disputed = askRound(answers1.findings, 2, [rule('C1', 'agree'), rule('X1', 'dispute')], [rule('X1', 'agree'), rule('C1', 'dispute')])
  const again = askRound(disputed.findings, 3, [rule('C1', 'agree'), rule('X1', 'dispute')], [rule('X1', 'agree'), rule('C1', 'dispute')])

  expect(again.changed).toBe(false)
  expect(askStop(again, 3)).toBe('stalled')
  expect(stopReason(disputed.findings, { phase: 0, round: 2, changed: disputed.changed, maxRounds: 2, isDesign: true, isAsk: true })).toBe('max-rounds')
})
