import type { CodexUsage } from './events'

// USD per million tokens, from developers.openai.com/api/docs/models on 2026-11-07. Cached and
// cache-write tokens are taken to be counted inside input_tokens, as cached ones are.
const prices = new Map([
  ['gpt-6.1-sol', { input: 2, cached: 0.1, cacheWrite: 2.5, output: 10 }],
  ['gpt-6-astra', { input: 10, cached: 1, cacheWrite: 12.5, output: 50 }],
  // Bedrock us-east-1 In-Region and US CRIS rates, from the docs.aws.amazon.com/bedrock model
  // cards on 2026-11-07.
  ['bedrock-gpt-6.1-sol', { input: 2.2, cached: 0.11, cacheWrite: 2.75, output: 11 }],
  ['bedrock-gpt-6-astra', { input: 11, cached: 1.1, cacheWrite: 13.75, output: 55 }],
])

export function estimateCostUsd(model: string, usage: CodexUsage): number | null {
  const price = prices.get(model)
  if (price === undefined) return null
  const cacheWrite = usage.cache_write_input_tokens ?? 0
  const uncached = usage.input_tokens - usage.cached_input_tokens - cacheWrite
  return (
    (uncached * price.input + usage.cached_input_tokens * price.cached + cacheWrite * price.cacheWrite + usage.output_tokens * price.output) /
    1e6
  )
}
