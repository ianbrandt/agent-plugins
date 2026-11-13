import type { EngineInterface, ModelEffort } from 'claude-code'
import type { CodexRunResult } from '../codex/run'
import type { CodexUsage } from '../codex/events'
import type { Fallback, Tier } from '../tier/tier'
import type { ClaudeUsage } from './cost'
import type { Finding, FixOutcome, Reply, ReviewSide } from './types'

export type Pr = { url: string; number: number; title: string; body: string; headRefOid: string; baseRefName: string }

export type Target = { kind: 'checkout' } | { kind: 'path'; path: string } | { kind: 'commit'; ref: string; base?: string } | { kind: 'pr'; pr: Pr }

export type Ending = 'complete' | 'nothing-to-review' | 'incomplete' | 'drifted' | 'cancelled' | 'expired' | 'failed'

// The text is in v<number>.md of the run directory, and the diff from the previous version, when it differs, in v<number>.diff.
export type DesignVersion = { number: number; sha256: string; diffSha256?: string; notes?: string }

export type Side = { model: string; effort: ModelEffort }

export type Attempt = {
  phase: number
  round: number
  side: ReviewSide
  number: number
  // `limited`: Codex reported a usage, budget, or rate limit, which uses no attempt.
  status: 'waiting' | 'running' | 'replied' | 'failed' | 'limited'
  prompt: string
  model: string
  effort: ModelEffort
  raw?: string
  reply?: Reply
  failure?: string
  resolvedModel?: string
  usage?: ClaudeUsage | CodexUsage
  costUsd?: number | null
  toolUseId?: string
  agentId?: string
  startedAt?: number
  codex?: Omit<CodexRunResult, 'reply' | 'usage' | 'costUsd' | 'model' | 'effort'>
}

export type Phase = {
  // 0 is the review; 1 and 2 are fix phases.
  number: number
  tier: Tier
  claude: Side
  codex: Side
  // Set when a Fable tier ran on Opus instead.
  fallback?: Fallback
  round: number
  // The reviewed tree; for a fix phase, the fixed tree, once its first review_round has snapshotted it.
  tree?: string
  // The changed paths: from the base for the review, from `from` for a fix phase.
  paths: string[]
  // A fix phase: the tree the fixes were written on, and the findings they fix.
  from?: string
  selected: string[]
  state: 'rounds' | 'probe' | 'done'
  stop?: 'consensus' | 'stalled' | 'max-rounds'
  outcomes?: Record<string, FixOutcome>
}

export type RunState = {
  id: string
  dir: string
  // Empty for a design run outside a checkout, and then repoDir is the session's folder. Otherwise the user's checkout, and the directory both reviewers read: the checkout, or a worktree at the head.
  top: string
  repoDir: string
  target: Target
  fix: boolean
  base: string
  head?: string
  intent: string
  submodules: string[]
  // Untracked nested repositories, which are not in the reviewed tree.
  nested: string[]
  maxRounds: number
  // A design run: the file the conductor revises, and each round's version of it.
  design?: { path: string; versions: DesignVersion[] }
  // An ask run: the question as the user typed it, and the real path of the run root, which neither side may read.
  ask?: { question: string; root: string }
  status: 'running' | 'paused' | Ending
  pause?: { limit: string; error: string; retryAt?: number }
  note?: string
  // An unattended run: the absolute path its report is written to when it ends.
  findingsFile?: string
  // A review's arguments as typed, so a fix review at a picked tier keeps the tier flags.
  args?: string
  phases: Phase[]
  findings: Finding[]
  attempts: Attempt[]
  // Listed before each is created, and dropped once it is removed.
  resources: { worktrees: string[]; refs: string[] }
  createdAt: number
  updatedAt: number
}

export const endings: readonly string[] = ['complete', 'nothing-to-review', 'incomplete', 'drifted', 'cancelled', 'expired', 'failed']
export const isEnded = (run: RunState) => endings.includes(run.status)

const runs = new Map<string, RunState>()
// Runs this process created or wrote. Any other run is read again from state.json, since another session may be running it.
const owned = new Set<string>()
// The state.json text each copy read from disk was parsed from.
const readFrom = new WeakMap<RunState, string>()
let writing: Promise<unknown> = Promise.resolve()

export const inMemory = () => [...runs.values()]

export async function tmpRoot($: EngineInterface): Promise<string> {
  const config = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${(await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))}/.claude`
  return `${config.replace(/[\\/]+$/, '')}/tmp/confer`
}

export function remember(run: RunState): RunState {
  runs.set(run.id, run)
  owned.add(run.id)
  return run
}

export function forget(id: string): void {
  runs.delete(id)
  owned.delete(id)
}

async function readText($: EngineInterface, id: string): Promise<string | undefined> {
  return $.fs.read(`${await tmpRoot($)}/${id}/state.json`).catch(() => undefined)
}

function parse(text: string | undefined): RunState | undefined {
  if (text === undefined) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

// The state.json on disk, whatever this process holds in memory.
export async function readRun($: EngineInterface, id: string): Promise<RunState | undefined> {
  return parse(await readText($, id))
}

export async function getRun($: EngineInterface, id: unknown): Promise<RunState | undefined> {
  if (typeof id !== 'string' || !/^[0-9a-f]{8}$/.test(id)) return undefined
  let text: string | undefined
  // A copy another call caches during the read may come from an earlier or a later state.json, so the read is retried, after that copy's read ended, until no other call cached one.
  for (let before = runs.get(id); ; before = runs.get(id)) {
    text = await readText($, id)
    if (runs.get(id) === before) break
  }
  const disk = parse(text)
  const cached = runs.get(id)
  // A save of an owned copy may not have landed yet. An unowned copy is kept only while state.json is the text it was read from, since an equal updatedAt can hide another session's save.
  if (cached !== undefined) {
    const isNewerOnDisk = disk !== undefined && disk.updatedAt > cached.updatedAt
    const isOwned = owned.has(id)
    const isUnchanged = text !== undefined && readFrom.get(cached) === text
    if (!isNewerOnDisk && (isOwned || isUnchanged)) return cached
  }
  if (disk === undefined) {
    forget(id)
    return undefined
  }
  // No attempt of a run read from disk runs in this process, so a retry and review_cancel can go ahead.
  for (const attempt of disk.attempts) {
    if (attempt.status === 'running') Object.assign(attempt, { status: 'failed', failure: 'The session that ran it ended.' })
  }
  forget(id)
  runs.set(id, disk)
  readFrom.set(disk, text!)
  return disk
}

const writeLimitBytes = 4 * 2 ** 20

// Only the reviewer that has not started reads its prompt back; a retry builds a new one.
const keepsPrompt = (a: Attempt) => a.side === 'claude' && a.status === 'waiting'

// shortcut: past 4 MiB, the replies of earlier rounds are left out of state.json; move them to files of their own if R5 or R10 need them.
function serialize(run: RunState): string {
  const slim = { ...run, attempts: run.attempts.map(a => (keepsPrompt(a) ? a : { ...a, prompt: undefined })) }
  const text = JSON.stringify(slim, null, 2)
  if (new TextEncoder().encode(text).length <= writeLimitBytes) return text
  const phase = run.phases.at(-1)
  const isCurrent = (a: Pick<Attempt, 'phase' | 'round'>) => a.phase === phase?.number && a.round === phase.round
  return JSON.stringify({ ...slim, attempts: slim.attempts.map(a => (isCurrent(a) ? a : { ...a, raw: undefined })) }, null, 2)
}

// The state is serialized at once and written in call order, so a later write never lands first.
export function save($: EngineInterface, run: RunState, now: number): Promise<void> {
  // Only the cached copy is saved, since a copy read again from state.json or forgotten would undo what is there.
  if (runs.get(run.id) !== run) return Promise.reject(new Error(`Run ${run.id} was read again from state.json while this call ran, so the call stopped without saving. Call it again.`))
  owned.add(run.id)
  // A save queued with an earlier time must not move the stamp back past one already written.
  run.updatedAt = Math.max(now, run.updatedAt ?? 0)
  const text = serialize(run)
  const write = writing.then(() => $.fs.write(`${run.dir}/state.json`, text))
  writing = write.catch(() => undefined)
  return write
}
