// claude plugin test: the deletion of an item from a backlog file.
import { expect, test } from 'claude-code/testing'
import { deleteItem } from './item'

const ROADMAP = `# Roadmap

## R10: other

body

## R102: landed

Quotes \`s.index('## Order and dependencies')\` mid-line and R103.

### R102.1: sub

x

## R103: later one

a

## Order and dependencies

R102 first.
`

test('an item is deleted up to the next heading of its level, with its sub-items', () => {
  const { text, removed } = deleteItem(ROADMAP, 'R102')
  expect(removed).toEqual(['## R102: landed', '### R102.1: sub'])
  expect(text).toBe(ROADMAP.replace(/## R102: landed[\s\S]*?(?=## R103)/, ''))
})

test('an ID that is the start of another ID matches only its own item', () => {
  expect(deleteItem(ROADMAP, 'R10').removed).toEqual(['## R10: other'])
  expect(deleteItem(ROADMAP, 'R102.1').removed).toEqual(['### R102.1: sub'])
})

test('the last section is deleted to the end of the file', () => {
  const { text, removed } = deleteItem(ROADMAP, 'Order')
  expect(removed).toEqual(['## Order and dependencies'])
  expect(text.endsWith('a\n\n')).toBe(true)
})

test('an ID with no heading, or with two, is refused', () => {
  expect(() => deleteItem(ROADMAP, 'R999')).toThrow('R999: 0 headings')
  expect(() => deleteItem(ROADMAP + '\n## R10: again\n', 'R10')).toThrow('R10: 2 headings')
})

test('a heading inside a fenced block does not end the item', () => {
  const F = '```'
  const s = `## R1: one\n\n${F}md\n## R2: quoted\n${F}\n\ntail\n\n## R3: three\n`
  expect(deleteItem(s, 'R1')).toEqual({ text: '## R3: three\n', removed: ['## R1: one'] })
})

test('an indented code block, or a line of inline code that starts with backticks, opens no fence', () => {
  const F = '```'
  expect(deleteItem(`## R1: one\n\n    ${F}\n\n## R2: two\nkeep\n`, 'R1').text).toBe('## R2: two\nkeep\n')
  expect(deleteItem(`## R1: one\n\n${F}git merge-tree${F} is used here\n\n## R2: two\nkeep\n`, 'R1').text).toBe('## R2: two\nkeep\n')
})

test('a fence still open at the end of the text is refused', () => {
  expect(() => deleteItem('## R1: one\n\n```\n## R2: two\n', 'R1')).toThrow('not closed')
})

test('a line with an info string does not close a fence', () => {
  const F = '```'
  const s = `## R1: one\n\n${F}md\n${F}js\n## R2: quoted\n${F}\n\n## R3: three\n`
  expect(deleteItem(s, 'R1').text).toBe('## R3: three\n')
})

// A checkout with core.autocrlf has a carriage return at the end of each line.
test('a fence closes in a file with CRLF line ends, and with a tab after it', () => {
  expect(deleteItem('## R1: one\r\n```\r\ncode\r\n```\r\n## R2: two\r\n', 'R1').text).toBe('## R2: two\r\n')
  expect(deleteItem('## R1: one\n```\ncode\n```\t\n## R2: two\n', 'R1').text).toBe('## R2: two\n')
})

test('a heading inside a tilde fence does not end the item, with CRLF line ends', () => {
  expect(deleteItem('## R1: one\r\n~~~\r\n## R9: quoted\r\n~~~\r\n## R2: two\r\n', 'R1').text).toBe('## R2: two\r\n')
})

test('a heading with leading spaces, or a tab after the hashes, ends the item as it does in the backlog parser', () => {
  for (const h of [' ## R2: two', '##\tR2: two']) {
    expect(deleteItem(`## R1: one\n\n${h}\n`, 'R1').text).toBe(`${h}\n`)
  }
})
