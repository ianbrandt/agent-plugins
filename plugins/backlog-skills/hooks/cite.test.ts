// claude plugin test: IDs cited without their titles.
import { expect, test } from 'claude-code/testing'
import { bareIds } from './cite'

const known = new Set(['R3', 'R7', 'R9', 'R12', 'R12.3', 'R144', 'R149', 'R600'])
const F = '```'

test('an ID with its title is cited, and one without it is bare', () => {
  expect(bareIds('R12: Parser cache is done.', known)).toEqual([])
  expect(bareIds('R12 is done, and R7 next.', known)).toEqual(['R12', 'R7'])
  expect(bareIds('R12:', known)).toEqual(['R12'])
})

test('an ID that is not in the backlog files or the changelog does not count', () => {
  expect(bareIds('R5 and R13 are not known.', known)).toEqual([])
})

test('an ID matches on a word boundary, and a sub-item ID is its own ID', () => {
  expect(bareIds('R120 and R1234 and xR12', known)).toEqual([])
  expect(bareIds('R12.3 is bare.', known)).toEqual(['R12.3'])
  expect(bareIds('R12.3: Sub is cited, and R12 is not.', known)).toEqual(['R12'])
})

test('an ID in a code span or a fenced block is exempt', () => {
  expect(bareIds('Run `next-backlog-item R12` now, or ``R7``.', known)).toEqual([])
  expect(bareIds(`${F}\ngit log R12\n${F}\nR9 after.`, known)).toEqual(['R9'])
})

test('a field line is exempt', () => {
  expect(bareIds('- Gated by: R600\nGated by: R12\n* Needs: R7', known)).toEqual([])
})

test('a range or a list of IDs followed by one title is cited', () => {
  expect(bareIds('R144 to R149: Plugin README cleanup', known)).toEqual([])
  expect(bareIds('R3 and R7: Ledger reap', known)).toEqual([])
  expect(bareIds('R3, R7, and R9: three at once', known)).toEqual([])
  expect(bareIds('R3 and R7 are both bare.', known)).toEqual(['R3', 'R7'])
})

test('a later mention of an ID cited earlier is exempt, and an earlier one is not', () => {
  expect(bareIds('R12: Parser cache landed. R12 also fixed the cache.', known)).toEqual([])
  expect(bareIds('R12 landed. R12: Parser cache is done.', known)).toEqual(['R12'])
})

test('a bare ID is listed once', () => {
  expect(bareIds('R7, then R7 again.', known)).toEqual(['R7'])
})
