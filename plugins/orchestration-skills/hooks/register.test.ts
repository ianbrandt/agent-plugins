// claude plugin test: the rules added to a prompt, a subagent's task, and a
// tool result.
import { expect, test } from 'claude-code/testing'
import { SUBAGENT_RULE } from './register'

const RULES = 'ORCHESTRATION MODE ACTIVE\n\nthe rules'
// The rules as added, with the tiers at the plugin.json defaults.
const TEXT = `${RULES}

## The tiers in this session's settings

Pass these as \`model\` and \`effort\` on \`Agent\` and on a Workflow \`agent()\`. Which stage runs at which tier is in the \`tier-model-and-effort\` skill.

| Tier | Model | Effort |
|---|---|---|
| Mechanical | haiku | low |
| Routine | sonnet | medium |
| Complex | opus | high |
| Critical | opus | xhigh |
| Escalation | fable | high |
`

// `read` is the text the model still reads, and `task` the last subagent task.
function world(on: any) {
  const w = { read: [] as string[], task: '' }
  on('fs.read', () => ({ value: RULES }))
  on('session.messages', () => ({ value: w.read.map(text => ({ role: 'user', content: [{ type: 'text', text }] })) }))
  on('prompt.submit', (_$: any, e: any) => ({ text: e.text, context: e.context }))
  on('tool.call', (_$: any, e: any) => { w.task = e.prompt; return { result: 'done' } })
  return w
}

test('the rules, with the tiers at the plugin.json defaults, are added to a prompt once the model no longer reads them', async ($: any, on: any) => {
  const w = world(on)
  expect((await $.prompt.submit({ text: 'hi' })).context).toEqual([TEXT])
  w.read = [`<system-reminder>\n${TEXT}\n</system-reminder>`]
  expect((await $.prompt.submit({ text: 'again' })).context ?? []).toEqual([])
  w.read = [`<system-reminder>\n${RULES}\n</system-reminder>`]
  expect((await $.prompt.submit({ text: 'after a settings change' })).context).toEqual([TEXT])
})

const rows = (context: string[]) => context[0]!.split('\n').filter(line => /^\| [A-Z][a-z]+ \|/.test(line))

test('a tier set in the settings replaces its default, an effort outside the five levels does not, and an empty model is left to the session', { options: { criticalModel: ' Fable ', criticalEffort: 'high', routineEffort: 'extra', complexModel: '' } }, async ($: any, on: any) => {
  world(on)
  const table = rows((await $.prompt.submit({ text: 'hi' })).context)
  expect(table).toContain('| Critical | Fable | high |')
  expect(table).toContain('| Routine | sonnet | medium |')
  expect(table).toContain("| Complex | the session's model | high |")
})

// Auto mode refuses an Agent call if a hook changed its input after review, so
// the rule goes into the task at spawn and the call's input is left alone.
test('a subagent task opens with the escalation rule once, and the Agent call is left as reviewed', async ($: any, on: any) => {
  const w = world(on)
  const spawned: string[] = []
  on('agent.spawn', (_$: any, e: any) => { spawned.push(e.prompt); return { agentId: 'a1', model: 'm' } })
  await $.tool.call({ tool: 'Agent', prompt: 'look', description: 'd' })
  expect(w.task).toBe('look')
  await $.agent.spawn({ prompt: 'look' })
  await $.agent.spawn({ prompt: `${SUBAGENT_RULE}\n\nlook` })
  await $.agent.spawn({ prompt: 'step', workflow: { runId: 'wf_1', agentIndex: 1 } })
  expect(spawned).toEqual([`${SUBAGENT_RULE}\n\nlook`, `${SUBAGENT_RULE}\n\nlook`, 'step'])
})

// The conversations read back, by agent: the main loop under '', an Agent
// subagent's under its ID, and none for a Workflow agent, as on 2.1.310. A
// string is a text block, as a prompt's context and an Agent task are, and
// `result` is the text of a tool result. `deny` refuses the next tool call.
type Read = string | { result: string }
function agents(on: any, read: Record<string, Read[]>) {
  const w = { deny: false }
  on('fs.read', () => ({ value: RULES }))
  on('session.messages', (_$: any, e: any) => {
    const texts = read[e.agentId ?? '']
    if (!texts) return { value: { deny: `no conversation of agent ${e.agentId} in this session` } }
    return { value: texts.map(t => ({ role: 'user', content: [typeof t === 'string' ? { type: 'text', text: t } : { type: 'tool_result', tool_use_id: 't', content: t.result }] })) }
  })
  on('tool.call', () => (w.deny ? { deny: 'not now' } : { result: 'ok' }))
  return w
}
const call = async ($: any, agentId?: string) => (await $.tool.call({ tool: 'Bash', command: 'ls', ...(agentId && { agentId }) })).context ?? []
const restored = (text: string) => ({ result: `ok\n\n<system-reminder>\ntool.call hook additional context: ${text}\n</system-reminder>` })

test('a Workflow agent gets the escalation rule with its first tool result only', async ($: any, on: any) => {
  const w = agents(on, { '': [TEXT] })
  w.deny = true
  expect(await call($, 'w1')).toEqual([])
  w.deny = false
  expect(await Promise.all([call($, 'w1'), call($, 'w1')])).toEqual([[SUBAGENT_RULE], []])
  expect(await call($, 'w1')).toEqual([])
  expect(await call($, 'w2')).toEqual([SUBAGENT_RULE])
})

test('an Agent subagent gets the escalation rule again only once its task is compacted away', async ($: any, on: any) => {
  const read: Record<string, Read[]> = { '': [TEXT], a1: [`${SUBAGENT_RULE}\n\nlook`] }
  agents(on, read)
  expect(await call($, 'a1')).toEqual([])
  read.a1 = ['a summary']
  expect(await call($, 'a1')).toEqual([SUBAGENT_RULE])
  expect(await call($, 'a1')).toEqual([])
  read.a1 = ['a summary', restored(SUBAGENT_RULE)]
  expect(await call($, 'a1')).toEqual([])
  read.a1 = ['another summary']
  expect(await call($, 'a1')).toEqual([SUBAGENT_RULE])
  // A second compaction before the model read the rule back.
  read.a1 = ['a third summary']
  expect(await call($, 'a1')).toEqual([SUBAGENT_RULE])
  expect(await call($, 'a1')).toEqual([])
})

test('the rules are added to one tool result after a compaction, until the model reads them there', async ($: any, on: any) => {
  const read: Record<string, Read[]> = { '': [`<system-reminder>\n${TEXT}\n</system-reminder>`] }
  const w = agents(on, read)
  expect(await call($)).toEqual([])
  read[''] = ['a summary']
  w.deny = true
  expect(await call($)).toEqual([])
  w.deny = false
  expect(await Promise.all([call($), call($), call($)])).toEqual([[TEXT], [], []])
  read[''] = ['a summary', restored(TEXT)]
  expect(await call($)).toEqual([])
  read[''] = ['another summary']
  expect(await call($)).toEqual([TEXT])
  // A second compaction before the model read them back.
  read[''] = ['a third summary']
  expect(await call($)).toEqual([TEXT])
})
