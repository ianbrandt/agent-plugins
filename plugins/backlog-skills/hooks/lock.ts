// The lock every write tool holds for its read, change, and write (design D5):
// the ref refs/backlog/lock, pointing at a blob with the session and the time.
// A ref is shared by every worktree, and git refuses to create one that exists.
import { type Repo, run, why } from './repo'

export const LOCK = 'refs/backlog/lock'
export const STALE_MS = 60_000
const WAIT_MS = 10_000
// A hook's budget is 10 s, and a clock wait counts against it where a git call does not.
const SLEEP_MS = 8_000

export type Lock = { main: string; blob: string }

// A blob unique to this caller: two calls in one session in the same
// millisecond still get two blobs.
export async function blob($: any, main: string, lines: string[]): Promise<string> {
  const text = [...lines, `nonce ${Math.random().toString(36).slice(2)}`].join('\n') + '\n'
  const r = await run($, main, ['hash-object', '-w', '--stdin'], text)
  if (r.exitCode !== 0) throw new Error(`git hash-object -w --stdin in ${main}: ${why(r)}`)
  return String(r.stdout).trim()
}

// Creates `ref` at `oid` only where it does not exist. False when git refused
// because the ref is there; any other failure throws.
export async function create($: any, repo: Repo, ref: string, oid: string): Promise<boolean> {
  const r = await run($, repo.main, ['update-ref', ref, oid, repo.zero])
  if (r.exitCode === 0) return true
  if ((await current($, repo.main, ref)) === undefined) throw new Error(`git update-ref ${ref} in ${repo.main}: ${why(r)}`)
  return false
}

async function current($: any, main: string, ref: string): Promise<string | undefined> {
  const r = await run($, main, ['rev-parse', '-q', '--verify', ref])
  if (r.exitCode === 1) return undefined
  if (r.exitCode !== 0) throw new Error(`git rev-parse ${ref} in ${main}: ${why(r)}`)
  return String(r.stdout).trim()
}

// The time in a lock's blob. A blob with no time is not known to be stale.
async function age($: any, main: string, oid: string, now: number): Promise<number | undefined> {
  const r = await run($, main, ['cat-file', '-p', oid])
  const t = r.exitCode === 0 ? /^time (\d+)$/m.exec(String(r.stdout))?.[1] : undefined
  return t === undefined ? undefined : now - Number(t)
}

export async function acquire($: any, repo: Repo): Promise<Lock> {
  const start = await $.clock.now()
  const own = await blob($, repo.main, [`session ${await $.session.id().catch(() => '')}`, `time ${start}`])
  let slept = 0
  for (let delay = 50; ; delay = Math.min(delay * 2, 1000)) {
    if (await create($, repo, LOCK, own)) return { main: repo.main, blob: own }
    const now = await $.clock.now()
    const held = await current($, repo.main, LOCK)
    // Released since the refusal: try again at once.
    if (held === undefined) continue
    const old = await age($, repo.main, held, now)
    if (old !== undefined && old > STALE_MS) {
      // A compare-and-swap: of two callers breaking the same stale lock, one wins.
      const r = await run($, repo.main, ['update-ref', LOCK, own, held])
      if (r.exitCode === 0) return { main: repo.main, blob: own }
      continue
    }
    if (now - start >= WAIT_MS || slept + delay > SLEEP_MS) {
      throw new Error(`another session holds ${LOCK} (blob ${held}). Try again; a lock older than a minute is broken, and \`git update-ref -d ${LOCK}\` removes one by hand.`)
    }
    await $.clock.sleep(delay)
    slept += delay
  }
}

// Whether the ref still points at the caller's blob.
export async function held($: any, lock: Lock): Promise<boolean> {
  return (await current($, lock.main, LOCK)) === lock.blob
}

// Deletes only the caller's lock. A lock broken as stale is another session's
// now, so a failed release is left alone.
export async function release($: any, lock: Lock): Promise<void> {
  await run($, lock.main, ['update-ref', '-d', LOCK, lock.blob]).catch(() => undefined)
}

export async function withLock<T>($: any, repo: Repo, fn: (lock: Lock) => Promise<T>): Promise<T> {
  const lock = await acquire($, repo)
  try {
    return await fn(lock)
  } finally {
    await release($, lock)
  }
}

// Refuses to go on once the lock is lost.
export async function mustHold($: any, lock: Lock, what: string): Promise<void> {
  if (!(await held($, lock))) throw new Error(`the lock ${LOCK} was lost ${what}`)
}
