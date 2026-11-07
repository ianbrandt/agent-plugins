// The rules behind the worktree and landing tools, apart from git: where a new
// branch starts, what a visibility lookup may return, a worktree's name, where
// a shell command pushes, and what it writes to the remote host with gh or glab.

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
const CD = /(?:^|[;&|({\n])\s*(?:cd|pushd|Set-Location|Push-Location)\s+([^\s;&|)}]+)/g
// Each quoted argument is masked with X so the regex matches only text the
// shell executes: a mention of git push inside a quoted argument, such as
// `claude -p "...git push..."`, no longer counts. The body of a heredoc whose
// delimiter is quoted goes first, since a quote in it closes nothing. The
// length is kept, so a match is read back from the command at its position.
// shortcut: a push run as `bash -c 'git push'` is no longer detected, and an unquoted heredoc delimiter is not parsed.
// A quote left open masks the rest of the command, and is reported to `unclosed`.
const mask = (cmd: string, unclosed = () => {}) =>
  cmd.replace(/(<<-?[ \t]*(["'])([^"'\s]+)\2[^\n]*\n)([\s\S]*?)^([ \t]*\3)$/gm, (_m, open, _q, _d, body, close) => open + body.replace(/[^\n]/g, ' ') + close)
    .replace(/"(?:[^"\\]|\\.)*"?/g, m => {
      if (!/^"(?:[^"\\]|\\.)*"$/.test(m)) unclosed()
      return 'X'.repeat(m.length)
    })
    .replace(/'[^']*'?/g, m => {
      if (!/^'[^']*'$/.test(m)) unclosed()
      return 'X'.repeat(m.length)
    })

// Line continuations are joined and comment lines blanked, keeping the length,
// so an argument on the next line is read and a quote in a comment opens nothing.
const unfold = (cmd: string) => cmd.replace(/[\\`]\r?\n/g, m => ' '.repeat(m.length)).replace(/^[ \t]*#.*$/gm, m => ' '.repeat(m.length))
// Each `$(...)` or backtick substitution, which the shell runs even inside double quotes.
const substitutions = (src: string) => [...src.matchAll(/\$\(([^()]*)\)|`([^`]*)`/g)].map(m => m[1] ?? m[2])

const unquote = (word: string) => word.replace(/^(["'])(.*)\1$/, '$2')
const readPath = (word: string) => (/[$`~]/.test(unquote(word)) ? undefined : unquote(word))
// The directory of the last cd before `index`, or nothing where there is none.
function cdBefore(cmd: string, masked: string, index: number): string | undefined {
  const cd = [...masked.slice(0, index).matchAll(CD)].pop()
  return cd ? readPath(cmd.slice(cd.index! + cd[0].length - cd[1].length, cd.index! + cd[0].length)) : undefined
}

// The first push in a shell command: the directory it runs in, from its -C or
// the last cd before it, whether it is a dry run, and whether it forces: a
// --force option, -f in a short-flag group, or a + refspec. Null for no push.
// The command is read as hostWrites reads it: unfolded, again unmasked where a
// quote is left open, and then each substitution on its own.
// shortcut: a path with a shell variable or ~ in it is not read, and the push is checked in the session's repo.
export function pushTarget(cmd: string): { dir: string | undefined; dryRun: boolean; force: boolean } | null {
  const src = unfold(cmd)
  let open = false
  let masked = mask(src, () => { open = true })
  let push = PUSH.exec(masked)
  if (!push && open) push = PUSH.exec((masked = src))
  if (!push) {
    for (const sub of substitutions(src)) {
      const found = pushTarget(sub)
      if (found) return found
    }
    return null
  }
  const read = ([start, end]: [number, number]) => readPath(src.slice(start, end))
  const at = push.indices!
  const dir = at[1] ? read(at[1]) : cdBefore(src, masked, push.index)
  const args = push[2]
  return { dir, dryRun: /(^|\s)(--dry-run|-n)(?=\s|$)/.test(args), force: /(^|\s)(--force|-[a-zA-Z]*f[a-zA-Z]*(?=\s|$)|\+\S)/.test(args) }
}

// The gh and glab subcommands that only read from the host or act on this
// machine. Every other subcommand is taken as a write, so a verb added in a
// later release, or an alias such as `gh pr new`, is put to the user.
const LOCAL_NOUNS = new Set(['auth', 'config', 'extension', 'ext', 'alias', 'completion', 'help', 'version', 'browse', 'search', 'status', 'check-update', 'changelog'])
const READ_VERBS = new Set(['view', 'list', 'ls', 'status', 'diff', 'checks', 'checkout', 'co', 'download', 'watch', 'clone', 'browse', 'get', 'search', 'verify', 'trace', 'lint', 'contributors', 'issues', 'field-list', 'item-list'])
const PR_CREATE: Record<string, string> = { gh: 'pr', glab: 'mr' }
const CLI = /^(?:.*[\/\\])?(gh|glab)(?:\.exe)?$/i

export type HostWrite = { what: string; dir: string | undefined; prCreate: boolean; otherRepo: boolean }

// Every host write in a shell command: what it is, the directory of the last cd
// before it, whether it opens a PR or MR, and whether -R, GH_REPO, or
// GITLAB_REPO sends it to another repo. An api call with a field and no method
// is a POST, as both CLIs send it, and a GraphQL call is a write unless its
// query is inline and reads as a query. Line continuations are joined and
// comment lines dropped first. Where a quote is left open, the command is read
// again unmasked, and a `$(...)` or backtick substitution is read on its own,
// quoted or not, since the shell runs both inside double quotes.
// shortcut: a write run as `bash -c '...'` or `eval "..."`, or through a user's own gh alias, is not detected.
export function hostWrites(cmd: string): HostWrite[] {
  const src = unfold(cmd)
  let open = false
  const masked = mask(src, () => { open = true })
  const found = [...scan(src, masked), ...(open ? scan(src, src) : [])]
  for (const sub of substitutions(src)) found.push(...hostWrites(sub))
  const seen = new Set<string>()
  return found.filter(w => !seen.has(JSON.stringify(w)) && !!seen.add(JSON.stringify(w)))
}

function scan(src: string, masked: string): HostWrite[] {
  const found: HostWrite[] = []
  const envRepo = /\b(GH_REPO|GITLAB_REPO)\b/.test(src)
  // A parenthesis splits nothing, so an argument such as `repos/$(...)/issues`
  // or PowerShell's `(Get-Content b.md)` keeps the flags after it. A subshell's
  // parentheses are stripped from the words at its ends.
  for (const seg of masked.matchAll(/[^;&|\n`]+/g)) {
    const words = [...seg[0].matchAll(/\S+/g)].map(w => unquote(src.slice(seg.index! + w.index!, seg.index! + w.index! + w[0].length).replace(/^\$?[({]+|[)}]+$/g, '')))
    const at = words.findIndex(w => CLI.test(w))
    if (at < 0) continue
    const cli = CLI.exec(words[at])![1].toLowerCase()
    const args = words.slice(at + 1)
    if (args.includes('-h') || args.includes('--help')) continue
    const pos: string[] = []
    let method = ''
    let fields = false
    let otherRepo = envRepo
    for (let i = 0; i < args.length; i++) {
      const a = args[i]
      const api = pos[0] === 'api'
      const m = api && /^(?:-X|--method)(?:=?(.+))?$/.exec(a)
      if (m) method = (m[1] ?? args[++i] ?? '').toUpperCase()
      else if (/^(-R|--repo)$/.test(a)) {
        otherRepo = true
        i++
      } else if (/^(-R.|--repo=)/.test(a)) otherRepo = true
      else if (api && /^(-f|-F|--field|--raw-field|--input|--form)$/.test(a)) {
        fields = true
        i++
      } else if (api && /^(--field|--raw-field|--input|--form)=|^-[fF]./.test(a)) fields = true
      else if (api && /^(-H|--header|-q|--jq|-t|--template|--hostname|-p|--preview|--cache)$/.test(a)) i++
      else if (!a.startsWith('-')) pos.push(a)
    }
    const [noun, verb] = pos
    let what = ''
    if (noun === 'api' && verb === 'graphql') {
      const text = src.slice(seg.index!, seg.index! + seg[0].length)
      if (/\bmutation\b/.test(text) || !/\bquery=(["']?)\s*(query\b|\{)/.test(text)) what = `${cli} api graphql`
    } else if (noun === 'api') {
      const m = method || (fields ? 'POST' : 'GET')
      if (m !== 'GET' && m !== 'HEAD') what = `${cli} api ${m}`
    } else if (noun && verb && !LOCAL_NOUNS.has(noun) && !READ_VERBS.has(verb)) what = `${cli} ${noun} ${verb}`
    if (what) found.push({ what, dir: cdBefore(src, masked, seg.index!), prCreate: noun === PR_CREATE[cli] && (verb === 'create' || verb === 'new'), otherRepo })
  }
  return found
}
