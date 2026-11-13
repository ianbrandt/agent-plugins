import type { EngineInterface, PluginOptions } from 'claude-code'
import { runCodex } from '../codex/run'
import type { CodexRunResult } from '../codex/run'
import { removeWorktree } from '../codex/worktree'
import { current, fail, failures, newAttempt, receive } from './attempts'
import { logEnd, logStart } from './progress'
import { save } from './state'
import type { Attempt, RunState } from './state'

const limits: readonly string[] = ['usage_limit', 'budget_limit', 'rate_limit']
const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

// shortcut: Date.parse reads Codex's "Oct 19th, 2026 12:06 AM" as local time only where the runtime parses that form; otherwise no retryAt is kept.
function retryTime(text: string | undefined): number | undefined {
  const time = text === undefined ? NaN : Date.parse(text.replace(/(\d+)(st|nd|rd|th)\b/, '$1'))
  return Number.isNaN(time) ? undefined : time
}

export async function cleanup($: EngineInterface, run: RunState): Promise<void> {
  for (const path of [...run.resources.worktrees]) {
    const isThere = await $.fs.exists(path).catch(() => true)
    if (!isThere || (await removeWorktree($, run.top, path)) === undefined) run.resources.worktrees = run.resources.worktrees.filter(p => p !== path)
  }
  for (const ref of [...run.resources.refs]) {
    const removed = await $.process.run(['git', '-C', run.top, 'update-ref', '-d', ref], { timeoutMs: 600_000 }).catch(() => undefined)
    if (removed?.exitCode === 0) run.resources.refs = run.resources.refs.filter(r => r !== ref)
  }
  await save($, run, await $.clock.now())
}

// An agent that $.agent.list() shows ended, with no reply recorded, fails its attempt.
export async function failEndedAgent($: EngineInterface, run: RunState): Promise<void> {
  const claude = current(run, 'claude')
  if (claude?.status !== 'running' || claude.agentId === undefined) return
  const agent = (await $.agent.list().catch(() => [])).find(a => a.id === claude.agentId)
  if (agent === undefined || !['completed', 'failed', 'killed'].includes(agent.status)) return
  fail(claude, `The Claude reviewer ended ${agent.status} with no reply.`)
  await logEnd($, run, claude)
  await save($, run, await $.clock.now())
}

// Runs Codex for the current round until it replies or fails twice. `running`: another call is running it; `paused`: it reported a limit.
export async function runCodexAttempts($: EngineInterface, run: RunState, options: PluginOptions, tree?: string): Promise<'running' | 'paused' | undefined> {
  let now = await $.clock.now()
  for (;;) {
    const codex = current(run, 'codex')
    if (codex?.status === 'running') return 'running'
    if (codex?.status === 'replied' || failures(run, 'codex') >= 2 || failures(run, 'claude') >= 2) return undefined
    const attempt = newAttempt(run, 'codex')
    const outDir = `${run.dir}/codex-p${attempt.phase}-r${attempt.round}-a${attempt.number}`
    // runCodex makes this worktree on Windows; it is listed first, so a reclaim finds it if this session dies.
    const worktree = `${outDir}-worktree`
    if (options.worktree !== false) run.resources.worktrees.push(worktree)
    // A save that fails must not leave the attempt running, or every later call waits for it.
    await save($, run, now).catch(error => {
      fail(attempt, message(error))
      run.resources.worktrees = run.resources.worktrees.filter(path => path !== worktree)
      throw error
    })
    const result: Partial<CodexRunResult> = await $.fs
      .write(`${outDir}/prompt.md`, attempt.prompt)
      .then(() => runCodex($, { repo: run.repoDir, isCheckout: run.top !== '', outDir, prompt: attempt.prompt, model: attempt.model, effort: attempt.effort, worktree: options.worktree !== false, tree, onStart: () => logStart($, run, attempt) }))
      .catch(error => ({ status: 'failed' as const, error: message(error) }))
    now = await $.clock.now()
    const { reply, usage, costUsd, model, effort, ...codexResult } = result
    attempt.codex = codexResult as Attempt['codex']
    attempt.usage = usage
    attempt.costUsd = costUsd
    attempt.resolvedModel = result.effectiveModel
    run.resources.worktrees = run.resources.worktrees.filter(path => path !== worktree)
    if (result.worktreeLeft !== undefined) run.resources.worktrees.push(result.worktreeLeft)
    if (result.status === 'completed') receive(run, attempt, reply!)
    else if (limits.includes(result.status!)) {
      attempt.status = 'limited'
      run.status = 'paused'
      run.pause = { limit: result.status!, error: result.error ?? result.status!, retryAt: retryTime(result.retryAt) }
    } else fail(attempt, result.error ?? `Codex ended ${result.status}.`)
    await logEnd($, run, attempt)
    await save($, run, now)
    if (attempt.status === 'limited') return 'paused'
  }
}
