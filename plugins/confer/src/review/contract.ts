import type { Reply, ReportedFinding, Ruling, RulingKind, Severity, Verdict } from './types'

export type ReplyExpectation = {
  isFirstRound: boolean // round 1 of the review, or the first round of a fix phase
  isFixPhase: boolean
  // Prefixed ids of the findings this reviewer must rule on this round, split by who reported them.
  own: string[]
  other: string[]
  // Every finding of this phase, split the same way: the ids `same` may name.
  known: { own: string[]; other: string[] }
  // A fix phase: the findings it was asked to fix and the rest of their issues, the only ids `of` may name.
  selected: string[]
  // A question: each reply gives answers, stored as findings, and stands by exactly one.
  isAsk?: boolean
}

type Json = Record<string, unknown>

class Invalid extends Error {}

const verdicts: readonly Verdict[] = ['APPROVED', 'REVISE', 'BLOCKED']
const severities: readonly Severity[] = ['high', 'medium', 'low']
const kinds: readonly RulingKind[] = ['agree', 'dispute', 'withdraw']

const or = (words: readonly string[]) => `${words.slice(0, -1).join(', ')}, or ${words.at(-1)}`
const and = (words: readonly string[]) => (words.length < 3 ? words.join(' and ') : `${words.slice(0, -1).join(', ')}, and ${words.at(-1)}`)
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

export function parseReply(text: string, expectation: ReplyExpectation): { reply: Reply } | { error: string } {
  try {
    return { reply: validate(extract(text), expectation) }
  } catch (e) {
    if (e instanceof Invalid) return { error: e.message }
    throw e
  }
}

function extract(text: string): Json {
  const trimmed = text.trim()
  if (trimmed.startsWith('{')) return parse(trimmed)
  const blocks = fencedBlocks(trimmed)
  if (blocks.length === 0) throw new Invalid('The reply has no JSON object: send one as the whole reply or in one ```json block.')
  if (blocks.length > 1) throw new Invalid(`The reply has ${blocks.length} JSON blocks: send exactly one.`)
  return parse(blocks[0]!)
}

function parse(json: string): Json {
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch (e) {
    throw new Invalid(`The reply is not valid JSON: ${(e as Error).message}`)
  }
  if (!isObject(value)) throw new Invalid('The reply must be one JSON object.')
  return value
}

// Bodies of the ```json and bare fences; other fences, such as a quoted ```ts snippet, are skipped.
function fencedBlocks(text: string): string[] {
  const blocks: string[] = []
  let open: { lang: string; lines: string[] } | undefined
  for (const line of text.split(/\r?\n/)) {
    const fence = /^\s*```\s*(\S*)\s*$/.exec(line)
    if (open === undefined) {
      if (fence) open = { lang: fence[1]!.toLowerCase(), lines: [] }
    } else if (fence?.[1] === '') {
      if (open.lang === '' || open.lang === 'json') blocks.push(open.lines.join('\n'))
      open = undefined
    } else {
      open.lines.push(line)
    }
  }
  return blocks
}

function validate(value: Json, expectation: ReplyExpectation): Reply {
  if (expectation.isAsk) return validateAsk(value, expectation)
  const verdict = value.verdict === undefined && !expectation.isFirstRound ? undefined : oneOf(value.verdict, 'verdict', verdicts)
  const summary = value.summary === undefined && !expectation.isFirstRound ? undefined : text(value.summary, 'summary')
  const findings = list(value.findings, 'findings').map((f, i) => finding(f, `findings[${i}]`, expectation))
  const coverage = strings(value.coverage, 'coverage')
  const limitations = strings(value.limitations, 'limitations')

  const ids = new Set<string>()
  for (const { id } of findings) {
    if (ids.has(id)) throw new Invalid(`findings has two findings with the id "${id}": ids must be unique.`)
    ids.add(id)
  }
  if (verdict === 'BLOCKED' && limitations.length === 0) throw new Invalid('BLOCKED needs at least one limitation that explains it.')

  let rulings: Ruling[]
  if (expectation.isFirstRound) {
    if (list(value.rulings, 'rulings').length > 0) throw new Invalid('rulings must be empty in a first round.')
    rulings = []
    const material = findings.some((f) => f.severity !== 'low')
    if (verdict === 'APPROVED' && material) throw new Invalid('APPROVED cannot have a high or medium finding.')
    if (verdict === 'REVISE' && !material) throw new Invalid('REVISE needs at least one high or medium finding.')
    if (verdict !== 'BLOCKED' && coverage.length === 0) throw new Invalid('coverage must list what was inspected.')
  } else {
    rulings = checkRulings(value.rulings, expectation)
  }

  return {
    ...(verdict !== undefined && { verdict }),
    ...(summary !== undefined && { summary }),
    findings,
    rulings,
    coverage,
    limitations,
  }
}

function validateAsk(value: Json, expectation: ReplyExpectation): Reply {
  if (value.verdict !== undefined) throw new Invalid('verdict is not part of an answer: leave it out.')
  if (value.findings !== undefined) throw new Invalid('findings is not part of an answer: give your answer in answers.')
  const findings = list(value.answers, 'answers').map((a, i) => answer(a, `answers[${i}]`))
  const coverage = strings(value.coverage, 'coverage')
  const limitations = strings(value.limitations, 'limitations')
  if (expectation.isFirstRound) {
    if (list(value.rulings, 'rulings').length > 0) throw new Invalid('rulings must be empty in a first round.')
    if (findings.length !== 1) throw new Invalid(`answers has ${findings.length} answers: give exactly one in round 1.`)
    return { findings, rulings: [], coverage, limitations }
  }
  if (findings.length > 1) throw new Invalid(`answers has ${findings.length} answers: give at most one new answer.`)
  const rulings = checkRulings(value.rulings, expectation)
  const agreed = rulings.filter((r) => r.ruling === 'agree')
  const ids = new Set(agreed.map((r) => r.id))
  // An agree with one of yours and an agree with one of theirs that `same` joins are one answer. A second agree on either side is another answer.
  const isOne = (side: string[]) => agreed.filter((r) => side.includes(r.id)).length === 1
  const isJoined = isOne(expectation.own) && isOne(expectation.other) && agreed.some((r) => r.same !== undefined && ids.has(r.same))
  const count = ids.size + findings.length - (isJoined ? 1 : 0)
  if (count !== 1) {
    const stood = [...ids, ...findings.map((f) => `the new answer ${f.id}`)]
    const what = count === 0 ? 'no answer' : `${count} answers: ${and(stood)}`
    throw new Invalid(`You stand by ${what}. Stand by exactly one: agree with yours, agree with the other expert's and withdraw yours, or give one new answer and withdraw yours.`)
  }
  return { findings, rulings, coverage, limitations }
}

function answer(value: unknown, where: string): ReportedFinding {
  if (!isObject(value)) throw new Invalid(`${where} must be an object.`)
  return { id: text(value.id, `${where}.id`), severity: 'high', path: 'answer', evidence: text(value.reasons, `${where}.reasons`), fix: text(value.answer, `${where}.answer`) }
}

function finding(value: unknown, where: string, { isFixPhase, selected }: ReplyExpectation): ReportedFinding {
  if (!isObject(value)) throw new Invalid(`${where} must be an object.`)
  const { line, of, preexisting } = value
  if (line !== undefined && !(Number.isInteger(line) && (line as number) > 0)) throw new Invalid(`${where}.line must be a positive integer.`)
  if (!isFixPhase && of !== undefined) throw new Invalid(`${where}.of is allowed only in a fix phase.`)
  if (!isFixPhase && preexisting !== undefined) throw new Invalid(`${where}.preexisting is allowed only in a fix phase.`)
  if (preexisting !== undefined && typeof preexisting !== 'boolean') throw new Invalid(`${where}.preexisting must be true or false.`)
  if (of !== undefined && preexisting === true) throw new Invalid(`${where} cannot set both of and preexisting: a defect still present after the fix is not older than it.`)
  if (of !== undefined && !selected.includes(of as string)) {
    throw new Invalid(`${where}.of is "${String(of)}", but the fixes were asked to fix only ${and(selected)}: set of to one of those, or leave it out for a defect the fixes introduced.`)
  }
  return {
    id: text(value.id, `${where}.id`),
    severity: oneOf(value.severity, `${where}.severity`, severities),
    path: text(value.path, `${where}.path`),
    ...(line !== undefined && { line: line as number }),
    evidence: text(value.evidence, `${where}.evidence`),
    fix: text(value.fix, `${where}.fix`),
    ...(of !== undefined && { of: text(of, `${where}.of`) }),
    ...(preexisting !== undefined && { preexisting }),
  }
}

function checkRulings(value: unknown, { own, other, known, isAsk }: ReplyExpectation): Ruling[] {
  const [item, anItem, side] = isAsk ? ['answer', 'an answer', 'expert'] : ['finding', 'a finding', 'reviewer']
  const isOwn = new Map([...own.map((id) => [id, true] as const), ...other.map((id) => [id, false] as const)])
  const seen = new Set<string>()
  const rulings = list(value, 'rulings').map((r, i): Ruling => {
    const where = `rulings[${i}]`
    if (!isObject(r)) throw new Invalid(`${where} must be an object.`)
    const id = text(r.id, `${where}.id`)
    const mine = isOwn.get(id)
    if (mine === undefined) throw new Invalid(`${where} is for "${id}", which is not ${anItem} to rule on this round.`)
    if (seen.has(id)) throw new Invalid(`rulings has two rulings for "${id}".`)
    seen.add(id)
    const ruling = oneOf(r.ruling, `${where}.ruling`, kinds)
    if (mine && ruling === 'dispute') throw new Invalid(`${id} is your ${item}: rule agree to stand by it, or withdraw.`)
    if (!mine && ruling === 'withdraw') throw new Invalid(`${id} is the other ${side}'s ${item}: rule agree or dispute.`)
    const severity = r.severity === undefined ? undefined : oneOf(r.severity, `${where}.severity`, severities)
    // An agree with your own finding may restate a severity; only the other side's agree changes it.
    if (severity !== undefined && ruling !== 'agree') throw new Invalid(`${where}.severity is allowed only on an agree.`)
    const same = r.same === undefined ? undefined : text(r.same, `${where}.same`)
    if (same !== undefined && ruling !== 'agree') throw new Invalid(`${where}.same is allowed only on an agree.`)
    const ids = mine ? known.other : known.own
    if (same !== undefined && !ids.includes(same)) {
      throw new Invalid(`${where}.same is "${same}", which is not one of ${mine ? `the other ${side}'s` : 'your'} ${item}s${ids.length > 0 ? `: use ${ids.join(', ')}` : ''}.`)
    }
    return { id, ruling, ...(severity !== undefined && { severity }), ...(same !== undefined && { same }), evidence: text(r.evidence, `${where}.evidence`) }
  })
  const missing = [...isOwn.keys()].filter((id) => !seen.has(id))
  if (missing.length > 0) throw new Invalid(`rulings is missing a ruling for ${and(missing)}.`)
  return rulings
}

function list(value: unknown, where: string): unknown[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Invalid(`${where} must be a list.`)
  return value
}

function strings(value: unknown, where: string): string[] {
  const items = list(value, where)
  if (items.some((item) => typeof item !== 'string' || item.trim() === '')) throw new Invalid(`${where} must be a list of non-empty strings.`)
  return items as string[]
}

function text(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Invalid(`${where} must be a non-empty string.`)
  return value
}

function oneOf<T extends string>(value: unknown, where: string, options: readonly T[]): T {
  if (!options.includes(value as T)) throw new Invalid(`${where} must be ${or(options)}.`)
  return value as T
}
