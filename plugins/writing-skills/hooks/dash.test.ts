// claude plugin test: the dash rewrite in dash.ts, whole and in pieces.
import { expect, test } from 'claude-code/testing'
import { feed, start } from './dash'

const F = '```'
// [reply, the reply as shown]
const CASES: [string, string][] = [
  ['This is one thing — and another.', 'This is one thing—and another.'],
  ['Tight already—no change here.', 'Tight already—no change here.'],
  ['Tab\t—\tboth sides, and one side— here and —there.', 'Tab—both sides, and one side—here and—there.'],
  ['He said "run `echo "a — b"` now" ok.', 'He said "run `echo "a — b"` now" ok.'],
  ['Type "`grep "x — y" f`" to search — now.', 'Type "`grep "x — y" f`" to search—now.'],
  ['Run `a — b` and then go — now.', 'Run `a — b` and then go—now.'],
  ['He said "wait — what" and left — quickly.', 'He said "wait — what" and left—quickly.'],
  ['She wrote “one — two” and then — three.', 'She wrote “one — two” and then—three.'],
  ['Double ``a ` — b`` ticks — here.', 'Double ``a ` — b`` ticks—here.'],
  [`Before — fence.\n${F}sh\necho a — b\n${F}\nAfter — fence.`, `Before—fence.\n${F}sh\necho a — b\n${F}\nAfter—fence.`],
  [`  ~~~\n  x — y\n  ~~~~\nOut — side.`, `  ~~~\n  x — y\n  ~~~~\nOut—side.`],
  [`${F}draft\nFix it — now, as \`a — b\` shows.\n${F}\n`, `${F}draft\nFix it—now, as \`a — b\` shows.\n${F}\n`],
  [`${F}${F}draft\nOne — two.\n${F}sh\nx — y\n${F}\nThree — four.\n${F}${F}`, `${F}${F}draft\nOne—two.\n${F}sh\nx — y\n${F}\nThree—four.\n${F}${F}`],
  [`${F}md\na — b\n${F}python\nc — d\n${F}\ne — f`, `${F}md\na — b\n${F}python\nc — d\n${F}\ne—f`],
  [`${F}\na — b\n~~~\nc — d\n${F}\ne — f`, `${F}\na — b\n~~~\nc — d\n${F}\ne—f`],
  [`${F}${F}\na — b\n${F}\nc — d\n${F}${F}\ne — f`, `${F}${F}\na — b\n${F}\nc — d\n${F}${F}\ne—f`],
  ['- — item\n* — x\n1. — y\n# — Title\n> — Author\n| — | a — b |\n  — indented', '- — item\n* — x\n1. — y\n# — Title\n> — Author\n| — | a—b |\n  — indented'],
  ['Break after a dash —  \nnext line, and `code` — after code.', 'Break after a dash—  \nnext line, and `code`—after code.'],
  ['Ends on a dash —\n  indented next line.', 'Ends on a dash—\n  indented next line.'],
  ['A dash—`code` then text, and a dash—"quoted" then text.', 'A dash—`code` then text, and a dash—"quoted" then text.'],
  ['An open `tick — here\nNext — line.\n\nNew — paragraph.', 'An open `tick — here\nNext — line.\n\nNew—paragraph.'],
  ['"a ” b — c" d — e, and f” g — h', '"a ” b — c" d—e, and f” g—h'],
  ['Windows — line.\r\n' + F + '\r\nx — y\r\n' + F + '\r\nAfter — it.', 'Windows—line.\r\n' + F + '\r\nx — y\r\n' + F + '\r\nAfter—it.'],
  ['A quote left "open — to the end\nNext — line.\n  \nThen — this.', 'A quote left "open — to the end\nNext — line.\n  \nThen—this.'],
  ['Trailing spaces stay.  \n  Indent stays — mostly.', 'Trailing spaces stay.  \n  Indent stays—mostly.'],
  [`Ends on a fence — ok.\n${F}\ncode\n${F}`, `Ends on a fence—ok.\n${F}\ncode\n${F}`],
  ['Ends on spaces — and a dash —', 'Ends on spaces—and a dash—'],
  ['He said "wait\nnow — what" ok — then.', 'He said "wait\nnow — what" ok—then.'],
  ['Run `git log\n  --format — x` now — go.', 'Run `git log\n  --format — x` now—go.'],
  ['> ~~~text\n> alpha — beta\n> ~~~\n> after — it', '> ~~~text\n> alpha — beta\n> ~~~\n> after—it'],
  [`1. ${F}sh\n   echo a — b\n   ${F}\nafter — text\n`, `1. ${F}sh\n   echo a — b\n   ${F}\nafter—text\n`],
  [`- > ${F}\n  > a — b\n  > ${F}\n12. not — a fence`, `- > ${F}\n  > a — b\n  > ${F}\n12. not—a fence`],
  [`${F}md\n> ${F}\na — b\n${F}\nc — d`, `${F}md\n> ${F}\na — b\n${F}\nc—d`],
  [`${F}draft md\nalpha — beta\n${F}\n`, `${F}draft md\nalpha—beta\n${F}\n`],
  ['| Foo | — | yes — no |', '| Foo | — | yes—no |'],
  [`${F}draft\nOne — two.\n> ${F}\n> x — y\n> ${F}\nThree — four.\n${F}\nFive — six.`, `${F}draft\nOne—two.\n> ${F}\n> x — y\n> ${F}\nThree—four.\n${F}\nFive—six.`],
]

function whole(text: string): string {
  const s = start()
  return feed(s, text) + feed(s, '', true)
}

test('a spaced em dash is closed up outside code, quotes, and fences', () => {
  for (const [reply, shown] of CASES) expect(whole(reply)).toBe(shown)
})

test('the result is the same however the reply is cut into pieces', () => {
  let seed = 86
  const next = (n: number) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n
  for (const [reply, shown] of CASES) {
    for (let size = 1; size <= 4; size++) {
      for (let round = 0; round < 25; round++) {
        const s = start()
        let out = ''
        for (let i = 0; i < reply.length; ) {
          const n = round === 0 ? size : 1 + next(7)
          out += feed(s, reply.slice(i, i + n))
          i += n
        }
        expect(out + feed(s, '', true)).toBe(shown)
      }
    }
  }
})

test('text is held only while the next piece could change it', () => {
  const s = start()
  expect(feed(s, 'One thing')).toBe('One thing')
  expect(feed(s, ' ')).toBe('')
  expect(feed(s, 'more ')).toBe(' more')
  expect(feed(s, '— done.')).toBe('—done.')
})

// steps <chunks>: the hook's output for a stream of chunks, through the plugin.
async function steps($: any, on: any, chunks: any[], fail = false, base = '2.1.289'): Promise<any[]> {
  on('session.version', () => ({ value: { version: base, base, builtAt: '' } }))
  on('turn.step', async function* () {
    for (const c of chunks) yield c
    if (fail) throw new Error('stream cut')
    return { turnId: 't', index: 0, answer: '', toolUses: [], stopReason: null, usage: null }
  })
  const out: any[] = []
  try {
    for await (const c of $.turn.step({ turnId: 't', index: 0, model: 'm', messageCount: 1 })) out.push(c)
  } catch {
    out.push({ kind: 'thrown' })
  }
  return out
}
const text = (chunks: any[], index: number) => chunks.filter(c => c.kind === 'text' && c.index === index).map(c => c.text).join('')

test('held text is written before a chunk of another kind, and at the end', async ($: any, on: any) => {
  const out = await steps($, on, [
    { kind: 'text', index: 0, text: 'One — two ' },
    { kind: 'thinking', index: 1, text: 'hm' },
    { kind: 'text', index: 2, text: 'Three — four\n' + F },
  ])
  expect(text(out, 0)).toBe('One—two ')
  expect(text(out, 2)).toBe('Three—four\n' + F)
  expect(out.map((c: any) => c.kind).join(' ')).toBe('text text thinking text text')
})

test('a block that is cut by another chunk is passed through as written after it', async ($: any, on: any) => {
  const out = await steps($, on, [
    { kind: 'text', index: 0, text: F + 'sh\necho a — b\n' },
    { kind: 'thinking', index: 1, text: 'hm' },
    { kind: 'text', index: 0, text: F + 'sh\necho c — d\n' + F + '\nProse — here.' },
  ])
  expect(text(out, 0)).toBe(F + 'sh\necho a — b\n' + F + 'sh\necho c — d\n' + F + '\nProse — here.')
})

test('held text is written when the stream fails', async ($: any, on: any) => {
  const out = await steps($, on, [{ kind: 'text', index: 0, text: 'word ' }, { kind: 'text', index: 0, text: 'tail ' + F }], true)
  expect(text(out, 0)).toBe('word tail ' + F)
  expect(out[out.length - 1].kind).toBe('thrown')
})

test('on an older CLI the reply is passed through as written', async ($: any, on: any) => {
  const out = await steps($, on, [{ kind: 'text', index: 0, text: 'One — two ' }, { kind: 'text', index: 0, text: '— three' }], false, '2.1.200')
  expect(text(out, 0)).toBe('One — two — three')
})
