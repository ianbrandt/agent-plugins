// Spaced em dashes taken out of a reply as it streams, so the text on screen and
// the text in the transcript are both `word—word`. A `session.append` hook would
// fix only the stored reply: the screen shows the streamed text first.
//
// What is left alone is what the lint leaves alone: a fenced block, inline code,
// and text in straight or curly double quotes. A `draft` fence is the exception,
// since its text is for publication, though a fence inside it is left alone. A
// dash with no letter before it on its line is left alone too: after a list or
// heading marker the spaces are markdown, as they are around a dash that fills a
// table cell. A span left open at the end of a line may close on a later one, so
// the text is left as written until the span closes or a blank line ends the
// paragraph, and the reply lint still reports it.
import { atLeast } from './gate'

// One text block's position: the text held back while the next piece could
// change it, whether the next character starts a line, the open fence, whether it
// is a `draft` fence, whether it opened in a block quote, the fence open inside
// a draft and whether that one opened in a block quote, the length of an open
// backtick run, the open quote, whether the line has had a letter, a code span,
// or a quote, and whether the last character written was a dash that was closed
// up. `off` passes the rest of the block through as written.
export type Dash = { held: string; lineStart: boolean; fence: string; draft: boolean; quoted: boolean; inner: string; innerQuoted: boolean; code: number; quote: string; word: boolean; afterDash: boolean; off: boolean }

export function start(): Dash {
  return { held: '', lineStart: true, fence: '', draft: false, quoted: false, inner: '', innerQuoted: false, code: 0, quote: '', word: false, afterDash: false, off: false }
}

// The run of `chars` at `i`, as its end, or -1 when the text ends inside it and
// more may follow.
function run(text: string, i: number, chars: string, end: boolean): number {
  let j = i
  while (j < text.length && chars.includes(text[j])) j++
  return j === text.length && !end ? -1 : j
}

// Where a fence marker can start on the line at `i`: after any indent, and after
// the block-quote markers and, with `list`, the one list marker a fence can
// follow. `quoted` is whether a block-quote marker was passed. -1 when the text
// ends where more of a marker may follow.
function opening(text: string, i: number, end: boolean, markers: boolean, list: boolean): { at: number; quoted: boolean } | -1 {
  let at = run(text, i, ' \t', end)
  let quoted = false
  while (markers && at >= 0) {
    const rest = text.slice(at, at + 12)
    const m = /^>/.exec(rest) ?? (list ? /^(?:[-*+]|\d{1,9}[.)])(?=[ \t])/.exec(rest) : null)
    if (!m) {
      if (!end && at + rest.length === text.length && (list ? /^(?:[-*+]|\d{1,9}[.)]?)?$/ : /^$/).test(rest)) return -1
      break
    }
    if (m[0] === '>') quoted = true
    else list = false
    at = run(text, at + m[0].length, ' \t', end)
  }
  return at < 0 ? -1 : { at, quoted }
}

// feed(state, piece): the text to show for this piece. With `end`, nothing more
// follows and everything held is written.
export function feed(s: Dash, piece: string, end = false): string {
  const text = s.held + piece
  let out = ''
  let i = 0
  s.held = ''
  while (i < text.length) {
    if (s.lineStart) {
      // A fence marker is three or more backticks or tildes after any indent. One
      // that opens a fence may also follow block-quote markers and a list marker,
      // and the fence it opens in a block quote closes after those markers too. The
      // whole line is needed to read an opening fence's info string.
      const opens = s.fence === '' || (s.draft && s.inner === '')
      const first = opening(text, i, end, opens || (s.inner !== '' ? s.innerQuoted : s.quoted), opens)
      if (first === -1) break
      const indent = first.at
      const marker = run(text, indent, text[indent] === '~' ? '~' : '`', end)
      if (marker < 0) break
      const prefixed = /[^ \t]/.test(text.slice(i, indent))
      if (marker - indent >= 3) {
        const newline = text.indexOf('\n', marker)
        if (newline < 0 && !end) break
        const stop = newline < 0 ? text.length : newline + 1
        // A marker closes a fence of the same character that is no longer than it,
        // with nothing after it on the line. Inside a draft any other marker line
        // opens an inner fence.
        const m = text.slice(indent, marker)
        const rest = text.slice(marker, stop).trim()
        const closes = (open: string) => m[0] === open[0] && m.length >= open.length && rest === ''
        if (s.fence === '') {
          s.fence = m
          s.draft = rest === 'draft' || /^draft[ \t]/.test(rest)
          s.quoted = first.quoted
          s.inner = ''
        } else if (s.inner !== '') {
          if (closes(s.inner)) s.inner = ''
        } else if (closes(s.fence) && !(prefixed && !s.quoted)) {
          s.fence = ''
        } else if (s.draft) {
          s.inner = m
          s.innerQuoted = first.quoted
        }
        out += text.slice(i, stop)
        i = stop
        continue
      }
      s.lineStart = false
      // A blank line ends the paragraph, and with it any span left open.
      const body = run(text, i, ' \t', true)
      if (body === text.length || text[body] === '\n' || text[body] === '\r') {
        s.code = 0
        s.quote = ''
      }
      s.word = false
      s.afterDash = false
    }
    const c = text[i]
    if (c === '\n') {
      s.lineStart = true
      out += c
      i++
    } else if (s.fence !== '' && (!s.draft || s.inner !== '')) {
      out += c
      i++
    } else if (c === '`') {
      const j = run(text, i, '`', end)
      if (j < 0) break
      s.code = s.code === 0 ? j - i : s.code === j - i ? 0 : s.code
      s.word = true
      s.afterDash = false
      out += text.slice(i, j)
      i = j
    } else if (s.code !== 0) {
      out += c
      i++
    } else if (c === '"' || c === '“' || c === '”') {
      if (s.quote === '') s.quote = c === '”' ? '' : c
      else if ((s.quote === '"' && c === '"') || (s.quote === '“' && c === '”')) s.quote = ''
      s.word = true
      s.afterDash = false
      out += c
      i++
    } else if (s.quote !== '') {
      out += c
      i++
    } else if (c === ' ' || c === '\t') {
      const j = run(text, i, ' \t', end)
      if (j < 0) break
      // Spaces go when a dash that is closed up is on either side of them. Before a
      // line break they stay, since two of them there are a markdown line break.
      const before = text[j] === '—' && s.word
      const after = s.afterDash && j < text.length && text[j] !== '\n' && text[j] !== '\r'
      if (!before && !after) out += text.slice(i, j)
      i = j
    } else {
      s.afterDash = c === '—' && s.word
      if (/\p{L}/u.test(c)) s.word = true
      else if (c === '|') s.word = false
      out += c
      i++
    }
  }
  s.held = text.slice(i)
  return out
}

// The reply with its spaced em dashes taken out, as a stream.
export async function* repair($: any, e: any, next: any): AsyncGenerator<any, any> {
  // The chunk format is part of an early-access API, so on a CLI the module was
  // not checked on, the reply is passed through as written.
  if (!atLeast((await $.session.version().catch(() => ({}))).base)) return yield* next(e)
  const blocks = new Map<number, Dash>()
  const stream = next(e)[Symbol.asyncIterator]()
  for (;;) {
    let step: IteratorResult<any, any>
    let failed: unknown
    try {
      step = await stream.next()
    } catch (error) {
      step = { done: true, value: undefined }
      failed = error ?? new Error('turn.step failed')
    }
    const chunk: any = step.done ? undefined : step.value
    if (chunk?.kind === 'text') {
      if (!blocks.has(chunk.index)) blocks.set(chunk.index, start())
      const s = blocks.get(chunk.index)!
      yield s.off ? chunk : { ...chunk, text: feed(s, chunk.text) }
      continue
    }
    // Any other chunk can end a text block, so held text is written ahead of it
    // and the block is switched off. No other chunk was seen inside a block in
    // a long reply, so later text with the same index comes from a retry or a
    // cut-off reply. Its position in the block is unknown, and it is passed
    // through as written.
    for (const [index, s] of blocks) {
      const text = s.off ? '' : feed(s, '', true)
      s.off = true
      if (text !== '') yield { kind: 'text', index, text }
    }
    if (failed) throw failed
    if (step.done) return step.value
    yield chunk
  }
}
