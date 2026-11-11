// The plugin's hooks module: the rules a session starts with, the tools that
// run the git work of both skills, the permission rules that put a push or a
// post to the user, and the tool a worktree session calls to edit a file that
// is only in the primary checkout.
import type { Register } from 'claude-code'
import { askRules, outward, pickBase, POST_RULES, PUSH_RULES, refLine, worktreeName } from './checkouts'
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
    description: "Report the facts used to choose how work leaves its branch in this clone: whether it is a fork, the push mode (confirm-push or auto-push), the post mode (confirm-post or auto-post), and the landing mode (merge or pr), each with where it was read. Read from per-clone git config first, then gh for the landing mode where installed. Read-only.",
    inputSchema: NONE,
  },
  set_push_policy: {
    description: "Set this clone's push mode, its post mode, or both, in per-clone git config, and write the matching permission rules to .claude/settings.local.json in the primary checkout and every worktree. In a confirm mode a push, or a post to the host with gh or glab, raises a permission prompt in every permission mode. The user is asked before a switch to an auto mode. Call it only when the user asks for a mode in this conversation.",
    inputSchema: {
      type: 'object',
      properties: {
        push: { type: 'string', enum: ['confirm-push', 'auto-push'], description: 'confirm-push: the user confirms each git push in the permission prompt. auto-push: a push runs unasked.' },
        post: { type: 'string', enum: ['confirm-post', 'auto-post'], description: 'confirm-post: the user confirms each PR, issue, comment, or release written with gh or glab. auto-post: those run unasked. A fork is always confirm-post.' },
      },
    },
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
  // A session started in the worktree reads its own settings file on Windows.
  await writeRules($, main, [path]).catch(err => warnings.push(`the push and post rules were not written to the worktree: ${(err as Error).message}`))
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

// The push and post modes of a clone, each with where it was read. Unset is a
// confirm mode. The keys of 0.29.0 that lifted a hold are still read, and a
// fork has no auto-post, since a post there is written to someone else's project.
type Modes = { fork: boolean; push: string; pushFrom: string; post: string; postFrom: string }
async function readModes($: any, main: string): Promise<Modes> {
  const fork = (await remoteUrl($, main, 'upstream')) !== null
  const [push, post, oldPush, oldPost] = await Promise.all(['pushMode', 'postMode', 'holdPublicPush', 'holdPrText'].map(key => setting($, main, key)))
  const from = (key: string) => `git config session-skills.${key}`
  const pushed = push === 'confirm-push' || push === 'auto-push' ? [push, from('pushMode')] : oldPush === 'false' ? ['auto-push', `${from('holdPublicPush')} false`] : ['confirm-push', 'the default']
  const posted = fork ? ['confirm-post', 'always, in a fork']
    : post === 'confirm-post' || post === 'auto-post' ? [post, from('postMode')] : oldPost === 'false' ? ['auto-post', `${from('holdPrText')} false`] : ['confirm-post', 'the default']
  return { fork, push: pushed[0]!, pushFrom: pushed[1]!, post: posted[0]!, postFrom: posted[1]! }
}
const modeLines = (m: Modes) => [`push: ${m.push} (${m.pushFrom})`, `post: ${m.post} (${m.postFrom})`]

// Writes the ask rules of each confirm mode to `.claude/settings.local.json` in
// each directory, and with `lift` takes out the rules of an auto mode. Returns
// the files written. A rule there is read by a session started in that
// directory, prompts in every permission mode, and is applied by a running
// interactive session at once. A session run with -p applies it from its next
// start. The file is excluded from git where nothing ignores it yet.
async function writeRules($: any, main: string, dirs: string[], lift = false): Promise<string[]> {
  const m = await readModes($, main)
  const add = [...(m.push === 'confirm-push' ? PUSH_RULES : []), ...(m.post === 'confirm-post' ? POST_RULES : [])]
  const drop = lift ? [...PUSH_RULES, ...POST_RULES].filter(rule => !add.includes(rule)) : []
  const written: string[] = []
  for (const dir of new Set(dirs)) {
    const path = `${dir.replace(/[\\/]+$/, '')}/.claude/settings.local.json`
    const had: string = (await $.fs.exists(path)) ? await $.fs.read(path) : ''
    let next: string | null
    try {
      next = askRules(had, add, drop)
    } catch (err) {
      throw new Error(`${path} was left as it is: ${(err as Error).message}`)
    }
    if (next === null) continue
    await $.fs.write(path, next)
    written.push(path)
  }
  // Exit 1 is a path nothing ignores, and any other failure leaves the exclude file alone.
  if (written.length && (await git($, main, 'check-ignore', '-q', '.claude/settings.local.json')).exitCode === 1) {
    const dir = await out(git($, main, 'rev-parse', '--path-format=absolute', '--git-common-dir'))
    const had: string = dir ? await $.fs.read(`${dir}/info/exclude`).catch(() => '') : ''
    if (dir) await $.fs.write(`${dir}/info/exclude`, `${had}${had && !had.endsWith('\n') ? '\n' : ''}**/.claude/settings.local.json\n`)
  }
  return written
}

// The rules for the directory a session starts in, and for the primary
// checkout, whose file a worktree session reads on macOS. Rules are only
// added here: taking one out is the user's decision, made in set_push_policy.
async function startRules($: any): Promise<void> {
  const repo = await $.session.repo().catch(() => null)
  if (!repo?.root) return
  const top = await git($, await $.session.cwd(), 'rev-parse', '--show-toplevel')
  await writeRules($, repo.root, [repo.root, ...(top.exitCode === 0 ? [top.stdout.replace(/\n$/, '')] : [])])
}

async function setPushPolicy($: any, e: any): Promise<string> {
  const main = await primary($)
  const now = await readModes($, main)
  const wanted = [['pushMode', e.push, now.push, ['confirm-push', 'auto-push']], ['postMode', e.post, now.post, ['confirm-post', 'auto-post']]].filter(w => w[1] !== undefined) as [string, string, string, string[]][]
  if (!wanted.length) throw new Error('neither push nor post was given')
  for (const [, mode, , modes] of wanted) if (!modes.includes(mode)) throw new Error(`${JSON.stringify(mode)} is not one of ${modes.join(', ')}`)
  if (now.fork && e.post === 'auto-post') throw new Error('this clone is a fork, where a post is always confirmed')
  const lifted = wanted.filter(([, mode, was]) => mode.startsWith('auto-') && mode !== was).map(([, mode]) => mode)
  if (lifted.length) {
    const what = lifted.map(mode => (mode === 'auto-push' ? 'every git push' : 'every PR, issue, comment, and release written with gh or glab')).join(', and ')
    const answer = await $.ui.ask(`Switch this clone to ${lifted.join(' and ')}? Claude then runs ${what} here without asking.`, ['Switch', 'Keep confirming']).catch(() => {
      throw new Error('nobody could be asked, so the modes are left as they are')
    })
    if (answer !== 'Switch') return ['The user kept the modes as they are.', ...modeLines(now)].join('\n')
  }
  for (const [key, mode] of wanted) await must($, main, 'config', `session-skills.${key}`, mode)
  const written = await writeRules($, main, (await worktrees($, main)).map(w => w.path), true)
  return [...modeLines(await readModes($, main)), ...written.map(path => `rules written: ${path}`)].join('\n')
}

async function landingFacts($: any): Promise<string> {
  const main = await primary($)
  const modes = await readModes($, main)
  const url = (await remoteUrl($, main, 'origin')) ?? ''

  // A fork never merges into its default branch. Elsewhere, GitHub returns
  // `protected` from its plain branch endpoint to any reader, and its
  // protection endpoint needs admin rights, so the first is read, plus the
  // branch's rulesets.
  let mode = modes.fork ? 'pr' : await setting($, main, 'landing')
  let modeFrom = modes.fork ? 'a fork' : 'git config'
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
  return [`fork: ${modes.fork ? 'yes, an upstream remote is set' : 'no'}`, ...modeLines(modes), `landing: ${mode ? `${mode} (${modeFrom})` : 'unknown'}`].join('\n')
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
    // A rule that cannot be written leaves a push unasked in auto mode, so the user is told.
    await startRules($).catch(err => $.ui.toast(`session-skills: the push and post rules were not written. ${(err as Error).message}`))
    return next(e)
  })

  // The turn that pushes is the last turn of a landing, and in October 2026 13
  // of 16 such turns ended with no next step. The request for one is added to the
  // push's own result, so the reply is written with it in view.
  for (const tool of ['Bash', 'PowerShell']) {
    on('tool.call', { tool }, async ($, e: any, next: any) => {
      const ran = await next(e)
      if (e.agentId || ran.deny !== undefined || (ran as any).isError) return ran
      // A push that failed pushed nothing, whatever the command's exit code,
      // and git's last line for it is left by a pipe through tail.
      if (JSON.stringify(ran.result ?? '').includes('failed to push some refs')) return ran
      let pushed = false
      try {
        pushed = outward(String(e.command ?? ''), tool).pushes.some(p => !p.dryRun)
      } catch {}
      if (!pushed) return ran
      return { ...ran, context: [...(ran.context ?? []), NEXT_STEP] }
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
  on('tool.call', { tool: 'mcp__session-skills__set_push_policy' }, async ($, e: any) => answer('set_push_policy', () => setPushPolicy($, e)))

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
