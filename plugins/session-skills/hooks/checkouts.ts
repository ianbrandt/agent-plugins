// The rules behind the worktree and landing tools, apart from git: where a new
// branch starts, what a visibility lookup may return, a worktree's name, and
// where a shell command pushes.

// Where a new branch starts. `origin/<default>` after a fetch, except that a
// local default branch with nothing missing is the base: while a push is held
// for review it is ahead, and a branch opened from `origin/<default>` would lack
// the held commits and could not fast-forward back.
export function pickBase(def: string, hasOrigin: boolean, hasLocal: boolean, originInLocal: boolean, localInOrigin: boolean): { base: string; warning?: string } {
  const origin = `origin/${def}`
  if (!hasOrigin && !hasLocal) return { base: def, warning: `neither ${origin} nor ${def} is a branch here, so the default branch was not found` }
  if (!hasOrigin) return { base: def }
  if (!hasLocal) return { base: origin }
  if (originInLocal) return { base: def }
  if (localInOrigin) return { base: origin }
  return { base: origin, warning: `local ${def} has diverged from ${origin}: a new branch starts from ${origin}, without the local commits` }
}

// One ref, from what `git for-each-ref --format='%(refname) %(symref)' <ref>`
// printed: its target where it is a symbolic ref, or nothing where it is
// absent. The argument is a pattern, and `refs/heads/main` also matches
// `refs/heads/main/topic`, so only the line with the ref's own name is read. A
// symbolic ref that points at nothing is not printed, and reads as absent.
export function refLine(stdout: string, ref: string): { symref: string } | null {
  const line = stdout.split(/\r?\n/).find(l => l.split(' ')[0] === ref)
  return line === undefined ? null : { symref: line.slice(ref.length + 1) }
}

// The one word a visibility lookup may return. A CLI's error text is dropped.
export function visibility(text: string): string {
  const v = text.trim().toLowerCase()
  return ['public', 'private', 'internal'].includes(v) ? v : ''
}

export const worktreeName = (name: string, id = '') => (id ? `${id.toLowerCase()}-${name}` : name)

// A push is read from the call as it reached this plugin, so a command a
// settings hook rewrote into a push is not seen.
const PUSH = /\bgit(?:\s+-C\s+(\S+))?\s+push\b([^;&|\n]*)/d
const CD = /(?:^|[;&|(\n])\s*cd\s+(\S+)/g
// Each quoted argument is masked with X so the regex matches only text the
// shell executes: a mention of git push inside a quoted argument, such as
// `claude -p "...git push..."`, no longer counts. The body of a heredoc whose
// delimiter is quoted goes first, since a quote in it closes nothing. The
// length is kept, so a match is read back from the command at its position.
// shortcut: a push run as `bash -c 'git push'` is no longer detected, and an unquoted heredoc delimiter is not parsed.
const mask = (cmd: string) =>
  cmd.replace(/(<<-?[ \t]*(["'])([^"'\s]+)\2[^\n]*\n)([\s\S]*?)^([ \t]*\3)$/gm, (_m, open, _q, _d, body, close) => open + body.replace(/[^\n]/g, ' ') + close)
    .replace(/"(?:[^"\\]|\\.)*"?/g, m => 'X'.repeat(m.length)).replace(/'[^']*'?/g, m => 'X'.repeat(m.length))

// The first push in a shell command: the directory it runs in, from its -C or
// the last cd before it, whether it is a dry run, and whether it forces: a
// --force option, -f in a short-flag group, or a + refspec. Null for no push.
// shortcut: a path with a shell variable or ~ in it is not read, and the push is checked in the session's repo.
export function pushTarget(cmd: string): { dir: string | undefined; dryRun: boolean; force: boolean } | null {
  const masked = mask(cmd)
  const push = PUSH.exec(masked)
  if (!push) return null
  const read = ([start, end]: [number, number]) => {
    const word = cmd.slice(start, end).replace(/^(["'])(.*)\1$/, '$2')
    return /[$`~]/.test(word) ? undefined : word
  }
  const cd = [...masked.slice(0, push.index).matchAll(CD)].pop()
  const at = push.indices!
  const dir = at[1] ? read(at[1]) : cd ? read([cd.index! + cd[0].length - cd[1].length, cd.index! + cd[0].length]) : undefined
  const args = push[2]
  return { dir, dryRun: /(^|\s)(--dry-run|-n)(?=\s|$)/.test(args), force: /(^|\s)(--force|-[a-zA-Z]*f[a-zA-Z]*(?=\s|$)|\+\S)/.test(args) }
}
