import type { EngineInterface } from 'claude-code'
import { eachRecord, refuseGitRouting } from '../codex/run'
import { git } from '../codex/worktree'

async function records($: EngineInterface, argv: string[]): Promise<string[]> {
  const listed: string[] = []
  const code = await eachRecord($, argv, '\0', record => listed.push(record))
  if (code !== 0) throw new Error(`git ${argv.slice(3).join(' ')} exited ${code}.`)
  return listed.filter(record => record !== '')
}

// The checkout's state as a tree object, built in an index of the run's own. The user's index is
// only read, never locked or written, so an IDE holding index.lock or a merge conflict does not stop it.
// Copying its entries keeps force-added ignored files, intent-to-add paths, and conflicted paths.
// Untracked nested repositories are left out: `add -A` would record one as a gitlink, or fail on one with no commit.
export async function snapshot($: EngineInterface, top: string, dir: string): Promise<{ tree: string; nested: string[] }> {
  await refuseGitRouting($)
  const env = { GIT_INDEX_FILE: `${dir}/index` }
  await git($, ['-C', top, 'read-tree', '--empty'], { env })
  const entries = await records($, ['git', '-C', top, 'ls-files', '-s', '-z'])
  await git($, ['-C', top, 'update-index', '-z', '--index-info'], { env, stdin: entries.map(entry => `${entry}\0`).join('') })
  const absent = (await git($, ['-C', top, 'diff-files', '--name-only', '-z', '--diff-filter=D'], { env })).split('\0').filter(path => path !== '')
  if (absent.length > 0) {
    // The copy has no skip-worktree flags, so a sparse checkout's absent files would read as deleted.
    const isAbsent = new Set(absent)
    const skipped = (await records($, ['git', '-C', top, 'ls-files', '-v', '-z'])).flatMap(record =>
      (record[0] === 'S' || record[0] === 's') && isAbsent.has(record.slice(2)) ? [record.slice(2)] : [],
    )
    if (skipped.length > 0) {
      await git($, ['-C', top, 'update-index', '--skip-worktree', '-z', '--stdin'], { env, stdin: skipped.map(path => `${path}\0`).join('') })
    }
  }
  // `ls-files --others` lists an untracked nested repository as its directory with a trailing slash.
  const nested = (await records($, ['git', '-C', top, 'ls-files', '-z', '-o', '--exclude-standard'])).flatMap(path => (path.endsWith('/') ? [path.slice(0, -1)] : []))
  const pathspecs = ['.', ...nested.map(path => `:(exclude,literal)${path}`)].map(spec => `${spec}\0`).join('')
  // --sparse reads files outside the sparse-checkout definition too.
  await git($, ['-C', top, 'add', '-A', '--sparse', '--pathspec-from-file=-', '--pathspec-file-nul'], { env, stdin: pathspecs })
  return { tree: (await git($, ['-C', top, 'write-tree'], { env })).trim(), nested }
}
