// A shell command split into the keys that are looked up to find whether the
// command can publish, with no command name written down here, and the walk of
// those keys through the classifier cache. All three were ported from awk
// scripts function for function, and keys.test.ts has the fixture they are
// checked against. The module has no imports, since it runs where function
// hooks do.
//
// keys() returns one line per entry, <segment number><TAB><entry>, where a
// segment is one simple command. An entry is one of:
//   git commit      a key: the first word, then up to two subcommand candidates
//   git ?           a word at that depth under "git" that cannot be read as a name
//   +make check     a task name under "make", read only when "make" is a PROJECT
//   +make ?         a task word under "make" that cannot be read as a name
//   +make !         more than 8 task names under "make"
//   READ            the segment, or the whole command as segment 1, is reviewed
//                   with no lookup
// A segment with no command in it has no lines. One more line, 0<TAB>PROSE,
// comes first when there is a sentence in the command: a capitalized word, at
// least four more words, and a last word ending in ".", "!", or "?". Words are
// separated by spaces, tabs, or a \n, \t, `n, or `t escape, since a script
// writes a line break into its text that way, and a word may be quoted. The gate
// reads a RUNS_CODE command, an interpreter or curl, only with that line.
//
// bodyFiles() returns one line per operand of a body-file flag in a git commit
// or a gh pr, issue, or release command, <cd><TAB><operand>, where <cd> is 1
// when the command may run it in another directory than the one it starts in:
// git -C, or cd and the like anywhere in the command. The flags are written down
// here, per command, because a word is an operand only when no earlier flag
// takes it as its value. An operand of "-" is stdin, which is the heredoc
// already in the command, and is left out. For a command that cannot be split
// the result is 1<TAB>"" when it has a body-file flag, so that it is reported at
// the gate.
//
// The rules are a character loop with no grammar. The text is read twice. Pass 1
// drops heredoc bodies and turns a quoted span into its content, or into the
// placeholder "" when the content has whitespace or a separator in it, then
// splits on separators. Pass 2 drops single-quoted spans and heredoc bodies but
// keeps double-quoted ones, finds each $( ) and backtick substitution in what is
// left, and reads each one's body as pass 1 does. That is how
// `grep "$(gh issue comment 1 --body x)"` yields the gh command even though
// pass 1 turned the quoted text into "".
//
// Positions in a string count from 0. A list of words counts from 1, with
// nothing at 0.

export type Mode = 'bash' | 'pwsh'

const words = (list: string) => new Set(list.split(' '))
const SHELLWORD = words('! if then elif else fi do done while until time esac { }')
// Wrappers that run the command after them: the first set takes only flags, and
// the second one operand too, as in `timeout 60 hg commit`.
const WRAPPER = words('env sudo doas nice nohup exec command builtin setsid stdbuf setarch unbuffer catchsegv')
const WRAPPER1 = words('timeout flock chrt taskset')
const HEADER = words('for case select in')

const REDIR = /^[0-9]*[<>]/
const REDIR_ALONE = /^[0-9]*[<>]+$/
const NAME = /^[A-Za-z:][A-Za-z0-9_:.-]*$/
const PAREN = /[()]/g
const BODY_FLAG = /(^|[ \t])(-[A-Za-z]*F|--(body-|notes-)?file)/

// The sentence that adds the PROSE line. As one expression it is
//   (^|[^A-Za-z0-9_]|[\\`][nt])[A-Z][a-z'-]* q [,;:]? w w w w (w)* gap q [A-Za-z][A-Za-z'-]*[.!?]
// with w = gap q [A-Za-z][A-Za-z'-]* q [,;:]?. A backtracking engine can take
// exponential time on that, since a "'" after a word is both a letter of the
// word and the quote q. So it is read a word at a time, each piece anchored
// where the last one ended.
const GAP = '(?:[ \\t]|[\\\\`][nt])+'
const Q = '(?:[\\\\`]?["\'])?'
const FIRST = new RegExp("[A-Z][a-z'-]*" + Q + '[,;:]?', 'y')
const WORD = new RegExp(GAP + Q + "[A-Za-z][A-Za-z'-]*" + Q + '[,;:]?', 'y')
const LAST = new RegExp(GAP + Q + "[A-Za-z][A-Za-z'-]*[.!?]", 'y')

// prose(s): whether s has that sentence in it. A capital inside a run of words
// already read starts no new run: the words after it are the same ones, and
// there are fewer of them.
function prose(s: string): boolean {
  const capital = /[A-Z]/g
  let from = 0
  for (;;) {
    const p = nextat(s, from, capital)
    if (p >= s.length) return false
    from = p + 1
    if (p > 0 && /[A-Za-z0-9_]/.test(s[p - 1]) && !(p > 1 && 'nt'.includes(s[p - 1]) && '\\`'.includes(s[p - 2]))) continue
    FIRST.lastIndex = p
    FIRST.test(s)
    let pos = FIRST.lastIndex
    for (let count = 0; ; count++) {
      if (count >= 4) {
        LAST.lastIndex = pos
        if (LAST.test(s)) return true
      }
      WORD.lastIndex = pos
      if (!WORD.test(s)) break
      pos = WORD.lastIndex
    }
    from = pos
  }
}

// nextat(s, j, re): the position of the first match of re at or after j, or the
// length of s. A regular expression here has the `g` flag.
function nextat(s: string, j: number, re: RegExp | string): number {
  if (typeof re === 'string') {
    const k = s.indexOf(re, j)
    return k < 0 ? s.length : k
  }
  re.lastIndex = j
  const m = re.exec(s)
  return m ? m.index : s.length
}

// here(s, i): whether a PowerShell here-string opens at i, an @ and a quote with
// nothing but whitespace after them on the line.
function here(s: string, i: number): boolean {
  if (s[i] !== '@') return false
  if (s[i + 1] !== '"' && s[i + 1] !== "'") return false
  return /^[ \t\r]*$/.test(s.slice(i + 2, nextat(s, i + 2, '\n')))
}

// Pass 1's view of a quoted span.
function quoted1(content: string): string {
  return content === '' || /[ \t\n;&|(){}<>`]/.test(content) ? '""' : content
}

function unreadable(x: string): boolean {
  return x === '""' || /[$`*?[]/.test(x)
}

// cands(w, m, from): the subcommand candidates in words from..m, each with its
// position. A word is a candidate position while every word before it is a flag,
// a redirection, or a word directly after a flag with no "=", which may be that
// flag's value. The candidate for a word that cannot be read as a name is "?".
// Directly after such a flag it is "?" only when no name is found at this depth:
// `git -C "$WT" status` has a subcommand, and `hg -v "$verb"` does not.
function cands(w: string[], m: number, from: number): [string, number][] {
  const found: [string, number][] = []
  let prevflag = false
  let j = from
  let held = 0
  let named = false
  while (j <= m) {
    const x = w[j]
    if (x.startsWith('-')) { prevflag = !x.includes('='); j++; continue }
    if (REDIR.test(x)) { j += REDIR_ALONE.test(x) ? 2 : 1; prevflag = false; continue }
    if (NAME.test(x)) { found.push([x, j]); named = true }
    else if (unreadable(x)) {
      if (!prevflag) found.push(['?', j])
      else if (!held) held = j
    }
    if (!prevflag) break
    prevflag = false; j++
  }
  if (held && !named) found.push(['?', held])
  return found
}

function extract(src: string, mode: Mode, files: boolean): string[] {
  const pwsh = mode === 'pwsh'
  const esc = pwsh ? '`' : '\\'
  const sepchars = pwsh ? '\n;&|()' : '\n;&|()`'
  // The characters scan() stops at.
  const special = pwsh ? /[\n`#'"@]/g : /[\n\\#'"<]/g
  // A first word must be made of these, and in PowerShell a path may use "\".
  const namechars = pwsh ? /^[A-Za-z0-9._+:/$\\-]+$/ : /^[A-Za-z0-9._+:/$-]+$/
  const inquotes = pwsh ? /["`]/g : /["\\]/g
  const separator = pwsh ? /[\n;&|(){}]/g : /[\n;&|(){}`]/g
  const opens1 = pwsh ? /[$@]\(/g : /[$<>]\(|`/g
  const opens2 = pwsh ? /\$\(/g : /[$<>]\(|`/g

  // What the functions below share: the two passes' text, whether the command
  // cannot be split, the segments' entries, and in files mode the operands, each
  // with whether its command runs elsewhere.
  let P1 = ''
  let P2 = ''
  let bad = false
  let nseg = 0
  const segtext: string[] = []
  let SEGWT = false
  let CHDIR = false
  const BF: string[] = []
  const BC: boolean[] = []
  let emitted = new Set<string>()

  // scan(s): set P1 and P2 for the text s, and set bad when a quote, a heredoc,
  // or a here-string is left open, or when an expanding heredoc body has a
  // substitution in it. A quoted heredoc body, like single-quoted text, expands
  // nothing.
  function scan(s: string): void {
    P1 = ''; P2 = ''
    const n = s.length
    let i = 0
    let atword = true
    let pend: { pwsh: boolean; word: string; quoted: boolean; dash: boolean }[] = []
    while (i < n) {
      const c = s[i]
      if (c === '\n') {
        P1 += c; P2 += c; i++; atword = true
        // The bodies of the heredocs opened on the line just ended.
        for (const h of pend) {
          for (;;) {
            if (i >= n) { bad = true; return }
            const e = nextat(s, i, '\n')
            let line = s.slice(i, e)
            i = e + 1
            if (h.pwsh) {
              if (line.slice(0, 2) === h.word + '@') break
            } else {
              if (h.dash) line = line.replace(/^\t+/, '')
              if (line === h.word) break
            }
            if (!h.quoted && (line.includes('$(') || (!pwsh && line.includes('`')))) { bad = true; return }
          }
        }
        pend = []
        continue
      }
      if (c === esc) {
        const d = s.charAt(i + 1)
        i += 2
        if (d === '\n') { P1 += ' '; P2 += ' ' }
        else if (d !== '') { const e = escaped(d); P1 += e; P2 += '$`\\"\''.includes(d) ? '_' : e }
        atword = false; continue
      }
      if (c === '#' && atword) { i = nextat(s, i, '\n'); continue }
      if (c === "'") {
        let content = ''
        let j = i + 1
        let start = j
        for (;;) {
          j = nextat(s, j, "'")
          if (j >= n) { bad = true; return }
          if (pwsh && s[j + 1] === "'") { content += s.slice(start, j + 1); j += 2; start = j; continue }
          break
        }
        content += s.slice(start, j)
        P1 += quoted1(content); i = j + 1; atword = false; continue
      }
      if (c === '"') {
        let content = ''
        let p2c = ''
        let j = i + 1
        let start = j
        for (;;) {
          j = nextat(s, j, inquotes)
          if (j >= n) { bad = true; return }
          const d = s[j]
          if (d === esc) {
            // At the end of the text e is "", which reads as an escape too, and
            // the next search finds no quote.
            const e = s.charAt(j + 1)
            if (pwsh || '$`"\\\n'.includes(e)) {
              const run = s.slice(start, j)
              // The awk script counted bytes, so its "_" stood for the first byte of a
              // character outside ASCII and the other bytes stayed in pass 2,
              // where a word with one in it does not read as a name. Each of
              // those bytes is U+FFFD here, so that a command with such a word
              // is still reviewed.
              const cp = s.codePointAt(j + 1) ?? 0
              const wide = cp > 0xffff ? 1 : 0
              content += run + (e === '\n' ? '' : s.slice(j + 1, j + 2 + wide))
              p2c += run + '_' + '\ufffd'.repeat(cp < 0x80 ? 0 : cp < 0x800 ? 1 : 2 + wide)
              j += 2 + wide; start = j; continue
            }
          }
          if (d === '"') {
            if (pwsh && s[j + 1] === '"') {
              const run = s.slice(start, j)
              content += run + '"'; p2c += run + '_'
              j += 2; start = j; continue
            }
            break
          }
          j++
        }
        const run = s.slice(start, j)
        content += run; p2c += run
        P1 += quoted1(content); P2 += '"' + p2c + '"'; i = j + 1; atword = false; continue
      }
      if (!pwsh && s.startsWith('<<', i) && !s.startsWith('<<<', i)) {
        let j = i + 2
        let dash = false
        if (s[j] === '-') { dash = true; j++ }
        while (s[j] === ' ' || s[j] === '\t') j++
        let w = ''
        let quoted = false
        while (j < n) {
          const d = s[j]
          if (' \t\n;&|()<>'.includes(d)) break
          if (d === "'" || d === '"' || d === '\\') quoted = true
          else w += d
          j++
        }
        if (w !== '') {
          pend.push({ pwsh: false, word: w, quoted, dash })
          P1 += '<<' + w; P2 += ' '; i = j; atword = false; continue
        }
      }
      if (pwsh && here(s, i)) {
        const d = s[i + 1]
        pend.push({ pwsh: true, word: d, quoted: d === "'", dash: false })
        P1 += '""'; P2 += '""'; i += 2; atword = false; continue
      }
      // Anything else, up to the next character one of the branches above reads.
      const j = nextat(s, i + 1, special)
      const run = s.slice(i, j)
      P1 += run; P2 += run; i = j
      atword = ' \t;&|()'.includes(run[run.length - 1])
    }
    if (pend.length) bad = true
  }

  // An escaped character outside quotes is literal: whitespace, a separator, or
  // a quote becomes "_" so that it neither splits nor quotes anything, and "*"
  // in files mode, so that a body-file path with one in it reads as no literal
  // path.
  function escaped(d: string): string {
    return ' \t;&|(){}<>\'"`#$\\'.includes(d) ? (files ? '*' : '_') : d
  }

  // Files mode, for one simple command: add the operand of its body-file flag to
  // BF, with BC set where git -C, --work-tree, or GIT_WORK_TREE runs the command
  // elsewhere, or set CHDIR when the command changes directory. git and gh each
  // read only the last such flag. A flag that is not written down here takes no
  // value, and in a cluster of one-letter flags, a letter that takes a value
  // takes the rest of the word or, when there is none, the next word. git's -S
  // and -u take only a value in the same word.
  function bodyfiles(w: string[], m: number): void {
    if (/^(cd|chdir|pushd|popd|sl|set-location|push-location|pop-location)$/.test(w[1].toLowerCase())) { CHDIR = true; return }
    let cwd = SEGWT
    let opt = ''
    let eq = false
    let found = false
    let last = ''
    let j: number
    let vshort: string
    let vlong: string
    let bflag: string
    if (w[1] === 'git') {
      for (j = 2; j <= m && w[j].startsWith('-'); j++) {
        if (w[j] === '-C' || /^--work-tree(=|$)/.test(w[j])) cwd = true
        if (/^(-C|-c|--git-dir|--work-tree|--namespace|--config-env|--attr-source)$/.test(w[j])) j++
      }
      if (j > m || w[j] !== 'commit') return
      vshort = 'mFCct'; opt = 'Su'
      vlong = ' --message --file --reuse-message --reedit-message --fixup --squash --author --date --cleanup --template --trailer --pathspec-from-file '
      // git takes an unambiguous prefix of a long flag, and --fi is ambiguous.
      bflag = ' --file --fil '
    } else if (w[1] === 'gh' && m >= 3 && /^(pr|issue|release)$/.test(w[2]) && /^[a-z]/.test(w[3])) {
      j = 3; eq = true
      // From `gh <noun> <verb> --help`, gh 2.101, for every verb with a body
      // flag, and -R, --repo, on all of them.
      const v = w[2] + ' ' + w[3]
      vshort = v === 'pr create' ? 'aBbFHlmprTt' : v === 'pr edit' ? 'BbFmt' : v === 'pr merge' ? 'AbFt'
        : v === 'pr revert' ? 'bFt' : v === 'issue create' ? 'abFlmpTt' : v === 'issue edit' ? 'bFmt'
        : w[2] === 'release' ? 'nFt' : 'bF'
      vshort += 'R'
      vlong = ' --add-assignee --add-blocked-by --add-blocking --add-label --add-project --add-reviewer --add-sub-issue --assignee --attach --author-email --base --blocked-by --blocking --body --body-file --discussion-category --head --label --match-head-commit --milestone --notes --notes-file --notes-start-tag --parent --project --recover --remove-assignee --remove-blocked-by --remove-blocking --remove-label --remove-project --remove-reviewer --remove-sub-issue --repo --reviewer --subject --tag --target --template --title --type '
      bflag = ' --body-file --notes-file '
    } else return
    for (j++; j <= m; j++) {
      const x = w[j]
      if (x === '--') break
      if (!/^-[^]/.test(x)) continue
      if (x.startsWith('--')) {
        const k = x.indexOf('=')
        const name = k < 0 ? x : x.slice(0, k)
        if (bflag.includes(' ' + name + ' ')) {
          if (k >= 0) { last = x.slice(k + 1); found = true }
          else if (j < m) { last = w[++j]; found = true }
        } else if (k < 0 && vlong.includes(' ' + x + ' ')) j++
        continue
      }
      for (let k = 1; k < x.length; k++) {
        const c = x[k]
        if (opt.includes(c)) break
        if (!vshort.includes(c)) continue
        let rest = x.slice(k + 1)
        // gh drops the "=" in -F=file, but git keeps it as part of the name.
        if (c === 'F') {
          if (rest !== '') { if (eq) rest = rest.replace(/^=/, ''); last = rest; found = true }
          else if (j < m) { last = w[++j]; found = true }
        } else if (rest === '') j++
        break
      }
    }
    if (found) addbody(last, cwd)
  }

  function addbody(op: string, cwd: boolean): void {
    if (op === '-' || op === '') return
    BF.push(op); BC.push(cwd)
  }

  // Pass 2: each $( ) body, counting nested parentheses, and in bash each
  // backtick pair. The scan steps into a $( ) body rather than past it, which is
  // how a nested substitution is found.
  function subst(t: string): void {
    const n = t.length
    let i = 0
    for (;;) {
      i = nextat(t, i, opens2)
      if (i >= n) return
      // $(( )) is arithmetic, with no command in it but a nested $( ).
      if (t.startsWith('$((', i)) { i += 3; continue }
      if (t[i] === '`') {
        const j = nextat(t, i + 1, '`')
        if (j >= n) { bad = true; return }
        body(t.slice(i + 1, j))
        if (bad) return
        i = j + 1; continue
      }
      let depth = 1
      let j = i + 2
      while (depth > 0) {
        j = nextat(t, j, PAREN)
        if (j >= n) { bad = true; return }
        depth += t[j] === '(' ? 1 : -1
        j++
      }
      body(t.slice(i + 2, j - 1))
      if (bad) return
      i += 2
    }
  }

  // Pass 1 reads a substitution, $( ) or a backtick pair, as the one word "$",
  // and in bash a process substitution, <( ) or >( ), too. Pass 2 reads its
  // body, and the words after its ")" stay with the command around it:
  // `git diff $(git merge-base a b) HEAD` has no command named HEAD.
  function collapse(t: string): string {
    const n = t.length
    let i = 0
    let out = ''
    for (;;) {
      const j = nextat(t, i, opens1)
      out += t.slice(i, j)
      if (j >= n) return out
      if (t[j] === '`') {
        const k = nextat(t, j + 1, '`')
        if (k >= n) { bad = true; return out }
        out += '$'; i = k + 1; continue
      }
      let depth = 1
      let k = j + 2
      while (depth > 0) {
        k = nextat(t, k, PAREN)
        if (k >= n) { bad = true; return out }
        depth += t[k] === '(' ? 1 : -1
        k++
      }
      out += '$'; i = k
    }
  }

  function body(b: string): void {
    const keep1 = P1
    const keep2 = P2
    scan(b)
    if (!bad) addsegments(collapse(P1))
    P1 = keep1; P2 = keep2
  }

  // Split pass-1 text into segments on the separators. The redirections 2>&1,
  // >&2, and &> are blanked first so that their & does not split. { and } split
  // only as words of their own, so ${HOME} and x.{a,b} stay whole.
  function addsegments(t: string): void {
    // What is blanked is /[0-9]*[<>]&[0-9-]*/. A run of digits is matched whole
    // either way, so that a long number is read once.
    t = t.replace(/[<>]&[0-9-]*|[0-9]+(?:[<>]&[0-9-]*)?/g, r => (r.includes('&') ? ' ' : r)).replace(/&>/g, ' >')
    const n = t.length
    let cur = ''
    let i = 0
    for (;;) {
      const j = nextat(t, i, separator)
      cur += t.slice(i, j)
      if (j >= n) break
      const c = t[j]
      if (c === '{' || c === '}') {
        const prev = j > 0 ? t[j - 1] : ' '
        const next1 = j < n - 1 ? t[j + 1] : ' '
        if (!(' \t' + sepchars).includes(prev) || !(' \t' + sepchars).includes(next1)) { cur += c; i = j + 1; continue }
      }
      segment(cur); cur = ''; i = j + 1
    }
    segment(cur)
  }

  // One simple command: drop the leading words that are shell syntax, then build
  // its entries into segtext.
  function segment(text: string): void {
    const split = text.split(/[ \t\r]+/)
    if (split.length && split[0] === '') split.shift()
    if (split.length && split[split.length - 1] === '') split.pop()
    let w = [''].concat(split)
    let m = split.length
    let k = 1
    SEGWT = false
    while (k <= m) {
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[k])) { if (/^GIT_WORK_TREE=/.test(w[k])) SEGWT = true; k++; continue }
      if (REDIR.test(w[k])) { k += REDIR_ALONE.test(w[k]) ? 2 : 1; continue }
      if (SHELLWORD.has(w[k])) { k++; continue }
      if (WRAPPER.has(w[k])) { k++; while (k <= m && w[k].startsWith('-')) k++; continue }
      if (WRAPPER1.has(w[k])) { k++; while (k <= m && w[k].startsWith('-')) k++; if (k <= m) k++; continue }
      if (pwsh && w[k] === '.') { k++; continue }
      if (pwsh && /^\$[A-Za-z_][A-Za-z0-9_:]*([-+*/]?=[^]*)?$/.test(w[k])) {
        // $x = <expression>: a command when the expression starts with a name.
        if (w[k].includes('=')) {
          const rest = w[k].replace(/^[^=]*=/, '')
          if (rest === '') k++; else w[k] = rest
        } else if (k < m && /^[-+*/]?=/.test(w[k + 1])) {
          const rest = w[k + 1].replace(/^[^=]*=/, '')
          k++
          if (rest === '') k++; else w[k] = rest
        } else break
        if (k > m || /^([$@0-9-]|"")/.test(w[k])) return
        break
      }
      break
    }
    if (k > m || HEADER.has(w[k])) return
    w = [''].concat(w.slice(k))
    m = m - k + 1
    const first = w[1]
    if (files) bodyfiles(w, m)
    nseg++
    if (first === '""' || !(first === '[' || first === '[[' || namechars.test(first))) {
      segtext[nseg] = 'READ'; return
    }
    let e = ''
    emitted = new Set()
    const key = ['', first]
    const kpos = [0, 1]
    e = add(e, first)
    // Depth 2 under the first word, then depth 3 under each depth-2 candidate.
    let lo = 1
    let hi = 1
    for (let d = 2; d <= 3; d++) {
      let cnt = 0
      for (let x = lo; x <= hi; x++) {
        for (const [word, pos] of cands(w, m, kpos[x] + 1)) {
          if (word === '?') { e = add(e, key[x] + ' ?'); continue }
          cnt++
          key.push(key[x] + ' ' + word); kpos.push(pos)
          e = add(e, key[key.length - 1])
        }
      }
      if (cnt > 4) { segtext[nseg] = 'READ'; return }
      lo = hi + 1; hi = key.length - 1
    }
    // Task names under every key, for a key that turns out to be a PROJECT.
    for (let x = 1; x < key.length; x++) e = tasks(e, w, m, key[x], kpos[x] + 1)
    segtext[nseg] = e
  }

  // Every later word under key that reads as a name, flags and redirections
  // skipped, with the same "?" rule as cands().
  function tasks(e: string, w: string[], m: number, key: string, from: number): string {
    let n = 0
    let prevflag = false
    const list: string[] = []
    for (let j = from; j <= m; j++) {
      const x = w[j]
      if (x.startsWith('-')) { prevflag = !x.includes('='); continue }
      if (REDIR.test(x)) { if (REDIR_ALONE.test(x)) j++; prevflag = false; continue }
      if (NAME.test(x)) { n++; list.push('+' + key + ' ' + x) }
      else if (!prevflag && unreadable(x)) list.push('+' + key + ' ?')
      prevflag = false
    }
    if (n > 8) return add(e, '+' + key + ' !')
    for (const entry of list) e = add(e, entry)
    return e
  }

  // Append an entry once.
  function add(e: string, entry: string): string {
    if (emitted.has(entry)) return e
    emitted.add(entry)
    return e === '' ? entry : e + '\n' + entry
  }

  const out: string[] = []
  // The command is read as lines, so one newline at its end is not part of it.
  if (src.endsWith('\n')) src = src.slice(0, -1)
  if (!files && prose(src)) out.push('0\tPROSE')
  scan(src)
  if (!bad) {
    addsegments(collapse(P1))
    subst(P2)
  }
  if (files) {
    if (bad) return BODY_FLAG.test(src) ? ['1\t""'] : []
    const seenbf = new Set<string>()
    for (let i = 0; i < BF.length; i++) {
      if (seenbf.has(BF[i])) continue
      seenbf.add(BF[i])
      out.push((CHDIR || BC[i] ? 1 : 0) + '\t' + BF[i])
    }
    return out
  }
  if (bad) { out.push('1\tREAD'); return out }
  const seen = new Set<string>()
  let n = 0
  for (let s = 1; s <= nseg; s++) {
    if (seen.has(segtext[s])) continue
    seen.add(segtext[s])
    n++
    for (const entry of segtext[s].split('\n')) out.push(n + '\t' + entry)
  }
  return out
}

// keys(src, mode): the key lines of the command src, from the Bash tool or the
// PowerShell tool.
export function keys(src: string, mode: Mode): string[] {
  return extract(src, mode, false)
}

// bodyFiles(src, mode): the body-file lines of the same command.
export function bodyFiles(src: string, mode: Mode): string[] {
  return extract(src, mode, true)
}

// walk(keyLines, cacheLines, scope, final): whether a shell command is
// reviewed, from the classifier cache. keyLines is what keys() returned, and scope
// is the project directory. Each cache line is <scope><TAB><class><TAB><key>,
// where the scope is "*" for a key shared by every project or a project
// directory. For one key in one scope, CAN_PUBLISH wins over RUNS_CODE, PROJECT,
// and DESCEND, in that order, which all win over NEVER. A line in any other form
// is ignored.
//
// The result is READER, SAFE, or ASK followed by one line per key the cache has
// no answer for, ASK<TAB><scope><TAB><key>. With `final` a key with no answer
// reads as CAN_PUBLISH, so the result is READER or SAFE.
//
// A segment is walked from its first word. NEVER settles it; on CAN_PUBLISH
// the command is reviewed; on RUNS_CODE only when keys() found a sentence.
// DESCEND goes down to every subcommand candidate: none is safe, a "?" among
// them or a DESCEND at depth 3 is READER. PROJECT reads every task name
// below it, in the project's scope: none, a "?", a "!", or any task that is not
// NEVER is READER, so one safe task does not settle
// `make check publish`. A path as the first word, and every key below it, is in
// the project's scope as well.
const CNAME = ['', 'NEVER', 'DESCEND', 'PROJECT', 'RUNS_CODE', 'CAN_PUBLISH']
const SUBSEP = '\x1c'

export function walk(keyLines: string[], cacheLines: string[], scope: string, final = false): string[] {
  const best = new Map<string, number>()
  for (const line of cacheLines) {
    const f = line.split('\t')
    const r = CNAME.indexOf(f[1])
    if (f.length !== 3 || (f[0] !== '*' && f[0] !== scope) || r < 1) continue
    const k = f[0] + SUBSEP + f[2]
    if (r > (best.get(k) ?? 0)) best.set(k, r)
  }

  let nseg = 0
  let prose = false
  const ent = new Map<number, string[]>()
  for (const line of keyLines) {
    const f = line.split('\t')
    if (f[0] === '0') { if (f[1] === 'PROSE') prose = true; continue }
    const s = parseFloat(f[0]) || 0
    if (s > nseg) nseg = s
    if (!ent.has(s)) ent.set(s, [])
    ent.get(s)!.push(f[1] ?? '')
  }
  const entries = (s: number) => ent.get(s) ?? []
  const has = (s: number, e: string) => entries(s).includes(e)

  // The scope a key is looked up in: the project's for a task name or a path.
  function scopeof(key: string, task: boolean): string {
    if (task) return scope
    return /[/$\\]/.test(key.slice(0, nextat(key, 0, ' '))) ? scope : '*'
  }

  function cls(key: string, task: boolean): string {
    const r = best.get(scopeof(key, task) + SUBSEP + key)
    if (r) return CNAME[r]
    return final ? 'CAN_PUBLISH' : ''
  }

  // The walk of one key at depth d: READER, SAFE, or UNKNOWN.
  function node(s: number, key: string, d: number, task: boolean): string {
    const c = cls(key, task)
    if (c === '') return 'UNKNOWN'
    if (c === 'NEVER') return 'SAFE'
    if (c === 'CAN_PUBLISH' || task) return 'READER'
    if (c === 'RUNS_CODE') return prose ? 'READER' : 'SAFE'
    let res = 'SAFE'
    if (c === 'DESCEND') {
      if (d >= 3 || has(s, key + ' ?')) return 'READER'
      for (const e of entries(s)) {
        if (e.startsWith('+') || !child(e, key) || e === key + ' ?') continue
        const r = node(s, e, d + 1, false)
        if (r === 'READER') return r
        if (r === 'UNKNOWN') res = r
      }
      return res
    }
    // PROJECT
    if (has(s, '+' + key + ' ?') || has(s, '+' + key + ' !')) return 'READER'
    let kids = 0
    for (const e of entries(s)) {
      if (!e.startsWith('+') || !child(e.slice(1), key)) continue
      kids++
      const r = node(s, e.slice(1), d + 1, true)
      if (r === 'READER') return r
      if (r === 'UNKNOWN') res = r
    }
    return kids ? res : 'READER'
  }

  // Whether e is key and one more word.
  function child(e: string, key: string): boolean {
    return e.startsWith(key + ' ') && !e.includes(' ', key.length + 1)
  }

  // The keys of an unsettled segment with no answer in the cache, below a parent
  // that is itself unanswered or one that reads them: a DESCEND for a
  // subcommand, a PROJECT for a task name. A task runner is one or two words
  // (`make`, `npm run`), so a task name below a longer key is not asked about;
  // if that key is a PROJECT after all, its task names read as doubt.
  const asked: string[] = []
  const done = new Set<string>()
  function ask(s: number): void {
    for (const e of entries(s)) {
      const task = e.startsWith('+')
      const key = task ? e.slice(1) : e
      if (/ [?!]$/.test(key)) continue
      if (key.includes(' ')) {
        const parent = key.slice(0, key.lastIndexOf(' '))
        if (task && parent.split(/[ \t\n]+/).filter(x => x !== '').length > 2) continue
        const pc = cls(parent, false)
        if (pc !== '' && pc !== (task ? 'PROJECT' : 'DESCEND')) continue
      }
      if (cls(key, task) !== '') continue
      const id = scopeof(key, task) + SUBSEP + key
      if (done.has(id)) continue
      done.add(id)
      asked.push('ASK\t' + scopeof(key, task) + '\t' + key)
    }
  }

  const unknown: number[] = []
  for (let s = 1; s <= nseg; s++) {
    if (has(s, 'READ')) return ['READER']
    const r = node(s, entries(s)[0] ?? '', 1, false)
    if (r === 'READER') return ['READER']
    if (r === 'UNKNOWN') unknown.push(s)
  }
  for (const s of unknown) ask(s)
  return asked.length ? ['ASK', ...asked] : ['SAFE']
}
