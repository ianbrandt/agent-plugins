import type { EngineInterface, ProcessRunInit, ProcessRunResult } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { gitToolArgv, runGitTool } from './git-tool'

// With format.pretty or log.diffMerges set in the user's config, Git could use a format that runs gpg, or a remerge diff that writes objects.
const prefix = ['git', '-c', 'core.fsmonitor=false', '-c', 'format.pretty=medium', '-c', 'log.diffMerges=separate', '--no-lazy-fetch', '--no-pager', '--no-optional-locks']

const refused = (args: string[]) => expect(gitToolArgv(args)).toEqual({ refused: expect.any(String) })

test('the diff subcommands run with external diffs and textconv off', () => {
  const guards = ['--no-ext-diff', '--no-textconv']
  expect(gitToolArgv(['diff', 'HEAD~1'])).toEqual({ argv: [...prefix, 'diff', ...guards, 'HEAD~1'] })
  expect(gitToolArgv(['show', 'HEAD'])).toEqual({ argv: [...prefix, 'show', ...guards, '--no-show-signature', 'HEAD'] })
  expect(gitToolArgv(['log', '-p'])).toEqual({ argv: [...prefix, 'log', ...guards, '--no-show-signature', '-p'] })
  expect(gitToolArgv(['blame', 'a.txt'])).toEqual({ argv: [...prefix, 'blame', ...guards, 'a.txt'] })
  expect(gitToolArgv(['grep', 'x'])).toEqual({ argv: [...prefix, 'grep', '--no-textconv', 'x'] })
  for (const sub of ['ls-files', 'ls-tree', 'cat-file', 'rev-parse', 'merge-base']) {
    expect(gitToolArgv([sub, 'HEAD'])).toEqual({ argv: [...prefix, sub, 'HEAD'] })
  }
})

test('options are accepted in the forms Git documents for them', () => {
  const allowed = [
    ['log', '-n', '5', '--oneline'],
    ['log', '-n5', '-5', '--max-count=3', '--since=2.weeks', '--author=Ian', '--follow', '--', 'a.txt'],
    ['log', '-L', '1,5:a.txt', '-L:main:a.txt', '-S', 'needle', '-Gre', '--format=%H %s', '--pretty'],
    ['diff', '-U3', '--unified=1', '--stat', '--stat=40,5', '--name-only', '--name-status', '-w', '--word-diff', '--cached', '-M50%'],
    ['show', '-s', '--pretty=fuller', 'HEAD'],
    ['blame', '-L', '1,1', '-w', '-M', '-C', '-C20', '--', 'a.txt'],
    ['grep', '-n', '-i', '-F', '-E', '-w', '-l', '-c', '-C', '2', '-A1', '-3', '-e', '-starts-with-dash', '--', '-path'],
    ['cat-file', '-p', 'HEAD:a.txt'],
    ['cat-file', 'blob', 'HEAD:a.txt'],
    ['ls-tree', '-r', '--name-only', 'HEAD'],
    ['ls-files', '--others', '--exclude-standard'],
    ['rev-parse', '--verify', '--short=8', 'HEAD'],
    ['rev-parse', '--abbrev-ref', 'HEAD'],
    ['merge-base', '--is-ancestor', 'main', 'HEAD'],
  ]
  for (const args of allowed) expect(gitToolArgv(args)).toEqual({ argv: expect.any(Array) })
})

test('an abbreviated long option is refused', () => {
  // Git expands --open-files-in to --open-files-in-pager, which runs the named command.
  refused(['grep', '--open-files-in=sh', 'x'])
  refused(['grep', '--open', 'x'])
  refused(['log', '--out=/tmp/x'])
  refused(['diff', '--ext'])
})

test('a bundle of short options is refused', () => {
  // Git reads -lOsh as -l -O sh.
  refused(['grep', '-lOsh', 'x'])
  refused(['grep', '-ni', 'x'])
  refused(['log', '-pn5'])
})

test('options that run a program, write a file, or read outside the repo are refused', () => {
  const never = [
    ['grep', '-O', 'x'],
    ['grep', '-Osh', 'x'],
    ['grep', '--open-files-in-pager', 'x'],
    ['grep', '--open-files-in-pager=sh', 'x'],
    ['grep', '--no-index', 'x'],
    ['grep', '--textconv', 'x'],
    ['grep', '-f', 'patterns'],
    ['log', '--output=/tmp/x'],
    ['diff', '--output=/tmp/x'],
    ['diff', '--ext-diff'],
    ['diff', '--textconv'],
    ['diff', '--no-index', 'a', 'b'],
    ['show', '--ext-diff', 'HEAD'],
    ['show', '--textconv', 'HEAD'],
    ['log', '--show-signature'],
    ['show', '--show-signature'],
    ['cat-file', '--filters', 'HEAD:a.txt'],
    ['cat-file', '--textconv', 'HEAD:a.txt'],
    ['cat-file', '--batch'],
    ['cat-file', '--batch-check'],
    ['cat-file', '--batch-command'],
    ['cat-file', '--batch-all-objects'],
    ['log', '--exec=sh'],
    ['log', '--upload-pack=sh'],
    ['blame', '--contents', '/etc/passwd', 'a.txt'],
    ['blame', '--contents=-', 'a.txt'],
    ['blame', '--ignore-revs-file=/etc/passwd', 'a.txt'],
    ['ls-files', '--exclude-from=/etc/passwd'],
  ]
  for (const args of never) refused(args)
})

test('a format with a signature placeholder is refused', () => {
  refused(['log', '--format=%H %G?'])
  refused(['log', '--pretty=format:%GS'])
  refused(['show', '--format=%GK', 'HEAD'])
  // Git reads %+G?, %-GS, and % GK as %G placeholders with a modifier.
  refused(['log', '--format=%+G?'])
  refused(['log', '--pretty=format:%-GS'])
  refused(['log', '--format=% GK'])
  refused(['ls-tree', '--format=%+G?'])
})

// A name that is not built in is looked up as pretty.<name> in the user's config, which the %G check never sees.
test('a pretty format name is refused unless it is a built-in one', () => {
  refused(['log', '--pretty=sig'])
  refused(['show', '--format=sig'])
  expect(gitToolArgv(['log', '--pretty=oneline'])).toEqual({ argv: expect.any(Array) })
  expect(gitToolArgv(['log', '--format=%H %s'])).toEqual({ argv: expect.any(Array) })
  expect(gitToolArgv(['log', '--pretty=tformat:%h'])).toEqual({ argv: expect.any(Array) })
})

// A remerge diff creates a temporary object directory in .git/objects.
test('remerge diffs are refused', () => {
  refused(['log', '--diff-merges=remerge'])
  refused(['show', '--diff-merges=r'])
  refused(['show', '--remerge-diff'])
  expect(gitToolArgv(['show', '--diff-merges=first-parent'])).toEqual({ argv: expect.any(Array) })
})

// With a path outside the repository, git diff runs an implicit --no-index that reads any file, or blocks on /dev/stdin.
test('git diff refuses a path outside the checkout', () => {
  refused(['diff', '/etc/hosts', '/dev/null'])
  refused(['diff', '/dev/stdin', 'a.txt'])
  refused(['diff', '--', '/dev/stdin', 'a.txt'])
  refused(['diff', '../../outside', 'a.txt'])
  refused(['diff', 'a.txt', 'src/../../outside'])
  refused(['diff', 'C:/Windows/win.ini', 'a.txt'])
  refused(['diff', '\\\\server\\share', 'a.txt'])
  expect(gitToolArgv(['diff', 'HEAD~1..HEAD', '--', 'src/a.txt'])).toEqual({ argv: expect.any(Array) })
  expect(gitToolArgv(['diff', 'main...HEAD'])).toEqual({ argv: expect.any(Array) })
})

test('an unknown subcommand or anything before the subcommand is refused', () => {
  refused([])
  refused(['push', 'origin'])
  refused(['config', 'core.pager', 'sh'])
  refused(['--no-pager', 'log'])
  refused(['-p', 'log'])
  refused(['--exec-path=/tmp', 'log'])
})

test('a revision or pattern that starts with a dash is refused before --', () => {
  refused(['log', '-weird'])
  refused(['grep', '-x'])
  refused(['show', '-'])
  refused(['log', '-n', '-5'])
})

// After the subcommand, -c and -C are the subcommand's options, so they pass only where it lists them.
test('-c, --config-env, and -C are refused as Git options', () => {
  refused(['-c', 'core.pager=sh', 'log'])
  refused(['-C', '/tmp', 'log'])
  refused(['--config-env=core.pager=X', 'log'])
  refused(['log', '-c', 'core.pager=sh'])
  refused(['log', '-ccore.pager=sh'])
  refused(['merge-base', '-c', 'x'])
  refused(['cat-file', '-C', '/tmp', '-p', 'HEAD'])
  refused(['log', '--config-env=core.pager=X'])
  refused(['ls-files', '-C', '/tmp'])
  refused(['rev-parse', '-C', '/tmp'])
})

type Run = { argv: readonly string[]; init?: ProcessRunInit }

// A test's hooks may not call $.process.run, so runGitTool gets a stand-in with only that call.
function git(answer: Partial<ProcessRunResult> = {}) {
  const runs: Run[] = []
  const run = async (argv: readonly string[], init?: ProcessRunInit) => {
    runs.push({ argv, init })
    return { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false, ...answer }
  }
  return { $: { process: { run } } as unknown as EngineInterface, runs }
}

test('the tool runs Git in the checkout with a timeout and no shell', async () => {
  const { $, runs } = git({ stdout: 'abc\n', stderr: 'warn\n' })

  expect(await runGitTool($, '/repo', ['rev-parse', 'HEAD'])).toEqual({ exitCode: 0, stdout: 'abc\n', stderr: 'warn\n', truncated: false })
  expect(runs).toEqual([{ argv: [...prefix, 'rev-parse', 'HEAD'], init: { cwd: '/repo', timeoutMs: 60_000 } }])
})

test('a non-zero exit is a result', async () => {
  const { $ } = git({ exitCode: 128, stderr: 'fatal: bad revision\n' })

  expect(await runGitTool($, '/repo', ['show', 'nope'])).toEqual({ exitCode: 128, stdout: '', stderr: 'fatal: bad revision\n', truncated: false })
})

test('refused args never reach Git', async () => {
  const { $, runs } = git()

  expect(await runGitTool($, '/repo', ['grep', '-lOsh', 'x'])).toEqual({ refused: expect.any(String) })
  expect(runs).toEqual([])
})

test('stdout over 256 KiB is cut on a UTF-8 boundary', async () => {
  // The three-byte character straddles the limit, so it is dropped whole.
  const { $ } = git({ stdout: `${'a'.repeat(256 * 1024 - 1)}€tail` })

  const result = await runGitTool($, '/repo', ['log'])
  expect(result).toMatchObject({ truncated: true })
  expect('stdout' in result && result.stdout).toEqual('a'.repeat(256 * 1024 - 1))
})

// In a partial clone, reading a missing blob would run `git fetch` from the promisor remote and write a pack.
test('the git tool turns off lazy fetches of a partial clone', async () => {
  const { $, runs } = git()

  await runGitTool($, '/repo', ['show', 'HEAD~1:a.txt'])

  expect(runs[0]!.argv.slice(0, runs[0]!.argv.indexOf('show'))).toContain('--no-lazy-fetch')
})

test('stdout Git cut short is reported truncated', async () => {
  const { $ } = git({ stdout: 'short', isStdoutTruncated: true })

  expect(await runGitTool($, '/repo', ['log'])).toMatchObject({ stdout: 'short', truncated: true })
})
