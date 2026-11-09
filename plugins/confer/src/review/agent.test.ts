import type { AgentSpawnInput, EngineInterface, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { lines } from '../codex/fixtures/codex-0.167.0'
import { mcpList } from '../codex/fixtures/synthetic'
import { onAgentCall, onSpawn, onTurn } from './agent'
import { reviewerPrefix } from './attempts'
import { estimateClaudeCostUsd } from './cost'
import { getRun, remember } from './state'
import type { RunState } from './state'

const top = '/repo'
const root = '/home/.claude/tmp/confer'

// On Windows the engine hands the fs hooks backslashed paths with the current drive before a POSIX path.
const local = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:(?=\/)/, '')

const answers: Record<string, string> = {
  'git rev-parse --show-toplevel': `${top}\n`,
  'git rev-parse --show-prefix': '\n',
  [`git -C ${top} rev-parse HEAD`]: 'head1\n',
  [`git -C ${top} write-tree #index`]: 'tree1\n',
  [`git -C ${top} diff --no-renames --name-only -z head1 tree1`]: 'a.ts\0',
  [`git -C ${top} rev-parse --show-toplevel`]: `${top}\n`,
  'codex --version': 'codex-cli 0.167.0\n',
  'codex mcp list --json --disable apps --disable plugins': mcpList,
}

// The world beneath Confer, with one Codex run. As on Claude Code 2.1.319, `handback` is the reviewer's reply in the Agent result.
// `async_launched` is the Agent result of a reviewer that was moved to the background, as in the desktop app.
function world(on: On, codex: { stdout: string }, handback?: string, storage = { isFull: false }, status: 'completed' | 'async_launched' = 'completed') {
  const files: Record<string, string> = {}
  const spawned: { tool_use_id: string; prompt: string }[] = []
  mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/home' })
  on('process.run', (_, e) => {
    const key = e.argv.join(' ') + (e.init?.env?.GIT_INDEX_FILE ? ' #index' : '')
    // The run directory is in no repository.
    const exitCode = key.startsWith(`git -C ${root}/`) && key.endsWith('rev-parse --show-toplevel') ? 128 : 0
    return { value: { exitCode, stdout: answers[key] ?? '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('process.spawn', async function* (_, e) {
    if (e.argv[0] === 'git') {
      const stdout = answers[e.argv.join(' ')]
      if (stdout) yield { stream: 'stdout' as const, text: stdout }
      return { value: { code: 0, signal: null } }
    }
    yield { stream: 'stdout' as const, text: codex.stdout }
    return { value: { code: 0, signal: null } }
  })
  on('fs.write', (_, e) => {
    if (storage.isFull && local(e.path).endsWith('/state.json')) return { deny: 'ENOSPC' }
    files[local(e.path)] = e.text
    return { value: undefined }
  })
  on('fs.read', (_, e) => (files[local(e.path)] === undefined ? { deny: `ENOENT: ${e.path}` } : { value: files[local(e.path)]! }))
  on('fs.exists', (_, e) => ({ value: local(e.path) in files }))
  on('fs.stat', (_, e) => ({ value: { kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false, ...(e.resolve ? { realPath: local(e.path) } : {}) } }))
  on('fs.list', () => ({ value: [] }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__confer__${e.name}` } }))
  on('agent.register', (_, e) => ({ value: { agent: `confer:${e.name}` } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.offer', () => ({ isOffered: true }))
  on('agent.spawn', (_, e) => {
    spawned.push(e)
    return { model: e.model ?? 'inherit', agentId: `agent-${spawned.length}` }
  })
  on('agent.list', () => ({ value: [] }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('tool.call', { tool: 'Agent' }, (_, e) => ({
    result: {
      status,
      agentId: `agent-${spawned.findIndex(s => s.tool_use_id === e.tool_use_id) + 1}`,
      resolvedModel: 'claude-opus-5-5',
      ...(status === 'async_launched' ? {} : {
        usage: { input_tokens: 50, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        ...(handback === undefined ? {} : { handbackReport: { text: handback } }),
      }),
    } as never,
  }))
  return spawned
}

const call = async ($: Engine, name: string, input: object = {}): Promise<any> =>
  JSON.parse(String((await $.tool.call({ tool: `mcp__confer__${name}`, ...input } as never)).result))

const codexSays = (reply: string) =>
  lines(
    { type: 'thread.started', thread_id: '01a1b80c-01e1-7c60-811e-b52b8eb2bb62' },
    { type: 'turn.started' },
    { type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: reply } },
    { type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 10 } },
  )
const approved = JSON.stringify({ verdict: 'APPROVED', summary: 'Read the change.', findings: [], coverage: ['a.ts'], limitations: [] })
const revise = JSON.stringify({
  verdict: 'REVISE',
  summary: 'Read the change.',
  findings: [{ id: '1', severity: 'high', path: 'a.ts', line: 3, evidence: 'evidence 1', fix: 'fix 1' }],
  coverage: ['a.ts'],
  limitations: [],
})

const spawn = ($: Engine, agent: { subagent_type: string; description: string; prompt: string }, tool_use_id: string) =>
  $.agent.spawn({ prompt: agent.prompt, description: agent.description, subagentType: agent.subagent_type, tool_use_id, background: true } as never)

// Spawns the reviewer, so that a test can send its Agent call and its turn.complete in either order.
async function reviewer($: Engine) {
  await $.session.start({ cwd: top, surface: 'desktop', isInteractive: true })
  const round1 = await call($, 'review_start', { args: '', pick: 'complex', isSure: true })
  const { subagent_type, description, prompt } = round1.agent
  const { agentId } = await spawn($, round1.agent, 'toolu_1')
  return {
    run: round1.run as string,
    agentCall: () => $.tool.call({ tool: 'Agent', tool_use_id: 'toolu_1', description, prompt, subagent_type } as never),
    answer: (text: string, usage?: object) => $.turn.complete({ answer: text, agentId, durationMs: 1, isAborted: false, turnId: 't', reason: 'answer', usage } as never),
  }
}

// Installed beneath other plugins' turn.complete hooks, Confer got the reviewer's answer after its Agent call returned, and failed every round.
test("a reply in the Agent result is accepted before the reviewer's turn.complete arrives", async ($, on) => {
  const spawned = world(on, { stdout: codexSays(approved) }, revise)
  const { run, agentCall, answer } = await reviewer($)

  await agentCall()
  const next = await call($, 'review_round', { run })
  await answer(revise)

  expect(next).toMatchObject({ status: 'round', round: 2 })
  expect(next.retry).toBeUndefined()
  await spawn($, next.agent, 'toolu_2')
  expect(spawned[1]!.prompt).toContain('Rule on your own findings: C1.')
})

test('a reply that came with turn.complete is not received again from the Agent result', async ($, on) => {
  const spawned = world(on, { stdout: codexSays(approved) }, approved)
  const { run, agentCall, answer } = await reviewer($)

  await answer(revise)
  await agentCall()

  const next = await call($, 'review_round', { run })
  expect(next).toMatchObject({ status: 'round', round: 2 })
  expect(next.retry).toBeUndefined()
  await spawn($, next.agent, 'toolu_2')
  expect(spawned[1]!.prompt).toContain('Rule on your own findings: C1.')
})

test('a reviewer moved to the background is priced from its turn.complete', async ($, on) => {
  world(on, { stdout: codexSays(approved) }, undefined, undefined, 'async_launched')
  const { run, agentCall, answer } = await reviewer($)
  const usage = { input_tokens: 1000, output_tokens: 100, cache_creation_input_tokens: 10, cache_read_input_tokens: 20 }

  await agentCall()
  await answer(approved, { ...usage, model: 'claude-opus-5-5' })

  const done = await call($, 'review_round', { run })
  expect(done.report.sides.claude).toMatchObject({ resolvedModels: ['claude-opus-5-5'], tokens: usage, costUsd: estimateClaudeCostUsd('claude-opus-5-5', usage) })
  expect(done.report.sides.claude.costUsd).toBeGreaterThan(0)
})

test('a reviewer that replied with no usage reported is priced as unknown', async ($, on) => {
  world(on, { stdout: codexSays(approved) }, undefined, undefined, 'async_launched')
  const { run, agentCall, answer } = await reviewer($)

  await agentCall()
  await answer(approved)

  const done = await call($, 'review_round', { run })
  expect(done.report.sides.claude).toMatchObject({ resolvedModels: [], costUsd: null })
  expect(done.report.sides.claude.tokens).toEqual({})
})

test('an invalid reply in the Agent result fails its attempt with a retry', async ($, on) => {
  world(on, { stdout: codexSays(approved) }, 'Looks fine.')
  const { run, agentCall } = await reviewer($)

  await agentCall()

  expect(await call($, 'review_round', { run })).toMatchObject({ status: 'round', round: 1, retry: expect.stringContaining('The reply is invalid') })
})

test('a reviewer is not started when its running status cannot be saved', async ($, on) => {
  const storage = { isFull: false }
  const spawned = world(on, { stdout: codexSays(approved) }, undefined, storage)
  await $.session.start({ cwd: top, surface: 'desktop', isInteractive: true })
  const round1 = await call($, 'review_start', { args: '', pick: 'complex', isSure: true })

  storage.isFull = true
  const result = await spawn($, round1.agent, 'toolu_1')
  storage.isFull = false

  expect(result).toMatchObject({ deny: expect.stringContaining('The reviewer could not start') })
  expect(spawned).toHaveLength(0)
  expect(await call($, 'review_round', { run: round1.run })).toMatchObject({ status: 'round', round: 1, retry: expect.stringContaining('The reviewer could not start') })
})

// A run this process saved, and a $ whose clock can be held while another call reads a newer state.json.
function replaced(id: string, attempt: object) {
  const run = { id, dir: `/c/tmp/confer/${id}`, repoDir: top, status: 'running', phases: [{ number: 0, round: 1 }], findings: [], attempts: [{ phase: 0, round: 1, side: 'claude', ...attempt }], updatedAt: 1 } as unknown as RunState
  const written: Record<string, string> = {}
  let text = JSON.stringify(run)
  let open = () => {}
  let held: Promise<void> | undefined
  const $ = {
    env: { get: async (name: string) => (name === 'CLAUDE_CONFIG_DIR' ? '/c' : undefined) },
    clock: { now: async () => (await held, 3) },
    fs: { read: async () => text, write: async (path: string, text: string) => void (written[path] = text) },
  } as unknown as EngineInterface
  remember(run)
  const hold = () => (held = new Promise<void>(resolve => (open = resolve)))
  // Another session cancels the run, and another call in this process reads it.
  const cancel = async () => {
    text = JSON.stringify({ ...run, status: 'cancelled', updatedAt: 5 })
    await getRun($, id)
    open()
  }
  return { $, written, hold, cancel }
}

test("a reviewer's answer is not saved over a run that another call read again from a newer state.json", async () => {
  const { $, written, hold, cancel } = replaced('abcdef0c', { status: 'replied', agentId: 'agent-c' })
  hold()
  const turn = onTurn($, { agentId: 'agent-c', answer: approved })
  await cancel()
  await turn
  expect(written).toEqual({})
})

test("a reviewer's spawn is not saved over a run that another call read again from a newer state.json", async () => {
  const { $, written, cancel } = replaced('abcdef0d', { status: 'waiting', effort: 'high', prompt: 'p', model: 'm' })
  const e = { description: 'Confer abcdef0d round 1', subagentType: `${reviewerPrefix}high`, tool_use_id: 'use-d', prompt: '' } as unknown as AgentSpawnInput
  const result = await onSpawn($, e, async () => (await cancel(), { model: 'm', agentId: 'agent-d' }))
  expect(result).toEqual({ model: 'm', agentId: 'agent-d' })
  expect(JSON.parse(written['/c/tmp/confer/abcdef0d/state.json']!).attempts[0]).not.toHaveProperty('agentId')
})

test("a reviewer's Agent result is not saved over a run that another call read again from a newer state.json", async () => {
  const { $, written, hold, cancel } = replaced('abcdef0e', { status: 'running', toolUseId: 'use-e' })
  hold()
  const agentCall = onAgentCall($, { tool_use_id: 'use-e' }, async () => ({ result: { status: 'completed', agentId: 'agent-e', handbackReport: { text: approved } } }))
  await cancel()
  await agentCall
  expect(written).toEqual({})
})
