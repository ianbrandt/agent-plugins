import type { EngineInterface, PluginOptions } from 'claude-code'
import { isWindowsPath } from '../codex/run'
import { nextTooLarge, readFolder, roundResult, runRound, stopRun, warn } from '../design/design'
import { newAttempt } from '../review/attempts'
import { hasFindings, reclaim, refuseKind, unattended } from '../review/review'
import { getRun, remember, save, tmpRoot } from '../review/state'
import type { RunState } from '../review/state'
import { readFindings } from '../review/target'
import { chooseTier, codexModels } from '../tier/tier'
import type { Tier } from '../tier/tier'

type Input = Record<string, unknown>
type Result = Record<string, unknown>

const flags = ['--tier', '--claude-model', '--claude-effort', '--codex-model', '--codex-effort', '--findings']

// Where the word that starts at `at` ends, by the quote rules of split.
function wordEnd(args: string, at: number): number {
  let quote: string | undefined
  let i = at
  for (; i < args.length; i++) {
    const char = args[i]!
    if (quote !== undefined) {
      if (char === quote) quote = undefined
    } else if (char === '"' || char === "'") quote = char
    else if (/\s/.test(char)) break
  }
  return i
}

// Only leading flags are read. The question is the rest of args from the first other word, and none of it is split into words.
export function splitQuestion(args: string): { flags: string; question: string } {
  const skip = (at: number) => at + (/^\s*/.exec(args.slice(at))?.[0].length ?? 0)
  let at = skip(0)
  while (at < args.length) {
    const raw = /^\S*/.exec(args.slice(at))![0]
    if (!flags.some(flag => raw === flag || raw.startsWith(`${flag}=`))) break
    at = skip(wordEnd(args, at))
    if (!raw.includes('=') && at < args.length) at = skip(wordEnd(args, at))
  }
  return { flags: args.slice(0, at), question: args.slice(at).trim() }
}

const slashed = (path: string) => (isWindowsPath(path) ? path.replace(/\\/g, '/') : path).replace(/\/+$/, '')

// A path that does not exist yet, such as the run root before the first run, is resolved through its nearest parent that does.
async function realPath($: EngineInterface, path: string): Promise<string> {
  const real = (await $.fs.stat(path, { resolve: true }).catch(() => undefined))?.realPath
  if (real !== undefined) return slashed(real)
  const at = slashed(path).lastIndexOf('/')
  const parent = slashed(path).slice(0, at)
  // On Windows, a bare drive such as C: is the current folder of that drive, not its root.
  if (at <= 0 || /^[A-Za-z]:$/.test(parent)) return slashed(path)
  return `${await realPath($, parent)}${slashed(path).slice(at)}`
}

// A real path keeps a case alias's spelling, so case is folded on a volume that ignores it: one where the folder is also found with its case swapped, as on macOS and Windows by default.
async function contains($: EngineInterface, folder: string, path: string): Promise<boolean> {
  const swapped = [...folder].map(c => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase())).join('')
  const isFolded = isWindowsPath(folder) || (swapped !== folder && (await $.fs.stat(swapped).then(() => true, () => false)))
  const [dir, inner] = isFolded ? [folder.toLowerCase(), path.toLowerCase()] : [folder, path]
  return inner === dir || inner.startsWith(`${dir}/`)
}

export async function startAsk($: EngineInterface, input: Input, options: PluginOptions): Promise<Result> {
  await reclaim($)
  const { flags: words, question } = splitQuestion(String(input.args ?? ''))
  if (question === '') throw new Error('Confer needs a question: type it after the flags.')
  const choice = await chooseTier($, { command: 'question', pick: input.pick as Tier, isSure: input.isSure === true || hasFindings(words), args: words }, codexModels(options))
  const { findings, rest } = await readFindings($, choice.args, false)
  if (rest.length > 0) throw new Error(`${rest.join(' ')} is not an option of the ask command.`)
  const { top, folder, why } = await readFolder($)
  const root = await tmpRoot($)
  const realRoot = await realPath($, root)
  // Each side's reply is in the run directory as soon as it arrives, so the other side must not be able to read it.
  if (await contains($, await realPath($, folder), realRoot)) throw new Error(`Confer keeps its runs in ${realRoot}, which is inside ${folder}: ask from a folder that does not contain ${realRoot}.`)
  const id = crypto.randomUUID().slice(0, 8)
  const now = await $.clock.now()
  const run: RunState = {
    id,
    dir: `${root}/${id}`,
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
    ask: { question, root: realRoot },
    status: 'running',
    phases: [{ number: 0, tier: choice.tier, claude: choice.claude, codex: choice.codex, round: 1, paths: [], selected: [], state: 'rounds' }],
    findings: [],
    attempts: [],
    resources: { worktrees: [], refs: [] },
    createdAt: now,
    updatedAt: now,
  }
  const large = nextTooLarge(run)
  if (large !== undefined) return large
  newAttempt(run, 'claude')
  remember(run)
  if (findings !== undefined) unattended.add(id)
  await save($, run, await $.clock.now())
  return warn({ ...roundResult(run), question, tier: choice.tier, claude: choice.claude, codex: choice.codex }, run, why)
}

const notFound = (id: unknown) => ({ error: `There is no Confer run ${String(id)}.` })

export async function askRound($: EngineInterface, input: Input, options: PluginOptions): Promise<Result> {
  const run = await getRun($, input.run)
  if (run === undefined) return notFound(input.run)
  return refuseKind(run, 'ask', 'round') ?? runRound($, run, options)
}

export async function askCancel($: EngineInterface, input: Input): Promise<Result> {
  const run = await getRun($, input.run)
  if (run === undefined) return notFound(input.run)
  return refuseKind(run, 'ask', 'cancel') ?? stopRun($, run)
}
