export type Price = { input: number; output: number; cacheWrite: number; cacheRead: number }

export type ClaudeUsage = {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens?: number | null
  cache_read_input_tokens?: number | null
}

// USD per million tokens, from Anthropic's model table cached 2026-10-06. Cache writes at the five-minute rate.
const prices = new Map<string, Price>([
  ['claude-opus-5-5', { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 }],
  ['claude-sonnet-5-5', { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 }],
  ['claude-fable-5-1', { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 0.25 }],
])

// `table` is for tests. Anthropic counts cache tokens apart from input_tokens.
export function estimateClaudeCostUsd(model: string, usage: ClaudeUsage, table: ReadonlyMap<string, Price> = prices): number | null {
  const price = table.get(model)
  if (price === undefined) return null
  return (
    (usage.input_tokens * price.input +
      usage.output_tokens * price.output +
      (usage.cache_creation_input_tokens ?? 0) * price.cacheWrite +
      (usage.cache_read_input_tokens ?? 0) * price.cacheRead) /
    1e6
  )
}
