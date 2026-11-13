// The gate's three text scanners, ported from awk scripts function for
// function. Pure: no files, no environment. Every line of a result ends in a
// newline.

// awk's records: a final line with no newline is still one, and a final
// newline adds none.
function records(text: string): string[] {
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

// awk's index(): the 1-based place of `t` in `s`, or 0. An empty `t` is found
// at 1 in any `s` but the empty one, where JavaScript finds it in both.
function index(s: string, t: string): number {
  return t === '' ? (s === '' ? 0 : 1) : s.indexOf(t) + 1
}

// awk's length() in macOS awk, which counts bytes of UTF-8 in every locale.
export function bytes(s: string): number {
  let n = 0
  for (const c of s) {
    const p = c.codePointAt(0)!
    n += p < 0x80 ? 1 : p < 0x800 ? 2 : p < 0x10000 ? 3 : 4
  }
  return n
}

// What a line does to the open fence, or undefined where it opens and closes
// nothing: the fence open after it, '' once closed, and whether a fence it opens
// is tagged `draft`. A closing marker is at least as long as the opening one, of
// the same character, with nothing after it.
export function fenceLine(line: string, fence: string): { fence: string; draft: boolean } | undefined {
  const marker = /^[ \t]*(`{3,}|~{3,})/.exec(line)
  if (!marker) return undefined
  const m = marker[1]
  const rest = line.slice(marker[0].length)
  if (fence === '') {
    // Inline code, as on a line that opens with ```draft``` and goes on.
    if (m[0] === '`' && rest.includes('`')) return undefined
    // the lookbehind keeps the scan of a long run of spaces to one pass
    const info = rest.replace(/^[ \t]+/, '').replace(/(?<![ \t\r])[ \t\r]+$/, '')
    return { fence: m, draft: info === 'draft' || /^draft[ \t]/.test(info) }
  }
  return m[0] === fence[0] && m.length >= fence.length && /^[ \t\r]*$/.test(rest) ? { fence: '', draft: false } : undefined
}

// drafts(reply): the fenced blocks tagged `draft` in a reply. The gate sends the
// blocks to the model, and the lint unwraps them so that they are still linted
// as prose.
//   drafts(reply)                    the text of each draft block, each followed
//                                    by a line that is only \x01, so that no
//                                    quote can match across two of them
//   drafts(reply, { unwrap: true })  the whole text with the opening and closing
//                                    fence lines of each draft block removed,
//                                    everything else unchanged
// A block opens on three or more backticks or tildes with `draft` as the info
// string, and closes on the first later fence of the same character that is at
// least as long and has nothing after it. A code fence inside a draft therefore
// has to be shorter or of the other character, which is the rule in rules.md.
// A block left open at the end runs to the end. An empty block is no draft.
//
// fenced() in lint.ts closes on a marker whatever follows it. The difference
// shows only on a line like "``` and more" inside a draft: here the draft runs
// past it, which is CommonMark's rule and means more text is reviewed, and after
// the unwrap that line opens a fence fenced() never closes, which it keeps as
// prose.
export function drafts(reply: string, options?: { unwrap?: boolean }): string {
  const unwrap = !!options?.unwrap
  let out = ''
  let fence = ''
  let draft = false
  let buf = ''
  const flush = () => {
    if (/[^ \t\r\n]/.test(buf)) out += `${buf}\x01\n`
    buf = ''
  }
  for (const line of records(reply)) {
    const step = fenceLine(line, fence)
    if (step) {
      fence = step.fence
      if (step.fence !== '') {
        draft = step.draft
        if (draft) { buf = ''; continue }
      } else if (draft) { draft = false; flush(); continue }
    }
    if (draft) { if (unwrap) out += `${line}\n`; else buf += `${line}\n`; continue }
    if (unwrap) out += `${line}\n`
  }
  if (draft && !unwrap) flush()
  return out
}

// excerpt(newText, fileText, cap): the whole paragraphs of an edited file that
// contain the text an Edit put there. A paragraph is bounded by blank lines. A
// one-word edit can make a violation that the word alone does not show, so the
// sentences around it are what gets reviewed, and the size of the excerpt
// follows the edit and not the file. The text is matched line by line, because
// new_string can span lines and paragraphs: its first line ends a line of the
// file, its last line starts one, and the lines between are equal. Printing
// stops soon after `cap` bytes; the caller cuts at the cap.
export function excerpt(newText: string, fileText: string, cap: number): string {
  const strip = (x: string) => x.replace(/\r$/, '')
  const want = records(newText).map(strip)
  // awk given an empty new_string file reads the edited file as the first one,
  // and prints nothing.
  if (want.length === 0) return ''
  const line = records(fileText).map(strip)
  const k = want.length
  const n = line.length
  const blank = (i: number) => /^[ \t]*$/.test(line[i])
  const ends = (s: string, t: string) => t === '' || s.endsWith(t)
  const hit = (i: number) => {
    if (k === 1) return index(line[i], want[0]) > 0
    if (!ends(line[i], want[0])) return false
    for (let j = 1; j < k - 1; j++) if (line[i + j] !== want[j]) return false
    return want[k - 1] === '' || index(line[i + k - 1], want[k - 1]) === 1
  }
  const keep = new Set<number>()
  for (let i = 0; i + k <= n; i++) {
    if (!hit(i)) continue
    let a = i
    while (a > 0 && !blank(a - 1)) a--
    let b = i + k - 1
    while (b < n - 1 && !blank(b + 1)) b++
    for (let j = a; j <= b; j++) keep.add(j)
  }
  let out = ''
  let size = 0
  let last = -1
  for (let i = 0; i < n && size <= cap; i++) {
    if (!keep.has(i)) continue
    if (last >= 0 && i > last + 1) out += '\n'
    out += `${line[i]}\n`
    size += bytes(line[i]) + 1
    last = i
  }
  return out
}

const squash = (t: string) => t.replace(/[ \t\r\n]+/g, ' ').replace(/^ /, '').replace(/ $/, '')
const WORDS = ['SKIP', 'PASS', 'VIOLATION', 'LOCAL']

// verdict(reply): the first line of a review model's reply that is a verdict
// word, or '' when there is none. Lines before it, such as reasoning or a code
// fence, are skipped, since reading only the first line let such a reply pass.
export function verdict(reply: string): string {
  return records(reply).map(squash).find(l => WORDS.includes(l)) ?? ''
}

// findings(reply, sources): the findings in a review model's reply that quote the
// text under review, which is `sources`. The verdict line, found as verdict()
// finds it, is SKIP, PASS, VIOLATION, or LOCAL, and only the last two have
// findings. A finding is read only after the verdict line. LOCAL is
// VIOLATION for text that only goes into a local file, and what it changes is
// in gate.ts. A finding is one line:
//   "fragment" + "fragment" -> rewrite
// It is verified when every fragment, with runs of whitespace collapsed, is in
// one of the sources; the fragments need not share a source. The model can see
// text quoted from an untrusted source, so no finding is acted on until its
// quote is found in the text that was sent for review. Anything else returns
// nothing: a reply with no verdict line, a finding that does not parse, a quote
// that is nowhere in the sources, a rewrite that is the quote itself, and a
// verdict with a later PASS line.
export function findings(reply: string, sources: string[]): string {
  const src = sources.map(text => squash(records(text).map(record => ` ${record}`).join('')))
  let out = ''
  let seen = false
  for (const record of records(reply)) {
    if (!seen) {
      if (!WORDS.includes(squash(record))) continue
      seen = true
      if (squash(record) !== 'VIOLATION' && squash(record) !== 'LOCAL') return ''
      continue
    }
    if (squash(record) === 'PASS') return ''
    const line = record.replace(/\r$/, '')
    const arrow = line.indexOf('" -> ')
    if (line[0] !== '"' || arrow < 0) continue
    const quoted = line.slice(1, arrow)
    // awk's split of "" yields no fragments, and the check below would pass
    if (quoted === '') continue
    const fragments = quoted.split('" + "')
    // A rewrite identical to the quote is not a finding.
    if (squash(fragments.join(' ')) === squash(line.slice(arrow + 5))) continue
    const verified = fragments.every(fragment => {
      const want = squash(fragment)
      return want !== '' && src.some(text => text.includes(want))
    })
    if (verified) out += `${line}\n`
  }
  return out
}
