export type CodexUsage = {
  input_tokens: number
  cached_input_tokens: number
  cache_write_input_tokens?: number
  output_tokens: number
  reasoning_output_tokens?: number
}

export type CodexEvents = {
  threadId?: string
  reply?: string
  usage?: CodexUsage
  turnsCompleted: number
  turnFailures: string[]
  errors: string[]
  warnings: string[]
}

export type LimitStatus = 'usage_limit' | 'budget_limit' | 'rate_limit'

type Event = {
  type?: string
  thread_id?: string
  message?: string
  error?: { message?: string }
  item?: { type?: string; text?: string; message?: string }
  usage?: CodexUsage
}

export function parseEvents(stdout: string): CodexEvents {
  const events: CodexEvents = { turnsCompleted: 0, turnFailures: [], errors: [], warnings: [] }
  for (const line of stdout.split('\n')) {
    let event: Event
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    if (event?.type === 'thread.started') events.threadId = event.thread_id
    else if (event?.type === 'turn.completed') {
      events.turnsCompleted++
      events.usage = event.usage
    } else if (event?.type === 'error' && typeof event.message === 'string') events.errors.push(event.message)
    else if (event?.type === 'turn.failed' && typeof event.error?.message === 'string') events.turnFailures.push(event.error.message)
    else if (event?.type === 'item.completed' && event.item?.type === 'agent_message') events.reply = event.item.text
    else if (event?.type === 'item.completed' && event.item?.type === 'error' && typeof event.item.message === 'string')
      events.warnings.push(event.item.message)
  }
  return events
}

// Codex and LiteLLM report limits only as English text.
export function classify(message: string | undefined): { status: LimitStatus; retryAt?: string } | undefined {
  if (message === undefined) return undefined
  if (/usage limit/i.test(message)) {
    const retryAt = /try again at (.+?)\.?$/i.exec(message)?.[1]
    return retryAt === undefined ? { status: 'usage_limit' } : { status: 'usage_limit', retryAt }
  }
  if (/budget[^.]*exceeded|exceeded[^.]*budget|max_budget/i.test(message)) return { status: 'budget_limit' }
  if (/\b429\b|rate[ _-]?limit(ed|_exceeded| reached| exceeded)|too many requests|throttl/i.test(message)) return { status: 'rate_limit' }
  return undefined
}
