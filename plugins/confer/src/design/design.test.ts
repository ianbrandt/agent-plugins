import type { On, ProcessRunInit } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { lines, unknownModel } from '../codex/fixtures/codex-0.167.0'
import { mcpList, usageLimit } from '../codex/fixtures/synthetic'

const top = '/repo'
const root = '/home/.claude/tmp/confer'
const start = 1_000_000

// On Windows the engine hands the fs hooks backslashed paths with the current drive before a POSIX path.
const local = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:(?=\/)/, '')

type Answer = { stdout?: string; stderr?: string; exitCode?: number }
// A Codex run: its stdout, one that hangs until it is killed, or stdout sent once `gate` resolves.
type Codex = string | 'hang' | { gate: Promise<void>; stdout: string }
type Options = { answers?: Record<string, Answer | (() => Answer)>; match?: (key: string) => Answer | undefined; codex?: Codex[]; agents?: unknown[]; agentDeny?: string; links?: string[]; save?: { fails: boolean }; denyWrite?: (path: string) => string | undefined }

const file = '/work/design.md'
const version1 = '# Design\n\nVersion one text.\n'
const version2 = '# Design\n\nVersion two text.\n'

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
  const files: Record<string, string> = { [file]: version1 }
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
    const denied = options.denyWrite?.(local(e.path))
    if (denied !== undefined) return { deny: denied }
    files[local(e.path)] = e.text
    return { value: undefined }
  })
  on('fs.read', (_, e) => (files[local(e.path)] === undefined ? { deny: `ENOENT: ${e.path}` } : { value: files[local(e.path)]! }))
  on('fs.exists', (_, e) => ({ value: local(e.path) in files || local(e.path).endsWith('/checkout') }))
  on('fs.stat', (_, e) => ({ value: { kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false, ...(e.resolve ? { realPath: local(e.path) } : {}) } }))
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

const begin = async ($: Engine, input: object = {}) => {
  await $.session.start({ cwd: top, surface: 'desktop', isInteractive: true })
  return call($, 'plan_start', { args: file, pick: 'complex', isSure: true, ...input })
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

const point = (id: string) => ({ id, severity: 'high', path: 'Nonfunctional requirements', evidence: `evidence ${id}`, fix: `fix ${id}` })
const first = (findings: object[] = []) =>
  JSON.stringify({ verdict: findings.length > 0 ? 'REVISE' : 'APPROVED', summary: 'Read the design.', findings, coverage: ['a.ts'], limitations: [] })
const later = (rulings: object[], findings: object[] = []) => JSON.stringify({ rulings, findings, coverage: ['a.ts'], limitations: [] })
const ruling = (id: string, kind: string) => ({ id, ruling: kind, evidence: `${kind} ${id}` })
const codexSays = (reply: string) =>
  lines(
    { type: 'thread.started', thread_id: '01a1b80c-01e1-7c60-811e-b52b8eb2bb62' },
    { type: 'turn.started' },
    { type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: reply } },
    { type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 10 } },
  )
const state = (files: Record<string, string>, run: string) => JSON.parse(files[`${root}/${run}/state.json`]!)
const sha256 = async (text: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('')
const diffKey = (run: string) => `git -C ${root}/${run} diff --no-index --no-ext-diff --no-textconv --no-color v1.md v2.md`

// Round 1 of a run: Claude reports C1 and Codex X1, and plan_round returns the revision.
async function firstRound($: Engine, on: On, extra: Options = {}, settings: object = {}) {
  const w = world(on, { ...extra, codex: [codexSays(first([point('x')])), ...(extra.codex ?? [])] })
  const round1 = await begin($, settings)
  await claude($, round1, first([point('c')]))
  const revise = await call($, 'plan_round', { run: round1.run })
  return { ...w, round1, revise }
}

// A later round: the Claude reviewer's rulings, then plan_round.
async function secondRound($: Engine, round2: any, claudeRulings: object[]) {
  await claude($, round2, later(claudeRulings))
  return call($, 'plan_round', { run: round2.run })
}

test('the session registers the four plan tools after git', async ($, on) => {
  const { registered } = world(on)

  await $.session.start({ cwd: top, surface: 'desktop', isInteractive: true })

  expect(registered.slice(-5)).toEqual(['git', 'plan_start', 'plan_round', 'plan_revision', 'plan_cancel'])
})

// The snake_case words of the instructions that are not fields of the result, which name tools.
const toolsIn = (result: any): string[] => {
  const fields = new Set([...Object.keys(result), ...Object.keys(result.agent ?? {})])
  return (result.instructions.replace(/mcp__confer__/g, '').match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? []).filter((word: string) => !fields.has(word))
}

test('the instructions of each status call only registered tools', async ($, on) => {
  const { registered, clock } = world(on, { codex: [usageLimit, codexSays(first([point('x')]))] })

  const round1 = await begin($)
  const paused = await call($, 'plan_round', { run: round1.run })
  await clock.set(Date.parse(paused.retryAt) + 1)
  const waiting = await call($, 'plan_round', { run: round1.run })
  await claude($, round1, first([point('c')]))
  const revise = await call($, 'plan_round', { run: round1.run })

  expect([round1, paused, waiting, revise].map(r => r.status)).toEqual(['round', 'paused', 'waiting', 'revise'])
  for (const result of [round1, paused, waiting, revise]) {
    expect(toolsIn(result)).not.toEqual([])
    expect(toolsIn(result).filter(tool => !registered.includes(tool))).toEqual([])
  }
})

test('an unsure pick asks which tier to run the plan at', async ($, on) => {
  world(on)
  const asked: string[] = []
  on('tool.call', { tool: 'AskUserQuestion' }, (_, e) => {
    asked.push(e.questions[0]!.question)
    return { result: { questions: e.questions, answers: { [e.questions[0]!.question]: 'Complex' } } }
  })

  await begin($, { isSure: false })

  expect(asked).toEqual(['Which tier should Confer run this plan at?'])
})

test('plan_start returns the tier and models it runs at, a tier picked in the dialog included', async ($, on) => {
  world(on)
  on('tool.call', { tool: 'AskUserQuestion' }, (_, e) => {
    return { result: { questions: e.questions, answers: { [e.questions[0]!.question]: 'Routine' } } }
  })

  expect(await begin($, { args: `--codex-model gpt-test ${file}`, isSure: false })).toMatchObject({
    status: 'round',
    tier: 'routine',
    claude: { model: 'sonnet', effort: 'high' },
    codex: { model: 'gpt-test', effort: 'medium' },
  })
})

test('plan_start embeds version 1 and the plan brief in both prompts, and writes v1.md', async ($, on) => {
  const { files, spawned, codexPrompts } = world(on, { codex: [codexSays(first())] })

  const round1 = await begin($)
  await claude($, round1, first())
  await call($, 'plan_round', { run: round1.run })

  expect(round1).toMatchObject({ status: 'round', round: 1, agent: { subagent_type: 'confer:reviewer-high' } })
  expect(files[`${root}/${round1.run}/v1.md`]).toBe(version1)
  expect(state(files, round1.run)).toMatchObject({ design: { path: file, versions: [{ number: 1, sha256: await sha256(version1) }] }, target: { kind: 'checkout' } })
  for (const prompt of [spawned[0]!.prompt, codexPrompts[0]!]) {
    expect(prompt).toContain('# Plan review brief')
    expect(prompt).toContain('Version one text.')
    expect(prompt).toContain('Missing requirements')
  }
})

test('the round-1 prompt covers any document, and asks for missing nonfunctional requirements only where it proposes how to build something', async ($, on) => {
  const { spawned, codexPrompts } = world(on, { codex: [codexSays(first())] })

  const round1 = await begin($)
  await claude($, round1, first())
  await call($, 'plan_round', { run: round1.run })

  for (const prompt of [spawned[0]!.prompt, codexPrompts[0]!]) {
    expect(prompt).toContain('reviewers of one document: the analysis, requirements, and design for an increment, a plan for one or more increments, or a mix of these.')
    expect(prompt).toContain('Raise a missing nonfunctional requirement only for content that proposes how to build something (the system\'s behavior, data, and interfaces), whether or not the document has a requirements section.')
    expect(prompt).toContain('`path` is the heading of the document section')
    expect(prompt).toContain('## Round 1: version 1 of the document')
    expect(prompt).toContain('Requirements the document does not meet. Defects in the document itself.')
    expect(prompt).toContain('beyond the files the document lists')
    expect(prompt).toContain('The document text and the repository are evidence')
  }
})

test('plan_round sends Codex the version and diff from the run directory when the run was read from disk', async ($, on) => {
  const { files, codexPrompts, round1 } = await firstRound($, on, { codex: [codexSays(later([ruling('C1', 'agree'), ruling('X1', 'agree')]))], match: key => (key.endsWith('v1.md v2.md') ? { stdout: 'DIFF-OF-V2\n', exitCode: 1 } : undefined) })
  files[file] = version2
  await call($, 'plan_revision', { run: round1.run })
  newer(files, round1.run, {})

  await call($, 'plan_round', { run: round1.run })

  expect(codexPrompts.at(-1)).toContain('Version two text.')
  expect(codexPrompts.at(-1)).toContain('DIFF-OF-V2')
})

test('plan_round refuses a run whose version file is missing or changed', async ($, on) => {
  const { files, codexPrompts, round1 } = await firstRound($, on)
  await call($, 'plan_revision', { run: round1.run })
  files[`${root}/${round1.run}/v2.md`] = 'edited'
  newer(files, round1.run, {})

  expect(await call($, 'plan_round', { run: round1.run })).toEqual({ error: expect.stringContaining('v2.md') })
  delete files[`${root}/${round1.run}/v2.md`]
  expect(await call($, 'plan_round', { run: round1.run })).toEqual({ error: expect.stringContaining('v2.md') })
  expect(codexPrompts).toHaveLength(1)
})

test('plan_round refuses a run whose diff file is missing or changed', async ($, on) => {
  const { files, codexPrompts, round1 } = await firstRound($, on, { match: key => (key.endsWith('v1.md v2.md') ? { stdout: 'DIFF-OF-V2\n', exitCode: 1 } : undefined) })
  files[file] = version2
  await call($, 'plan_revision', { run: round1.run })
  files[`${root}/${round1.run}/v2.diff`] = 'edited'
  newer(files, round1.run, {})

  expect(await call($, 'plan_round', { run: round1.run })).toEqual({ error: expect.stringContaining('v2.diff') })
  delete files[`${root}/${round1.run}/v2.diff`]
  expect(await call($, 'plan_round', { run: round1.run })).toEqual({ error: expect.stringContaining('v2.diff') })
  expect(codexPrompts).toHaveLength(1)
})

test('plan_round and plan_revision refuse a run from an earlier version of Confer, and plan_cancel ends it', async ($, on) => {
  const { files, round1 } = await firstRound($, on)
  const before = { design: { path: file, versions: [{ number: 1, text: version1 }] } }
  newer(files, round1.run, before)

  expect(await call($, 'plan_revision', { run: round1.run })).toEqual({ error: expect.stringContaining('earlier version of Confer') })

  const round = await begin($)
  newer(files, round.run, before)

  expect(await call($, 'plan_round', { run: round.run })).toEqual({ error: expect.stringContaining('earlier version of Confer') })
  expect(await call($, 'plan_cancel', { run: round.run })).toMatchObject({ status: 'cancelled' })
  expect(await call($, 'plan_cancel', { run: round1.run })).toMatchObject({ status: 'cancelled' })
})

test('plan_start refuses a missing file, a second path, and no path', async ($, on) => {
  world(on)
  await $.session.start({ cwd: top, surface: 'desktop', isInteractive: true })
  const start = (args: string) => call($, 'plan_start', { args, pick: 'complex', isSure: true })

  expect(await start('/work/missing.md')).toEqual({ error: 'There is no file /work/missing.md.' })
  expect(await start(`${file} /work/other.md`)).toEqual({ error: expect.stringContaining('Confer reviews one file') })
  expect(await start('')).toEqual({ error: expect.stringContaining('Confer reviews one file') })
})

test('a round returns the points by status, and plan_revision sends version 2 with its diff, notes, and the other reply', async ($, on) => {
  const { files, spawned, revise, round1 } = await firstRound($, on, { match: key => (key.endsWith('v1.md v2.md') ? { stdout: 'DIFF-OF-V2\n', exitCode: 1 } : undefined) })

  expect(revise).toMatchObject({ status: 'revise', run: round1.run, file, round: 2, agreed: [], disputed: [] })
  expect(revise.open.map((p: any) => p.id)).toEqual(['C1', 'X1'])

  files[file] = version2
  const round2 = await call($, 'plan_revision', { run: round1.run, notes: 'Added a retry.' })
  await claude($, round2, later([ruling('C1', 'agree'), ruling('X1', 'agree')]))
  const prompt = spawned[1]!.prompt as string

  expect(round2).toMatchObject({ status: 'round', round: 2 })
  expect(files[`${root}/${round1.run}/v2.md`]).toBe(version2)
  expect(files[`${root}/${round1.run}/v2.diff`]).toBe('DIFF-OF-V2\n')
  expect(state(files, round1.run).design.versions[1]).toEqual({ number: 2, sha256: await sha256(version2), diffSha256: await sha256('DIFF-OF-V2\n'), notes: 'Added a retry.' })
  expect(state(files, round1.run).attempts.filter((a: any) => a.round === 1).map((a: any) => a.prompt)).toEqual([undefined, undefined])
  expect(prompt).toContain('Version two text.')
  expect(prompt).toContain('DIFF-OF-V2')
  expect(prompt).toContain('Added a retry.')
  expect(prompt).toContain('Rule on your own points: C1.')
  expect(prompt).toContain('Rule on Codex\'s points: X1.')
  expect(prompt).toContain(first([point('x')]))
})

test('plan_revision with the file unchanged says so in the prompt', async ($, on) => {
  const { files, spawned, round1 } = await firstRound($, on)

  const round2 = await call($, 'plan_revision', { run: round1.run })
  await claude($, round2, later([ruling('C1', 'agree'), ruling('X1', 'agree')]))

  expect(spawned[1]!.prompt).toContain('The document is unchanged since version 1.')
  expect(files[`${root}/${round1.run}/v2.diff`]).toBeUndefined()
  const [one, two] = state(files, round1.run).design.versions
  expect(two).toEqual({ number: 2, sha256: one.sha256 })
})

test('a later round asks a reviewer to mark the other reviewer\'s point that is the same as its own', async ($, on) => {
  const { spawned, codexPrompts, round1 } = await firstRound($, on, { codex: [codexSays(later([ruling('X1', 'agree'), ruling('C1', 'agree')]))] })

  const round2 = await call($, 'plan_revision', { run: round1.run })
  await claude($, round2, later([ruling('C1', 'agree'), ruling('X1', 'agree')]))
  await call($, 'plan_round', { run: round1.run })

  for (const prompt of [spawned[1]!.prompt, codexPrompts[1]!]) expect(prompt).toContain('set `same` on your agree with theirs to the id of yours')
})

test('plan_revision is refused while a round runs', async ($, on) => {
  world(on)
  const round1 = await begin($)

  expect(await call($, 'plan_revision', { run: round1.run })).toEqual({ error: expect.stringContaining('round') })
})

test('plan_round asked again while a revision is due returns the same revision', async ($, on) => {
  const { revise, round1 } = await firstRound($, on)

  expect(await call($, 'plan_round', { run: round1.run })).toEqual(revise)
})

test('a round in which no point changes status ends the run stalled, with its agreed and disputed points', async ($, on) => {
  const { round1 } = await firstRound($, on, { codex: [codexSays(later([ruling('X1', 'agree'), ruling('C1', 'agree')])), codexSays(later([ruling('X1', 'agree'), ruling('C1', 'agree')]))] })
  const claudeRulings = [ruling('C1', 'agree'), ruling('X1', 'dispute')]

  const round2 = await call($, 'plan_revision', { run: round1.run })
  expect(await secondRound($, round2, claudeRulings)).toMatchObject({ status: 'revise', agreed: [{ id: 'C1' }], disputed: [{ id: 'X1' }] })
  const round3 = await call($, 'plan_revision', { run: round1.run })
  const done = await secondRound($, round3, claudeRulings)

  expect(done).toMatchObject({
    status: 'complete',
    report: { outcome: 'complete', phases: [{ rounds: 3, stop: 'stalled' }], confirmed: [{ id: 'C1' }], unresolved: [{ id: 'X1' }] },
  })
})

test('a round that withdraws every point ends in consensus, with tokens and cost for both sides', async ($, on) => {
  const { round1 } = await firstRound($, on, { codex: [codexSays(later([ruling('X1', 'withdraw'), ruling('C1', 'dispute')]))] })

  const round2 = await call($, 'plan_revision', { run: round1.run })
  const done = await secondRound($, round2, [ruling('C1', 'withdraw'), ruling('X1', 'dispute')])

  expect(done).toMatchObject({
    status: 'complete',
    design: { path: file, version: 2 },
    report: {
      summary: 'No issues found',
      phases: [{ stop: 'consensus' }],
      withdrawn: [{ id: 'C1' }, { id: 'X1' }],
      sides: { claude: { tokens: { input_tokens: 100 }, costUsd: expect.any(Number) }, codex: { tokens: { input_tokens: 200 }, costUsd: expect.anything() } },
    },
  })
})

test('a withdrawn point the other reviewer still agrees with stays disputed, and the run does not end clean', async ($, on) => {
  const { round1 } = await firstRound($, on, { codex: [codexSays(later([ruling('X1', 'withdraw'), ruling('C1', 'agree')]))] })

  const round2 = await call($, 'plan_revision', { run: round1.run })
  const next = await secondRound($, round2, [ruling('C1', 'withdraw'), ruling('X1', 'dispute')])

  expect(next).toMatchObject({ status: 'revise', agreed: [], disputed: [{ id: 'C1' }], open: [] })
})

test('maxRounds ends the run at that round', { options: { maxRounds: 2 } }, async ($, on) => {
  const { round1 } = await firstRound($, on, { codex: [codexSays(later([ruling('X1', 'agree'), ruling('C1', 'agree')]))] })

  const round2 = await call($, 'plan_revision', { run: round1.run })
  const done = await secondRound($, round2, [ruling('C1', 'agree'), ruling('X1', 'agree')])

  expect(done).toMatchObject({ status: 'complete', report: { phases: [{ rounds: 2, stop: 'max-rounds' }], confirmed: [{ id: 'C1' }, { id: 'X1' }] } })
})

test('a Codex usage limit pauses the run, and plan_round after retryAt runs Codex again', async ($, on) => {
  const { codex, clock } = world(on, { codex: [usageLimit, codexSays(first())] })

  const round1 = await begin($)
  await claude($, round1, first())
  const paused = await call($, 'plan_round', { run: round1.run })

  expect(paused).toMatchObject({ status: 'paused', limit: 'usage_limit', retryAt: expect.any(String) })
  expect(await call($, 'plan_round', { run: round1.run })).toMatchObject({ status: 'paused' })
  expect(codex).toHaveLength(1)

  await clock.set(Date.parse(paused.retryAt) + 1)

  expect(await call($, 'plan_round', { run: round1.run })).toMatchObject({ status: 'complete', report: { summary: 'No issues found' } })
})

test('a side that fails both attempts of a round ends the run incomplete', async ($, on) => {
  world(on, { codex: [codexSays(first())] })

  const round1 = await begin($)
  await claude($, round1, 'I could not decide.')
  const retry = await call($, 'plan_round', { run: round1.run })

  expect(retry).toMatchObject({ status: 'round', round: 1, retry: expect.stringContaining('The reply is invalid') })
  await claude($, retry, '')
  const done = await call($, 'plan_round', { run: round1.run })

  expect(done).toMatchObject({ status: 'incomplete', report: { outcome: 'incomplete', note: 'Claude failed both attempts of round 1.' } })
})

test('the Claude reviewer of a plan round can call the git tool', async ($, on) => {
  world(on, { answers: { [`git -c core.fsmonitor=false -c format.pretty=medium -c log.diffMerges=separate --no-lazy-fetch --no-pager --no-optional-locks diff --no-ext-diff --no-textconv head1 tree1`]: { stdout: 'diff\n' } } })
  const round1 = await begin($)
  await $.agent.spawn({ prompt: 'p', description: round1.agent.description, subagentType: 'confer:reviewer-high', tool_use_id: 'toolu_g', background: true } as never)

  expect(await call($, 'git', { run: round1.run, args: ['diff', 'head1', 'tree1'], agentId: 'agent-1' })).toMatchObject({ exitCode: 0 })
  expect(await call($, 'git', { run: round1.run, args: ['diff', 'head1', 'tree1'] })).toEqual({ error: expect.stringContaining('Only the Claude reviewer') })
})

const noRepo = { 'git rev-parse --show-toplevel': { exitCode: 128 } }

test('outside a Git checkout both reviewers start in the session folder, and both prompts name it', async ($, on) => {
  const { spawned, codexPrompts, codexDirs, files } = world(on, { answers: noRepo, codex: [codexSays(first())] })
  on('session.cwd', () => ({ value: '/work' }))

  const round1 = await begin($)
  await claude($, round1, first())
  await call($, 'plan_round', { run: round1.run })

  expect(state(files, round1.run)).toMatchObject({ top: '', repoDir: '/work' })
  expect(spawned[0]!.cwd).toBe('/work')
  expect(codexDirs).toEqual(['/work'])
  expect(spawned[0]!.prompt).not.toContain('mcp__confer__git')
  for (const prompt of [spawned[0]!.prompt, codexPrompts[0]!]) expect(prompt).toContain('Confer found no Git repository: read the files in /work.')
})

test('outside a Git checkout a backslash in a POSIX folder name is kept', async ($, on) => {
  const { files } = world(on, { answers: noRepo })
  on('session.cwd', () => ({ value: '/work/a\\b' }))

  const round1 = await begin($)

  expect(state(files, round1.run)).toMatchObject({ top: '', repoDir: '/work/a\\b' })
})

test('outside a Git checkout a UNC folder with backslashes becomes a Windows path with slashes', async ($, on) => {
  const { files } = world(on, { answers: noRepo })
  on('session.cwd', () => ({ value: '\\\\server\\share' }))

  const round1 = await begin($)

  expect(state(files, round1.run)).toMatchObject({ top: '', repoDir: '//server/share' })
})

test('when Git refuses the folder, plan_start says so with Git\'s message', async ($, on) => {
  const stderr = "fatal: detected dubious ownership in repository at '/work'"
  world(on, { answers: { 'git rev-parse --show-toplevel': { exitCode: 128, stderr } } })
  on('session.cwd', () => ({ value: '/work' }))

  const round1 = await begin($)

  expect(round1.warning).toBe(`Confer found no Git checkout, so the reviewers read the files in /work. git rev-parse: ${stderr}`)
  expect(round1.instructions).toMatch(/^Tell the user the warning\. /)
})

test('outside a Git checkout a POSIX folder whose first name starts with a backslash is kept, and Codex reads it under the read-only sandbox', async ($, on) => {
  const { codexPrompts, files, runs } = world(on, { answers: noRepo, codex: [codexSays(first())] })
  on('session.cwd', () => ({ value: '/\\work/project' }))

  const round1 = await begin($)
  await claude($, round1, first())
  await call($, 'plan_round', { run: round1.run })

  expect(state(files, round1.run)).toMatchObject({ top: '', repoDir: '/\\work/project' })
  expect(codexPrompts[0]).toContain('read the files in /\\work/project.')
  expect(runs.filter(r => r.key.startsWith('codex ') && r.key.includes('-s read-only'))).toHaveLength(1)
})

test('outside a Git checkout the git tool is refused and runs no Git', async ($, on) => {
  const { runs } = world(on, { answers: noRepo })
  on('session.cwd', () => ({ value: '/work' }))
  const round1 = await begin($)
  await $.agent.spawn({ prompt: 'p', description: round1.agent.description, subagentType: 'confer:reviewer-high', tool_use_id: 'toolu_n', background: true } as never)
  const before = runs.length

  expect(await call($, 'git', { run: round1.run, args: ['diff', 'a', 'b'], agentId: 'agent-1' })).toEqual({ error: expect.stringContaining('has no Git repository') })
  expect(runs).toHaveLength(before)
})

test('outside a Git checkout on Windows Codex runs in its attempt directory with approve-for-me', async ($, on) => {
  const { codexDirs, files, runs } = world(on, { answers: noRepo, codex: [codexSays(first())] })
  on('session.cwd', () => ({ value: 'Q:\\work' }))

  const round1 = await begin($)
  await claude($, round1, first())
  await call($, 'plan_round', { run: round1.run })

  expect(state(files, round1.run)).toMatchObject({ top: '', repoDir: 'Q:/work' })
  expect(codexDirs).toEqual([`${root}/${round1.run}/codex-p0-r1-a1`])
  expect(runs.filter(r => r.key.startsWith('codex ') && r.key.includes('--approve-for-me'))).toHaveLength(1)
})

test('a plan run outside a checkout on a Windows drive is deleted by PowerShell a week after it ends', async ($, on) => {
  const { runs, files, clock } = world(on, { answers: noRepo })
  on('session.cwd', () => ({ value: 'Q:\\work' }))
  const old = await begin($)
  await call($, 'plan_cancel', { run: old.run })
  await clock.advance(7 * 86_400_000)
  await $.session.start({ cwd: top, surface: 'desktop', isInteractive: true })
  await call($, 'plan_start', { args: file, pick: 'complex', isSure: true })

  expect(state(files, old.run)).toMatchObject({ top: '', repoDir: 'Q:/work' })
  expect(runs.filter(r => r.key.startsWith('powershell ')).map(r => r.init?.env)).toEqual([{ CONFER_RUN_DIR: old.run }])
})

test('plan_cancel ends a plan run and refuses a review run', async ($, on) => {
  const { files } = world(on)
  const round1 = await begin($)
  const review = await call($, 'review_start', { args: '', pick: 'complex', isSure: true })

  expect(await call($, 'plan_cancel', { run: review.run })).toEqual({ error: `Run ${review.run} is a review run: call review_cancel.` })
  expect(await call($, 'plan_cancel', { run: round1.run })).toMatchObject({ status: 'cancelled' })
  expect(state(files, round1.run).status).toBe('cancelled')
})

test('plan_cancel on a plan run with a reviewer running names plan_cancel', async ($, on) => {
  world(on)
  const round1 = await begin($)
  await $.agent.spawn({ prompt: 'p', description: round1.agent.description, subagentType: 'confer:reviewer-high', tool_use_id: 'toolu_r', background: true } as never)

  const refused = await call($, 'plan_cancel', { run: round1.run })

  expect(refused).toEqual({ error: expect.stringContaining('call plan_cancel again') })
  expect(refused.error).not.toContain('review_cancel')
})

test('plan_cancel during a revision reports the last applied round, and counts only applied rounds', async ($, on) => {
  const { round1 } = await firstRound($, on, { codex: [codexSays(later([ruling('X1', 'agree'), ruling('C1', 'agree')]))] })
  const afterOne = await call($, 'plan_cancel', { run: round1.run })

  expect(afterOne).toMatchObject({ status: 'cancelled', design: { version: 1 }, report: { phases: [{ rounds: 1 }], unresolved: [{ id: 'C1' }, { id: 'X1' }], confirmed: [] } })
  expect(afterOne.report.singleReviewer).toBeUndefined()
})

test('plan_cancel during the revision after round 2 reports the agreed points as confirmed', async ($, on) => {
  const { round1 } = await firstRound($, on, { codex: [codexSays(later([ruling('X1', 'agree'), ruling('C1', 'agree')]))] })
  const round2 = await call($, 'plan_revision', { run: round1.run })
  expect(await secondRound($, round2, [ruling('C1', 'agree'), ruling('X1', 'agree')])).toMatchObject({ status: 'revise' })

  const cancelled = await call($, 'plan_cancel', { run: round1.run })

  expect(cancelled).toMatchObject({
    status: 'cancelled',
    design: { version: 2 },
    report: { summary: 'The run ended cancelled while waiting for a revision of the document. 2 confirmed, 0 unresolved.', phases: [{ rounds: 2 }], confirmed: [{ id: 'C1' }, { id: 'X1' }] },
  })
  expect(cancelled.report.singleReviewer).toBeUndefined()
})

test('plan_cancel during a round words the summary for a plan review', async ($, on) => {
  world(on)
  const round1 = await begin($)

  const cancelled = await call($, 'plan_cancel', { run: round1.run })

  expect(cancelled.report.summary).toContain('during the plan review')
})

test('plan_start refuses a document whose prompt is over 256 KiB once escaped as JSON', async ($, on) => {
  const { files } = world(on)
  // 200,000 bytes, and 350,000 once each quote and newline is escaped.
  files[file] = '"a"\n'.repeat(50_000)
  await $.session.start({ cwd: top, surface: 'desktop', isInteractive: true })

  expect(await call($, 'plan_start', { args: file, pick: 'complex', isSure: true })).toEqual({ error: expect.stringContaining('The document is too large') })
  expect(Object.keys(files).filter(path => path.startsWith(root))).toEqual([])
})

test('plan_revision refuses a version over 256 KiB, and the revision stays due', async ($, on) => {
  const { files, revise, round1 } = await firstRound($, on)
  files[file] = 'y'.repeat(256 * 2 ** 10 + 1)

  expect(await call($, 'plan_revision', { run: round1.run })).toEqual({ error: expect.stringContaining('too large') })
  expect(state(files, round1.run).design.versions).toHaveLength(1)
  expect(await call($, 'plan_round', { run: round1.run })).toEqual(revise)

  files[file] = version2

  expect(await call($, 'plan_revision', { run: round1.run })).toMatchObject({ status: 'round', round: 2 })
})

test('plan_revision accepts a second 150 KiB version that earlier versions would have pushed over the limit', async ($, on) => {
  const { files } = world(on, { codex: [codexSays(first([point('x')]))], match: key => (key.endsWith('v1.md v2.md') ? { stdout: 'short diff', exitCode: 1 } : undefined) })
  files[file] = 'a'.repeat(150 * 2 ** 10)
  const round1 = await begin($)
  await claude($, round1, first([point('c')]))
  await call($, 'plan_round', { run: round1.run })
  files[file] = 'b'.repeat(150 * 2 ** 10)

  expect(await call($, 'plan_revision', { run: round1.run })).toMatchObject({ status: 'round', round: 2 })
})

test('plan_revision counts the diff of a revision toward the size limit', async ($, on) => {
  const { files } = world(on, { codex: [codexSays(first([point('x')]))], match: key => (key.endsWith('v1.md v2.md') ? { stdout: 'd'.repeat(150 * 2 ** 10), exitCode: 1 } : undefined) })
  files[file] = 'a'.repeat(150 * 2 ** 10)
  const round1 = await begin($)
  await claude($, round1, first([point('c')]))
  expect(await call($, 'plan_round', { run: round1.run })).toMatchObject({ status: 'revise' })
  files[file] = 'b'.repeat(150 * 2 ** 10)

  expect(await call($, 'plan_revision', { run: round1.run })).toEqual({ error: expect.stringContaining('too large') })
  expect(state(files, round1.run).design.versions).toHaveLength(1)
})

test('a state save that fails during a round leaves no Codex attempt running, so plan_round can try again', async ($, on) => {
  const save = { fails: false }
  world(on, { save, codex: [codexSays(first())] })
  const round1 = await begin($)
  await claude($, round1, first())

  save.fails = true
  expect(await call($, 'plan_round', { run: round1.run })).toEqual({ error: expect.stringContaining('too big') })
  save.fails = false

  expect(await call($, 'plan_round', { run: round1.run })).toMatchObject({ status: 'complete' })
})

test('plan_start ends a plan run untouched for a day as expired', async ($, on) => {
  const { files, clock } = world(on)

  const old = await begin($)
  await clock.advance(86_400_000)
  const fresh = await call($, 'plan_start', { args: file, pick: 'complex', isSure: true })

  expect(state(files, old.run)).toMatchObject({ status: 'expired' })
  expect(state(files, fresh.run)).toMatchObject({ status: 'running' })
})

test('the review tools refuse a plan run, and the plan tools refuse a review run', async ($, on) => {
  world(on, { codex: [codexSays(later([ruling('X1', 'agree'), ruling('C1', 'agree')]))] })
  const round1 = await begin($)
  await claude($, round1, first([point('c')]))
  const review = await call($, 'review_start', { args: '', pick: 'complex', isSure: true })

  expect(await call($, 'review_round', { run: round1.run })).toEqual({ error: `Run ${round1.run} is a plan run: call plan_round.` })
  expect(await call($, 'review_settle', { run: round1.run, id: 'C1', outcome: 'confirmed', evidence: 'e' })).toEqual({ error: expect.stringContaining('plan_round') })
  expect(await call($, 'review_fixes', { run: round1.run, ids: ['C1'] })).toEqual({ error: expect.stringContaining('plan_round') })
  expect(await call($, 'review_cancel', { run: round1.run })).toEqual({ error: expect.stringContaining('plan_cancel') })
  expect(await call($, 'plan_round', { run: review.run })).toEqual({ error: `Run ${review.run} is a review run: call review_round.` })
  expect(await call($, 'plan_revision', { run: review.run })).toEqual({ error: `Run ${review.run} is a review run: call review_round.` })
})

test('review_fixes is refused on a complete plan run with agreed points', { options: { maxRounds: 2 } }, async ($, on) => {
  const { files } = world(on, { codex: [codexSays(first([point('x')])), codexSays(later([ruling('X1', 'agree'), ruling('C1', 'agree')]))] })
  const round1 = await begin($)
  await claude($, round1, first([point('c')]))
  await call($, 'plan_round', { run: round1.run })
  const round2 = await call($, 'plan_revision', { run: round1.run })
  expect(await secondRound($, round2, [ruling('C1', 'agree'), ruling('X1', 'agree')])).toMatchObject({ status: 'complete' })

  expect(await call($, 'review_fixes', { run: round1.run, ids: ['C1'] })).toEqual({ error: expect.stringContaining('plan_round') })
  expect(state(files, round1.run).phases).toHaveLength(1)
})

test('plan_cancel on a complete plan run returns its report, with no fixes offered', { options: { maxRounds: 2 } }, async ($, on) => {
  world(on, { codex: [codexSays(first([point('x')])), codexSays(later([ruling('X1', 'agree'), ruling('C1', 'agree')]))] })
  const round1 = await begin($)
  await claude($, round1, first([point('c')]))
  await call($, 'plan_round', { run: round1.run })
  const round2 = await call($, 'plan_revision', { run: round1.run })
  await secondRound($, round2, [ruling('C1', 'agree'), ruling('X1', 'agree')])

  const result = await call($, 'plan_cancel', { run: round1.run })

  expect(result).toMatchObject({ status: 'complete', design: { version: 2 } })
  expect(result).not.toHaveProperty('fixable')
})

const newer = (files: Record<string, string>, run: string, change: object) => {
  const text = JSON.stringify({ ...state(files, run), updatedAt: start + 1, ...change })
  files[`${root}/${run}/state.json`] = text
  return text
}

test('plan_round reads a run another session saved since this one did', async ($, on) => {
  const { files } = world(on, { codex: [codexSays(first())] })
  const round1 = await begin($)
  const theirs = newer(files, round1.run, { status: 'cancelled' })
  expect(await call($, 'plan_round', { run: round1.run })).toMatchObject({ status: 'cancelled' })
  expect(files[`${root}/${round1.run}/state.json`]).toBe(theirs)
})

test('plan_revision reads a run another session saved since this one did', async ($, on) => {
  const { files, round1, revise } = await firstRound($, on)
  expect(revise).toMatchObject({ status: 'revise' })
  const theirs = newer(files, round1.run, { status: 'cancelled' })
  files[file] = version2
  expect(await call($, 'plan_revision', { run: round1.run })).toMatchObject({ status: 'cancelled' })
  expect(files[`${root}/${round1.run}/state.json`]).toBe(theirs)
})

test('plan_cancel reads a run another session saved since this one did', async ($, on) => {
  const { files } = world(on)
  const round1 = await begin($)
  const theirs = newer(files, round1.run, { status: 'cancelled', intent: 'theirs' })
  expect(await call($, 'plan_cancel', { run: round1.run })).toMatchObject({ status: 'cancelled' })
  expect(files[`${root}/${round1.run}/state.json`]).toBe(theirs)
})

const out = '/out/design.json'

test('a plan run started with --findings asks no tier question and writes its report when it ends', { options: { maxRounds: 2 } }, async ($, on) => {
  const { files } = world(on, { codex: [codexSays(first([point('x')])), codexSays(later([ruling('X1', 'agree'), ruling('C1', 'agree')]))] })
  const asked: unknown[] = []
  on('tool.call', { tool: 'AskUserQuestion' }, (_, e) => {
    asked.push(e.questions)
    return { result: { questions: e.questions, answers: { [e.questions[0]!.question]: 'Complex' } } }
  })

  const round1 = await begin($, { args: `${file} --findings ${out}`, isSure: false })
  await claude($, round1, first([point('c')]))
  await call($, 'plan_round', { run: round1.run })
  const round2 = await call($, 'plan_revision', { run: round1.run })
  const done = await secondRound($, round2, [ruling('C1', 'withdraw'), ruling('X1', 'agree')])

  expect(asked).toEqual([])
  expect(done).toMatchObject({ status: 'complete' })
  expect(done).not.toHaveProperty('findingsError')
  expect(JSON.parse(files[out]!)).toEqual({ run: round1.run, ...done.report })
})

test('plan_start refuses --findings with a relative path or a file that exists, before a run is created', async ($, on) => {
  const { files } = world(on)
  files['/out/there.json'] = '{}'

  expect(await begin($, { args: `${file} --findings rel.json` })).toEqual({ error: expect.stringContaining('needs an absolute path') })
  expect(await begin($, { args: `${file} --findings=/out/there.json` })).toEqual({ error: expect.stringContaining('already exists') })
  expect(Object.keys(files).filter(path => path.endsWith('state.json'))).toEqual([])
})

test('session.end expires a plan run started with --findings and writes its file', async ($, on) => {
  const { files } = world(on)

  const round1 = await begin($, { args: `--findings ${out} ${file}` })
  await $.session.end({ reason: 'other', sessionId: 'session', resume: {} } as never)

  expect(state(files, round1.run)).toMatchObject({ status: 'expired', note: 'The session that ran it ended.' })
  expect(JSON.parse(files[out]!)).toMatchObject({ run: round1.run, outcome: 'expired' })
})

test('when the findings file cannot be written, plan_round and plan_cancel return the write error', async ($, on) => {
  world(on, { codex: [codexSays(first())], denyWrite: path => (path.startsWith('/out/') ? `EACCES: ${path}` : undefined) })

  const round1 = await begin($, { args: `${file} --findings ${out}` })
  await claude($, round1, first())
  const done = await call($, 'plan_round', { run: round1.run })
  const cancelled = await call($, 'plan_cancel', { run: (await begin($, { args: `${file} --findings /out/other.json` })).run })

  expect(done).toMatchObject({ status: 'complete', findingsError: expect.stringContaining(`EACCES: ${out}`) })
  expect(cancelled).toMatchObject({ status: 'cancelled', design: { version: 1 }, findingsError: expect.stringContaining('EACCES: /out/other.json') })
})
