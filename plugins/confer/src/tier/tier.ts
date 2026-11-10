import type { EngineInterface, ModelEffort, PluginOptions } from 'claude-code'

export type Tier = 'routine' | 'complex' | 'critical' | 'escalation'
export type Side = { model: string; effort: ModelEffort }

export type TierRequest = {
  command: 'plan' | 'review' | 'question'
  // The conductor's pick, from references/tiers.md.
  pick: Tier
  isSure: boolean
  // The command's arguments; the tier flags are taken out.
  args: string
}

export type TierChoice = { tier: Tier; claude: Side; codex: Side; args: string[] }

// Paired by measured score and cost per task on 2026-11-09, not by effort label. Codex ids are settings.
// Claude models are aliases (`sonnet`, `opus`, `fable`), resolved to the provider's id by the harness.
// `fallback` runs where the account is not served Fable.
const table: Record<Tier, { claude: Side; fallback?: Side; codexEffort: ModelEffort }> = {
  routine: { claude: { model: 'sonnet', effort: 'high' }, codexEffort: 'medium' },
  complex: { claude: { model: 'opus', effort: 'high' }, codexEffort: 'xhigh' },
  critical: { claude: { model: 'fable', effort: 'high' }, fallback: { model: 'opus', effort: 'xhigh' }, codexEffort: 'high' },
  escalation: { claude: { model: 'fable', effort: 'xhigh' }, fallback: { model: 'opus', effort: 'max' }, codexEffort: 'max' },
}
export const codexModels = (options: PluginOptions): Record<Tier, string> => ({
  routine: String(options.codexRoutineModel),
  complex: String(options.codexComplexModel),
  critical: String(options.codexCriticalModel),
  escalation: String(options.codexEscalationModel),
})
const tiers = Object.keys(table) as Tier[]
const efforts: readonly ModelEffort[] = ['low', 'medium', 'high', 'xhigh', 'max']
const flags = ['--tier', '--claude-model', '--claude-effort', '--codex-model', '--codex-effort']

const or = (words: readonly string[]) => `${words.slice(0, -1).join(', ')}, or ${words.at(-1)}`
const capitalized = (tier: Tier) => tier[0]!.toUpperCase() + tier.slice(1)

export async function chooseTier($: EngineInterface, request: TierRequest, codexModels: Record<Tier, string>): Promise<TierChoice> {
  if (!tiers.includes(request.pick)) throw new Error(`"${request.pick}" is not a tier: ${or(tiers)}.`)
  if (request.pick === 'escalation') throw new Error('Escalation runs only when the user asks for it.')
  const { set, rest } = parse(request.args)
  const tierFlag = set['--tier']
  if (tierFlag !== undefined && !tiers.includes(tierFlag as Tier)) throw new Error(`--tier takes ${or(tiers)}, not "${tierFlag}".`)
  for (const flag of ['--claude-effort', '--codex-effort']) {
    const effort = set[flag]
    if (effort !== undefined && !efforts.includes(effort as ModelEffort)) throw new Error(`${flag} takes ${or(efforts)}, not "${effort}".`)
  }

  let tier = (tierFlag as Tier | undefined) ?? request.pick
  const isClaudeSet = set['--claude-model'] !== undefined || set['--claude-effort'] !== undefined
  const isCodexSet = set['--codex-model'] !== undefined || set['--codex-effort'] !== undefined
  if (!request.isSure && tierFlag === undefined && !(isClaudeSet && isCodexSet)) {
    tier = await ask($, `Which tier should ${isClaudeSet ? 'Codex' : isCodexSet ? 'Claude' : 'Confer'} run this ${request.command} at?`, request.pick)
  }

  const { claude: picked, fallback, codexEffort } = table[tier]
  const claude = fallback !== undefined && set['--claude-model'] === undefined && !(await isServed($, picked.model)) ? fallback : picked
  return {
    tier,
    claude: { model: set['--claude-model'] ?? claude.model, effort: (set['--claude-effort'] as ModelEffort) ?? claude.effort },
    codex: { model: set['--codex-model'] ?? codexModels[tier], effort: (set['--codex-effort'] as ModelEffort) ?? codexEffort },
    args: rest,
  }
}

function parse(args: string): { set: Record<string, string>; rest: string[] } {
  const set: Record<string, string> = {}
  const rest: string[] = []
  const words = split(args)
  for (let i = 0; i < words.length; i++) {
    const [flag, inline] = words[i]!.split(/=(.*)/s)
    if (!flags.includes(flag!)) {
      rest.push(words[i]!)
      continue
    }
    const value = inline ?? words[++i]
    if (value === undefined) throw new Error(`${flag} needs a value.`)
    set[flag!] = value
  }
  return { set, rest }
}

// Single and double quotes group a word. A backslash is kept as is, since it separates Windows paths.
export function split(args: string): string[] {
  const words: string[] = []
  let word: string | undefined
  let quote: string | undefined
  for (const char of args) {
    if (quote !== undefined) {
      if (char === quote) quote = undefined
      else word += char
    } else if (char === '"' || char === "'") {
      quote = char
      word ??= ''
    } else if (/\s/.test(char)) {
      if (word !== undefined) words.push(word)
      word = undefined
    } else {
      word = (word ?? '') + char
    }
  }
  if (quote !== undefined) throw new Error(`The arguments have an unclosed ${quote} quote.`)
  if (word !== undefined) words.push(word)
  return words
}

// A model the engine blocks rejects, and the API answers 404 for one the account is not served.
async function isServed($: EngineInterface, model: string): Promise<boolean> {
  const reply = await $.model.complete({ model, prompt: 'Reply with OK.', maxTokens: 16, effort: 'low', timeoutMs: 30000 }).catch(() => undefined)
  if (reply === undefined) return false
  return reply.isAnswered || reply.reason !== 'api-error' || (reply.status !== 404 && reply.error !== 'model_not_found')
}

// With no one to ask, as in a -p run, or with the question dismissed, the pick stands.
async function ask($: EngineInterface, question: string, pick: Tier): Promise<Tier> {
  const labels = [pick, ...tiers.filter((tier) => tier !== pick)].map((tier) => (tier === pick ? `${capitalized(tier)} (Recommended)` : capitalized(tier)))
  const reply = await $.ui.ask(question, { options: labels, header: 'Tier' }).catch(() => undefined)
  if (reply === undefined) return pick
  const answer = reply.replace(/\(Recommended\)/, '').trim().toLowerCase()
  if (!tiers.includes(answer as Tier)) throw new Error(`"${reply}" is not a tier: ${or(tiers)}.`)
  return answer as Tier
}
