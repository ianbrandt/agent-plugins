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


// A shell command is read by one left-to-right lexer, for Bash or for
// PowerShell, into simple commands: the words of each, with quotes, escapes,
// and comments resolved, and every directory it may run in. Substitutions,
// subshells, script blocks, and unquoted heredoc bodies are read as commands of
// their own. The push and host-write gates read those words. A command that a
// settings hook rewrote is not seen.
// shortcut: a command run as `bash -c '...'`, `eval "..."`, `env -S '...'`, `Start-Process`, or a `git-<name>` program on the PATH that is not git's own is not read.

// The directory a command runs in: a path, undefined for the session's repo,
// or null where it cannot be read, and the hold then asks.
export type Dir = string | null | undefined
type Loc = { dir: Dir; stack: Dir[]; gitDir: Dir }
export type Word = { text: string; literal: boolean; quoted: boolean }
// `pipe` is shared by every command in one pipeline, which may run in any order.
type Command = { words: Word[]; at: Loc[]; pipe?: object }

// Bash's compound commands. A cd inside one may not have run after it ends.
const OPEN = new Set(['if', 'while', 'until', 'for', 'case', 'select'])
const SKIP = new Set(['then', 'do', '!', 'time'])
const ELSE = new Set(['else', 'elif'])
const CLOSE = new Set(['fi', 'done', 'esac'])

// Every place a command may be, from the branches that lead to it.
function union(...lists: Loc[][]): Loc[] {
  const seen = new Map<string, Loc>()
  for (const l of lists.flat()) seen.set(JSON.stringify(l), l)
  // shortcut: past 16 possible directories the directory is unknown, and the hold asks.
  return seen.size > 16 ? [{ dir: null, stack: [], gitDir: null }] : [...seen.values()]
}

// A function body, which runs wherever the function is called.
const NOWHERE: Loc[] = [{ dir: null, stack: [], gitDir: null }]

// A PowerShell function's name, in the letter case it is looked up in, with no scope.
const psName = (text: string) => text.toLowerCase().replace(/^(?:global|script|local|private):/, '')

const one = (dirs: Dir[]): Dir => (dirs.every(d => d === dirs[0]) ? dirs[0] : null)

const ABSOLUTE = /^(?:[A-Za-z]:)?[\\/]/
const UP = /(?:^|[\\/])\.\.(?:[\\/]|$)/

// A path word read against the directory it is given in. A relative path where
// that is the session's repo stays relative, and git reads it there. A path
// with ~ or $HOME in it, or with a variable after a cd, cannot be read. Nor can
// a path with `..` in it: bash folds `..` into the path as written and git into
// the path on disk, and the two differ after a link, as a worktree's notes.local is.
// shortcut: a path with any other shell variable in it, given in the session's repo, is read as that repo.
function resolve(base: Dir, w: Word | undefined): Dir {
  if (!w) return null
  if (!w.literal) return base === undefined && !/^(?:~|\$\{?HOME\b)/.test(w.text) ? undefined : null
  const p = w.text
  if (UP.test(p)) return null
  if (ABSOLUTE.test(p)) return p
  if (base === undefined) return p === '.' ? undefined : p
  if (base === null) return null
  if (p === '.') return base
  const sep = base.includes('\\') && !base.includes('/') ? '\\' : '/'
  return base.replace(/[\\/]+$/, '') + sep + p.replace(/^\.[\\/]/, '')
}

const valueOf = (w: Word): Word => ({ ...w, text: w.text.slice(w.text.indexOf('=') + 1) })
const lastGitDir = (words: Word[]) => words.filter(w => /^GIT_DIR=/.test(w.text)).map(valueOf).pop()

// Where each command leaves the shell: a cd, pushd, or popd, or a GIT_DIR
// that later git commands read. A relative GIT_DIR is read where each git
// command runs, so it is not read here. A call to a function defined in the
// command, or a Bash or zsh body in braces after the first word, such as zsh's
// `() { ... }` or `repeat 1 { ... }`, may run a cd. A function definition runs
// nothing, and its body is read in a directory that cannot be read (see `NOWHERE`). `exit` reaches no later command. A `return` outside a function
// fails in bash, which runs on, so it is read as running on.
function effect(words: Word[], locs: Loc[], ps: boolean, functions: Set<string>): Loc[] {
  const setGitDir = (w: Word | undefined) => locs.map(l => ({ ...l, gitDir: w?.literal && !ABSOLUTE.test(w.text) ? null : resolve(l.dir, w) }))
  let k = 0
  while (!ps && k < words.length && /^[A-Za-z_]\w*=/.test(words[k].text)) k++
  // A GIT_DIR set without export is not read by git, unless it was exported before.
  if (k === words.length) return lastGitDir(words) ? locs.map(l => ({ ...l, gitDir: null })) : locs
  // PowerShell runs the command after `$x =`.
  if (ps && words[1]?.text === '=' && words.length > 2 && /^\$(?!\{?env:)/i.test(words[0].text)) k = 2
  while (!ps && (words[k].text === 'builtin' || words[k].text === 'command') && k + 1 < words.length) k++
  const args = words.slice(k + 1)
  // A PowerShell function may be dot-sourced, as in `. f`.
  const name = ps ? psName((words[k].text === '.' && args[0]?.text) || words[k].text) : words[k].text
  if (!ps && (args[0]?.text === '()' || name === 'function')) return locs
  if (functions.has(name) || (!ps && args.some(w => w.text === '{' && !w.quoted))) return NOWHERE
  if (name === 'exit' || (ps && name === 'throw')) return []
  if (ps) {
    const m = /^\$(?:env:|\{env:)GIT_DIR\}?(?:=(.*))?$/is.exec(words[0].text)
    if (m) return setGitDir(m[1] !== undefined ? { text: m[1], literal: !/[$`]/.test(m[1]), quoted: false } : words[1]?.text === '=' ? words[2] : undefined)
  } else if (['export', 'declare', 'typeset'].includes(name)) {
    const g = lastGitDir(args)
    return g ? setGitDir(g) : locs
  } else if (name === 'unset' && args.some(w => w.text === 'GIT_DIR')) return locs.map(l => ({ ...l, gitDir: undefined }))
  const cd = ps ? /^(?:cd|chdir|sl|set-location)$/.test(name) : name === 'cd'
  const pushd = ps ? /^(?:pushd|push-location)$/.test(name) : name === 'pushd'
  if (ps ? /^(?:popd|pop-location)$/.test(name) : name === 'popd') return locs.map(l => (l.stack.length ? { ...l, dir: l.stack[0], stack: l.stack.slice(1) } : { ...l, dir: null }))
  if (!cd && !pushd) return locs
  // No directory, or `cd -`, leaves it unknown.
  let target: Word | undefined
  for (let j = 0; j < args.length; j++) {
    const t = args[j].text
    if (t === '-') break
    if (t === '--') {
      target = args[j + 1]
      break
    }
    if (t.startsWith('-') && !args[j].quoted) {
      if (ps && /^-(?:path|literalpath|lp|pspath)$/i.test(t)) {
        target = args[j + 1]
        break
      }
      continue
    }
    target = args[j]
    break
  }
  return locs.map(l => {
    const dir = resolve(l.dir, target)
    if (pushd) charge(l.stack.length + 1)
    return pushd ? { ...l, dir, stack: [l.dir, ...l.stack] } : { ...l, dir }
  })
}

// The characters one command may be read through, across every pass, and the
// directories copied onto pushd stacks. Text left open at each level of a nest
// is read again at each, and the work grows with the depth; past this the
// gates throw, and the hook asks.
const budget = { left: 0 }
const charge = (n: number) => {
  budget.left -= n
  if (budget.left < 0) throw new Error('the command is too long or too deeply nested to read')
}

// Whether every command in the line runs in the order it is listed: false after
// an unquoted heredoc body, a function, a loop, a job, a PowerShell script
// block, or a compound command in a pipeline, each of which can run a command
// before one listed before it. The commands of a pipeline share a `pipe`, and
// each shell waits for the whole pipeline before the next command.
const order = { kept: true }
const reorder = () => {
  order.kept = false
}

// bash's escapes in $'...', at the backslash at i: the text and where it ends.
const ESCAPES: Record<string, string> = { a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '\\': '\\', "'": "'", '"': '"', '?': '?' }
function ansiC(s: string, i: number): [string, number] {
  const e = /x([\da-fA-F]{1,2})|u([\da-fA-F]{1,4})|U([\da-fA-F]{1,8})|([0-7]{1,3})|c([\s\S])|([\s\S])/y
  e.lastIndex = i + 1
  const m = e.exec(s)
  if (!m) return ['\\', i + 1]
  const hex = m[1] ?? m[2] ?? m[3]
  if (hex) return [String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff)), e.lastIndex]
  if (m[4]) return [String.fromCharCode(parseInt(m[4], 8) & 0xff), e.lastIndex]
  if (m[5]) return [String.fromCharCode(m[5].charCodeAt(0) & 0x1f), e.lastIndex]
  return [ESCAPES[m[6]] ?? `\\${m[6]}`, e.lastIndex]
}

// Every simple command in `s`, with any text after a quote left open read again
// as commands: the quote is taken as a literal character, which reads more.
function lexAll(s: string, ps: boolean, start: Loc[], quoted = false, functions = new Set<string>()): Command[] {
  const found: Command[] = []
  for (let n = 0; n < 8; n++) {
    charge(s.length + 1)
    const { commands, open } = lex(s, ps, start, quoted, functions)
    for (const c of commands) found.push(c)
    if (open < 0) break
    s = `${s.slice(0, open)} ${s.slice(open + 1)}`
  }
  return found
}

// One pass over `s`. Where `quoted` is set, the text is read as it is inside
// double quotes, as the body of an unquoted heredoc is.
function lex(s: string, ps: boolean, start: Loc[], quoted: boolean, functions: Set<string>): { commands: Command[]; open: number } {
  const commands: Command[] = []
  const add = (found: Command[]) => {
    for (const c of found) commands.push(c)
  }
  // Where a PowerShell subexpression in the word being read leaves the location.
  let side: Loc[] = []
  const heredocs: { delim: string; quoted: boolean; strip: boolean; at: Loc[] }[] = []
  const escape = ps ? '`' : '\\'
  const meta = ps ? /[\s;&|(){}<>]/ : /[\s;&|()<>]/
  // A function's name with no body yet: `f ()`, `function f`, or `function f ()`
  // in bash and zsh, and `function f` or `filter f` with or without a parameter
  // list in PowerShell. `a=()` is an array.
  const name = (w: Word | undefined) => !!w && w.literal && !w.quoted && !w.text.includes('=')
  const named = (ws: Word[]) =>
    ps
      ? /^(?:function|filter)$/i.test(ws[0]?.text ?? '') && name(ws[1]) && (ws.length === 2 || (ws.length === 3 && ws[2].text === '()'))
      : ws.at(-1)?.text === '()' && ws.at(-1)?.literal === false
        ? ws.length === 2 ? name(ws[0]) : ws.length === 3 && ws[0].text === 'function' && name(ws[1])
        : ws.length === 2 && ws[0].text === 'function' && name(ws[1])
  let i = 0
  let open = -1
  const unclosed = (at: number) => {
    if (open < 0) open = at
  }

  // A `$` expansion at i: a substitution, read as commands, or a variable.
  // False where the `$` is a literal character.
  function dollar(at: Loc[]): boolean {
    const n = s[i + 1]
    const st = i
    if (n === '(' && s[i + 2] === '(' && !ps) {
      i += 3
      if (arithmetic(at)) return true
      i = st
    }
    if (n === '(') {
      i += 2
      const inner = list(at, ')')
      if (ps) side = union(side, inner)
    } else if (n === '{' && !ps && /[\s|]/.test(s[i + 2] ?? '')) {
      // bash 5.3's `${ cmd; }` runs its commands in this shell.
      i += 2
      list(at, '}')
    } else if (n === '{') {
      i += 2
      parameter(at)
    } else if (n === '[' && !ps) {
      // The old `$[...]` arithmetic, where `<<` is a shift.
      i += 2
      for (let depth = 0; i < s.length && !(s[i] === ']' && !depth); ) {
        charge(1)
        const st = i
        if (s[i] === '[') depth++
        else if (s[i] === ']') depth--
        else if (s[i] === '$' && dollar(at)) continue
        else if (s[i] === '`') {
          backtick(at)
          continue
        }
        if (i === st) i++
      }
      i++
    } else if (n !== undefined && /[\w@*#?$!-]/.test(n)) {
      i += 2
      if (/\w/.test(n)) while (i < s.length && (/\w/.test(s[i]) || (ps && s[i] === ':'))) i++
    } else return false
    return true
  }

  // Arithmetic after its opening `((`, to the matching `))`, where `<<` is a
  // shift. False where the parentheses do not close as `))`, so the text is a
  // subshell in a substitution.
  function arithmetic(at: Loc[]): boolean {
    for (let depth = 0; i < s.length; ) {
      charge(1)
      const c = s[i]
      const st = i
      if (c === '(') depth++
      else if (c === ')' && depth) depth--
      else if (c === ')') {
        if (s[i + 1] !== ')') return false
        i += 2
        return true
      } else if (c === '$' && dollar(at)) continue
      else if (c === '`') {
        backtick(at)
        continue
      }
      if (i === st) i++
    }
    return false
  }

  // A `${...}` expansion after its opening brace, to the brace that closes it.
  // A quote inside it is read as a quote, so a brace inside the quote closes nothing.
  function parameter(at: Loc[]) {
    const from = i - 1
    for (let depth = 0; i < s.length; ) {
      const c = s[i]
      if (c === '}' && !depth) return void i++
      if (c === '{') depth++
      if (c === '}') depth--
      if (c === escape) i += 2
      else if (c === "'" && !ps) {
        const close = s.indexOf("'", i + 1)
        if (close < 0) return void (unclosed(i), (i = s.length))
        i = close + 1
      } else if (c === '"') {
        i++
        dq(at, '"')
      } else if (!(c === '$' && dollar(at))) {
        if (!ps && c === '`') backtick(at)
        else i++
      }
    }
    unclosed(from)
  }

  // A Bash backtick substitution, unescaped and read on its own.
  function backtick(at: Loc[]) {
    const from = i
    let inner = ''
    for (i++; i < s.length && s[i] !== '`'; i++) {
      if (s[i] === '\\' && '$`\\'.includes(s[i + 1] ?? '')) i++
      inner += s[i]
    }
    if (i >= s.length) unclosed(from)
    i++
    add(lexAll(inner, false, at, false, functions))
  }

  // A double-quoted span from i to `end`, or to the end of the text where `end` is ''.
  function dq(at: Loc[], end: string): Word {
    const from = i - 1
    let text = ''
    let literal = true
    for (;;) {
      if (i >= s.length) {
        if (end) unclosed(from)
        break
      }
      const c = s[i]
      const st = i
      if (c === end) {
        if (ps && end === '"' && s[i + 1] === '"') {
          text += '"'
          i += 2
          continue
        }
        i++
        break
      }
      if (c === escape && i + 1 < s.length) {
        const n = s[i + 1]
        if (n !== '\n') text += ps || '$`"\\'.includes(n) ? n : c + n
        i += 2
      } else if ((c === '$' && dollar(at)) || (!ps && c === '`' && (backtick(at), true))) {
        text += s.slice(st, i)
        literal = false
      } else {
        text += c
        i++
      }
    }
    return { text, literal, quoted: true }
  }

  // One word from i, up to an unquoted blank or operator.
  function word(at: Loc[]): Word {
    let text = ''
    let literal = true
    let wordQuoted = false
    // A single-quoted span after `skip` opening characters: '...' in either
    // shell, with '' for a quote in PowerShell, or Bash's $'...' with escapes.
    const single = (skip: number, backslash: boolean) => {
      const from = i
      wordQuoted = true
      for (i += skip; ; i++) {
        if (i >= s.length) return unclosed(from)
        if (backslash && s[i] === '\\') {
          const [decoded, end] = ansiC(s, i)
          text += decoded
          i = end - 1
        } else if (s[i] === "'" && ps && s[i + 1] === "'") text += s[++i]
        else if (s[i] === "'") return void i++
        else text += s[i]
      }
    }
    while (i < s.length) {
      const c = s[i]
      const st = i
      if (c === escape) {
        if (s[i + 1] !== '\n' && i + 1 < s.length) text += s[i + 1]
        wordQuoted = true
        i += 2
      } else if (c === "'") single(1, false)
      else if (!ps && c === '$' && s[i + 1] === "'") single(2, true)
      else if (c === '"') {
        i++
        const w = dq(at, '"')
        text += w.text
        literal &&= w.literal
        wordQuoted = true
      } else if ((c === '$' && dollar(at)) || (!ps && c === '`' && (backtick(at), true))) {
        text += s.slice(st, i)
        literal = false
      } else if (s[i + 1] === '(' && (ps ? c === '@' : c === '<' || c === '>')) {
        // A PowerShell array subexpression, or a Bash process substitution,
        // which runs beside the command rather than before it.
        if (!ps) reorder()
        i += 2
        const inner = list(at, ')')
        if (ps) side = union(side, inner)
        text += s.slice(st, i)
        literal = false
      } else if (meta.test(c)) break
      else {
        // ~, or a PowerShell splat such as `@args`, cannot be read.
        if ((c === '~' || (ps && c === '@' && /\w/.test(s[i + 1] ?? ''))) && !text && !wordQuoted) literal = false
        text += c
        i++
      }
    }
    return { text, literal, quoted: wordQuoted }
  }

  // Each heredoc body after the newline that ends its command. An unquoted
  // body is read as double-quoted text, so a substitution in it runs.
  function bodies() {
    for (const h of heredocs.splice(0)) {
      const from = i
      let to = s.length
      let next = s.length
      for (let p = i; p < s.length; ) {
        const nl = s.indexOf('\n', p) < 0 ? s.length : s.indexOf('\n', p)
        const raw = s.slice(p, nl)
        const line = h.strip ? raw.replace(/^\t+/, '') : raw
        if (line === h.delim) {
          to = p
          next = Math.min(nl + 1, s.length)
          break
        }
        // Bash also ends a heredoc in a substitution at `EOF)`, and the `)` closes the substitution.
        if (line.startsWith(h.delim) && /^[ \t]*\)/.test(line.slice(h.delim.length))) {
          to = p
          next = p + raw.length - line.length + h.delim.length
          break
        }
        p = nl + 1
      }
      if (!h.quoted) {
        reorder()
        add(lexAll(s.slice(from, to), false, h.at, true, functions))
      }
      i = next
    }
  }

  // The commands from i up to `end`, or the end of the text, starting from
  // `from`; returns every place the shell may be after them.
  function list(from: Loc[], end: string): Loc[] {
    // Whether the last command was a function name with no body yet, which may follow on a later line.
    let defining = false
    let before = from
    let cur = from
    let ends: Loc[][] = []
    let allAnd = true
    let pipe: Loc[] | null = null
    let words: Word[] = []
    let after: Loc[] | null = null
    let cases = 0
    let expanded = 0
    const blocks: Loc[][] = []
    // Where the command being read, and the pipeline it is in, start in `commands`.
    let cmdStart = commands.length
    let pipeStart: number | null = null

    // A cd after `&&` from the start of an and-or list has run when the next
    // command runs. One that may not have run leaves either directory. The
    // Bash tool runs bash or zsh, and the two differ: in zsh the last command
    // of a pipeline runs in this shell, and `&` sends only the last pipeline
    // of a list to the background, so either reading may hold. A PowerShell
    // pipeline runs in this runspace.
    const finish = (op: string) => {
      const base = after ?? cur
      const ran = words.length ? effect(words, base, ps, functions) : base
      if (words.length) {
        commands.push({ words, at: base })
        if (ps && /^(?:function|filter)$/i.test(words[0].text) && words[1]) functions.add(psName(words[1].text))
        else if (words[0].text === 'function' && words[1]) functions.add(words[1].text)
        if (words[1]?.text === '()') functions.add(words[0].text)
        defining = named(words)
        if (functions.size || /^(?:repeat|foreach|coproc)$/.test(words[0].text)) reorder()
      }
      // bash and zsh expand a command's arguments before its assignments, so
      // two words that run commands may run in either order.
      if (op === '&' || expanded > 1) reorder()
      const piped = op === '|' || op === '|&'
      // A compound command ended by `fi`, `esac`, or `done` is not one command here.
      if (piped && !words.length && !after) reorder()
      if (piped) pipeStart ??= cmdStart
      else if (pipeStart !== null) {
        const pipe = {}
        for (const c of commands.slice(pipeStart)) c.pipe = pipe
        pipeStart = null
      }
      cmdStart = commands.length
      expanded = 0
      words = []
      after = null
      if (piped) {
        if (ps) cur = union(cur, ran)
        else {
          pipe ??= cur
          cur = pipe
        }
        return
      }
      const r = pipe ? union(pipe, ran) : ran
      pipe = null
      ends.push(r)
      if (op === '&&') cur = allAnd ? r : union(cur, r)
      else if (op === '||') {
        allAnd = false
        cur = union(cur, r)
      } else {
        cur = op === '&' ? union(before, ...ends.slice(0, -1)) : union(...ends)
        before = cur
        ends = []
        allAnd = true
      }
    }

    while (i < s.length) {
      const c = s[i]
      const at = after ?? cur
      if (c === ' ' || c === '\t' || c === '\r' || (c === escape && s[i + 1] === '\n')) {
        i += c === escape ? 2 : 1
        continue
      }
      if (c === '#') {
        while (i < s.length && s[i] !== '\n') i++
        continue
      }
      if (ps && s.startsWith('<#', i)) {
        const close = s.indexOf('#>', i + 2)
        i = close < 0 ? s.length : close + 2
        continue
      }
      // A case pattern's `)` ends the pattern, whose words are not a command.
      if (c === ')' && cases) {
        i++
        words = []
        continue
      }
      if (c === end && (ps || end !== '}')) {
        i++
        finish(';')
        return cur
      }
      // One left unmatched, as after a case pattern, ends a command.
      if (c === ')' || (ps && c === '}')) {
        i++
        finish(';')
        continue
      }
      const redirect = (ps ? /([\d*])?(>>?)(&\d)?/y : /(\d+|\{\w+\})?(&>>?|>>|>&|>\||<<<|<<-|<<|<&|<>|>|<)()/y)
      redirect.lastIndex = i
      const r = redirect.exec(s)
      if (r && !(!ps && !r[1] && (r[2] === '<' || r[2] === '>') && s[i + 1] === '(')) {
        i += r[0].length
        if (r[3]) continue
        while (s[i] === ' ' || s[i] === '\t') i++
        // A target is expanded before the body of a group or a block it follows.
        const listed = commands.length
        const target = word(at)
        if (commands.length > listed) reorder()
        if (side.length) {
          after = union(at, side)
          side = []
        }
        if (r[2] === '<<' || r[2] === '<<-') heredocs.push({ delim: target.text, quoted: target.quoted, strip: r[2] === '<<-', at })
        continue
      }
      const operator = /&&|\|\||;;&?|;&|\|&|[;&|\n]/y
      operator.lastIndex = i
      const o = operator.exec(s)
      if (o) {
        i += o[0].length
        // PowerShell's call operator.
        if (ps && o[0] === '&' && !words.length && !after) continue
        finish(o[0] === '\n' || o[0].startsWith(';') ? ';' : o[0])
        if (o[0] === '\n') bodies()
        continue
      }
      // A Bash subshell, which leaves the directory as it was, or a PowerShell
      // group or script block, which may change it.
      if (!ps && c === '(' && s[i + 1] === '(' && !words.length) {
        const st = i
        i += 2
        if (arithmetic(at)) {
          words.push({ text: '(())', literal: false, quoted: false })
          continue
        }
        i = st
      }
      if (c === '(' || (ps && c === '{')) {
        // A PowerShell if, elseif, or else body runs in its place.
        if (c === '{' && !psIf(words)) reorder()
        i++
        if ((ps ? c === '{' : c === '(') && (named(words) || (defining && !words.length && !after))) {
          defining = false
          list(NOWHERE, c === '(' ? ')' : '}')
          if (words.length) words.push({ text: c === '(' ? '()' : '{}', literal: false, quoted: false })
          continue
        }
        const from = i
        const inner = list(at, c === '(' ? ')' : '}')
        if (ps) after = union(at, inner)
        // Parentheses with text in them, as in zsh's `ls (a|b)` or `for x (a)`, are not a function definition.
        const empty = ps || !s.slice(from, i - 1).trim()
        words.push({ text: c === '{' ? '{}' : empty ? '()' : '(…)', literal: false, quoted: false })
        continue
      }
      const here = ps ? /@(['"])[ \t]*\n/y : null
      if (here) {
        here.lastIndex = i
        const h = here.exec(s)
        if (h) {
          const body = i + h[0].length
          const close = s.indexOf(`\n${h[1]}@`, body - 1)
          if (close < 0) unclosed(i)
          const text = s.slice(body, close < 0 ? s.length : Math.max(body, close))
          if (h[1] === '"') add(lexAll(text, true, at, true, functions))
          words.push({ text, literal: h[1] === "'", quoted: true })
          i = close < 0 ? s.length : close + 3
          continue
        }
      }
      const st = i
      const listed = commands.length
      const w = word(at)
      if (commands.length > listed) expanded++
      if (side.length) {
        after = union(at, side)
        side = []
      }
      if (i === st) {
        i++
        continue
      }
      if (!ps && !after && (named(words) || (defining && !words.length))) {
        if (w.text !== '{' || w.quoted) throw new Error('a function body that is not in braces or parentheses is not read')
        defining = false
        list(NOWHERE, '}')
        if (words.length) words.push({ text: '{}', literal: false, quoted: false })
        continue
      }
      if (!ps && !w.quoted && !words.length && !after) {
        if (w.text === '}' && end === '}') {
          finish(';')
          return cur
        }
        if (w.text === '{') {
          after = list(cur, '}')
          continue
        }
        if (OPEN.has(w.text)) {
          if (pipeStart !== null) reorder()
          if (w.text === 'case') cases++
          else if (w.text !== 'if') reorder()
          blocks.push(cur)
          continue
        }
        if (SKIP.has(w.text)) continue
        if (ELSE.has(w.text)) {
          cur = union(cur, blocks.at(-1) ?? [])
          continue
        }
        if (CLOSE.has(w.text)) {
          if (w.text === 'esac' && cases) cases--
          cur = union(cur, blocks.pop() ?? [])
          continue
        }
      }
      words.push(w)
    }
    finish(';')
    return cur
  }

  if (quoted) dq(start, '')
  else list(start, '')
  return { commands, open }
}

const isPowerShell = (shell: string) => /powershell|pwsh/i.test(shell)

// A PowerShell if statement, its parts read as `()` and `{}`.
const PS_IF = /^(?:if|elseif|else)$/i
const psIf = (words: Word[]) =>
  words.length > 0 && PS_IF.test(words[0].text) && words.every(w => (w.literal ? !w.quoted && PS_IF.test(w.text) : /^(?:\(\)|\{\})$/.test(w.text)))

// PowerShell reads curly quotes as straight ones.
function commands(cmd: string, shell: string, outer: Dir): Command[] {
  const ps = isPowerShell(shell)
  const text = cmd.replace(/\r\n/g, '\n')
  // After --% PowerShell passes the rest of the line as it is, comments included.
  if (ps && /(?:^|\s)--%(?:\s|$)/.test(text)) throw new Error('a PowerShell --% is not read')
  budget.left = 200_000 + 50 * text.length
  order.kept = true
  return lexAll(ps ? text.replace(/[\u2018\u2019\u201A\u201B]/g, "'").replace(/[\u201C\u201D\u201E]/g, '"') : text, ps, [{ dir: outer, stack: [], gitDir: undefined }])
}

// The repo a git command reads: its --git-dir, else a GIT_DIR, else its
// directory after an `env -C` before it and each -C. A --work-tree does not
// change the repo. `env -i` or `env -u GIT_DIR` clears a GIT_DIR set before it.
function repoDir(at: Loc[], before: Word[], cs: Word[] = [], gitDir?: Word): Dir {
  const chdir: (Word | undefined)[] = []
  const e = before.findIndex(w => /^(?:.*\/)?env$/.test(w.text))
  let cleared = false
  for (let j = e + 1; e >= 0 && j < before.length; j++) {
    const a = before[j].text
    if (/^(?:-C|--chdir)$/.test(a)) chdir.push(before[++j])
    else if (a.startsWith('--chdir=')) chdir.push(valueOf(before[j]))
    else if (/^(?:-i|--ignore-environment|-|-uGIT_DIR|--unset=GIT_DIR)$/.test(a)) cleared = true
    else if (/^(?:-u|--unset)$/.test(a)) cleared ||= before[++j]?.text === 'GIT_DIR'
  }
  const env = gitDir ?? lastGitDir(cleared ? before.slice(e + 1) : before)
  return one(at.map(l => {
    let d = l.dir
    for (const c of [...chdir, ...cs]) d = resolve(d, c)
    return env ? resolve(d, env) : l.gitDir !== undefined && !cleared ? l.gitDir : d
  }))
}

const unique = <T>(found: T[]) => {
  const seen = new Set<string>()
  return found.filter(w => !seen.has(JSON.stringify(w)) && !!seen.add(JSON.stringify(w)))
}

// git's built-in commands. Any other subcommand may be an alias, which the
// hook reads from config. git-gui's `gui` and `citool`, `instaweb`, and
// `send-email` are left out: git runs an alias of that name where the program
// is not installed.
const BUILTIN = new Set(`add am annotate apply archive backfill bisect blame branch bugreport bundle cat-file check-attr check-ignore
check-mailmap check-ref-format checkout checkout-index cherry cherry-pick clean clone column commit commit-graph commit-tree
config count-objects credential describe diagnose diff diff-files diff-index diff-tree difftool fast-export fast-import fetch fetch-pack
filter-branch fmt-merge-msg for-each-ref for-each-repo format-patch fsck gc get-tar-commit-id grep hash-object help init init-db
interpret-trailers last-modified log ls-files ls-remote ls-tree mailinfo mailsplit maintenance merge merge-base merge-file
merge-tree mergetool mktag mktree multi-pack-index mv name-rev notes pack-objects pack-refs prune prune-packed pull range-diff read-tree
rebase reflog refs remote repack replace replay repo request-pull rerere reset restore rev-list rev-parse revert rm
shortlog show show-branch show-ref sparse-checkout stage stash status stripspace submodule switch symbolic-ref tag unpack-objects
update-index update-ref var verify-commit verify-pack verify-tag version whatchanged worktree write-tree`.split(/\s+/))

// `remote` is the remote given in the push: undefined where none is given, and
// null where it cannot be read from the command. `submodules` is set where the
// command says whether the push recurses into submodules, and is otherwise read
// from config. `configs` are the -c values given with an alias the hook reads.
// `staged` is set where another command in the line may have staged a gitlink.
// `unread` is set on an alias that may be set where the hook does not read it.
export type Push = { dir: Dir; dryRun: boolean; force: boolean; remote?: string | null; submodules?: boolean; alias?: string; rest?: string; configs?: Word[]; staged?: boolean; otherRepo?: boolean; unread?: boolean }

// The long options of a command, the ones that take a value, and its short
// options that take one.
type Options = { names: string[]; valued: RegExp; short: string }
const PUSH: Options = {
  names: `all branches mirror delete tags follow-tags signed atomic push-option receive-pack exec force-with-lease force-if-includes
force repo set-upstream thin quiet verbose progress prune no-verify verify dry-run porcelain recurse-submodules ipv4 ipv6 help`.split(/\s+/),
  valued: /^(?:push-option|receive-pack|exec|recurse-submodules|repo)$/,
  short: 'o',
}
const SUBTREE: Options = {
  names: 'annotate branch onto message prefix squash no-squash rejoin ignore-joins quiet debug help'.split(' '),
  valued: /^(?:annotate|branch|onto|message|prefix)$/,
  short: 'bmP',
}

// A long option as git reads it: a unique prefix, and --no- before most. '' for
// an option the command does not have.
function longOption(given: string, o: Options): { option: string; negated: boolean } {
  const negated = given.startsWith('no-') && !o.names.includes(given)
  const name = negated ? given.slice(3) : given
  const matches = o.names.filter(n => n === name || n.startsWith(name))
  return { option: matches.includes(name) ? name : matches.length === 1 ? matches[0] : '', negated }
}

// Whether a push is a dry run, whether it forces, whether it recurses into
// submodules, and its remote. --force*, --mirror, --delete, or --prune, an f or
// d in a short-flag group, or a refspec that starts with + or deletes with a
// leading colon forces it. An option that takes a value takes the rest of its
// group, or the next word. The first word that is not an option is the remote,
// else the value of --repo.
function pushFlags(args: Word[], o = PUSH): { dryRun: boolean; force: boolean; submodules?: boolean; remote?: string | null } {
  let dryRun = false
  let force = false
  let submodules: boolean | undefined
  let options = true
  let named: Word | undefined
  let repo: Word | undefined
  for (let j = 0; j < args.length; j++) {
    const a = args[j].text
    const long = options && /^--([^=]+)(=?)/.exec(a)
    if (options && a === '--') options = false
    else if (long) {
      const [, given, eq] = long
      const { option, negated } = longOption(given, o)
      const value = () => (eq ? { ...args[j], text: a.slice(a.indexOf('=') + 1) } : args[++j])
      if (option === 'repo' && !negated) repo = value()
      else if (option === 'recurse-submodules') {
        const v = negated ? undefined : value()
        submodules = !negated && (!v?.literal || /^(?:on-demand|only)$/.test(v.text))
      } else if (o.valued.test(option) && !negated) value()
      else if (/^(?:force|force-with-lease|mirror|delete|prune)$/.test(option) && !negated) force = true
      else if (option === 'dry-run' || option === 'help') dryRun = !negated
    } else if (options && /^-[^-]/.test(a)) {
      for (let x = 1; x < a.length; x++) {
        if (o.short.includes(a[x])) {
          if (x === a.length - 1) j++
          break
        }
        // -h prints usage, and pushes nothing.
        if (a[x] === 'n' || a[x] === 'h') dryRun = true
        if (o === PUSH && (a[x] === 'f' || a[x] === 'd')) force = true
      }
    } else {
      named ??= args[j]
      if (/^(?:\+|:.)/.test(a)) force = true
    }
  }
  const remote = named ?? repo
  return { dryRun, force, ...(submodules !== undefined && { submodules }), ...(remote && { remote: remote.literal ? remote.text : null }) }
}

// zsh runs `=git` as the git on the PATH, `git-push` is git's own push, and
// `$(which git)` runs git too. An assignment is not a command, and a path such
// as `../git-tools` is not one of git's own programs.
const GIT = /^=?(?:.*[\/\\])?git(?:-([\w-]+?))?(?:\.exe)?$/i
const PROGRAMS = new Set([...BUILTIN, 'push', 'send-pack', 'http-push', 'subtree', 'lfs'])
const CLI = /^=?(?:.*[\/\\])?(gh|glab)(?:\.exe)?$/i
const LOOKUP = /^(?:\$\(|`)\s*(?:which|command\s+-[vV]|type\s+-[pP]|whence(?:\s+-p)?|where(?:\.exe)?)\s+(git|gh|glab)(?:\.exe)?\s*[)`]$/i
const ASSIGNMENT = /^[A-Za-z_]\w*=/
const lookup = (w: Word) => (w.literal ? '' : (LOOKUP.exec(w.text)?.[1] ?? '').toLowerCase())
function isGit(w: Word | undefined): boolean {
  const m = w && !ASSIGNMENT.test(w.text) ? GIT.exec(w.text) : null
  return m ? !m[1] || PROGRAMS.has(m[1].toLowerCase()) : !!w && lookup(w) === 'git'
}
function cliOf(w: Word | undefined): string {
  if (!w || ASSIGNMENT.test(w.text)) return ''
  const name = (CLI.exec(w.text)?.[1] ?? lookup(w)).toLowerCase()
  return name === 'git' ? '' : name
}
// The gh or glab in a simple command: the first, unless it is the value of an
// option given to the gh or glab right after it, as in `sudo -u gh gh`.
const cliAt = (words: Word[]) => words.findIndex((w, x) => cliOf(w) && !cliOf(words[x + 1]))

// Words joined back into a command with their quoting, so that a `#` or `;` in
// one is not read as a comment or an operator.
const joined = (words: Word[]) => words.map(w => (w.literal ? `'${w.text.replace(/'/g, `'\\''`)}'` : `"${w.text}"`)).join(' ')

// The config keys that can change where a push or a PR goes. One set for a
// single push makes its remote unknown, and a write to one or to a hold is put
// to the user.
const TARGET_KEYS = /^(?:remotes?|url|branch|include|includeif|lfs)(?:\.|$)/i
const HELD_KEYS = /^(?:(?:remotes?|url|branch|include|includeif|lfs|alias|session-skills)(?:\.|$)|push\.recursesubmodules$|submodule\.recurse$)/i
// Variables that move the config git reads, and those that send gh or glab to another repo.
const CONFIG_VARS = /^(?:GIT_CONFIG\w*|HOME|XDG_CONFIG_HOME|GIT_COMMON_DIR)$/i
const REPO_VARS = /^(?:GH_REPO|GITLAB_REPO|GIT_DIR)$/i
// Whether a command sets one of `names`: an assignment before its first word,
// one given to env, export, or another command that takes assignments, after a
// wrapper such as `timeout 60s` too, or PowerShell's $env:NAME. An argument such
// as `-m 'HOME=/tmp'` sets nothing.
const SETTERS = /^(?:(?:.*\/)?env|export|declare|typeset|local|readonly|sudo)$/
const sets = (cmds: Command[], names: RegExp) =>
  cmds.some(c => {
    const first = c.words.findIndex(w => !ASSIGNMENT.test(w.text) && !/^\$\{?env:/i.test(w.text))
    const setter = c.words.findIndex(w => SETTERS.test(w.text))
    const scan = first < 0 ? c.words : [...c.words.slice(0, first), ...(setter < 0 ? [] : c.words.slice(setter))]
    return scan.some(w => {
      const m = /^(?:\$\{?env:)?([A-Za-z_]\w*)\}?(?:=|$)/i.exec(w.text)
      return !!m && names.test(m[1]) && (w.text.includes('=') || w.text.startsWith('$'))
    })
  })

// git's options before its subcommand, read from the word after `git` at k:
// where the subcommand is, each -C, each -c or --config-env value, and a
// --git-dir. A --config-env value is read from a variable, so it is not literal.
function gitOptions(words: Word[], k: number): { j: number; cs: (Word | undefined)[]; configs: Word[]; gitDir?: Word } {
  const cs: (Word | undefined)[] = []
  const configs: Word[] = []
  let gitDir: Word | undefined
  let j = k + 1
  for (; j < words.length; j++) {
    const a = words[j].text
    const env = (text: string) => configs.push({ text: text.slice(0, text.indexOf('=') + 1), literal: false, quoted: false })
    if (a === '-C') cs.push(words[++j])
    else if (a === '-c') configs.push(words[++j] ?? { text: '', literal: false, quoted: false })
    else if (a === '--config-env') env(words[++j]?.text ?? '')
    else if (a.startsWith('--config-env=')) env(a.slice(13))
    else if (a === '--git-dir') gitDir = words[++j] ?? { text: '', literal: false, quoted: false }
    else if (a.startsWith('--git-dir=')) gitDir = { ...words[j], text: a.slice(10) }
    else if (/^--(?:work-tree|namespace|attr-source|super-prefix|shallow-file)$/.test(a)) j++
    else if (!a.startsWith('-') || a === '--help' || a === '-h') break
  }
  return { j, cs, configs, gitDir }
}

// The git commands in a simple command, with a `git-<name>` program split into
// `git <name>`, and `git --help <name>` read as `git help <name>`, as git runs
// it. The arguments of a subcommand are not read as commands, so `git grep -e
// git -e push` is no push, unless the git follows an option, whose value it may
// be, as in `sudo -u git -g staff git push`, and the subcommand is not built in
// or an alias set with -c. A git that is the value of an option given to the
// git right after it is not a command.
function gitCommands(all: Word[]): { words: Word[]; k: number }[] {
  const found: { words: Word[]; k: number }[] = []
  let words = all
  for (let k = 0; k < words.length; k++) {
    if (!isGit(words[k])) continue
    const program = ASSIGNMENT.test(words[k].text) ? undefined : GIT.exec(words[k].text)?.[1]
    if (program) words = [...words.slice(0, k), { ...words[k], text: 'git' }, { text: program, literal: true, quoted: false }, ...words.slice(k + 1)]
    const { j, configs } = gitOptions(words, k)
    if (isGit(words[j])) continue
    if (words[j]?.literal && /^(?:--help|-h)$/.test(words[j].text)) words = [...words.slice(0, j), { ...words[j], text: 'help' }, ...words.slice(j + 1)]
    found.push({ words, k })
    const sub = words[j]
    if (!sub?.literal || PROGRAMS.has(sub.text) || configAliases(configs).has(sub.text.toLowerCase()) || !words[k - 1]?.text.startsWith('-')) break
    k = j
  }
  return found
}

// The aliases set with -c, by their lowercased name, as git reads them, in
// both `alias.<name>` and git 2.54's `alias.<name>.command`. An alias whose
// text is read from a variable is set to null.
function configAliases(configs: Word[]): Map<string, string | null> {
  const aliases = new Map<string, string | null>()
  for (const w of configs) {
    const m = /^alias\.(.+?)(?:\.command)?=(.*)$/is.exec(w.text)
    if (m) aliases.set(m[1].toLowerCase(), w.literal ? m[2] : null)
  }
  return aliases
}

// The commands a command leaves to run, each read as a shell command in a
// directory that is not read: a `trap` action, and the command given to `git
// submodule foreach`, `git bisect run`, `git rebase -x`, `git difftool -x`, or
// `git for-each-repo`. A git one runs with the -c values given to the git that runs it.
function later(all: Word[]): { text: string; configs: Word[] }[] {
  if (all[0]?.text === 'trap') {
    const action = all[1]?.text === '--' ? all[2] : all[1]
    return action && !action.text.startsWith('-') ? [{ text: action.text, configs: [] }] : []
  }
  return gitCommands(all).flatMap(g => gitLater(g.words, g.k))
}

function gitLater(words: Word[], k: number): { text: string; configs: Word[] }[] {
  const { j, configs } = gitOptions(words, k)
  const sub = words[j]?.text
  const rest = words.slice(j + 1)
  const texts: string[] = []
  const after = (verb: string) => rest.slice(rest.findIndex(w => w.text === verb) + 1)
  if (sub === 'submodule' && rest.some(w => w.text === 'foreach')) {
    // foreach runs its arguments as one shell command, so they are read again unquoted.
    const args = after('foreach')
    const x = args.findIndex(w => !w.text.startsWith('-'))
    if (x >= 0) texts.push(args.slice(x).map(w => w.text).join(' '))
  } else if (sub === 'bisect' && rest.some(w => w.text === 'run')) texts.push(joined(after('run')))
  else if (sub === 'for-each-repo') {
    for (let x = 0; x < rest.length; x++) {
      const a = rest[x].text
      if (a === '--config') x++
      else if (a === '--' || !a.startsWith('-')) {
        texts.push(`git ${joined(rest.slice(a === '--' ? x + 1 : x))}`)
        break
      }
    }
  } else if (sub === 'rebase' || sub === 'difftool') {
    const name = sub === 'rebase' ? 'exec' : 'extcmd'
    for (let x = 0; x < rest.length; x++) {
      const a = rest[x].text
      const long = /^--([\w-]+)(=?)/.exec(a)
      if (long && long[1].length > 1 && name.startsWith(long[1])) texts.push(long[2] ? a.slice(a.indexOf('=') + 1) : (rest[++x]?.text ?? ''))
      else if (!long && /^-[a-wyzA-Z]*x/.test(a)) texts.push(a.slice(a.indexOf('x') + 1) || (rest[++x]?.text ?? ''))
    }
  }
  return texts.map(text => ({ text, configs }))
}

// The command an alias runs, with the arguments given after it: a `!` alias in the shell, any other with git.
export const expand = (alias: string, rest: string) => `${alias.startsWith('!') ? alias.slice(1) : `git ${alias}`} ${rest}`

const nested = (depth: number) => {
  if (depth > 8) throw new Error('the command runs git aliases or later commands nested too deeply to read')
}

const CONFIG: Options = {
  names: `global system local worktree file blob get get-all get-regexp get-urlmatch replace-all add unset unset-all rename-section
remove-section list edit get-color get-colorbool null name-only show-origin show-scope show-names type bool int bool-or-int bool-or-str
path expiry-date default comment fixed-value includes all regexp value url append`.split(/\s+/),
  valued: /^(?:file|blob|type|default|comment|value|url)$/,
  short: 'ft',
}

// The held key a `git config` command writes, or undefined for a read or a key
// that is not held. A key that is not written out is held. git reads a quoted
// option as an option, and takes a unique prefix of a long one. The form before
// git 2.46 reads no option after the key, and its subcommands read them anywhere.
function configKey(args: Word[]): string | undefined {
  const pos: Word[] = []
  let mode = ''
  let options = true
  for (let i = 0; i < args.length; i++) {
    const a = args[i].text
    const long = options && /^--([^=]+)(=?)/.exec(a)
    if (options && a === '--') options = false
    else if (long) {
      const { option, negated } = longOption(long[1], CONFIG)
      if (CONFIG.valued.test(option) && !negated && !long[2]) i++
      else if (/^(?:get|get-all|get-regexp|get-urlmatch|get-color|get-colorbool|list)$/.test(option)) return undefined
      else if (option === 'edit') return a
      else if (/^(?:add|replace-all|unset|unset-all|rename-section|remove-section)$/.test(option)) mode = option
    } else if (options && /^-[^-]/.test(a)) {
      for (let x = 1; x < a.length; x++) {
        if (a[x] === 'l') return undefined
        if (a[x] === 'e') return a
        if (CONFIG.short.includes(a[x])) {
          if (x === a.length - 1) i++
          break
        }
      }
    } else {
      pos.push(args[i])
      if (pos.length === 1 && !(args[i].literal && /^(?:get|list|set|unset|rename-section|remove-section|edit)$/.test(a))) options = false
    }
  }
  // The subcommands added in git 2.46. A key always has a dot in it.
  const verb = pos[0]?.literal ? pos[0].text : ''
  if (verb === 'get' || verb === 'list') return undefined
  if (verb === 'edit') return verb
  if (/^(?:set|unset|rename-section|remove-section)$/.test(verb)) {
    mode = verb
    pos.shift()
  }
  if (!mode && pos.length < 2) return undefined
  // A section is held where a held key is in it, as push.recurseSubmodules is in `push`.
  const held = (w: Word) => !w.literal || HELD_KEYS.test(w.text) || (mode.endsWith('section') && /^(?:push|submodule)$/i.test(w.text))
  return pos.slice(0, mode.includes('rename') ? 2 : 1).find(held)?.text
}

// A -c whose key is read from a variable, which may set any key, an alias included.
const unread = (configs: Word[]) => configs.some(w => !w.literal && !/^[\w.-]+=/.test(w.text))

// Each command in a shell command that can change where a later push or PR
// goes, run one unseen, or lift a hold: a git config write to a remote,
// remotes, url, branch, include, lfs, alias, or session-skills key, `git remote add`,
// `rename`, `remove`, `rm`, or `set-url`, `git submodule set-url` or `sync`,
// and `gh alias set` or `import`. An alias set with -c is read in place.
// shortcut: an edit to the config file itself, with a file tool or sed, or a write through an alias in git config, is not seen.
export function configWrites(cmd: string, shell = 'Bash', outer?: Dir, inherited: Word[] = [], depth = 0): string[] {
  nested(depth)
  const found: string[] = []
  for (const { words: all } of commands(cmd, shell, outer)) {
    for (const r of later(all)) for (const w of configWrites(r.text, 'Bash', null, [...inherited, ...r.configs], depth + 1)) found.push(w)
    const c = cliAt(all)
    if (c >= 0) {
      const pos = all.slice(c + 1).filter(w => !w.text.startsWith('-'))
      const verb = pos.slice(1).find(w => !w.literal || /^(?:set|import)$/.test(w.text))
      if (pos[0]?.text === 'alias' && verb) found.push(`${cliOf(all[c])} alias ${verb.text}`)
    }
    for (const { words, k } of gitCommands(all)) {
      const { j, configs: own } = gitOptions(words, k)
      const configs = [...inherited, ...own]
      const sub = words[j]
      const rest = words.slice(j + 1)
      const alias = sub && configAliases(configs).get(sub.text.toLowerCase())
      const verb = rest.find(w => !w.text.startsWith('-'))
      if (sub?.text === 'remote') {
        if (verb && (!verb.literal || /^(?:add|rename|remove|rm|set-url)$/.test(verb.text))) found.push(`git remote ${verb.text}`)
      } else if (sub?.text === 'submodule') {
        if (verb && (!verb.literal || /^(?:set-url|sync)$/.test(verb.text))) found.push(`git submodule ${verb.text}`)
      } else if (sub?.text === 'config') {
        const key = configKey(rest)
        if (key !== undefined) found.push(`git config ${key}`)
      } else if (typeof alias === 'string') {
        for (const w of configWrites(expand(alias, joined(rest)), 'Bash', undefined, configs, depth + 1)) found.push(w)
      } else if (sub && (alias === null || (unread(configs) && !BUILTIN.has(sub.text)))) found.push(`git ${sub.text}`)
    }
  }
  return unique(found)
}

// Whether a git command from the list below still changes the branch a later
// push reads its remote from, or that branch's upstream: a symbolic-ref that
// sets HEAD, a rebase given a branch, or one that continues, skips, or aborts,
// since HEAD is detached while the hook reads config and is back on the branch
// when the push runs, or a fetch or pull with `--set-upstream`, which has no
// short form: their -t is --tags and -u is --update-head-ok. A long option is
// read as git takes it, by any prefix of two or more characters.
const longOf = (w: Word, names: string[]) => {
  const long = /^--([\w-]+)(?:=|$)/.exec(w.text)
  return !!long && long[1].length > 1 && names.some(o => o.startsWith(long[1]))
}
const setsUpstream = (w: Word) => longOf(w, ['set-upstream'])
const positional = (rest: Word[], valued: RegExp) => rest.filter((w, i) => !w.text.startsWith('-') && !valued.test(rest[i - 1]?.text ?? ''))
const moves = (sub: string, rest: Word[]) =>
  (sub === 'symbolic-ref' && rest.filter(w => !w.text.startsWith('-')).length > 1) ||
  // `git rebase <upstream> <branch>` and `git rebase --root <branch>` check out the branch first.
  (sub === 'rebase' && (rest.some(w => longOf(w, ['continue', 'skip', 'abort'])) ||
    positional(rest, /^(?:--onto|--strategy|--strategy-option|--exec|-[sXx])$/).length > (rest.some(w => longOf(w, ['root'])) ? 0 : 1))) ||
  (/^(?:fetch|pull)$/.test(sub) && rest.some(setsUpstream))

// The commands known to leave the branch, its config, and the directory as
// they were, so that a later push with no remote is read against the config as
// it is when the hook runs: a git command below with nothing left to run that
// does not move the branch, a cd or pushd to a literal path with no `..`, a
// read such as echo or cat, an assignment, a test runner, a gh or glab read,
// any of these after `timeout`, and a subshell or script block, whose commands
// are read on their own. Anything else in the line with such a push, such as
// `gh pr checkout`, a git alias, or `npm install`, makes its remote unread, and
// the hold asks. Each git form was probed with git 2.56.0.
const SAFE_GIT = new Set('add blame cherry-pick commit describe diff fetch grep log ls-files merge merge-base mv pull rebase revert rev-list rev-parse rm shortlog show stash status symbolic-ref tag'.split(' '))
const READS = /^(?::|\[\[?|true|test|exit|echo|printf|cat|head|tail|tee|grep|wc|ls|pwd|write-output|write-host|get-content|get-location|get-childitem|select-object)$/i
const RUNNERS = /^(?:(?:\.[\\/])?(?:gradlew(?:\.bat)?|mvnw|test\.sh)|gradle|mvn|pytest|(?:npm|pnpm|yarn|bun|cargo|go) test|(?:npm|pnpm|yarn|bun) run (?:build|test|lint)|claude plugin test)(?: |$)/i
// gh and glab run a built-in command before an alias of the same name (gh 2.103.3, glab 1.128.0).
const HOST_READS = /^(?:gh (?:pr (?:view|list|status|checks|diff)|run (?:list|view|watch)|repo view)|glab (?:mr (?:view|list|diff)|ci (?:status|view|list)|repo view))$/
// set's flags that only change how errors and tracing are handled; -k would read an assignment anywhere as one for the command.
const SET_FLAGS = /^(?:[-+][euxvo]+|pipefail|errexit|nounset|xtrace|verbose)$/
// timeout's options before its duration.
const TIMEOUT_VALUED = /^(?:-[sk]|--signal|--kill-after)$/
const TIMEOUT_FLAG = /^(?:--foreground|--preserve-status|-v|--verbose|--(?:signal|kill-after)=\S+)$/
// A push that cannot set an upstream, name its remote, or run a program of its own.
const pushStays = (rest: Word[]) =>
  rest.every(w => w.literal && w.text.startsWith('-')) &&
  !rest.some(w => (w.text.startsWith('--') ? longOf(w, ['set-upstream', 'repo', 'receive-pack', 'exec']) : /u/.test(w.text)))
// Which git subcommands below leave the branch as it is depends on their arguments.
function gitStays(sub: string, rest: Word[]): boolean {
  const verb = rest.find(w => !w.text.startsWith('-'))
  if (sub === 'stash') return !verb || (verb.literal && verb.text !== 'branch')
  if (sub === 'push') return pushStays(rest)
  if (sub === 'remote') return rest.every(w => w.literal && /^(?:-v|--verbose)$/.test(w.text))
  if (sub === 'branch') {
    const list = rest.some(w => /^(?:-l|--list)$/.test(w.text))
    return rest.every(w => w.literal && (/^(?:--show-current|-l|--list|-a|--all|-r|--remotes|-v|-vv|--verbose)$/.test(w.text) || (list && !w.text.startsWith('-'))))
  }
  return SAFE_GIT.has(sub) && !moves(sub, rest)
}
function harmless(words: Word[], ps: boolean): boolean {
  const [first, ...args] = words
  if (words.length === 1 && !first.literal && /^(?:\(\)|\(…\)|\{\})$/.test(first.text)) return true
  if (!ps && words.every(w => ASSIGNMENT.test(w.text))) return true
  if (ps && psIf(words)) return true
  // A PowerShell condition such as `$LASTEXITCODE -eq 0`.
  if (ps && /^\$(?:\w+|\?)$/.test(first.text) && (args.length === 0 || (args.length === 2 && args.every(w => w.literal && !w.quoted) && /^-(?:eq|ne|gt|ge|lt|le)$/i.test(args[0].text) && /^\w+$/.test(args[1].text)))) {
    return true
  }
  if (!ps && first.literal && first.text === 'timeout') {
    let n = 1
    for (; n < words.length && words[n].literal && words[n].text.startsWith('-'); n++) {
      if (TIMEOUT_VALUED.test(words[n].text)) n++
      else if (!TIMEOUT_FLAG.test(words[n].text)) return false
    }
    return n + 1 < words.length && words[n].literal && /^\d+(?:\.\d+)?[smhd]?$/.test(words[n].text) && harmless(words.slice(n + 1), ps)
  }
  const git = gitCommands(words)
  if (git.length) {
    if (git.length > 1 || git[0].k !== 0 || later(words).length) return false
    const { j } = gitOptions(git[0].words, 0)
    const sub = git[0].words[j]
    return !sub || (sub.literal && gitStays(sub.text, git[0].words.slice(j + 1)))
  }
  if (!first.literal) return false
  if (!ps && first.text === 'set') return args.every(w => w.literal && SET_FLAGS.test(w.text))
  if (words.length >= 3 && words.slice(0, 3).every(w => w.literal) && HOST_READS.test(words.slice(0, 3).map(w => w.text).join(' '))) return true
  if ((ps ? /^(?:cd|chdir|sl|set-location|pushd|push-location)$/i : /^(?:cd|pushd)$/).test(first.text)) {
    return args.length > 0 && args.every(w => w.literal && w.text !== '-' && !UP.test(w.text))
  }
  return READS.test(first.text) || RUNNERS.test(words.map(w => w.text).join(' '))
}

// Whether a git command in a command writes the index, so that `git add -A`
// may stage a nested repo as a gitlink that a later push recurses into. git
// 2.56.0 staged one where a nested repo replaced a tracked file, in a commit
// with -a or with a pathspec that matched it, but not in a commit with neither.
// A word read as a pathspec where it is an option's value only holds the push.
const STAGES = new Set('add cherry-pick merge pull rebase revert'.split(' '))
const COMMIT_VALUED = /^(?:-[A-Za-z]*[mFcCtU]|--(?:message|file|reuse-message|reedit-message|template|author|date|cleanup|fixup|squash|trailer|unified|inter-hunk-context))$/
const commitStages = (rest: Word[]) =>
  positional(rest, COMMIT_VALUED).length > 0 ||
  rest.some(w => (w.text.startsWith('--') ? longOf(w, ['all', 'patch', 'interactive', 'pathspec-from-file']) : /^-[A-Za-z]*[ap]/.test(w.text)))
const writesIndex = (words: Word[]) =>
  gitCommands(words).some(g => {
    const { j } = gitOptions(g.words, g.k)
    const sub = g.words[j]?.text ?? ''
    return STAGES.has(sub) || (sub === 'commit' && commitStages(g.words.slice(j + 1)))
  })
// For each command, whether another command in the line may have moved the
// branch, its config, or the directory, and whether one may have staged a
// gitlink. A command listed after it counts where it is in the same pipeline,
// or where the line is not run in the order it is listed (see `order`).
function others(cmds: Command[], ps: boolean, kept: boolean): { unknown: boolean; staged: boolean }[] {
  const unsafe = cmds.map(c => !harmless(c.words, ps))
  const writes = cmds.map((c, x) => unsafe[x] || writesIndex(c.words))
  // Any flag before each command, and any after it out of order or in its pipeline, in one pass each way.
  const around = (flags: boolean[]) => {
    const after = flags.map(() => false)
    const piped = flags.map(() => false)
    const seen = new Set<object>()
    for (let x = flags.length - 1; x >= 0; x--) {
      if (x < flags.length - 1) after[x] = after[x + 1] || flags[x + 1]
      const pipe = cmds[x].pipe
      if (pipe) {
        piped[x] = seen.has(pipe)
        if (flags[x]) seen.add(pipe)
      }
    }
    let before = false
    return flags.map((f, x) => {
      const any = before || (!kept && after[x]) || piped[x]
      before ||= f
      return any
    })
  }
  const unknown = around(unsafe)
  const staged = around(writes)
  return cmds.map((_, i) => ({ unknown: unknown[i], staged: staged[i] }))
}

// Every push in a shell command, read in `shell`: the repo it runs in, whether
// it is a dry run, whether it forces, and its remote. `git send-pack`, `git
// http-push`, `git subtree push`, and `git lfs push` are pushes, and a command
// left to run later (see `later`) is read, in a directory that cannot be read.
// An alias set with -c is read in place, and any other subcommand that is not
// built in is returned with `alias` set, for the hook to read. A subcommand
// that is not written out, such as `git $sub`, is a push in a directory that
// cannot be read, so the hold asks. A push with no remote has a remote that
// cannot be read where another command that may run before it (see `others`)
// is not known to leave the branch and its config as they were (see `harmless`). A mirror or + refspec set with -c, or any config
// set in the environment, forces it.
export function pushTargets(cmd: string, shell = 'Bash', outer?: Dir, inherited: Word[] = [], depth = 0): Push[] {
  nested(depth)
  const found: Push[] = []
  const cmds = commands(cmd, shell, outer)
  const around = others(cmds, isPowerShell(shell), order.kept)
  const envConfig = sets(cmds, CONFIG_VARS)
  // An alias the hook reads may run gh or glab, which these send to another repo.
  const otherRepo = envConfig || sets(cmds, REPO_VARS)
  for (const [i, { words: all, at }] of cmds.entries()) {
    const { unknown: afterUnknown, staged } = around[i]
    for (const r of later(all)) for (const p of pushTargets(r.text, 'Bash', null, [...inherited, ...r.configs], depth + 1)) found.push({ ...p, dir: null })
    for (const { words, k } of gitCommands(all)) {
      const { j, cs, configs: own, gitDir } = gitOptions(words, k)
      const configs = [...inherited, ...own]
      const aliases = configAliases(configs)
      // A mirror set with -c to a value git reads as false does not force the push.
      const configForce = envConfig || configs.some(w => !w.literal || /^remote\..*\.(?:push=\+|mirror(?:$|=(?!(?:false|no|off|0*)$)))/is.test(w.text))
      const moved = envConfig || configs.some(w => !w.literal || TARGET_KEYS.test(w.text))
      // Recursion into submodules is set by the last -c for either key, read as git reads its value.
      // An alias may be set in the environment or in a file included with -c, which the hook does not read.
      const hidden = envConfig || configs.some(w => /^include(?:if)?\./i.test(w.text))
      const recursion = configs.filter(w => /^(?:push\.recursesubmodules|submodule\.recurse)(?:=|$)/i.test(w.text)).at(-1)
      const recurses = recursion && (!recursion.literal || /^push\.\w+=(?:on-demand|only)$|^submodule\.recurse(?:=(?:true|yes|on|-?[1-9]\d*))?$/i.test(recursion.text))
      const sub = words[j]?.text
      const rest = words.slice(j + 1)
      const dir = repoDir(at, words.slice(0, k), cs as Word[], gitDir)
      const pushAt = rest.findIndex(w => w.text === 'push')
      const flags = (args: Word[], o?: Options) => {
        const f = pushFlags(args, o)
        return { ...f, force: f.force || configForce, ...(f.submodules === undefined && recursion && { submodules: !!recurses }), ...((moved || (afterUnknown && f.remote === undefined)) && { remote: null }), ...(staged && { staged }) }
      }
      const alias = sub === undefined ? undefined : aliases.get(sub.toLowerCase())
      if (sub !== undefined && !words[j].literal) found.push({ dir: null, dryRun: false, force: false, remote: null })
      else if (sub === 'push') found.push({ dir, ...flags(rest) })
      // Their first word is a URL or a path, which no remote's visibility covers.
      else if (sub === 'send-pack' || sub === 'http-push') found.push({ dir, ...flags(rest), remote: null })
      else if ((sub === 'subtree' || sub === 'lfs') && pushAt >= 0) found.push({ dir, ...flags(rest.slice(pushAt + 1), sub === 'subtree' ? SUBTREE : PUSH) })
      else if (typeof alias === 'string') {
        for (const p of pushTargets(expand(alias, joined(rest)), 'Bash', dir, configs, depth + 1)) {
          found.push({ ...p, force: p.force || configForce, ...((moved || (afterUnknown && p.remote === undefined)) && { remote: null }), ...(staged && { staged }), ...(otherRepo && p.alias && { otherRepo }), ...(hidden && p.alias && { unread: true }) })
        }
      } else if (alias === null || (sub !== undefined && unread(configs) && !BUILTIN.has(sub))) found.push({ dir, dryRun: false, force: configForce, remote: null, ...(staged && { staged }) })
      else if (sub && !BUILTIN.has(sub)) {
        found.push({ dir, dryRun: false, force: configForce, alias: sub, rest: joined(rest), ...(configs.length > 0 && { configs }), ...((moved || afterUnknown) && { remote: null }), ...(staged && { staged }), ...(otherRepo && { otherRepo }), ...(hidden && { unread: true }) })
      }
    }
  }
  return unique(found)
}

// The gh and glab subcommands that only read from the host or act on this
// machine. Every other subcommand is taken as a write, so a verb added in a
// later release, or an alias such as `gh pr new`, is put to the user. `clone`
// reads only for a repo or a gist: `gh label clone` writes labels. `gh alias
// set` is held as a config write.
const LOCAL_NOUNS = new Set(['auth', 'config', 'extension', 'ext', 'alias', 'completion', 'help', 'version', 'browse', 'search', 'status', 'check-update', 'changelog'])
const READ_VERBS = new Set(['view', 'list', 'ls', 'status', 'diff', 'checks', 'checkout', 'co', 'download', 'watch', 'browse', 'get', 'search', 'verify', 'trace', 'lint', 'contributors', 'issues', 'field-list', 'item-list'])
const PR_CREATE: Record<string, string> = { gh: 'pr', glab: 'mr' }

// `pushes` is set on a PR or MR that may push the branch: gh pushes unless
// --head is given, and glab unless --push=false is.
// `unread` is set on a git alias the hook could not read, which may run one.
export type HostWrite = { what: string; dir: Dir; prCreate: boolean; otherRepo: boolean; pushes: boolean; staged?: boolean; unread?: boolean }

// The switches of `gh pr create` and `glab mr create`. Every other option takes
// a value, so a value such as a body that starts with "-" is not read as one.
const PR_SWITCHES: Record<string, [Set<string>, string]> = {
  gh: [new Set('draft dry-run editor fill fill-first fill-verbose no-maintainer-edit web help'.split(' ')), 'defwh'],
  glab: [new Set(`allow-collaboration auto-merge copy-issue-labels create-source-branch draft fill fill-commit-body help no-editor push
recover remove-source-branch signoff squash-before-merge web wip yes`.split(/\s+/)), 'fhwy'],
}

// Whether a PR or MR may push the branch: gh pushes unless the last --head
// gives a branch, and glab unless the last --push is --push=false. A --head
// whose value is not written out may be empty. An option missing from the
// switches above is read as taking a value, so a --head after it is missed,
// and the push is held.
function prPushes(cli: string, args: Word[]): boolean {
  const [switches, short] = PR_SWITCHES[cli]
  const given = (w: Word | undefined) => !!w && w.literal && w.text !== ''
  let head = false
  let push = true
  for (let i = 0; i < args.length; i++) {
    const a = args[i].text
    if (a === '--') break
    const long = /^--([\w-]+)(?:=(.*))?$/s.exec(a)
    if (long) {
      const [, name, eq] = long
      if (cli === 'gh' && name === 'head') head = given(eq !== undefined ? { ...args[i], text: eq } : args[i + 1])
      if (cli === 'glab' && name === 'push') push = eq !== 'false'
      if (eq === undefined && !switches.has(name)) i++
    } else if (/^-[^-]/.test(a)) {
      for (let x = 1; x < a.length; x++) {
        if (short.includes(a[x])) continue
        if (cli === 'gh' && a[x] === 'H') head = given(x + 1 < a.length ? { ...args[i], text: a.slice(x + 1) } : args[i + 1])
        if (x === a.length - 1) i++
        break
      }
    }
  }
  return cli === 'gh' ? !head : push
}

// Every host write in a shell command, read in `shell`: what it is, the repo it
// runs in, whether it opens a PR or MR, and whether -R, GH_REPO, or GITLAB_REPO
// sends it to another repo. An api call with a field and no method is a POST,
// as both CLIs send it, and a GraphQL call is a write unless its query field is
// literal and reads as a query. A help flag skips the command unless it follows
// an option, whose value it may be. An option other than -R before the verb
// may take the verb as its value, as cobra reads it, so the command is a write.
// A command left to run later (see `later`) is read in a directory that cannot be read,
// and a git alias set with -c is read in place, with the -c values given with it.
// shortcut: a write through a gh alias saved before the command is not detected.
export function hostWrites(cmd: string, shell = 'Bash', outer?: Dir, inherited: Word[] = [], depth = 0): HostWrite[] {
  nested(depth)
  const found: HostWrite[] = []
  const cmds = commands(cmd, shell, outer)
  const around = others(cmds, isPowerShell(shell), order.kept)
  // A variable that moves the config gh reads can send the PR to another repo too.
  const envRepo = sets(cmds, REPO_VARS) || sets(cmds, CONFIG_VARS)
  for (const [i, { words, at }] of cmds.entries()) {
    for (const r of later(words)) for (const w of hostWrites(r.text, 'Bash', null, [...inherited, ...r.configs], depth + 1)) found.push({ ...w, dir: null })
    for (const { words: g, k } of gitCommands(words)) {
      const { j, cs, configs: own, gitDir } = gitOptions(g, k)
      const configs = [...inherited, ...own]
      const alias = g[j]?.literal ? configAliases(configs).get(g[j].text.toLowerCase()) : undefined
      if (typeof alias !== 'string') continue
      for (const w of hostWrites(expand(alias, joined(g.slice(j + 1))), 'Bash', repoDir(at, g.slice(0, k), cs as Word[], gitDir), configs, depth + 1)) {
        found.push({ ...w, otherRepo: w.otherRepo || envRepo, ...(around[i].staged && { staged: true }) })
      }
    }
    const k = cliAt(words)
    if (k < 0) continue
    const cli = cliOf(words[k])
    const args = words.slice(k + 1)
    if (args.some((w, j) => w.literal && /^(?:-h|--help)$/.test(w.text) && !args[j - 1]?.text.startsWith('-'))) continue
    const pos: string[] = []
    const fields: Word[] = []
    let method = ''
    let input = false
    let unread = false
    let early = false
    let otherRepo = envRepo
    for (let i = 0; i < args.length; i++) {
      const a = args[i].text
      const api = pos[0] === 'api'
      const next = (): Word => args[++i] ?? { text: '', literal: true, quoted: false }
      const long = /^--([\w-]+)(?:=(.*))?$/s.exec(a)
      if (long) {
        const [, name, eq] = long
        const value = (): Word => (eq !== undefined ? { ...args[i], text: eq } : next())
        if (pos.length < 2 && name !== 'repo' && name !== 'version') early = true
        if (name === 'repo') {
          otherRepo = true
          value()
        } else if (api && name === 'method') method = value().text.toUpperCase()
        else if (api && /^(?:field|raw-field|form)$/.test(name)) fields.push(value())
        else if (api && name === 'input') {
          input = true
          value()
        } else if (api && /^(?:header|jq|template|hostname|preview|cache)$/.test(name)) value()
      } else if (/^-[^-]/.test(a)) {
        if (pos.length < 2 && !a.startsWith('-R')) early = true
        for (let x = 1; x < a.length; x++) {
          const f = a[x]
          if (f !== 'R' && !(api && 'XfFHqtp'.includes(f))) continue
          const v = x + 1 < a.length ? { ...args[i], text: a.slice(x + 1) } : next()
          if (f === 'R') otherRepo = true
          else if (f === 'X') method = v.text.toUpperCase()
          else if (f === 'f' || f === 'F') fields.push(v)
          break
        }
      } else {
        // A noun or verb that is not written out, such as `gh $cmd`, is a write.
        // An api call's second word is its endpoint, and its method is read on its own.
        if (!args[i].literal && (!pos.length || (pos.length === 1 && pos[0] !== 'api'))) unread = true
        pos.push(a)
      }
    }
    const [noun, verb] = pos
    let what = ''
    if (unread) what = `${cli} ${pos.slice(0, 2).join(' ')}`
    else if (early && noun !== 'api' && !LOCAL_NOUNS.has(noun ?? '')) what = [cli, noun].filter(Boolean).join(' ')
    else if (noun === 'api' && verb === 'graphql') {
      const query = fields.find(f => f.text.startsWith('query='))
      const text = query?.text.slice(6).trim() ?? ''
      if (input || !query?.literal || !/^(?:query\b|\{)/.test(text) || /\bmutation\b/.test(text)) what = `${cli} api graphql`
    } else if (noun === 'api') {
      const m = method || (fields.length || input ? 'POST' : 'GET')
      if (m !== 'GET' && m !== 'HEAD') what = `${cli} api ${m}`
    } else if (noun && verb && !LOCAL_NOUNS.has(noun) && !READ_VERBS.has(verb) && !(verb === 'clone' && (noun === 'repo' || noun === 'gist'))) what = `${cli} ${noun} ${verb}`
    const prCreate = !early && noun === PR_CREATE[cli] && (verb === 'create' || verb === 'new')
    if (what) found.push({ what, dir: repoDir(at, words.slice(0, k)), prCreate, otherRepo, pushes: prCreate && prPushes(cli, args), ...(around[i].staged && { staged: true }) })
  }
  return unique(found)
}
