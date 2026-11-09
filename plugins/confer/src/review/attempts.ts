import { askPrompt } from '../ask/brief'
import { designPrompt } from '../design/brief'
import { roundPrompt } from './brief'
import { isConfirmed, issues, mustRule } from './consensus'
import { parseReply } from './contract'
import type { Attempt, Phase, RunState } from './state'
import type { ReviewSide } from './types'

export const reviewerPrefix = 'confer:reviewer-'
export const phaseOf = (run: RunState) => run.phases.at(-1)!
export const description = (run: RunState, phase: Phase) => `Confer ${run.id} ${phase.number > 0 ? `fix ${phase.number} ` : ''}round ${phase.round}`

export function attemptsOf(run: RunState, side: ReviewSide, phase = phaseOf(run), round = phase.round): Attempt[] {
  return run.attempts.filter(a => a.phase === phase.number && a.round === round && a.side === side)
}
export const current = (run: RunState, side: ReviewSide) => attemptsOf(run, side).at(-1)
export const failures = (run: RunState, side: ReviewSide) => attemptsOf(run, side).filter(a => a.status === 'failed').length

export function fail(attempt: Attempt, failure: string): void {
  if (attempt.status !== 'waiting' && attempt.status !== 'running') return
  attempt.status = 'failed'
  attempt.failure = failure
}

export function newAttempt(run: RunState, side: ReviewSide): Attempt {
  const phase = phaseOf(run)
  const theirs = side === 'claude' ? 'codex' : 'claude'
  const previous = phase.round > 1 ? attemptsOf(run, theirs, phase, phase.round - 1).findLast(a => a.status === 'replied')?.raw : undefined
  // Only a reply that came back and was refused is explained; a crash or timeout has nothing to correct.
  const refused = attemptsOf(run, side).findLast(a => a.status === 'failed' && a.raw !== undefined)?.failure
  const attempt: Attempt = {
    phase: phase.number,
    round: phase.round,
    side,
    number: attemptsOf(run, side).length + 1,
    status: side === 'claude' ? 'waiting' : 'running',
    prompt: (run.ask !== undefined ? askPrompt : run.design === undefined ? roundPrompt : designPrompt)(run, side, previous, refused),
    model: phase[side].model,
    effort: phase[side].effort,
  }
  run.attempts.push(attempt)
  return attempt
}

const replyLimitBytes = 64 * 2 ** 10
const sizeOf = (text: string) => new TextEncoder().encode(text).length

// For an ask run, only the first 64 KiB of a reply is kept, cut at a character boundary, so a round adds at most about 256 KiB to state.json.
export function rawOf(run: RunState, text: string): string {
  if (run.ask === undefined || sizeOf(text) <= replyLimitBytes) return text
  const bytes = new TextEncoder().encode(text)
  let end = replyLimitBytes
  while ((bytes[end]! & 0xc0) === 0x80) end--
  return new TextDecoder().decode(bytes.subarray(0, end))
}

export function receive(run: RunState, attempt: Attempt, text: string): void {
  attempt.raw = rawOf(run, text)
  if (attempt.raw !== text) return fail(attempt, `The reply is ${Math.ceil(sizeOf(text) / 2 ** 10)} KiB, over the limit of ${replyLimitBytes / 2 ** 10} KiB.`)
  const isAsk = run.ask !== undefined
  const { own, other } = mustRule(run.findings, attempt.side, attempt.phase, run.design !== undefined || isAsk)
  const selected = run.phases.find(p => p.number === attempt.phase)?.selected ?? []
  const inPhase = run.findings.filter(f => f.phase === attempt.phase)
  const known = { own: inPhase.filter(f => f.side === attempt.side).map(f => f.id), other: inPhase.filter(f => f.side !== attempt.side).map(f => f.id) }
  // `of` may name any finding of a selected group, and counts against the group's selected id.
  const head = new Map<string, string>()
  for (const group of issues(run.findings.filter(isConfirmed))) {
    const id = group.find(f => selected.includes(f.id))?.id
    if (id !== undefined) for (const f of group) head.set(f.id, id)
  }
  const parsed = parseReply(text, { isFirstRound: attempt.round === 1, isFixPhase: attempt.phase > 0, own, other, known, selected: [...head.keys()], isAsk })
  if ('error' in parsed) return fail(attempt, `The reply is invalid: ${parsed.error}`)
  attempt.reply = { ...parsed.reply, findings: parsed.reply.findings.map(f => (f.of === undefined ? f : { ...f, of: head.get(f.of)! })) }
  if (parsed.reply.verdict === 'BLOCKED') return fail(attempt, `The reviewer was blocked: ${parsed.reply.limitations.join(' ')}`)
  attempt.status = 'replied'
}
