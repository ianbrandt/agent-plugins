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
  // The percent of the weekly Fable limit used, as the conductor read it; absent where no limit is reported.
  fableUsedPercent?: unknown
}

export type Fallback = { reason: 'not-served' } | { reason: 'usage'; percent: number }
export type TierChoice = { tier: Tier; claude: Side; codex: Side; args: string[]; fallback?: Fallback }

// Paired by measured score and cost per task on 2026-11-09, not by effort label. Both sides' models,
// and the Claude effort, are settings; the Claude defaults here repeat the ones in plugin.json.
// Claude models are aliases (`sonnet`, `opus`, `fable`), resolved to the provider's id by the harness.
const table: Record<Tier, { claude: Side; codexEffort: ModelEffort }> = {
  routine: { claude: { model: 'sonnet', effort: 'high' }, codexEffort: 'medium' },
  complex: { claude: { model: 'opus', effort: 'high' }, codexEffort: 'xhigh' },
  critical: { claude: { model: 'fable', effort: 'high' }, codexEffort: 'high' },
  escalation: { claude: { model: 'fable', effort: 'xhigh' }, codexEffort: 'max' },
}
const aliases = ['sonnet', 'opus', 'haiku', 'fable']
// Usage at which a Fable tier other than escalation runs on Opus instead, as in the tier-model-and-effort skill.
const fableLimit = 80
// The env var that pins an alias to a specific provider id, as Claude Code reads for the main session.
// A subagent spawn does not go through that resolution, so the pin is applied here for the reviewer.
// `$.env.get` takes string literals, so each name is spelled out in `readPin` below.
async function readPin($: EngineInterface, model: string): Promise<string | undefined> {
  if (model === 'sonnet') return $.env.get('ANTHROPIC_DEFAULT_SONNET_MODEL')
  if (model === 'opus') return $.env.get('ANTHROPIC_DEFAULT_OPUS_MODEL')
  if (model === 'haiku') return $.env.get('ANTHROPIC_DEFAULT_HAIKU_MODEL')
  if (model === 'fable') return $.env.get('ANTHROPIC_DEFAULT_FABLE_MODEL')
  return undefined
}
const tiers = Object.keys(table) as Tier[]
const efforts: readonly ModelEffort[] = ['low', 'medium', 'high', 'xhigh', 'max']
const flags = ['--tier', '--claude-model', '--claude-effort', '--codex-model', '--codex-effort']

const or = (words: readonly string[]) => `${words.slice(0, -1).join(', ')}, or ${words.at(-1)}`
const capitalized = (tier: Tier) => tier[0]!.toUpperCase() + tier.slice(1)

export async function chooseTier($: EngineInterface, request: TierRequest, options: PluginOptions): Promise<TierChoice> {
  if (!tiers.includes(request.pick)) throw new Error(`"${request.pick}" is not a tier: ${or(tiers)}.`)
  if (request.pick === 'escalation') throw new Error('Escalation runs only when the user asks for it.')
  const percent = checkPercent(request.fableUsedPercent)
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

  return {
    tier,
    ...(await claudeSide($, tier, set, options, percent)),
    codex: { model: set['--codex-model'] ?? String(options[`codex${capitalized(tier)}Model`]), effort: (set['--codex-effort'] as ModelEffort) ?? table[tier].codexEffort },
    args: rest,
  }
}

// The Claude side of a tier chosen earlier, decided again against the current settings and Fable usage.
export async function refreshClaude($: EngineInterface, tier: Tier, args: string, options: PluginOptions, fableUsedPercent: unknown): Promise<{ claude: Side; fallback?: Fallback }> {
  return claudeSide($, tier, parse(args).set, options, checkPercent(fableUsedPercent))
}

export const fallbackOf = (choice: { fallback?: Fallback }) => (choice.fallback === undefined ? {} : { fallback: choice.fallback })

export function checkPercent(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`fableUsedPercent takes the percent of the weekly Fable limit used, from 0 to 100, not ${JSON.stringify(value)}.`)
  }
  return value
}

async function claudeSide($: EngineInterface, tier: Tier, set: Record<string, string>, options: PluginOptions, percent: number | undefined): Promise<{ claude: Side; fallback?: Fallback }> {
  const name = `claude${capitalized(tier)}`
  const effortSetting = String(options[`${name}Effort`] ?? '')
  // A CLI that ignores the setting's declared options can pass any value.
  const effort = efforts.includes(effortSetting as ModelEffort) ? (effortSetting as ModelEffort) : table[tier].claude.effort
  const effortFlag = set['--claude-effort'] as ModelEffort | undefined
  const override = set['--claude-model']
  if (override !== undefined) return { claude: { model: (await readPin($, override)) ?? override, effort: effortFlag ?? effort } }
  const setting = String(options[`${name}Model`] ?? table[tier].claude.model).trim()
  if (setting === '') throw new Error(`The ${name}Model setting is empty: set a model, such as opus.`)
  const model = aliases.includes(setting.toLowerCase()) ? setting.toLowerCase() : setting
  const pinned = (await readPin($, model)) ?? model
  let fallback: Fallback | undefined
  if (model === 'fable') {
    if (tier !== 'escalation' && percent !== undefined && percent >= fableLimit) fallback = { reason: 'usage', percent }
    else if (!(await isServed($, pinned))) fallback = { reason: 'not-served' }
  }
  if (fallback === undefined) return { claude: { model: pinned, effort: effortFlag ?? effort } }
  const opus = (await readPin($, 'opus')) ?? 'opus'
  return { claude: { model: opus, effort: effortFlag ?? efforts[Math.min(efforts.indexOf(effort) + 1, efforts.length - 1)]! }, fallback }
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
