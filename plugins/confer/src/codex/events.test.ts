import { expect, test } from 'claude-code/testing'
import { classify, parseEvents } from './events'
import { completed, unknownModel } from './fixtures/codex-0.167.0'
import { budgetLimit, rateLimit, usageLimit } from './fixtures/synthetic'

test('a completed run gives the thread, the last agent message, and the usage', () => {
  expect(parseEvents(completed)).toEqual({
    threadId: '01a1b80c-01e1-7c60-811e-b52b8eb2bb62',
    reply: '{"ok":true}',
    usage: { input_tokens: 24427, cached_input_tokens: 17536, cache_write_input_tokens: 0, output_tokens: 63, reasoning_output_tokens: 0 },
    turnsCompleted: 1,
    turnFailures: [],
    errors: [],
    warnings: [],
  })
})

test('item-level errors are warnings, and top-level errors and turn failures are kept apart', () => {
  const events = parseEvents(unknownModel)
  const message = "The 'confer-no-such-model' model is not supported when using Codex with a ChatGPT account."

  expect(events.warnings).toHaveLength(2)
  expect(events.errors).toEqual([message])
  expect(events.turnFailures).toEqual([message])
  expect(events.turnsCompleted).toBe(0)
  expect(classify(message)).toBeUndefined()
})

test('a line that is not JSON is skipped', () => {
  expect(parseEvents('Reading prompt from stdin...\n' + completed).reply).toBe('{"ok":true}')
})

test('a usage limit is reported with the retry time as Codex wrote it', () => {
  expect(classify(parseEvents(usageLimit).turnFailures[0])).toEqual({
    status: 'usage_limit',
    retryAt: 'Oct 19th, 2026 12:06 AM',
  })
})

test('LiteLLM budget and rate limits are reported by kind', () => {
  expect(classify(parseEvents(budgetLimit).turnFailures[0])).toEqual({ status: 'budget_limit' })
  expect(classify(parseEvents(rateLimit).turnFailures[0])).toEqual({ status: 'rate_limit' })
  expect(classify('rate limit exceeded for gpt-6.1-sol')).toEqual({ status: 'rate_limit' })
  expect(classify('max_budget reached')).toEqual({ status: 'budget_limit' })
})

test('a usage limit is checked before a budget or rate limit', () => {
  expect(classify("429 Too Many Requests: You've hit your usage limit.")).toEqual({ status: 'usage_limit' })
  expect(classify('Budget has been exceeded, rate limit reached')).toEqual({ status: 'budget_limit' })
})

test('a model with a budget or a rate limit in its name is not a limit', () => {
  expect(classify("The 'budget-test' model is not supported.")).toBeUndefined()
  expect(classify("The 'rate-limit-test' model is not supported.")).toBeUndefined()
  expect(classify('The model budget-test does not exist. Max tokens exceeded.')).toBeUndefined()
})
