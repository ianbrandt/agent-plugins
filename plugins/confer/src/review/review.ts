import type { EngineInterface, PluginOptions } from 'claude-code'
import { isWindowsPath } from '../codex/run'
import { git } from '../codex/worktree'
import { chooseTier, fallbackOf, refreshClaude, split } from '../tier/tier'
import type { Tier } from '../tier/tier'
import { current, description, failures, newAttempt, phaseOf, reviewerPrefix } from './attempts'
import { applyRound, fixOutcomes, isConfirmed, issues, settle, stopReason } from './consensus'
import { runGitTool } from './git-tool'
import { report } from './report'
import { snapshot } from './snapshot'
import { forget, getRun, isEnded, readRun, remember, save, tmpRoot } from './state'
import type { Ending, RunState } from './state'
import { cleanup, failEndedAgent, runCodexAttempts } from './steps'
import { foreignSource, prepare, readTarget } from './target'
import type { ReviewSide } from './types'

type Input = Record<string, unknown>
type Result = Record<string, unknown>

const day = 86_400_000
const week = 7 * day
const sides: readonly ReviewSide[] = ['claude', 'codex']
const names: Record<ReviewSide, string> = { claude: 'Claude', codex: 'Codex' }
const message = (error: unknown) => (error instanceof Error ? error.message : String(error))
const placeholder = 'Confer replaces this prompt with the review prompt of the round.'
const lastTree = (run: RunState) => run.phases.findLast(p => p.tree !== undefined)!.tree!
const kindOf = (run: RunState) => (run.ask !== undefined ? 'ask' : run.design !== undefined ? 'plan' : 'review')
// A run of another kind is refused with the tool of its kind to call.
export function refuseKind(run: RunState, kind: 'review' | 'plan' | 'ask', name: 'round' | 'cancel'): Result | undefined {
  const actual = kindOf(run)
  return actual === kind ? undefined : { error: `Run ${run.id} is ${actual === 'ask' ? 'an' : 'a'} ${actual} run: call ${actual}_${name}.` }
}
const isImmutable = (run: RunState) => run.target.kind === 'commit' || run.target.kind === 'pr'

async function changedPaths($: EngineInterface, run: RunState, from: string, tree: string, path?: string): Promise<string[]> {
  const list = await git($, ['-C', run.top, 'diff', '--no-renames', '--name-only', '-z', from, tree, ...(path === undefined ? [] : ['--', path])])
  return list.split('\0').filter(entry => entry !== '')
}

async function hasDrifted($: EngineInterface, run: RunState): Promise<boolean> {
  return !isImmutable(run) && (await snapshot($, run.top, run.dir)).tree !== lastTree(run)
}

function fixable(run: RunState): string[] {
  if (run.findingsFile !== undefined || run.status !== 'complete' || isImmutable(run) || run.phases.length >= 3) return []
  const fixed = new Set(run.phases.flatMap(p => Object.entries(p.outcomes ?? {}).flatMap(([id, outcome]) => (outcome === 'fixed' ? [id] : []))))
  return issues(run.findings.filter(isConfirmed)).filter(g => !g.some(f => fixed.has(f.id))).map(g => g[0]!.id)
}

function ended(run: RunState): Result {
  const ids = fixable(run)
  return {
    status: run.status,
    run: run.id,
    report: report(run),
    ...(ids.length > 0 && {
      fixable: ids,
      fix: run.fix,
      instructions: `To fix confirmed findings, ask the user which of ${ids.join(', ')} to fix (all of them when fix is true), then call review_fixes before the first edit.`,
    }),
  }
}

// Runs this process started with --findings, which session.end ends if they are still open.
export const unattended = new Set<string>()
// With --findings no one is present to answer the tier question.
export const hasFindings = (args: string) => split(args).some(word => word === '--findings' || word.startsWith('--findings='))

// The findings file comes before the save that ends the run, so a session.end cut short leaves the run open for reclaim, not ended with no file. Returns why the write failed.
export async function close($: EngineInterface, run: RunState, status: Ending, note?: string): Promise<string | undefined> {
  const phase = run.phases.at(-1)
  run.status = status
  if (note !== undefined) run.note = note
  if (phase !== undefined) phase.state = 'done'
  if (phase !== undefined && phase.number > 0 && phase.outcomes === undefined) {
    phase.outcomes = fixOutcomes(run.findings, { phase: phase.number, selected: phase.selected, isComplete: status === 'complete' })
  }
  const failure = await writeFindings($, run).then(() => undefined, message)
  await save($, run, await $.clock.now())
  return failure
}

// A file already at the path stays, so an older run that ends later does not replace the report of the run that wrote it.
async function writeFindings($: EngineInterface, run: RunState): Promise<void> {
  if (run.findingsFile === undefined || (await $.fs.exists(run.findingsFile))) return
  await $.fs.write(run.findingsFile, JSON.stringify({ run: run.id, ...report(run) }, null, 2))
}

async function end($: EngineInterface, run: RunState, status: Ending, note?: string): Promise<Result> {
  const failure = await close($, run, status, note)
  await cleanup($, run)
  return { ...ended(run), ...(failure !== undefined && { findingsError: failure }) }
}

// The worktrees stay for the next reclaim: session.end has no time to remove them.
export async function endUnattended($: EngineInterface): Promise<void> {
  for (const id of unattended) {
    try {
      const run = await getRun($, id)
      if (run === undefined || isEnded(run)) continue
      const why = run.pause === undefined ? '' : ` while Codex was paused: ${run.pause.error}`
      await close($, run, 'expired', `The session that ran it ended${why}.`)
    } catch {
      // A run that cannot be saved does not keep the others open.
    }
  }
}

function roundResult(run: RunState): Result {
  const phase = phaseOf(run)
  const attempt = current(run, 'claude')!
  return {
    status: 'round',
    run: run.id,
    phase: phase.number,
    round: phase.round,
    agent: { subagent_type: `${reviewerPrefix}${attempt.effort}`, description: description(run, phase), prompt: placeholder },
    instructions: `Send two tool calls in one message: Agent with subagent_type, description, and prompt exactly as in agent, and mcp__confer__review_round with run "${run.id}".`,
  }
}

function waiting(run: RunState, why: string, withAgent = false): Result {
  return {
    ...(withAgent ? roundResult(run) : { run: run.id, phase: phaseOf(run).number, round: phaseOf(run).round }),
    status: 'waiting',
    instructions: `${why} Call review_round again after the Claude reviewer returns.${withAgent ? ' If its Agent call failed before the reviewer started, send that call again as agent gives it.' : ''}`,
  }
}

function paused(run: RunState): Result {
  const { limit, error, retryAt } = run.pause!
  return {
    status: 'paused',
    run: run.id,
    limit,
    error,
    ...(retryAt !== undefined && { retryAt: new Date(retryAt).toISOString() }),
    instructions:
      retryAt === undefined
        ? 'Codex reported a limit. Tell the user, and call review_round again when they ask to retry.'
        : `Codex reported a limit. Call review_round again after ${new Date(retryAt).toISOString()}, which retries Codex.`,
  }
}

function probe(run: RunState): Result {
  const phase = phaseOf(run)
  return {
    status: 'probe',
    run: run.id,
    findings: run.findings.filter(f => f.phase === phase.number && f.status === 'needs-probe'),
    instructions:
      'The reviewers disputed these findings twice. Probe each one: read the code, or run a check that shows whether it holds, and remove any file the probe writes before the next call. Record each result with review_settle.',
  }
}

async function closeLoop($: EngineInterface, run: RunState): Promise<Result> {
  const phase = phaseOf(run)
  if (run.findings.some(f => f.phase === phase.number && f.status === 'needs-probe')) {
    phase.state = 'probe'
    await save($, run, await $.clock.now())
    return probe(run)
  }
  return end($, run, 'complete')
}

// Decided from the state.json on disk, since another session may have resumed a run this process saw end.
async function removeEndedRun($: EngineInterface, root: string, name: string, now: number): Promise<void> {
  const run = await readRun($, name)
  if (run === undefined || !isEnded(run) || run.resources.worktrees.length + run.resources.refs.length > 0 || !(now - run.updatedAt >= week)) return
  // Relative to root, so a relative root cannot double the path.
  const argv = isWindowsPath(run.top || run.repoDir)
    ? ['powershell', '-NoProfile', '-NonInteractive', '-Command', 'Remove-Item -LiteralPath $env:CONFER_RUN_DIR -Recurse -Force']
    : ['rm', '-rf', '--', name]
  const removed = await $.process.run(argv, { cwd: root, env: { CONFER_RUN_DIR: name }, timeoutMs: 600_000 }).catch(() => undefined)
  if (removed?.exitCode === 0) forget(name)
}

// Ends `expired` any open run untouched for a day, removes what ended runs left behind, and deletes the directory of a run that ended a week ago.
export async function reclaim($: EngineInterface): Promise<void> {
  const root = await tmpRoot($)
  const entries = await $.fs.list(root).catch(() => [])
  for (const entry of entries) {
    if (entry.kind !== 'dir' || entry.isLink) continue
    const run = await getRun($, entry.name)
    if (run === undefined) continue
    const now = await $.clock.now()
    if (!isEnded(run) && now - run.updatedAt >= day) await end($, run, 'expired')
    else if (isEnded(run) && run.resources.worktrees.length + run.resources.refs.length > 0) await cleanup($, run)
    else if (isEnded(run)) await removeEndedRun($, root, entry.name, now)
  }
}

// Codex runs with --approve-for-me on Windows (codex/run.ts), so code from someone else is
// reviewed there only on the user's yes.
async function confirmForeign($: EngineInterface, source: string | undefined, isUnattended: boolean): Promise<void> {
  if (source === undefined) return
  const risk = `On Windows, Codex runs without its read-only sandbox, so code in ${source} could steer it into running commands or writing files with your rights.`
  if (isUnattended) throw new Error(`${risk} With --findings no one can be asked, so the review was not started. /code-review reviews it with Claude alone.`)
  const reply = await $.ui.ask(`${risk} Review it with Codex anyway?`, { options: ['Stop (Recommended)', 'Review with Codex'], header: 'Windows' }).catch(() => undefined)
  if (reply !== 'Review with Codex') throw new Error(`The review was not started. /code-review reviews ${source} with Claude alone.`)
}

export async function start($: EngineInterface, input: Input, options: PluginOptions): Promise<Result> {
  await reclaim($)
  const args = String(input.args ?? '')
  const isSure = input.isSure === true || hasFindings(args)
  const choice = await chooseTier($, { command: 'review', pick: input.pick as Tier, isSure, args, fableUsedPercent: input.fableUsedPercent }, options)
  const { target, fix, findings, top, head } = await readTarget($, choice.args, input.pr)
  if (isWindowsPath(top)) await confirmForeign($, await foreignSource($, top, target, head), findings !== undefined)
  const id = crypto.randomUUID().slice(0, 8)
  const now = await $.clock.now()
  const run = remember({
    id,
    dir: `${await tmpRoot($)}/${id}`,
    top,
    repoDir: top,
    target,
    fix,
    ...(findings !== undefined && { findingsFile: findings }),
    args,
    base: '',
    intent: '',
    submodules: [],
    nested: [],
    maxRounds: Number(options.maxRounds ?? 8),
    status: 'running',
    phases: [],
    findings: [],
    attempts: [],
    resources: { worktrees: [], refs: [] },
    createdAt: now,
    updatedAt: now,
  })
  if (findings !== undefined) unattended.add(id)
  await save($, run, now)
  let tree: string
  let paths: string[]
  try {
    tree = await prepare($, run, async () => save($, run, await $.clock.now()))
    paths = await changedPaths($, run, run.base, tree, target.kind === 'path' ? target.path : undefined)
  } catch (error) {
    run.phases.push({ number: 0, tier: choice.tier, claude: choice.claude, codex: choice.codex, ...fallbackOf(choice), round: 0, paths: [], selected: [], state: 'done' })
    await end($, run, 'failed', `The review could not start: ${message(error)}`)
    throw error
  }
  run.phases.push({ number: 0, tier: choice.tier, claude: choice.claude, codex: choice.codex, ...fallbackOf(choice), round: 1, tree, paths, selected: [], state: 'rounds' })
  if (paths.length === 0) return end($, run, 'nothing-to-review')
  newAttempt(run, 'claude')
  await save($, run, await $.clock.now())
  return { ...roundResult(run), target: target.kind, fix, tier: choice.tier, claude: choice.claude, codex: choice.codex, ...fallbackOf(choice) }
}

export async function round($: EngineInterface, input: Input, options: PluginOptions): Promise<Result> {
  const run = await getRun($, input.run)
  if (run === undefined) return { error: `There is no Confer run ${String(input.run)}.` }
  const refused = refuseKind(run, 'review', 'round')
  if (refused !== undefined) return refused
  if (isEnded(run)) return ended(run)
  if (run.phases.length === 0) return { error: `Run ${run.id} never finished starting. Call review_cancel, then review_start again.` }
  if (run.status === 'paused') {
    if (run.pause?.retryAt !== undefined && (await $.clock.now()) < run.pause.retryAt) return paused(run)
    run.status = 'running'
    delete run.pause
  }
  const phase = phaseOf(run)
  if (phase.state === 'probe') return probe(run)
  if (phase.tree === undefined) return openFixPhase($, run)
  await failEndedAgent($, run)

  const state = await runCodexAttempts($, run, options, phase.tree)
  if (state === 'running') return waiting(run, 'Codex is still reviewing this round in another call.')
  if (state === 'paused') return paused(run)
  return advance($, run)
}

async function advance($: EngineInterface, run: RunState): Promise<Result> {
  const phase = phaseOf(run)
  const claude = current(run, 'claude')!
  for (const side of sides) {
    if (failures(run, side) < 2) continue
    // The end removes the worktree the Claude reviewer may be reading, and its reply belongs in the report.
    if (claude.status === 'running') return waiting(run, `${names[side]} failed both attempts of round ${phase.round}, so the run ends incomplete once the Claude reviewer returns.`)
    return end($, run, 'incomplete', `${names[side]} failed both attempts of round ${phase.round}.`)
  }
  if (claude.status === 'failed') {
    newAttempt(run, 'claude')
    await save($, run, await $.clock.now())
    return { ...roundResult(run), retry: claude.failure }
  }
  if (claude.status === 'waiting') return waiting(run, 'The Claude reviewer has not started.', true)
  if (claude.status === 'running') return waiting(run, 'The Claude reviewer has not returned yet.')
  const codex = current(run, 'codex')!
  const drifted = await hasDrifted($, run)
  if (current(run, 'claude') !== claude || current(run, 'codex') !== codex || phase.state !== 'rounds' || isEnded(run)) {
    return waiting(run, 'Another call changed this run.')
  }
  if (drifted) return end($, run, 'drifted', `The checkout changed during round ${phase.round}, so the replies reviewed a state that is gone.`)
  const { findings, changed } = applyRound(run.findings, { phase: phase.number, round: phase.round, replies: { claude: claude.reply!, codex: codex.reply! } })
  run.findings = findings
  phase.stop = stopReason(findings, { phase: phase.number, round: phase.round, changed, maxRounds: run.maxRounds })
  if (phase.stop !== undefined) return closeLoop($, run)
  phase.round++
  newAttempt(run, 'claude')
  await save($, run, await $.clock.now())
  return roundResult(run)
}

async function openFixPhase($: EngineInterface, run: RunState): Promise<Result> {
  const phase = phaseOf(run)
  const { tree } = await snapshot($, run.top, run.dir)
  if (tree === phase.from) return { error: 'The checkout has not changed since review_fixes: write the fixes, then call review_round.' }
  const paths = await changedPaths($, run, phase.from!, tree)
  if (phase.tree !== undefined) return waiting(run, 'Another call opened this fix review.')
  phase.tree = tree
  phase.paths = paths
  newAttempt(run, 'claude')
  await save($, run, await $.clock.now())
  return roundResult(run)
}

export async function settleFinding($: EngineInterface, input: Input): Promise<Result> {
  const run = await getRun($, input.run)
  if (run === undefined) return { error: `There is no Confer run ${String(input.run)}.` }
  const refused = refuseKind(run, 'review', 'round')
  if (refused !== undefined) return refused
  if (isEnded(run)) return ended(run)
  if (phaseOf(run).state !== 'probe') return { error: 'No finding of this run is waiting for a probe.' }
  const { id, outcome, evidence } = input
  if (outcome !== 'confirmed' && outcome !== 'refuted' && outcome !== 'inconclusive') return { error: 'outcome must be confirmed, refuted, or inconclusive.' }
  if (typeof evidence !== 'string' || evidence.trim() === '') return { error: 'evidence must say what the probe showed.' }
  const drifted = await hasDrifted($, run)
  if (isEnded(run) || phaseOf(run).state !== 'probe') return ended(run)
  if (drifted) return end($, run, 'drifted', 'The checkout changed while findings were probed. A probe must remove what it writes.')
  try {
    run.findings = settle(run.findings, String(id), outcome, evidence)
  } catch (error) {
    return { error: message(error) }
  }
  return closeLoop($, run)
}

export async function startFixes($: EngineInterface, input: Input, options: PluginOptions): Promise<Result> {
  const run = await getRun($, input.run)
  if (run === undefined) return { error: `There is no Confer run ${String(input.run)}.` }
  const refused = refuseKind(run, 'review', 'round')
  if (refused !== undefined) return refused
  if (run.status === 'incomplete') return { error: 'An incomplete review cannot be fixed: its findings are single-reviewer.' }
  if (run.status !== 'complete') return { error: `Only a complete review can be fixed, and this run is ${run.status}.` }
  if (isImmutable(run)) return { error: 'A branch, commit, range, or PR review ends with its report. Fixes apply to a review of the checkout or a path.' }
  if (run.phases.length >= 3) return { error: 'Two fix reviews have run, which is the most Confer runs.' }
  const ids = input.ids
  const allowed = fixable(run)
  if (!Array.isArray(ids) || ids.length === 0 || ids.some(id => !allowed.includes(id))) {
    return { error: `ids must list confirmed findings not fixed yet: ${allowed.join(', ') || 'there are none'}.` }
  }
  // With no pick the fix review keeps the review's tier and Codex side, and the Claude side is chosen again when a usage figure is given.
  const first = run.phases[0]!
  const tier =
    input.pick !== undefined
      ? await chooseTier($, { command: 'review', pick: input.pick as Tier, isSure: true, args: run.args ?? '', fableUsedPercent: input.fableUsedPercent }, options)
      : input.fableUsedPercent === undefined || input.fableUsedPercent === null
        ? first
        : { tier: first.tier, codex: first.codex, ...(await refreshClaude($, first.tier, run.args ?? '', options, input.fableUsedPercent)) }
  const drifted = await hasDrifted($, run)
  if (run.status !== 'complete') return ended(run)
  if (drifted) return end($, run, 'drifted', 'The checkout changed after the review and before review_fixes.')
  const from = lastTree(run)
  run.phases.push({ number: run.phases.length, tier: tier.tier, claude: tier.claude, codex: tier.codex, ...fallbackOf(tier), round: 1, from, paths: [], selected: ids, state: 'rounds' })
  run.status = 'running'
  await save($, run, await $.clock.now())
  return {
    status: 'fixing',
    run: run.id,
    phase: phaseOf(run).number,
    selected: ids,
    tier: tier.tier,
    claude: tier.claude,
    codex: tier.codex,
    ...fallbackOf(tier),
    instructions:
      'Write each fix with a regression test that fails before the fix and passes after it. Tell the user that edits anyone else makes to the checkout meanwhile cannot be told apart from the fixes. Then call review_round alone; it returns the first round of the fix review.',
  }
}

export async function cancel($: EngineInterface, input: Input): Promise<Result> {
  const run = await getRun($, input.run)
  if (run === undefined) return { error: `There is no Confer run ${String(input.run)}.` }
  return refuseKind(run, 'review', 'cancel') ?? cancelRun($, run)
}

// The tool that cancels a run is named in the message by the kind of run.
export async function cancelRun($: EngineInterface, run: RunState): Promise<Result> {
  if (isEnded(run)) return ended(run)
  await failEndedAgent($, run)
  if (run.attempts.some(a => a.status === 'running')) {
    return { error: `A reviewer of this run is still running. Interrupt the Agent call first; Codex stops at its own timeout. Then call ${kindOf(run)}_cancel again.` }
  }
  return end($, run, 'cancelled')
}

export async function gitTool($: EngineInterface, input: Input): Promise<Result> {
  const run = await getRun($, input.run)
  if (run === undefined) return { error: `There is no Confer run ${String(input.run)}.` }
  const attempt = !isEnded(run) && run.phases.length > 0 ? current(run, 'claude') : undefined
  if (input.agentId === undefined || attempt?.status !== 'running' || attempt.agentId !== input.agentId) {
    return { error: `Only the Claude reviewer of the current round of run ${run.id} can use this tool.` }
  }
  if (run.top === '') return { error: `Run ${run.id} has no Git repository.` }
  const args = input.args
  if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string')) return { error: 'args must be a list of strings.' }
  return runGitTool($, run.repoDir, args)
}
