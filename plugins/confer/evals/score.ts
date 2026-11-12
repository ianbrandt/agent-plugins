// Scores the --findings report of a review, a plan review, or a question, or the interview that drafts a plan, against a case. Erasable TypeScript only, so Node can strip the types.
type CaseFinding = { path: string; line: number | null; defect?: string }
export type Case = { id: string; findings: CaseFinding[] }
type Entry = { id: string; path: string; line?: number | null; evidence?: string; fix?: string; same?: Entry[] }
type Side = { requested?: unknown; resolvedModels?: unknown; costUsd?: number | null; tokens?: unknown }
export type Report = {
  outcome?: string
  phases?: { rounds: number; stop?: string }[]
  confirmed?: Entry[]
  unresolved?: Entry[]
  refuted?: Entry[]
  withdrawn?: Entry[]
  preexisting?: Entry[]
  singleReviewer?: Record<string, Entry[]>
  sides?: { claude: Side; codex: Side }
}

const maxLineGap = 3
const norm = (p: string) => p.replace(/\\/g, '/').replace(/^\.\//, '')
const samePath = (reported: string, wanted: string) => {
  const r = norm(reported)
  return r === wanted || r.endsWith(`/${wanted}`)
}
const locations = (e: Entry): Entry[] => [e, ...(e.same ?? [])]
const gap = (a: Entry, f: CaseFinding) => (a.line == null || f.line == null ? 0 : Math.abs(a.line - f.line))
const matches = (e: Entry, f: CaseFinding) => locations(e).some(l => samePath(l.path, f.path) && gap(l, f) <= maxLineGap)
const distance = (e: Entry, f: CaseFinding) => Math.min(...locations(e).filter(l => samePath(l.path, f.path)).map(l => gap(l, f)))

export function score(c: Case, report: Report) {
  const reportedEntries = report.confirmed ?? []
  const candidates = reportedEntries.map(e =>
    c.findings.flatMap((f, i) => (matches(e, f) ? [{ i, d: distance(e, f) }] : [])).sort((a, b) => a.d - b.d).map(x => x.i),
  )
  const owner: number[] = c.findings.map(() => -1)
  const augment = (r: number, seen: Set<number>): boolean => {
    for (const i of candidates[r]!) {
      if (seen.has(i)) continue
      seen.add(i)
      if (owner[i] === -1 || augment(owner[i]!, seen)) {
        owner[i] = r
        return true
      }
    }
    return false
  }
  for (let r = 0; r < reportedEntries.length; r++) augment(r, new Set())

  const defectOf = (i: number) => c.findings[i]!.defect ?? `#${i}`
  const defects = new Set(c.findings.map((_, i) => defectOf(i)))
  const found = new Set(owner.flatMap((r, i) => (r === -1 ? [] : [defectOf(i)])))
  const matched = new Set(owner.filter(r => r !== -1))
  const all = [
    ...reportedEntries, ...(report.unresolved ?? []), ...(report.refuted ?? []), ...(report.withdrawn ?? []), ...(report.preexisting ?? []),
    ...Object.values(report.singleReviewer ?? {}).flat(),
  ]
  const raised = new Set(c.findings.flatMap((f, i) => (all.some(e => matches(e, f)) ? [defectOf(i)] : [])))
  const reported = reportedEntries.length
  return {
    reported,
    truePositives: matched.size,
    defects: defects.size,
    found: found.size,
    raised: raised.size,
    precision: reported === 0 ? null : matched.size / reported,
    recall: defects.size === 0 ? null : found.size / defects.size,
    missed: c.findings.flatMap((f, i) => (owner[i] === -1 ? [f.line] : [])),
    unmatched: reportedEntries.flatMap((e, r) => (matched.has(r) ? [] : [e.id])),
  }
}

// A design point has a section heading in `path` and no line, so a gap is raised by a point when the point's evidence or fix matches one of the gap's terms.
// shortcut: a term can match a point about something else; read the unmatched and missed lists when a score looks off.
type Gap = { defect: string; terms: string[] }
export type DesignCase = { id: string; gaps: Gap[] }
const text = (e: Entry) => locations(e).map(l => `${l.evidence ?? ''}\n${l.fix ?? ''}`).join('\n')
const raises = (e: Entry, g: Gap) => g.terms.some(t => new RegExp(t, 'i').test(text(e)))

export function scoreDesign(c: DesignCase, report: Report) {
  // Confirmed and unresolved points are still in the final version; a withdrawn one was resolved by a revision or conceded.
  const open = [...(report.confirmed ?? []), ...(report.unresolved ?? [])]
  const points = [...open, ...(report.withdrawn ?? []), ...(report.refuted ?? []), ...(report.preexisting ?? []), ...Object.values(report.singleReviewer ?? {}).flat()]
  const raisedBy = (pool: Entry[]) => c.gaps.filter(g => pool.some(e => raises(e, g))).map(g => g.defect)
  const raised = raisedBy(points)
  return {
    points: points.length,
    defects: c.gaps.length,
    raised: raised.length,
    recall: c.gaps.length === 0 ? null : raised.length / c.gaps.length,
    // An unfinished run's points are single-reviewer, and the design may never have been revised.
    stillOpen: report.singleReviewer === undefined ? raisedBy(open) : null,
    missed: c.gaps.flatMap(g => (raised.includes(g.defect) ? [] : [g.defect])),
    unmatched: points.flatMap(e => (c.gaps.some(g => raises(e, g)) ? [] : [e.id])),
  }
}

// An answer of an ask run raises a point when its answer, reasons, or a ruling's evidence matches one of the point's terms.
type Point = { point: string; terms: string[] }
export type AskCase = { id: string; question: string; points: Point[] }
type Answer = { id: string; answer?: string; reasons?: string; rulings?: { evidence?: string }[]; same?: Answer[] }
export type AskReport = Omit<Report, 'confirmed' | 'unresolved' | 'withdrawn' | 'singleReviewer'> & {
  confirmed?: Answer[]
  unresolved?: Answer[]
  withdrawn?: Answer[]
  singleReviewer?: Record<string, Answer[]>
}
const answersOf = (a: Answer): Answer[] => [a, ...(a.same ?? [])]
const says = (pool: Answer[], p: Point, withRulings: boolean) =>
  pool.flatMap(answersOf).some(a => p.terms.some(t => new RegExp(t, 'i').test([a.answer, a.reasons, ...(withRulings ? (a.rulings ?? []).map(r => r.evidence) : [])].join('\n'))))

export function scoreAsk(c: AskCase, report: AskReport) {
  const confirmed = report.confirmed ?? []
  // The agreed answer, or else the answers each side stood by at the end.
  const final = confirmed.length > 0 ? confirmed : (report.unresolved ?? [])
  const all = [...confirmed, ...(report.unresolved ?? []), ...(report.withdrawn ?? []), ...Object.values(report.singleReviewer ?? {}).flat()]
  const raised = c.points.filter(p => says(all, p, true)).map(p => p.point)
  return {
    agreed: report.phases?.[0]?.stop === 'consensus' && confirmed.length > 0,
    // An answer a side adopted is listed under that side too.
    answers: new Set(all.flatMap(answersOf).map(a => a.id)).size,
    points: c.points.length,
    // An unfinished run's answers are single-reviewer, so it has no final answer.
    inFinal: report.singleReviewer === undefined ? c.points.filter(p => says(final, p, false)).map(p => p.point) : null,
    raised,
    missed: c.points.flatMap(p => (raised.includes(p.point) ? [] : [p.point])),
  }
}

const parse = (line: string): any => {
  try {
    return JSON.parse(line)
  } catch {
    return undefined
  }
}

// The conductor's cost and model, and the permission denials of every turn: each turn of a multi-turn run ends with its own result.
export function session(log: string) {
  const events = log.split('\n').map(parse).filter(Boolean)
  const results = events.filter(e => e.type === 'result')
  return {
    conductor: events.find(e => e.type === 'system' && e.subtype === 'init')?.model,
    sessionUsd: results.at(-1)?.total_cost_usd,
    permissionDenials: results.reduce((n, r) => n + (r.permission_denials?.length ?? 0), 0),
  }
}

export function row<C extends { id: string }, R extends Pick<Report, 'outcome' | 'phases' | 'sides'>>(c: C, tier: string, report: R | undefined, log: string, paths: { findings: string; log: string }, scorer: (c: C, report: R) => object) {
  if (report === undefined) return { case: c.id, tier, error: 'no findings file', log: paths.log }
  const side = (s: Side | undefined) => ({ requested: s?.requested, resolvedModels: s?.resolvedModels, costUsd: s?.costUsd, tokens: s?.tokens })
  return {
    case: c.id,
    tier,
    outcome: report.outcome,
    ...scorer(c, report),
    rounds: report.phases?.[0]?.rounds,
    stop: report.phases?.[0]?.stop,
    ...session(log),
    claude: side(report.sides?.claude),
    codex: side(report.sides?.codex),
    findings: paths.findings,
    log: paths.log,
  }
}

// An interview is scored on the questions the conductor asked, the assumptions it listed, and the file it wrote, all by regular expressions.
type Terms = { terms: string[] }
type Scripted = Terms & { question: string; answer: string }
export type InterviewCase = {
  id: string
  goal: string
  file: string
  constraints: (Terms & { constraint: string })[]
  questions: Scripted[]
  needless: (Terms & { question: string })[]
  sections: (Terms & { section: string })[]
}
type Choice = { question: string; header?: string; options: { label: string }[] }
const hits = (t: Terms, text: string) => t.terms.some(term => new RegExp(term, 'i').test(text))

export const scripted = (c: InterviewCase, question: string) => c.questions.find(q => hits(q, question))
export const recommended = (q: Pick<Choice, 'options'>) => (q.options.find(o => o.label.includes('(Recommended)')) ?? q.options[0])?.label
// shortcut: a plain-text question with its subject on another line than its "?" is counted as other; match blocks instead if a case shows it.
export const questionsIn = (text: string) => text.split('\n').filter(l => l.includes('?'))

export function scoreInterview(c: InterviewCase, file: string | undefined, log: string) {
  // A subagent's events have a parent_tool_use_id.
  const blocks = log.split('\n').map(parse).filter(e => e?.type === 'assistant' && e.parent_tool_use_id == null).flatMap(e => e.message?.content ?? [])
  const texts: string[] = blocks.filter((b: any) => b.type === 'text').map((b: any) => b.text)
  const choices: Choice[] = blocks.filter((b: any) => b.type === 'tool_use' && b.name === 'AskUserQuestion').flatMap((b: any) => b.input?.questions ?? [])
  const asked = [...choices.map(q => `${q.question}\n${q.header ?? ''}`), ...texts.flatMap(questionsIn)]
  const item = /^\s*(?:[-*]|\d+\.)\s/
  const lists = [...texts, ...choices.map(q => q.question)].filter(t => /assum/i.test(t) && t.split('\n').filter(l => item.test(l)).length >= 2)
  const items = lists.flatMap(t => t.split('\n').filter(l => item.test(l)))
  const headings = [...(file ?? '').matchAll(/^#{1,6}\s+(.*)$/gm)].map(m => m[1]!)
  const found = c.sections.filter(s => headings.some(h => hits(s, h)))
  const matched = <T extends Terms>(pool: T[], texts: string[]) => pool.filter(t => texts.some(x => hits(t, x)))
  return {
    questions: asked.length,
    asked: matched(c.questions, asked).map(q => q.question),
    unasked: c.questions.filter(q => !asked.some(x => hits(q, x))).map(q => q.question),
    needless: matched(c.needless, asked).map(q => q.question),
    other: asked.filter(x => ![...c.questions, ...c.needless].some(q => hits(q, x))).length,
    assumptions: lists.length > 0,
    assumed: matched(c.constraints, items).map(k => k.constraint),
    inFile: file === undefined ? [] : matched(c.constraints, [file]).map(k => k.constraint),
    written: file !== undefined,
    sections: found.map(s => s.section),
    missingSections: c.sections.filter(s => !found.includes(s)).map(s => s.section),
    started: blocks.some((b: any) => b.type === 'tool_use' && b.name === 'mcp__confer__plan_start' && String(b.input?.args ?? '').includes(c.file)),
  }
}
