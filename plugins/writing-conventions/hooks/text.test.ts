// claude plugin test: the three scanners in text.ts.
import { expect, test } from 'claude-code/testing'
import { drafts, excerpt, findings, verdict } from './text'

const F = '```'
// What follows each draft block.
const END = '\x01\n'

test('a reply with no draft fence has no draft', () => {
  expect(drafts('Here it is. The report says so.')).toBe('')
  expect(drafts(`Here it is.\n\n${F}python\nThe report says so.\n${F}`)).toBe('')
  expect(drafts('')).toBe('')
})

test('a draft is the text inside its fence, and nothing else', () => {
  expect(drafts(`Outside text.\n\n${F}draft\nThe report says so.\n${F}`)).toBe(`The report says so.\n${END}`)
  expect(drafts('~~~draft\nThe report says so.\n~~~')).toBe(`The report says so.\n${END}`)
  expect(drafts(`  ${F}draft md  \r\nThe report says so.\r\n  ${F}\r\n`)).toBe(`The report says so.\r\n${END}`)
})

test('only `draft` as the first word of the info string opens a draft', () => {
  for (const info of ['Draft', 'drafts', 'md draft', 'draft,md', '']) expect(drafts(`${F}${info}\nThe report says so.\n${F}`)).toBe('')
  for (const info of ['draft', ' draft ', 'draft\tmd']) expect(drafts(`${F}${info}\nThe report says so.\n${F}`)).toBe(`The report says so.\n${END}`)
})

// A four-backtick fence is closed by its own marker, so a code fence inside a
// draft does not end it.
test('a draft in a longer fence can contain a code fence', () => {
  const inside = `Plain text.\n\n${F}py\nx = 1\n${F}\n\nThe report says so.\n`
  expect(drafts(`${F}\`draft\n${inside}${F}\``)).toBe(inside + END)
})

test('each of two drafts ends on a separator line', () => {
  expect(drafts(`${F}draft\nThe report \n${F}\n\nAnd the second:\n\n${F}draft\nsays so.\n${F}`)).toBe(`The report \n${END}says so.\n${END}`)
})

// A closing fence takes no info string, so a line inside a draft that starts
// with the marker and goes on does not end the draft.
test('a marker with text after it does not close a draft', () => {
  expect(drafts(`${F}draft\nThe report says so.\n${F} and more\nThe build decided it.\n${F}`))
    .toBe(`The report says so.\n${F} and more\nThe build decided it.\n${END}`)
})

test('a draft left open runs to the end, and an empty one is no draft', () => {
  expect(drafts(`x\n${F}draft\nThe report says so.\n`)).toBe(`The report says so.\n${END}`)
  expect(drafts(`${F}draft\n \n\t\n${F}\n`)).toBe('')
})

test('unwrap takes the fence lines of a draft off and leaves the rest', () => {
  const reply = `Here it is.\n\n${F}draft\nPlain text.\n${F}\n\n${F}python\nx = 1\n${F}`
  expect(drafts(reply, { unwrap: true })).toBe(`Here it is.\n\nPlain text.\n\n${F}python\nx = 1\n${F}\n`)
  expect(drafts(`${F}\`draft\nPlain text.\n${F}py\nx = 1\n${F}\n${F}\`\n`, { unwrap: true })).toBe(`Plain text.\n${F}py\nx = 1\n${F}\n`)
})

const DOC = '# Title\n\nThe report says the version. It is short.\n\nSecond paragraph stays.\n\nThird one here.\n'

// A one-word edit is reviewed as the whole paragraphs that contain it, so a
// finding can quote the sentence around the word.
test('the excerpt is the paragraph that contains the new text', () => {
  expect(excerpt('says', DOC, 50000)).toBe('The report says the version. It is short.\n')
  expect(excerpt('says\n', DOC, 50000)).toBe('The report says the version. It is short.\n')
  expect(excerpt('# Title', DOC, 50000)).toBe('# Title\n')
  expect(excerpt('here.', DOC, 50000)).toBe('Third one here.\n')
})

test('new text that spans paragraphs brings every paragraph it touches', () => {
  expect(excerpt('It is short.\n\nSecond', DOC, 50000)).toBe('The report says the version. It is short.\n\nSecond paragraph stays.\n')
  expect(excerpt('It is short.\r\n\r\nSecond', DOC.replace(/\n/g, '\r\n'), 50000)).toBe('The report says the version. It is short.\n\nSecond paragraph stays.\n')
})

test('new text found twice brings both paragraphs, with a blank line between them', () => {
  expect(excerpt('e', DOC, 50000)).toBe(DOC)
  expect(excerpt('one', 'Line one\nof a paragraph.\n\nNo match.\n\nAnother one.\n', 50000)).toBe('Line one\nof a paragraph.\n\nAnother one.\n')
})

test('new text that is not in the file has no excerpt', () => {
  expect(excerpt('missing', DOC, 50000)).toBe('')
  expect(excerpt('short.\n\nThird', DOC, 50000)).toBe('')
  expect(excerpt('', DOC, 50000)).toBe('')
})

test('a small edit to a 900 KB file has a small excerpt', () => {
  let big = ''
  for (let i = 0; i < 15000; i++) big += `Filler paragraph ${i}, sixty characters of plain text to pad.\n\n`
  expect(excerpt('says so', `${big}The report says so.\n`, 50000)).toBe('The report says so.\n')
})

// The cap is in bytes of UTF-8, and the line that crosses it
// is still written.
test('the excerpt stops soon after the cap', () => {
  const file = 'one a\n\ntwo a\n\nthree a\n'
  expect(excerpt('a', file, 5)).toBe('one a\n')
  expect(excerpt('a', file, 6)).toBe('one a\n\ntwo a\n')
  expect(excerpt('a', '—— a\n\ntwo a\n', 6)).toBe('—— a\n')
})

const SAYS = 'git commit -m "The report says so"'

test('a finding that quotes the text is returned', () => {
  expect(findings('VIOLATION\n"The report says so" -> The version is shown in the report.\n', [SAYS]))
    .toBe('"The report says so" -> The version is shown in the report.\n')
  expect(findings('\n \r\nVIOLATION\r\n"The report says so" -> x\r\n', [SAYS])).toBe('"The report says so" -> x\n')
})

// A fragment is matched with runs of whitespace collapsed, so a sentence that
// wraps in a commit body is still found.
test('a quote is found across a line break in the text', () => {
  expect(findings('VIOLATION\n"The report says so" -> x', ['git commit -m "Fix it\n\nThe report\n  says so"'])).toBe('"The report says so" -> x\n')
})

test('every fragment of a finding has to be in the text', () => {
  expect(findings('VIOLATION\n"The report" + "says so" -> x\n', [SAYS])).toBe('"The report" + "says so" -> x\n')
  expect(findings('VIOLATION\n"The report" + "never appears" -> x\n', [SAYS])).toBe('')
  expect(findings('VIOLATION\n"The build decided" -> invented\n"The report says so" -> real\n', [SAYS])).toBe('"The report says so" -> real\n')
})

test('the fragments of one finding can be in different sources', () => {
  expect(findings('VIOLATION\n"The report" + "says so." -> x\n', ['gh pr create -F body.md', 'The report\n', 'says so.\n'])).toBe('"The report" + "says so." -> x\n')
  expect(findings('VIOLATION\n"The report says so." -> x\n', ['The report', 'says so.'])).toBe('')
})

// Two draft fences are two sources: one quote cannot span both, but a
// two-fragment finding that quotes each of them can.
test('no quote is matched across two drafts', () => {
  const two = [drafts(`${F}draft\nThe report \n${F}\n\nAnd the second:\n\n${F}draft\nsays so.\n${F}`)]
  expect(findings('VIOLATION\n"The report says so." -> x\n', two)).toBe('')
  expect(findings('VIOLATION\n"The report" + "says so." -> x\n', two)).toBe('"The report" + "says so." -> x\n')
})

test('LOCAL has findings as VIOLATION does', () => {
  expect(findings('LOCAL\n"The report says so" -> x\n', [SAYS])).toBe('"The report says so" -> x\n')
  expect(findings('LOCAL MAYBE\n"The report says so" -> x\n', [SAYS])).toBe('')
})

// A verdict line with a second word, which is not read as a verdict, a finding
// that does not parse, an empty quote, prose with no verdict line, and the
// reply the gate asked for before this contract.
test('a verdict in any other form has no findings', () => {
  for (const verdict of [
    'VIOLATION MAYBE\n"The report says so" -> x',
    'VIOLATION\nThe report says so: rewrite it',
    'VIOLATION',
    'VIOLATION\n"" -> x',
    'VIOLATION\n" -> x',
    'VIOLATION\n" " + "The report says so" -> x',
    'VIOLATION\n“The report says so” -> x',
    'the report says: rewrite it',
    'PASS\n"The report says so" -> x',
    'SKIP',
    'CLEAN',
    '',
  ]) expect([verdict, findings(`${verdict}\n`, [SAYS])]).toEqual([verdict, ''])
})

// The verdict is the first line that is a verdict word, so the findings are
// still used when reasoning or a code fence comes ahead of it.
test('a verdict after reasoning or inside a fence still has its findings', () => {
  expect(findings('The draft has one issue.\n\nVIOLATION\n"The report says so" -> x\n', [SAYS])).toBe('"The report says so" -> x\n')
  expect(findings(`${F}\nVIOLATION\n${F}\n\n"The report says so" -> x\n`, [SAYS])).toBe('"The report says so" -> x\n')
  expect(findings('Reading it.\nPASS\n"The report says so" -> x\n', [SAYS])).toBe('')
  expect(findings('"The report says so" -> x\nVIOLATION\n', [SAYS])).toBe('')
})

test('the verdict word is read past reasoning and fences', () => {
  expect(verdict('LOCAL\n"x" -> y')).toBe('LOCAL')
  expect(verdict(`Some reasoning.\n${F}\n LOCAL \r\n${F}`)).toBe('LOCAL')
  expect(verdict('VIOLATION MAYBE\nPASS')).toBe('PASS')
  expect(verdict('the report says: rewrite it')).toBe('')
})

// The model sometimes writes a finding, then takes it back and ends on PASS.
test('a verdict with a later PASS line has no findings', () => {
  expect(findings('VIOLATION\n"The report says so" -> x\n\nWait, that is not a violation.\n\nPASS\n', [SAYS])).toBe('')
  expect(findings('LOCAL\n"The report says so" -> x\n PASS\r\n', [SAYS])).toBe('')
})

test('a finding whose rewrite is the quote itself is dropped', () => {
  expect(findings('VIOLATION\n"The report says so" -> The report  says so\n', [SAYS])).toBe('')
  expect(findings('VIOLATION\n"The report" + "says so" -> The report says so\n', [SAYS])).toBe('')
})

// The review model can be shown text that was never sent for review, so a quote from
// outside the draft, or from a paragraph outside the excerpt, verifies nothing.
test('a finding is checked against the draft or the excerpt, and nothing outside it', () => {
  expect(findings('VIOLATION\n"The report says so." -> x\n', [drafts(`The report says so.\n\n${F}draft\nPlain text.\n${F}`)])).toBe('')
  expect(findings('VIOLATION\n"Third one here." -> x\n', [excerpt('says', DOC, 50000)])).toBe('')
  expect(findings('VIOLATION\n"The report says" + "paragraph stays." -> x\n', [excerpt('It is short.\n\nSecond', DOC, 50000)]))
    .toBe('"The report says" + "paragraph stays." -> x\n')
})
