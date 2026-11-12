import type { On, ProcessRunInit, ProcessRunResult } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { completed, lines, unknownModel } from './fixtures/codex-0.167.0'
import { budgetLimit, mcpList, rateLimit, usageLimit } from './fixtures/synthetic'
import type { CodexRunResult } from './run'

const repo = '/repo'
const outDir = '/scratch/round-1'
const winRepo = 'Q:/repo'
const winOutDir = 'Q:/scratch/round-1'
const onWindows = { repo: winRepo, outDir: winOutDir }
const noCheckout = { isCheckout: false }
const worktree = 'Q:/scratch/round-1-worktree'
const worktreeIndex = 'Q:/repo/.git/worktrees/round-1-worktree/index'
const request = { repo, outDir, isCheckout: true, prompt: 'Review the change.', model: 'gpt-6.1-sol', effort: 'low' }
const threadId = '01a1b80c-01e1-7c60-811e-b52b8eb2bb62'

type Answer = Partial<ProcessRunResult> | Error
// `changes` replaces answers once Codex starts.
type Codex = { stdout?: string; code?: number | null; hang?: 'exit' | 'reject'; fail?: Error; changes?: Record<string, Answer> }
type Stat = { kind: 'file' | 'dir' | 'other'; realPath?: string }
type World = {
  codex?: Codex
  answers?: Record<string, Answer>
  exists?: readonly string[]
  stats?: Record<string, Stat | null>
  files?: Record<string, string>
  dirs?: Record<string, readonly string[]>
  env?: Record<string, string>
  now?: number
  refuseWrite?: (path: string) => boolean
}

const defaults: Record<string, Answer> = {
  'codex --version': { stdout: 'codex-cli 0.167.0\n' },
  [`git -C ${repo} rev-parse --show-toplevel`]: { stdout: `${repo}\n` },
  [`git -C ${winRepo} rev-parse --show-toplevel`]: { stdout: `${winRepo}\n` },
  [`git -C ${outDir} rev-parse --show-toplevel`]: { exitCode: 128 },
  [`git -C ${winOutDir} rev-parse --show-toplevel`]: { exitCode: 128 },
  'codex mcp list --json --disable apps --disable plugins': { stdout: mcpList },
  [`git -C ${winRepo} config --bool core.sparseCheckout`]: { exitCode: 1 },
  [`git -C ${winRepo} write-tree`]: { stdout: 'tree1\n' },
  [`git -C ${worktree} rev-parse --path-format=absolute --git-path index`]: { stdout: `${worktreeIndex}\n` },
  [`git -C ${winRepo} ls-files -z --modified --deleted --others --exclude-standard`]: { stdout: 'changed.txt\0new.txt\0' },
}

const defaultStats: Record<string, Stat> = {
  [repo]: { kind: 'dir', realPath: repo },
  [outDir]: { kind: 'dir', realPath: outDir },
  [winRepo]: { kind: 'dir', realPath: 'Q:\\repo' },
  [winOutDir]: { kind: 'dir', realPath: 'Q:\\scratch\\round-1' },
}

const utf8Length = (text: string) => new TextEncoder().encode(text).length
// The engine resolves a path the host's way before the fs hooks see it. On macOS it puts the
// working directory before a drive-letter path. On Windows it uses backslashes and puts the
// current drive before a POSIX path, so the Windows fixtures use Q: and any other drive is dropped.
const local = (path: string) =>
  path
    .replace(/\\/g, '/')
    .replace(/^.*?(?=[Qq]:(\/|$))/, '')
    .replace(/^[A-PR-Za-pr-z]:(?=\/)/, '')

function world(on: On, { codex = {}, answers = {}, exists = [], stats = {}, files = {}, dirs = {}, env = {}, now, refuseWrite }: World = {}) {
  const log: string[] = []
  const runs: { argv: readonly string[]; init?: ProcessRunInit }[] = []
  const spawns: { argv: readonly string[]; cwd?: string; input?: string }[] = []
  const writes: Record<string, string> = {}
  const clock = mock.clock(on, { now })
  mock.env(on, env)
  const answerFor = (key: string) => answers[key] ?? defaults[key] ?? {}
  on('process.run', (_, e) => {
    const key = e.argv.join(' ')
    log.push(key)
    runs.push({ ...e, init: e.init && { ...e.init, cwd: e.init.cwd && local(e.init.cwd) } })
    const answer = answerFor(key)
    if (answer instanceof Error) return { deny: answer.message }
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false, ...answer } }
  })
  on('process.spawn', async function* (_, e, next) {
    const key = e.argv.join(' ')
    log.push(key)
    if (e.argv[0] === 'git') {
      const answer = answerFor(key)
      if (answer instanceof Error) return { deny: answer.message }
      if (answer.stdout) yield { stream: 'stdout' as const, text: answer.stdout }
      return { value: { code: answer.exitCode ?? 0, signal: null } }
    }
    spawns.push({ ...e, cwd: e.cwd && local(e.cwd) })
    Object.assign(answers, codex.changes)
    if (codex.fail) return { deny: codex.fail.message }
    yield { stream: 'stdout' as const, text: codex.stdout ?? completed }
    if (codex.hang) {
      await new Promise<void>(resolve => next.signal.addEventListener('abort', () => resolve()))
      if (codex.hang === 'reject') return { deny: 'Codex was killed.' }
    }
    return { value: { code: codex.code === undefined ? 0 : codex.code, signal: null } }
  })
  on('fs.exists', (_, e) => ({ value: exists.includes(local(e.path)) }))
  on('fs.stat', (_, e) => {
    const path = local(e.path)
    const strip = (path: string) => path.replace(/[\\/]+$/, '')
    const key = Object.keys(stats).find(key => strip(key) === strip(path))
    const stat = key === undefined ? defaultStats[strip(path)] : stats[key]
    if (!stat) return { deny: `ENOENT: ${e.path}` }
    return { value: { kind: stat.kind, size: 0, mtimeMs: 0, isLink: false, ...(e.resolve ? { realPath: stat.realPath } : {}) } }
  })
  on('fs.list', (_, e) => {
    const names = dirs[local(e.path)]
    if (names === undefined) return { deny: `ENOENT: ${e.path}` }
    return { value: names.map(name => ({ name, kind: 'file' as const, size: 0, mtimeMs: 0, isLink: false })) }
  })
  on('fs.read', (_, e) => {
    const text = files[local(e.path)]
    if (text === undefined) return { deny: `ENOENT: ${e.path}` }
    return { value: text }
  })
  on('fs.write', (_, e) => {
    // The engine rejects a write over 4 MiB.
    if (utf8Length(e.text) > 4 * 2 ** 20 || refuseWrite?.(e.path)) return { deny: `EACCES: ${local(e.path)}` }
    writes[local(e.path)] = e.text
    return { value: undefined }
  })
  return { log, runs, spawns, writes, clock }
}

const estimated = 'Could not read the model Codex applied from its session rollout, so the cost was estimated from the requested model.'

const runText = async ($: Engine, fields: object = {}) =>
  (
    await $.command.run({
      command: 'codex-run',
      args: JSON.stringify({ ...request, ...fields }),
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 80 },
    })
  ).text

const run = async ($: Engine, fields: object = {}): Promise<CodexRunResult> => JSON.parse((await runText($, fields)) ?? '')

const reviewArgv = (sandbox: string[]) => [
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
  '-c',
  'mcp_servers.docs.enabled=false',
  '-c',
  'web_search="disabled"',
  '--skip-git-repo-check',
  '-m',
  'gpt-6.1-sol',
  '-c',
  'model_reasoning_effort="low"',
  '-',
]

const tracked = `git -C ${winRepo} ls-files -z --with-tree=HEAD -- :(icase).claude`
const ignored = `git -C ${winRepo} check-ignore -q --no-index -- .claude/settings.local.json`
const index = `git -C ${winRepo} ls-files -s -v -z`
const worktreeSteps = [
  `git -C ${winRepo} write-tree`,
  `git -C ${winRepo} diff --no-renames --name-only -z --diff-filter=A`,
  `git -C ${winRepo} worktree add --detach --no-checkout ${worktree} HEAD`,
  `git -C ${worktree} rev-parse --path-format=absolute --git-path index`,
  `git -C ${winRepo} read-tree tree1`,
  `git -C ${winRepo} ls-files -z --modified --deleted --others --exclude-standard`,
  `git -C ${winRepo} update-index --add --remove --replace -z --stdin`,
  `git -C ${worktree} checkout-index -a -f`,
  `git -C ${worktree} read-tree tree1`,
  `git -C ${worktree} update-index -q --refresh`,
]
const removal = `git -C ${winRepo} worktree remove --force ${worktree}`
const refs = `git -C ${winRepo} for-each-ref --format=%(refname) %(objectname)`
const config = `git -C ${winRepo} config --local --list -z`

test('on macOS Codex reviews the checkout under the read-only sandbox', async ($, on) => {
  const { log, spawns, writes } = world(on)

  const result = await run($)

  expect(log).toEqual([
    `git -C ${repo} rev-parse --show-toplevel`,
    `git -C ${outDir} rev-parse --show-toplevel`,
    'codex --version',
    `git -C ${repo} update-index -q --refresh`,
    'codex mcp list --json --disable apps --disable plugins',
    reviewArgv(['-s', 'read-only']).join(' '),
  ])
  expect(spawns[0]).toMatchObject({ cwd: repo, input: 'Review the change.' })
  expect(result).toEqual({
    status: 'completed',
    reply: '{"ok":true}',
    threadId,
    model: 'gpt-6.1-sol',
    effort: 'low',
    usage: { input_tokens: 24427, cached_input_tokens: 17536, cache_write_input_tokens: 0, output_tokens: 63, reasoning_output_tokens: 0 },
    costUsd: (6891 * 2 + 17536 * 0.1 + 63 * 10) / 1e6,
    warnings: [estimated],
    exitCode: 0,
    elapsedMs: 0,
    argv: reviewArgv(['-s', 'read-only']),
    codexVersion: '0.167.0',
  })
  expect(writes).toEqual({ [`${outDir}/codex-events.jsonl`]: completed, [`${outDir}/codex-stderr.txt`]: '' })
})

test('outside a checkout on macOS Codex reads the folder under the read-only sandbox, and Confer runs no Git', async ($, on) => {
  const { log, spawns } = world(on)

  const result = await run($, { ...noCheckout, repo: '/work' })

  expect(log).toEqual(['codex --version', 'codex mcp list --json --disable apps --disable plugins', reviewArgv(['-s', 'read-only']).join(' ')])
  expect(spawns[0]).toMatchObject({ cwd: '/work' })
  expect(result.status).toBe('completed')
})

test('outside a checkout on Windows Codex runs in the output directory with approve-for-me, and no worktree is made', async ($, on) => {
  const { log, spawns } = world(on)

  const result = await run($, { ...noCheckout, repo: 'Q:/work', outDir: winOutDir })

  expect(log.filter(entry => entry.startsWith('git'))).toEqual([])
  expect(spawns[0]).toMatchObject({ cwd: winOutDir })
  expect(spawns[0]!.argv).toContain('--approve-for-me')
  expect(result.status).toBe('completed')
  expect(result.worktreeLeft).toBeUndefined()
})

test('outside a checkout an output directory inside the folder is accepted', async ($, on) => {
  world(on, { stats: { '/work/out': { kind: 'dir', realPath: '/work/out' } } })

  const result = await run($, { ...noCheckout, repo: '/work', outDir: '/work/out' })

  expect(result.status).toBe('completed')
})

test('the OS variable does not make a POSIX checkout a Windows one', async ($, on) => {
  const { spawns } = world(on, { env: { OS: 'Windows_NT' } })

  await run($)

  expect(spawns[0]?.argv).toEqual(reviewArgv(['-s', 'read-only']))
  expect(spawns[0]?.cwd).toBe(repo)
})

test('on Windows Codex reviews a detached worktree of the exact state with approve-for-me', async ($, on) => {
  const { log, runs, spawns, writes } = world(on)

  const result = await run($, { ...onWindows, outDir: `${winOutDir}/` })

  expect(log).toEqual([
    `git -C ${winRepo} rev-parse --show-toplevel`,
    `git -C ${winOutDir} rev-parse --show-toplevel`,
    'codex --version',
    tracked,
    ignored,
    `git -C ${winRepo} update-index -q --refresh`,
    index,
    `git -C ${winRepo} config --bool core.sparseCheckout`,
    ...worktreeSteps,
    refs,
    config,
    'codex mcp list --json --disable apps --disable plugins',
    reviewArgv(['--approve-for-me', '-c', 'sandbox_workspace_write.network_access=false']).join(' '),
    refs,
    config,
    removal,
  ])
  const step = (argv: string) => runs.find(r => r.argv.join(' ') === argv)?.init
  expect(step(`git -C ${winRepo} read-tree tree1`)?.env).toEqual({ GIT_INDEX_FILE: worktreeIndex })
  expect(step(`git -C ${winRepo} update-index --add --remove --replace -z --stdin`)).toMatchObject({
    env: { GIT_INDEX_FILE: worktreeIndex },
    stdin: 'changed.txt\0new.txt\0',
  })
  expect(step('codex mcp list --json --disable apps --disable plugins')?.cwd).toBe(worktree)
  expect(spawns[0]?.cwd).toBe(worktree)
  expect(result.status).toBe('completed')
  expect(result.warnings).toEqual([estimated])
  expect(result.worktreeLeft).toBeUndefined()
  expect(Object.keys(writes)).toEqual([`${winOutDir}/codex-events.jsonl`, `${winOutDir}/codex-stderr.txt`])
})

test('a reviewed tree is checked out in the worktree as it is, not rebuilt from the checkout', async ($, on) => {
  const { log } = world(on)

  const result = await run($, { ...onWindows, tree: 'reviewed1' })

  expect(log).toEqual([
    `git -C ${winRepo} rev-parse --show-toplevel`,
    `git -C ${winOutDir} rev-parse --show-toplevel`,
    'codex --version',
    tracked,
    ignored,
    `git -C ${winRepo} update-index -q --refresh`,
    index,
    `git -C ${winRepo} worktree add --detach --no-checkout ${worktree} HEAD`,
    `git -C ${worktree} read-tree reviewed1`,
    `git -C ${worktree} checkout-index -a -f`,
    `git -C ${worktree} update-index -q --refresh`,
    refs,
    config,
    'codex mcp list --json --disable apps --disable plugins',
    reviewArgv(['--approve-for-me', '-c', 'sandbox_workspace_write.network_access=false']).join(' '),
    refs,
    config,
    removal,
  ])
  expect(result.status).toBe('completed')
  expect(result.warnings).toEqual([estimated])
})

test('intent-to-add entries are restored in the worktree, their names read literally', async ($, on) => {
  const { log, runs } = world(on, {
    answers: { [`git -C ${winRepo} diff --no-renames --name-only -z --diff-filter=A`]: { stdout: '[ab].txt\0' } },
  })

  await run($, onWindows)

  const add = `git -C ${worktree} --literal-pathspecs add -N --pathspec-from-file=- --pathspec-file-nul`
  expect(log.indexOf(add)).toBe(log.indexOf(`git -C ${worktree} read-tree tree1`) + 1)
  expect(runs.find(r => r.argv.join(' ') === add)?.init?.stdin).toBe('[ab].txt\0')
})

test('state the worktree cannot reproduce is reported in warnings before Codex runs', async ($, on) => {
  const { log } = world(on, {
    answers: {
      [index]: { stdout: 'H 160000 a1 0\tlib/sub\0H 160000 b2 0\tlib/empty\0H 100644 c3 0\ta.txt\0h 100644 d4 0\tb.txt\0S 100644 e5 0\tc.txt\0' },
      [`git -C ${winRepo} config --bool core.sparseCheckout`]: { stdout: 'true\n' },
    },
    dirs: { [`${winRepo}/lib/sub`]: ['README.md'], [`${winRepo}/lib/empty`]: [] },
  })

  const result = await run($, onWindows)

  expect(result.status).toBe('completed')
  expect(result.warnings).toEqual([
    'The worktree does not include the checked-out submodules lib/sub.',
    'The worktree has the staged content, not the working-tree content, of 2 files marked assume-unchanged or skip-worktree.',
    'The checkout is sparse, but the worktree has every file.',
    estimated,
  ])
  expect(log.indexOf(index)).toBeLessThan(log.indexOf(`git -C ${winRepo} write-tree`))
})

// With a reviewed tree, the warning was dropped, though the worktree still has an empty directory for each submodule.
test('the warning about checked-out submodules is still given for a reviewed tree, and no other', async ($, on) => {
  world(on, {
    answers: {
      [index]: { stdout: 'H 160000 a1 0\tlib/sub\0S 100644 e5 0\tc.txt\0' },
      [`git -C ${winRepo} config --bool core.sparseCheckout`]: { stdout: 'true\n' },
    },
    dirs: { [`${winRepo}/lib/sub`]: ['README.md'] },
  })

  const result = await run($, { ...onWindows, tree: 'reviewed1' })

  expect(result.warnings).toEqual(['The worktree does not include the checked-out submodules lib/sub.', estimated])
})

const routing = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_LITERAL_PATHSPECS',
  'GIT_NOGLOB_PATHSPECS',
  'GIT_GLOB_PATHSPECS',
  'GIT_ICASE_PATHSPECS',
]
for (const name of routing) {
  for (const [platform, fields] of [['POSIX', {}], ['Windows', onWindows]] as const) {
    test(`an inherited ${name} fails a ${platform} run before any Git command`, async ($, on) => {
      const { log } = world(on, { env: { [name]: '1' } })

      expect(await runText($, fields)).toBe(`Error: Confer does not run Git while ${name} is set in the environment Claude Code passes to Git.`)
      expect(log).toEqual([])
    })
  }
}

test('a UNC checkout is reviewed the Windows way', async ($, on) => {
  const unc = '//server/share/repo'
  const { spawns } = world(on, {
    answers: { [`git -C ${unc} rev-parse --show-toplevel`]: { stdout: `${unc}\n` } },
    // On macOS the engine folds the leading // before the hook sees the path; on Windows it keeps it.
    stats: Object.fromEntries([unc, unc.slice(1)].map(key => [key, { kind: 'dir', realPath: '\\\\server\\share\\repo' }])),
  })

  expect((await run($, { repo: unc, outDir: winOutDir })).status).toBe('completed')
  expect(spawns[0]?.argv).toContain('--approve-for-me')
  expect(spawns[0]?.cwd).toBe(worktree)
})

test('untracked nested repositories are left out of the worktree with a warning', async ($, on) => {
  const list = `git -C ${winRepo} ls-files -z --modified --deleted --others --exclude-standard`
  const { runs } = world(on, { answers: { [list]: { stdout: 'changed.txt\0vendor/lib/\0new.txt\0tools/\0' } } })

  const result = await run($, onWindows)

  const update = runs.find(r => r.argv.join(' ') === `git -C ${winRepo} update-index --add --remove --replace -z --stdin`)
  expect(update?.init?.stdin).toBe('changed.txt\0new.txt\0')
  expect(result.warnings).toContain('The worktree does not include the untracked nested repositories vendor/lib, tools.')
})

test("refs and local config of the checkout that change while Codex runs in the worktree are reported", async ($, on) => {
  world(on, {
    answers: { [refs]: { stdout: 'refs/heads/main aaa\nrefs/heads/old bbb\n' }, [config]: { stdout: 'core.bare\nfalse\0user.name\nme\0' } },
    codex: {
      changes: {
        [refs]: { stdout: 'refs/heads/main ccc\nrefs/heads/new ddd\n' },
        [config]: { stdout: 'core.bare\nfalse\0core.hookspath\n/tmp/h\0user.name\nme\0' },
      },
    },
  })

  const result = await run($, onWindows)

  expect(result.status).toBe('completed')
  expect(result.warnings).toEqual([
    estimated,
    'These refs of the checkout changed while Codex ran: refs/heads/main, refs/heads/new, refs/heads/old.',
    "These keys of the checkout's local Git config changed while Codex ran: core.hookspath.",
  ])
})

test('a long list of changed refs is cut at 20 names', async ($, on) => {
  const many = Array.from({ length: 25 }, (_, i) => `refs/tags/t${String(i).padStart(2, '0')} aaa`).join('\n')
  world(on, { codex: { changes: { [refs]: { stdout: `${many}\n` } } } })

  const warning = (await run($, onWindows)).warnings.find(w => w.startsWith('These refs'))

  expect(warning).toEndWith('refs/tags/t19, and 5 more.')
})

test('refs and local config that cannot be listed are reported', async ($, on) => {
  world(on, { answers: { [config]: { exitCode: 1 } } })

  expect((await run($, onWindows)).warnings).toContain('Could not compare the refs and local Git config of the checkout before and after Codex ran.')
})

test('the worktree is removed when Codex fails', async ($, on) => {
  const failed = world(on, { codex: { stdout: unknownModel, code: 1 } })

  expect((await run($, onWindows)).status).toBe('failed')
  expect(failed.log.at(-1)).toBe(removal)
})

test('the worktree is removed when Codex cannot start', async ($, on) => {
  const { log } = world(on, { codex: { fail: new Error('ENOENT: codex') } })

  const result = await run($, onWindows)

  expect(result.status).toBe('failed')
  expect(result.error).toContain('ENOENT: codex')
  expect(log.at(-1)).toBe(removal)
})

test('a timeout kills Codex, keeps what it wrote, and removes the worktree', async ($, on) => {
  const { log, writes, clock } = world(on, { codex: { hang: 'exit' } })

  const pending = run($, { ...onWindows, timeoutMs: 60_000 })
  await clock.advance(60_000)
  const result = await pending

  expect(result).toMatchObject({ status: 'timeout', threadId, exitCode: null })
  expect(result.reply).toBeUndefined()
  expect(writes[`${winOutDir}/codex-events.jsonl`]).toBe(completed)
  expect(log.at(-1)).toBe(removal)
})

test('a stream denied after the timeout kills Codex still ends as a timeout', async ($, on) => {
  const { writes, clock } = world(on, { codex: { hang: 'reject' } })

  const pending = run($, { timeoutMs: 60_000 })
  await clock.advance(60_000)
  const result = await pending

  expect(result).toMatchObject({ status: 'timeout', threadId, exitCode: null, error: 'Codex did not finish within 60000 ms.' })
  expect(writes[`${outDir}/codex-events.jsonl`]).toBe(completed)
})

test('the default timeout is half an hour', async ($, on) => {
  const { clock } = world(on, { codex: { hang: 'exit' } })
  let result: CodexRunResult | undefined

  const pending = run($).then(r => (result = r))
  await clock.advance(1_799_999)
  expect(result).toBeUndefined()
  await clock.advance(1)
  await pending

  expect(result).toMatchObject({ status: 'timeout', elapsedMs: 1_800_000 })
})

test('a worktree that cannot be removed is tried again after five seconds, then reported', async ($, on) => {
  const { log, clock } = world(on, { answers: { [removal]: { exitCode: 1, stderr: 'Permission denied' } } })

  const pending = run($, onWindows)
  await clock.advance(5_000)
  const result = await pending

  expect(log.filter(argv => argv === removal)).toHaveLength(2)
  expect(result).toMatchObject({ status: 'completed', worktreeLeft: worktree })
})

test('a removal that cannot run is reported without changing the review', async ($, on) => {
  const { log, clock } = world(on, { codex: { stdout: unknownModel, code: 1 }, answers: { [removal]: new Error('EPERM: git') } })

  const pending = run($, onWindows)
  await clock.advance(5_000)
  const result = await pending

  expect(log.filter(argv => argv === removal)).toHaveLength(2)
  expect(result).toMatchObject({
    status: 'failed',
    error: "The 'confer-no-such-model' model is not supported when using Codex with a ChatGPT account.",
    worktreeLeft: worktree,
  })
})

test('an existing worktree path is refused and never removed', async ($, on) => {
  const { log, spawns } = world(on, { exists: [worktree] })

  const result = await run($, onWindows)

  expect(result).toMatchObject({ status: 'failed', error: `${worktree} already exists` })
  expect(log).not.toContain(removal)
  expect(spawns).toHaveLength(0)
})

test('a worktree that could not be added is never removed', async ($, on) => {
  const add = `git -C ${winRepo} worktree add --detach --no-checkout ${worktree} HEAD`
  const { log } = world(on, { answers: { [add]: { exitCode: 128, stderr: 'fatal: already exists' } } })

  const result = await run($, onWindows)

  expect(result).toMatchObject({ status: 'failed', error: 'fatal: already exists' })
  expect(log).not.toContain(removal)
})

test('a truncated path list fails the run and removes the worktree', async ($, on) => {
  const list = `git -C ${winRepo} ls-files -z --modified --deleted --others --exclude-standard`
  const truncated = world(on, { answers: { [list]: { stdout: 'a\0', isStdoutTruncated: true } } })

  const result = await run($, onWindows)

  expect(result.status).toBe('failed')
  expect(result.error).toContain('truncated')
  expect(truncated.log.at(-1)).toBe(removal)
})

test('a path that is not valid UTF-8 fails the run', async ($, on) => {
  const list = `git -C ${winRepo} diff --no-renames --name-only -z --diff-filter=A`
  const { spawns } = world(on, { answers: { [list]: { stdout: 'caf\uFFFD.txt\0' } } })

  const result = await run($, onWindows)

  expect(result.status).toBe('failed')
  expect(result.error).toContain('UTF-8')
  expect(spawns).toHaveLength(0)
})

test('the worktree switch in userConfig turns the worktree off', { options: { worktree: false } }, async ($, on) => {
  const { log, spawns } = world(on)

  await run($, onWindows)

  expect(log).not.toContain(`git -C ${winRepo} write-tree`)
  expect(spawns[0]?.argv).toContain('--approve-for-me')
  expect(spawns[0]?.cwd).toBe(winRepo)
})

const localSettings = JSON.stringify({ pluginConfigs: { 'confer@market': { options: { worktree: false } } } })
const settingsFile = { [`${winRepo}/.claude/settings.local.json`]: localSettings }

test("the reviewed repo's ignored, untracked local settings turn the worktree off", async ($, on) => {
  const { log, spawns } = world(on, { files: settingsFile })

  await run($, onWindows)

  expect(log).not.toContain(`git -C ${winRepo} write-tree`)
  expect(spawns[0]?.cwd).toBe(winRepo)
})

test('local settings tracked in HEAD or the index leave the worktree on, in any case', async ($, on) => {
  const { spawns } = world(on, { files: settingsFile, answers: { [tracked]: { stdout: '.CLAUDE/SETTINGS.LOCAL.JSON\0' } } })

  await run($, onWindows)

  expect(spawns[0]?.cwd).toBe(worktree)
})

test('untracked local settings that Git does not ignore leave the worktree on', async ($, on) => {
  const { spawns } = world(on, { files: settingsFile, answers: { [ignored]: { exitCode: 1 } } })

  await run($, onWindows)

  expect(spawns[0]?.cwd).toBe(worktree)
})

test('Codex older than the minimum version fails the run before anything else', async ($, on) => {
  const { log } = world(on, { answers: { 'codex --version': { stdout: 'codex-cli 0.163.0\n' } } })

  const result = await run($)

  expect(result).toMatchObject({
    status: 'failed',
    error: 'Codex 0.163.0 is older than 0.167.0, the oldest version Confer supports. Update Codex.',
  })
  expect(log.at(-1)).toBe('codex --version')
})

test('the Codex version is read only from the codex-cli line', async ($, on) => {
  world(on, { answers: { 'codex --version': { stdout: 'WARNING: proxy 9.9.9 is in use\ncodex-cli 0.167.0\n' } } })

  expect((await run($)).codexVersion).toBe('0.167.0')
})

test('a missing Codex fails the run with a clear error', async ($, on) => {
  world(on, { answers: { 'codex --version': new Error('ENOENT: codex') } })

  const result = await run($)

  expect(result.status).toBe('failed')
  expect(result.error).toMatch(/^Could not run `codex --version`: .*ENOENT: codex$/)
})

test('a failing `codex --version` fails the run with a clear error', async ($, on) => {
  world(on, { answers: { 'codex --version': { exitCode: 1, stderr: 'Error: bad config\n' } } })

  expect(await run($)).toMatchObject({ status: 'failed', error: 'Could not run `codex --version`: Error: bad config' })
})

test('a usage limit is reported with its retry time and not retried', async ($, on) => {
  const { spawns } = world(on, { codex: { stdout: usageLimit, code: 1 } })

  const result = await run($)

  expect(result).toMatchObject({ status: 'usage_limit', retryAt: 'Oct 19th, 2026 12:06 AM', exitCode: 1 })
  expect(spawns).toHaveLength(1)
})

test('a LiteLLM budget limit is reported as budget_limit', async ($, on) => {
  world(on, { codex: { stdout: budgetLimit, code: 1 } })

  expect((await run($)).status).toBe('budget_limit')
})

test('a LiteLLM rate limit is reported as rate_limit', async ($, on) => {
  world(on, { codex: { stdout: rateLimit, code: 1 } })

  expect(await run($)).toMatchObject({ status: 'rate_limit', error: 'exceeded retry limit, last status: 429 Too Many Requests' })
})

test('a limit is classified from the turn failure, not an earlier error', async ($, on) => {
  const stdout = lines(
    { type: 'thread.started', thread_id: threadId },
    { type: 'turn.started' },
    { type: 'error', message: 'Reconnecting... 1/5 (rate limit reached)' },
    { type: 'turn.failed', error: { message: 'unexpected status 401 Unauthorized' } },
  )
  world(on, { codex: { stdout, code: 1 } })

  expect(await run($)).toMatchObject({ status: 'failed', error: 'unexpected status 401 Unauthorized' })
})

test('a Codex error that is not a limit fails the run with its message', async ($, on) => {
  world(on, { codex: { stdout: unknownModel, code: 1 } })

  const result = await run($)

  expect(result).toMatchObject({
    status: 'failed',
    error: "The 'confer-no-such-model' model is not supported when using Codex with a ChatGPT account.",
    exitCode: 1,
  })
  expect(result.warnings).toHaveLength(2)
  expect(result.reply).toBeUndefined()
})

test('a top-level error before a completed turn and a reply is a warning', async ($, on) => {
  const stdout = completed.replace(/(.*"turn\.started".*\n)/, `$1${lines({ type: 'error', message: 'Reconnecting... 1/5' })}`)
  world(on, { codex: { stdout } })

  expect(await run($)).toMatchObject({ status: 'completed', reply: '{"ok":true}', warnings: [estimated, 'Reconnecting... 1/5'] })
})

test('an empty reply fails the run', async ($, on) => {
  world(on, { codex: { stdout: completed.replace('{\\"ok\\":true}', ' \\n ') } })

  expect(await run($)).toMatchObject({ status: 'failed', error: 'Codex sent no reply.' })
})

test('a run without a completed turn fails', async ($, on) => {
  world(on, { codex: { stdout: completed.replace(/.*turn\.completed.*\n/, '') } })

  expect(await run($)).toMatchObject({ status: 'failed', error: 'Codex did not complete exactly one turn.' })
})

test('a nonzero exit fails the run even after a completed turn', async ($, on) => {
  world(on, { codex: { stdout: completed, code: 2 } })

  expect(await run($)).toMatchObject({ status: 'failed', error: 'Codex exited 2.', exitCode: 2 })
})

const rollout = (...contexts: object[]) =>
  lines({ type: 'session_meta', payload: { id: threadId } }, ...contexts.map(payload => ({ type: 'turn_context', payload })))
const rolloutName = `rollout-2026-11-07T12-00-00-${threadId}.jsonl`
const noon = Date.UTC(2026, 10, 7, 12)

test("the effective model and effort are read from the last turn_context of Codex's rollout and priced", async ($, on) => {
  const folder = '/codex-home/sessions/2026/11/07'
  world(on, {
    now: noon,
    env: { CODEX_HOME: '/codex-home', HOME: '/home/me' },
    dirs: { [folder]: [`rollout-2026-11-07T11-00-00-01a1b80c-0000-7000-8000-000000000000.jsonl`, rolloutName] },
    files: { [`${folder}/${rolloutName}`]: rollout({ model: 'gpt-6.1-sol', effort: 'low' }, { model: 'gpt-6-astra', effort: 'high' }) },
  })

  expect(await run($)).toMatchObject({
    status: 'completed',
    model: 'gpt-6.1-sol',
    effectiveModel: 'gpt-6-astra',
    effectiveEffort: 'high',
    costUsd: (6891 * 10 + 17536 * 1 + 63 * 50) / 1e6,
  })
})

test('the rollout is looked for under HOME in the day after the run started', async ($, on) => {
  const folder = '/home/me/.codex/sessions/2026/11/08'
  world(on, {
    now: noon,
    env: { HOME: '/home/me' },
    dirs: { [folder]: [rolloutName] },
    files: { [`${folder}/${rolloutName}`]: rollout({ model: 'gpt-6.1-sol', effort: 'medium' }) },
  })

  expect(await run($)).toMatchObject({ effectiveModel: 'gpt-6.1-sol', effectiveEffort: 'medium' })
})

test('a rollout that cannot be read leaves the effective model unknown', async ($, on) => {
  world(on, { now: noon, env: { HOME: '/home/me' }, dirs: { '/home/me/.codex/sessions/2026/11/07': [rolloutName] } })

  const result = await run($)

  expect(result).toMatchObject({ status: 'completed', costUsd: (6891 * 2 + 17536 * 0.1 + 63 * 10) / 1e6 })
  expect(result.effectiveModel).toBeUndefined()
  expect(result.effectiveEffort).toBeUndefined()
  expect(result.warnings).toEqual([estimated])
})

test('output over the write limit keeps its last part and a warning', async ($, on) => {
  const stdout = completed + '€'.repeat(2 ** 21) + 'x'
  const { writes } = world(on, { codex: { stdout } })

  const result = await run($)

  const kept = '€'.repeat(2 ** 20 - 1) + 'x'
  expect(result.status).toBe('completed')
  expect(writes[`${outDir}/codex-events.jsonl`]).toBe(kept)
  expect(result.warnings).toEqual([
    estimated,
    `Only the last part of ${outDir}/codex-events.jsonl was written: the first ${utf8Length(stdout) - utf8Length(kept)} bytes were dropped.`,
  ])
})

test('a write that fails is a warning, and the other file is still written', async ($, on) => {
  const { writes } = world(on, { refuseWrite: path => path.endsWith('codex-stderr.txt') })

  const result = await run($)

  expect(result.status).toBe('completed')
  expect(result.warnings).toEqual([estimated, `Could not write ${outDir}/codex-stderr.txt: confer: $.fs.write: EACCES: ${outDir}/codex-stderr.txt`])
  expect(writes[`${outDir}/codex-events.jsonl`]).toBe(completed)
})

for (const [listing, answer] of [
  ['that exits nonzero', { exitCode: 1 }],
  ['that is not JSON', { stdout: 'not json' }],
  ['that is truncated', { stdout: mcpList, isStdoutTruncated: true }],
  ['with a name that cannot be switched off', { stdout: JSON.stringify([{ name: 'a.b', enabled: true }]) }],
  ['with an entry that has no enabled flag', { stdout: JSON.stringify([{ name: 'docs' }]) }],
  ['with a null entry', { stdout: JSON.stringify([null]) }],
] as const) {
  test(`an MCP server listing ${listing} fails the run before Codex starts`, async ($, on) => {
    const { spawns } = world(on, { answers: { 'codex mcp list --json --disable apps --disable plugins': answer } })

    expect(await run($)).toMatchObject({ status: 'failed', error: 'Could not list Codex MCP servers.' })
    expect(spawns).toHaveLength(0)
  })
}

for (const [where, fields, stats, error] of [
  ['in the checkout', { outDir: `${repo}/out` }, { [`${repo}/out`]: { kind: 'dir', realPath: `${repo}/out` } }, `${repo}/out is inside the checkout`],
  ['that is the checkout', { outDir: repo }, {}, `${repo} is inside the checkout`],
  ['that links into the checkout', {}, { [outDir]: { kind: 'dir', realPath: `${repo}/out` } }, `${outDir} is inside the checkout`],
  [
    'in the checkout in another case on Windows',
    { ...onWindows, outDir: 'q:/REPO/out' },
    { 'q:/REPO/out': { kind: 'dir', realPath: 'q:\\REPO\\out' } },
    'q:/REPO/out is inside the checkout',
  ],
  ['in the checkout in another case on POSIX', { outDir: '/REPO/out' }, { '/REPO/out': { kind: 'dir', realPath: '/REPO/out' } }, '/REPO/out is inside the checkout'],
  ['that is a filesystem root', { outDir: '/' }, { '/': { kind: 'dir', realPath: '/' } }, '/ is a filesystem root'],
  ['that is a drive root', { ...onWindows, outDir: 'Q:/' }, { 'Q:/': { kind: 'dir', realPath: 'Q:\\' } }, 'Q:/ is a filesystem root'],
  ['that is a file', {}, { [outDir]: { kind: 'file', realPath: outDir } }, `${outDir} is not a directory`],
  ['that is missing', {}, { [outDir]: null }, `${outDir} does not exist`],
  ['that is relative', { outDir: 'round-1' }, {}, 'round-1 is not an absolute path'],
  ['in a relative repo', { repo: 'repo' }, {}, 'repo is not an absolute path'],
] as const) {
  test(`an output directory ${where} is refused`, async ($, on) => {
    world(on, { stats })

    expect(await runText($, fields)).toBe(`Error: ${error}`)
  })
}

test('an output directory is refused when its worktree would be the checkout', async ($, on) => {
  const top = `${outDir}-worktree`
  world(on, {
    answers: { [`git -C ${top} rev-parse --show-toplevel`]: { stdout: `${top}\n` } },
    stats: { [top]: { kind: 'dir', realPath: top } },
  })

  expect(await runText($, { repo: top })).toBe(`Error: ${top} would be inside the checkout`)
})

test('an output directory that Git places in the checkout is refused', async ($, on) => {
  const alias = '/scratch/alias'
  world(on, {
    answers: { [`git -C ${alias} rev-parse --show-toplevel`]: { stdout: '/Repo\n' } },
    stats: { [alias]: { kind: 'dir', realPath: alias }, '/Repo': { kind: 'dir', realPath: '/Repo' } },
  })

  expect(await runText($, { outDir: alias })).toBe(`Error: ${alias} is inside the checkout`)
})

test('an output directory in another repository is accepted', async ($, on) => {
  world(on, {
    answers: { [`git -C ${outDir} rev-parse --show-toplevel`]: { stdout: '/scratch\n' } },
    stats: { '/scratch': { kind: 'dir', realPath: '/scratch' } },
  })

  expect((await run($)).status).toBe('completed')
})
