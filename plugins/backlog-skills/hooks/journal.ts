// The write journal (design D5): each file a tool rewrites is copied to
// <git common dir>/backlog/journal/ first, so an interrupted or torn write
// loses nothing. $.fs has no delete or rename, so a settled entry is
// overwritten with a tombstone, and saved files are numbered.
import { type Files, type Problem, type FileName, validateFiles } from './format'
import { type Lock, held, mustHold, withLock } from './lock'
import { type Repo, NAMES, filesOf, noLink, readTexts } from './repo'

const DONE = '{"state":"done"}'
type Entry = { state: 'preparing' | 'ready'; path: string; existed: boolean; new: string }

const dirOf = (repo: Repo) => `${repo.common}/backlog/journal`
// The full path, encoded, so two worktrees' BACKLOG.md get two entries.
const entryOf = (repo: Repo, path: string) => `${dirOf(repo)}/${encodeURIComponent(path)}`
function read($: any, path: string): Promise<string | undefined> {
  return $.fs.read(path).catch(() => undefined)
}
const parent = (path: string) => path.replace(/[\\/][^\\/]*$/, '')
const name = (path: string) => path.replace(/^.*[\\/]/, '')

// Saves `text` as <name>.<kind>, or <name>.<kind>.2 and up when that is taken.
async function save($: any, repo: Repo, path: string, kind: 'found' | 'prev', text: string): Promise<string> {
  const stem = `${dirOf(repo)}/${name(path)}.${kind}`
  let to = stem
  for (let n = 2; await $.fs.exists(to); n++) to = `${stem}.${n}`
  await noLink($, repo.common, to)
  await $.fs.write(to, text)
  return to
}

// One entry left by an interrupted call, settled by D5's rules. Returns the
// step taken, for the tool's result.
async function settleOne($: any, repo: Repo, file: string): Promise<string | undefined> {
  const at = `${dirOf(repo)}/${file}`
  const raw = await read($, at)
  if (raw === DONE) return undefined
  let e: Entry
  try {
    e = JSON.parse(raw ?? '')
    if (typeof e.path !== 'string' || typeof e.new !== 'string') throw new Error()
  } catch {
    // Only the first entry write and the tombstone are not read back, and the
    // file is untouched after the one and written in full before the other.
    await $.fs.write(at, DONE)
    return `journal: ${at} did not parse, so it was discarded`
  }
  const done = async (step: string) => (await $.fs.write(at, DONE), `journal: ${e.path}: ${step}`)
  if (e.state !== 'ready') return done('the write never started, so the entry was discarded')
  if (!(await $.fs.exists(parent(e.path)))) return done('its directory is gone, so the entry was discarded')
  const copy = await read($, `${entryOf(repo, e.path)}.copy`)
  const now = await read($, e.path)
  if (now === undefined && !e.existed) return done('the file was never written, so it was left as it was')
  if (now === e.new) return done('the file has the new content, so it was kept')
  if (now !== undefined && now === copy) return done('the file has the content from before the write, so it was kept')
  if (now !== undefined && e.new.startsWith(now)) {
    await noLink($, parent(e.path), e.path)
    const found = await save($, repo, e.path, 'found', now)
    await $.fs.write(e.path, e.new)
    if ((await read($, e.path)) !== e.new) throw new Error(`journal: ${e.path} was cut short and saved as ${found}, and writing the new content again did not read back`)
    // A torn write and a hand edit that deleted the end of the file look the same here.
    return done(`the file is the start of the new content: the write was cut short, or a person deleted the end of the file after an interrupted write. The new content was written again, and the file as it was, the person's version if they edited it, was saved as ${found}. Tell the user, so they can compare the two.`)
  }
  const prev = copy === undefined ? 'the copy from before the write is missing' : `the content from before the write was saved as ${await save($, repo, e.path, 'prev', copy)}`
  return done(`the file ${now === undefined ? 'is missing' : 'has neither the old nor the new content'} after an interrupted write, most likely from a hand edit. It was kept, ${prev}. Tell the user, so they can compare the two.`)
}

// Runs `fn` after a settle, with the settle's steps added to any error it
// throws, so a step is reported even when the call then fails.
export async function reporting<T>(steps: string[], fn: () => Promise<T>): Promise<T> {
  // A copy, since `fn` may push lines of its own to the same list.
  const settled = [...steps]
  try {
    return await fn()
  } catch (err) {
    if (settled.length) (err as Error).message += `\n${settled.join('\n')}`
    throw err
  }
}

// Settles every entry. The caller holds the lock.
export async function settleLocked($: any, repo: Repo, lock: Lock): Promise<string[]> {
  await mustHold($, lock, 'before the journal was settled')
  const listed: any[] = await $.fs.list(dirOf(repo)).catch(() => [])
  const steps: string[] = []
  for (const f of listed.filter(f => f.kind === 'file' && f.name.endsWith('.json'))) {
    const step = await settleOne($, repo, f.name)
    if (step) steps.push(step)
  }
  return steps
}

// For a tool that takes no lock of its own: the lock is taken only when an
// entry is waiting, since a call writing now holds it and settles its own.
export async function settle($: any, repo: Repo): Promise<string[]> {
  const listed: any[] = await $.fs.list(dirOf(repo)).catch(() => [])
  for (const f of listed.filter(f => f.kind === 'file' && f.name.endsWith('.json'))) {
    if ((await read($, `${dirOf(repo)}/${f.name}`)) !== DONE) return withLock($, repo, lock => settleLocked($, repo, lock))
  }
  return []
}

// D5's four steps for one file.
async function writeOne($: any, repo: Repo, lock: Lock, path: string, text: string): Promise<void> {
  const existed = await $.fs.exists(path)
  const old: string = existed ? await $.fs.read(path) : ''
  if (old === text && existed) return
  const at = `${entryOf(repo, path)}.json`
  const copy = `${entryOf(repo, path)}.copy`
  const entry = { path, existed, new: text }
  await mustHold($, lock, `before ${path} was written, so nothing was written`)
  await $.fs.write(at, JSON.stringify({ state: 'preparing', ...entry }))
  await $.fs.write(copy, old)
  if ((await read($, copy)) !== old) throw new Error(`the journal copy of ${path} did not read back, so nothing was written`)
  const ready = JSON.stringify({ state: 'ready', ...entry })
  await $.fs.write(at, ready)
  if ((await read($, at)) !== ready) throw new Error(`the journal entry for ${path} did not read back, so nothing was written`)
  await mustHold($, lock, `before ${path} was written, so nothing was written`)
  await $.fs.write(path, text)
  if ((await read($, path)) !== text) {
    await $.fs.write(path, old)
    const restored = (await read($, path)) === old
    if (restored) await $.fs.write(at, DONE)
    throw new Error(`${path} did not read back as written. ${restored ? 'Its content from before the call was restored.' : 'Restoring it did not read back either, and the next tool call settles it from the journal.'}`)
  }
  // Another session may hold the lock now and have an entry of its own here.
  if (!(await held($, lock))) throw new Error(`the lock was lost while ${path} was written, so another session may have written it too: read it before going on`)
  await $.fs.write(at, DONE)
}

export const problemsOf = (f: Files): Problem[] => [...f.backlog.problems, ...validateFiles(f)]

// The file-level problems in `after` that `before` did not have. Lines move in
// an edit and messages carry numbers, so problems are compared by file, ID,
// and message with the numbers taken out, counted.
export function addedFileProblems(before: Problem[], after: Problem[]): Problem[] {
  const key = (p: Problem) => `${p.file ?? ''}|${p.id ?? ''}|${p.message.replace(/\d+/g, '#')}`
  const had = new Map<string, number>()
  for (const p of before.filter(p => p.level === 'file')) had.set(key(p), (had.get(key(p)) ?? 0) + 1)
  return after.filter(p => {
    if (p.level !== 'file') return false
    const n = had.get(key(p)) ?? 0
    had.set(key(p), n - 1)
    return n <= 0
  })
}

// The checkout a path is in, the primary checkout or one of its worktrees, and
// the backlog file it is there. Worktrees nest under the primary checkout, so
// the longest root wins.
export function placeOf(repo: Repo, path: string): { root: string; file: FileName } {
  const p = path.replace(/\\/g, '/')
  const roots = [repo.main, ...repo.worktrees.map(w => w.path)].sort((a, b) => b.length - a.length)
  const root = p.split('/').includes('..') ? undefined : roots.find(r => p.startsWith(`${r}/`))
  if (!root) throw new Error(`${path} is not inside the primary checkout ${repo.main} or one of its worktrees`)
  const file = NAMES.find(n => repo.paths?.[n] === p.slice(root.length + 1))
  if (!file) throw new Error(`${path} is not one of this repo's backlog files`)
  return { root, file }
}

export type Write = { path: string; text: string }

// Writes each file through the journal, in the order given: the target of a
// move first, then its source, so the source is never changed before the
// target reads back. Nothing is written when the new text adds a file-level
// problem. The caller holds the lock and has settled the journal.
export async function writeFiles($: any, repo: Repo, lock: Lock, writes: Write[]): Promise<string[]> {
  if (repo.kind !== 'local-only' && repo.kind !== 'tracked') throw new Error(`the write tools refuse while the kind is ${repo.kind}`)
  const placed = writes.map(w => ({ ...w, ...placeOf(repo, w.path) }))
  if (new Set(placed.map(w => `${w.root}/${w.file}`)).size !== placed.length) throw new Error('one file is written twice in one call')
  for (const root of new Set(placed.map(w => w.root))) {
    const before = await readTexts($, repo.paths!, root)
    const after = { ...before }
    for (const w of placed.filter(w => w.root === root)) after[w.file] = w.text
    const added = addedFileProblems(problemsOf(filesOf(before)), problemsOf(filesOf(after)))
    if (added.length) throw new Error(`nothing was written, since the new text has file-level problems the files did not have:\n${added.map(p => `  ${p.file} line ${p.line}: ${p.message}`).join('\n')}`)
  }
  for (const w of placed) for (const [base, path] of [[w.root, w.path], [repo.common, `${entryOf(repo, w.path)}.json`], [repo.common, `${entryOf(repo, w.path)}.copy`]]) await noLink($, base, path)
  const done: string[] = []
  for (const w of placed) {
    await writeOne($, repo, lock, w.path, w.text)
    done.push(`wrote ${w.path}`)
  }
  return done
}
