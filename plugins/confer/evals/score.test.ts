import { expect, test } from 'claude-code/testing'
import { questionsIn, recommended, row, score, scoreAsk, scoreDesign, scoreInterview, scripted, session } from './score'

const file = 'src/stock.py'
const table = 'src/table.py'
const at = (path: string, line: number | null, extra = {}) => ({ path, line, ...extra })
const entry = (id: string, path: string, line?: number, extra = {}) => ({ id, path, ...(line !== undefined && { line }), ...extra })

const stock = { id: 'stock', findings: [at(file, 40), at(file, 72), at(file, 25)] }
const spans = (label?: string) => ({
  id: 'spans',
  findings: [10, 30, 60, 90].map(line => at(table, line, label ? { defect: label } : {})),
})

test('a finding on a line the change left alone matches', () => {
  const s = score(stock, { confirmed: [entry('a', file, 40), entry('b', file, 26)] })

  expect(s).toMatchObject({ reported: 2, truePositives: 2, defects: 3, found: 2, missed: [72], unmatched: [] })
})

test('one defect at four lines counts once', () => {
  const one = score(spans('wrong-unit'), { confirmed: [entry('a', table, 10)] })
  const all = score(spans('wrong-unit'), { confirmed: [10, 30, 60, 90].map((l, i) => entry(`r${i}`, table, l)) })
  const extra = score(spans('wrong-unit'), { confirmed: [10, 30, 60, 90, 10].map((l, i) => entry(`r${i}`, table, l)) })

  expect(one).toMatchObject({ defects: 1, found: 1, recall: 1, precision: 1, missed: [30, 60, 90] })
  expect(all).toMatchObject({ truePositives: 4, found: 1 })
  expect(extra).toMatchObject({ truePositives: 4, reported: 5, precision: 0.8, unmatched: ['r4'] })
})

test('without a label each line is its own defect', () => {
  expect(score(spans(), { confirmed: [entry('a', table, 10)] })).toMatchObject({ defects: 4, found: 1, recall: 0.25 })
})

test('a line three away matches, four away does not, and no line matches', () => {
  const c = { id: 'c', findings: [at(file, 100)] }

  expect(score(c, { confirmed: [entry('a', file, 103)] }).found).toBe(1)
  expect(score(c, { confirmed: [entry('a', file, 104)] }).found).toBe(0)
  expect(score(c, { confirmed: [entry('a', file)] }).found).toBe(1)
  expect(score({ id: 'c', findings: [at(file, null)] }, { confirmed: [entry('a', file, 900)] }).found).toBe(1)
})

test('reports are paired with case findings by maximum matching', () => {
  const c = { id: 'c', findings: [50, 80, 83].map(line => at(file, line)) }

  expect(score(c, { confirmed: [entry('a', file, 82), entry('b', file, 85)] })).toMatchObject({ truePositives: 2, found: 2 })
})

test('an entry matches through the location of its same entry', () => {
  const c = { id: 'c', findings: [at(file, 50)] }

  expect(score(c, { confirmed: [entry('a', file, 10, { same: [entry('b', file, 50)] })] }).found).toBe(1)
})

test('paths match by suffix after backslashes and ./ are normalized', () => {
  const c = { id: 'c', findings: [at('src/A.py', 1)] }
  const found = (path: string) => score(c, { confirmed: [entry('a', path, 1)] }).found

  expect(found('/tmp/wt/src/A.py')).toBe(1)
  expect(found('.\\src\\A.py')).toBe(1)
  expect(found('other/A.py')).toBe(0)
  expect(found('xsrc/A.py')).toBe(0)
})

test('a case with no defects has no recall, and every confirmed finding is a false positive', () => {
  const clean = { id: 'clean', findings: [] }

  expect(score(clean, {})).toMatchObject({ defects: 0, reported: 0, precision: null, recall: null })
  expect(score(clean, { confirmed: [entry('a', file, 3)] })).toMatchObject({ defects: 0, reported: 1, precision: 0, recall: null, unmatched: ['a'] })
})

test('an expired run reports nothing but raises its single-reviewer findings', () => {
  const s = score({ id: 'c', findings: [at(file, 5)] }, { singleReviewer: { claude: [entry('a', file, 5)], codex: [] } })

  expect(s).toMatchObject({ reported: 0, precision: null, recall: 0, found: 0, raised: 1 })
})

const report = {
  outcome: 'complete',
  phases: [{ rounds: 2, stop: 'agreed' }],
  confirmed: [entry('a', file, 40)],
  sides: {
    claude: { requested: [{ model: 'm' }], resolvedModels: ['claude-x'], costUsd: 1.5, tokens: { input_tokens: 3 } },
    codex: { requested: [], resolvedModels: ['gpt-y'], costUsd: null, tokens: {} },
  },
}
const log = [
  JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-conductor' }),
  JSON.stringify({ type: 'result', total_cost_usd: 2.25, permission_denials: [{}, {}] }),
].join('\n')

test('a row records rounds, stop, costs, models, and the conductor', () => {
  const r = row(stock, 'complex', report, log, { findings: '/f.json', log: '/l.jsonl' }, score)

  expect(r).toMatchObject({
    case: 'stock', tier: 'complex', outcome: 'complete', rounds: 2, stop: 'agreed', conductor: 'claude-conductor',
    sessionUsd: 2.25, permissionDenials: 2, found: 1, findings: '/f.json', log: '/l.jsonl',
    claude: { resolvedModels: ['claude-x'], costUsd: 1.5, tokens: { input_tokens: 3 } },
    codex: { resolvedModels: ['gpt-y'], costUsd: null },
  })
})

test('a run without a findings file is an error row', () => {
  expect(row(stock, 'complex', undefined, log, { findings: '/f.json', log: '/l.jsonl' }, score)).toEqual({ case: 'stock', tier: 'complex', error: 'no findings file', log: '/l.jsonl' })
})

const gaps = {
  id: 'relay',
  gaps: [
    { defect: 'unsigned', terms: ['signature', 'hmac'] },
    { defect: 'dropped', terms: ['retr(y|ies)', 'dead.letter'] },
  ],
}
const pt = (id: string, evidence: string, extra = {}) => ({ id, path: 'Design', evidence, fix: 'fix it', ...extra })

test('a design point raises a gap when a term is in its evidence or fix, in any case', () => {
  const s = scoreDesign(gaps, { withdrawn: [pt('C1', 'No HMAC check on requests.'), pt('X1', 'Logs are verbose.', { fix: 'Add Retries.' })] })

  expect(s).toMatchObject({ points: 2, defects: 2, raised: 2, recall: 1, stillOpen: [], missed: [], unmatched: [] })
})

test('a gap is still open when a confirmed or unresolved point raises it', () => {
  const s = scoreDesign(gaps, { confirmed: [pt('C1', 'no signature')], unresolved: [pt('X2', 'retry is missing')], withdrawn: [pt('X1', 'a logging nit')] })

  expect(s).toMatchObject({ points: 3, raised: 2, stillOpen: ['unsigned', 'dropped'], unmatched: ['X1'] })
})

test('a confirmed point and its same entries count once, and any of their texts raises a gap', () => {
  const s = scoreDesign(gaps, { confirmed: [pt('C1', 'unclear', { same: [pt('X1', 'requests are not signature-checked')] })] })

  expect(s).toMatchObject({ points: 1, raised: 1, missed: ['dropped'], unmatched: [] })
})

test('the section heading in path does not raise a gap', () => {
  expect(scoreDesign(gaps, { confirmed: [pt('C1', 'unclear', { path: 'Signature checks' })] })).toMatchObject({ raised: 0, unmatched: ['C1'] })
})

test('single-reviewer points of an expired run raise gaps, and which gaps are still open is unknown', () => {
  expect(scoreDesign(gaps, { singleReviewer: { claude: [pt('C1', 'no retries')], codex: [] } })).toMatchObject({ points: 1, raised: 1, recall: 0.5, stillOpen: null })
})

test('a design case with no gaps has no recall, and every point is unmatched', () => {
  expect(scoreDesign({ id: 'clean', gaps: [] }, { confirmed: [pt('C1', 'x')] })).toMatchObject({ defects: 0, recall: null, unmatched: ['C1'] })
})

test('a design row is scored by the design scorer', () => {
  expect(row(gaps, 'routine', { outcome: 'complete', withdrawn: [pt('C1', 'no hmac')] }, log, { findings: '/f.json', log: '/l.jsonl' }, scoreDesign)).toMatchObject({ case: 'relay', raised: 1, recall: 0.5 })
})

const retry = {
  id: 'retry',
  question: 'Should it retry three times or five?',
  points: [
    { point: 'double-charge', terms: ['idempot', 'double.?charg'] },
    { point: 'backoff', terms: ['jitter'] },
  ],
}
const said = (id: string, answer: string, extra = {}) => ({ id, answer, reasons: 'some reasons', rulings: [], ...extra })
const ruled = (evidence: string) => ({ round: 2, side: 'codex', ruling: 'dispute', evidence })

test('the points in an agreed answer and its same answer are in the final answer', () => {
  const s = scoreAsk(retry, { phases: [{ rounds: 2, stop: 'consensus' }], confirmed: [said('C1', 'Retry with an Idempotency-Key.', { same: [said('X1', 'Retry', { reasons: 'Add JITTER.' })] })] })

  expect(s).toEqual({ agreed: true, answers: 2, points: 2, inFinal: ['double-charge', 'backoff'], raised: ['double-charge', 'backoff'], missed: [] })
})

test('with no agreement the final answers are the unresolved ones, and a point raised only elsewhere is not in them', () => {
  const s = scoreAsk(retry, {
    phases: [{ rounds: 3, stop: 'stalled' }],
    unresolved: [said('C1', 'Retry three times.'), said('X1', 'Retry five times.', { rulings: [ruled('This can double-charge.')] })],
    withdrawn: [said('C2', 'Add jitter.')],
  })

  expect(s).toEqual({ agreed: false, answers: 3, points: 2, inFinal: [], raised: ['double-charge', 'backoff'], missed: [] })
})

test('a point in the reasons of a final answer counts, and a missed point is listed', () => {
  expect(scoreAsk(retry, { phases: [{ rounds: 2, stop: 'consensus' }], confirmed: [said('C1', 'Retry.', { reasons: 'Without a key it may DOUBLE CHARGE.' })] })).toMatchObject({
    inFinal: ['double-charge'],
    missed: ['backoff'],
  })
})

test('an unfinished run has single-reviewer answers, so whether a point is in the final answer is unknown', () => {
  const s = scoreAsk(retry, { singleReviewer: { claude: [said('C1', 'Retry.', { rulings: [ruled('use an idempotency key')] })], codex: [] } })

  expect(s).toEqual({ agreed: false, answers: 1, points: 2, inFinal: null, raised: ['double-charge'], missed: ['backoff'] })
})

test('an ask row has the rounds, the stop, and both sides\' cost', () => {
  const report = { outcome: 'complete', phases: [{ rounds: 2, stop: 'consensus' }], confirmed: [said('C1', 'idempotent retries')], sides: { claude: { costUsd: 0.5 }, codex: { costUsd: 0.25 } } }

  expect(row(retry, 'routine', report, log, { findings: '/f.json', log: '/l.jsonl' }, scoreAsk)).toMatchObject({
    case: 'retry',
    agreed: true,
    inFinal: ['double-charge'],
    rounds: 2,
    stop: 'consensus',
    claude: { costUsd: 0.5 },
    codex: { costUsd: 0.25 },
  })
})

test('an answer listed under both sides, as one a side adopted is, counts once', () => {
  const s = scoreAsk(retry, { singleReviewer: { claude: [said('C1', 'Retry.'), said('X1', 'Retry five times.')], codex: [said('X1', 'Retry five times.')] } })

  expect(s).toMatchObject({ answers: 2 })
})

test('a session sums the permission denials of every turn and takes the cost of the last', () => {
  const turns = [
    { type: 'system', subtype: 'init', model: 'claude-conductor' },
    { type: 'result', total_cost_usd: 0.4, permission_denials: [{}] },
    { type: 'system', subtype: 'init', model: 'claude-other' },
    { type: 'result', total_cost_usd: 0.6, permission_denials: [{}, {}] },
  ]

  expect(session(turns.map(e => JSON.stringify(e)).join('\n'))).toEqual({ conductor: 'claude-conductor', sessionUsd: 0.6, permissionDenials: 3 })
})

const reminders = {
  id: 'reminders',
  goal: 'Send a reminder when a loan is overdue.',
  file: 'docs/plan.md',
  constraints: [
    { constraint: 'relay-limit', terms: ['\\b451\\b'] },
    { constraint: 'time-zone', terms: ['Denver'] },
  ],
  questions: [
    { question: 'cadence', terms: ['how often'], answer: 'Every three days.' },
    { question: 'sms', terms: ['\\bsms\\b'], answer: 'Email only.' },
    { question: 'path', terms: ['where\\b.*\\bfile'], answer: 'Write it to docs/plan.md.' },
  ],
  needless: [{ question: 'language', terms: ['(which|what) language'] }],
  sections: [
    { section: 'requirements', terms: ['requirement'] },
    { section: 'plan', terms: ['^(the )?plan\\b'] },
  ],
}
const conductor = (...content: object[]) => JSON.stringify({ type: 'assistant', parent_tool_use_id: null, message: { content } })
const subagent = (...content: object[]) => JSON.stringify({ type: 'assistant', parent_tool_use_id: 'toolu_agent', message: { content } })
const say = (text: string) => ({ type: 'text', text })
const choice = (question: string, header: string, description = '') => ({ question, header, multiSelect: false, options: [{ label: 'Yes', description }, { label: 'No', description: '' }] })
const ask = (...questions: object[]) => ({ type: 'tool_use', id: 'toolu_ask', name: 'AskUserQuestion', input: { questions } })
const start = (args: string) => ({ type: 'tool_use', id: 'toolu_start', name: 'mcp__confer__plan_start', input: { args, pick: 'routine', isSure: true } })

test('a question gets the answer of the first scripted question it matches, or none', () => {
  expect(scripted(reminders, 'How often should SMS members hear from us?')?.answer).toBe('Every three days.')
  expect(scripted(reminders, 'What color is the email?')).toBeUndefined()
})

test('an unscripted question gets the option marked recommended, or else the first', () => {
  expect(recommended({ options: [{ label: 'Daily' }, { label: 'Weekly (Recommended)' }] })).toBe('Weekly (Recommended)')
  expect(recommended({ options: [{ label: 'Daily' }, { label: 'Weekly' }] })).toBe('Daily')
})

test('the questions in a text are its lines with a question mark', () => {
  expect(questionsIn('Assumptions:\n1. The relay takes 50 an hour.\n2. Days are in Denver.\n\nHow often should it repeat?')).toEqual(['How often should it repeat?'])
})

test('asked, unasked, needless, and other questions count AskUserQuestion questions and question lines but not options or a subagent\'s text', () => {
  const log = [
    subagent(say('Should SMS members get email?')),
    conductor(ask(choice('How often should a reminder repeat?', 'Cadence', 'Members who chose SMS get nothing.'), choice('Which language should it use?', 'Language'))),
    conductor(say('I read the code.\nWhere should I write the file?\nIs the subject line fine?')),
  ].join('\n')

  expect(scoreInterview(reminders, undefined, log)).toMatchObject({ questions: 4, asked: ['cadence', 'path'], unasked: ['sms'], needless: ['language'], other: 1 })
})

test('assumptions are listed only in a text that mentions them and has two or more list items, and the constraints in it are assumed', () => {
  const listed = conductor(say('Assumptions:\n1. The relay rejects the rest with a 451.\n2. Due dates are days in Denver.\n\nHow often should it repeat?'))
  const folded = conductor(ask(choice('Do the assumptions hold: a 451 past the limit, and days in Denver?', 'Assumptions')))

  expect(scoreInterview(reminders, undefined, listed)).toMatchObject({ assumptions: true, assumed: ['relay-limit', 'time-zone'] })
  expect(scoreInterview(reminders, undefined, folded)).toMatchObject({ assumptions: false, assumed: [] })
})

test('a constraint is assumed only when it is in a list item, not in a question after the list', () => {
  const log = conductor(say('Assumptions:\n1. The relay rejects the rest with a 451.\n2. Reminders go by email.\n\nShould due dates follow Denver time?'))

  expect(scoreInterview(reminders, undefined, log)).toMatchObject({ assumptions: true, assumed: ['relay-limit'] })
})

test('a section is found when a term matches a heading of the file, not its body', () => {
  const file = '# Overdue reminders plan\n\n## Requirements\n\nThe plan is to stop at a 451.\n\n## Design\n'

  expect(scoreInterview(reminders, file, '')).toMatchObject({ written: true, sections: ['requirements'], missingSections: ['plan'], inFile: ['relay-limit'] })
})

test('with no file, nothing is written, every section is missing, and no constraint is in the file', () => {
  expect(scoreInterview(reminders, undefined, '')).toMatchObject({ written: false, sections: [], missingSections: ['requirements', 'plan'], inFile: [] })
})

test('the review is started only when plan_start is called with the file', () => {
  expect(scoreInterview(reminders, undefined, conductor(start('--tier routine docs/plan.md'))).started).toBe(true)
  expect(scoreInterview(reminders, undefined, conductor(start('--tier routine docs/other.md'))).started).toBe(false)
})
