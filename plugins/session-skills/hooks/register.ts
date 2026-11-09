// The plugin's hooks module: the rules a session starts with, the tools that
// run the git work of both skills, and the tool a worktree session calls to edit
// a file that is only in the primary checkout.
import type { Register } from 'claude-code'
import { backstopConfig, bypassMisuse, configWrites, type Dir, DIR_MARK, expand, hookWrites, type HostWrite, hostWrites, localUrl, pickBase, type Push, pushTargets, recorded, refLine, vagueDir, visibility, type Word, worktreeName } from './checkouts'
import { splice } from './splice'

const NONE = { type: 'object', properties: {} } as const
const TOOLS = {
  find_checkouts: {
    description: "Fetch, then report the repo's primary checkout, its default branch, the ref a new branch should start from, and every worktree with its branch and the number of commits it has that the base lacks. Read-only apart from the fetch.",
    inputSchema: NONE,
  },
  open_worktree: {
    description: "Fetch, then open a new worktree and branch for a unit of work under the primary checkout's .claude/worktrees, starting from the current base, pull its Git LFS files, and link the repo's local notes directory into it. A name already taken gets a numeric suffix. Returns the worktree path and branch.",
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'A short descriptive slug for the work, lowercase words joined by hyphens, such as parser-cache. Never a generic activity word such as roadmap-lap.' },
        id: { type: 'string', description: "The work's backlog ID, such as R78 or ABC-123, prefixed to the name. Omit where the work has none." },
        notes: { type: 'string', description: "The repo's local-only notes directory at its root. Defaults to notes.local." },
      },
      required: ['name'],
    },
  },
  prune_branches: {
    description: "Prune stale worktree registrations, delete claude/ and worktree- branches merged into the default branch, and delete any branch with a deleted upstream and content already on the remote default branch. Never removes a worktree. Returns one line per branch deleted, kept, or still checked out.",
    inputSchema: NONE,
  },
  remove_worktree: {
    description: "Remove a worktree opened by `open_worktree`: run `git worktree remove` from the primary checkout, then delete the worktree directory where it is still on disk, as it is on Windows. Idempotent: a retry on a path already unregistered is a no-op. The notes junction inside the worktree is a link, so the notes in the primary checkout are untouched. Returns one line per step.",
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: "Absolute path of the worktree to remove. Must be inside the primary checkout's `.claude/worktrees`." },
      },
      required: ['path'],
    },
  },
  landing_facts: {
    description: "Report the facts used to choose how work leaves its branch in this repo: whether it is a fork, origin's visibility, the landing mode (merge or pr), and which holds the user lifted. Read from per-clone git config first, then gh or glab where installed. Read-only.",
    inputSchema: NONE,
  },
} as const
// Every command is run by argument vector, so the same code serves bash, Git
// Bash, and PowerShell sessions.
type Ran = { exitCode: number; stdout: string; stderr: string }

// A command that cannot start, or is still running at the timeout, is a failed
// command here: gh and glab are optional, and a fetch can hang on a credential.
// Each one is run in the primary checkout. The session's directory is the
// default, and nothing starts there once a session has removed the worktree it
// had changed into.
async function run($: any, argv: string[], timeoutMs = 30_000): Promise<Ran> {
  try {
    return await $.process.run(argv, { cwd: await primary($), timeoutMs })
  } catch (err) {
    return { exitCode: 127, stdout: '', stderr: (err as Error).message }
  }
}
const gitArgv = (cwd: string, argv: string[]) => ['git', '-C', cwd, ...argv]
const gitTimeout = (argv: string[]) => (argv.includes('fetch') || argv.includes('lfs') ? 120_000 : 30_000)
const git = ($: any, cwd: string, ...argv: string[]) => run($, gitArgv(cwd, argv), gitTimeout(argv))
const ok = async (ran: Promise<Ran>) => (await ran).exitCode === 0
const out = async (ran: Promise<Ran>) => {
  const r = await ran
  return r.exitCode === 0 ? r.stdout.trim() : ''
}
const firstLine = (text: string) => text.trim().split(/\r?\n/)[0] ?? ''
async function must($: any, cwd: string, ...argv: string[]): Promise<string> {
  const r = await run($, gitArgv(cwd, argv), gitTimeout(argv))
  if (r.exitCode !== 0) throw new Error(`git ${argv.join(' ')} in ${cwd}: ${r.stderr.trim() || `exit ${r.exitCode}`}`)
  return r.stdout
}

async function primary($: any): Promise<string> {
  const main = (await $.session.repo())?.root
  if (!main) throw new Error('not inside a git repository')
  return main
}

// A command that did not run to an answer. Claude Code reports a git that
// crashed as exit 1 with no output.
const failed = (r: Ran): never => {
  throw new Error(`check failed: ${firstLine(r.stderr) || `exit ${r.exitCode}`}`)
}

// Every ref is read this one way, by its full name: `origin/main` is also the
// name of a local branch or a tag someone made by accident, and git reads those
// first. A read that fails throws, since the ref is then neither known to be
// there nor known to be absent.
async function readRef($: any, main: string, ref: string) {
  const r = await git($, main, 'for-each-ref', '--format=%(refname) %(symref)', ref)
  if (r.exitCode !== 0) failed(r)
  return refLine(r.stdout, ref)
}
const has = async ($: any, main: string, ref: string) => (await readRef($, main, ref)) !== null
const HEAD = 'refs/remotes/origin/HEAD'

// A remote's URL, or nothing for a remote git does not have, which is exit 2.
// Any other failure throws: the remote is not known to be absent.
async function remoteUrl($: any, main: string, name: string): Promise<string | null> {
  const r = await git($, main, 'remote', 'get-url', name)
  if (r.exitCode === 0) return r.stdout.trim()
  if (r.exitCode !== 2) failed(r)
  return null
}
const within = ($: any, main: string, a: string, b: string) => ok(git($, main, 'merge-base', '--is-ancestor', a, b))

// origin is named, since a bare `git fetch` reads the remote of the current
// branch's upstream: the parent repo on a fork, or this repo where the branch
// tracks a local one. An origin/HEAD that names a branch origin has is left as
// it is, since it may point at another branch on purpose. Any other is set from
// the remote: a repo that was pushed rather than cloned has none, the prune of
// a renamed default branch leaves one that points at nothing, and one written
// by `git update-ref` is a commit, not the name of a branch. A repo with no
// origin has nothing to fetch.
async function fetchOrigin($: any, main: string, prune = false): Promise<Ran & { origin: boolean }> {
  if ((await remoteUrl($, main, 'origin')) === null) return { exitCode: 0, stdout: '', stderr: '', origin: false }
  const argv = ['fetch', '-q', ...(prune ? ['--prune'] : []), 'origin']
  const fetched = await run($, gitArgv(main, argv), gitTimeout(argv))
  if (fetched.exitCode === 0 && !(await readRef($, main, HEAD))?.symref) await git($, main, 'remote', 'set-head', 'origin', '--auto')
  return { ...fetched, origin: true }
}

// Read after the fetch, where there is one. `main` is a guess, made only where
// there is no origin/HEAD. One that is still a commit is neither: the fetch
// failed, or `git remote set-head` did. One that still points at a branch a
// prune removed is not printed by `git for-each-ref`, and `git symbolic-ref`
// prints its target, or exits 1 where there is no symbolic ref.
async function defaultBranch($: any, main: string): Promise<string> {
  const head = await readRef($, main, HEAD)
  if (head && !head.symref) throw new Error(`${HEAD} is not a symbolic ref, so the default branch is not known. Set it with \`git remote set-head origin <branch>\`.`)
  const dangling = head ? null : await git($, main, 'symbolic-ref', '-q', HEAD)
  if (dangling && dangling.exitCode !== 0 && dangling.exitCode !== 1) failed(dangling)
  return (head?.symref ?? dangling?.stdout.trim() ?? '').replace('refs/remotes/origin/', '') || 'main'
}

async function locate($: any) {
  const main = await primary($)
  const warnings: string[] = []
  const fetched = await fetchOrigin($, main)
  const def = await defaultBranch($, main)
  if (fetched.exitCode !== 0) warnings.push(`fetch failed, so origin/${def} may be behind: ${fetched.stderr.trim() || `exit ${fetched.exitCode}`}`)
  const local = `refs/heads/${def}`
  const origin = `refs/remotes/origin/${def}`
  const picked = pickBase(def, await has($, main, origin), await has($, main, local), await within($, main, origin, local), await within($, main, local, origin))
  if (picked.warning) warnings.push(picked.warning)
  return { main, def, base: picked.base, baseRef: picked.base === def ? local : origin, warnings }
}

// With -z each line ends in NUL, so a newline in a path stays in it.
async function worktrees($: any, main: string): Promise<{ path: string; branch: string }[]> {
  const found: { path: string; branch: string }[] = []
  for (const line of (await must($, main, 'worktree', 'list', '--porcelain', '-z')).split('\0')) {
    if (line.startsWith('worktree ')) found.push({ path: line.slice('worktree '.length), branch: '(detached)' })
    else if (line.startsWith('branch refs/heads/') && found.length) found[found.length - 1].branch = line.slice('branch refs/heads/'.length)
  }
  return found
}

async function findCheckouts($: any): Promise<string> {
  const { main, def, base, baseRef, warnings } = await locate($)
  const cwd = await $.session.cwd()
  // git ends the path it prints with one newline, and anything before that is
  // part of the path.
  const top = await git($, cwd, 'rev-parse', '--show-toplevel')
  const here = top.exitCode === 0 ? top.stdout.replace(/\n$/, '') : ''
  const rows = []
  for (const w of await worktrees($, main)) {
    const ahead = w.branch === '(detached)' ? '' : await out(git($, main, 'rev-list', '--count', `${baseRef}..refs/heads/${w.branch}`))
    rows.push(`  ${w.path}  ${w.branch}${ahead && ahead !== '0' ? `  ${ahead} ${ahead === '1' ? 'commit' : 'commits'} not on ${base}` : ''}`)
  }
  return [
    `primary checkout: ${main}`,
    `default branch: ${def}`,
    `base for a new branch: ${base}`,
    `session directory: ${here || cwd}`,
    'worktrees, the primary checkout first:',
    ...rows,
    ...warnings.map(w => `warning: ${w}`),
  ].join('\n')
}

// A junction on Windows, which needs no privilege, and a symbolic link
// elsewhere. $.fs has no link call.
// ponytail: Windows is read off a drive-letter path, there being no platform call.
async function link($: any, target: string, at: string): Promise<Ran> {
  if (/^[A-Za-z]:[\\/]/.test(target) && /[&|<>^%()"]/.test(target + at)) {
    return { exitCode: 1, stdout: '', stderr: 'a character in the path is an operator in cmd' }
  }
  return /^[A-Za-z]:[\\/]/.test(target)
    ? run($, ['cmd', '/c', 'mklink', '/J', at.replace(/\//g, '\\'), target.replace(/\//g, '\\')])
    : run($, ['ln', '-s', target, at])
}

async function openWorktree($: any, e: any): Promise<string> {
  const slug = String(e.name ?? '')
  const id = String(e.id ?? '')
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) throw new Error(`name ${JSON.stringify(slug)} is not lowercase words joined by hyphens`)
  if (id && !/^[A-Za-z0-9]+([.-][A-Za-z0-9]+)*$/.test(id)) throw new Error(`id ${JSON.stringify(id)} is not a backlog ID such as R78 or ABC-123`)
  const notes = String(e.notes ?? 'notes.local')
  if (!/^[A-Za-z0-9._-]+$/.test(notes) || /^\.\.?$/.test(notes)) throw new Error(`notes ${JSON.stringify(notes)} is not the name of a directory at the repo root`)
  const { main, def, base, baseRef, warnings } = await locate($)
  const root = `${main}/.claude/worktrees`
  const wanted = worktreeName(slug, id)
  let name = wanted
  for (let n = 2; (await $.fs.exists(`${root}/${name}`)) || (await ok(git($, main, 'show-ref', '--verify', '--quiet', `refs/heads/claude/${name}`))); n++) name = `${wanted}-${n}`
  const path = `${root}/${name}`
  await must($, main, 'worktree', 'add', '--no-track', path, '-b', `claude/${name}`, baseRef)
  // Claude Code runs git with GIT_LFS_SKIP_SMUDGE=1, so the checkout leaves LFS
  // files as pointers. `git lfs pull` writes them without the smudge filter.
  // ponytail: only the root .gitattributes is read, so an LFS pattern set only in a nested one is missed.
  const attributes = `${path}/.gitattributes`
  if ((await $.fs.exists(attributes)) && /\bfilter=lfs\b/.test(await $.fs.read(attributes).catch(() => ''))) {
    const pulled = await git($, path, 'lfs', 'pull')
    if (pulled.exitCode !== 0) warnings.push(`LFS files were left as pointers, so run \`git lfs pull\` in the worktree: ${firstLine(pulled.stderr) || `exit ${pulled.exitCode}`}`)
  }
  const lines = [`worktree: ${path}`, `branch: claude/${name}`, `opened from: ${base}`, `primary checkout: ${main}`, `default branch: ${def}`]
  if (await $.fs.exists(`${main}/${notes}`)) {
    // `ln -s` into a directory that is there links inside it, and reports success.
    const linked = (await $.fs.exists(`${path}/${notes}`))
      ? { exitCode: 1, stdout: '', stderr: 'it is already there' }
      : await link($, `${main}/${notes}`, `${path}/${notes}`)
    if (linked.exitCode === 0) lines.push(`notes: ${path}/${notes} links to ${main}/${notes}`)
    else warnings.push(`${notes} was not linked into the worktree, so write notes to ${main}/${notes}: ${linked.stderr.trim() || `exit ${linked.exitCode}`}`)
  }
  return [...lines, ...warnings.map(w => `warning: ${w}`)].join('\n')
}

// The tree left by merging `ref` into `base`, or nothing where the merge
// conflicts: exit 1, with the tree the conflict left. Any other failure throws
// with git's message. A git before 2.41 rejects --attr-source. 2.41.0 and
// 2.42.0 crash on it in merge-tree unless GIT_NO_REPLACE_OBJECTS is set, as it
// was by Claude Code when this was run, and 2.43 has the fix. No
// .gitattributes, no attributes file from the user's config, and no
// merge.default is read: a driver such as `union`, or one that keeps the base's
// side, settles a conflict without the branch's change, and the result reads as
// merged.
// ponytail: the system-wide attributes file is still read. GIT_ATTR_NOSYSTEM turns it off, and is an environment variable.
async function mergedTree($: any, main: string, empty: string, base: string, ref: string, from = ''): Promise<string> {
  const argv = ['-c', 'merge.default=text', '-c', 'core.attributesFile=/dev/null', `--attr-source=${empty}`, 'merge-tree', '--write-tree', ...(from ? [`--merge-base=${from}`] : []), base, ref]
  const r = await run($, gitArgv(main, argv))
  if (r.exitCode === 0) return r.stdout.trim()
  if (r.exitCode !== 1 || !r.stdout.trim()) failed(r)
  return ''
}

// git has no switch that turns off .git/info/attributes, so a merge driver set
// there means no merge here can be trusted.
async function localDrivers($: any, main: string): Promise<boolean> {
  const dir = (await must($, main, 'rev-parse', '--path-format=absolute', '--git-common-dir')).trim()
  const text: string = await $.fs.read(`${dir}/info/attributes`).catch(() => '')
  return text.split(/\r?\n/).some(line => !line.trim().startsWith('#') && /\smerge=/.test(line))
}

// Whether a merge commit has a change of its own: a tree other than the
// automatic merge of its parents. A merge of more than two parents, and any
// command that fails, count as having one.
async function amended($: any, main: string, empty: string, m: string): Promise<boolean> {
  const parents = await git($, main, 'rev-parse', `${m}^@`)
  const own = await git($, main, 'rev-parse', `${m}^{tree}`)
  const [one, two, ...more] = parents.stdout.split(/\r?\n/).filter(Boolean)
  if (parents.exitCode !== 0 || own.exitCode !== 0 || !two || more.length) return true
  return (await mergedTree($, main, empty, one, two)) !== own.stdout.trim()
}

// Whether the base has everything a branch has. Merging the branch into the
// base now has to change nothing. So does the same merge taken from each of
// the branch's commits since the two forked, which leaves only what the branch
// changed after that commit: a commit made after the host's merge that undoes
// part of it is found there, and not in the first merge. A merge commit is
// taken the same way when its tree differs from the automatic merge of its
// parents, since a change made in the merge itself is in no other commit. A
// check that fails never reads as merged, and a command that fails throws: the
// first merge has run before `merge-base` does, so the two have a commit in
// common, and exit 1 there is no answer either.
// ponytail: one merge a commit, so a branch of thousands of commits is slow.
async function onBase($: any, main: string, empty: string, tree: string, base: string, ref: string): Promise<boolean> {
  if ((await mergedTree($, main, empty, base, ref)) !== tree) return false
  const found = await git($, main, 'merge-base', base, ref)
  if (found.exitCode !== 0) failed(found)
  const fork = found.stdout.trim()
  const commits = await git($, main, 'rev-list', '--no-merges', `--ancestry-path=${fork}`, `${base}..${ref}`)
  const merges = await git($, main, 'rev-list', '--merges', `--ancestry-path=${fork}`, `${base}..${ref}`)
  if (commits.exitCode !== 0) failed(commits)
  if (merges.exitCode !== 0) failed(merges)
  const all = [...commits.stdout.split(/\r?\n/), ...merges.stdout.split(/\r?\n/)].filter(Boolean)
  const isMerge = new Set(merges.stdout.split(/\r?\n/))
  for (const c of all) {
    if (isMerge.has(c) && !(await amended($, main, empty, c))) continue
    if ((await mergedTree($, main, empty, base, ref, `${c}^`)) !== tree) return false
  }
  return true
}

// `git worktree remove` on Windows exits 0 and unregisters the worktree, but
// leaves its directory on disk with the notes junction inside. The directory
// is deleted here after a 0 or a 128-with-"not a working tree" exit; both
// `rd /s /q` on Windows and `rm -rf` elsewhere were measured not to follow the
// junction. A cmd operator in the path is rejected, matching `link`.
async function removeWorktree($: any, e: any): Promise<string> {
  const raw = String(e.path ?? '').trim()
  if (!raw) throw new Error('path is empty')
  const main = await primary($)
  const posixMain = main.replace(/\\/g, '/').replace(/\/$/, '')
  const path = raw.replace(/\\/g, '/').replace(/\/$/, '')
  const win = /^[A-Za-z]:[\\/]/.test(main)
  const fold = (p: string) => (win ? p.toLowerCase() : p)
  const root = `${fold(posixMain)}/.claude/worktrees/`
  if (!fold(path).startsWith(root) || path.split('/').includes('..')) {
    throw new Error(`${raw} is not inside ${posixMain}/.claude/worktrees`)
  }
  const lines: string[] = []
  const removed = await git($, main, 'worktree', 'remove', path)
  if (removed.exitCode === 0) lines.push(`unregistered: ${path}`)
  else if (removed.exitCode === 128 && /not a working tree/i.test(removed.stderr)) lines.push(`already unregistered: ${path}`)
  else throw new Error(`git worktree remove: ${firstLine(removed.stderr) || `exit ${removed.exitCode}`}`)
  if (await $.fs.exists(path)) {
    if (win && /[&|<>^%()"]/.test(path)) throw new Error(`cannot delete ${path}: a character in the path is an operator in cmd`)
    const argv = win ? ['cmd', '/c', 'rd', '/s', '/q', path.replace(/\//g, '\\')] : ['rm', '-rf', path]
    const del = await run($, argv)
    if (del.exitCode !== 0 && (await $.fs.exists(path))) {
      throw new Error(`deleting ${path}: ${firstLine(del.stderr) || `exit ${del.exitCode}`}`)
    }
    lines.push(`deleted: ${path}`)
  } else {
    lines.push(`directory already gone: ${path}`)
  }
  return lines.join('\n')
}

async function pruneBranches($: any): Promise<string> {
  const main = await primary($)
  const lines: string[] = []
  // Every ref is read before anything is pruned, so a read that fails ends the
  // call with nothing deleted.
  const fetched = await fetchOrigin($, main, true)
  const def = await defaultBranch($, main)
  const hasLocal = await has($, main, `refs/heads/${def}`)
  await must($, main, 'worktree', 'prune')
  // A branch name is read whole: the short form of a branch that has a tag's
  // name is `heads/<name>`, and `git branch -D heads/<name>` deletes another
  // branch, or none.
  const merged = hasLocal
    ? await must($, main, 'for-each-ref', '--merged', `refs/heads/${def}`, '--format=%(refname:lstrip=2)', 'refs/heads/claude/*', 'refs/heads/worktree-*')
    : ''
  // Compared without case: on a file system that ignores case, `git checkout
  // Feat` leaves HEAD at refs/heads/Feat for the branch feat, and git then
  // deletes that branch from under the worktree.
  const worktreeBranches = (await worktrees($, main)).map(w => w.branch.toLowerCase())
  const checkedOut = (b: string) => worktreeBranches.includes(b.toLowerCase())
  // A branch a session has just opened has the default branch's tip, and git
  // refuses to delete it while its worktree stands. -D, since -d checks the
  // merge against the primary checkout's HEAD, which may be another branch.
  for (const b of merged.split(/\r?\n/).filter(b => b && !checkedOut(b))) {
    const gone = await git($, main, 'branch', '-D', b)
    lines.push(gone.exitCode === 0 ? `deleted: ${b} (merged into ${def})` : `left: ${b} (${firstLine(gone.stderr)})`)
  }

  // A branch a host squashed or rebased on merge is not `--merged`. Its
  // upstream is gone, which a declined pull request's is too, so it is deleted
  // only when the base has everything it has. Nothing is checked after a
  // failed fetch, when the remote's default branch may have lost a commit that
  // origin/<default> still has here.
  const base = `origin/${def}`
  const baseRef = `refs/remotes/${base}`
  if (fetched.exitCode !== 0) lines.push(`warning: fetch failed, so no branch with a gone upstream was checked: ${firstLine(fetched.stderr)}`)
  const tree = fetched.exitCode === 0 ? await out(git($, main, 'rev-parse', '--verify', '-q', `${baseRef}^{tree}`)) : ''
  const empty = tree && (await out(git($, main, 'hash-object', '-t', 'tree', '/dev/null')))
  // A repo with no origin has no branch with a gone upstream.
  if (fetched.exitCode === 0 && !tree && fetched.origin) lines.push(`warning: no branch with a gone upstream was checked: the tree of ${base} could not be read`)
  else if (tree && !empty) lines.push('warning: no branch with a gone upstream was checked: the empty tree could not be read')
  if (empty && (await localDrivers($, main))) lines.push('warning: a merge driver is set in .git/info/attributes, so no branch with a gone upstream was checked')
  else if (empty) {
    const refs = await must($, main, 'for-each-ref', '--format=%(refname:lstrip=2)%09%(upstream:track)', 'refs/heads')
    for (const [b, track] of refs.split(/\r?\n/).map(l => l.split('\t'))) {
      if (track !== '[gone]') continue
      let why = ''
      try {
        if (!(await onBase($, main, empty, tree, baseRef, `refs/heads/${b}`))) why = `content not on ${base}`
      } catch (err) {
        why = (err as Error).message
      }
      if (why) lines.push(`kept: ${b} (upstream gone, ${why})`)
      else if (checkedOut(b)) lines.push(`merged, still checked out: ${b}`)
      else {
        const gone = await git($, main, 'branch', '-D', b)
        lines.push(gone.exitCode === 0 ? `deleted: ${b} (upstream gone, content on ${base})` : `left: ${b} (${firstLine(gone.stderr)})`)
      }
    }
  }
  return lines.length ? lines.join('\n') : 'nothing to prune'
}

const setting = ($: any, dir: string, key: string) => out(git($, dir, 'config', '--get', `session-skills.${key}`))

const VIEW = [['gh', ['--json', 'visibility', '-q', '.visibility']], ['glab', ['-F', 'json', '--jq', '.visibility']]] as const

// The session's visibility records, which the pre-push hook reads. A hooks
// module is given no data directory, so they are in the temp directory.
async function recordsPath($: any): Promise<string> {
  const tmp = (await $.env.get('TMPDIR').catch(() => '')) || (await $.env.get('TEMP').catch(() => '')) || '/tmp'
  return `${tmp.replace(/[\\/]+$/, '')}/session-skills-${await $.session.id().catch(() => 'session')}.visibility`
}

// A URL's visibility from gh or glab, recorded for the hook whatever it is, so
// an unknown or public answer replaces a private one. A record that is not
// written leaves the hook to refuse the push.
// shortcut: two lookups at once can each write the file and lose the other's line, which refuses a push; lock the file if that is seen.
async function lookUp($: any, url: string): Promise<[string, string]> {
  let found: [string, string] = ['', '']
  for (const [from, argv] of VIEW) {
    const read = visibility(await out(run($, [from, 'repo', 'view', url, ...argv])))
    if (read) {
      found = [read, from]
      break
    }
  }
  try {
    const path = await recordsPath($)
    await $.fs.write(path, recorded(await $.fs.read(path).catch(() => ''), url, found[0], Math.floor(Date.now() / 1000)))
  } catch {}
  return found
}

// origin's visibility and where it was read, or '' for both where it is unknown.
async function originVisibility($: any, dir: string): Promise<[string, string]> {
  const url = (await remoteUrl($, dir, 'origin')) ?? ''
  const vis = visibility(await setting($, dir, 'originVisibility'))
  if (vis) return [vis, 'git config']
  return url ? lookUp($, url) : ['', '']
}

async function landingFacts($: any): Promise<string> {
  const main = await primary($)
  const config = (key: string) => setting($, main, key)
  const fork = (await remoteUrl($, main, 'upstream')) !== null
  const url = (await remoteUrl($, main, 'origin')) ?? ''
  const [vis, visFrom] = await originVisibility($, main)

  // GitHub returns `protected` from its plain branch endpoint to any reader,
  // and its protection endpoint needs admin rights, so the first is read, plus
  // the branch's rulesets.
  let mode = await config('landing')
  let modeFrom = 'git config'
  if (mode !== 'merge' && mode !== 'pr') {
    mode = ''
    const repo = url && (await out(run($, ['gh', 'repo', 'view', url, '--json', 'nameWithOwner', '-q', '.nameWithOwner'])))
    if (repo) {
      const def = await defaultBranch($, main)
      const isProtected = await out(run($, ['gh', 'api', `repos/${repo}/branches/${def}`, '--jq', '.protected']))
      const rules = await out(run($, ['gh', 'api', `repos/${repo}/rules/branches/${def}`, '--jq', '.[].type']))
      if (isProtected === 'true' || rules.split(/\r?\n/).includes('pull_request')) mode = 'pr'
      else if (isProtected === 'false') mode = 'merge'
      modeFrom = 'gh'
    }
  }

  const lifted = []
  for (const hold of ['holdPublicPush', 'holdFork', 'holdPrText']) if ((await config(hold)) === 'false') lifted.push(hold)
  return [
    `fork: ${fork ? 'yes, an upstream remote is set' : 'no'}`,
    `origin visibility: ${vis ? `${vis} (${visFrom})` : 'unknown'}`,
    `landing mode: ${mode ? `${mode} (${modeFrom})` : 'unknown'}`,
    `holds lifted: ${lifted.join(', ') || 'none'}`,
  ].join('\n')
}

// A tool's answer, or its error as the result: nothing is thrown at the model.
async function answer(name: string, run: () => Promise<string>) {
  try {
    return { result: await run() }
  } catch (err) {
    const text = `${name}: ${(err as Error).message}`
    return { result: text, text, isError: true }
  }
}

// The directory a command in the Bash tool runs in: the tool's working
// directory, which a cd in an earlier call moves, or a path read against it.
// In a linked worktree the session's repo is the primary checkout, but the
// branch checked out is the worktree's.
async function where($: any, dir: string | undefined): Promise<string> {
  if (dir !== undefined && /^(?:[A-Za-z]:)?[\\/]/.test(dir)) return dir
  const cwd = (await $.session.cwd().catch(() => '')) || (await primary($))
  return dir === undefined ? cwd : `${cwd.replace(/[\\/]+$/, '')}/${dir}`
}

// One git config value, '' where it is not set. A read that fails throws:
// Claude Code reports a git that crashed as exit 1, which `--get` alone also
// returns for a key that is not set.
async function configValue($: any, dir: string, key: string): Promise<string> {
  const r = await git($, dir, 'config', '--default=', '--get', key)
  if (r.exitCode !== 0) failed(r)
  return r.stdout.trim()
}

// The remote a `git push` with none given goes to: the branch's pushRemote,
// then remote.pushDefault, then the branch's remote, then origin. The branch is
// '' on a detached HEAD, and is printed without the `heads/` that symbolic-ref
// adds where a tag has the same name.
async function pushRemote($: any, dir: string): Promise<string> {
  const head = await git($, dir, 'branch', '--show-current')
  if (head.exitCode !== 0) failed(head)
  const branch = head.stdout.trim()
  for (const key of [branch && `branch.${branch}.pushRemote`, 'remote.pushDefault', branch && `branch.${branch}.remote`]) {
    const name = key && (await configValue($, dir, key))
    if (name) return name
  }
  return 'origin'
}

// Every git config entry read in `dir`, as git prints it, in the order git
// reads them. A boolean key with no value is true.
async function configList($: any, dir: string): Promise<[string, string][]> {
  const r = await git($, dir, 'config', '-z', '--list')
  if (r.exitCode !== 0) failed(r)
  const entries: [string, string][] = []
  for (const entry of r.stdout.split('\0')) {
    const nl = entry.indexOf('\n')
    const key = nl < 0 ? entry : entry.slice(0, nl)
    if (key.trim()) entries.push([key, nl < 0 ? 'true' : entry.slice(nl + 1)])
  }
  return entries
}

const TRUE = /^(?:true|yes|on|-?[1-9]\d*)$/i

// What config set before the command adds to a push: a force where the
// remote mirrors or has a + refspec, and submodules where push.recurseSubmodules
// or submodule.recurse sends the push into them and the index has a gitlink,
// with or without a .gitmodules, or another command in the line may have staged one. A remote that is not written out may be any of
// them. A setting is read from its last value, the one git uses, and of the two
// recursion keys git uses the one set last. git pushes to each member of a
// remote group, and prefers a group to a remote of the same name, so a group
// is read as a remote that is not written out. git prints a subsection in its
// own case and matches the name in it, so the name is compared in any case.
// So is a remote after a command that may move the branch where config has an
// onbranch include, since its URL can be set there for the branch moved to.
async function pushConfig($: any, dir: string, p: Push): Promise<{ force: boolean; submodules: boolean; unread: boolean }> {
  const entries = await configList($, dir)
  const named = p.remote === undefined ? await pushRemote($, dir) : p.remote
  const unread = named !== null && entries.some(([k]) => k.toLowerCase() === `remotes.${named.toLowerCase()}` || (!!p.switched && /^includeif\.onbranch:/i.test(k)))
  const name = unread ? null : named
  const remote = ([k]: [string, string], field: string) => (name === null ? k.startsWith('remote.') && k.endsWith(`.${field}`) : k === `remote.${name}.${field}`)
  const force = [...new Map(entries)].some(e => remote(e, 'mirror') && TRUE.test(e[1])) || entries.some(e => remote(e, 'push') && e[1].startsWith('+'))
  const [key, mode] = entries.filter(([k]) => k === 'push.recursesubmodules' || k === 'submodule.recurse').at(-1) ?? ['', '']
  const recurses = p.submodules ?? (key === 'push.recursesubmodules' ? /^(?:on-demand|only)$/i.test(mode) : TRUE.test(mode))
  // `:/` lists the whole index from a subdirectory too.
  // shortcut: the whole index is printed to find one gitlink, read only where recursion is set; filter in git if a large repo slows the hook.
  return { force, submodules: recurses && (!!p.staged || /^160000 /m.test(await must($, dir, 'ls-files', '-s', ':/'))), unread }
}

// Every URL a remote pushes to, or null where git has no such remote.
async function pushUrls($: any, dir: string, name: string): Promise<string[] | null> {
  const r = await git($, dir, 'remote', 'get-url', '--push', '--all', name)
  if (r.exitCode === 2) return null
  if (r.exitCode !== 0) failed(r)
  return r.stdout.split(/\r?\n/).map(u => u.trim()).filter(Boolean)
}

// A session on Windows is told by its drive-letter paths, there being no platform call.
const onWindows = (dir: string) => /^[A-Za-z]:[\\/]/.test(dir)

// Whether every URL a push goes to is on this machine, by the pre-push hook's
// first rule: `git push .`, a path, or a remote whose push URLs all are.
async function localTarget($: any, dir: string, remote: string | null | undefined): Promise<boolean> {
  if (remote === null) return false
  const name = remote ?? (await pushRemote($, dir))
  if (name === '.') return true
  const urls = await pushUrls($, dir, name)
  return urls === null ? localUrl(name, onWindows(dir)) : urls.length > 0 && urls.every(u => localUrl(u, onWindows(dir)))
}

// The visibility gh or glab reads for every URL: private only where each one is
// private, and '' where any one is unknown. A path on this machine is private.
async function urlsVisibility($: any, urls: string[], windows: boolean): Promise<string> {
  let worst = urls.length ? 'private' : ''
  for (const url of urls) {
    const vis = localUrl(url, windows) ? 'private' : (await lookUp($, url))[0]
    if (!vis) return ''
    if (vis !== 'private') worst = vis
  }
  return worst
}

// Why a push run in `dir` waits for the user, by the holds in land-and-wrap §1,
// or '' when nothing holds it. The visibility is read for the remote the push
// goes to: origin's set in git config, else each URL it pushes to.
async function pushHold($: any, dir: string, remote: string | null | undefined): Promise<string> {
  const lift = (hold: string) => `The user can lift it for this clone with \`git config session-skills.${hold} false\`.`
  const waits = `so the push waits for the user's go. ${lift('holdPublicPush')}`
  // A push to this machine replaces nothing a reviewer read on a host, in a fork too.
  if (await localTarget($, dir, remote)) return ''
  if ((await remoteUrl($, dir, 'upstream')) !== null && (await setting($, dir, 'holdFork')) !== 'false') return `this repo is a fork, and a fork never pushes. ${lift('holdFork')}`
  if ((await setting($, dir, 'holdPublicPush')) === 'false') return ''
  if (remote === null) return `the remote it pushes to could not be read, ${waits}`
  const name = remote ?? (await pushRemote($, dir))
  const urls = await pushUrls($, dir, name)
  if (!urls) return `it pushes to \`${name}\`, which is not a remote of this repo, ${waits}`
  const origin = await pushUrls($, dir, 'origin')
  const isOrigin = name === 'origin' || (!!origin && urls.every(u => origin.includes(u)))
  const vis = (isOrigin && visibility(await setting($, dir, 'originVisibility'))) || (await urlsVisibility($, urls, onWindows(dir)))
  if (vis === 'private') return ''
  const what = isOrigin ? 'origin' : `the remote \`${name}\``
  return `${vis ? `${what} is ${vis}` : isOrigin ? "origin's visibility is unknown" : `the visibility of ${what} is unknown`}, ${waits}`
}

// Why gh or glab may open a PR or MR in a repo other than origin's, or '' when
// it opens it there. Both CLIs take the repo from GH_REPO or GITLAB_REPO first,
// then from a `gh-resolved` or `glab-resolved` key on a remote, which `gh repo
// set-default` writes, and then prefer a remote named upstream, github, or
// gitlab to origin. So only a clone with origin alone, resolved to itself, qualifies.
// shortcut: a GH_REPO set in a shell profile is not seen, since the hook reads Claude Code's own environment.
async function otherBase($: any, dir: string, what: string): Promise<string> {
  const glab = what.startsWith('glab')
  const name = glab ? 'GITLAB_REPO' : 'GH_REPO'
  const repo = await (glab ? $.env.get('GITLAB_REPO') : $.env.get('GH_REPO')).catch(() => '')
  if (repo) return `${name} is set to ${repo}`
  const others = (await must($, dir, 'remote')).split(/\r?\n/).map(r => r.trim()).filter(r => r && r !== 'origin')
  if (others.length) return `this clone has ${others.map(r => `\`${r}\``).join(', ')} besides origin, and the PR may open there`
  // A read that fails holds the PR.
  for (const [key, value] of new Map(await configList($, dir))) {
    if (/^remote\.origin\.(?:gh|glab)-resolved$/.test(key) && value !== 'base') return `${key} is set to ${value}`
  }
  return ''
}

// Why a host write waits for the user, or '' when it does not. Only a PR or MR
// opened in origin's repo, with holdPrText lifted and past the fork hold, goes
// unasked, unless hostRefusal refuses the branch push it may make.
async function hostHold($: any, w: HostWrite): Promise<string> {
  if (w.unread) return `\`${w.what}\` runs a git alias that could not be read, which may write to the remote host.`
  const write = `\`${w.what}\` writes to the remote host`
  if (!w.prCreate || w.otherRepo) return `${write}.`
  if (w.dir === null) return `${write}, and the repo it runs in could not be read from the command.`
  const dir = await where($, w.dir)
  const lift = (hold: string) => `The user can lift it for this clone with \`git config session-skills.${hold} false\`.`
  if ((await remoteUrl($, dir, 'upstream')) !== null && (await setting($, dir, 'holdFork')) !== 'false') return `${write}, and this repo is a fork, which writes nothing there. ${lift('holdFork')}`
  if ((await setting($, dir, 'holdPrText')) !== 'false') return `${write}, and a PR's text waits for the user's go. ${lift('holdPrText')}`
  const other = await otherBase($, dir, w.what)
  // The branch push it may make is checked by hostRefusal.
  return other ? `${write}, and ${other}.` : ''
}

// Why a host write that pushes the branch is refused, or '': the push it makes
// would be held, so the session's pre-push hook would refuse it after the
// approval. This is read before any reason to ask.
async function hostRefusal($: any, w: HostWrite, vague: boolean): Promise<string> {
  if (!w.pushes || w.unread) return ''
  if (!w.prCreate) return `\`${w.what} --push\` pushes to the repo it creates, which is not known to be private, so the session's pre-push hook would refuse the push after the approval. Create the repo, then push the branch as a command of its own with \`${BYPASS}\` after \`git\`.`
  if (w.dir === null) return ''
  const dir = await where($, w.dir)
  if (await localTarget($, dir, 'origin')) return ''
  const config = await pushConfig($, dir, { dir, dryRun: false, force: false, remote: 'origin', staged: w.staged })
  const held = config.force ? 'a force is set in config for the push.' : config.submodules ? 'it may push submodules to their own remotes.' : await pushHold($, dir, 'origin')
  if (!held) return ''
  const flag = w.what.startsWith('glab') ? '`--push=false`' : '`--head <branch>`'
  return `\`${w.what}\` may push the branch, and the session's pre-push hook would refuse that push after the approval: ${held} Push the branch first, as in \`git -C ${vague ? '<dir>' : typedDir(dir)} ${BYPASS} push origin <branch>\`, which the user is asked about, then open the PR with ${flag}.`
}

// The help.autocorrect values with which git 2.56.0 runs nothing for a subcommand
// it does not know. With `prompt` it asks at the terminal, which only the user can answer.
const SUGGESTS = new Set(['', '0', 'false', 'no', 'off', 'show', 'never', 'prompt'])

// Whether git may run a subcommand it does not know as the one closest to it,
// from the last help.autocorrect given with -c, else from config. A value that
// cannot be read, or one git refuses, is held.
async function autocorrects($: any, dir: string, configs: Word[]): Promise<boolean> {
  const set = configs.filter(w => /^help\.autocorrect(?:=|$)/is.test(w.text)).at(-1)
  // A -c key with no `=` sets the key to true.
  const v = set ? (set.literal ? (set.text.includes('=') ? set.text.slice(set.text.indexOf('=') + 1) : 'true') : null) : await configValue($, dir, 'help.autocorrect').catch(() => null)
  return v === null || !SUGGESTS.has(v.trim().toLowerCase())
}

// Each push in a command, with a git alias read from config in the directory it
// runs in, as `alias.<name>` and git 2.54's `alias.<name>.command`, and each
// expansion checked in its place with the -c values given with the alias. The
// gh and glab writes in each expansion are added to `hosts`. A subcommand with
// no alias is not a push unless help.autocorrect may run it as the command it is
// closest to, and it and an alias that cannot be read are held as a push and as
// a host write. A command that sends gh to another repo does so for each expansion.
async function pushesIn($: any, pushes: Push[], hosts: HostWrite[], depth = 0): Promise<Push[]> {
  const found: Push[] = []
  for (const p of pushes) {
    if (!p.alias) {
      found.push(p)
      continue
    }
    const unread = () => {
      found.push({ dir: p.dir, dryRun: false, force: p.force, remote: null, staged: p.staged })
      hosts.push({ what: `git ${p.alias}`, dir: p.dir, prCreate: false, otherRepo: false, pushes: false, unread: true })
    }
    const dir = p.unread || p.dir === null || depth > 3 ? null : await where($, p.dir).catch(() => null)
    if (dir === null) {
      unread()
      continue
    }
    // A name such as `pr:m` can only be read in the subsection form: git refuses `alias.pr:m` as a key.
    const keys = /^[a-z][a-z0-9-]*$/i.test(p.alias.split('.').at(-1)!) ? [`alias.${p.alias}`] : []
    let named = false
    for (const key of [...keys, `alias.${p.alias}.command`]) {
      const v = await configValue($, dir, key).catch(() => null)
      if (v === null) unread()
      if (v !== '') named = true
      if (!v) continue
      const text = expand(v, p.rest ?? '')
      for (const w of hostWrites(text, 'Bash', p.dir, p.configs)) hosts.push({ ...w, otherRepo: w.otherRepo || !!p.otherRepo, staged: w.staged || p.staged })
      const inner = pushTargets(text, 'Bash', p.dir, p.configs).map(e => (p.otherRepo && e.alias ? { ...e, otherRepo: true } : e))
      // A -c given with the alias that forces or moves the push holds for its expansion.
      for (const e of await pushesIn($, inner, hosts, depth + 1)) {
        found.push({ ...e, force: e.force || p.force, ...(p.remote === null && { remote: null }), staged: e.staged || p.staged, ...(e.bypass && !e.via && { via: p.alias }) })
      }
    }
    if (!named && (await autocorrects($, dir, p.configs ?? []))) unread()
  }
  return found
}

// Each tool that runs a shell command, with the shells its command is read in
// and the directory it starts in: undefined for the Bash tool's, null where the
// hook cannot read it. A terminal tab starts in `cwd` or the session's directory,
// and a reused one wherever its shell was left. The IDE terminal starts in its
// project, in the IDE's shell, which may be PowerShell.
const SHELLS: Record<string, (input: any) => { shells: string[]; dir: Dir }> = {
  Bash: () => ({ shells: ['Bash'], dir: undefined }),
  PowerShell: () => ({ shells: ['PowerShell'], dir: undefined }),
  Monitor: () => ({ shells: ['Bash'], dir: undefined }),
  // shortcut: a tab with no cwd, or a relative one, is read against the Bash tool's directory, not the session's starting one; read the start directory if a session that cd'd elsewhere pushes from a tab.
  mcp__terminal__run_in_terminal: i => ({ shells: ['Bash'], dir: i.tab_id ? null : typeof i.cwd !== 'string' || !i.cwd ? undefined : i.cwd.startsWith('~') ? null : i.cwd }),
  mcp__idea__execute_terminal_command: () => ({ shells: ['Bash', 'PowerShell'], dir: null }),
}

const BYPASS = '-c hook.sessionskills.enabled=false'
// A directory as it would be typed in a command. Git Bash drops an unquoted
// backslash, and git reads a Windows path written with slashes.
function typedDir(dir: string): string {
  const d = /^[A-Za-z]:\\/.test(dir) ? dir.replace(/\\/g, '/') : dir
  return /^[\w./:-]+$/.test(d) ? d : `'${d.replace(/'/g, `'\\''`)}'`
}

// The instruction in a push's refusal: the same push with the bypass, which the
// user is asked about, with its directory written out.
function retry(push: Push, dir: string): string {
  const at = dir ? typedDir(dir) : '<dir>'
  const run = push.retry ? push.retry.replace(DIR_MARK, () => at) : `git -C ${at} ${BYPASS} push <remote> <src>:<dst>`
  if (!dir || push.remote === null) return `Write the repo and the remote out, as in \`git -C <dir> push <remote> <src>:<dst>\`, so the push can be read, or, to ask the user, run: ${run}`
  return `To ask the user, run: ${run}`
}

// Adds why each push, config write, and host write in a command waits for the
// user, or, with `refuse`, why it is refused. A held push without the bypass
// is refused, since the session's pre-push hook would refuse it after an
// approval, and one with the bypass is asked about whatever the holds.
async function gate($: any, command: string, shell: string, outer: Dir, add: (reason: string, refuse?: boolean) => void) {
  const hosts = hostWrites(command, shell, outer)
  const pushes = (await pushesIn($, pushTargets(command, shell, outer), hosts)).filter(p => !p.dryRun)
  for (const push of pushes) {
    let force = push.force
    let noVerify = !!push.noVerify
    let submodules = !!push.submodules
    let why = "the repo it runs in could not be read from the command, so the push waits for the user's go."
    let dir = ''
    let remote = push.remote
    const vague = vagueDir(command, shell)
    if (push.dir !== null) {
      try {
        dir = await where($, push.dir)
        const config = await pushConfig($, dir, push)
        submodules = config.submodules
        if (config.unread) remote = null
        // A push to this machine adds no force line, by the hook's first rule.
        if (await localTarget($, dir, remote)) force = noVerify = false
        else force ||= config.force
        why = await pushHold($, dir, remote)
      } catch (err) {
        why = `the push hold could not be checked: ${(err as Error).message}`
      }
    }
    const reasons: string[] = []
    if (force) reasons.push('Force push: this replaces commits on the remote branch that a reviewer may already have read.')
    if (noVerify) reasons.push("No-verify push: `--no-verify` skips every pre-push hook, the session's included.")
    if (submodules) reasons.push("Push held: it may push submodules to their own remotes, which are not checked, so the push waits for the user's go.")
    if (why) reasons.push(`Push held: ${why}`)
    if (push.bypass && !push.via) {
      add(`Hook bypass: \`${BYPASS}\` turns the session's pre-push hook off for this push, so it waits for the user's go.`)
      for (const r of reasons) add(r)
    } else if (reasons.length || push.via) {
      const alias = push.via ? `The bypass is accepted only on git push itself, not through the alias \`${push.via}\`. ` : ''
      add(`Push refused: ${alias}${[...reasons, retry({ ...push, remote }, vague ? '' : dir)].join(' ')}`, true)
    }
  }
  for (const what of bypassMisuse(command, shell, outer)) {
    add(`Push refused: \`${what}\` is given \`${BYPASS}\`, which is accepted only on git push itself, since any other command may push where the command does not show. To ask the user, push with git itself: git -C <dir> ${BYPASS} push <remote> <src>:<dst>`, true)
  }
  // The bypass on a push is asked about above.
  const bypassed = pushes.some(p => p.bypass && !p.via)
  for (const what of hookWrites(command, shell, outer)) {
    if (!(bypassed && /^hook\.sessionskills\.enabled$/i.test(what))) add(`Hook setting held: \`${what}\` can turn the session's pre-push hook off or replace it, so it waits for the user's go.`)
  }
  // Each of these can move a later push or PR, which the hold reads before it runs.
  for (const what of configWrites(command, shell, outer)) add(`Config write held: \`${what}\` can change where a push or a PR goes, run one unseen, or lift a hold, so it waits for the user's go.`)
  for (const w of hosts) {
    const refused = await hostRefusal($, w, vagueDir(command, shell)).catch(err => {
      add(`Host write held: the branch push \`${w.what}\` may make could not be checked: ${(err as Error).message}`)
      return ''
    })
    // A quoted variable after --head most likely holds the branch name.
    if (refused) add(`Host write ${w.headUnread ? 'held' : 'refused'}: ${refused}`, !w.headUnread)
    const why = await hostHold($, w).catch(err => `the hold on \`${w.what}\` could not be checked: ${(err as Error).message}`)
    if (why) add(`Host write held: ${why}`)
  }
}

// Why a shell tool's input waits for the user (`reasons`) or is refused.
async function judge($: any, start: (input: any) => { shells: string[]; dir: Dir }, input: any) {
  const reasons: string[] = []
  const refusals: string[] = []
  const add = (reason: string, refuse = false) => (refuse ? refusals : reasons).includes(reason) || (refuse ? refusals : reasons).push(reason)
  // The engine skips a hook that throws, and the command would run unasked.
  try {
    const { shells, dir: outer } = start(input)
    for (const shell of shells) await gate($, String(input.command ?? ''), shell, outer, add)
  } catch (err) {
    add(`The command could not be checked for a push or a host write: ${(err as Error).message}.`)
  }
  return { refusals, reasons }
}

// The calls the `tool.check` hook decided, and the shell tools a call has run
// in without it, as under managed settings (DESIGN.md, "Native events only").
// The skip is per tool, not per session: on one managed machine Bash was
// checked and PowerShell was not.
const decided = new Set<string>()
const skipped = new Set<string>()
const SKIPPED = "Command refused: session-skills' permission check did not run for an earlier command of this tool in this session, as under managed settings that skip it, so this command cannot be put to the user in a permission prompt. Get the user's go in chat, and the user can run it from a `!` prompt."

// The session's pre-push hook, added to GIT_CONFIG_PARAMETERS for every git
// the session starts (DESIGN.md, "Pre-push backstop"). '' once it is set, else why not.
async function installBackstop($: any): Promise<string> {
  const current = (await $.env.get('GIT_CONFIG_PARAMETERS').catch(() => '')) ?? ''
  const set = await $.env.set('GIT_CONFIG_PARAMETERS', backstopConfig(current, `${$.plugin.root}/hooks/pre-push.sh`, await recordsPath($))).catch((err: Error) => ({ deny: err.message }))
  return set?.deny ? `GIT_CONFIG_PARAMETERS could not be set: ${set.deny}` : ''
}

// Why git in the session's repo will not run the hook, or ''. $.process.run adds
// hook.pre-push.enabled=false to every git it starts, so the listing turns it
// back on, and only a setting in a config file counts.
async function checkBackstop($: any): Promise<string> {
  const dir = (await $.session.repo().catch(() => null))?.root
  if (!dir) return ''
  const list = await git($, dir, '-c', 'hook.pre-push.enabled=true', 'hook', 'list', 'pre-push')
  if (!list.stdout.split(/\r?\n/).some(l => l.trim() === 'sessionskills')) return `\`git hook list pre-push\` did not list it (${firstLine(list.stderr) || 'git 2.54 or later runs a hook set in config'})`
  for (const key of ['hook.pre-push.enabled', 'hook.sessionskills.enabled']) {
    const set = await git($, dir, 'config', '--type=bool', '--show-scope', '--get-all', key)
    const off = set.stdout.split(/\r?\n/).find(l => /^(?!command\t)\S+\tfalse$/.test(l))
    if (off) return `${key} is false in the ${off.split('\t')[0]} config`
  }
  return ''
}

// Setup on every event, and the self-check once a session.
const checked = new Set<string>()
async function backstop($: any) {
  try {
    let why = await installBackstop($)
    const id = String(await $.session.id().catch(() => ''))
    if (checked.has(id)) return
    checked.add(id)
    // Each URL origin pushes to is looked up once, unawaited, so a push that
    // only the hook sees in a private session repo is allowed.
    const main = (await $.session.repo().catch(() => null))?.root
    if (main && !visibility(await setting($, main, 'originVisibility'))) {
      void pushUrls($, main, 'origin').then(urls => Promise.all((urls ?? []).filter(u => !localUrl(u, onWindows(main))).map(u => lookUp($, u)))).catch(() => {})
    }
    why ||= await checkBackstop($)
    if (why) $.ui.toast(`session-skills: the pre-push backstop is off, so a push inside another program, such as a release script, is not checked: ${why}.`)
  } catch {}
}

// The first line the session's pre-push hook prints when it refuses a push,
// and git's last line for any push that failed, which a pipe through tail leaves.
const HOOK_REFUSED = /push refused by the session's pre-push hook|failed to push some refs/
const NEXT_STEP ='This command pushed work. End the reply with the next step, under the session rules: the hand-off block for the next unit of work, or one line stating that this session carries on with it. When nothing can start yet, write one line on what the next item waits on, then the block for when it can start. When nothing comes next at all, say so in one line.'

const TITLE_RULES: Record<string, string> = { 'claude-desktop': 'title-desktop', cli: 'title-cli' }

// The session rules: the title instruction and, in the desktop app, the
// wrap-up instruction.
async function readRules($: any): Promise<string> {
  const read = (name: string) => $.fs.read(`${$.plugin.root}/hooks/${name}.md`).catch(() => '')
  // One title instruction per surface: a session given several called another
  // surface's tool in the desktop app and printed the title when that failed.
  const entry = await $.env.get('CLAUDE_CODE_ENTRYPOINT').catch(() => '')
  const title = (await read(TITLE_RULES[entry as string] ?? 'title-print')).trimEnd()
  // The desktop app ends a turn with its wrap_up tool, which nothing else has.
  const wrapUp = entry === 'claude-desktop' ? `${(await read('wrap-up-desktop')).trimEnd()}\n\n` : ''
  return (await read('rules')).replace('{{title}}', () => title).replace('{{wrap-up}}', () => wrapUp)
}

// Whether the model still reads this text: false after /clear, a compaction,
// or a plugin update that changed it, and undefined where the conversation is
// not read back. Context added to a tool call is in its result.
async function isRead($: any, text: string): Promise<boolean | undefined> {
  const messages = await $.session.messages({ as: 'api' }).catch(() => undefined)
  if (!Array.isArray(messages)) return undefined
  const has = (b: any): boolean => b.type === 'text' ? String(b.text).includes(text)
    : b.type === 'tool_result' && (typeof b.content === 'string' ? b.content.includes(text) : Array.isArray(b.content) && b.content.some(has))
  return messages.some(m => m.role === 'user' && Array.isArray(m.content) && m.content.some(has))
}

// The first message of the conversation, which a compaction or /clear replaces.
async function head($: any): Promise<string> {
  const messages = await $.session.messages({ as: 'api' }).catch(() => undefined)
  return Array.isArray(messages) ? JSON.stringify(messages[0] ?? null) : ''
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'edit_primary_file',
      description: "Edit a file in the repo's primary checkout from a worktree session: replace one passage, or append. The file is read and written in one call. Nothing is written when the passage is absent or occurs more than once, or when the file changes during the call. The path is checked as text, so a link inside the checkout is followed. Two calls at the same moment can both succeed with one edit lost, so read the file afterward where that matters.",
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path of a file inside the primary checkout.' },
          old: { type: 'string', description: 'The passage to replace, exactly as it is in the file. Empty to append `new` at the end, creating the file if it is not there.' },
          new: { type: 'string', description: 'The text that replaces it.' },
        },
        required: ['path', 'old', 'new'],
      },
      isDeferred: false,
    })
    for (const [name, tool] of Object.entries(TOOLS)) await $.tool.register({ name, ...tool, isDeferred: false })
    await backstop($)
    // The desktop app has a title tool of its own, and a session run with -p has
    // no title to set.
    if ((await $.env.get('CLAUDE_CODE_ENTRYPOINT').catch(() => '')) === 'cli') {
      await $.tool.register({
        name: 'set_session_title',
        description: "Set this session's title, as /rename does. The title is applied when this turn ends, so call it before the reply ends.",
        inputSchema: { type: 'object', properties: { title: { type: 'string', description: 'The title, with its first word capitalized.' } }, required: ['title'] },
        isDeferred: false,
      })
    }
    return next(e)
  })

  // The turn that pushes is the last turn of a landing, and in October 2026 13
  // of 16 such turns ended with no next step. The request for one is added to the
  // push's own result, so the reply is written with it in view.
  for (const tool of ['Bash', 'PowerShell']) {
    on('tool.call', { tool }, async ($, e: any, next: any) => {
      const ran = await next(e)
      if (e.agentId || ran.deny !== undefined || (ran as any).isError) return ran
      // A push that failed pushed nothing, whatever the command's exit code.
      if (HOOK_REFUSED.test(JSON.stringify(ran.result ?? ''))) return ran
      let pushed = false
      try {
        pushed = pushTargets(String(e.command ?? ''), tool).some(p => !p.alias && !p.dryRun)
      } catch {}
      if (!pushed) return ran
      return { ...ran, context: [...(ran.context ?? []), NEXT_STEP] }
    })
  }

  // A held push is put to the user in the permission prompt, in every mode: a
  // session that pushed without reading land-and-wrap pushed to this public
  // repo on 2026-11-06. A force push is put to the user whatever the holds,
  // since it replaces commits a reviewer may have read. A write to the host
  // with gh or glab, such as a comment or a merge, is put to the user too. Where
  // nobody can be asked, the command is refused. A subagent's is held too.
  for (const [tool, start] of Object.entries(SHELLS)) {
    on('tool.check', { tool }, async ($, e: any, next: any) => {
      const verdict = await next(e)
      if (verdict.decision === 'deny') return verdict
      const { refusals, reasons } = await judge($, start, e.input ?? {})
      if (e.tool_use_id) decided.add(e.tool_use_id)
      // The reasons to ask go with a refusal, since the command run instead meets them.
      if (refusals.length) return { decision: 'deny', reason: [...refusals, ...reasons].join(' ') }
      return reasons.length ? { decision: 'ask', reason: reasons.join(' ') } : verdict
    })

    // Under managed settings `cc-plugin-sec-default` may send the hook above
    // past this plugin, and nothing is asked. It fires inside this hook's
    // `next`, just before the tool runs, so what it would refuse is refused
    // here first, and a skip is learned from a call that ran. Later calls of
    // the tool are refused where that hook would have asked.
    // shortcut: a held command is judged here and again in tool.check; pass the verdict by tool_use_id if the second read is seen to slow a push.
    on('tool.call', { tool }, async ($, e: any, next: any) => {
      const { refusals, reasons } = await judge($, start, e)
      const skip = skipped.has(tool)
      if (refusals.length || (skip && reasons.length)) return { deny: [...(skip ? [SKIPPED] : []), ...refusals, ...reasons].join(' ') }
      const ran = await next(e)
      const id = e.tool_use_id
      if (!id) return ran
      if (decided.delete(id)) skipped.delete(tool)
      // A call that failed reached the tool: a command that exits non-zero is an error result.
      else if (ran.deny === undefined) skipped.add(tool)
      return ran
    })
  }

  // A title set in a turn is applied when the turn ends, since /rename waits for
  // the session to be idle and a hook on the call would wait on it. In the
  // terminal the command shows as one line.
  // ponytail: held in memory, so a title set just before a hot reload is lost, and the model is asked for one again only when a better one fits.
  let title = ''
  on('tool.call', { tool: 'mcp__session-skills__set_session_title' }, async ($, e: any) =>
    answer('set_session_title', async () => {
      const given = String(e.title ?? '').trim().replace(/\s+/g, ' ')
      if (!given) throw new Error('the title is empty')
      if (!e.agentId) title = given
      return `The title is set to ${JSON.stringify(given)} when this turn ends.`
    }))
  on('turn.complete', async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId || !title) return ran
    const args = title
    title = ''
    await $.command.run({ command: 'rename', args }).catch(() => $.ui.toast(`session-skills: the session title "${args}" could not be set. Use /rename.`))
    return ran
  })

  // The rules go with the first prompt, and again once the model no longer
  // reads them. A fork starts with its parent's context, where they already are.
  on('prompt.submit', async ($, e: any, next: any) => {
    await backstop($)
    const rules = await readRules($)
    return next(rules && !(await isRead($, rules)) ? { ...e, context: [...(e.context ?? []), rules] } : e)
  })

  // After an automatic compaction in the middle of a turn the main loop goes without the rules until the next prompt. They are added to
  // the next tool result, and not again until the model reads them back or the
  // conversation is compacted again, since calls that run in parallel all start
  // before any result is read back. A subagent never gets them.
  const added = new Map<string, string>()
  on('tool.call', async ($, e: any, next: any) => {
    const ran = await next(e)
    if (ran.deny !== undefined || e.agentId) return ran
    const rules = await readRules($).catch(() => '')
    const read = rules ? await isRead($, rules) : undefined
    const id = await $.session.id().catch(() => '')
    if (read) added.delete(id)
    if (read !== false) return ran
    const at = await head($)
    if (added.get(id) === at) return ran
    added.set(id, at)
    return { ...ran, context: [...(ran.context ?? []), rules] }
  })

  on('tool.call', { tool: 'mcp__session-skills__find_checkouts' }, async $ => answer('find_checkouts', () => findCheckouts($)))
  on('tool.call', { tool: 'mcp__session-skills__open_worktree' }, async ($, e: any) => answer('open_worktree', () => openWorktree($, e)))
  on('tool.call', { tool: 'mcp__session-skills__prune_branches' }, async $ => answer('prune_branches', () => pruneBranches($)))
  on('tool.call', { tool: 'mcp__session-skills__remove_worktree' }, async ($, e: any) => answer('remove_worktree', () => removeWorktree($, e)))
  on('tool.call', { tool: 'mcp__session-skills__landing_facts' }, async $ => answer('landing_facts', () => landingFacts($)))

  on('tool.call', { tool: 'mcp__session-skills__edit_primary_file' }, async ($, e: any) => {
    try {
      const main = (await $.session.repo())?.root
      if (!main) throw new Error('not inside a git repository')
      const path = String(e.path).replace(/\\/g, '/')
      const root = main.replace(/\\/g, '/').replace(/\/$/, '')
      // A path with a drive letter is on Windows, where two paths that differ only in letter case are the same path.
      const fold = (p: string) => (/^[A-Za-z]:\//.test(p) ? p.toLowerCase() : p)
      if (!fold(path).startsWith(`${fold(root)}/`) || path.split('/').includes('..')) throw new Error(`${e.path} is not inside the primary checkout ${main}`)
      const read = async (): Promise<string> => ((await $.fs.exists(e.path)) ? $.fs.read(e.path) : '')
      const text = await read()
      const next = splice(text, String(e.old), String(e.new))
      // Another session may have written the file since the read above.
      if ((await read()) !== text) throw new Error(`${e.path} changed while it was being edited. Nothing was written. Call the tool again.`)
      await $.fs.write(e.path, next)
      return { result: `edited ${e.path}` }
    } catch (err) {
      const text = `edit_primary_file: ${(err as Error).message}`
      return { result: text, text, isError: true }
    }
  })
}
