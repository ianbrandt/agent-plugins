import { expect, test } from 'claude-code/testing'
import { parseReply } from './contract'
import type { ReplyExpectation } from './contract'

const firstRound: ReplyExpectation = { isFirstRound: true, isFixPhase: false, own: [], other: [], known: { own: [], other: [] }, selected: [] }
const laterRound: ReplyExpectation = { isFirstRound: false, isFixPhase: false, own: ['C1'], other: ['X1'], known: { own: ['C1'], other: ['X1'] }, selected: [] }
const finding = { id: 'a', severity: 'high', path: 'src/a.ts', line: 3, evidence: 'reads past the end', fix: 'check the length' }
const review = { verdict: 'REVISE', summary: 'one bug', findings: [finding], coverage: ['src/a.ts'], limitations: [] }
const rulings = [
  { id: 'C1', ruling: 'agree', evidence: 'still true' },
  { id: 'X1', ruling: 'dispute', evidence: 'the caller checks it' },
]

const error = (value: unknown, expectation = firstRound) => {
  const result = parseReply(typeof value === 'string' ? value : JSON.stringify(value), expectation)
  return 'error' in result ? result.error : 'parsed'
}

test('a first-round reply is parsed and its lists are filled in', () => {
  expect(parseReply(JSON.stringify(review), firstRound)).toEqual({ reply: { ...review, rulings: [] } })
  expect(parseReply(JSON.stringify({ verdict: 'APPROVED', summary: 'clean', coverage: ['src'] }), firstRound)).toEqual({
    reply: { verdict: 'APPROVED', summary: 'clean', findings: [], rulings: [], coverage: ['src'], limitations: [] },
  })
})

test('the object can be the whole reply or one fenced block', () => {
  const json = JSON.stringify(review, null, 2)

  expect(error(`  ${json}\n`)).toBe('parsed')
  expect(error(`Here is my review.\n\n\`\`\`json\n${json}\n\`\`\`\n`)).toBe('parsed')
  expect(error(`\`\`\`\n${json}\n\`\`\``)).toBe('parsed')
  expect(error(`\`\`\`ts\nconst a = 1\n\`\`\`\n\`\`\`json\n${json}\n\`\`\``)).toBe('parsed')
})

test('a reply with no object or more than one is refused', () => {
  expect(error('Looks good to me.')).toMatch(/no JSON object/)
  expect(error(`${JSON.stringify(review)} trailing`)).toMatch(/not valid JSON/)
  expect(error('```json\n{}\n```\n```json\n{}\n```')).toMatch(/2 JSON blocks/)
  expect(error('```json\n{ nope\n```')).toMatch(/not valid JSON/)
  expect(error('[1]')).toMatch(/no JSON object/)
  expect(error('```json\n[1]\n```')).toMatch(/must be one JSON object/)
})

test('a first round is checked as claudex-loop checks a review', () => {
  expect(error({ ...review, verdict: 'MAYBE' })).toMatch(/verdict must be APPROVED, REVISE, or BLOCKED/)
  expect(error({ ...review, verdict: undefined })).toMatch(/verdict must be/)
  expect(error({ ...review, summary: ' ' })).toMatch(/summary must be a non-empty string/)
  expect(error({ ...review, verdict: 'APPROVED' })).toMatch(/APPROVED cannot have a high or medium finding/)
  expect(error({ ...review, findings: [{ ...finding, severity: 'low' }] })).toMatch(/REVISE needs at least one high or medium finding/)
  expect(error({ ...review, verdict: 'APPROVED', findings: [{ ...finding, severity: 'low' }] })).toBe('parsed')
  expect(error({ ...review, verdict: 'BLOCKED' })).toMatch(/BLOCKED needs at least one limitation/)
  expect(error({ ...review, coverage: [] })).toMatch(/coverage must list what was inspected/)
  expect(error({ ...review, verdict: 'BLOCKED', coverage: [], limitations: ['no access to src'] })).toBe('parsed')
  expect(error({ ...review, rulings })).toMatch(/rulings must be empty in a first round/)
  expect(error({ ...review, rulings: [] })).toBe('parsed')
})

test('a finding needs every field with the right type', () => {
  const bad = (change: object) => error({ ...review, findings: [{ ...finding, ...change }] })

  expect(bad({ id: '' })).toMatch(/findings\[0\]\.id must be a non-empty string/)
  expect(bad({ fix: 3 })).toMatch(/findings\[0\]\.fix must be a non-empty string/)
  expect(bad({ severity: 'critical' })).toMatch(/findings\[0\]\.severity must be high, medium, or low/)
  expect(bad({ line: 0 })).toMatch(/findings\[0\]\.line must be a positive integer/)
  expect(bad({ line: 1.5 })).toMatch(/line must be a positive integer/)
  expect(bad({ line: undefined })).toBe('parsed')
  expect(error({ ...review, findings: [finding, finding] })).toMatch(/two findings with the id "a"/)
  expect(error({ ...review, findings: {} })).toMatch(/findings must be a list/)
  expect(error({ ...review, coverage: ['src', ''] })).toMatch(/coverage must be a list of non-empty strings/)
})

test('of and preexisting are allowed only in a fix phase, and never together', () => {
  const fixRound = { ...firstRound, isFixPhase: true, selected: ['C1'] }
  const withField = (change: object, expectation = fixRound) => error({ ...review, findings: [{ ...finding, ...change }] }, expectation)

  expect(withField({ of: 'C1' }, firstRound)).toMatch(/findings\[0\]\.of is allowed only in a fix phase/)
  expect(withField({ preexisting: true }, firstRound)).toMatch(/preexisting is allowed only in a fix phase/)
  expect(withField({ of: 'C1' })).toBe('parsed')
  expect(withField({ preexisting: true, severity: 'low' }, fixRound)).toMatch(/REVISE needs/)
  expect(withField({ preexisting: 'yes' })).toMatch(/preexisting must be true or false/)
  expect(withField({ of: 'C1', preexisting: true })).toMatch(/cannot set both of and preexisting/)
  expect(withField({ of: 'C1', preexisting: false })).toBe('parsed')
})

test('of must name a finding the fix phase was asked to fix', () => {
  const fixRound = { ...firstRound, isFixPhase: true, selected: ['C1', 'X2'] }
  const withOf = (of: string) => error({ ...review, findings: [{ ...finding, of }] }, fixRound)

  expect(withOf('X2')).toBe('parsed')
  expect(withOf('C2')).toBe('findings[0].of is "C2", but the fixes were asked to fix only C1 and X2: set of to one of those, or leave it out for a defect the fixes introduced.')
})

test('unknown keys are ignored and left out', () => {
  const result = parseReply(JSON.stringify({ ...review, mood: 'tired', findings: [{ ...finding, extra: 1 }] }), firstRound)

  expect(result).toEqual({ reply: { ...review, rulings: [] } })
})

test('a BLOCKED reply is returned for the caller to fail', () => {
  const blocked = { verdict: 'BLOCKED', summary: 'cannot read the diff', limitations: ['git is unavailable'] }

  expect(parseReply(JSON.stringify(blocked), firstRound)).toEqual({
    reply: { ...blocked, findings: [], rulings: [], coverage: [] },
  })
})

test('a later round rules on every finding it is given', () => {
  expect(parseReply(JSON.stringify({ rulings }), laterRound)).toEqual({
    reply: { findings: [], rulings, coverage: [], limitations: [] },
  })
  expect(error({ rulings: rulings.slice(0, 1) }, laterRound)).toMatch(/rulings is missing a ruling for X1/)
  expect(error({}, laterRound)).toMatch(/missing a ruling for C1 and X1/)
  expect(error({ rulings: [...rulings, rulings[0]] }, laterRound)).toMatch(/two rulings for "C1"/)
  expect(error({ rulings: [...rulings, { id: 'X2', ruling: 'agree', evidence: 'yes' }] }, laterRound)).toMatch(
    /rulings\[2\] is for "X2", which is not a finding to rule on this round/,
  )
})

test('a later round rules on its own findings and the other side differently', () => {
  const ruling = (own: object, other: object = {}) => error({ rulings: [{ ...rulings[0], ...own }, { ...rulings[1], ...other }] }, laterRound)

  expect(ruling({ ruling: 'withdraw' }, { ruling: 'agree', severity: 'low' })).toBe('parsed')
  expect(ruling({ ruling: 'dispute' })).toMatch(/C1 is your finding: rule agree to stand by it, or withdraw/)
  expect(ruling({}, { ruling: 'withdraw' })).toMatch(/X1 is the other reviewer's finding: rule agree or dispute/)
  expect(ruling({}, { ruling: 'maybe' })).toMatch(/rulings\[1\]\.ruling must be agree, dispute, or withdraw/)
  expect(ruling({ ruling: 'withdraw', severity: 'low' })).toMatch(/rulings\[0\]\.severity is allowed only on an agree/)
  expect(ruling({}, { severity: 'low' })).toMatch(/rulings\[1\]\.severity is allowed only on an agree/)
  expect(ruling({}, { ruling: 'agree', severity: 'huge' })).toMatch(/rulings\[1\]\.severity must be high, medium, or low/)
  expect(ruling({ evidence: '' })).toMatch(/rulings\[0\]\.evidence must be a non-empty string/)
})

// Codex put a severity on its agree with its own finding, and both attempts of the round were refused.
test('an agree with your own finding may set a severity, which is kept as given', () => {
  const parsed = parseReply(JSON.stringify({ rulings: [{ ...rulings[0], severity: 'medium' }, rulings[1]] }), laterRound)

  expect(parsed).toMatchObject({ reply: { rulings: [{ id: 'C1', ruling: 'agree', severity: 'medium' }, { id: 'X1' }] } })
})

test('a later round may report findings and a verdict, but checks only BLOCKED', () => {
  expect(error({ rulings, findings: [finding] }, laterRound)).toBe('parsed')
  expect(error({ rulings, verdict: 'APPROVED', findings: [finding] }, laterRound)).toBe('parsed')
  expect(error({ rulings, verdict: 'NOPE' }, laterRound)).toMatch(/verdict must be/)
  expect(error({ rulings, verdict: 'BLOCKED' }, laterRound)).toMatch(/BLOCKED needs at least one limitation/)
  expect(error({ rulings, summary: 4 }, laterRound)).toMatch(/summary must be a non-empty string/)
})

test('an agree may mark a finding of the other side as the same defect', () => {
  const same = (id: string, other: string) => [{ id: 'C1', ruling: 'agree', evidence: 'yes', ...(id === 'C1' && { same: other }) }, { id: 'X1', ruling: 'agree', evidence: 'yes', ...(id === 'X1' && { same: other }) }]

  expect(parseReply(JSON.stringify({ rulings: same('X1', 'C1') }), laterRound)).toMatchObject({ reply: { rulings: [{ id: 'C1' }, { id: 'X1', same: 'C1' }] } })
  expect(parseReply(JSON.stringify({ rulings: same('C1', 'X1') }), laterRound)).toMatchObject({ reply: { rulings: [{ id: 'C1', same: 'X1' }, { id: 'X1' }] } })
})

test('same is allowed only on an agree that names a finding of the other side', () => {
  const ruling = (own: object, other: object = {}) => error({ rulings: [{ ...rulings[0], ...own }, { ...rulings[1], ...other }] }, laterRound)

  expect(ruling({ ruling: 'withdraw', same: 'X1' })).toMatch(/rulings\[0\]\.same is allowed only on an agree/)
  expect(ruling({}, { ruling: 'dispute', same: 'C1' })).toMatch(/rulings\[1\]\.same is allowed only on an agree/)
  expect(ruling({}, { ruling: 'agree', same: 'X1' })).toMatch(/rulings\[1\]\.same is "X1"/)
  expect(ruling({}, { ruling: 'agree', same: 'C9' })).toMatch(/rulings\[1\]\.same is "C9", which is not one of your findings: use C1\./)
  expect(ruling({ same: 'C1' }, {})).toMatch(/rulings\[0\]\.same is "C1", which is not one of the other reviewer's findings: use X1\./)
  expect(error({ rulings: [{ ...rulings[0], same: 'X1' }] }, { ...laterRound, other: [], known: { own: ['C1'], other: [] } })).toMatch(/same is "X1", which is not one of the other reviewer's findings\./)
  expect(ruling({}, { ruling: 'agree', same: '' })).toMatch(/rulings\[1\]\.same must be a non-empty string/)
})

// Round 3: C1 was agreed in round 2, and X1 is still pending.
test('same may name a finding of the other side that is already confirmed', () => {
  const later = { ...laterRound, own: [], other: ['X1'], known: { own: ['C1', 'C2'], other: ['X1'] } }
  const ruling = (same: string) => error({ rulings: [{ id: 'X1', ruling: 'agree', same, evidence: 'yes' }] }, later)

  expect(ruling('C1')).toBe('parsed')
  expect(ruling('C9')).toMatch(/same is "C9", which is not one of your findings: use C1, C2\./)
  expect(ruling('X1')).toMatch(/same is "X1", which is not one of your findings/)
})

const askFirst: ReplyExpectation = { ...firstRound, isAsk: true }
const askLater: ReplyExpectation = { ...laterRound, isAsk: true }
const answer = { id: 'A1', answer: 'Retry with an idempotency key.', reasons: 'A capture that timed out may have succeeded.' }
const stand = (own: string, other: string, answers: object[] = [], extra: { own?: object; other?: object } = {}) =>
  error({ rulings: [{ id: 'C1', ruling: own, evidence: 'e', ...extra.own }, { id: 'X1', ruling: other, evidence: 'e', ...extra.other }], answers, coverage: ['src'] }, askLater)

test('an answer is parsed as a finding with the answer in fix and the reasons in evidence', () => {
  expect(parseReply(JSON.stringify({ answers: [answer], coverage: ['src'] }), askFirst)).toEqual({
    reply: { findings: [{ id: 'A1', severity: 'high', path: 'answer', evidence: answer.reasons, fix: answer.answer }], rulings: [], coverage: ['src'], limitations: [] },
  })
})

test('the first round of a question has exactly one answer, and no verdict or findings', () => {
  expect(error({ answers: [] }, askFirst)).toBe('answers has 0 answers: give exactly one in round 1.')
  expect(error({ answers: [answer, { ...answer, id: 'A2' }] }, askFirst)).toBe('answers has 2 answers: give exactly one in round 1.')
  expect(error({ answers: [answer], verdict: 'APPROVED' }, askFirst)).toMatch(/verdict is not part of an answer/)
  expect(error({ answers: [answer], findings: [finding] }, askFirst)).toMatch(/findings is not part of an answer/)
  expect(error({ answers: [{ ...answer, reasons: ' ' }] }, askFirst)).toMatch(/answers\[0\]\.reasons must be a non-empty string/)
  expect(error({ answers: [{ ...answer, answer: 3 }] }, askFirst)).toMatch(/answers\[0\]\.answer must be a non-empty string/)
  expect(error({ answers: [answer], rulings }, askFirst)).toMatch(/rulings must be empty in a first round/)
})

test('a later round of a question rules on every id listed, with answer in its messages', () => {
  expect(error({ rulings: rulings.slice(0, 1) }, askLater)).toMatch(/rulings is missing a ruling for X1/)
  expect(stand('dispute', 'dispute')).toBe('C1 is your answer: rule agree to stand by it, or withdraw.')
  expect(stand('agree', 'withdraw')).toBe("X1 is the other expert's answer: rule agree or dispute.")
  expect(error({ rulings: [...rulings, { id: 'X2', ruling: 'agree', evidence: 'e' }] }, askLater)).toMatch(/is for "X2", which is not an answer to rule on this round/)
})

test('a later round of a question stands by exactly one answer', () => {
  expect(stand('agree', 'dispute')).toBe('parsed')
  expect(stand('withdraw', 'agree')).toBe('parsed')
  expect(stand('withdraw', 'dispute', [answer])).toBe('parsed')
  expect(stand('agree', 'agree')).toBe('You stand by 2 answers: C1 and X1. Stand by exactly one: agree with yours, agree with the other expert\'s and withdraw yours, or give one new answer and withdraw yours.')
  expect(stand('withdraw', 'dispute')).toMatch(/^You stand by no answer\. Stand by exactly one/)
  expect(stand('agree', 'dispute', [answer])).toMatch(/^You stand by 2 answers: C1 and the new answer A1\./)
  expect(stand('withdraw', 'dispute', [answer, { ...answer, id: 'A2' }])).toBe('answers has 2 answers: give at most one new answer.')
})

test('an agree with the other expert\'s answer that marks it the same as yours counts once', () => {
  expect(stand('agree', 'agree', [], { other: { same: 'C1' } })).toBe('parsed')
  expect(stand('agree', 'agree', [], { own: { same: 'X1' } })).toBe('parsed')
  expect(stand('agree', 'agree', [], { own: { same: 'X1' }, other: { same: 'C1' } })).toBe('parsed')
  expect(stand('withdraw', 'agree', [answer], { other: { same: 'C1' } })).toMatch(/^You stand by 2 answers: X1 and the new answer A1\./)
})

test('same marks that put two answers of one side in one group do not count as one answer', () => {
  const two = (own: string[], other: string[]) => ({ ...askLater, own, other, known: { own, other } })
  const agree = (id: string, same?: string) => ({ id, ruling: 'agree', evidence: 'e', ...(same !== undefined && { same }) })

  expect(error({ rulings: [agree('C1', 'X2'), agree('C2', 'X2'), agree('X2')] }, two(['C1', 'C2'], ['X2']))).toMatch(/^You stand by 3 answers: C1, C2, and X2\./)
  expect(error({ rulings: [agree('C1'), agree('X1', 'C1'), agree('X2', 'C1')] }, two(['C1'], ['X1', 'X2']))).toMatch(/^You stand by 3 answers: C1, X1, and X2\./)
})
