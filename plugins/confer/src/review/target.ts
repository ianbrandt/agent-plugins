import type { EngineInterface } from 'claude-code'
import { eachRecord, refuseGitRouting } from '../codex/run'
import { git } from '../codex/worktree'
import { snapshot } from './snapshot'
import type { Pr, RunState, Target } from './state'

const gitTimeoutMs = 600_000

// Takes `--findings <path>` or `--findings=<path>` out of the words.
export async function readFindings($: EngineInterface, words: string[], fix: boolean): Promise<{ findings?: string; rest: string[] }> {
  const at = words.findIndex(word => word === '--findings' || word.startsWith('--findings='))
  if (at < 0) return { rest: words }
  const inline = words[at]!.startsWith('--findings=')
  const findings = inline ? words[at]!.slice('--findings='.length) : words[at + 1]
  const rest = words.filter((_, i) => i !== at && (inline || i !== at + 1))
  if (findings === undefined || findings === '') throw new Error('--findings needs the absolute path of the file to write.')
  if (!/^([A-Za-z]:)?[\\/]/.test(findings)) throw new Error(`--findings needs an absolute path, not "${findings}".`)
  if (fix) throw new Error('--findings cannot be used with --fix: no one is present to choose the fixes.')
  if (await $.fs.exists(findings)) throw new Error(`${findings} already exists: --findings writes a new file.`)
  return { findings, rest }
}

// The words chooseTier left: an optional target, `--fix`, and `--findings <path>`.
export async function readTarget($: EngineInterface, words: string[], pr: unknown): Promise<{ target: Target; fix: boolean; findings?: string; top: string; prefix: string }> {
  await refuseGitRouting($)
  const fix = words.includes('--fix')
  const { findings, rest } = await readFindings($, words.filter(word => word !== '--fix'), fix)
  const top = (await git($, ['rev-parse', '--show-toplevel'])).trim()
  const prefix = (await git($, ['rev-parse', '--show-prefix'])).trim()
  if (pr !== undefined) return { target: { kind: 'pr', pr: checkPr(pr) }, fix, findings, top, prefix }
  if (rest.length > 1) throw new Error(`Confer reviews one target at a time, not ${rest.map(word => `"${word}"`).join(' ')}.`)
  const word = rest[0]
  if (word === undefined) return { target: { kind: 'checkout' }, fix, findings, top, prefix }
  if (word.startsWith('-')) throw new Error(`${word} is not an option of the review command.`)
  const commit = await $.process.run(['git', '-C', top, 'rev-parse', '--verify', '--quiet', `${word}^{commit}`], { timeoutMs: gitTimeoutMs })
  if (commit.exitCode === 0) return { target: { kind: 'commit', ref: commit.stdout.trim() }, fix, findings, top, prefix }
  const path = inCheckout(top, prefix, word)
  if (path !== undefined && (await isPath($, top, path))) return { target: { kind: 'path', path: path === '' ? '.' : path }, fix, findings, top, prefix }
  const range = /^(.*?)\.\.(\.?)(.*)$/s.exec(word)
  if (range !== null) return { target: await readRange($, top, word, range[1]!, range[2] === '.', range[3]!), fix, findings, top, prefix }
  throw new Error(`"${word}" is not a branch, a commit, a range, or a path in this checkout.`)
}

// `base..head` reviews the two as given; `base...head` reviews head from the merge base, as `git diff` reads three dots.
async function readRange($: EngineInterface, top: string, word: string, first: string, isThreeDots: boolean, last: string): Promise<Target> {
  const refuse = (why: string) => new Error(`"${word}" is not a branch, a commit, a range, or a path in this checkout: ${why}`)
  if (first === '' || last === '') throw refuse('a range needs a commit on each side of "..".')
  const resolve = async (side: string) => {
    if (side.startsWith('-')) throw refuse(`"${side}" is not a commit.`)
    const commit = await $.process.run(['git', '-C', top, 'rev-parse', '--verify', '--quiet', `${side}^{commit}`], { timeoutMs: gitTimeoutMs })
    if (commit.exitCode !== 0) throw refuse(`"${side}" is not a commit.`)
    return commit.stdout.trim()
  }
  const from = await resolve(first)
  const head = await resolve(last)
  if (isThreeDots) {
    const common = await $.process.run(['git', '-C', top, 'merge-base', from, head], { timeoutMs: gitTimeoutMs })
    if (common.exitCode !== 0) throw new Error(`"${first}" and "${last}" have no commit in common, so ${first}...${last} has no base.`)
    return { kind: 'commit', ref: head, base: common.stdout.trim() }
  }
  const ancestor = await $.process.run(['git', '-C', top, 'merge-base', '--is-ancestor', from, head], { timeoutMs: gitTimeoutMs })
  if (ancestor.exitCode !== 0) {
    throw new Error(`"${first}" is not an ancestor of "${last}", so ${first}..${last} would show the changes only in "${first}" as undone. Give ${first}...${last} to review "${last}" from where the two diverged.`)
  }
  return { kind: 'commit', ref: head, base: from }
}

// A path the change deletes is on disk nowhere, but is in HEAD or the index, or on the default branch.
async function isPath($: EngineInterface, top: string, path: string): Promise<boolean> {
  if (await $.fs.exists(path === '' ? top : `${top}/${path}`)) return true
  const tracked = await $.process.run(['git', '-C', top, 'ls-files', '--error-unmatch', '--with-tree=HEAD', '--', `:(literal)${path}`], { timeoutMs: gitTimeoutMs })
  if (tracked.exitCode === 0) return true
  return (await $.process.run(['git', '-C', top, 'rev-parse', '--verify', '--quiet', `origin/HEAD:${path}`], { timeoutMs: gitTimeoutMs })).exitCode === 0
}

function checkPr(pr: unknown): Pr {
  const p = pr as Partial<Pr>
  const url = /^(https:\/\/[^\s/]+\/[^\s/]+\/[^\s/]+)\/pull\/(\d+)\/?$/.exec(String(p?.url))
  if (url === null || p.number !== Number(url[2])) throw new Error('pr.url must be the https URL of the pull request numbered pr.number.')
  if (typeof p.headRefOid !== 'string' || !/^[0-9a-f]{40,64}$/.test(p.headRefOid)) throw new Error('pr.headRefOid must be a commit id.')
  if (typeof p.baseRefName !== 'string' || p.baseRefName === '' || p.baseRefName.startsWith('-')) throw new Error('pr.baseRefName must be a branch name.')
  return { url: p.url!, number: p.number, title: String(p.title ?? ''), body: String(p.body ?? ''), headRefOid: p.headRefOid, baseRefName: p.baseRefName }
}

// The path relative to the checkout's top, or undefined when it is outside the checkout.
function inCheckout(top: string, prefix: string, word: string): string | undefined {
  const path = word.replace(/\\/g, '/')
  const isAbsolute = /^([A-Za-z]:)?\//.test(path)
  if (isAbsolute && path !== top && !path.startsWith(`${top}/`)) return undefined
  const parts: string[] = []
  for (const part of (isAbsolute ? path.slice(top.length) : prefix + path).split('/')) {
    if (part === '' || part === '.') continue
    if (part !== '..') parts.push(part)
    else if (parts.pop() === undefined) return undefined
  }
  return parts.join('/')
}

async function defaultBranch($: EngineInterface, top: string): Promise<string> {
  const head = await $.process.run(['git', '-C', top, 'rev-parse', '--verify', '--quiet', 'origin/HEAD'], { timeoutMs: gitTimeoutMs })
  if (head.exitCode !== 0) {
    throw new Error('This checkout has no origin/HEAD, so Confer cannot tell which branch the change is against. Give a branch or commit to review, or run `git remote set-head origin --auto`.')
  }
  return 'origin/HEAD'
}

async function mergeBase($: EngineInterface, top: string, a: string, b: string): Promise<string> {
  return (await git($, ['-C', top, 'merge-base', a, b])).trim()
}

// Sets the base, head, reviewed tree, and reviewed directory. `record` saves the state before a ref or worktree is created.
export async function prepare($: EngineInterface, run: RunState, record: () => Promise<void>): Promise<string> {
  const { top, dir, target } = run
  if (target.kind === 'checkout' || target.kind === 'path') {
    const head = (await git($, ['-C', top, 'rev-parse', 'HEAD'])).trim()
    run.submodules = await dirtySubmodules($, top)
    const { tree, nested } = await snapshot($, top, dir)
    run.nested = nested
    // Compared as trees, since `git status` also reports untracked content in a submodule and edits outside the path.
    const isChanged =
      target.kind === 'path'
        ? (await git($, ['-C', top, 'diff', '--no-renames', '--name-only', '-z', head, tree, '--', target.path])) !== ''
        : tree !== (await git($, ['-C', top, 'rev-parse', `${head}^{tree}`])).trim()
    run.base = isChanged ? head : await mergeBase($, top, head, await defaultBranch($, top))
    run.intent = run.base === head ? '' : await git($, ['-C', top, 'log', '--format=%B', `${run.base}..${head}`])
    return tree
  }
  if (target.kind === 'commit') {
    run.head = target.ref
    run.base = target.base ?? (await mergeBase($, top, target.ref, await defaultBranch($, top)))
  } else {
    const { pr } = target
    const refs = { head: `refs/confer/${run.id}/head`, base: `refs/confer/${run.id}/base` }
    run.resources.refs.push(refs.head, refs.base)
    await record()
    const repository = pr.url.replace(/\/pull\/\d+\/?$/, '')
    await git($, ['-C', top, 'fetch', '--no-tags', '--no-write-fetch-head', repository, `+refs/pull/${pr.number}/head:${refs.head}`, `+refs/heads/${pr.baseRefName}:${refs.base}`], {
      env: { GIT_TERMINAL_PROMPT: '0' },
    })
    run.head = (await git($, ['-C', top, 'rev-parse', '--verify', `${refs.head}^{commit}`])).trim()
    if (run.head !== pr.headRefOid) throw new Error(`The PR's head is now ${run.head}, not ${pr.headRefOid}: run gh pr view again.`)
    run.base = await mergeBase($, top, run.head, refs.base)
  }
  run.intent = await git($, ['-C', top, 'log', '--format=%B', `${run.base}..${run.head}`])
  const checkout = `${dir}/checkout`
  run.resources.worktrees.push(checkout)
  await record()
  await git($, ['-C', top, 'worktree', 'add', '--detach', checkout, run.head])
  run.repoDir = checkout
  return (await git($, ['-C', top, 'rev-parse', `${run.head}^{tree}`])).trim()
}

// Submodules with uncommitted content, which the reviewed tree records only as their commit.
async function dirtySubmodules($: EngineInterface, top: string): Promise<string[]> {
  const dirty: string[] = []
  const argv = ['git', '--no-optional-locks', '-C', top, 'status', '--porcelain=v2', '-z', '--untracked-files=no', '--ignore-submodules=none']
  await eachRecord($, argv, '\0', record => {
    const [, ordinary, renamed, path] = /^(?:1 \S\S (S\S\S\S) (?:\S+ ){5}|2 \S\S (S\S\S\S) (?:\S+ ){6})(.*)$/s.exec(record) ?? []
    const sub = ordinary ?? renamed
    if (sub !== undefined && (sub[2] === 'M' || sub[3] === 'U')) dirty.push(path!)
  })
  return dirty
}
