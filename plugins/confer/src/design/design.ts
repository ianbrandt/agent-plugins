import type { EngineInterface, PluginOptions } from 'claude-code'
import { isWindowsPath, refuseGitRouting } from '../codex/run'
import { setContent } from './brief'
import { codexModels, chooseTier } from '../tier/tier'
import type { Tier } from '../tier/tier'
import { current, attemptsOf, description, failures, newAttempt, phaseOf, reviewerPrefix } from '../review/attempts'
import { view } from '../review/brief'
import { applyRound, stopReason } from '../review/consensus'
import { report } from '../review/report'
import { cancelRun, close, hasFindings, reclaim, refuseKind, unattended } from '../review/review'
import { getRun, isEnded, remember, save, tmpRoot } from '../review/state'
import { readFindings } from '../review/target'
import type { Ending, RunState } from '../review/state'
import { cleanup, failEndedAgent, runCodexAttempts } from '../review/steps'
import type { ReviewSide } from '../review/types'

type Input = Record<string, unknown>
type Result = Record<string, unknown>

const sides: readonly ReviewSide[] = ['claude', 'codex']
const names: Record<ReviewSide, string> = { claude: 'Claude', codex: 'Codex' }
const placeholder = 'Confer replaces this prompt with the review prompt of the round.'
const promptLimitBytes = 256 * 2 ** 10
// The waiting Claude prompt is stored JSON-escaped in state.json. 256 KiB, about 65K tokens, leaves most of a 200K-token context for the repository.
function tooLarge(run: RunState, prompt: string): Result | undefined {
  const size = new TextEncoder().encode(JSON.stringify(prompt)).length
  if (size <= promptLimitBytes) return undefined
  const what = run.ask === undefined ? "The document is too large to review: the reviewer's prompt with its latest version and diff" : 'The question is too large: the prompt with the question and the answers so far'
  return { error: `${what} is ${Math.ceil(size / 2 ** 10)} KiB as JSON, over the limit of ${promptLimitBytes / 2 ** 10} KiB.` }
}
// An ask run measures both sides' next prompts on a copy, so a refused round leaves the run as it was.
export const nextTooLarge = (run: RunState) => sides.map(side => tooLarge(run, newAttempt({ ...run, attempts: [...run.attempts] }, side).prompt)).find(large => large !== undefined)
const tool = (run: RunState, name: string) => `${run.ask === undefined ? 'plan' : 'ask'}_${name}`
const sha256 = async (text: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('')

// Confer 0.7.0 stored the text of each version in state.json, with no hash.
const older = (run: RunState) =>
  run.design!.versions.some(v => v.sha256 === undefined) ? { error: `An earlier version of Confer started run ${run.id}, and this one cannot continue it: cancel it with plan_cancel and start a new one.` } : undefined

// Only the hashes of a version are stored in state.json, so a round reads the text and diff back from the run directory.
async function load($: EngineInterface, run: RunState): Promise<Result | undefined> {
  const version = run.design!.versions.at(-1)!
  const read = async (what: string, path: string, hash: string) => {
    const text = await $.fs.read(path).catch(() => undefined)
    if (text !== undefined && (await sha256(text)) === hash) return { text }
    return { error: `${what}, ${path}, is missing or changed: cancel the run with plan_cancel.` }
  }
  const text = await read(`Version ${version.number} of the document`, `${run.dir}/v${version.number}.md`, version.sha256)
  if ('error' in text) return text
  const diff = version.diffSha256 === undefined ? undefined : await read(`The diff of version ${version.number} of the document`, `${run.dir}/v${version.number}.diff`, version.diffSha256)
  if (diff !== undefined && 'error' in diff) return diff
  setContent(version, { text: text.text, ...(diff !== undefined && { diff: diff.text }) })
  return undefined
}
const message = (error: unknown) => (error instanceof Error ? error.message : String(error))
const notFound = (id: unknown) => ({ error: `There is no Confer run ${String(id)}.` })

function ended(run: RunState): Result {
  const what = run.ask === undefined ? { design: { path: run.design!.path, version: run.design!.versions.at(-1)!.number } } : { question: run.ask.question }
  return { status: run.status, run: run.id, ...what, report: report(run) }
}

async function end($: EngineInterface, run: RunState, status: Ending, note?: string): Promise<Result> {
  const failure = await close($, run, status, note)
  await cleanup($, run)
  return { ...ended(run), ...(failure !== undefined && { findingsError: failure }) }
}

export function roundResult(run: RunState): Result {
  const phase = phaseOf(run)
  const attempt = current(run, 'claude')!
  return {
    status: 'round',
    run: run.id,
    round: phase.round,
    agent: { subagent_type: `${reviewerPrefix}${attempt.effort}`, description: description(run, phase), prompt: placeholder },
    instructions: `Send two tool calls in one message: Agent with subagent_type, description, and prompt exactly as in agent, and mcp__confer__${tool(run, 'round')} with run "${run.id}".`,
  }
}

function waiting(run: RunState, why: string, withAgent = false): Result {
  return {
    ...(withAgent ? roundResult(run) : { run: run.id, round: phaseOf(run).round }),
    status: 'waiting',
    instructions: `${why} Call ${tool(run, 'round')} again after the Claude reviewer returns.${withAgent ? ' If its Agent call failed before the reviewer started, send that call again as agent gives it.' : ''}`,
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
        ? `Codex reported a limit. Tell the user, and call ${tool(run, 'round')} again when they ask to retry.`
        : `Codex reported a limit. Call ${tool(run, 'round')} again after ${new Date(retryAt).toISOString()}, which retries Codex.`,
  }
}

function revise(run: RunState): Result {
  const points = run.findings.filter(f => f.phase === 0)
  const withStatus = (status: string) => points.filter(f => f.status === status).map(view)
  return {
    status: 'revise',
    run: run.id,
    round: phaseOf(run).round,
    file: run.design!.path,
    agreed: withStatus('agreed'),
    disputed: withStatus('disputed'),
    open: withStatus('open'),
    instructions: `Revise ${run.design!.path} per the plan skill, with no round running, then call plan_revision with run "${run.id}" and notes.`,
  }
}

export async function startDesign($: EngineInterface, input: Input, options: PluginOptions): Promise<Result> {
  await reclaim($)
  const args = String(input.args ?? '')
  const choice = await chooseTier($, { command: 'plan', pick: input.pick as Tier, isSure: input.isSure === true || hasFindings(args), args }, codexModels(options))
  const { findings, rest } = await readFindings($, choice.args, false)
  const [path, ...more] = rest
  if (path === undefined || more.length > 0) throw new Error('Confer reviews one file: pass its path as the one argument.')
  if (path.startsWith('-')) throw new Error(`${path} is not an option of the plan command.`)
  const text = await $.fs.read(path).catch(() => undefined)
  const real = text === undefined ? undefined : (await $.fs.stat(path, { resolve: true }).catch(() => undefined))?.realPath
  if (text === undefined || real === undefined) throw new Error(`There is no file ${path}.`)
  const { top, folder, why } = await readFolder($)
  const id = crypto.randomUUID().slice(0, 8)
  const now = await $.clock.now()
  const v1 = { number: 1, sha256: await sha256(text) }
  setContent(v1, { text })
  const run: RunState = {
    id,
    dir: `${await tmpRoot($)}/${id}`,
    top,
    repoDir: folder,
    target: { kind: 'checkout' },
    fix: false,
    ...(findings !== undefined && { findingsFile: findings }),
    base: '',
    intent: '',
    submodules: [],
    nested: [],
    maxRounds: Number(options.maxRounds ?? 8),
    design: { path: real, versions: [v1] },
    status: 'running',
    phases: [{ number: 0, tier: choice.tier, claude: choice.claude, codex: choice.codex, round: 1, paths: [], selected: [], state: 'rounds' }],
    findings: [],
    attempts: [],
    resources: { worktrees: [], refs: [] },
    createdAt: now,
    updatedAt: now,
  }
  const large = tooLarge(run, newAttempt(run, 'claude').prompt)
  if (large !== undefined) return large
  remember(run)
  if (findings !== undefined) unattended.add(id)
  await $.fs.write(`${run.dir}/v1.md`, text)
  await save($, run, await $.clock.now())
  return warn({ ...roundResult(run), tier: choice.tier, claude: choice.claude, codex: choice.codex }, run, why)
}

// The checkout's top, or outside a checkout an empty top and the session's folder, with Git's reason.
export async function readFolder($: EngineInterface): Promise<{ top: string; folder: string; why: string }> {
  await refuseGitRouting($)
  // Any failure of rev-parse means no checkout, since Git's message is localized; the user sees that message.
  const found = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { timeoutMs: 600_000 })
  if (found.exitCode === 0 && found.isStdoutTruncated) throw new Error('The output of git rev-parse --show-toplevel was truncated.')
  const top = found.exitCode === 0 ? found.stdout.trim() : ''
  const cwd = top === '' ? await $.session.cwd() : ''
  const folder = top === '' ? (isWindowsPath(cwd) ? cwd.replace(/\\/g, '/') : cwd) : top
  return { top, folder, why: found.stderr.trim() }
}

export function warn(result: Result, run: RunState, why: string): Result {
  if (run.top !== '') return result
  const warning = `Confer found no Git checkout, so the reviewers read the files in ${run.repoDir}.${why === '' ? '' : ` git rev-parse: ${why}`}`
  return { ...result, warning, instructions: `Tell the user the warning. ${result.instructions}` }
}

export async function designRound($: EngineInterface, input: Input, options: PluginOptions): Promise<Result> {
  const run = await getRun($, input.run)
  if (run === undefined) return notFound(input.run)
  const refused = refuseKind(run, 'plan', 'round')
  if (refused !== undefined) return refused
  return runRound($, run, options)
}

// The round of a plan or an ask run.
export async function runRound($: EngineInterface, run: RunState, options: PluginOptions): Promise<Result> {
  if (isEnded(run)) return ended(run)
  if (run.status === 'paused') {
    if (run.pause?.retryAt !== undefined && (await $.clock.now()) < run.pause.retryAt) return paused(run)
    run.status = 'running'
    delete run.pause
  }
  if (current(run, 'claude') === undefined) return run.ask === undefined ? revise(run) : nextRound($, run)
  if (run.ask === undefined) {
    const missing = older(run) ?? (await load($, run))
    if (missing !== undefined) return missing
  }
  await failEndedAgent($, run)
  const state = await runCodexAttempts($, run, options)
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
  if (current(run, 'claude') !== claude || current(run, 'codex') !== codex || phase.state !== 'rounds' || isEnded(run)) {
    return waiting(run, 'Another call changed this run.')
  }
  const isAsk = run.ask !== undefined
  const { findings, changed } = applyRound(run.findings, { phase: 0, round: phase.round, replies: { claude: claude.reply!, codex: codex.reply! }, isDesign: true, isAsk })
  run.findings = findings
  phase.stop = stopReason(findings, { phase: 0, round: phase.round, changed, maxRounds: run.maxRounds, isDesign: true, isAsk })
  if (phase.stop !== undefined) return end($, run, 'complete')
  phase.round++
  if (isAsk) return nextRound($, run)
  await save($, run, await $.clock.now())
  return revise(run)
}

// An ask run has nothing to revise, so the next round starts at once, unless a prompt would be over the limit.
async function nextRound($: EngineInterface, run: RunState): Promise<Result> {
  const large = nextTooLarge(run)
  if (large !== undefined) return end($, run, 'incomplete', String(large.error))
  newAttempt(run, 'claude')
  await save($, run, await $.clock.now())
  return roundResult(run)
}

export async function reviseDesign($: EngineInterface, input: Input): Promise<Result> {
  const run = await getRun($, input.run)
  if (run === undefined) return notFound(input.run)
  const refused = refuseKind(run, 'plan', 'round')
  if (refused !== undefined) return refused
  if (isEnded(run)) return ended(run)
  const phase = phaseOf(run)
  if (run.status !== 'running' || sides.some(side => attemptsOf(run, side).length > 0)) {
    return { error: `Round ${phase.round} of run ${run.id} is under way: call plan_round, and revise the document after it returns a revision.` }
  }
  const before = older(run)
  if (before !== undefined) return before
  const { path, versions } = run.design!
  const number = phase.round
  const previous = versions.at(-1)!
  const text = await $.fs.read(path).catch(() => undefined)
  if (text === undefined) return { error: `The file ${path} cannot be read.` }
  const hash = await sha256(text)
  await $.fs.write(`${run.dir}/v${number}.md`, text)
  let diff: string | undefined
  if (hash !== previous.sha256) {
    await refuseGitRouting($)
    const result = await $.process.run(['git', '-C', run.dir, 'diff', '--no-index', '--no-ext-diff', '--no-textconv', '--no-color', `v${previous.number}.md`, `v${number}.md`], { timeoutMs: 600_000 })
    if (result.exitCode !== 0 && result.exitCode !== 1) throw new Error(`git diff exited ${result.exitCode}: ${result.stderr.trim()}`)
    diff = result.stdout
  }
  const notes = typeof input.notes === 'string' && input.notes.trim() !== '' ? input.notes : undefined
  const version = { number, sha256: hash, ...(diff !== undefined && { diffSha256: await sha256(diff) }), ...(notes !== undefined && { notes }) }
  setContent(version, { text, ...(diff !== undefined && { diff }) })
  // The prompt is measured on a copy, so a refused revision leaves the run as it was.
  const large = tooLarge(run, newAttempt({ ...run, design: { path, versions: [...versions, version] }, attempts: [...run.attempts] }, 'claude').prompt)
  if (large !== undefined) return large
  if (diff !== undefined) await $.fs.write(`${run.dir}/v${number}.diff`, diff)
  versions.push(version)
  newAttempt(run, 'claude')
  await save($, run, await $.clock.now())
  return roundResult(run)
}

export async function cancelDesign($: EngineInterface, input: Input): Promise<Result> {
  const run = await getRun($, input.run)
  if (run === undefined) return notFound(input.run)
  const refused = refuseKind(run, 'plan', 'cancel')
  if (refused !== undefined) return refused
  return stopRun($, run)
}

// Cancels a plan or an ask run.
export async function stopRun($: EngineInterface, run: RunState): Promise<Result> {
  const result = await cancelRun($, run)
  return isEnded(run) ? { ...ended(run), ...('findingsError' in result && { findingsError: result.findingsError }) } : result
}
