// The plugin's hooks module: the roadmap rule a session starts with, and the
// tools a session calls to read and change the backlog.
import type { Register } from 'claude-code'
import { type Plan, planOf, rule } from './plan'
import { TOOLS, tools } from './tools'
import { WRITE_TOOLS, writeTools } from './write'

const FIND = 'mcp__backlog-skills__find_roadmap'

// The first line git wrote for a command that failed, or its exit code: Claude
// Code reports a git that crashed as exit 1 with no output.
const why = (r: { exitCode: number; stderr: string }) => String(r.stderr).trim().split(/\r?\n/)[0] || `exit ${r.exitCode}`

// The primary checkout and its plan. Outside a git repository there is neither.
// git is run in the primary checkout: the session's directory is the default,
// and nothing starts there once a session has removed the worktree it had
// changed into. git exits 2 for a remote it does not have, and any other
// failure throws: a repo not known to be a fork is not known to have a roadmap
// of its own.
async function find($: any): Promise<{ main: string; plan: Plan } | null> {
  const main = (await $.session.repo())?.root
  if (!main) return null
  const git = (...argv: string[]) => $.process.run(['git', '-C', main, ...argv], { cwd: main })
  const hasLocal = await $.fs.exists(`${main}/ROADMAP.local.md`)
  const upstream = await git('remote', 'get-url', 'upstream')
  if (upstream.exitCode !== 0 && upstream.exitCode !== 2) throw new Error(`git remote get-url upstream in ${main}: ${why(upstream)}`)
  const hasUpstream = upstream.exitCode === 0
  const listed = await git('ls-files', 'ROADMAP.md', 'docs/roadmap.md')
  if (listed.exitCode !== 0) throw new Error(`git ls-files in ${main}: ${why(listed)}`)
  const tracked = String(listed.stdout).split(/\r?\n/).filter(Boolean)
  return { main, plan: planOf({ hasLocal, hasUpstream, tracked }) }
}

// In a repo with no roadmap of its own nothing is added. A lookup that failed
// is one line of context, since the repo may have a roadmap.
const added = ($: any) => find($).then(
  found => (found && 'roadmap' in found.plan ? rule(found.plan, found.main) : ''),
  err => `The roadmap lookup failed, so it is not known whether this repo has a roadmap: ${(err as Error).message}`,
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
    for (const t of [...TOOLS, ...WRITE_TOOLS]) await $.tool.register({ ...t, isDeferred: false })
    return next(e)
  })

  // The rule goes with the first prompt, and again once the model no longer
  // reads it. A fork starts with its parent's context, where the rule already
  // is. The rule found at the last prompt in each session is kept for the tool
  // calls of its turn.
  const found = new Map<string, string>()
  // ponytail: the lookup runs on every prompt, since the rule is compared whole with what the model still reads.
  on('prompt.submit', async ($, e: any, next: any) => {
    const text = await added($)
    found.set(await $.session.id().catch(() => ''), text)
    return next(text && !isRead((await conversation($)) ?? [], text) ? { ...e, context: [...(e.context ?? []), text] } : e)
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

  // shortcut: find_roadmap is no longer registered, and its handler stays only for plan.test.ts; remove both when plan.ts is replaced.
  on('tool.call', { tool: FIND }, async $ => {
    try {
      const found = await find($)
      if (!found) return { result: 'kind: none\nNot inside a git repository.' }
      const { main, plan } = found
      const lines = [`main: ${main}`, `kind: ${plan.kind}`]
      if ('roadmap' in plan) lines.push(`roadmap: ${main}/${plan.roadmap}`)
      if ('history' in plan && plan.history) lines.push(`history: ${main}/${plan.history}`)
      return { result: lines.join('\n') }
    } catch (err) {
      const text = `find_roadmap: ${(err as Error).message}`
      return { result: text, text, isError: true }
    }
  })
}
