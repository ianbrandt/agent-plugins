// The plugin's hooks module: the backlog rule a session starts with, the
// tools a session calls to read and change the backlog, and the citation checks.
import type { Register } from 'claude-code'
import { citations, replyNote } from './cite'
import { rule } from './plan'
import { MIGRATE_TOOLS, migrateTools } from './migrate'
import { facts } from './repo'
import { TOOLS, tools } from './tools'
import { WRITE_TOOLS, writeTools } from './write'

// The rule for find_backlog's kind; nothing in a repo with no backlog. A lookup
// that failed is one line of context, since the repo may have a backlog.
const added = ($: any) => facts($).then(
  repo => (repo ? rule(repo) : ''),
  err => `The backlog lookup failed, so it is not known whether this repo has a backlog: ${(err as Error).message}`,
)

// The conversation as the model reads it, or undefined where it is not read
// back.
const conversation = async ($: any): Promise<any[] | undefined> => {
  const messages = await $.session.messages({ as: 'api' }).catch(() => undefined)
  return Array.isArray(messages) ? messages : undefined
}

// Whether the model still reads this text: false after /clear, a compaction,
// or a plugin update that changed it. Context added to a tool call is in its
// result.
function isRead(messages: any[], text: string): boolean {
  const has = (b: any): boolean => b.type === 'text' ? String(b.text).includes(text)
    : b.type === 'tool_result' && (typeof b.content === 'string' ? b.content.includes(text) : Array.isArray(b.content) && b.content.some(has))
  return messages.some(m => m.role === 'user' && Array.isArray(m.content) && m.content.some(has))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    for (const t of [...TOOLS, ...WRITE_TOOLS, ...MIGRATE_TOOLS]) await $.tool.register({ ...t, isDeferred: false })
    return next(e)
  })

  // The rule goes with the first prompt, and again once the model no longer
  // reads it, and a note on the last reply's citations goes with the next. A fork starts with its parent's context, where the rule already
  // is. The rule found at the last prompt in each session is kept for the tool
  // calls of its turn.
  const found = new Map<string, string>()
  // ponytail: the lookup runs on every prompt, since the rule is compared whole with what the model still reads.
  on('prompt.submit', async ($, e: any, next: any) => {
    const text = await added($)
    found.set(await $.session.id().catch(() => ''), text)
    const more = [...(text && !isRead((await conversation($)) ?? [], text) ? [text] : []), ...[await replyNote($)].filter(n => n !== undefined)]
    return next(more.length ? { ...e, context: [...(e.context ?? []), ...more] } : e)
  })

  // After an automatic compaction in the middle of a turn the main loop goes without the rule until the next prompt. It is added to the
  // next tool result, and not again until the model reads it back, since calls
  // that run in parallel all start before any result is read back. The first
  // message, the summary, is kept with that, so a second compaction adds it
  // again. A subagent never gets it.
  const after = new Map<string, string>()
  on('tool.call', async ($, e: any, next: any) => {
    const ran = await next(e)
    if (ran.deny !== undefined || e.agentId) return ran
    const id = await $.session.id().catch(() => '')
    // shortcut: a hot reload in the middle of a turn empties `found`, so the rule waits for the next prompt; keep it in $.state if that shows up.
    const text = found.get(id)
    const messages = text ? await conversation($) : undefined
    if (!text || !messages) return ran
    const head = JSON.stringify(messages[0] ?? null)
    if (isRead(messages, text) || after.get(id) === head) return ran
    after.set(id, head)
    return { ...ran, context: [...(ran.context ?? []), text] }
  })

  tools(on)
  writeTools(on)
  migrateTools(on)
  citations(on)
}
