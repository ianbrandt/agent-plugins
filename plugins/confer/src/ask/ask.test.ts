import type { On, ProcessRunInit } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { lines } from '../codex/fixtures/codex-0.167.0'
import { mcpList, usageLimit } from '../codex/fixtures/synthetic'
import { askPrompt } from './brief'

const top = '/repo'
const root = '/home/.claude/tmp/confer'
const start = 1_000_000

// On Windows the engine hands the fs hooks backslashed paths with the current drive before a POSIX path.
const local = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:(?=\/)/, '')

type Answer = { stdout?: string; stderr?: string; exitCode?: number }
// A Codex run: its stdout, one that hangs until it is killed, or stdout sent once `gate` resolves.
type Codex = string | 'hang' | { gate: Promise<void>; stdout: string }
type Options = { answers?: Record<string, Answer | (() => Answer)>; match?: (key: string) => Answer | undefined; codex?: Codex[]; agents?: unknown[]; agentDeny?: string; links?: string[]; save?: { fails: boolean }; denyWrite?: (path: string, text: string) => string | undefined; real?: (path: string) => string; exists?: (path: string) => boolean }

const defaults: Record<string, Answer> = {
  'git rev-parse --show-toplevel': { stdout: `${top}\n` },
  'git rev-parse --show-prefix': { stdout: '\n' },
  [`git -C ${top} rev-parse HEAD`]: { stdout: 'head1\n' },
  [`git -C ${top} write-tree #index`]: { stdout: 'tree1\n' },
  [`git -C ${top} diff --no-renames --name-only -z head1 tree1`]: { stdout: 'a.ts\0' },
  [`git -C ${top} rev-parse --show-toplevel`]: { stdout: `${top}\n` },
  'codex --version': { stdout: 'codex-cli 0.167.0\n' },
  'codex mcp list --json --disable apps --disable plugins': { stdout: mcpList },
}

function world(on: On, options: Options = {}) {
  const runs: { key: string; init?: ProcessRunInit }[] = []
  const files: Record<string, string> = {}
  const codex = [...(options.codex ?? [])]
  const codexPrompts: string[] = []
  const codexDirs: string[] = []
  const spawned: Record<string, any>[] = []
  const registered: string[] = []
  const agentTypes: Record<string, any>[] = []
  const clock = mock.clock(on, { now: start })
  mock.env(on, { HOME: '/home' })
  const answer = (key: string): Answer => {
    const given = options.answers?.[key] ?? defaults[key] ?? options.match?.(key)
    if (typeof given === 'function') return given()
    if (given !== undefined) return given
    // The run directory is in no repository.
    return key.startsWith(`git -C ${root}/`) && key.endsWith('rev-parse --show-toplevel') ? { exitCode: 128 } : {}
  }
  on('process.run', (_, e) => {
    const key = e.argv.join(' ') + (e.init?.env?.GIT_INDEX_FILE ? ' #index' : '')
    runs.push({ key, init: e.init && { ...e.init, cwd: e.init.cwd && local(e.init.cwd) } })
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false, ...answer(key) } }
  })
  on('process.spawn', async function* (_, e, next) {
    const key = e.argv.join(' ')
    runs.push({ key })
    if (e.argv[0] === 'git') {
      const { stdout, exitCode } = answer(key)
      if (stdout) yield { stream: 'stdout' as const, text: stdout }
      return { value: { code: exitCode ?? 0, signal: null } }
    }
    codexPrompts.push(e.input ?? '')
    codexDirs.push(local(e.cwd ?? ''))
    const run = codex.shift() ?? ''
    if (run === 'hang') {
      await new Promise<void>(resolve => next.signal.addEventListener('abort', () => resolve()))
      return { value: { code: null, signal: 'SIGTERM' } }
    }
    if (typeof run !== 'string') await run.gate
    yield { stream: 'stdout' as const, text: typeof run === 'string' ? run : run.stdout }
    return { value: { code: 0, signal: null } }
  })
  on('fs.write', (_, e) => {
    if (options.save?.fails && local(e.path).endsWith('state.json')) return { deny: 'The state is too big.' }
    const denied = options.denyWrite?.(local(e.path), e.text)
    if (denied !== undefined) return { deny: denied }
    files[local(e.path)] = e.text
    return { value: undefined }
  })
  on('fs.read', (_, e) => (files[local(e.path)] === undefined ? { deny: `ENOENT: ${e.path}` } : { value: files[local(e.path)]! }))
  on('fs.exists', (_, e) => ({ value: local(e.path) in files || local(e.path).endsWith('/checkout') }))
  on('fs.stat', (_, e) => (options.exists?.(local(e.path)) === false ? { deny: `ENOENT: ${e.path}` } : { value: { kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false, ...(e.resolve ? { realPath: options.real?.(local(e.path)) ?? local(e.path) } : {}) } }))
  on('fs.list', (_, e) => {
    if (local(e.path) !== root) return { deny: `ENOENT: ${e.path}` }
    const names = new Set(Object.keys(files).flatMap(path => (path.startsWith(`${root}/`) ? [path.slice(root.length + 1).split('/')[0]!] : [])))
    return { value: [...names].map(name => (options.links?.includes(name) ? { name, kind: 'other' as const, size: 0, mtimeMs: 0, isLink: true } : { name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })) }
  })
  on('tool.register', (_, e) => {
    registered.push(e.name)
    return { value: { tool: `mcp__confer__${e.name}` } }
  })
  on('agent.register', (_, e) => {
    agentTypes.push(e)
    return { value: { agent: `confer:${e.name}` } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', () => ({ sessionId: 'session' }))
  on('agent.offer', () => ({ isOffered: true }))
  on('agent.spawn', (_, e) => {
    spawned.push(e)
    return { model: e.model ?? 'inherit', agentId: `agent-${spawned.length}` }
  })
  on('agent.list', () => ({ value: (options.agents ?? []) as never }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('tool.call', { tool: 'Agent' }, (_, e) => (options.agentDeny !== undefined ? { deny: options.agentDeny } : {
    result: {
      status: 'completed',
      agentId: `agent-${spawned.findIndex(s => s.tool_use_id === e.tool_use_id) + 1}`,
      resolvedModel: 'claude-opus-5-5',
      usage: { input_tokens: 50, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    } as never,
  }))
  return { runs, files, codex, codexPrompts, codexDirs, spawned, registered, agentTypes, clock }
}

const call = async ($: Engine, name: string, input: object = {}): Promise<any> =>
  JSON.parse(String((await $.tool.call({ tool: `mcp__confer__${name}`, ...input } as never)).result))

const question = `Our capture job gives up after one failed attempt. Should it retry "three times" or five? What's safest?`

const begin = async ($: Engine, input: object = {}) => {
  await $.session.start({ cwd: top, surface: 'desktop', isInteractive: true })
  return call($, 'ask_start', { args: question, pick: 'complex', isSure: true, ...input })
}

let toolUse = 0
// The conductor's Agent call: the spawn, the reviewer's last turn, then the call's result.
async function claude($: Engine, round: any, reply: string) {
  const { subagent_type, description, prompt } = round.agent
  const tool_use_id = `toolu_${++toolUse}`
  const spawn = await $.agent.spawn({ prompt, description, subagentType: subagent_type, tool_use_id, background: true } as never)
  if (spawn.agentId !== undefined) {
    await $.turn.complete({ answer: reply, agentId: spawn.agentId, durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as never)
  }
  await $.tool.call({ tool: 'Agent', tool_use_id, description, prompt, subagent_type } as never)
  return spawn
}

const state = (files: Record<string, string>, run: string) => JSON.parse(files[`${root}/${run}/state.json`]!)
const noRepo = { 'git rev-parse --show-toplevel': { exitCode: 128 } }

test('ask_start keeps the question verbatim, quotes and apostrophes included, and returns it with the tier and models', async ($, on) => {
  const { files } = world(on)

  const round1 = await begin($)

  expect(round1).toMatchObject({
    status: 'round',
    round: 1,
    question,
    tier: 'complex',
    claude: { model: 'opus', effort: 'high' },
    codex: { effort: 'xhigh' },
    agent: { subagent_type: 'confer:reviewer-high' },
  })
  expect(state(files, round1.run)).toMatchObject({ ask: { question }, top, repoDir: top, status: 'running' })
  expect(state(files, round1.run).design).toBeUndefined()
})

test('leading flags are read, with or without =, and the rest is the question', async ($, on) => {
  const { files } = world(on)

  const inline = await begin($, { args: `--tier=routine --findings=/out/a.json   ${question}  ` })
  const spaced = await begin($, { args: `--claude-effort "max" --findings /out/b.json --tier routine ${question}` })

  expect(inline).toMatchObject({ question, tier: 'routine' })
  expect(state(files, inline.run)).toMatchObject({ findingsFile: '/out/a.json', ask: { question } })
  expect(spaced).toMatchObject({ question, tier: 'routine', claude: { effort: 'max' } })
  expect(state(files, spaced.run)).toMatchObject({ findingsFile: '/out/b.json' })
})

test('a question after a flag keeps every word, and an apostrophe in it is not read as a quote', async ($, on) => {
  world(on)

  expect(await begin($, { args: "--tier routine What's the safest retry policy?" })).toMatchObject({ question: "What's the safest retry policy?", tier: 'routine' })
})

test('a flag typed after the first word of the question is part of the question', async ($, on) => {
  world(on)

  expect(await begin($, { args: 'What does --tier routine do?' })).toMatchObject({ question: 'What does --tier routine do?', tier: 'complex' })
  expect(await begin($, { args: '--tier critical Is --findings=/a.json "safe"?' })).toMatchObject({ question: 'Is --findings=/a.json "safe"?', tier: 'critical' })
})

test('an empty question is refused before a run is created', async ($, on) => {
  const { files } = world(on)

  expect(await begin($, { args: '' })).toEqual({ error: expect.stringContaining('needs a question') })
  expect(await begin($, { args: '  --tier routine  ' })).toEqual({ error: expect.stringContaining('needs a question') })
  expect(Object.keys(files).filter(path => path.startsWith(root))).toEqual([])
})

test('ask_start refuses --findings with a relative path or a file that exists', async ($, on) => {
  const { files } = world(on)
  files['/out/there.json'] = '{}'

  expect(await begin($, { args: `--findings rel.json ${question}` })).toEqual({ error: expect.stringContaining('needs an absolute path') })
  expect(await begin($, { args: `--findings=/out/there.json ${question}` })).toEqual({ error: expect.stringContaining('already exists') })
  expect(Object.keys(files).filter(path => path.endsWith('state.json'))).toEqual([])
})

test('an unsure pick asks which tier to run the question at', async ($, on) => {
  world(on)
  const asked: string[] = []
  on('tool.call', { tool: 'AskUserQuestion' }, (_, e) => {
    asked.push(e.questions[0]!.question)
    return { result: { questions: e.questions, answers: { [e.questions[0]!.question]: 'Complex' } } }
  })

  await begin($, { isSure: false })
  await begin($, { isSure: false, args: `--findings /out/c.json ${question}` })

  expect(asked).toEqual(['Which tier should Confer run this question at?'])
})

test('outside a Git checkout ask_start warns as a plan run does, and the folder is in both prompts', async ($, on) => {
  const { files } = world(on, { answers: noRepo })
  on('session.cwd', () => ({ value: '/work' }))

  const round1 = await begin($)
  const run = state(files, round1.run)

  expect(run).toMatchObject({ top: '', repoDir: '/work' })
  expect(round1.warning).toBe('Confer found no Git checkout, so the reviewers read the files in /work.')
  expect(round1.instructions).toMatch(/^Tell the user the warning\. /)
  for (const side of ['claude', 'codex'] as const) expect(askPrompt(run, side, undefined)).toContain('Confer found no Git repository: read the files in /work.')
})

test('a folder that contains the run directory is refused, and one beside it is not', async ($, on) => {
  const { files } = world(on, { answers: noRepo })
  let cwd = '/home'
  on('session.cwd', () => ({ value: cwd }))

  expect(await begin($)).toEqual({ error: expect.stringContaining(root) })
  cwd = '/'
  expect(await begin($)).toEqual({ error: expect.stringContaining(root) })
  expect(Object.keys(files).filter(path => path.startsWith(root))).toEqual([])
  cwd = '/home/.claude/tmp/confer-other'
  expect(await begin($)).toMatchObject({ status: 'round' })
})

test('a checkout that contains the run directory is refused', async ($, on) => {
  world(on, { answers: { 'git rev-parse --show-toplevel': { stdout: '/home\n' } } })

  expect(await begin($)).toEqual({ error: expect.stringContaining(root) })
})

test('the two round-1 prompts differ only in the names and the tools line', async ($, on) => {
  const { files } = world(on)
  const round1 = await begin($)
  const run = state(files, round1.run)
  const claudeLines = askPrompt(run, 'claude', undefined).split('\n')
  const codexLines = askPrompt(run, 'codex', undefined).split('\n')

  expect(claudeLines).toHaveLength(codexLines.length)
  const differ = claudeLines.flatMap((line, i) => (line === codexLines[i] ? [] : [[line, codexLines[i]]]))
  expect(differ).toEqual([
    [
      `You are Claude, one of two experts who answer one question independently. Codex is the other. You are read-only: read files and Git objects, and never edit, build, or run anything. Your Git access is the mcp__confer__git tool: call it with run "${run.id}" and the Git arguments as a list, such as ["diff", "<base>", "<tree>"]. Read files with Read, Grep, and Glob.`,
      'You are Codex, one of two experts who answer one question independently. Claude is the other. You are read-only: read files and Git objects, and never edit, build, or run anything. Read-only shell reads, such as `cat`, `sed -n`, `rg`, and `git show`, are allowed.',
    ],
  ])
})

test('the round-1 prompt fences the question as untrusted, and asks for one answer with its reasons', async ($, on) => {
  const { files } = world(on)
  const fenced = 'Is this safe?\n```ts\nretry(3)\n```'
  const round1 = await begin($, { args: fenced })
  const prompt = askPrompt(state(files, round1.run), 'claude', undefined)

  expect(prompt).toContain(`\`\`\`\`untrusted\n${fenced}\n\`\`\`\``)
  expect(prompt).toContain('"answers": [{ "id": "A1", "answer": "...", "reasons": "..." }]')
  expect(prompt).toContain('Lead with the answer')
  expect(prompt).toContain(`Do not read anything in ${root}`)
  expect(prompt).not.toContain('"verdict"')
})

test('ask_start refuses a question when its prompt is over 256 KiB once escaped as JSON', async ($, on) => {
  const { files } = world(on)

  expect(await begin($, { args: '"a"\n'.repeat(50_000) })).toEqual({ error: expect.stringContaining('The question is too large') })
  expect(Object.keys(files).filter(path => path.startsWith(root))).toEqual([])
})

const said = (text: string, id = 'A1') => ({ id, answer: text, reasons: `reasons for ${text}` })
const first = (text: string) => JSON.stringify({ answers: [said(text)], coverage: ['a.ts'], limitations: [] })
const later = (rulings: object[], answers: object[] = []) => JSON.stringify({ rulings, answers, coverage: ['a.ts'], limitations: [] })
const ruling = (id: string, kind: string, extra: object = {}) => ({ id, ruling: kind, evidence: `${kind} ${id}`, ...extra })
const codexSays = (reply: string) =>
  lines(
    { type: 'thread.started', thread_id: '01a1b80c-01e1-7c60-811e-b52b8eb2bb62' },
    { type: 'turn.started' },
    { type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: reply } },
    { type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 10 } },
  )
const claudeFirst = first('Retry with a key.')
const codexFirst = first('Retry five times.')
const kib = 2 ** 10
const sizeOf = (text: string) => new TextEncoder().encode(text).length
// A round-1 reply with its answer padded to a size, and short reasons.
const padded = (text: string, pad: string) => JSON.stringify({ answers: [{ id: 'A1', answer: `${text} ${pad}`, reasons: 'short' }], coverage: ['a.ts'] })
const overLimit = (reply: string) => `The reply is ${Math.ceil(sizeOf(reply) / kib)} KiB, over the limit of 64 KiB.`

// Round 1: Claude answers C1 and Codex X1, and ask_round returns round 2.
async function firstRound($: Engine, on: On, extra: Options = {}, settings: object = {}) {
  const w = world(on, { ...extra, codex: [codexSays(codexFirst), ...(extra.codex ?? [])] })
  const round1 = await begin($, settings)
  await claude($, round1, claudeFirst)
  const round2 = await call($, 'ask_round', { run: round1.run })
  return { ...w, round1, round2 }
}

// A later round: the Claude reviewer's rulings, then ask_round.
async function nextRound($: Engine, round: any, claudeRulings: object[], answers: object[] = []) {
  await claude($, round, later(claudeRulings, answers))
  return call($, 'ask_round', { run: round.run })
}

test('round 1 keeps each side from the other\'s answer, and round 2 sends every answer, the ids to rule on, and the other reply', async ($, on) => {
  const { spawned, codexPrompts, round2 } = await firstRound($, on, { codex: [codexSays(later([ruling('X1', 'agree'), ruling('C1', 'dispute')]))] })

  expect(round2).toMatchObject({ status: 'round', round: 2, agent: { subagent_type: 'confer:reviewer-high' } })
  expect(codexPrompts[0]).not.toContain('Retry with a key.')
  await claude($, round2, later([ruling('C1', 'agree'), ruling('X1', 'dispute')]))
  await call($, 'ask_round', { run: round2.run })
  const prompt = spawned[1]!.prompt as string

  expect(prompt).toContain('## Round 2')
  expect(prompt).toContain('Rule on your own answers: C1.')
  expect(prompt).toContain('Rule on Codex\'s answers: X1.')
  expect(prompt).toContain('"answer": "Retry five times."')
  expect(prompt).toContain('"reasons": "reasons for Retry with a key."')
  expect(prompt).not.toContain('"severity"')
  expect(prompt).toContain(codexFirst)
  expect(codexPrompts[1]).toContain(claudeFirst)
  expect(codexPrompts[1]).toContain('Rule on your own answers: X1.')
})

test('an answer both sides agree with ends the run in consensus, with answer and reasons in confirmed, and cost for both sides', async ($, on) => {
  const { files, round2 } = await firstRound($, on, { codex: [codexSays(later([ruling('X1', 'withdraw'), ruling('C1', 'agree')]))] })

  const done = await nextRound($, round2, [ruling('C1', 'agree'), ruling('X1', 'dispute')])

  expect(done).toMatchObject({
    status: 'complete',
    question,
    report: {
      question,
      summary: '1 confirmed, 0 unresolved.',
      phases: [{ rounds: 2, stop: 'consensus' }],
      confirmed: [{ id: 'C1', foundBy: 'claude', status: 'agreed', answer: 'Retry with a key.', reasons: 'reasons for Retry with a key.', agreedBy: 'codex' }],
      unresolved: [],
      withdrawn: [{ id: 'X1', answer: 'Retry five times.' }],
      sides: { claude: { tokens: { input_tokens: 100 }, costUsd: expect.any(Number) }, codex: { tokens: { input_tokens: 200 }, costUsd: expect.anything() } },
    },
  })
  for (const entry of [...done.report.confirmed, ...done.report.withdrawn]) for (const key of ['severity', 'path', 'evidence', 'fix']) expect(entry).not.toHaveProperty(key)
  expect(state(files, round2.run).design).toBeUndefined()
})

test('two answers marked the same end the run in consensus as one entry', async ($, on) => {
  const { round2 } = await firstRound($, on, { codex: [codexSays(later([ruling('X1', 'agree'), ruling('C1', 'agree', { same: 'X1' })]))] })

  const done = await nextRound($, round2, [ruling('C1', 'agree'), ruling('X1', 'agree', { same: 'C1' })])

  expect(done.report).toMatchObject({ phases: [{ stop: 'consensus' }], confirmed: [{ id: 'C1', foundBy: 'both', same: [{ id: 'X1', answer: 'Retry five times.' }] }] })
  expect(done.report.confirmed[0]).not.toHaveProperty('severity')
})

test('a round in which no answer moves ends the run stalled, with both answers in unresolved', async ($, on) => {
  const disputes = codexSays(later([ruling('X1', 'agree'), ruling('C1', 'dispute')]))
  const { round2 } = await firstRound($, on, { codex: [disputes, disputes] })

  const round3 = await nextRound($, round2, [ruling('C1', 'agree'), ruling('X1', 'dispute')])
  expect(round3).toMatchObject({ status: 'round', round: 3 })
  const done = await nextRound($, round3, [ruling('C1', 'agree'), ruling('X1', 'dispute')])

  expect(done).toMatchObject({ status: 'complete', report: { phases: [{ rounds: 3, stop: 'stalled' }], confirmed: [], unresolved: [{ id: 'C1', status: 'disputed' }, { id: 'X1', status: 'disputed' }] } })
})

test('maxRounds ends a question at that round', { options: { maxRounds: 2 } }, async ($, on) => {
  const { round2 } = await firstRound($, on, { codex: [codexSays(later([ruling('X1', 'agree'), ruling('C1', 'dispute')]))] })

  const done = await nextRound($, round2, [ruling('C1', 'agree'), ruling('X1', 'dispute')])

  expect(done).toMatchObject({ status: 'complete', report: { phases: [{ rounds: 2, stop: 'max-rounds' }], unresolved: [{ id: 'C1' }, { id: 'X1' }] } })
})

test('a refused reply is retried with the reason, and a second refusal ends the run incomplete', async ($, on) => {
  const { spawned } = world(on, { codex: [codexSays(codexFirst)] })

  const round1 = await begin($)
  await claude($, round1, JSON.stringify({ answers: [said('One.'), said('Two.', 'A2')] }))
  const retry = await call($, 'ask_round', { run: round1.run })

  expect(retry).toMatchObject({ status: 'round', round: 1, retry: expect.stringContaining('give exactly one in round 1') })
  await claude($, retry, 'I could not decide.')
  const done = await call($, 'ask_round', { run: round1.run })

  expect(spawned[1]!.prompt).toContain('Your previous reply was refused. The reply is invalid: answers has 2 answers')
  expect(done).toMatchObject({ status: 'incomplete', report: { outcome: 'incomplete', note: 'Claude failed both attempts of round 1.' } })
})

test('a reply over 64 KiB is refused, only its first 64 KiB is stored, and the side is asked again', async ($, on) => {
  const long = padded('Retry.', 'é'.repeat(40 * kib))
  const { files, codexPrompts } = world(on, { codex: [codexSays(long), codexSays(codexFirst)] })

  const round1 = await begin($)
  await claude($, round1, long)
  const retry = await call($, 'ask_round', { run: round1.run })
  const [claudeAttempt, codexAttempt] = state(files, round1.run).attempts

  expect(retry).toMatchObject({ status: 'round', retry: overLimit(long) })
  for (const attempt of [claudeAttempt, codexAttempt]) {
    expect(attempt).toMatchObject({ status: 'failed', failure: overLimit(long) })
    expect(sizeOf(attempt.raw)).toBeLessThanOrEqual(64 * kib)
    expect(sizeOf(attempt.raw)).toBeGreaterThan(64 * kib - 4)
    expect(long.startsWith(attempt.raw)).toBe(true)
  }
  expect(codexPrompts[1]).toContain(`Your previous reply was refused. ${overLimit(long)}`)
})

test('a reply over 4 MiB is refused and retried, and state.json is still written', async ($, on) => {
  const huge = padded('Retry.', 'x'.repeat(5 * 2 ** 20))
  const { files } = world(on, { codex: [codexSays(codexFirst)], denyWrite: (path, text) => (path.endsWith('state.json') && sizeOf(text) > 4 * 2 ** 20 ? 'state.json is over 4 MiB.' : undefined) })

  const round1 = await begin($)
  await claude($, round1, huge)
  const retry = await call($, 'ask_round', { run: round1.run })

  expect(retry).toMatchObject({ status: 'round', retry: overLimit(huge) })
  expect(sizeOf(state(files, round1.run).attempts[0].raw)).toBe(64 * kib)
})

test('a later prompt over 256 KiB ends the run incomplete between rounds, with each side\'s answer in unresolved', async ($, on) => {
  const { files } = world(on, { codex: [codexSays(padded('Retry five times.', 'q'.repeat(30 * kib)))] })

  const round1 = await begin($, { args: `${question} ${'w'.repeat(180 * kib)}` })
  expect(round1).toMatchObject({ status: 'round' })
  await claude($, round1, padded('Retry with a key.', 'q'.repeat(30 * kib)))
  const done = await call($, 'ask_round', { run: round1.run })

  expect(done).toMatchObject({
    status: 'incomplete',
    report: {
      note: expect.stringContaining('The question is too large'),
      summary: 'The run ended incomplete before round 2. 0 confirmed, 2 unresolved.',
      phases: [{ rounds: 1 }],
      unresolved: [{ id: 'C1', status: 'open' }, { id: 'X1', status: 'open' }],
    },
  })
  expect(done.report.singleReviewer).toBeUndefined()
  expect(state(files, round1.run).attempts.filter((a: any) => a.round === 2)).toEqual([])
})

test('an answer a side adopts is reported as its position after the other side fails both attempts', async ($, on) => {
  const { round2 } = await firstRound($, on, { codex: [codexSays('no JSON'), codexSays('still no JSON')] })

  const done = await nextRound($, round2, [ruling('C1', 'withdraw'), ruling('X1', 'agree')])

  expect(done).toMatchObject({ status: 'incomplete', report: { note: 'Codex failed both attempts of round 2.' } })
  expect(done.report.summary).toContain('during the question, so its answers are single-reviewer')
  const positions = done.report.singleReviewer.claude
  expect(positions.map((p: any) => [p.id, p.rulings.at(-1)])).toEqual([
    ['C1', expect.objectContaining({ side: 'claude', round: 2, ruling: 'withdraw' })],
    ['X1', expect.objectContaining({ side: 'claude', round: 2, ruling: 'agree' })],
  ])
  expect(positions[1]).toMatchObject({ answer: 'Retry five times.' })
  expect(done.report.singleReviewer.codex.map((p: any) => p.id)).toEqual(['X1'])
})

test('a new answer given in an unfinished round is reported as not ruled on', async ($, on) => {
  const { round2 } = await firstRound($, on, { codex: [codexSays('no JSON'), codexSays('still no JSON')] })

  const done = await nextRound($, round2, [ruling('C1', 'withdraw'), ruling('X1', 'dispute')], [said('Retry once.', 'A2')])

  expect(done.report.singleReviewer.claude.at(-1)).toEqual({ id: 'A2', answer: 'Retry once.', reasons: 'reasons for Retry once.', foundBy: 'claude', phase: 0, round: 2, status: 'not ruled on' })
})

test('a Codex usage limit pauses a question, and ask_round after retryAt runs Codex again', async ($, on) => {
  const { codex, clock } = world(on, { codex: [usageLimit, codexSays(codexFirst)] })

  const round1 = await begin($)
  await claude($, round1, claudeFirst)
  const paused = await call($, 'ask_round', { run: round1.run })

  expect(paused).toMatchObject({ status: 'paused', limit: 'usage_limit', instructions: expect.stringContaining('Call ask_round again after') })
  expect(await call($, 'ask_round', { run: round1.run })).toMatchObject({ status: 'paused' })
  expect(codex).toHaveLength(1)

  await clock.set(Date.parse(paused.retryAt) + 1)

  expect(await call($, 'ask_round', { run: round1.run })).toMatchObject({ status: 'round', round: 2 })
})

test('the session registers the three ask tools before git', async ($, on) => {
  const { registered } = world(on)

  await $.session.start({ cwd: top, surface: 'desktop', isInteractive: true })

  expect(registered.slice(registered.indexOf('ask_start'), registered.indexOf('git') + 1)).toEqual(['ask_start', 'ask_round', 'ask_cancel', 'git'])
})

test('a run of another kind is refused with the tool to call', async ($, on) => {
  const { files } = world(on)
  files['/work/design.md'] = '# Design\n'
  const ask = await begin($)
  const plan = await call($, 'plan_start', { args: '/work/design.md', pick: 'complex', isSure: true })
  const review = await call($, 'review_start', { args: '', pick: 'complex', isSure: true })
  const askRun = { run: ask.run }

  expect(await call($, 'review_round', askRun)).toEqual({ error: `Run ${ask.run} is an ask run: call ask_round.` })
  expect(await call($, 'review_settle', { ...askRun, id: 'C1', outcome: 'confirmed', evidence: 'e' })).toEqual({ error: `Run ${ask.run} is an ask run: call ask_round.` })
  expect(await call($, 'review_fixes', { ...askRun, ids: ['C1'] })).toEqual({ error: `Run ${ask.run} is an ask run: call ask_round.` })
  expect(await call($, 'review_cancel', askRun)).toEqual({ error: `Run ${ask.run} is an ask run: call ask_cancel.` })
  expect(await call($, 'plan_round', askRun)).toEqual({ error: `Run ${ask.run} is an ask run: call ask_round.` })
  expect(await call($, 'plan_revision', askRun)).toEqual({ error: `Run ${ask.run} is an ask run: call ask_round.` })
  expect(await call($, 'plan_cancel', askRun)).toEqual({ error: `Run ${ask.run} is an ask run: call ask_cancel.` })
  expect(await call($, 'ask_round', { run: plan.run })).toEqual({ error: `Run ${plan.run} is a plan run: call plan_round.` })
  expect(await call($, 'ask_cancel', { run: plan.run })).toEqual({ error: `Run ${plan.run} is a plan run: call plan_cancel.` })
  expect(await call($, 'ask_round', { run: review.run })).toEqual({ error: `Run ${review.run} is a review run: call review_round.` })
  expect(await call($, 'ask_cancel', { run: review.run })).toEqual({ error: `Run ${review.run} is a review run: call review_cancel.` })
  expect(await call($, 'ask_round', { run: 'abcdef12' })).toEqual({ error: 'There is no Confer run abcdef12.' })
  expect(state(files, ask.run).status).toBe('running')
})

// The snake_case words of the instructions that are not fields of the result, which are tool names.
const toolsIn = (result: any): string[] => {
  const fields = new Set([...Object.keys(result), ...Object.keys(result.agent ?? {})])
  return (result.instructions.replace(/mcp__confer__/g, '').match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? []).filter((word: string) => !fields.has(word))
}

test('only registered tools are in the instructions of each status', async ($, on) => {
  const { registered, clock } = world(on, { answers: noRepo, codex: [usageLimit, codexSays(codexFirst)] })
  on('session.cwd', () => ({ value: '/work' }))

  const round1 = await begin($)
  const paused = await call($, 'ask_round', { run: round1.run })
  await clock.set(Date.parse(paused.retryAt) + 1)
  const waiting = await call($, 'ask_round', { run: round1.run })
  await claude($, round1, 'no JSON')
  const retry = await call($, 'ask_round', { run: round1.run })
  await claude($, retry, claudeFirst)
  const round2 = await call($, 'ask_round', { run: round1.run })
  await $.agent.spawn({ prompt: 'p', description: round2.agent.description, subagentType: 'confer:reviewer-high', tool_use_id: 'toolu_c', background: true } as never)
  const running = await call($, 'ask_cancel', { run: round1.run })

  expect([round1, paused, waiting, retry, round2].map(r => r.status)).toEqual(['round', 'paused', 'waiting', 'round', 'round'])
  for (const result of [round1, paused, waiting, retry, round2, { instructions: running.error }]) {
    expect(toolsIn(result)).not.toEqual([])
    expect(toolsIn(result).filter(tool => !registered.includes(tool))).toEqual([])
  }
  expect(running.error).toContain('call ask_cancel again')
})

test('ask_cancel ends an ask run and reports each side\'s answers so far', async ($, on) => {
  const { files, round2 } = await firstRound($, on, { codex: [codexSays(later([ruling('X1', 'agree'), ruling('C1', 'dispute')]))] })

  const cancelled = await call($, 'ask_cancel', { run: round2.run })

  expect(cancelled).toMatchObject({
    status: 'cancelled',
    question,
    report: { outcome: 'cancelled', summary: expect.stringContaining('during the question'), singleReviewer: { claude: [{ id: 'C1', answer: 'Retry with a key.' }], codex: [{ id: 'X1' }] } },
  })
  expect(state(files, round2.run).status).toBe('cancelled')
  expect(await call($, 'ask_cancel', { run: round2.run })).toMatchObject({ status: 'cancelled', question })
})

const out = '/out/ask.json'

test('an ask run started with --findings asks no tier question and writes its report when it ends', async ($, on) => {
  const asked: unknown[] = []
  on('tool.call', { tool: 'AskUserQuestion' }, (_, e) => {
    asked.push(e.questions)
    return { result: { questions: e.questions, answers: { [e.questions[0]!.question]: 'Complex' } } }
  })
  const { files, round2 } = await firstRound($, on, { codex: [codexSays(later([ruling('X1', 'withdraw'), ruling('C1', 'agree')]))] }, { args: `--findings ${out} ${question}`, isSure: false })

  const done = await nextRound($, round2, [ruling('C1', 'agree'), ruling('X1', 'dispute')])

  expect(asked).toEqual([])
  expect(done).toMatchObject({ status: 'complete' })
  expect(done).not.toHaveProperty('findingsError')
  expect(JSON.parse(files[out]!)).toEqual({ run: round2.run, ...done.report })
  expect(JSON.parse(files[out]!)).toMatchObject({ question, confirmed: [{ id: 'C1', answer: 'Retry with a key.' }] })
})

test('session.end expires an ask run started with --findings and writes its file', async ($, on) => {
  const { files } = world(on)

  const round1 = await begin($, { args: `--findings=${out} ${question}` })
  await $.session.end({ reason: 'other', sessionId: 'session', resume: {} } as never)

  expect(state(files, round1.run)).toMatchObject({ status: 'expired', note: 'The session that ran it ended.' })
  expect(JSON.parse(files[out]!)).toMatchObject({ run: round1.run, question, outcome: 'expired' })
})

// ~/.claude is a link to /work/.claude, or to /elsewhere/.claude.
const linked = (to: string) => (path: string) => path.replace(/^\/home\/\.claude(?=\/|$)/, `${to}/.claude`)

test('a folder that contains the run directory through a link to the config folder is refused', async ($, on) => {
  world(on, { answers: noRepo, real: linked('/work') })
  on('session.cwd', () => ({ value: '/work' }))

  expect(await begin($)).toEqual({ error: expect.stringContaining('/work/.claude/tmp/confer') })
})

test('a folder that differs from the one with the run directory only in case is refused', async ($, on) => {
  world(on, { answers: noRepo })
  on('session.cwd', () => ({ value: '/Home' }))

  expect(await begin($)).toEqual({ error: expect.stringContaining(root) })
})

test('the brief excludes the real path of the run directory', async ($, on) => {
  const { files } = world(on, { answers: noRepo, real: linked('/elsewhere') })
  on('session.cwd', () => ({ value: '/work' }))

  const round1 = await begin($)

  expect(askPrompt(state(files, round1.run), 'codex', undefined)).toContain('Do not read anything in /elsewhere/.claude/tmp/confer,')
})

// On Windows, Codex starts in a folder of its attempt, inside the run root, in its worktree for a checkout and in its output folder outside one.
test('each side can read the folder it starts in when that folder is inside the run root', async ($, on) => {
  const { codexDirs, codexPrompts } = world(on, { answers: noRepo, codex: [codexSays(codexFirst)] })
  on('session.cwd', () => ({ value: 'Q:\\work' }))

  const round1 = await begin($)
  await claude($, round1, claudeFirst)
  await call($, 'ask_round', { run: round1.run })

  expect(codexDirs[0]!.startsWith(`${root}/`)).toBe(true)
  expect(codexPrompts[0]).toContain(`Do not read anything in ${root}, where Confer keeps its runs, except in the folder you start in.`)
})

test('on a case-sensitive volume, a folder that differs from the one with the run directory only in case is not refused', async ($, on) => {
  world(on, { answers: noRepo, exists: path => !path.startsWith('/hOME') })
  on('session.cwd', () => ({ value: '/Home' }))

  expect(await begin($)).toMatchObject({ status: 'round' })
})

test('a severity on a ruling is left out of the report of a question', async ($, on) => {
  const { round2 } = await firstRound($, on, { codex: [codexSays(later([ruling('X1', 'withdraw'), ruling('C1', 'agree', { severity: 'low' })]))] })

  const done = await nextRound($, round2, [ruling('C1', 'agree', { severity: 'medium' }), ruling('X1', 'dispute')])

  expect(done.report.confirmed[0].rulings).toHaveLength(2)
  for (const r of [...done.report.confirmed[0].rulings, ...done.report.withdrawn[0].rulings]) expect(r).not.toHaveProperty('severity')
})

test('a dispute of the other side\'s answer in an unfinished round is reported with that answer', async ($, on) => {
  const { round2 } = await firstRound($, on, { codex: [codexSays('no JSON'), codexSays('still no JSON')] })

  const done = await nextRound($, round2, [ruling('C1', 'agree'), ruling('X1', 'dispute')])

  expect(done.report.singleReviewer.codex.map((p: any) => [p.id, p.rulings.at(-1)])).toEqual([['X1', expect.objectContaining({ side: 'claude', round: 2, ruling: 'dispute' })]])
  expect(done.report.singleReviewer.claude.map((p: any) => [p.id, p.rulings.at(-1)])).toEqual([['C1', expect.objectContaining({ side: 'claude', round: 2, ruling: 'agree' })]])
})
