import { expect, test } from 'claude-code/testing'
import { estimateClaudeCostUsd } from './cost'

const price = { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 }

test('Claude cost is priced from input, output, cache-write, and cache-read tokens', () => {
  const usage = { input_tokens: 1_000_000, output_tokens: 100_000, cache_creation_input_tokens: 200_000, cache_read_input_tokens: 400_000 }

  expect(estimateClaudeCostUsd('m', usage, new Map([['m', price]]))?.toFixed(4)).toBe('8.9500')
})

test('missing cache counts are priced as none', () => {
  const usage = { input_tokens: 1_000_000, output_tokens: 0, cache_creation_input_tokens: null, cache_read_input_tokens: null }

  expect(estimateClaudeCostUsd('m', usage, new Map([['m', price]]))).toBe(5)
})

test('the Claude model of each tier is priced', () => {
  const usage = { input_tokens: 1_000_000, output_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000, cache_read_input_tokens: 1_000_000 }

  expect(estimateClaudeCostUsd('claude-opus-5-5', usage)?.toFixed(2)).toBe('29.20')
  expect(estimateClaudeCostUsd('claude-sonnet-5-5', usage)?.toFixed(2)).toBe('14.70')
  expect(estimateClaudeCostUsd('claude-fable-5-2', usage)?.toFixed(2)).toBe('58.20')
})

test('a model without a price has no cost', () => {
  expect(estimateClaudeCostUsd('claude-unknown', { input_tokens: 1, output_tokens: 1 })).toBeNull()
  expect(estimateClaudeCostUsd('toString', { input_tokens: 1, output_tokens: 1 })).toBeNull()
})
