import { expect, test } from 'claude-code/testing'
import { estimateCostUsd } from './cost'

test('cost is estimated from uncached, cached, cache-write, and output tokens', () => {
  const usage = { input_tokens: 1_000_000, cached_input_tokens: 600_000, cache_write_input_tokens: 100_000, output_tokens: 100_000 }

  expect(estimateCostUsd('gpt-6.1-sol', usage)?.toFixed(7)).toBe('1.9100000')
  expect(estimateCostUsd('gpt-6-astra', usage)?.toFixed(7)).toBe('9.8500000')
})

test("a Bedrock model is priced at Bedrock's rate", () => {
  const usage = { input_tokens: 1_000_000, cached_input_tokens: 600_000, cache_write_input_tokens: 100_000, output_tokens: 100_000 }

  expect(estimateCostUsd('bedrock-gpt-6.1-sol', usage)?.toFixed(7)).toBe('2.1010000')
  expect(estimateCostUsd('bedrock-gpt-6-astra', usage)?.toFixed(7)).toBe('10.8350000')
})

test('a usage without cache writes is priced', () => {
  const usage = { input_tokens: 24427, cached_input_tokens: 17536, output_tokens: 63 }

  expect(estimateCostUsd('gpt-6.1-sol', usage)?.toFixed(7)).toBe('0.0161656')
})

test('a model without a price has no cost', () => {
  const usage = { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 }

  expect(estimateCostUsd('confer-no-such-model', usage)).toBeNull()
  expect(estimateCostUsd('toString', usage)).toBeNull()
})
