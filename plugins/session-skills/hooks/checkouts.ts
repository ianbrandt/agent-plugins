// The rules behind the worktree and landing tools, apart from git: where a new
// branch starts, what a visibility lookup may return, a worktree's name, and
// the pushes and host writes a shell command makes.


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

// Whether a URL is a path on this machine or points to a loopback host. Without
// `://`, a colon before any slash makes it scp-style, except a drive letter on Windows: elsewhere git
// reads `C:/x` as host C.
export function localUrl(url: string, windows: boolean): boolean {
  if (url.startsWith('file://')) return true
  const at = url.indexOf('://')
  let host: string
  if (at >= 0) host = url.slice(at + 3).split(/[/?#]/)[0]
  else {
    const colon = url.indexOf(':')
    if (colon < 0) return true
    host = url.slice(0, colon)
    if (host.includes('/') || (windows && /^[A-Za-z]$/.test(host))) return true
  }
  host = host.slice(host.lastIndexOf('@') + 1)
  host = host.startsWith('[') ? host.slice(1).split(']')[0] : host.split(':')[0]
  return /^(?:localhost|127\.0\.0\.1|::1)$/i.test(host)
}

// The directory a command runs in: a path, undefined for the tool's own, or
// null where it cannot be read from the command, and the push then waits.
export type Dir = string | null | undefined
export type Push = { dir: Dir; remote?: string | null; force: boolean; dryRun: boolean }
export type HostWrite = { what: string; dir: Dir; prCreate: boolean; otherRepo: boolean }

// A shell command is read loosely, as the retired outward-write guard read it:
// split into simple commands on separators outside quotes, with quotes and
// escapes resolved. git, gh, and glab are found in any word of a simple
// command, so `sudo git push` is read and `echo git push` is asked about too.
// shortcut: a push inside a quoted substitution, a git or gh alias, `eval`, or a script is not read, and a cd inside a subshell moves later commands too; read those if an agent is seen pushing that way.

// Heredoc bodies are data to their command, unless a shell reads them.
const HEREDOC = /(?<!<)<<(?!<)-?\s*(['"]?)([A-Za-z_]\w*)\1/g
const SHELL_READER = /(?:^|[\s;&|(])(?:bash|sh|zsh|dash|eval|source)\b/
function stripHeredocs(cmd: string): string {
  const kept: string[] = []
  const pending: { tag: string; strip: boolean; keep: boolean }[] = []
  for (const line of cmd.split('\n')) {
    const p = pending[0]
    if (p) {
      if ((p.strip ? line.replace(/^\t+/, '') : line) === p.tag) pending.shift()
      else if (p.keep) kept.push(line)
      continue
    }
    kept.push(line)
    for (const m of line.matchAll(HEREDOC)) pending.push({ tag: m[2]!, strip: m[0].includes('<<-'), keep: SHELL_READER.test(line.slice(0, m.index)) })
  }
  return kept.join('\n')
}

// PowerShell here-string bodies are data too. The opener is kept as an empty string.
function stripHereStrings(cmd: string): string {
  const kept: string[] = []
  let close = ''
  for (const line of cmd.split('\n')) {
    if (close) {
      if (line.startsWith(close)) {
        kept.push(line.slice(2))
        close = ''
      }
      continue
    }
    const m = /@(['"])\s*$/.exec(line)
    kept.push(m ? `${line.slice(0, m.index)}''` : line)
    if (m) close = `${m[1]}@`
  }
  return kept.join('\n')
}

// Where the `$(`, `${`, or backtick span at `i` ends, counting nested
// brackets, or the end of the command where it is not closed.
function spanEnd(cmd: string, i: number): number {
  if (cmd[i] === '`') {
    const e = cmd.indexOf('`', i + 1)
    return e < 0 ? cmd.length - 1 : e
  }
  const [o, c] = cmd[i + 1] === '(' ? ['(', ')'] : ['{', '}']
  let depth = 0
  for (let j = i + 1; j < cmd.length; j++) {
    if (cmd[j] === o) depth++
    else if (cmd[j] === c && --depth === 0) return j
  }
  return cmd.length - 1
}

// The words of each simple command. PowerShell escapes with a backtick, and
// Bash with a backslash, which inside double quotes escapes only a few
// characters. A redirection and its target are dropped. A `$(...)`,
// `${...}`, or Bash backtick span stays in its word, which then cannot be
// read, and the commands of a substitution are read too.
function commands(cmd: string, ps: boolean): string[][] {
  const found: string[][] = []
  let words: string[] = []
  let word = ''
  let open = false
  let quote = ''
  let drop = false
  const esc = ps ? '`' : '\\'
  const end = () => {
    if (open && !drop) words.push(word)
    if (open) drop = false
    word = ''
    open = false
  }
  const cut = () => {
    end()
    drop = false
    if (words.length) found.push(words)
    words = []
  }
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]!
    if (quote) {
      if (c === quote) quote = ''
      else if (c === esc && quote === '"' && i + 1 < cmd.length && (ps || /["\\$`\n]/.test(cmd[i + 1]!))) word += cmd[++i] === '\n' ? '' : cmd[i]
      else word += c
    } else if (c === "'" || c === '"') {
      quote = c
      open = true
    } else if (c === esc && i + 1 < cmd.length) {
      if (cmd[++i] !== '\n') {
        word += cmd[i]
        open = true
      }
    } else if ((c === '$' && /[({]/.test(cmd[i + 1] ?? '')) || (!ps && c === '`')) {
      const e = spanEnd(cmd, i)
      const span = cmd.slice(i, e + 1)
      if (span.startsWith('$(') || span.startsWith('`')) found.push(...commands(span.replace(/^\$?[(`]|[)`]$/g, ''), ps))
      word += span
      open = true
      i = e
    } else if (c === '>' || c === '<' || (c === '&' && cmd[i + 1] === '>')) {
      // A file descriptor written before the operator, as in 2>&1, is part of it.
      if (/^\d+$/.test(word)) word = ''
      else end()
      open = false
      while (/[<>&|-]/.test(cmd[i + 1] ?? '')) i++
      drop = true
    } else if (/[;&|\n(){}]/.test(c)) cut()
    else if (/\s/.test(c)) end()
    else if (c === '#' && !open) while (i + 1 < cmd.length && cmd[i + 1] !== '\n') i++
    else {
      word += c
      open = true
    }
  }
  cut()
  return found
}

const name = (w: string) => w.split(/[\\/]/).pop()!.toLowerCase().replace(/\.exe$/, '')
// A path read against `dir`, or null where either cannot be read.
function join(dir: Dir, path: string | undefined): Dir {
  if (path === undefined || dir === null || /[$`~]/.test(path)) return null
  if (/^(?:[A-Za-z]:)?[\\/]/.test(path) || dir === undefined) return path
  return `${dir.replace(/[\\/]+$/, '')}/${path}`
}

const GIT_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env'])
const PUSH_VALUE = new Set(['--push-option', '--receive-pack', '--exec'])

function push(args: string[], dir: Dir): Push {
  const p: Push = { dir, force: false, dryRun: false }
  const remote = (r: string | undefined) => (p.remote = r === undefined || /[$`]/.test(r) ? null : r)
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a === '--') {
      const rest = args.slice(i + 1)
      if (p.remote === undefined) remote(rest.shift())
      p.force ||= rest.some(r => r.startsWith('+'))
      break
    }
    if (/^--(?:force|mirror)/.test(a)) p.force = true
    else if (a === '--dry-run' || a === '--help') p.dryRun = true
    else if (a === '--repo') remote(args[++i])
    else if (a.startsWith('--repo=')) remote(a.slice(7))
    else if (PUSH_VALUE.has(a)) i++
    else if (/^-[^-]/.test(a)) {
      p.force ||= /^-[a-zA-Z]*f/.test(a)
      p.dryRun ||= /^-[a-zA-Z]*[nh]/.test(a)
      if (a.endsWith('o')) i++
    } else if (!a.startsWith('-')) {
      if (p.remote === undefined) remote(a)
      else p.force ||= a.startsWith('+')
    }
  }
  return p
}

// The gh and glab subcommands that write to the host, by noun.
const WRITES: Record<string, Record<string, string>> = {
  gh: {
    pr: 'create new merge edit close reopen comment review ready lock unlock update-branch revert',
    issue: 'create new edit close reopen comment delete pin unpin transfer lock unlock develop',
    release: 'create edit delete upload delete-asset',
    repo: 'create edit delete archive unarchive rename fork sync',
    label: 'create edit delete clone',
    workflow: 'run enable disable',
    run: 'cancel rerun delete',
    cache: 'delete',
    secret: 'set delete',
    variable: 'set delete',
    gist: 'create edit delete',
  },
  glab: {
    mr: 'create new merge update close reopen note approve revoke delete rebase',
    issue: 'create new update close reopen note delete',
    release: 'create update delete upload',
    repo: 'create delete archive fork transfer update',
    label: 'create delete',
    ci: 'run retry cancel delete trigger',
    schedule: 'create delete run',
    variable: 'set update delete',
  },
}
const API_FIELD = /^(?:-[fF]|--field|--raw-field|--input|--form)(?:=|$)/

function hostWrite(cli: string, args: string[], before: string[], dir: Dir): HostWrite | null {
  const pos: string[] = []
  let otherRepo = before.some(w => /^(?:GH_REPO|GITLAB_REPO)=/.test(w))
  let method = ''
  let field = false
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a === '-R' || a === '--repo') {
      otherRepo = true
      i++
    } else if (a.startsWith('--repo=')) otherRepo = true
    else if (a === '-X' || a === '--method') method = args[++i] ?? ''
    else if (/^(?:-X|--method=)/.test(a)) method = a.replace(/^(?:-X=?|--method=)/, '')
    else if (API_FIELD.test(a)) field = true
    else if (!a.startsWith('-')) pos.push(a)
  }
  const [noun = '', verb = ''] = pos
  if (noun === 'api') {
    const graphql = verb === 'graphql' && args.some(a => /\bmutation\b/.test(a) || /=@/.test(a))
    const writes = method ? /^(?:POST|PUT|PATCH|DELETE)$/i.test(method) : verb === 'graphql' ? graphql : field
    return writes ? { what: `${cli} api ${verb}`, dir, prCreate: false, otherRepo } : null
  }
  if (!WRITES[cli]![noun]?.split(' ').includes(verb)) return null
  const prCreate = (noun === 'pr' || noun === 'mr') && (verb === 'create' || verb === 'new')
  return { what: `${cli} ${noun} ${verb}`, dir, prCreate, otherRepo }
}

const READ_CONFIG = /^(?:--get|--get-all|--get-regexp|--get-urlmatch|-l|--list|get|list)$/
const WRITE_CONFIG = /^(?:--unset|--unset-all|--add|--replace-all|--remove-section|--rename-section|-e|--edit|set|unset|remove-section|rename-section|edit)$/

// Whether a `git config` command writes a session-skills key: one with a value
// after the key, or a write option, and no read option.
function writesOwnKey(args: string[]): boolean {
  const k = args.findIndex(a => /^session-skills\./i.test(a))
  if (k < 0 || args.some(a => READ_CONFIG.test(a))) return false
  return args.some(a => WRITE_CONFIG.test(a)) || args.slice(k + 1).some(a => !a.startsWith('-'))
}

// The pushes, host writes, and writes that can lift a hold (a session-skills
// key, or a remote removed, renamed, or moved) in a command, read in `shell`
// from the directory `outer`.
export function outward(cmd: string, shell = 'Bash', outer?: Dir): { pushes: Push[]; hosts: HostWrite[]; configs: string[] } {
  const ps = shell === 'PowerShell'
  const found = { pushes: [] as Push[], hosts: [] as HostWrite[], configs: [] as string[] }
  let dir = outer
  for (const words of commands(ps ? stripHereStrings(cmd) : stripHeredocs(cmd), ps)) {
    const first = name(words[0]!)
    if (['cd', 'pushd', 'set-location', 'sl', 'chdir', 'push-location'].includes(first)) {
      dir = join(dir, words.slice(1).find(w => !w.startsWith('-')))
      continue
    }
    const g = words.findIndex(w => name(w) === 'git')
    if (g >= 0) {
      let d = dir
      let i = g + 1
      for (; i < words.length && words[i]!.startsWith('-'); i++) {
        if (words[i] === '-C') d = join(d, words[++i])
        else if (GIT_VALUE.has(words[i]!)) i++
      }
      const args = words.slice(i + 1)
      if (words[i] === 'push') found.pushes.push(push(args, d))
      const remoteWrite = words[i] === 'remote' && /^(?:remove|rm|rename|set-url)$/.test(args[0] ?? '')
      if ((words[i] === 'config' && writesOwnKey(args)) || remoteWrite) found.configs.push(words.slice(g).join(' '))
    }
    const h = words.findIndex(w => name(w) === 'gh' || name(w) === 'glab')
    const w = h >= 0 && hostWrite(name(words[h]!), words.slice(h + 1), words.slice(0, h), dir)
    if (w) found.hosts.push(w)
  }
  return found
}
