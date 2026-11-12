// claude plugin test: the rules added to a prompt and a tool result, the
// request for the next step on a push, and the edit to a file in the primary checkout.
import { expect, test } from 'claude-code/testing'
import { splice } from './splice'

function world(on: any, entry?: string) {
  on('fs.read', (_$: any, e: any) => {
    const name = String(e.path).split(/[\\/]/).pop()
    return { value: name === 'rules.md' ? 'before\n{{title}}\n{{wrap-up}}after\n' : `<${name}>\n` }
  })
  on('env.get', () => ({ value: entry }))
  on('prompt.submit', (_$: any, e: any) => ({ text: e.text, context: e.context }))
}
const rules = (title: string, wrapUp = '') => [`before\n<${title}>\n${wrapUp}after\n`]
const submit = async ($: any) => (await $.prompt.submit({ text: 'hi' })).context ?? []

test('rules.md is added to the first prompt', async ($: any, on: any) => {
  world(on)
  expect(await submit($)).toEqual(rules('title-print.md'))
})

test('the desktop app gets the title instruction for its tool and the rule for its wrap_up tool', async ($: any, on: any) => {
  world(on, 'claude-desktop')
  expect(await submit($)).toEqual(rules('title-desktop.md', '<wrap-up-desktop.md>\n\n'))
})

test('in a terminal session the title is set with the plugin\'s tool', async ($: any, on: any) => {
  world(on, 'cli')
  expect(await submit($)).toEqual(rules('title-cli.md'))
})

test('any other entry point gets the printed title block', async ($: any, on: any) => {
  world(on, 'sdk-cli')
  expect(await submit($)).toEqual(rules('title-print.md'))
})

test('a passage is replaced where it occurs once, and a replacement with $& in it is literal', () => {
  expect(splice('a\nb\nc\n', 'b\n', '$&x\n')).toBe('a\n$&x\nc\n')
  expect(splice('a\n', '', 'b\n')).toBe('a\nb\n')
  expect(() => splice('a\nb\n', 'z', 'y')).toThrow('occurs 0 times')
  expect(() => splice('a\na\n', 'a', 'y')).toThrow('occurs 2 times')
})

test('in a file with CRLF line ends, a passage with LF line ends is matched and written with CRLF', () => {
  expect(splice('a\r\nb\r\nc\r\n', 'a\nb\n', 'x\ny\n')).toBe('x\r\ny\r\nc\r\n')
  expect(splice('a\r\nb\r\n', 'b', 'x\ny')).toBe('a\r\nx\r\ny\r\n')
  expect(splice('a\r\n', '', 'b\nc\r\n')).toBe('a\r\nb\r\nc\r\n')
  // A passage that is in the file as written is matched as written.
  expect(splice('a\nb\nc\r\n', 'a\nb\n', 'x\r\n')).toBe('x\r\nc\r\n')
  expect(splice('a\r\nb\r\n', 'a\r\n', 'x\n')).toBe('x\nb\r\n')
  expect(() => splice('a\r\nb\r\n', 'a\nz\n', 'y')).toThrow('occurs 0 times')
  expect(splice('a\r\nb\r\n', 'a\nb\n', '$&\n')).toBe('$&\r\n')
})

test('in a file with both line ends, the replacement is written as given unless the passage is matched with CRLF', () => {
  expect(splice('a\nb\r\nc\n', 'a', 'x\ny')).toBe('x\ny\nb\r\nc\n')
  expect(splice('a\nb\r\n', '', 'c\n')).toBe('a\nb\r\nc\n')
  expect(splice('a\nb\nc\r\na\r\nb\r\n', 'a\nb\n', 'x\ny\n')).toBe('x\ny\nc\r\na\r\nb\r\n')
  expect(splice('a\nb\r\nc\r\n', 'b\nc\n', 'x\ny\n')).toBe('a\nx\r\ny\r\n')
})

const EDIT = 'mcp__session-skills__edit_primary_file'
// The engine resolves an fs path before a mock gets it, so on Windows /repo
// arrives as C:\repo. On macOS a path with a drive letter is not absolute, so
// the engine puts the session's directory in front of it, and that prefix is
// dropped too.
const posix = (p: string) => p.replace(/\\/g, '/').replace(/^(.*\/)?[A-Za-z]:(?=\/)/, '')
function repo(on: any, files: Record<string, string>, afterRead: (n: number) => void = () => {}, root = '/repo') {
  let reads = 0
  on('session.repo', () => ({ value: { root, remote: null, internal: false } }))
  on('fs.exists', (_$: any, e: any) => ({ value: posix(e.path) in files }))
  on('fs.read', (_$: any, e: any) => {
    const value = files[posix(e.path)]
    afterRead(++reads)
    return { value }
  })
  on('fs.write', (_$: any, e: any) => { files[posix(e.path)] = e.text; return { value: undefined } })
  return files
}

test('the tool edits a file in the primary checkout, and appends to one that is not there yet', async ($: any, on: any) => {
  const files = repo(on, { '/repo/ROADMAP.local.md': '## R1: one\n\n## R2: two\n' })
  expect((await $.tool.call({ tool: EDIT, path: '/repo/ROADMAP.local.md', old: '## R2: two\n', new: '## R3: three\n' })).result).toBe('edited /repo/ROADMAP.local.md')
  await $.tool.call({ tool: EDIT, path: '/repo/notes.local/log.md', old: '', new: 'first\n' })
  expect(files).toEqual({ '/repo/ROADMAP.local.md': '## R1: one\n\n## R3: three\n', '/repo/notes.local/log.md': 'first\n' })
})

test('the tool writes nothing for a drifted passage or a path outside the primary checkout', async ($: any, on: any) => {
  const files = repo(on, { '/repo/a.md': 'a\n', '/elsewhere/a.md': 'a\n' })
  for (const [path, why] of [['/repo/a.md', 'occurs 0 times'], ['/elsewhere/a.md', 'not inside the primary checkout'], ['/repo/../elsewhere/a.md', 'not inside the primary checkout'], ['/repository/a.md', 'not inside']]) {
    const ran = await $.tool.call({ tool: EDIT, path, old: 'z', new: 'y' })
    expect(ran.isError).toBe(true)
    expect(ran.text).toContain(why)
  }
  expect(files).toEqual({ '/repo/a.md': 'a\n', '/elsewhere/a.md': 'a\n' })
})

test('on Windows a path that differs from the primary checkout only in letter case is edited', async ($: any, on: any) => {
  const files = repo(on, { '/repo/a.md': 'a\n', '/repo-other/a.md': 'a\n' }, undefined, 'C:\\Repo')
  expect((await $.tool.call({ tool: EDIT, path: 'c:\\repo\\a.md', old: 'a\n', new: 'b\n' })).isError).toBeUndefined()
  expect(files['/repo/a.md']).toBe('b\n')
  for (const path of ['c:\\repo\\..\\a.md', 'c:\\repo-other\\a.md', 'C:/Repo/../repo-other/a.md', 'D:\\Repo\\a.md', '/repo/a.md']) {
    expect((await $.tool.call({ tool: EDIT, path, old: '', new: 'b\n' })).isError).toBe(true)
  }
  expect(files).toEqual({ '/repo/a.md': 'b\n', '/repo-other/a.md': 'a\n' })
})

test('without a drive letter, a path in another letter case is outside the primary checkout', async ($: any, on: any) => {
  const files = repo(on, { '/Repo/a.md': 'a\n' })
  expect((await $.tool.call({ tool: EDIT, path: '/Repo/a.md', old: 'a\n', new: 'b\n' })).text).toContain('not inside the primary checkout')
  expect(files).toEqual({ '/Repo/a.md': 'a\n' })
})

test('the tool writes nothing when the file changed after it was first read', async ($: any, on: any) => {
  const files = repo(on, { '/repo/a.md': 'a\n' }, n => { if (n === 1) files['/repo/a.md'] = 'a\nadded by a sibling\n' })
  const ran = await $.tool.call({ tool: EDIT, path: '/repo/a.md', old: 'a\n', new: 'b\n' })
  expect(ran.isError).toBe(true)
  expect(ran.text).toContain('changed')
  expect(files['/repo/a.md']).toBe('a\nadded by a sibling\n')
})

test('the title tool is registered in the terminal only', async ($: any, on: any) => {
  let entry: string | undefined
  let names: string[] = []
  on('env.get', () => ({ value: entry }))
  on('tool.register', (_$: any, e: any) => { names.push(e.name); return { value: undefined } })
  on('session.start', (_$: any, e: any) => e)
  for (const from of ['claude-desktop', 'sdk-cli', undefined]) {
    entry = from
    names = []
    await $.session.start({ cwd: '/repo' })
    expect(names).toContain('edit_primary_file')
    expect(names).not.toContain('set_session_title')
  }
  entry = 'cli'
  names = []
  await $.session.start({ cwd: '/repo' })
  expect(names).toContain('set_session_title')
})

const TITLE = 'mcp__session-skills__set_session_title'
const end = ($: any, answer: string, more: any = {}) => $.turn.complete({ answer, reason: 'answer', isAborted: false, durationMs: 1, turnId: 't1', ...more })
function titles(on: any) {
  const w = { run: [] as any[], fail: false }
  on('turn.complete', (_$: any, e: any) => ({ text: e.answer }))
  on('command.run', (_$: any, e: any) => {
    if (w.fail) throw new Error('refused')
    w.run.push(e)
    return { text: 'Session renamed' }
  })
  return w
}

test('a title is applied with /rename when the turn ends, once', async ($: any, on: any) => {
  const w = titles(on)
  const ran = await $.tool.call({ tool: TITLE, title: ' Parser core ' })
  expect(ran.result).toContain('when this turn ends')
  expect(w.run).toEqual([])
  await end($, 'Done.')
  expect(w.run.map(r => [r.command, r.args])).toEqual([['rename', 'Parser core']])
  await end($, 'Done.')
  expect(w.run).toHaveLength(1)
})

test('an empty title is an error, a subagent\'s turn leaves a title for the main loop, and a refused rename ends the turn normally', async ($: any, on: any) => {
  const w = titles(on)
  expect((await $.tool.call({ tool: TITLE, title: '  ' })).isError).toBe(true)
  await $.tool.call({ tool: TITLE, title: 'Parser core' })
  await end($, 'Done.', { agentId: 'a1' })
  expect(w.run).toEqual([])
  w.fail = true
  expect((await end($, 'Done.')).text).toBe('Done.')
})

test('an empty title leaves the one already set, a title is one line, and a subagent sets none', async ($: any, on: any) => {
  const w = titles(on)
  await $.tool.call({ tool: TITLE, title: 'Parser\n  core' })
  await $.tool.call({ tool: TITLE, title: '  ' })
  await $.tool.call({ tool: TITLE, title: 'Other', agentId: 'a1' })
  await end($, 'Done.')
  expect(w.run.map(r => r.args)).toEqual(['Parser core'])
})

test('the user is told when the rename is refused', async ($: any, on: any) => {
  const w = titles(on)
  const toasts: string[] = []
  on('ui.toast', (_$: any, e: any) => { toasts.push(e.text ?? String(e)); return { value: undefined } })
  w.fail = true
  await $.tool.call({ tool: TITLE, title: 'Parser core' })
  await end($, 'Done.')
  expect(toasts.join()).toContain('Parser core')
})

// The context added to a command's result, with the command's own result
// beneath.
function pushes(on: any) {
  const w = { result: { result: {} } as any, mode: 'private' }
  on('session.repo', () => ({ value: { root: '/repo', remote: null, internal: false } }))
  on('process.run', (_$: any, e: any) => ({ value: e.argv.includes('upstream') ? { exitCode: 2, stdout: '', stderr: '' } : { exitCode: 0, stdout: `${w.mode}\n`, stderr: '' } }))
  on('tool.call', { tool: 'Bash' }, () => w.result)
  on('tool.call', { tool: 'PowerShell' }, () => w.result)
  return w
}
const bash = async ($: any, command: string, more: any = {}, tool = 'Bash') => {
  const ran = await $.tool.call({ tool, command, ...more })
  return (ran.context ?? []).filter((c: string) => c.includes('pushed work'))
}

test('the next step is requested in the result of a push, in either shell', async ($: any, on: any) => {
  pushes(on)
  for (const command of ['git -C "/repo" push origin main', 'cd /repo && git push 2>&1 | tail -3', 'git push']) expect(await bash($, command)).toHaveLength(1)
  expect(await bash($, 'git push origin main', {}, 'PowerShell')).toHaveLength(1)
})

test('no request comes with a command that pushed nothing, a failed push, or a subagent\'s push', async ($: any, on: any) => {
  const w = pushes(on)
  expect(await bash($, 'git log --oneline origin/main..main && echo push')).toEqual([])
  for (const command of ['git push -n origin main', 'git --no-pager push --dry-run origin main', 'git push --help']) expect(await bash($, command), command).toEqual([])
  expect(await bash($, `claude -p "run git push"`)).toEqual([])
  expect(await bash($, 'git push', { agentId: 'a1' })).toEqual([])
  w.result = { result: 'rejected', isError: true }
  expect(await bash($, 'git push')).toEqual([])
  w.result = { deny: 'no' }
  expect(await bash($, 'git push')).toEqual([])
  // A push that failed in a command that ran on exits 0.
  w.result = { result: { stdout: "error: failed to push some refs to 'https://h/a/b.git'\n", stderr: '' } }
  expect(await bash($, 'git push origin b 2>&1 | tail -3')).toEqual([])
})

test('a push or a post chained with another command is refused in a confirm mode, and runs in an auto mode', async ($: any, on: any) => {
  const w = pushes(on)
  const deny = async (command: string, more: any = {}) => (await $.tool.call({ tool: 'Bash', command, ...more })).deny
  for (const command of ['./test.sh && git commit -m x && git push -u origin b', 'git push && gh pr create', 'git commit -m x; gh pr create']) expect(await deny(command), command).toContain('by itself')
  expect(await deny('git commit -m x && git push', { agentId: 'a1' })).toContain('by itself')
  expect((await $.tool.call({ tool: 'PowerShell', command: 'git commit -m x; git push' })).deny).toContain('by itself')
  for (const command of ['git push', 'git push 2>&1 | tail -3', 'git fetch && git push --dry-run', 'gh pr view 3 && git log']) expect(await deny(command), command).toBeUndefined()
  w.mode = 'auto-push'
  expect(await deny('git commit -m x && git push')).toBeUndefined()
  expect(await deny('git commit -m x && gh pr create')).toContain('by itself')
  w.mode = 'auto-post'
  expect(await deny('git commit -m x && gh pr create')).toBeUndefined()
  expect(await deny('git commit -m x && git push')).toContain('by itself')
})

test('no prompt is submitted at the end of a turn that pushed', async ($: any, on: any) => {
  pushes(on)
  const sent: string[] = []
  on('turn.complete', (_$: any, e: any) => ({ text: e.answer }))
  on('prompt.submit', (_$: any, e: any) => { sent.push(e.text); return { text: e.text } })
  await bash($, 'git push')
  await end($, 'Pushed.')
  expect(sent).toEqual([])
})

// The rules come with a prompt, once the model no longer reads them.
function prompts(on: any) {
  const w = { read: [] as string[] }
  on('session.messages', () => ({ value: w.read.map(text => ({ role: 'user', content: [{ type: 'text', text }] })) }))
  return w
}

test('the rules are added to a prompt while the model does not read them', async ($: any, on: any) => {
  world(on, 'claude-desktop')
  const w = prompts(on)
  const rules = 'before\n<title-desktop.md>\n<wrap-up-desktop.md>\n\nafter\n'
  expect(await submit($)).toEqual([rules])
  w.read = [`<system-reminder>\n${rules}</system-reminder>`]
  expect(await submit($)).toEqual([])
  // The rules for another entry point are not the rules for this one.
  w.read = ['before\n<title-print.md>\nafter\n']
  expect(await submit($)).toEqual([rules])
})

// The conversation read back: a string is a text block, as a prompt's context
// is, and `result` is the text of a tool result. `deny` refuses the next call.
function results(on: any) {
  const w = { read: [] as (string | { result: string })[], deny: false }
  on('session.messages', () => ({ value: w.read.map(t => ({ role: 'user', content: [typeof t === 'string' ? { type: 'text', text: t } : { type: 'tool_result', tool_use_id: 't', content: t.result }] })) }))
  on('tool.call', () => (w.deny ? { deny: 'not now' } : { result: 'ok' }))
  return w
}
const call = async ($: any, more: any = {}) => (await $.tool.call({ tool: 'Read', file_path: '/p/a.md', ...more })).context ?? []

test('the rules are added to one tool result after a compaction, until the model reads them there', async ($: any, on: any) => {
  world(on)
  const w = results(on)
  const rules = 'before\n<title-print.md>\nafter\n'
  w.read = [`<system-reminder>\n${rules}</system-reminder>`]
  expect(await call($)).toEqual([])
  w.read = ['a summary']
  expect(await call($, { agentId: 'w1' })).toEqual([])
  w.deny = true
  expect(await call($)).toEqual([])
  w.deny = false
  expect(await Promise.all([call($), call($)])).toEqual([[rules], []])
  w.read = ['a summary', { result: `ok\n\n<system-reminder>\ntool.call hook additional context: ${rules}</system-reminder>` }]
  expect(await call($)).toEqual([])
  w.read = ['another summary']
  expect(await call($)).toEqual([rules])
  // A second compaction before the model read them back.
  w.read = ['a third summary']
  expect(await call($)).toEqual([rules])
})

test('a push mentioned only inside a quoted argument gets no request', async ($: any, on: any) => {
  pushes(on)
  // Each quoted string is a false positive: a nested claude -p invocation, a
  // commit message, and an echoed note.
  for (const command of [
    'claude -p "wait for git push --dry-run origin main"',
    `git commit -m 'I will git push later'`,
    'echo "git push" > note.txt',
    `git commit -F - <<'EOF'\nThen git push it\nEOF`,
  ]) expect(await bash($, command)).toEqual([])
})

test('a push after a commit message heredoc with an odd quote in it gets the request', async ($: any, on: any) => {
  // In a confirm mode a push after another command is refused.
  pushes(on).mode = 'auto-push'
  for (const command of [
    `git commit -F - <<'EOF'\nIt's done\nEOF\ngit push`,
    `git commit -m "$(cat <<'EOF'\nQuote a " here\nEOF\n)" && git push`,
  ]) expect(await bash($, command)).toHaveLength(1)
})
