// The plugin's hooks module: the rules a session starts with, and the one rule
// a subagent starts with.
import type { Register } from 'claude-code'

export const SUBAGENT_RULE = "You are a subagent with no user to ask. Before a decision that is hard to reverse (a wire contract or public API, a data schema or file format, a name that becomes permanent, text that publishes under the user's name, a push to a public repository, a call later work will build on), put the decision and its options, with what each costs, in your result instead of settling it silently. The agent reading your report is the one who can stop."

// Whether the model still reads this text: false after /clear, a compaction,
// or a plugin update that changed it, and undefined where the conversation is
// not read back, as a Workflow agent's is not on 2.1.310. Context added to a
// tool call is in its result.
async function isRead($: any, text: string, agentId?: string): Promise<boolean | undefined> {
  const messages = await $.session.messages({ ...(agentId && { agentId }), as: 'api' }).catch(() => undefined)
  if (!Array.isArray(messages)) return undefined
  const has = (b: any): boolean => b.type === 'text' ? String(b.text).includes(text)
    : b.type === 'tool_result' && (typeof b.content === 'string' ? b.content.includes(text) : Array.isArray(b.content) && b.content.some(has))
  return messages.some(m => m.role === 'user' && Array.isArray(m.content) && m.content.some(has))
}

// The first message of a conversation, which a compaction or /clear replaces,
// and '' where the conversation is not read back.
async function head($: any, agentId?: string): Promise<string> {
  const messages = await $.session.messages({ ...(agentId && { agentId }), as: 'api' }).catch(() => undefined)
  return Array.isArray(messages) ? JSON.stringify(messages[0] ?? null) : ''
}

const TIERS = ['mechanical', 'routine', 'complex', 'critical', 'escalation']

// The rules, then the model and effort of each tier as set in the plugin's
// settings, where the engine puts a plugin.json default for one left unset.
async function rulesText($: any, options: Record<string, unknown>): Promise<string> {
  const rules = await $.fs.read(`${$.plugin.root}/hooks/rules.md`).catch(() => '')
  if (!rules) return ''
  // An empty model setting leaves `model` off, so the agent runs on the session's model.
  const rows = TIERS.map(tier => `| ${tier[0]!.toUpperCase()}${tier.slice(1)} | ${String(options[`${tier}Model`] ?? '').trim() || "the session's model"} | ${options[`${tier}Effort`]} |`)
  return `${rules}\n\n## The tiers in this session's settings\n\nPass these as \`model\` and \`effort\` on \`Agent\` and on a Workflow \`agent()\`. Which stage runs at which tier is in the \`tier-model-and-effort\` skill.\n\n| Tier | Model | Effort |\n|---|---|---|\n${rows.join('\n')}\n`
}

export const register: Register = (on, options) => {
  // The rules go with the first prompt, and again once the model no longer
  // reads them.
  on('prompt.submit', async ($, e: any, next: any) => {
    const rules = await rulesText($, options)
    return next(rules && !(await isRead($, rules)) ? { ...e, context: [...(e.context ?? []), rules] } : e)
  })

  // The rule goes into the task at spawn: auto mode refuses an Agent call
  // if a tool.call hook changed its input after review. A Workflow agent gets it
  // with its first tool result below, and a resumed run keeps its prompt.
  on('agent.spawn', async ($, e: any, next: any) =>
    next(e.workflow || e.resume || e.prompt.includes(SUBAGENT_RULE) ? e : { ...e, prompt: `${SUBAGENT_RULE}\n\n${e.prompt}` }))

  // A Workflow's agents start without the rule, and after an automatic
  // compaction in the middle of a turn the main loop goes without the rules
  // until the next prompt. They are added to the next tool result,
  // and not again until the model reads them back, or the conversation they
  // were added to is compacted again: calls that run in parallel all start
  // before any result is read back, and a Workflow agent's conversation is
  // never read back.
  // ponytail: kept in memory, so after a hot reload a running Workflow agent gets the rule a second time.
  const added = new Map<string, string>()
  on('tool.call', async ($, e: any, next: any) => {
    const ran = await next(e)
    if (ran.deny !== undefined) return ran
    const key = e.agentId ?? (await $.session.id().catch(() => ''))
    const text = e.agentId ? SUBAGENT_RULE : await rulesText($, options)
    if (!text) return ran
    const read = await isRead($, text, e.agentId)
    if (read) added.delete(key)
    if (read || (read === undefined && !e.agentId)) return ran
    const at = await head($, e.agentId)
    if (added.get(key) === at) return ran
    added.set(key, at)
    return { ...ran, context: [...(ran.context ?? []), text] }
  })
}
