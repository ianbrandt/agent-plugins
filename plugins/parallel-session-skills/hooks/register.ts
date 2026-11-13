// The plugin's hooks module: the tools a session calls to read the claim
// ledger, write its claim, and release it, the release at session end for a
// session that never wrapped, and the two worktree tools of worktree.ts.
import type { Register } from 'claude-code'
import { type Entry, dead, fileOf, ownedBy, parse } from './ledger'
import { WORKTREE_TOOLS, worktreeTools } from './worktree'

const TOOLS = {
  read_ledger: {
    description: 'Read the claim ledger in the primary checkout, from any worktree. Dead claims are deleted first: a claim is dead when no worktree has its branch checked out, and none is deleted while a worktree is detached. Returns the ledger path, the claims deleted, every live claim, and the checkout mode: `worktree`, where a unit of work goes in a worktree unless the user asks for the primary checkout, or `primary`.',
    inputSchema: { type: 'object', properties: {} },
  },
  write_claim: {
    description: "Write this session's claim for the branch the work is on, in a worktree or in the primary checkout, replacing any claim for that branch. Returns the whole ledger as it is after the write, to compare touches against, then the instruction to call read_ledger once more before the first edit.",
    inputSchema: {
      type: 'object',
      properties: {
        worktree: { type: 'string', description: "Absolute path of the checkout the work is in: the lane's worktree, or the primary checkout while it is on the work's branch. The primary checkout on its default branch is refused." },
        item: { type: 'string', description: 'What is claimed, as a short phrase.' },
        touches: { type: 'array', items: { type: 'string' }, description: 'Paths and globs this lane expects to edit.' },
      },
      required: ['worktree', 'item', 'touches'],
    },
  },
  release_claim: {
    description: "Delete this session's claim for the branch checked out in a worktree or in the primary checkout. Returns the claims that remain. For a path that is no longer a worktree of the repo, and for the primary checkout back on its default branch, releases the claims of this session that have no worktree instead. An error when there is no claim, or when the claim is another session's.",
    inputSchema: {
      type: 'object',
      properties: { worktree: { type: 'string', description: "Absolute path of the checkout the claim was written for, written out literally: the lane's worktree, or the primary checkout." } },
      required: ['worktree'],
    },
  },
} as const

const DIR = '.claude/claims'

// git is run in the primary checkout. The session's directory is the default,
// and nothing starts there once a session has removed the worktree it had
// changed into.
async function git($: any, cwd: string, ...argv: string[]): Promise<string> {
  const ran = await $.process.run(['git', '-C', cwd, ...argv], { cwd: await primary($) })
  if (ran.exitCode !== 0) throw new Error(`git ${argv.join(' ')} in ${cwd}: ${ran.stderr.trim() || `exit ${ran.exitCode}`}`)
  return ran.stdout
}

// The ledger is in the primary checkout, which is not the session's directory
// in a worktree session.
async function primary($: any): Promise<string> {
  const main = (await $.session.repo())?.root
  if (!main) throw new Error('not inside a git repository')
  return main
}

async function entries($: any, main: string): Promise<Entry[]> {
  const listed = await $.fs.list(`${main}/${DIR}`).catch(() => [])
  const files = listed.filter((f: any) => f.kind === 'file' && f.name.endsWith('.json'))
  return Promise.all(files.map(async (f: any) => ({ name: f.name, mtimeMs: f.mtimeMs, text: await $.fs.read(`${main}/${DIR}/${f.name}`).catch(() => '') })))
}

// $.fs has no delete, and git is the one program every session here has. A
// claim file is untracked, so `git clean` on its literal path removes it and
// nothing else.
async function remove($: any, main: string, name: string): Promise<void> {
  await git($, main, 'clean', '-f', '-x', '-q', '--', `:(literal)${DIR}/${name}`)
  if (await $.fs.exists(`${main}/${DIR}/${name}`)) throw new Error(`${DIR}/${name} was not deleted`)
}

// The worktrees git lists, the primary checkout's first, with the branch each
// has checked out. A detached worktree has none. With -z each line ends in NUL,
// so a newline in a path stays in it.
async function worktrees($: any, main: string): Promise<{ path: string; branch: string | null }[]> {
  const found: { path: string; branch: string | null }[] = []
  for (const line of (await git($, main, 'worktree', 'list', '--porcelain', '-z')).split('\0')) {
    if (line.startsWith('worktree ')) found.push({ path: line.slice('worktree '.length), branch: null })
    else if (line.startsWith('branch refs/heads/') && found.length) found[found.length - 1].branch = line.slice('branch refs/heads/'.length)
  }
  return found
}

// A path with a drive letter is on Windows, where two paths that differ only in
// letter case or in the separator are the same path.
const fold = (p: string) => (/^[A-Za-z]:[\\/]/.test(p) ? p.replace(/\\/g, '/').toLowerCase() : p)

// The branch origin/HEAD points at.
// shortcut: `main` where there is no origin/HEAD, so a repo with no remote and another default branch name is not refused on it; read init.defaultBranch if that comes up.
async function defaultBranch($: any, main: string): Promise<string> {
  const ran = await $.process.run(['git', '-C', main, 'symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD'], { cwd: main })
  return (ran.exitCode === 0 && ran.stdout.trim().replace(/^origin\//, '')) || 'main'
}

// The branch a claim is filed under, found by the checkout's path in git's
// list: a branch name alone would match a clone of another repo. The primary
// checkout is taken only on a branch other than the default: a path re-derived
// from a session's own directory is often the primary checkout, and a claim
// under the default branch would be for no unit of work.
async function lane($: any, main: string, worktree: string): Promise<string> {
  // git ends the path it prints with one newline, and anything before that is
  // part of the path.
  const top = (await git($, worktree, 'rev-parse', '--show-toplevel')).replace(/\n$/, '')
  const all = await worktrees($, main)
  const at = all.findIndex(w => fold(w.path) === fold(top))
  if (at < 0) throw new Error(`${worktree} is not a worktree of this repo`)
  const { branch } = all[at]
  if (at === 0 && (!branch || branch === (await defaultBranch($, main)))) {
    throw new Error(`${worktree} is the primary checkout, on ${branch ? `its default branch ${branch}` : 'a detached HEAD'}: pass the lane's own worktree, or switch to the work's branch first`)
  }
  if (!branch) throw new Error(`${worktree} is on a detached HEAD: put it on a branch first`)
  return branch
}

const render = (main: string, list: Entry[]) =>
  `ledger: ${main}/${DIR}\n${list.length ? list.map(e => e.text.trim()).join('\n') : 'no claims'}`

// Where a unit of work goes, with where that was read. Unset, or a value that
// is neither mode, is a worktree.
async function checkoutMode($: any, main: string): Promise<string> {
  const key = 'parallel-session-skills.checkoutMode'
  const value = await git($, main, 'config', '--get', key).then(v => v.trim(), () => '')
  return value === 'worktree' || value === 'primary' ? `checkout: ${value} (git config ${key})` : 'checkout: worktree (the default)'
}

async function readLedger($: any, main: string): Promise<string> {
  const all = await entries($, main)
  await git($, main, 'worktree', 'prune')
  const listed = await worktrees($, main)
  const detached = listed.some(w => !w.branch)
  const branches = listed.flatMap(w => (w.branch ? [w.branch] : []))
  const now = await $.clock.now()
  const gone: Entry[] = []
  for (const e of dead(all, branches, now, detached)) {
    // A file that did not parse may have been read while another session wrote
    // it, so it is read and judged again. Its age is taken after the read: a
    // file still torn by a write in progress then has that write's time.
    if (!parse(e.text)) {
      const path = `${main}/${DIR}/${e.name}`
      e.text = await $.fs.read(path).catch(() => '')
      e.mtimeMs = (await $.fs.stat(path).catch(() => e)).mtimeMs
      if (!dead([e], branches, now, detached).length) continue
    }
    gone.push(e)
  }
  for (const e of gone) await remove($, main, e.name)
  const reaped = gone.map(e => `reaped dead claim: ${e.name}\n`).join('')
  const held = detached ? 'a worktree is detached, so no claim that parses was reaped\n' : ''
  return `${reaped}${held}${render(main, all.filter(e => !gone.includes(e)))}\n${await checkoutMode($, main)}`
}

async function writeClaim($: any, main: string, e: any): Promise<string> {
  const branch = await lane($, main, String(e.worktree))
  const claim = {
    item: String(e.item),
    branch,
    started: new Date(await $.clock.now()).toISOString().replace(/\.\d+Z$/, 'Z'),
    session: await $.session.id(),
    touches: [...e.touches].map(String),
  }
  await $.fs.write(`${main}/${DIR}/${fileOf(branch)}`, JSON.stringify(claim) + '\n')
  // The last line is the one a session reads next. With the instruction only
  // in a skill, the second read was skipped in half the sessions measured.
  return `${render(main, await entries($, main))}\ncall read_ledger once more before the first edit: a claim written after this one is not listed here`
}

async function releaseClaim($: any, main: string, e: any): Promise<string> {
  // A directory deleted without `git worktree remove` is listed until a prune,
  // and its branch with it.
  await git($, main, 'worktree', 'prune')
  const listed = await worktrees($, main)
  // A removed worktree is found by its path, since a build daemon can make the
  // directory again, and git reads one under the primary checkout as the
  // primary checkout. It has no branch to look up. The claims this session can
  // release are its own with no worktree left: a conductor has others, one a
  // lane still in flight.
  const slash = (p: string) => fold(p.replace(/\\/g, '/').replace(/\/$/, ''))
  const path = slash((await $.fs.stat(String(e.worktree), { resolve: true }).catch(() => undefined))?.realPath ?? String(e.worktree))
  // After a landing the primary checkout is back on its default branch, and the
  // work's branch is in no worktree, as a removed worktree's is.
  const landed = path === slash(listed[0].path) && listed[0].branch === (await defaultBranch($, main))
  if (landed || !listed.some((w, i) => path === slash(w.path) || (i > 0 && path.startsWith(`${slash(w.path)}/`)))) {
    const gone = landed ? `${e.worktree} is the primary checkout, on its default branch ${listed[0].branch}` : `${e.worktree} is not a worktree of this repo`
    if (listed.some(w => !w.branch)) throw new Error(`${gone} and a worktree is detached, so the claim for it cannot be told from that worktree's. Release it once no worktree is detached.\n${render(main, await entries($, main))}`)
    const standing = listed.map(w => w.branch)
    const mine = ownedBy(await entries($, main), await $.session.id()).filter(m => !standing.includes(parse(m.text)!.branch))
    if (!mine.length) throw new Error(`no claim of this session is for a branch in no worktree, and ${gone}\n${render(main, await entries($, main))}`)
    for (const m of mine) await remove($, main, m.name)
    return `released: ${mine.map(m => m.name).join(', ')} (${gone}, so the claims of this session with no worktree were released)\n${render(main, await entries($, main))}`
  }
  const name = fileOf(await lane($, main, String(e.worktree)))
  const all = await entries($, main)
  const found = all.find(x => x.name === name)
  if (!found) throw new Error(`no claim ${name}\n${render(main, all)}`)
  // The primary checkout's path is the one a worktree session passes by
  // mistake, and the branch there is another session's.
  if (parse(found.text)?.session !== (await $.session.id())) {
    throw new Error(`${name} is not this session's claim, so it was not released: pass the checkout this session's work is in, or call write_claim first where this session resumed that work\n${render(main, all)}`)
  }
  await remove($, main, name)
  return `released: ${name}\n${render(main, await entries($, main))}`
}

// A tool's answer, or its error as the result: nothing is thrown at the model.
async function answer($: any, name: string, run: (main: string) => Promise<string>) {
  try {
    return { result: await run(await primary($)) }
  } catch (err) {
    const text = `${name}: ${(err as Error).message}`
    return { result: text, text, isError: true }
  }
}

export const register: Register = on => {
  worktreeTools(on)
  on('session.start', async ($, e, next) => {
    for (const [name, tool] of Object.entries({ ...TOOLS, ...WORKTREE_TOOLS })) await $.tool.register({ name, ...tool, isDeferred: false })
    return next(e)
  })

  on('tool.call', { tool: 'mcp__parallel-session-skills__read_ledger' }, async $ => answer($, 'read_ledger', main => readLedger($, main)))
  on('tool.call', { tool: 'mcp__parallel-session-skills__write_claim' }, async ($, e: any) => answer($, 'write_claim', main => writeClaim($, main, e)))
  on('tool.call', { tool: 'mcp__parallel-session-skills__release_claim' }, async ($, e: any) => answer($, 'release_claim', main => releaseClaim($, main, e)))

  // A session that ends without wrapping still hands its lane back. Every
  // failure is silent: an error at session end is noise, and a claim left
  // behind is reaped once its worktree is gone.
  on('session.end', async ($, e: any, next: any) => {
    try {
      const main = await primary($)
      const id = String((await $.session.id().catch(() => '')) ?? '')
      for (const mine of ownedBy(await entries($, main), id)) await remove($, main, mine.name)
    } catch {}
    return next(e)
  })
}
