// The tools that open a worktree for a lane and remove it, registered from
// register.ts. Where a new branch starts is decided in session-skills, so
// open_worktree is given the base that find_checkouts returned.
import type { Register } from 'claude-code'

export const WORKTREE_TOOLS = {
  open_worktree: {
    description: "Open a new worktree and branch for a lane under the primary checkout's .claude/worktrees, starting from the given base, pull its Git LFS files, copy the primary checkout's ask rules to it, and link the repo's local notes directory into it. A name already taken gets a numeric suffix. Returns the worktree path and branch.",
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'A short descriptive slug for the work, lowercase words joined by hyphens, such as parser-cache. Never a generic activity word such as roadmap-lap.' },
        id: { type: 'string', description: "The work's backlog ID, such as R78 or ABC-123, prefixed to the name. Omit where the work has none." },
        base: { type: 'string', description: "The ref the branch starts from: the `base for a new branch` line that session-skills' find_checkouts returned, such as main or origin/main." },
        notes: { type: 'string', description: "The repo's local-only notes directory at its root. Defaults to notes.local." },
      },
      required: ['name', 'base'],
    },
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
} as const

// Every command is run by argument vector, in the primary checkout: the
// session's directory is the default, and nothing starts there once a session
// has removed the worktree it had changed into. A command that cannot start is
// a failed command.
type Ran = { exitCode: number; stdout: string; stderr: string }
async function run($: any, argv: string[], timeoutMs = 30_000): Promise<Ran> {
  try {
    return await $.process.run(argv, { cwd: await primary($), timeoutMs })
  } catch (err) {
    return { exitCode: 127, stdout: '', stderr: (err as Error).message }
  }
}
const git = ($: any, cwd: string, ...argv: string[]) => run($, ['git', '-C', cwd, ...argv], argv.includes('lfs') ? 120_000 : 30_000)
const ok = async (ran: Promise<Ran>) => (await ran).exitCode === 0
const firstLine = (text: string) => text.trim().split(/\r?\n/)[0] ?? ''

async function primary($: any): Promise<string> {
  const main = (await $.session.repo())?.root
  if (!main) throw new Error('not inside a git repository')
  return main
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
  const main = await primary($)
  const warnings: string[] = []
  // The base was picked in session-skills, after its fetch.
  const base = String(e.base ?? '')
  const baseRef = base.startsWith('origin/') ? `refs/remotes/${base}` : `refs/heads/${base}`
  if (!base || !(await ok(git($, main, 'rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`)))) {
    throw new Error(`base ${JSON.stringify(base)} is not a branch here: pass the "base for a new branch" line of session-skills' find_checkouts`)
  }
  const root = `${main}/.claude/worktrees`
  const wanted = id ? `${id.toLowerCase()}-${slug}` : slug
  let name = wanted
  for (let n = 2; (await $.fs.exists(`${root}/${name}`)) || (await ok(git($, main, 'show-ref', '--verify', '--quiet', `refs/heads/claude/${name}`))); n++) name = `${wanted}-${n}`
  const path = `${root}/${name}`
  const added = await git($, main, 'worktree', 'add', '--no-track', path, '-b', `claude/${name}`, baseRef)
  if (added.exitCode !== 0) throw new Error(`git worktree add: ${firstLine(added.stderr) || `exit ${added.exitCode}`}`)
  // Claude Code runs git with GIT_LFS_SKIP_SMUDGE=1, so the checkout leaves LFS
  // files as pointers. `git lfs pull` writes them without the smudge filter.
  // ponytail: only the root .gitattributes is read, so an LFS pattern set only in a nested one is missed.
  const attributes = `${path}/.gitattributes`
  if ((await $.fs.exists(attributes)) && /\bfilter=lfs\b/.test(await $.fs.read(attributes).catch(() => ''))) {
    const pulled = await git($, path, 'lfs', 'pull')
    if (pulled.exitCode !== 0) warnings.push(`LFS files were left as pointers, so run \`git lfs pull\` in the worktree: ${firstLine(pulled.stderr) || `exit ${pulled.exitCode}`}`)
  }
  // A session started in the worktree reads its own settings file on Windows,
  // so the primary checkout's ask rules are copied to it. The push and post
  // rules of session-skills are among them.
  const settings = '.claude/settings.local.json'
  try {
    const asks = (await $.fs.exists(`${main}/${settings}`)) ? JSON.parse(await $.fs.read(`${main}/${settings}`))?.permissions?.ask : []
    if (Array.isArray(asks) && asks.length && !(await $.fs.exists(`${path}/${settings}`))) {
      await $.fs.write(`${path}/${settings}`, `${JSON.stringify({ permissions: { ask: asks } }, null, 2)}\n`)
    }
  } catch (err) {
    warnings.push(`the ask rules in ${main}/${settings} were not copied to the worktree: ${(err as Error).message}`)
  }
  const lines = [`worktree: ${path}`, `branch: claude/${name}`, `opened from: ${base}`, `primary checkout: ${main}`]
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

// A tool's answer, or its error as the result: nothing is thrown at the model.
async function answer(name: string, run: () => Promise<string>) {
  try {
    return { result: await run() }
  } catch (err) {
    const text = `${name}: ${(err as Error).message}`
    return { result: text, text, isError: true }
  }
}

export const worktreeTools: Register = on => {
  on('tool.call', { tool: 'mcp__parallel-session-skills__open_worktree' }, async ($, e: any) => answer('open_worktree', () => openWorktree($, e)))
  on('tool.call', { tool: 'mcp__parallel-session-skills__remove_worktree' }, async ($, e: any) => answer('remove_worktree', () => removeWorktree($, e)))
}
