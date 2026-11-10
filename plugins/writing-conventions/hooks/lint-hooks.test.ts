// claude plugin test: the reply lint's hooks, the reminders, and the lint tool.
import { expect, test } from 'claude-code/testing'

// The session a prompt is sent in, the text the model still reads, and the
// conversations of agents read back, which a Workflow agent's is not. A string
// is a text block, as a prompt's context and an Agent task are, and `result`
// is the text of a tool result.
type Read = string | { result: string }
const session = { id: 's1', read: [] as Read[], agents: {} as Record<string, Read[]> }

function world(on: any, base = '2.1.289', env: Record<string, string> = {}) {
  session.id = 's1'
  session.read = []
  session.agents = {}
  on('session.version', () => ({ value: { version: base, base, builtAt: '' } }))
  on('session.id', () => ({ value: session.id }))
  on('session.messages', (_$: any, e: any) => {
    const texts = e.agentId ? session.agents[e.agentId] : session.read
    if (!texts) return { value: { deny: `no conversation of agent ${e.agentId} in this session` } }
    return { value: texts.map(t => ({ role: 'user', content: [typeof t === 'string' ? { type: 'text', text: t } : { type: 'tool_result', tool_use_id: 't', content: t.result }] })) }
  })
  on('prompt.submit', (_$: any, e: any) => ({ text: e.text, context: e.context }))
  const files: Record<string, string> = {}
  // On Windows an engine-level step turns a "/foo" path into "C:\foo" before the
  // mock sees it, so each lookup reads it back as POSIX.
  const posix = (p: string) => p.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')
  on('env.get', (_$: any, e: any) => ({ value: env[e.name as string] }))
  on('fs.read', (_$: any, e: any) => {
    const p = posix(e.path)
    if (p.endsWith('.md')) return { value: `<${p.split('/').pop()}>` }
    if (!(p in files)) throw new Error('ENOENT')
    return { value: files[p] }
  })
  on('fs.exists', (_$: any, e: any) => ({ value: posix(e.path) in files }))
  on('fs.write', (_$: any, e: any) => { files[posix(e.path)] = e.text; return { value: undefined } })
  on('ui.toast', () => ({ value: undefined }))
  on('turn.complete', (_$: any, e: any) => ({ text: e.answer }))
  return files
}

const stop = ($: any, answer: string, id = 's1', more: any = {}) => {
  session.id = id
  return $.turn.complete({ answer, reason: 'answer', isAborted: false, durationMs: 1, turnId: 't1', ...more })
}
// What is added to a prompt, past the rules.
const prompt = async ($: any, id = 's1') => {
  session.id = id
  return ((await $.prompt.submit({ text: 'next' })).context ?? []).filter((c: string) => c !== '<rules.md>')
}

test('the note on a reply opens the next turn, once, before the reminder', async ($: any, on: any) => {
  world(on)
  await stop($, 'The report says the build is load-bearing.')
  const first = await prompt($)
  expect(first).toHaveLength(1)
  expect(first[0]).toMatch(/^A house-style lint flagged the previous reply:\n[\s\S]*banned word[\s\S]*\nStyle, for this reply/)
  expect(await prompt($)).toEqual([expect.stringMatching(/^Style, for this reply/)])
})

test('an interrupted turn and a subagent\'s turn leave no note', async ($: any, on: any) => {
  world(on)
  await stop($, 'The build is load-bearing.', 's1', { reason: 'aborted', isAborted: true })
  await stop($, 'The build is load-bearing.', 's1', { agentId: 'a1' })
  expect((await prompt($))[0]).toMatch(/^Style/)
})

test('the note is cleared after a clean reply, and is kept per session', async ($: any, on: any) => {
  world(on)
  await stop($, 'The build is load-bearing.')
  await stop($, 'The build passed.')
  expect((await prompt($))[0]).toMatch(/^Style/)
  await stop($, 'The build is load-bearing.', 's2')
  expect((await prompt($, 's1'))[0]).toMatch(/^Style/)
  expect((await prompt($, 's2'))[0]).toMatch(/^A house-style lint/)
})

test('the text in a draft fence is linted as prose', async ($: any, on: any) => {
  world(on)
  const F = '```'
  await stop($, `Here it is.\n${F}draft\nThe build is load-bearing.\n${F}\n`)
  expect((await prompt($))[0]).toContain('banned word')
  await stop($, `Here it is.\n${F}sh\necho load-bearing\n${F}\n`)
  expect((await prompt($))[0]).toMatch(/^Style/)
})

test('the re-read request is added for a prose or source file just written, in any letter case', async ($: any, on: any) => {
  world(on)
  native(on)
  session.read = ['<rules.md>']
  const wrote = async (tool: string, file_path: string) =>
    (await $.tool.call({ tool, file_path, content: '', old_string: 'x', new_string: 'y', tool_use_id: 't' })).context ?? []
  for (const p of ['/p/a.md', '/p/README.MD', '/p/A.kt', '/p/b.txt']) expect((await wrote('Write', p)).join()).toContain('You just wrote prose')
  expect((await wrote('Edit', '/p/a.md')).join()).toContain('You just wrote prose')
  expect(await wrote('Write', '/p/a.py')).toEqual([])
  expect(await wrote('Read', '/p/a.md')).toEqual([])
})

test('the rules are added to the first prompt, on an older CLI too', async ($: any, on: any) => {
  world(on, '2.1.200')
  expect((await $.prompt.submit({ text: 'hi' })).context).toEqual(['<rules.md>'])
})

test('the lint tool returns the flagged lines, or clean', async ($: any, on: any) => {
  world(on)
  expect((await $.tool.call({ tool: 'mcp__writing-conventions__lint', text: 'The build is load-bearing.' })).result).toBe('banned word\tload-bearing')
  expect((await $.tool.call({ tool: 'mcp__writing-conventions__lint', text: 'The build passed.' })).result).toBe('clean')
})

test('the lint tool reads a draft passed inside its fence', async ($: any, on: any) => {
  world(on)
  const F = '```'
  expect((await $.tool.call({ tool: 'mcp__writing-conventions__lint', text: `${F}draft\nThe build is load-bearing.\n${F}\n` })).result).toBe('banned word\tload-bearing')
})

test('the note is kept in TEMP where there is no TMPDIR', async ($: any, on: any) => {
  const files = world(on, '2.1.289', { TEMP: '/win/Temp' })
  await stop($, 'The build is load-bearing.')
  expect(Object.keys(files)).toEqual(['/win/Temp/claude-reply-lint-s1.txt'])
})

test('with no session id nothing is saved', async ($: any, on: any) => {
  world(on)
  await stop($, 'The build is load-bearing.', '')
  expect((await prompt($, ''))[0]).toMatch(/^Style/)
})

test('on an older CLI no note, reminder, or subagent rules are recorded or added', async ($: any, on: any) => {
  const files = world(on, '2.1.200')
  await stop($, 'The build is load-bearing.')
  expect(Object.keys(files)).toEqual([])
  expect(await prompt($)).toEqual([])
})

// `task` is the last subagent task, and `deny` refuses the next tool call.
function native(on: any) {
  const w = { task: '', deny: false }
  on('tool.call', (_$: any, e: any) => {
    w.task = e.prompt
    if (w.deny) return { deny: 'not now' }
    return {
      result: e.tool === 'Write' ? { type: 'create', filePath: e.file_path, content: e.content }
        : e.tool === 'Edit' ? { filePath: e.file_path, oldString: e.old_string, newString: e.new_string }
        : '',
    }
  })
  return w
}
const submit = async ($: any) => (await $.prompt.submit({ text: 'next' })).context ?? []

test('the rules are added to a prompt while the model does not read them, then the note and the reminder', async ($: any, on: any) => {
  world(on)
  native(on)
  const [rules, reminder] = await submit($)
  expect(rules).toBe('<rules.md>')
  expect(reminder).toMatch(/^Style, for this reply/)
  session.read = ['<system-reminder>\n<rules.md>\n</system-reminder>']
  expect((await submit($))[0]).toMatch(/^Style/)
})

// Auto mode refuses an Agent call whose input a hook changed after review, so
// the rules go into the task at spawn and the call's input is left alone.
test('the rules are added once at the start of a subagent task, and the re-read request to a Write result', async ($: any, on: any) => {
  world(on)
  const w = native(on)
  const spawned: string[] = []
  on('agent.spawn', (_$: any, e: any) => { spawned.push(e.prompt); return { agentId: 'a1', model: 'm' } })
  await $.tool.call({ tool: 'Agent', prompt: 'look', description: 'd' })
  expect(w.task).toBe('look')
  await $.agent.spawn({ prompt: 'look' })
  await $.agent.spawn({ prompt: '<rules.md>\n\nlook' })
  await $.agent.spawn({ prompt: 'step', workflow: { runId: 'wf_1', agentIndex: 1 } })
  expect(spawned).toEqual(['<rules.md>\n\nlook', '<rules.md>\n\nlook', 'step'])
  expect((await $.tool.call({ tool: 'Write', file_path: '/p/a.md', content: '', tool_use_id: 't' })).context.join()).toContain('You just wrote prose')
})

test('the note on a reply opens the next turn', async ($: any, on: any) => {
  world(on)
  native(on)
  session.read = ['<rules.md>']
  await stop($, 'The build is load-bearing.')
  expect((await submit($))[0]).toMatch(/^A house-style lint flagged the previous reply:\n[\s\S]*banned word/)
})

const bash = async ($: any, agentId?: string) => (await $.tool.call({ tool: 'Bash', command: 'ls', ...(agentId && { agentId }) })).context ?? []
const restored = { result: 'ok\n\n<system-reminder>\ntool.call hook additional context: <rules.md>\n</system-reminder>' }

test('a Workflow agent gets the rules with its first tool result only, and an Agent subagent once its task is compacted away', async ($: any, on: any) => {
  world(on)
  native(on)
  session.read = ['<rules.md>']
  session.agents = { a1: ['<rules.md>\n\nlook'] }
  expect(await Promise.all([bash($, 'w1'), bash($, 'w1')])).toEqual([['<rules.md>'], []])
  expect(await bash($, 'w1')).toEqual([])
  expect(await bash($, 'a1')).toEqual([])
  session.agents.a1 = ['a summary']
  expect(await Promise.all([bash($, 'a1'), bash($, 'a1')])).toEqual([['<rules.md>'], []])
  session.agents.a1 = ['a summary', restored]
  expect(await bash($, 'a1')).toEqual([])
})

test('the rules are added to one tool result after a compaction, until the model reads them there', async ($: any, on: any) => {
  world(on)
  const w = native(on)
  session.read = ['<rules.md>']
  expect(await bash($)).toEqual([])
  session.read = ['a summary']
  w.deny = true
  expect(await bash($)).toEqual([])
  w.deny = false
  expect(await Promise.all([bash($), bash($)])).toEqual([['<rules.md>'], []])
  session.read = ['a summary', restored]
  expect(await bash($)).toEqual([])
  session.read = ['another summary']
  expect(await bash($)).toEqual(['<rules.md>'])
  // A second compaction before the model read them back.
  session.read = ['a third summary']
  expect(await bash($)).toEqual(['<rules.md>'])
})

test('on an older CLI a Workflow agent gets no rules', async ($: any, on: any) => {
  world(on, '2.1.200')
  native(on)
  session.read = ['<rules.md>']
  expect(await bash($, 'w1')).toEqual([])
})
