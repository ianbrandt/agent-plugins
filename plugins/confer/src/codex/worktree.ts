import type { EngineInterface, ProcessRunInit } from 'claude-code'

// A monorepo checkout can take longer than the 30-second default.
const gitTimeoutMs = 600_000

export async function git($: EngineInterface, args: readonly string[], init: ProcessRunInit = {}): Promise<string> {
  const { exitCode, stdout, stderr, isStdoutTruncated } = await $.process.run(['git', ...args], { timeoutMs: gitTimeoutMs, ...init })
  if (exitCode !== 0) throw new Error(stderr.trim() || `git ${args.join(' ')} exited ${exitCode}.`)
  if (isStdoutTruncated) throw new Error(`The output of git ${args.join(' ')} was truncated.`)
  return stdout
}

async function paths($: EngineInterface, args: readonly string[]): Promise<string> {
  const list = await git($, args)
  if (list.includes('\uFFFD')) throw new Error(`git ${args.join(' ')} listed a path that is not valid UTF-8.`)
  return list
}

// `isReviewed`: the tree is the reviewed state itself, not the checkout's index.
export type StagedState = { tree: string; intentToAdd: string; isReviewed?: boolean }

// Rejects only while the worktree does not exist yet. Once this resolves, the caller fills the
// worktree with fillWorktree and removes it with removeWorktree on every exit path.
export async function addWorktree($: EngineInterface, repo: string, path: string, reviewed?: string): Promise<StagedState> {
  const staged =
    reviewed === undefined
      ? {
          tree: (await git($, ['-C', repo, 'write-tree'])).trim(),
          intentToAdd: await paths($, ['-C', repo, 'diff', '--no-renames', '--name-only', '-z', '--diff-filter=A']),
        }
      : { tree: reviewed, intentToAdd: '', isReviewed: true }
  if (await $.fs.exists(path)) throw new Error(`${path} already exists`)
  await git($, ['-C', repo, 'worktree', 'add', '--detach', '--no-checkout', path, 'HEAD'])
  return staged
}

// Resolves with warnings about what the worktree leaves out.
export async function fillWorktree($: EngineInterface, repo: string, path: string, { tree, intentToAdd, isReviewed }: StagedState): Promise<string[]> {
  if (isReviewed) {
    await git($, ['-C', path, 'read-tree', tree])
    await git($, ['-C', path, 'checkout-index', '-a', '-f'])
    await $.process.run(['git', '-C', path, 'update-index', '-q', '--refresh'], { timeoutMs: gitTimeoutMs })
    return []
  }
  const index = { GIT_INDEX_FILE: (await git($, ['-C', path, 'rev-parse', '--path-format=absolute', '--git-path', 'index'])).trim() }
  await git($, ['-C', repo, 'read-tree', tree], { env: index })
  const listed = (await paths($, ['-C', repo, 'ls-files', '-z', '--modified', '--deleted', '--others', '--exclude-standard'])).split('\0')
  // --others lists an untracked nested repository as its directory with a trailing slash.
  const nested = listed.filter(entry => entry.endsWith('/')).map(entry => entry.slice(0, -1))
  const changed = listed.filter(entry => entry !== '' && !entry.endsWith('/')).map(entry => `${entry}\0`).join('')
  await git($, ['-C', repo, 'update-index', '--add', '--remove', '--replace', '-z', '--stdin'], { env: index, stdin: changed })
  await git($, ['-C', path, 'checkout-index', '-a', '-f'])
  await git($, ['-C', path, 'read-tree', tree])
  if (intentToAdd !== '') {
    await git($, ['-C', path, '--literal-pathspecs', 'add', '-N', '--pathspec-from-file=-', '--pathspec-file-nul'], { stdin: intentToAdd })
  }
  await $.process.run(['git', '-C', path, 'update-index', '-q', '--refresh'], { timeoutMs: gitTimeoutMs })
  return nested.length > 0 ? [`The worktree does not include the untracked nested repositories ${nested.join(', ')}.`] : []
}

// Resolves with the path when the worktree is still there after a second try. Never rejects.
export async function removeWorktree($: EngineInterface, repo: string, path: string): Promise<string | undefined> {
  const remove = () =>
    $.process.run(['git', '-C', repo, 'worktree', 'remove', '--force', path], { timeoutMs: gitTimeoutMs }).then(
      ({ exitCode }) => exitCode === 0,
      () => false,
    )
  if (await remove()) return undefined
  // The kill after a timeout reaches Codex's children a few seconds later.
  await $.clock.sleep(5_000).catch(() => undefined)
  return (await remove()) ? undefined : path
}
