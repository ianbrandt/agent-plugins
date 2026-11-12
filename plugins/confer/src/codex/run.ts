import type { EngineInterface, ProcessRunResult, ProcessSpawnResult } from 'claude-code'
import { estimateCostUsd } from './cost'
import { classify, parseEvents } from './events'
import type { CodexUsage, LimitStatus } from './events'
import { addWorktree, fillWorktree, git, removeWorktree } from './worktree'

export type CodexRunRequest = {
  repo: string
  // False for a folder outside any checkout, where Confer runs no Git.
  isCheckout: boolean
  outDir: string
  prompt: string
  model: string
  effort: string
  worktree: boolean
  // The reviewed state as a tree object, which a worktree checks out in place of the checkout's index.
  tree?: string
  // Bounds the Codex process only.
  timeoutMs?: number
}

export type CodexRunResult = {
  status: 'completed' | 'failed' | 'timeout' | LimitStatus
  reply?: string
  error?: string
  retryAt?: string
  threadId?: string
  model: string
  effort: string
  effectiveModel?: string
  effectiveEffort?: string
  usage?: CodexUsage
  costUsd: number | null
  warnings: string[]
  exitCode: number | null
  elapsedMs: number
  argv: readonly string[]
  codexVersion?: string
  worktreeLeft?: string
}

type Output = { stdout: string; stderr: string }

const minimumVersion = [0, 167, 0]
const gitTimeoutMs = 600_000
// Well under the 4 MiB that $.fs.write accepts.
const writeLimitBytes = 3 * 2 ** 20

// Git for Windows prints a checkout as C:/dir, or a UNC one as //server/share; Windows itself uses backslashes.
export const isWindowsPath = (path: string) => /^([A-Za-z]:[\\/]|\/\/|\\\\)/.test(path)

// Throws only for a caller error or a refused Git variable; every other failure ends in the result.
export async function runCodex($: EngineInterface, request: CodexRunRequest): Promise<CodexRunResult> {
  const { repo, outDir, prompt, model, effort, timeoutMs = 1_800_000 } = request
  if (!(timeoutMs > 0)) throw new Error(`timeoutMs must be positive, not ${timeoutMs}.`)
  for (const path of [repo, outDir]) if (!/^([A-Za-z]:)?[\\/]/.test(path)) throw new Error(`${path} is not an absolute path`)
  await refuseGitRouting($)
  const { isCheckout } = request
  const top = isCheckout ? (await git($, ['-C', repo, 'rev-parse', '--show-toplevel'])).trim() : repo
  const isWindows = isWindowsPath(top)
  const dir = await outputDir($, outDir, isCheckout ? top : undefined, isWindows)

  const started = await $.clock.now()
  const result: CodexRunResult = { status: 'failed', model, effort, costUsd: null, warnings: [], exitCode: null, elapsedMs: 0, argv: [] }
  const output: Output = { stdout: '', stderr: '' }
  try {
    result.codexVersion = await codexVersion($)
    const worktree = isCheckout && isWindows && request.worktree && !(await isWorktreeOffHere($, top)) ? `${dir}-worktree` : undefined
    if (isCheckout) {
      // Without a fresh index, `git status` under Codex's sandbox reruns the Git LFS clean filter,
      // which cannot write .git/lfs/tmp there.
      await $.process.run(['git', '-C', top, 'update-index', '-q', '--refresh'], { timeoutMs: gitTimeoutMs })
    }
    if (worktree === undefined) {
      // Outside a checkout on Windows, approve-for-me writes land in the output directory.
      await review($, request, timeoutMs, isCheckout || !isWindows ? top : dir, isWindows, result, output)
    } else {
      result.warnings.push(...(await unreproducible($, top, request.tree !== undefined)))
      const staged = await addWorktree($, top, worktree, request.tree)
      try {
        result.warnings.push(...(await fillWorktree($, top, worktree, staged)))
        // The worktree shares the checkout's refs and config, and Codex runs there with --approve-for-me.
        const before = await gitState($, top)
        try {
          await review($, request, timeoutMs, worktree, isWindows, result, output)
        } finally {
          result.warnings.push(...stateChanges(before, await gitState($, top)))
        }
      } finally {
        result.worktreeLeft = await removeWorktree($, top, worktree)
      }
    }
  } catch (error) {
    result.status = 'failed'
    result.error = error instanceof Error ? error.message : String(error)
  } finally {
    result.elapsedMs = (await $.clock.now()) - started
    await writeArtifact($, `${dir}/codex-events.jsonl`, output.stdout, result.warnings)
    await writeArtifact($, `${dir}/codex-stderr.txt`, output.stderr, result.warnings)
  }
  return result
}

// Resolves outDir's real path. It is refused when the run's files or worktree would land in the checkout, if there is one.
// Case is folded everywhere, since a real path keeps a case alias's spelling.
async function outputDir($: EngineInterface, outDir: string, top: string | undefined, isWindows: boolean): Promise<string> {
  const resolve = async (path: string) => {
    const stat = await $.fs.stat(path, { resolve: true }).catch(() => undefined)
    if (stat === undefined) throw new Error(`${path} does not exist`)
    if (stat.realPath === undefined) throw new Error(`Could not resolve ${path}`)
    return { kind: stat.kind, path: (isWindows ? stat.realPath.replace(/\\/g, '/') : stat.realPath).replace(/\/+$/, '') }
  }
  const out = await resolve(outDir)
  if (out.kind !== 'dir') throw new Error(`${outDir} is not a directory`)
  if (/^([A-Za-z]:)?$/.test(out.path)) throw new Error(`${outDir} is a filesystem root`)
  if (top === undefined) return out.path
  const checkout = (await resolve(top)).path.toLowerCase()
  const isInside = (path: string) => path.toLowerCase() === checkout || path.toLowerCase().startsWith(`${checkout}/`)
  const outTop = await $.process.run(['git', '-C', out.path, 'rev-parse', '--show-toplevel'], { timeoutMs: gitTimeoutMs })
  if (isInside(out.path) || (outTop.exitCode === 0 && isInside((await resolve(outTop.stdout.trim())).path))) {
    throw new Error(`${outDir} is inside the checkout`)
  }
  if (isInside(`${out.path}-worktree`)) throw new Error(`${out.path}-worktree would be inside the checkout`)
  return out.path
}

// A failed write is a warning, so the result is never lost.
async function writeArtifact($: EngineInterface, path: string, text: string, warnings: string[]): Promise<void> {
  const bytes = new TextEncoder().encode(text)
  let start = Math.max(0, bytes.length - writeLimitBytes)
  while ((bytes[start]! & 0xc0) === 0x80) start++
  try {
    await $.fs.write(path, start === 0 ? text : new TextDecoder().decode(bytes.subarray(start)))
    if (start > 0) warnings.push(`Only the last part of ${path} was written: the first ${start} bytes were dropped.`)
  } catch (error) {
    warnings.push(`Could not write ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function refuseGitRouting($: EngineInterface): Promise<void> {
  // $.env.get takes only literal names.
  const routing = {
    GIT_DIR: await $.env.get('GIT_DIR'),
    GIT_WORK_TREE: await $.env.get('GIT_WORK_TREE'),
    GIT_INDEX_FILE: await $.env.get('GIT_INDEX_FILE'),
    GIT_OBJECT_DIRECTORY: await $.env.get('GIT_OBJECT_DIRECTORY'),
    GIT_ALTERNATE_OBJECT_DIRECTORIES: await $.env.get('GIT_ALTERNATE_OBJECT_DIRECTORIES'),
    GIT_COMMON_DIR: await $.env.get('GIT_COMMON_DIR'),
    GIT_LITERAL_PATHSPECS: await $.env.get('GIT_LITERAL_PATHSPECS'),
    GIT_NOGLOB_PATHSPECS: await $.env.get('GIT_NOGLOB_PATHSPECS'),
    GIT_GLOB_PATHSPECS: await $.env.get('GIT_GLOB_PATHSPECS'),
    GIT_ICASE_PATHSPECS: await $.env.get('GIT_ICASE_PATHSPECS'),
  }
  const name = Object.entries(routing).find(([, value]) => value !== undefined)?.[0]
  if (name !== undefined) throw new Error(`Confer does not run Git while ${name} is set in the environment Claude Code passes to Git.`)
}

// Streamed, since a listing of a large checkout can be over the 4 MiB that $.process.run keeps.
export async function eachRecord($: EngineInterface, argv: string[], separator: string, visit: (record: string) => unknown): Promise<number | null> {
  let rest = ''
  const stream = $.process.spawn({ argv })
  for (;;) {
    const piece = await stream.next()
    if (piece.done) {
      if (rest !== '') await visit(rest)
      return piece.value.code
    }
    if (piece.value.stream !== 'stdout') continue
    const records = (rest + piece.value.text).split(separator)
    rest = records.pop()!
    for (const record of records) await visit(record)
  }
}

type GitState = { refs: string[]; config: string[] }

// Never rejects: undefined when either listing fails.
async function gitState($: EngineInterface, top: string): Promise<GitState | undefined> {
  const state: GitState = { refs: [], config: [] }
  try {
    const codes = [
      await eachRecord($, ['git', '-C', top, 'for-each-ref', '--format=%(refname) %(objectname)'], '\n', ref => state.refs.push(ref)),
      await eachRecord($, ['git', '-C', top, 'config', '--local', '--list', '-z'], '\0', entry => state.config.push(entry)),
    ]
    return codes.every(code => code === 0) ? state : undefined
  } catch {
    return undefined
  }
}

function stateChanges(before: GitState | undefined, after: GitState | undefined): string[] {
  if (before === undefined || after === undefined) return ['Could not compare the refs and local Git config of the checkout before and after Codex ran.']
  const changed = (was: string[], is: string[], name: (record: string) => string) => {
    const [wasSet, isSet] = [new Set(was), new Set(is)]
    return [...new Set([...was.filter(r => !isSet.has(r)), ...is.filter(r => !wasSet.has(r))].map(name))].sort()
  }
  const refs = changed(before.refs, after.refs, ref => ref.split(' ')[0]!)
  const keys = changed(before.config, after.config, entry => entry.split('\n')[0]!)
  return [
    ...(refs.length > 0 ? [`These refs of the checkout changed while Codex ran: ${list(refs)}.`] : []),
    ...(keys.length > 0 ? [`These keys of the checkout's local Git config changed while Codex ran: ${list(keys)}.`] : []),
  ]
}

const list = (names: string[], max = 20) =>
  names.length > max ? `${names.slice(0, max).join(', ')}, and ${names.length - max} more` : names.join(', ')

// A reviewed tree is the reviewed state itself, so only its submodules, which the worktree leaves empty, are worth a warning.
async function unreproducible($: EngineInterface, top: string, isReviewed: boolean): Promise<string[]> {
  const warnings: string[] = []
  const submodules: string[] = []
  let flagged = 0
  const code = await eachRecord($, ['git', '-C', top, 'ls-files', '-s', '-v', '-z'], '\0', async record => {
    const [, tag, mode, path] = /^(\S) (\d+) \S+ \d\t(.*)$/s.exec(record) ?? []
    if (tag === 'S' || /^[a-z]$/.test(tag ?? '')) flagged++
    if (mode === '160000' && (await $.fs.list(`${top}/${path}`).catch(() => [])).length > 0) submodules.push(path!)
  })
  if (code !== 0) warnings.push(`Could not list the index to compare it with the worktree: git exited ${code}.`)
  if (submodules.length > 0) warnings.push(`The worktree does not include the checked-out submodules ${submodules.join(', ')}.`)
  if (isReviewed) return warnings
  const sparse = await $.process.run(['git', '-C', top, 'config', '--bool', 'core.sparseCheckout'], { timeoutMs: gitTimeoutMs })
  if (flagged > 0) {
    warnings.push(`The worktree has the staged content, not the working-tree content, of ${flagged} files marked assume-unchanged or skip-worktree.`)
  }
  if (sparse.stdout.trim() === 'true') warnings.push('The checkout is sparse, but the worktree has every file.')
  return warnings
}

// Best effort: the model and effort Codex applied, from the last turn_context in its session
// rollout, an undocumented file under sessions/YYYY/MM/DD named by local date.
async function effectiveSettings($: EngineInterface, threadId: string | undefined, started: number) {
  try {
    const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
    const codexHome = (await $.env.get('CODEX_HOME')) ?? (home === undefined ? undefined : `${home}/.codex`)
    if (threadId === undefined || codexHome === undefined) return {}
    for (const day of [0, 1]) {
      const date = new Date(started + day * 86_400_000)
      const pad = (n: number) => String(n).padStart(2, '0')
      const folder = `${codexHome}/sessions/${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}`
      const rollout = (await $.fs.list(folder).catch(() => [])).find(
        entry => entry.name.startsWith('rollout-') && entry.name.endsWith(`-${threadId}.jsonl`),
      )
      if (rollout === undefined) continue
      let context: { model?: unknown; effort?: unknown } | undefined
      for (const line of (await $.fs.read(`${folder}/${rollout.name}`)).split('\n')) {
        try {
          const record = JSON.parse(line)
          if (record?.type === 'turn_context') context = record.payload
        } catch {}
      }
      return {
        effectiveModel: typeof context?.model === 'string' ? context.model : undefined,
        effectiveEffort: typeof context?.effort === 'string' ? context.effort : undefined,
      }
    }
  } catch {}
  return {}
}

async function codexVersion($: EngineInterface): Promise<string> {
  let probe: ProcessRunResult
  try {
    probe = await $.process.run(['codex', '--version'])
  } catch (error) {
    throw new Error(`Could not run \`codex --version\`: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (probe.exitCode !== 0) throw new Error(`Could not run \`codex --version\`: ${probe.stderr.trim() || `it exited ${probe.exitCode}`}`)
  const match = /^codex-cli (\d+)\.(\d+)\.(\d+)/m.exec(probe.stdout)
  if (match === null) throw new Error(`Could not read the Codex version from "${probe.stdout.trim()}".`)
  const parts = match.slice(1).map(Number)
  const version = parts.join('.')
  const first = parts.findIndex((part, i) => part !== minimumVersion[i])
  if (first >= 0 && parts[first]! < minimumVersion[first]!) {
    throw new Error(`Codex ${version} is older than ${minimumVersion.join('.')}, the oldest version Confer supports. Update Codex.`)
  }
  return version
}

// The reviewed repo's .claude/settings.local.json can turn the worktree off, since Claude Code
// does not apply a project's pluginConfigs to options. One tracked in HEAD or the index, or not
// ignored, could be part of the change under review, so it is not read. ls-tree refuses icase
// pathspecs, and --with-tree=HEAD lists HEAD's paths too.
async function isWorktreeOffHere($: EngineInterface, top: string): Promise<boolean> {
  const tracked = (await git($, ['-C', top, 'ls-files', '-z', '--with-tree=HEAD', '--', ':(icase).claude'])).toLowerCase().split('\0')
  if (tracked.includes('.claude') || tracked.includes('.claude/settings.local.json')) return false
  const ignored = ['git', '-C', top, 'check-ignore', '-q', '--no-index', '--', '.claude/settings.local.json']
  if ((await $.process.run(ignored, { timeoutMs: gitTimeoutMs })).exitCode !== 0) return false
  let settings: { pluginConfigs?: Record<string, { options?: { worktree?: unknown } }> }
  try {
    settings = JSON.parse(await $.fs.read(`${top}/.claude/settings.local.json`))
  } catch {
    return false
  }
  return Object.entries(settings?.pluginConfigs ?? {}).some(
    ([key, config]) => (key === 'confer' || key.startsWith('confer@')) && config?.options?.worktree === false,
  )
}

async function enabledMcpServers($: EngineInterface, cwd: string): Promise<string[]> {
  const listing = await $.process.run(['codex', 'mcp', 'list', '--json', '--disable', 'apps', '--disable', 'plugins'], { cwd, timeoutMs: 60_000 })
  let servers: unknown
  try {
    servers = listing.exitCode === 0 && !listing.isStdoutTruncated ? JSON.parse(listing.stdout) : undefined
  } catch {}
  const isServer = (server: unknown): server is { name: string; enabled: boolean } =>
    typeof server === 'object' && server !== null && 'name' in server && typeof server.name === 'string' && 'enabled' in server && typeof server.enabled === 'boolean'
  const names = Array.isArray(servers) && servers.every(isServer) ? servers.filter(server => server.enabled).map(server => server.name) : undefined
  if (names === undefined || names.some(name => !/^[A-Za-z0-9_-]+$/.test(name))) throw new Error('Could not list Codex MCP servers.')
  return names
}

async function review(
  $: EngineInterface,
  { prompt, model, effort }: CodexRunRequest,
  timeoutMs: number,
  cwd: string,
  isWindows: boolean,
  result: CodexRunResult,
  output: Output,
): Promise<void> {
  const mcpServers = await enabledMcpServers($, cwd)
  // On Windows, Codex 0.167's read-only sandbox refuses every command.
  const sandbox = isWindows ? ['--approve-for-me', '-c', 'sandbox_workspace_write.network_access=false'] : ['-s', 'read-only']
  result.argv = [
    'codex',
    'exec',
    ...sandbox,
    '-c',
    'approval_policy="never"',
    '--json',
    '--disable',
    'apps',
    '--disable',
    'plugins',
    '-c',
    'notify=[]',
    ...mcpServers.flatMap(name => ['-c', `mcp_servers.${name}.enabled=false`]),
    '-c',
    'web_search="disabled"',
    '--skip-git-repo-check',
    '-m',
    model,
    '-c',
    `model_reasoning_effort="${effort}"`,
    '-',
  ]

  const started = await $.clock.now()
  const stream = $.process.spawn({ argv: result.argv, cwd, input: prompt })
  let isTimedOut = false
  const timer = $.clock.after(timeoutMs, () => {
    isTimedOut = true
    void stream.return({ code: null, signal: null })
  })
  let end: ProcessSpawnResult = { code: null, signal: null }
  try {
    for (;;) {
      let piece: Awaited<ReturnType<typeof stream.next>>
      try {
        piece = await stream.next()
      } catch (error) {
        if (isTimedOut) break
        throw error
      }
      if (piece.done) {
        // A stream the timeout closed ends without an exit.
        end = piece.value ?? end
        break
      }
      output[piece.value.stream] += piece.value.text
    }
  } finally {
    timer.cancel()
  }

  const events = parseEvents(output.stdout)
  result.threadId = events.threadId
  result.usage = events.usage
  Object.assign(result, await effectiveSettings($, events.threadId, started))
  result.costUsd = events.usage === undefined ? null : estimateCostUsd(result.effectiveModel ?? model, events.usage)
  if (events.usage !== undefined && result.effectiveModel === undefined) {
    result.warnings.push('Could not read the model Codex applied from its session rollout, so the cost was estimated from the requested model.')
  }
  result.warnings.push(...events.warnings)
  result.exitCode = isTimedOut ? null : end.code
  const isFailed = events.turnFailures.length > 0 || end.code !== 0 || events.turnsCompleted === 0
  const message = events.turnFailures.at(-1) ?? (events.turnsCompleted === 0 ? events.errors.at(-1) : undefined)
  if (isTimedOut) {
    result.status = 'timeout'
    result.error = `Codex did not finish within ${timeoutMs} ms.`
  } else if (isFailed) {
    Object.assign(result, classify(message))
    result.error =
      message ??
      (end.code === 0 ? 'Codex did not complete exactly one turn.' : end.code === null ? `Codex was ended by ${end.signal}.` : `Codex exited ${end.code}.`)
  } else {
    result.warnings.push(...events.errors)
    if (events.turnsCompleted !== 1) result.error = 'Codex did not complete exactly one turn.'
    else if (!events.reply?.trim()) result.error = 'Codex sent no reply.'
    else {
      result.status = 'completed'
      result.reply = events.reply
    }
  }
}
