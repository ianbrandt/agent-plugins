import type { AgentSpawnInput, AgentSpawnResult, EngineInterface, TurnUsage } from 'claude-code'
import { current, description, fail, phaseOf, rawOf, receive, reviewerPrefix } from './attempts'
import { estimateClaudeCostUsd } from './cost'
import type { ClaudeUsage } from './cost'
import { getRun, inMemory, isEnded, save } from './state'
import type { Attempt, RunState } from './state'

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

const reviewerAttempt = (match: (a: Attempt) => boolean) => {
  for (const run of inMemory()) {
    const attempt = run.attempts.find(a => a.side === 'claude' && match(a))
    if (attempt !== undefined) return { run, attempt }
  }
  return undefined
}

function price(attempt: Attempt, model: string | undefined, usage: ClaudeUsage) {
  attempt.usage = usage
  attempt.resolvedModel = model
  attempt.costUsd = model === undefined ? null : estimateClaudeCostUsd(model, usage)
}

// A copy that another call replaced with a newer state.json meanwhile is left unsaved, so the newer state stands.
async function keep($: EngineInterface, run: RunState): Promise<void> {
  const now = await $.clock.now()
  if (inMemory().includes(run)) await save($, run, now)
}

export function isOffered(agent: string): boolean {
  return inMemory().some(run => {
    const attempt = !isEnded(run) && run.phases.length > 0 ? current(run, 'claude') : undefined
    return attempt?.status === 'waiting' && `${reviewerPrefix}${attempt.effort}` === agent
  })
}

export async function onSpawn($: EngineInterface, e: AgentSpawnInput, next: (e: AgentSpawnInput) => Promise<AgentSpawnResult>): Promise<AgentSpawnResult> {
  const id = /^Confer ([0-9a-f]{8}) /.exec(e.description)?.[1]
  const now = await $.clock.now()
  const run = id === undefined ? undefined : await getRun($, id)
  const attempt = run !== undefined && !isEnded(run) && run.phases.length > 0 ? current(run, 'claude') : undefined
  // The engine ignores a content rewrite for a resume, and the cwd rewrite for a teammate or a workflow's agent.
  if (e.resume !== undefined || e.isTeammate || e.workflow !== undefined || e.fork) {
    return { deny: 'A Confer reviewer is started fresh for each round: send the Agent call exactly as the round gives it, with no resume, team, workflow, or fork.' }
  }
  if (
    run === undefined ||
    attempt?.status !== 'waiting' ||
    e.description !== description(run, phaseOf(run)) ||
    e.subagentType !== `${reviewerPrefix}${attempt.effort}`
  ) {
    return { deny: 'No Confer review round is waiting for this reviewer. Send the Agent call exactly as the last Confer result gives it.' }
  }
  attempt.status = 'running'
  attempt.toolUseId = e.tool_use_id
  try {
    await save($, run, now)
  } catch (error) {
    const reason = `The reviewer could not start: ${message(error)}`
    fail(attempt, reason)
    return { deny: reason }
  }
  let result: AgentSpawnResult
  try {
    result = await next({ ...e, prompt: attempt.prompt, model: attempt.model, cwd: run.repoDir, background: false })
  } catch (error) {
    fail(attempt, `The reviewer could not start: ${message(error)}`)
    await keep($, run)
    throw error
  }
  if (result.deny !== undefined) fail(attempt, `The reviewer's spawn was denied: ${result.deny}`)
  else if (result.agentId !== undefined) attempt.agentId = result.agentId
  await keep($, run)
  return result
}

type AgentCall = { result?: unknown; deny?: string; isError?: true; text?: string }

export async function onAgentCall<E extends { tool_use_id: string }, R extends AgentCall>($: EngineInterface, e: E, next: (e: E) => Promise<R>): Promise<R> {
  let result: R
  try {
    result = await next(e)
  } catch (error) {
    const found = reviewerAttempt(a => a.toolUseId === e.tool_use_id)
    if (found !== undefined) {
      fail(found.attempt, `The Agent call failed: ${message(error)}`)
      await keep($, found.run)
    }
    throw error
  }
  const found = reviewerAttempt(a => a.toolUseId === e.tool_use_id)
  if (found === undefined) return result
  const { run, attempt } = found
  const record = result.result as { status?: string; agentId?: string; resolvedModel?: string; usage?: Record<string, number | null>; handbackReport?: { text?: unknown } } | undefined
  if (result.deny !== undefined || result.isError) fail(attempt, `The Agent call failed: ${result.deny ?? result.text}`)
  else if (record?.status === 'completed') {
    price(attempt, record.resolvedModel, {
      input_tokens: record.usage?.input_tokens ?? 0,
      output_tokens: record.usage?.output_tokens ?? 0,
      cache_creation_input_tokens: record.usage?.cache_creation_input_tokens ?? null,
      cache_read_input_tokens: record.usage?.cache_read_input_tokens ?? null,
    })
    // turn.complete can arrive after this call returns. handbackReport is the reviewer's final reply on 2.1.319, and absent on a withheld hand-back.
    const text = record.handbackReport?.text
    if (attempt.status === 'running') {
      if (typeof text === 'string' && text.trim() !== '') receive(run, attempt, text)
      else fail(attempt, 'The reviewer returned no answer.')
    }
  }
  attempt.agentId ??= record?.agentId
  await keep($, run)
  return result
}

export async function onTurn($: EngineInterface, e: { agentId?: string; answer: string; usage?: TurnUsage }): Promise<void> {
  if (e.agentId === undefined) return
  const found = reviewerAttempt(a => a.agentId === e.agentId)
  if (found === undefined) return
  const { run, attempt } = found
  // A reviewer moved to the background has no usage in its Agent result, which is async_launched.
  if (attempt.usage === undefined && e.usage !== undefined) {
    const { model, ...usage } = e.usage
    price(attempt, model, usage)
  }
  if (attempt.status !== 'running') attempt.raw ??= rawOf(run, e.answer)
  else if (e.answer.trim() === '') fail(attempt, 'The Claude reviewer ended with no answer.')
  else receive(run, attempt, e.answer)
  await keep($, run)
}
