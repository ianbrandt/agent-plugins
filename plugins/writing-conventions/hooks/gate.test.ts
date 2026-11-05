// claude plugin test: the gate against a stand-in for the model and the file
// system, so what is tested is the plumbing: which events lead to a model call,
// which replies block, and that a call which fails lets the event through.
import { expect, mock, test } from 'claude-code/testing'
import { hold } from './hold'

const SAYS = 'git commit -m "The report says so."'
const FINDING = 'VIOLATION\n"The report says so." -> It is shown in the report.'
const CONFIG = '/cfg/writing-conventions'

type World = {
  // The review model's reply, the classifiers' replies, and whether the call fails.
  verdict?: string
  commands?: string
  tool?: string
  down?: boolean
  base?: string
  noSession?: boolean
  env?: Record<string, string>
  files?: Record<string, string>
  links?: string[]
  // The session is on Windows: its directory is C:\proj, and stat returns a real
  // path with a drive letter and backslashes.
  win?: boolean
  // What a tool call returns from beneath the plugin, in place of a Bash run or
  // the Write or Edit made with the call's arguments.
  result?: unknown
  // A call denied by a hook beneath the plugin, or one that failed.
  failed?: 'deny' | 'error'
  // The files in each repo's .github/ISSUE_TEMPLATE, or null for a repo with
  // none, and the repo gh picks in the session's directory.
  templates?: Record<string, Record<string, string> | null>
  here?: string
  // The session's directory, where it is not /proj.
  cwd?: string
  // The session's id, where it is not s1.
  session?: string
  // A policy that refuses the lint tool's registration.
  unlisted?: boolean
}

// What the model streams beneath the plugin for the next response.
const response: { chunks: any[]; fail: boolean } = { chunks: [], fail: false }

// world(on, w): answers every call the gate makes to the engine, and records the
// model calls by the prompt file each was made with, the files written, and the
// toasts. A test calls it once, before its first event, and changes `w`
// afterwards for a different reply.
function world(on: any, w: World = {}) {
  const base = w.base ?? '2.1.289'
  const files: Record<string, string> = { ...w.files }
  const seen = { reader: [] as string[], commands: [] as string[], tool: [] as string[], system: '', systemBlocks: undefined as unknown, toasts: [] as string[], files, ran: 0, gh: [] as string[], sent: [] as string[], origins: [] as unknown[], contexts: [] as string[][] }
  // On Windows an engine-level step turns a "/foo" path into "C:\foo" before the
  // mock sees it, so each lookup reads it back as POSIX. On macOS a "C:/foo"
  // path is not absolute, so the engine prepends the cwd and the drive letter
  // lands past the start; the prefix up to it is dropped too. The project
  // directory and the hook files always sit on the same drive in the mock.
  const posix = (p: string) => p.replace(/\\/g, '/').replace(/^(.*\/)?[A-Za-z]:(?=\/)/, '')
  mock.env(on, { CLAUDE_CONFIG_DIR: '/cfg', TMPDIR: '/tmp', ...w.env })
  on('session.version', () => ({ value: { version: base, base, builtAt: '' } }))
  on('session.id', () => { if (w.noSession) throw new Error('no session'); return { value: w.session ?? 's1' } })
  on('session.cwd', () => ({ value: w.cwd ?? (w.win ? 'C:\\proj' : '/proj') }))
  on('session.root', () => ({ value: w.win ? 'C:\\proj' : '/proj' }))
  on('ui.toast', (_$: any, e: any) => { seen.toasts.push(JSON.stringify(e)); return { value: undefined } })
  on('fs.read', (_$: any, e: any) => {
    const p = posix(e.path)
    // A prompt file of the plugin's is answered with its name.
    if (/\/hooks\/[a-z-]+\.md$/.test(p)) return { value: `<${p.split('/').pop()}>` }
    if (!(p in files)) throw new Error('ENOENT')
    return { value: files[p] }
  })
  on('fs.write', (_$: any, e: any) => { files[posix(e.path)] = e.text; return { value: undefined } })
  on('fs.stat', (_$: any, e: any) => {
    const p = posix(e.path)
    if (!(p in files) && !['/proj', '/tmp', '/elsewhere', '/Users/x/Temp'].includes(p)) throw new Error('ENOENT')
    const isFile = p in files
    return { value: { kind: isFile ? 'file' : 'dir', size: isFile ? files[p].length : 0, mtimeMs: 0, isLink: !!w.links?.includes(p), realPath: w.win ? `C:${p.replace(/\//g, '\\')}` : p } }
  })
  on('model.complete', (_$: any, e: any) => {
    seen.system = e.system
    seen.systemBlocks = e.systemBlocks
    const [list, reply] = e.system.includes('<classify-command.md>') ? [seen.commands, w.commands]
      : e.system.includes('<classify-prompt.md>') ? [seen.tool, w.tool]
      : [seen.reader, w.verdict]
    list.push(e.prompt)
    return { value: w.down || reply === undefined ? { isAnswered: false, reason: 'api-error', status: 529, usage: {} } : { isAnswered: true, text: reply, usage: {} } }
  })
  on('tool.call', (_$: any, e: any) => {
    seen.ran++
    if (w.failed === 'deny') return { deny: 'blocked by a hook' }
    if (w.failed === 'error') return { result: 'Error: String to replace not found in file.', isError: true }
    return {
      result: w.result ?? (e.tool === 'Write' ? { type: 'create', filePath: e.file_path, content: e.content }
        : e.tool === 'Edit' ? { filePath: e.file_path, oldString: e.old_string, newString: e.new_string }
        : { stdout: 'ran' }),
    }
  })
  on('process.run', (_$: any, e: any) => {
    const argv = e.argv as string[]
    seen.gh.push(argv.slice(1, 3).join(' '))
    const out = (stdout: string) => ({ value: { exitCode: stdout ? 0 : 1, stdout, stderr: '' } })
    if (argv[1] === 'repo') return out(w.here ? `${w.here}\n` : '')
    const arg = (k: string) => argv.find(a => a.startsWith(`${k}=`))!.slice(k.length + 1)
    const files = w.templates?.[`${arg('owner')}/${arg('name')}`]
    const entries = Object.entries(files ?? {}).map(([name, text]) => ({ name, object: { text } }))
    return out(files === undefined ? '' : JSON.stringify({ data: { repository: { object: files && { entries } } } }))
  })
  on('turn.complete', (_$: any, e: any) => ({ text: e.answer }))
  on('session.start', (_$: any, e: any) => e)
  on('tool.register', (_$: any, e: any) => {
    if (w.unlisted) throw new Error('refused')
    return { value: { tool: e.name } }
  })
  on('turn.step', async function* (_$: any, e: any) {
    for (const c of response.chunks) yield c
    if (response.fail) throw new Error('stream cut')
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  on('prompt.submit', (_$: any, e: any) => { seen.sent.push(e.text); seen.origins.push(e.origin); seen.contexts.push(e.context ?? []); return { text: e.text, context: e.context } })
  return seen
}

const bash = ($: any, command: string) => $.tool.call({ tool: 'Bash', command, tool_use_id: 'toolu_1' })
const pwsh = ($: any, command: string) => $.tool.call({ tool: 'PowerShell', command, tool_use_id: 'toolu_1' })
const cacheOf = (seen: { files: Record<string, string> }, name: string) =>
  Object.entries(seen.files).filter(([p]) => p.startsWith(`${CONFIG}/${name}-`)).map(([, text]) => text).join('')

test('commands in the four publishing families are reviewed, git -C included', async ($: any, on: any) => {
  const seen = world(on, { verdict: 'PASS' })
  for (const c of ['git commit -m "Plain message"', 'git -C /tmp/wt commit -m "Plain message"', 'gh pr create --title x --body y', 'gh issue comment 1 --body y', 'gh release create v1 --notes y']) {
    expect((await bash($, c)).result).toEqual({ stdout: 'ran' })
  }
  expect(seen.reader).toHaveLength(5)
  expect(seen.commands).toHaveLength(0)
  expect(seen.system).toBe('<gate-prompt.md><rules.md>')
  // The same prompt opens every review, so it is read from the prompt cache within five minutes.
  expect(seen.systemBlocks).toEqual([{ text: '<gate-prompt.md><rules.md>', cache: true }])
  expect(JSON.parse(seen.reader[0])).toMatchObject({ session_id: 's1', cwd: '/proj', tool_name: 'Bash', tool_input: { command: 'git commit -m "Plain message"' } })
})

test('a finding that quotes the command blocks it, and comes back as the reason', async ($: any, on: any) => {
  const seen = world(on, { verdict: FINDING })
  const ran = await bash($, SAYS)
  expect(ran.deny).toBeDefined()
  expect(ran.deny).toContain('shown in the report')
  expect(ran.deny).toContain('run the command again')
  expect(seen.ran).toBe(0)
})

test('a reply in any other form lets the command through', async ($: any, on: any) => {
  const w: World = {}
  world(on, w)
  for (const verdict of [
    'VIOLATION\n"The build wants more" -> invented',
    'VIOLATION MAYBE\n"The report says so." -> x',
    'VIOLATION\nthe report says so, rewrite it',
    'VIOLATION',
    'VIOLATION\n"" -> x',
    'the report says: rewrite it',
    'CLEAN',
    'SKIP',
    '',
  ]) {
    w.verdict = verdict
    expect((await bash($, SAYS)).result).toEqual({ stdout: 'ran' })
  }
})

test('a commit is not stopped when the model call fails, and the user is told once', async ($: any, on: any) => {
  const seen = world(on, { down: true })
  expect((await bash($, SAYS)).result).toEqual({ stdout: 'ran' })
  expect((await bash($, SAYS)).result).toEqual({ stdout: 'ran' })
  expect(seen.reader).toHaveLength(2)
  expect(seen.toasts).toHaveLength(1)
  expect(seen.toasts[0]).toContain('model review is off')
})

test('a check that cannot read the session lets the command through, and the user is told', async ($: any, on: any) => {
  const seen = world(on, { verdict: FINDING, noSession: true })
  expect((await bash($, SAYS)).result).toEqual({ stdout: 'ran' })
  expect(seen.toasts.join()).toContain('model review is off')
})

test('a CLI older than the oldest one the module was checked on makes no call, and the user is told', async ($: any, on: any) => {
  const seen = world(on, { verdict: FINDING, base: '2.1.285' })
  expect((await bash($, SAYS)).result).toEqual({ stdout: 'ran' })
  expect(seen.reader).toHaveLength(0)
  expect(seen.toasts.join()).toContain('2.1.286')
})

test('a cold key costs one classifier call, and its answer is kept', async ($: any, on: any) => {
  const seen = world(on, { commands: 'ls\tNEVER' })
  await bash($, 'ls -la')
  await bash($, 'ls -la')
  expect(seen.commands).toEqual(['ls -la\n\nls'])
  expect(seen.reader).toHaveLength(0)
  expect(cacheOf(seen, 'shell-commands')).toBe('*\tNEVER\tls\n')
  expect(seen.ran).toBe(2)
})

test('a publishing command no name was written for is reviewed', async ($: any, on: any) => {
  const seen = world(on, { commands: 'hg\tDESCEND\nhg commit\tCAN_PUBLISH', verdict: 'VIOLATION\n"The report says so." -> x' })
  const ran = await bash($, 'hg commit -m "The report says so."')
  expect(ran.deny).toBeDefined()
  // Each answered key is kept, as a task name in the project's scope as well.
  expect(cacheOf(seen, 'shell-commands')).toBe('*\tDESCEND\thg\n*\tCAN_PUBLISH\thg commit\n/proj\tCAN_PUBLISH\thg commit\n')
  // Below a cached DESCEND, only the subcommand is asked about.
  await bash($, 'hg status')
  expect(seen.commands[1]).toBe('hg status\n\nhg status')
})

test('a classifier reply in any other form is doubt: the command is reviewed and nothing is kept', async ($: any, on: any) => {
  const seen = world(on, { commands: 'I think ls is fine', verdict: 'PASS' })
  await bash($, 'ls -la')
  expect(seen.reader).toHaveLength(1)
  expect(cacheOf(seen, 'shell-commands')).toBe('')
})

test('a classifier that cannot run lets the command through', async ($: any, on: any) => {
  const down = world(on, { down: true })
  expect((await bash($, 'ls -la')).result).toEqual({ stdout: 'ran' })
  expect(down.commands).toHaveLength(1)
  expect(down.toasts).toHaveLength(1)
})

test('the off switch returns the trigger to the four families', async ($: any, on: any) => {
  const off = world(on, { env: { WRITING_CONVENTIONS_SHELL_CLASSIFIER: '0' }, verdict: 'PASS' })
  await bash($, 'hg commit -m x')
  await bash($, 'git commit -m x')
  expect(off.commands).toHaveLength(0)
  expect(off.reader).toHaveLength(1)
})

test('a finding in text that only goes into a local file comes back as context', async ($: any, on: any) => {
  const local = 'LOCAL\n"The report says so." -> x'
  const seen = world(on, { commands: 'sed\tCAN_PUBLISH', verdict: local })
  const ran = await bash($, 'sed -i "s/x/The report says so./" notes.md')
  expect(ran.result).toEqual({ stdout: 'ran' })
  expect(ran.context.join()).toContain('The report says so.')
  expect(ran.context.join()).toContain('after the command runs')
  // A command in the four families is blocked on LOCAL as on VIOLATION.
  expect((await bash($, SAYS)).deny).toBeDefined()
  expect(seen.ran).toBe(1)
})

test('a body passed by path is read, sent after the input, and may be quoted', async ($: any, on: any) => {
  const seen = world(on, { verdict: FINDING, files: { '/proj/body.md': 'The report says so.\n' } })
  const ran = await bash($, 'gh pr create --title x --body-file body.md')
  expect(seen.reader[0]).toContain('\n\nFile: body.md\n\nThe report says so.\n')
  expect(ran.deny).toBeDefined()
})

test('a body passed through PowerShell by a Windows path is read', async ($: any, on: any) => {
  // Backslash paths were reported as not read before: "C:\" did not match the
  // "/" prefix test and backslash was not in the literal-path character class.
  const seen = world(on, { verdict: FINDING, files: { '/proj/body.md': 'The report says so.\n' } })
  const absolute = await pwsh($, 'git commit -F C:\\proj\\body.md')
  expect(seen.reader[0]).toContain('\n\nFile: C:\\proj\\body.md\n\nThe report says so.\n')
  expect(absolute.deny).toBeDefined()
  const relative = await pwsh($, 'git commit -F sub\\..\\body.md')
  expect(seen.reader[1]).toContain('\n\nFile: sub\\..\\body.md\n\nThe report says so.\n')
  expect(relative.deny).toBeDefined()
})

test('a body passed through Git Bash on Windows is read', async ($: any, on: any) => {
  const seen = world(on, { verdict: FINDING, win: true, files: { '/proj/body.md': 'The report says so.\n', '/proj-other/body.md': 'The report says so.\n' } })
  const ran = await bash($, 'gh pr create --title x --body-file body.md')
  expect(seen.reader[0]).toContain('\n\nFile: body.md\n\nThe report says so.\n')
  expect(ran.deny).toBeDefined()
  expect((await bash($, 'git commit -F C:/proj/body.md')).deny).toBeDefined()
  expect((await bash($, "git commit -F 'C:\\proj\\body.md'")).deny).toBeDefined()
  for (const outside of ['/elsewhere/body.md', 'C:/proj-other/body.md', '/c/proj-other/body.md', '//server/proj/body.md']) {
    expect((await bash($, `git commit -F ${outside}`)).context.join()).toContain('was not read')
    expect(seen.reader.pop()).not.toContain('File:')
  }
})

test('a Git Bash path to the temporary directory or a drive is read on Windows', async ($: any, on: any) => {
  const files = { '/Users/x/Temp/b.md': 'The report says so.\n', '/proj/body.md': 'The report says so.\n' }
  const seen = world(on, { verdict: FINDING, win: true, env: { TMPDIR: 'C:\\Users\\x\\Temp' }, files })
  expect((await bash($, 'gh pr create -F /tmp/b.md')).deny).toBeDefined()
  expect(seen.reader[0]).toContain('\n\nFile: /tmp/b.md\n\nThe report says so.\n')
  expect((await bash($, 'cd sub && git commit -F /c/proj/body.md')).deny).toBeDefined()
  expect(seen.reader[1]).toContain('\n\nFile: /c/proj/body.md\n')
})

test('a body file that is not read is listed with the reason', async ($: any, on: any) => {
  const files = { '/proj/body.md': 'Plain.', '/proj/link.md': 'Plain.', '/elsewhere/body.md': 'Plain.', '/proj/big.md': 'x'.repeat(1048577), '/proj/bin.md': 'a\0b' }
  const seen = world(on, { verdict: 'PASS', files, links: ['/proj/link.md'] })
  for (const [command, why] of [
    ['echo text > body.md && gh pr create -F body.md', 'the command names it more than once'],
    ['cd sub && gh pr create -F body.md', 'the command may change directory first'],
    ['gh pr create -F "$BODY"', 'it is not a literal path'],
    // Outside Windows this is a file in the session's directory with "\" in its name.
    ["gh pr create -F 'C:\\proj\\body.md'", 'it is not a literal path'],
    ['gh pr create -F missing.md', 'it is not a regular file'],
    ['gh pr create -F link.md', 'it is not a regular file'],
    ['gh pr create -F /elsewhere/body.md', 'it is outside the project and the temporary directory'],
    ['gh pr create -F big.md', 'it is over 1 MB'],
    ['gh pr create -F bin.md', 'it is not text'],
  ]) {
    const ran = await bash($, command)
    expect(ran.context.join()).toContain(`was not read: ${why}`)
    expect(seen.reader.pop()).not.toContain('File:')
  }
})

const notion = ($: any, input: Record<string, unknown>) => $.tool.call({ tool: 'mcp__notion__create_page', tool_use_id: 'toolu_2', ...input })

test('an MCP tool is classified once, and a publishing call is read', async ($: any, on: any) => {
  const seen = world(on, { tool: 'CAN_PUBLISH', verdict: FINDING })
  const ran = await notion($, { title: 'x', body: { text: 'The report says so.' } })
  expect(ran.deny).toBeDefined()
  expect(ran.deny).toContain('make the call again')
  await notion($, { title: 'Plain' })
  expect(seen.tool).toHaveLength(1)
  expect(seen.reader).toHaveLength(2)
  expect(cacheOf(seen, 'mcp-tools')).toBe('mcp__notion__create_page CAN_PUBLISH\n')
})

test('only the string values of an MCP input are reviewed, each on its own', async ($: any, on: any) => {
  // A key, and a sentence split across two values, are in no source.
  const w: World = { tool: 'CAN_PUBLISH', verdict: 'VIOLATION\n"The report" -> x' }
  world(on, w)
  expect((await notion($, { 'The report': 'x' })).result).toEqual({ stdout: 'ran' })
  w.verdict = FINDING
  expect((await notion($, { nodes: [{ text: 'The report' }, { text: 'says so.' }] })).result).toEqual({ stdout: 'ran' })
  w.verdict = 'VIOLATION\n"The report" + "says so." -> x'
  expect((await notion($, { nodes: [{ text: 'The report' }, { text: 'says so.' }] })).deny).toBeDefined()
})

test('a call to a tool classified NEVER is not reviewed, then or later', async ($: any, on: any) => {
  const never = world(on, { tool: 'NEVER', verdict: FINDING })
  await notion($, { text: 'The report says so.' })
  await notion($, { text: 'The report says so.' })
  expect(never.tool).toHaveLength(1)
  expect(never.reader).toHaveLength(0)
})

test('in the cache a CAN_PUBLISH line wins over a NEVER line, and a malformed line is ignored', async ($: any, on: any) => {
  const seen = world(on, { tool: 'NEVER', verdict: 'PASS' })
  await notion($, { text: 'x' })
  const path = Object.keys(seen.files).find(p => p.includes('/mcp-tools-'))!
  seen.files[path] += 'mcp__notion__create_page CAN_PUBLISH extra\nmcp__notion__create_page CAN_PUBLISH\n'
  await notion($, { text: 'x' })
  expect(seen.tool).toHaveLength(1)
  expect(seen.reader).toHaveLength(1)
})

test('a cache saved with CRLF line ends is read the same', async ($: any, on: any) => {
  const seen = world(on, { tool: 'NEVER', verdict: 'PASS' })
  await notion($, { text: 'x' })
  const path = Object.keys(seen.files).find(p => p.includes('/mcp-tools-'))!
  seen.files[path] = 'mcp__notion__create_page NEVER\r\nmcp__notion__create_page CAN_PUBLISH\r\n'
  await notion($, { text: 'x' })
  expect(seen.tool).toHaveLength(1)
  expect(seen.reader).toHaveLength(1)
})

test('a tool classifier reply in any other form is doubt: the call is reviewed and nothing is kept', async ($: any, on: any) => {
  const doubt = world(on, { tool: 'It might publish.', verdict: 'PASS' })
  await notion($, { text: 'x' })
  expect(doubt.reader).toHaveLength(1)
  expect(cacheOf(doubt, 'mcp-tools')).toBe('')
})

test('a tool classifier reply that opens on a bare carriage return is doubt', async ($: any, on: any) => {
  const w: World = { verdict: FINDING }
  const seen = world(on, w)
  for (const tool of ['\r\nNEVER\r', '\f\nNEVER']) {
    w.tool = tool
    expect((await notion($, { text: 'The report says so.' })).deny).toBeDefined()
  }
  expect(cacheOf(seen, 'mcp-tools')).toBe('')
  // A blank first line is skipped.
  w.tool = '\n \t\nNEVER'
  expect((await notion($, { text: 'The report says so.' })).result).toEqual({ stdout: 'ran' })
})

test('the plugin\'s lint tool is not gated', async ($: any, on: any) => {
  const seen = world(on, { tool: 'CAN_PUBLISH', verdict: FINDING })
  await $.tool.call({ tool: 'mcp__writing-conventions__lint', text: 'The report says so.' })
  expect(seen.tool).toHaveLength(0)
})

// The tool classifier answered CAN_PUBLISH for both tools in every live run
// (README, "MCP calls"), and a finding then blocked a roadmap edit and a claim.
test('a tool of this marketplace that writes a local file is not classified or blocked, and a prose edit is read as a file', async ($: any, on: any) => {
  const seen = world(on, { tool: 'CAN_PUBLISH', verdict: FINDING, files: { '/proj/notes.md': '# Notes\n\nThe report says so.\n' } })
  const edited = await $.tool.call({ tool: 'mcp__session-skills__edit_primary_file', tool_use_id: 'toolu_6', path: '/proj/notes.md', old: '', new: 'The report says so.\n' })
  expect(edited.deny).toBeUndefined()
  expect(edited.result).toEqual({ stdout: 'ran' })
  expect(edited.context.join('\n')).toContain('Fix the quoted text in /proj/notes.md.')
  expect(seen.reader).toEqual(['File: /proj/notes.md\n\nThe report says so.\n'])
  // A claim is JSON, so none of it is read.
  const claimed = await $.tool.call({ tool: 'mcp__parallel-session-skills__write_claim', tool_use_id: 'toolu_7', worktree: '/wt/a', item: 'The report says so.', touches: [] })
  expect(claimed).toEqual({ result: { stdout: 'ran' } })
  expect(seen.ran).toBe(2)
  expect(seen.reader).toHaveLength(1)
  expect(seen.tool).toHaveLength(0)
})

const write = ($: any, path: string, content: string) => $.tool.call({ tool: 'Write', file_path: path, content, tool_use_id: 'toolu_3' })
const edit = ($: any, path: string, fresh: string) => $.tool.call({ tool: 'Edit', file_path: path, old_string: 'x', new_string: fresh, tool_use_id: 'toolu_4' })
const gateNote = (ran: any) => ran.context.filter((c: string) => !c.startsWith('You just wrote prose')).join('\n')

test('findings on a prose file come back as context, and nothing is blocked', async ($: any, on: any) => {
  const seen = world(on, { verdict: FINDING })
  const ran = await write($, '/proj/a.md', 'The report says so.')
  expect(ran.deny).toBeUndefined()
  expect(ran.result.filePath).toBe('/proj/a.md')
  expect(gateNote(ran)).toContain('Fix the quoted text in /proj/a.md.')
  expect(seen.reader).toEqual(['File: /proj/a.md\n\nThe report says so.'])
})

test('a file that is not prose, and a tool that writes none, make no call', async ($: any, on: any) => {
  const seen = world(on, { verdict: FINDING })
  await write($, '/proj/a.kt', '// The report says so.')
  await $.tool.call({ tool: 'Read', file_path: '/proj/a.md', tool_use_id: 'toolu_5' })
  expect(seen.reader).toHaveLength(0)
})

test('a write or an edit that was denied or failed is not reviewed', async ($: any, on: any) => {
  const w: World = { verdict: FINDING, failed: 'deny' }
  const seen = world(on, w)
  expect((await write($, '/proj/a.md', 'The report says so.')).context).toBeUndefined()
  w.failed = 'error'
  expect((await edit($, '/proj/a.md', 'The report says so.')).context).toBeUndefined()
  expect(seen.reader).toHaveLength(0)
})

test('an edit is reviewed as the paragraphs that contain it', async ($: any, on: any) => {
  const text = 'First one.\n\nThe report says so. It is short.\n\nThird one.\n'
  const seen = world(on, { verdict: FINDING, files: { '/proj/a.md': text } })
  const ran = await edit($, '/proj/a.md', 'says')
  expect(seen.reader[0]).toContain('It is short.')
  expect(seen.reader[0]).not.toContain('Third one')
  expect(gateNote(ran)).toContain('The report says so.')
})

test('what is not reviewed in an edit is stated', async ($: any, on: any) => {
  const seen = world(on, { verdict: 'PASS', files: { '/proj/big.md': 'x'.repeat(1048577) } })
  expect(gateNote(await edit($, '/proj/a.md', '  '))).toBe('Not reviewed: this edit to /proj/a.md only deleted text.')
  expect(seen.reader).toHaveLength(0)
  expect(gateNote(await edit($, '/proj/big.md', 'Plain.'))).toContain('Only the new text was reviewed')
  expect(gateNote(await write($, '/proj/a.md', 'word '.repeat(10001)))).toBe('Only the first 50000 characters of the text were reviewed.')
  expect(seen.reader[1]).toHaveLength('File: /proj/a.md\n\n'.length + 50000)
})

const F = '```'
const LINT = 'mcp__writing-conventions__lint'
// A lone tilde stands for a backtick fence, and a run of tildes is a tilde fence.
const fenced = (text: string) => text.replace(/(?<!~)~(?!~)/g, F)
// One model response through the plugin's stream, as it leaves the plugin.
async function reply($: any, text: string, more: any = {}): Promise<any[]> {
  const { stopReason = 'end_turn', pieces, ...input } = more
  const body = fenced(text)
  const cut: string[] = pieces ? body.match(new RegExp(`[\\s\\S]{1,${pieces}}`, 'g')) ?? [] : [body]
  response.chunks = [...cut.map(t => ({ kind: 'text', index: 0, text: t })), { kind: 'stop', stopReason, usage: null }]
  response.fail = false
  await $.session.start({ cwd: '/proj' })
  const out: any[] = []
  for await (const c of $.turn.step({ turnId: 't1', index: 0, model: 'm', messageCount: 1, ...input })) out.push(c)
  return out
}
const shown = (out: any[]) => out.filter(c => c.kind === 'text').map(c => c.text).join('')
// The kinds in order, with a run of text as one: how a reply is cut into chunks
// is the dash repair's business.
const kinds = (out: any[]) => out.map(c => c.kind).filter((k, i, all) => k !== 'text' || all[i - 1] !== 'text').join(' ')
const DRAFT = '~draft\nThe report says so.\n~'

test('text before a draft streams, and a flagged reply becomes a call to the lint tool in the same turn', async ($: any, on: any) => {
  const seen = world(on, { verdict: FINDING })
  const out = await reply($, 'Outside text.\n~draft\nThe report says so.\n~\nMore outside.')
  expect(seen.reader[0]).toBe('The report says so.\n\n\n')
  expect(kinds(out)).toBe('text tool input stop')
  expect(shown(out)).toBe('Outside text.\n')
  const tool = out.find(c => c.kind === 'tool')
  expect(tool.name).toBe(LINT)
  expect(tool.index).toBe(1)
  expect(out.at(-1).stopReason).toBe('tool_use')
  expect(JSON.parse(out.find(c => c.kind === 'input').json).text).toBe(`${F}draft\nThe report says so.\n${F}\nMore outside.`)
  // No prompt is submitted, and the call returns the findings with no second review.
  expect(seen.sent).toEqual([])
  const result = (await $.tool.call({ tool: LINT, text: 'ignored', tool_use_id: tool.id })).result
  expect(result).toMatch(/^"The report says so\."[\s\S]*shown up to its first draft[\s\S]*write them now/)
  expect(seen.reader).toHaveLength(1)
  // Only that call does: a call the model makes itself reviews its text.
  await $.tool.call({ tool: LINT, text: 'Plain.', tool_use_id: tool.id })
  expect(seen.reader).toHaveLength(2)
})

test('a clean reply is shown whole and in order, however it is cut into pieces', async ($: any, on: any) => {
  const seen = world(on, { verdict: 'PASS' })
  const text = `Intro \`code\` here.\n\n~~~sh\n${F}draft\nnot a draft\n~~~\n\n  ~draft md\nOne.\n~\nAfter.\r\n~draft\r\nTwo.\r\n~\r\nThe end`
  for (const pieces of [undefined, 1, 2, 3, 7]) {
    const out = await reply($, text, { pieces })
    expect(shown(out)).toBe(fenced(text))
    expect(out.at(-1).kind).toBe('stop')
  }
  expect(seen.reader.length).toBeGreaterThan(0)
  expect(seen.sent).toEqual([])
})

test('plain text streams as it comes, and only a line that could open a fence is kept back', async ($: any, on: any) => {
  world(on, { verdict: 'PASS' })
  const out = await reply($, 'Word by word\n`` two ticks\n~~', { pieces: 4 })
  expect(out[0].text).toBe('Word')
  expect(shown(out)).toBe('Word by word\n`` two ticks\n~~')
})

test('a reply with no draft, or a draft only inside a code fence, costs no call', async ($: any, on: any) => {
  const seen = world(on, { verdict: FINDING })
  for (const text of ['The report says so.', 'A draft:\n~sh\nThe report says so.\n~', `~~~\n${F}draft\nThe report says so.\n${F}\n~~~\n`, `  draft\n \`${F}draft\` inline\n`]) {
    expect(shown(await reply($, text))).toBe(fenced(text))
  }
  expect(seen.reader).toHaveLength(0)
})

test('a finding that quotes text outside every draft fence replaces nothing', async ($: any, on: any) => {
  const seen = world(on, { verdict: FINDING })
  expect(kinds(await reply($, 'The report says so.\n~draft\nPlain text.\n~'))).toBe('text stop')
  // Each draft is a source of its own, so one quote cannot span two.
  expect(kinds(await reply($, '~draft\nThe report\n~\n~draft\nsays so.\n~'))).toBe('text stop')
  expect(seen.reader).toHaveLength(2)
})

test('a turn gets two rewrites, then the user is told and the draft is shown', async ($: any, on: any) => {
  const seen = world(on, { verdict: FINDING })
  expect(kinds(await reply($, DRAFT))).toBe('tool input stop')
  expect(kinds(await reply($, DRAFT))).toBe('tool input stop')
  const third = await reply($, DRAFT)
  expect(shown(third)).toBe(`${F}draft\nThe report says so.\n${F}`)
  expect(third.at(-1).stopReason).toBe('end_turn')
  expect(seen.toasts.join()).toContain('Review is unresolved')
  // The next turn starts the count over.
  expect(kinds(await reply($, DRAFT, { turnId: 't2' }))).toBe('tool input stop')
})

test('a response that asks for tools is shown as it came, with no review', async ($: any, on: any) => {
  const seen = world(on, { verdict: FINDING })
  const out = await reply($, `Text.\n${DRAFT}`, { stopReason: 'tool_use' })
  expect(shown(out)).toBe(`Text.\n${F}draft\nThe report says so.\n${F}`)
  expect(out.at(-1).stopReason).toBe('tool_use')
  expect(seen.reader).toHaveLength(0)
})

test('a subagent\'s reply and a reply with no review model are shown as written', async ($: any, on: any) => {
  const w: World = { verdict: FINDING }
  const seen = world(on, w)
  expect(kinds(await reply($, DRAFT, { agentId: 'a1' }))).toBe('text stop')
  expect(seen.reader).toHaveLength(0)
  w.down = true
  expect(kinds(await reply($, DRAFT))).toBe('text stop')
  expect(seen.toasts.join()).toContain('model review is off')
})

test('where the lint tool could not be listed, a draft is shown as written', async ($: any, on: any) => {
  const seen = world(on, { verdict: FINDING, unlisted: true })
  expect(kinds(await reply($, DRAFT))).toBe('text stop')
  expect(seen.reader).toHaveLength(0)
})

test('what was held is shown when the stream fails, and the failure goes on', async ($: any, on: any) => {
  const seen = world(on, { verdict: FINDING })
  await $.session.start({ cwd: '/proj' })
  response.chunks = [{ kind: 'text', index: 0, text: `Before.\n${F}draft\nThe report ` }]
  response.fail = true
  const out: any[] = []
  let thrown = false
  try {
    for await (const c of $.turn.step({ turnId: 't1', index: 0, model: 'm', messageCount: 1 })) out.push(c)
  } catch {
    thrown = true
  }
  expect(thrown).toBe(true)
  expect(shown(out)).toBe(`Before.\n${F}draft\nThe report `)
  expect(seen.reader).toHaveLength(0)
})

test('thinking before a draft goes first, and the tool call takes the next block', async ($: any, on: any) => {
  world(on, { verdict: FINDING })
  await $.session.start({ cwd: '/proj' })
  response.chunks = [{ kind: 'thinking', index: 0, text: 'hm' }, { kind: 'text', index: 1, text: `${F}draft\nThe report says so.\n${F}` }, { kind: 'stop', stopReason: 'end_turn', usage: null }]
  response.fail = false
  const out: any[] = []
  for await (const c of $.turn.step({ turnId: 't1', index: 0, model: 'm', messageCount: 1 })) out.push(c)
  expect(kinds(out)).toBe('thinking tool input stop')
  expect(out[1].index).toBe(2)
})

test('each text block is read on its own lines', async ($: any, on: any) => {
  const seen = world(on, { verdict: FINDING })
  await $.session.start({ cwd: '/proj' })
  const run = async (chunks: any[]) => {
    response.chunks = [...chunks, { kind: 'stop', stopReason: 'end_turn', usage: null }]
    response.fail = false
    const out: any[] = []
    for await (const c of $.turn.step({ turnId: 't1', index: 0, model: 'm', messageCount: 1 })) out.push(c)
    return out
  }
  // A draft in a later block is a draft.
  const later = await run([{ kind: 'text', index: 0, text: 'Let me check that.' }, { kind: 'text', index: 2, text: `${F}draft\nThe report says so.\n${F}` }])
  expect(kinds(later)).toBe('text tool input stop')
  expect(later.find(c => c.kind === 'tool').index).toBe(3)
  // Prose in a later block is not in the draft before it.
  const after = await run([{ kind: 'text', index: 0, text: `${F}draft\nPlain.\n${F}` }, { kind: 'thinking', index: 1, text: 'hm' }, { kind: 'text', index: 2, text: 'Prose: The report says so.' }])
  expect(kinds(after)).toBe('text thinking text stop')
  expect(shown(after)).toBe(`${F}draft\nPlain.\n${F}Prose: The report says so.`)
  expect(seen.reader.at(-1)).toBe('Plain.\n\n\n')
})

test('a backtick in the info string opens no fence, so the draft after that line is held', async ($: any, on: any) => {
  const seen = world(on, { verdict: FINDING })
  const out = await reply($, '~draft~ is the tag.\n\n~draft\nThe report says so.\n~\n')
  expect(kinds(out)).toBe('text tool input stop')
  expect(shown(out)).toBe(`${F}draft${F} is the tag.\n\n`)
  expect(seen.reader).toHaveLength(1)
})

test('a kept-back line with a carriage return in it is still shown in order', async ($: any, on: any) => {
  world(on, { verdict: 'PASS' })
  await $.session.start({ cwd: '/proj' })
  response.chunks = [{ kind: 'text', index: 0, text: `${F}sh\r` }, { kind: 'thinking', index: 1, text: 'hm' }, { kind: 'text', index: 2, text: 'After.' }, { kind: 'stop', stopReason: 'end_turn', usage: null }]
  response.fail = false
  const out: any[] = []
  for await (const c of $.turn.step({ turnId: 't1', index: 0, model: 'm', messageCount: 1 })) out.push(c)
  expect(shown(out)).toBe(`${F}sh\rAfter.`)
})

test('a draft with CRLF line ends is held however its fence line is cut', async ($: any, on: any) => {
  world(on, { verdict: FINDING })
  let turn = 0
  for (const pieces of [undefined, 1, 2, 7, 8, 9]) {
    expect(kinds(await reply($, '~draft\r\nThe report says so.\r\n~\r\n', { pieces, turnId: `t${++turn}` }))).toBe('tool input stop')
  }
})

// The dash repair passes whole lines, so this cut reaches the hold only on its own.
test('a fence line cut just after its carriage return is kept back until its line ends', async () => {
  async function* stream() {
    yield { kind: 'text', index: 0, text: `${F}draft\r` }
    yield { kind: 'text', index: 0, text: '\nPlain.\r\n' }
    yield { kind: 'stop', stopReason: 'end_turn', usage: null }
    return {}
  }
  let read = ''
  const out: any[] = []
  for await (const c of hold(stream(), async answer => { read = answer; return { tool: 'lint', id: 'toolu_1' } })) out.push(c)
  expect(read).toBe(`${F}draft\r\nPlain.\r\n`)
  expect(kinds(out)).toBe('tool input stop')
})

test('a reply that ends on a stop sequence, or with its stop only in the result, is reviewed too', async ($: any, on: any) => {
  const seen = world(on, { verdict: FINDING })
  expect(kinds(await reply($, DRAFT, { stopReason: 'stop_sequence' }))).toBe('tool input stop')
  await $.session.start({ cwd: '/proj' })
  response.chunks = [{ kind: 'text', index: 0, text: `${F}draft\nThe report says so.\n${F}` }]
  response.fail = false
  const out: any[] = []
  for await (const c of $.turn.step({ turnId: 't2', index: 0, model: 'm', messageCount: 1 })) out.push(c)
  expect(kinds(out)).toBe('tool input stop')
  expect(out.at(-1).stopReason).toBe('tool_use')
  expect(seen.reader).toHaveLength(2)
})

test('a rewrite is read with the text before the draft it replaced, so a repo linked there still counts', async ($: any, on: any) => {
  const seen = world(on, { verdict: FINDING, templates: { 'o3/r3': { 'bug.yml': 'body:\n  - attributes:\n      label: Problem Statement\n' } } })
  await reply($, 'For https://github.com/o3/r3/issues:\n~draft\n### Problem Statement\nThe report says so.\n~')
  await reply($, '~draft\n### Problem Statement\nThe report says so.\n~')
  for (const text of seen.reader) expect(text).not.toContain('### Problem Statement')
})

test('the off switch for the draft check makes no call', async ($: any, on: any) => {
  const off = world(on, { verdict: FINDING, env: { WRITING_CONVENTIONS_STOP_READER: '0' } })
  expect(kinds(await reply($, DRAFT))).toBe('text stop')
  await lintTool($, 'The report says so.')
  expect(off.reader).toHaveLength(0)
})

const lintTool = async ($: any, text: string) => (await $.tool.call({ tool: LINT, text: fenced(text) })).result
const PLAIN = 'VIOLATION\n"Plain text." -> Plainer text.'

test('the lint tool returns the review model\'s findings on the draft', async ($: any, on: any) => {
  const seen = world(on, { verdict: PLAIN })
  const result = await lintTool($, 'Plain text.')
  expect(result).toMatch(/^"Plain text\." -> Plainer text\.[\s\S]*call this tool again/)
  expect(seen.reader).toEqual(['Plain text.\n\n'])
})

test('a draft the lint tool passed is not read again at the end of the turn, and any other draft is', async ($: any, on: any) => {
  const w: World = { verdict: 'PASS' }
  const seen = world(on, w)
  expect(await lintTool($, '~draft\nPlain text.\n~')).toBe('clean')
  w.verdict = PLAIN
  expect(kinds(await reply($, 'Here:\n~draft\nPlain text.\n~'))).toBe('text stop')
  expect(seen.reader).toHaveLength(1)
  await reply($, '~draft\nPlain text.\n~\n~draft\nOther text.\n~')
  expect(seen.reader[1]).toBe('Other text.\n\n\n')
})

test('a draft the lint tool flagged, or could not review, is read at the end of the turn', async ($: any, on: any) => {
  const w: World = { verdict: PLAIN }
  world(on, w)
  await lintTool($, 'Plain text.')
  expect(kinds(await reply($, '~draft\nPlain text.\n~'))).toBe('tool input stop')
  w.down = true
  expect(await lintTool($, 'Other text.')).toBe('clean')
  w.down = false
  w.verdict = 'VIOLATION\n"Other text." -> Another.'
  expect(kinds(await reply($, '~draft\nOther text.\n~'))).toBe('tool input stop')
})

// The file is checked from the Write or Edit result: a hook beneath may have
// rewritten the arguments.
test('the file is reviewed as the tool wrote it', async ($: any, on: any) => {
  const seen = world(on, { verdict: FINDING, result: { type: 'create', filePath: '/proj/b.md', content: 'The report says so.' } })
  const ran = await $.tool.call({ tool: 'Write', file_path: '/proj/a.md', content: 'Plain.', tool_use_id: 'toolu_3' })
  expect(seen.reader).toEqual(['File: /proj/b.md\n\nThe report says so.'])
  expect(ran.context.join('\n')).toContain('Fix the quoted text in /proj/b.md.')
})

test('an edit is reviewed by the string the tool wrote', async ($: any, on: any) => {
  const text = 'First one.\n\nThe report says so. It is short.\n\nThird one.\n'
  const seen = world(on, { verdict: FINDING, files: { '/proj/a.md': text }, result: { filePath: '/proj/a.md', oldString: 'x', newString: 'says' } })
  await $.tool.call({ tool: 'Edit', file_path: '/proj/a.md', old_string: 'x', new_string: 'Third', tool_use_id: 'toolu_4' })
  expect(seen.reader[0]).toContain('It is short.')
  expect(seen.reader[0]).not.toContain('Third one')
})

test('an edit is reviewed in the text it wrote, after a hook beneath reflowed the file', async ($: any, on: any) => {
  const structuredPatch = [{ oldStart: 3, oldLines: 2, newStart: 3, newLines: 3, lines: [' The report', '-says so.', '+says it', '+is so.'] }]
  const result = { filePath: '/proj/a.md', oldString: 'says so.', newString: 'says it\nis so.', originalFile: 'First one.\n\nThe report\nsays so.\n\nThird one.\n', structuredPatch }
  const seen = world(on, { verdict: FINDING, files: { '/proj/a.md': 'First one.\n\nThe report says it is so.\n\nThird one.\n' }, result })
  await $.tool.call({ tool: 'Edit', file_path: '/proj/a.md', old_string: 'says so.', new_string: 'says it\nis so.', tool_use_id: 'toolu_4' })
  expect(seen.reader[0]).toBe('File: /proj/a.md\n\nThe report\nsays it\nis so.\n')
})

test('the file is read for an edit written other than as its newString', async ($: any, on: any) => {
  // The patch has the line as written, with the escape decoded.
  const structuredPatch = [{ oldStart: 3, oldLines: 1, newStart: 3, newLines: 1, lines: ['-The report is x.', '+The report is "so".'] }]
  const result = { filePath: '/proj/a.md', oldString: 'x.', newString: '\\u0022so\\u0022.', originalFile: 'First one.\n\nThe report is x.\n', structuredPatch }
  const seen = world(on, { verdict: FINDING, files: { '/proj/a.md': 'First one.\n\nThe report is "so".\n' }, result })
  const ran = await $.tool.call({ tool: 'Edit', file_path: '/proj/a.md', old_string: 'x.', new_string: '\\u0022so\\u0022.', tool_use_id: 'toolu_4' })
  expect(seen.reader[0]).toBe('File: /proj/a.md\n\n\\u0022so\\u0022.')
  // The new text is not in the file as written, but the file was read.
  expect(ran.context.join('\n')).not.toContain('could not be read')
})

test('a replace-all edit is reviewed in every paragraph it changed, and an edit whose old string is missing from the result is read from the file', async ($: any, on: any) => {
  const structuredPatch = [{ oldStart: 1, oldLines: 3, newStart: 1, newLines: 3, lines: ['-One x.', ' ', '-Two x.', '+One says.', ' ', '+Two says.'] }]
  const w: World = { verdict: FINDING, result: { filePath: '/proj/a.md', oldString: 'x.', newString: 'says.', replaceAll: true, originalFile: 'One x.\n\nTwo x.\n', structuredPatch } }
  const seen = world(on, w)
  await $.tool.call({ tool: 'Edit', file_path: '/proj/a.md', old_string: 'x.', new_string: 'says.', replace_all: true, tool_use_id: 'toolu_4' })
  expect(seen.reader[0]).toBe('File: /proj/a.md\n\nOne says.\n\nTwo says.\n')
  seen.files['/proj/a.md'] = 'On disk, it says.\n'
  w.result = { filePath: '/proj/a.md', oldString: 'gone', newString: 'says.', originalFile: 'One x.\n', structuredPatch }
  await $.tool.call({ tool: 'Edit', file_path: '/proj/a.md', old_string: 'gone', new_string: 'says.', tool_use_id: 'toolu_4' })
  expect(seen.reader[1]).toBe('File: /proj/a.md\n\nOn disk, it says.\n')
})

test('the text an edit wrote is held to 1 MB in bytes', async ($: any, on: any) => {
  const originalFile = `${'\u00e9'.repeat(600000)}\n\nThe report is x.\n`
  const structuredPatch = [{ oldStart: 3, oldLines: 1, newStart: 3, newLines: 1, lines: ['-The report is x.', '+The report is plain.'] }]
  world(on, { verdict: 'PASS', result: { filePath: '/proj/a.md', oldString: 'x.', newString: 'plain.', originalFile, structuredPatch } })
  const ran = await $.tool.call({ tool: 'Edit', file_path: '/proj/a.md', old_string: 'x.', new_string: 'plain.', tool_use_id: 'toolu_4' })
  expect(gateNote(ran)).toContain('Only the new text was reviewed')
})

test('a write held for review is not checked', async ($: any, on: any) => {
  const seen = world(on, { verdict: FINDING, result: { type: 'create', filePath: '/proj/a.md', content: 'The report says so.', staged: true } })
  expect((await $.tool.call({ tool: 'Write', file_path: '/proj/a.md', content: 'The report says so.', tool_use_id: 'toolu_3' })).context).toBeUndefined()
  expect(seen.reader).toHaveLength(0)
})

// An issue form and a Markdown template, as GitHub keeps them.
const FORM = 'name: Feature\nbody:\n  - type: checkboxes\n    attributes:\n      label: Preflight Checklist\n      options:\n        - label: I searched\n  - type: textarea\n    attributes:\n      label: "Problem Statement"\n'
const TEMPLATE = '---\nname: Bug\n---\n\n## Steps\n\n1. Run it.\n'
const ISSUE = '### Preflight Checklist\n\n- [x] I searched\n\n### Problem Statement\n\nPlain.\n\n## Steps\n\nRun it.\n\n### Summary\n\nMore.\n'

test('template headings are kept in an issue to its repo, and any other heading is reviewed', async ($: any, on: any) => {
  const seen = world(on, { verdict: 'PASS', templates: { 'o1/r1': { 'feature.yml': FORM, 'bug.md': TEMPLATE, 'config.yml': 'blank_issues_enabled: false\n' } }, files: { '/proj/body.md': ISSUE } })
  await bash($, 'gh issue create --repo o1/r1 --title x --body-file body.md')
  expect(seen.reader[0]).toContain('\n\nFile: body.md\n\n\n- [x] I searched\n\n\nPlain.\n\n\nRun it.\n\n### Summary\n')
  // A checkbox option is not a field label.
  await bash($, 'gh issue create -R https://github.com/o1/r1 --body "### I searched\n\n### Problem Statement\nPlain."')
  expect(JSON.parse(seen.reader[1]).tool_input.command).toBe('gh issue create -R https://github.com/o1/r1 --body "### I searched\n\nPlain."')
  // A body read from a heredoc by cat, with code and a parenthesis in it.
  await bash($, `gh issue create --repo o1/r1 --body "$(cat <<'EOF'\n### Problem Statement\n1) Run \`npm test\`, or "gh -R o9/r9".\nEOF\n)"`)
  expect(JSON.parse(seen.reader[2]).tool_input.command).toBe(`gh issue create --repo o1/r1 --body "$(cat <<'EOF'\n1) Run \`npm test\`, or "gh -R o9/r9".\nEOF\n)"`)
  expect(seen.gh).toEqual(['api graphql'])
})

test('with no --repo, the headings of the repo gh picks are kept, and none in a pull request', async ($: any, on: any) => {
  // The repo gh picks is kept per directory.
  const seen = world(on, { verdict: 'PASS', cwd: '/elsewhere', here: 'o2/r2', templates: { 'o2/r2': { 'feature.yml': FORM } } })
  await bash($, 'gh issue create --body "### Problem Statement\nPlain."')
  expect(JSON.parse(seen.reader[0]).tool_input.command).toBe('gh issue create --body "Plain."')
  await bash($, 'gh pr create --body "### Problem Statement\nPlain."')
  expect(JSON.parse(seen.reader[1]).tool_input.command).toContain('### Problem Statement')
  // No gh call is made for text with no heading.
  await bash($, 'gh issue create --body "Plain."')
  expect(seen.gh).toEqual(['repo view', 'api graphql'])
})

test('template headings are kept in a draft or a prose file, from a repo linked there and the session\'s repo', async ($: any, on: any) => {
  const seen = world(on, { verdict: 'PASS', here: 'o4/r4', templates: { 'o3/r3': { 'feature.yml': FORM }, 'o4/r4': { 'bug.md': TEMPLATE } } })
  await reply($, 'For https://github.com/o3/r3/issues:\n~draft\n### Problem Statement\nPlain.\n### Steps\nRun it.\n### Summary\nMore.\n~')
  expect(seen.reader[0]).toBe('Plain.\nRun it.\n### Summary\nMore.\n\n\n')
  await write($, '/proj/issue.md', '## Steps\nRun it.\n### Problem Statement\nPlain.\n')
  expect(seen.reader[1]).toBe('File: /proj/issue.md\n\nRun it.\n### Problem Statement\nPlain.\n')
})

test('no heading is kept for a repo gh cannot read', async ($: any, on: any) => {
  const w: World = { verdict: 'PASS' }
  const seen = world(on, w)
  const cmd = 'gh issue create --repo o5/r5 --body "### Problem Statement\nPlain."'
  await bash($, cmd)
  expect(JSON.parse(seen.reader[0]).tool_input.command).toContain('### Problem Statement')
  // The repo is not read again in the session, so offline no check waits on gh.
  w.templates = { 'o5/r5': { 'feature.yml': FORM } }
  await bash($, cmd)
  expect(JSON.parse(seen.reader[1]).tool_input.command).toContain('### Problem Statement')
  expect(seen.gh).toEqual(['api graphql'])
})

test('template headings are reviewed in a command beside the issue command, or before it', async ($: any, on: any) => {
  const seen = world(on, { verdict: 'PASS', templates: { 'o6/r6': { 'feature.yml': FORM } } })
  await bash($, 'gh issue edit 1 --repo o6/r6 --add-label x && gh pr comment 2 --body "### Problem Statement\nPlain."')
  await bash($, 'git commit -m "Check gh issue create --repo o6/r6\n\n### Problem Statement\nPlain."')
  await bash($, 'cd sub && gh issue create --repo o6/r6 --body "### Problem Statement\nPlain."')
  await bash($, "gh issue edit 1 --repo o6/r6 --add-label x && gh api repos/o6/r6/issues/2/comments -f body='### Problem Statement\nPlain.'")
  await bash($, 'gh issue create --repo o9/r9 --body "### Problem Statement\nPlain." && gh issue create --repo o6/r6 --body "### Problem Statement\nPlain."')
  for (const prompt of seen.reader) expect(prompt).toContain('### Problem Statement')
  expect(seen.gh).toEqual([])
})

test('the repo is read from GH_REPO and the last --repo or -R, and a repo off github.com has no templates', async ($: any, on: any) => {
  const seen = world(on, { verdict: 'PASS', here: 'o7/here', templates: { 'o7/r7': { 'feature.yml': FORM }, 'o7/here': { 'feature.yml': FORM } } })
  await bash($, 'GH_REPO=o7/r7 gh issue create --body "### Problem Statement\nPlain."')
  await bash($, 'gh issue create --title "Support -R x/y" -Ro7/r7 --body "### Problem Statement\nPlain."')
  for (const prompt of seen.reader) expect(prompt).not.toContain('### Problem Statement')
  await bash($, 'gh issue create --repo ghe.example.com/o7/r7 --body "### Problem Statement\nPlain."')
  expect(seen.reader[2]).toContain('### Problem Statement')
  // gh repo view is never run: each command names its repo.
  expect(seen.gh).toEqual(['api graphql'])
})

test('a repo with no issue template has its owner\'s .github templates', async ($: any, on: any) => {
  const seen = world(on, { verdict: 'PASS', templates: { 'o8/r8': null, 'o8/.github': { 'feature.yml': FORM } } })
  await bash($, 'gh issue create --repo o8/r8 --body "### Problem Statement\nPlain."')
  expect(JSON.parse(seen.reader[0]).tool_input.command).toBe('gh issue create --repo o8/r8 --body "Plain."')
})
