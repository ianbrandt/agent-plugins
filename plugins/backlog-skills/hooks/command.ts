// The commit messages, PR titles, and PR bodies a shell command would send
// (design D7), read without running anything. writing-skills reads commands
// more fully, but the plugins stay independent, so this is a smaller copy.

export type Mode = 'bash' | 'pwsh'
// A part built from a variable or an expanding substitution is written as NUL,
// so `-m"$m"` still reads as a flag with a value attached.
type Word = { text: string; dynamic: boolean }
type Segment = { words: Word[]; stdin?: Word; from?: Segment }
// One git commit, gh pr create, or gh pr edit: its literal texts, the files it
// reads them from, and why any text was not read.
export type Sent = { what: string; dir?: string; texts: string[]; files: string[]; unread: string[] }

const DYN = '\0'

// `$(cat <<'EOF' … EOF)`, the form Claude Code writes a commit message in.
function catHeredoc(s: string, i: number): { word: Word; end: number } | undefined {
  const open = /\$\(\s*cat\s*<<(-?)[ \t]*(['"]?)([A-Za-z_][\w-]*)\2[ \t]*\r?\n/y
  open.lastIndex = i
  const m = open.exec(s)
  if (!m) return undefined
  const body = lines(s, open.lastIndex, m[3], m[1] === '-')
  if (!body) return undefined
  const close = /\s*\)/y
  close.lastIndex = body.end
  if (!close.test(s)) return undefined
  return { word: { text: body.text, dynamic: !m[2] && /[$`]/.test(body.text) }, end: close.lastIndex }
}

// A heredoc body from `i` up to the line that is `delim`.
function lines(s: string, i: number, delim: string, dash: boolean): { text: string; end: number } | undefined {
  let text = ''
  for (;;) {
    if (i >= s.length) return undefined
    const e = s.indexOf('\n', i) < 0 ? s.length : s.indexOf('\n', i)
    let line = s.slice(i, e).replace(/\r$/, '')
    if (dash) line = line.replace(/^\t+/, '')
    i = e + 1
    if (line === delim) return { text, end: Math.min(i, s.length) }
    text += line + '\n'
  }
}

// The index past the `)` that closes the `(` at k, or -1.
function closing(s: string, k: number): number {
  let depth = 0
  for (let i = k; i < s.length; i++) {
    const c = s[i]
    if (c === "'" || c === '"') { const e = s.indexOf(c, i + 1); if (e < 0) return -1; i = e }
    else if (c === '(') depth++
    else if (c === ')' && --depth === 0) return i + 1
  }
  return -1
}

// The command split into simple commands. undefined when a quote, a heredoc, or
// a substitution is left open.
function lex(s: string, mode: Mode): Segment[] | undefined {
  const pwsh = mode === 'pwsh'
  const segs: Segment[] = []
  let seg: Segment = { words: [] }
  let word: Word | undefined
  let piped: Segment | undefined
  let redirect = false
  let herestr = false
  const pending: { seg: Segment; delim: string; quoted: boolean; dash: boolean }[] = []
  const add = (t: string, dyn = false) => { word ??= { text: '', dynamic: false }; word.text += dyn ? DYN : t; word.dynamic ||= dyn }
  const endWord = () => {
    if (!word) return
    if (herestr) seg.stdin = word
    else if (!redirect) seg.words.push(word)
    redirect = herestr = false
    word = undefined
  }
  const endSeg = (pipe: boolean) => {
    endWord()
    if (seg.words.length) { seg.from = piped; segs.push(seg); piped = pipe ? seg : undefined }
    seg = { words: [] }
  }
  // `$` at i: a substitution or a variable, or a literal `$`. Returns the index after it.
  const dollar = (i: number): number => {
    const n = s[i + 1]
    if (n === '(') {
      const cat = pwsh ? undefined : catHeredoc(s, i)
      if (cat) { add(cat.word.text, cat.word.dynamic); return cat.end }
      const e = closing(s, i + 1)
      if (e < 0) return -1
      add('', true)
      return e
    }
    if (n === '{') { const e = s.indexOf('}', i); if (e < 0) return -1; add('', true); return e + 1 }
    const name = (pwsh ? /[A-Za-z0-9_:?]+/y : /[A-Za-z_][A-Za-z0-9_]*|[0-9?#@*!$-]/y)
    name.lastIndex = i + 1
    if (name.test(s)) { add('', true); return name.lastIndex }
    add('$')
    return i + 1
  }

  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === '\n') {
      endSeg(false)
      i++
      for (const h of pending.splice(0)) {
        const body = lines(s, i, h.delim, h.dash)
        if (!body) return undefined
        h.seg.stdin = { text: body.text, dynamic: !h.quoted && /[$`]/.test(body.text) }
        i = body.end
      }
      continue
    }
    if (c === ' ' || c === '\t' || c === '\r') { endWord(); i++; continue }
    if (c === '#' && !word) { const e = s.indexOf('\n', i); i = e < 0 ? s.length : e; continue }
    if (pwsh && s.startsWith('<#', i)) { const e = s.indexOf('#>', i); if (e < 0) return undefined; i = e + 2; continue }
    if (c === ';' || c === '(' || c === ')' || (pwsh && (c === '{' || c === '}'))) { endSeg(false); i++; continue }
    if (c === '|') { const two = s[i + 1] === '|'; endSeg(!two); i += two ? 2 : 1; continue }
    if (c === '&' && s[i + 1] !== '>') { endSeg(false); i += s[i + 1] === '&' ? 2 : 1; continue }
    if (!pwsh && s.startsWith('<<<', i)) { endWord(); herestr = true; i += 3; continue }
    if (!pwsh && s.startsWith('<<', i)) {
      const m = /<<(-?)[ \t]*(['"]?)([^\s'";&|()<>]+)\2/y
      m.lastIndex = i
      const h = m.exec(s)
      if (!h) return undefined
      endWord()
      pending.push({ seg, delim: h[3], quoted: !!h[2], dash: !!h[1] })
      i = m.lastIndex
      continue
    }
    if (!pwsh && (c === '<' || c === '>') && s[i + 1] === '(') {
      const e = closing(s, i + 1)
      if (e < 0) return undefined
      add('', true)
      i = e
      continue
    }
    if (c === '<' || c === '>' || (c === '&' && s[i + 1] === '>')) {
      // A redirection: its target is dropped.
      endWord()
      i += /^[&<>]*/.exec(s.slice(i))![0].length
      redirect = true
      continue
    }
    if (c === "'") {
      let j = i + 1
      let text = ''
      for (;;) {
        const e = s.indexOf("'", j)
        if (e < 0) return undefined
        text += s.slice(j, e)
        if (pwsh && s[e + 1] === "'") { text += "'"; j = e + 2; continue }
        j = e + 1
        break
      }
      add(text)
      i = j
      continue
    }
    if (pwsh && c === '@' && (s[i + 1] === "'" || s[i + 1] === '"') && /^[ \t]*\r?\n/.test(s.slice(i + 2))) {
      const q = s[i + 1]
      const start = s.indexOf('\n', i) + 1
      const end = s.slice(start).search(new RegExp(`(^|\\n)${q}@`))
      if (end < 0) return undefined
      const text = s.slice(start, start + end).replace(/\r$/, '')
      add(text, q === '"' && /[$`]/.test(text))
      i = start + end + (end === 0 ? 2 : 3)
      continue
    }
    if (!pwsh && c === '$' && s[i + 1] === "'") {
      let j = i + 2
      let text = ''
      const esc: Record<string, string> = { n: '\n', t: '\t', r: '\r' }
      for (; j < s.length && s[j] !== "'"; j++) text += s[j] === '\\' ? (esc[s[++j]] ?? s[j]) : s[j]
      if (j >= s.length) return undefined
      add(text)
      i = j + 1
      continue
    }
    if (c === '"') {
      let j = i + 1
      add('')
      for (;;) {
        if (j >= s.length) return undefined
        const d = s[j]
        if (d === '"') {
          if (pwsh && s[j + 1] === '"') { add('"'); j += 2; continue }
          j++
          break
        }
        if (!pwsh && d === '\\' && '$`"\\\n'.includes(s[j + 1])) { if (s[j + 1] !== '\n') add(s[j + 1]); j += 2; continue }
        if (pwsh && d === '`') { const n = s[j + 1]; add(n === 'n' ? '\n' : n === 't' ? '\t' : n); j += 2; continue }
        if (!pwsh && d === '`') { const e = s.indexOf('`', j + 1); if (e < 0) return undefined; add('', true); j = e + 1; continue }
        if (d === '$') { j = dollar(j); if (j < 0) return undefined; continue }
        add(d)
        j++
      }
      i = j
      continue
    }
    if (c === '$') { i = dollar(i); if (i < 0) return undefined; continue }
    if (!pwsh && c === '`') { const e = s.indexOf('`', i + 1); if (e < 0) return undefined; add('', true); i = e + 1; continue }
    if (c === (pwsh ? '`' : '\\')) { if (s[i + 1] !== '\n') add(s[i + 1] ?? ''); i += 2; continue }
    add(c)
    i++
  }
  if (pending.length) return undefined
  endSeg(false)
  return segs
}

// A path from `dir`, or undefined where the directory is not known.
function join(dir: string | undefined, p: string): string | undefined {
  if (/^([A-Za-z]:)?[\\/]/.test(p)) return p.replace(/\\/g, '/')
  if (dir === undefined || p.startsWith('~')) return undefined
  const out: string[] = []
  for (const part of `${dir}/${p}`.replace(/\\/g, '/').split('/')) {
    if (part === '..') out.pop()
    else if (part !== '.' && (part !== '' || !out.length)) out.push(part)
  }
  return out.join('/')
}

const LEAD = new Set(['!', '{', '}', 'if', 'then', 'elif', 'else', 'do', 'while', 'until', 'time', 'env', 'command', 'exec', 'nohup', 'sudo'])
const CD = new Set(['cd', 'pushd', 'chdir', 'set-location', 'sl', 'push-location'])
const name = (w: Word | undefined) => (w && !w.dynamic ? w.text.replace(/\\/g, '/').split('/').pop()!.toLowerCase().replace(/\.exe$/, '') : '')
// git's global options and git commit's long options that take the next word as their value.
const GIT_GLOBAL = new Set(['-c', '--git-dir', '--work-tree', '--namespace', '--config-env', '--exec-path'])
const COMMIT_LONG = new Set(['--author', '--date', '--cleanup', '--template', '--trailer', '--squash', '--pathspec-from-file', '--reedit-message'])
// From gh pr create --help and gh pr edit --help: the flags that take a value.
const GH_LONG = new Set(['--assignee', '--base', '--head', '--label', '--milestone', '--project', '--reviewer', '--template', '--repo', '--add-assignee',
  '--add-label', '--add-project', '--add-reviewer', '--remove-assignee', '--remove-label', '--remove-project', '--remove-reviewer'])

// What stdin is for a segment: its heredoc or here-string, or the text an echo,
// printf, cat of a heredoc, or (in PowerShell) a lone string pipes into it.
function stdinOf(seg: Segment, pwsh: boolean): Word | undefined {
  if (seg.stdin) return seg.stdin
  const p = seg.from
  if (!p) return undefined
  const n = name(p.words[0])
  if (n === 'cat' && p.words.length === 1) return stdinOf(p, pwsh)
  if (pwsh && p.words.length === 1) return p.words[0]
  if (['echo', 'printf', 'write-output'].includes(n)) {
    const ws = p.words.slice(1).filter(w => !/^-[a-zA-Z]+$/.test(w.text))
    return { text: ws.map(w => w.text).join(' '), dynamic: ws.some(w => w.dynamic) }
  }
  return undefined
}

export function sent(cmd: string, mode: Mode, cwd: string | undefined): Sent[] {
  const segs = lex(cmd, mode)
  if (!segs) {
    return /\bgit\b[\s\S]*\bcommit\b|\bgh\s+pr\s+(create|edit)\b/.test(cmd)
      ? [{ what: 'the command', texts: [], files: [], unread: ['the command could not be split into words'] }]
      : []
  }
  const found: Sent[] = []
  let dir = cwd?.replace(/\\/g, '/')
  for (const seg of segs) {
    let ws = seg.words
    while (ws.length && !ws[0].dynamic && (LEAD.has(ws[0].text) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(ws[0].text))) ws = ws.slice(1)
    const n = name(ws[0])
    if (CD.has(n)) {
      const to = ws.slice(1).find(w => !/^-/.test(w.text))
      dir = to && !to.dynamic ? join(dir, to.text) : undefined
      continue
    }
    const out: Sent = { what: '', dir, texts: [], files: [], unread: [] }
    const text = (w: Word | undefined) => {
      if (!w) return
      if (w.dynamic) out.unread.push('a value is built from a variable or a substitution')
      else out.texts.push(w.text)
    }
    const file = (w: Word | undefined) => {
      if (!w) return
      if (w.text === '-' || w.text === '/dev/stdin') {
        const input = stdinOf(seg, mode === 'pwsh')
        if (input) text(input)
        else out.unread.push('the text is read from stdin')
      } else if (w.dynamic) out.unread.push('a file name is built from a variable or a substitution')
      else {
        const p = join(out.dir, w.text)
        if (p) out.files.push(p)
        else out.unread.push(`the directory of ${w.text} is not known`)
      }
    }
    let j = 1
    if (n === 'git') {
      for (; j < ws.length && ws[j].text.startsWith('-'); j++) {
        if (ws[j].text === '-C') { out.dir = ws[j + 1] && !ws[j + 1].dynamic ? join(out.dir, ws[j + 1].text) : undefined; j++ }
        else if (GIT_GLOBAL.has(ws[j].text)) j++
      }
      if (ws[j]?.text !== 'commit') continue
      out.what = 'the commit message'
      let message = false
      for (j++; j < ws.length; j++) {
        const t = ws[j].text
        if (t === '--') break
        if (t.startsWith('--')) {
          const [flag, ...rest] = t.split('=')
          const value = () => (rest.length ? { text: rest.join('='), dynamic: ws[j].dynamic } : ws[++j])
          if (flag === '--message') { text(value()); message = true }
          else if (flag === '--file') { file(value()); message = true }
          else if (flag === '--reuse-message' || flag === '--fixup') { value(); message = true }
          else if (flag === '--no-edit') message = true
          else if (COMMIT_LONG.has(flag) && !rest.length) j++
          continue
        }
        if (!t.startsWith('-')) continue
        for (let k = 1; k < t.length; k++) {
          const c = t[k]
          if ('Su'.includes(c)) break
          if (!'mFCct'.includes(c)) continue
          const v = t.slice(k + 1) ? { text: t.slice(k + 1), dynamic: ws[j].dynamic } : ws[++j]
          if (c === 'm') text(v)
          else if (c === 'F') file(v)
          if ('mFC'.includes(c)) message = true
          break
        }
      }
      if (!message) out.unread.push('the message comes from an editor')
    } else if (n === 'gh' && ws[1]?.text === 'pr' && (ws[2]?.text === 'create' || ws[2]?.text === 'edit')) {
      out.what = 'the PR title and body'
      const short = ws[2].text === 'create' ? 'aBbFHlmprTtR' : 'BbFmtR'
      for (j = 3; j < ws.length; j++) {
        const t = ws[j].text
        if (t === '--') break
        if (t.startsWith('--')) {
          const [flag, ...rest] = t.split('=')
          const value = () => (rest.length ? { text: rest.join('='), dynamic: ws[j].dynamic } : ws[++j])
          if (flag === '--title' || flag === '--body') text(value())
          else if (flag === '--body-file') file(value())
          else if (GH_LONG.has(flag) && !rest.length) j++
          continue
        }
        if (!t.startsWith('-')) continue
        for (let k = 1; k < t.length; k++) {
          const c = t[k]
          if (!short.includes(c)) continue
          // gh drops the "=" in -t=Title.
          const v = t.slice(k + 1) ? { text: t.slice(k + 1).replace(/^=/, ''), dynamic: ws[j].dynamic } : ws[++j]
          if (c === 't' || c === 'b') text(v)
          else if (c === 'F') file(v)
          break
        }
      }
    } else continue
    found.push(out)
  }
  return found
}
