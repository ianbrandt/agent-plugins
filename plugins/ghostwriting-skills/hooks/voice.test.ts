// claude plugin test: voice.ts against a stand-in file system.
import { expect, test } from 'claude-code/testing'

const SPEC = '/v/voice-spec.md'
const CACHE = '/home/.claude/plugins/cache'

// files <path to text>: answers the reads, and lists a directory from the paths
// under it. `env` answers $.env.get. A path in `locked` is there and cannot be
// read. The paths read are returned.
function files(on: any, texts: Record<string, string>, env: Record<string, string> = {}, locked: string[] = []) {
  const reads: string[] = []
  // On Windows the engine gives a handler the path with a drive letter and backslashes.
  const posix = (p: string) => p.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')
  on('env.get', (_$: any, e: any) => ({ value: { HOME: '/home', GHOSTWRITING_DIR: '/v', ...env }[e.name as string] }))
  on('fs.read', (_$: any, e: any) => {
    const at = posix(e.path)
    reads.push(at)
    return at in texts && !locked.includes(at) ? { value: texts[at] } : { deny: 'no such file' }
  })
  on('fs.exists', (_$: any, e: any) => ({ value: posix(e.path) in texts }))
  on('fs.list', (_$: any, e: any) => {
    const dir = posix(e.path)
    const names = new Set<string>()
    for (const path of Object.keys(texts)) {
      if (path.startsWith(dir + '/')) names.add(path.slice(dir.length + 1).split('/')[0])
    }
    if (names.size === 0) return { deny: 'no such directory' }
    return { value: [...names].map(name => ({ name, kind: Object.keys(texts).includes(`${dir}/${name}`) ? 'file' : 'dir', size: (texts[`${dir}/${name}`] ?? '').length, mtimeMs: 0, isLink: false })) }
  })
  on('tool.call', () => ({ result: 'Launching skill' }))
  return reads
}

// loaded <skill>: what the plugin adds beside the Skill tool's result.
const loaded = async ($: any, skill: string) => ((await $.tool.call({ tool: 'Skill', skill })).context ?? []).join('\n')

test('the spec, every sample, and the newest rules file are added beside the Skill result', async ($: any, on: any) => {
  files(on, {
    [SPEC]: 'SPEC TEXT',
    '/v/corpus/issues.md': 'ISSUE SAMPLE',
    '/v/corpus/pr-bodies.md': 'PR SAMPLE',
    '/v/corpus/notes.bin': 'NOT A SAMPLE',
    [`${CACHE}/m/writing-conventions/0.9.0/hooks/rules.md`]: 'OLD RULES',
    [`${CACHE}/m/writing-conventions/0.44.0/hooks/rules.md`]: 'NEW RULES',
  })
  const text = await loaded($, 'ghostwriting-skills:ghostwrite')
  for (const part of ['VOICE=/v\n', 'SPEC TEXT', 'ISSUE SAMPLE', 'PR SAMPLE', 'NEW RULES']) expect(text).toContain(part)
  for (const part of ['NOT A SAMPLE', 'OLD RULES']) expect(text).not.toContain(part)
})

test('with no spec the model is sent to the bootstrap section', async ($: any, on: any) => {
  files(on, { '/v/corpus/issues.md': 'ISSUE SAMPLE' })
  const text = await loaded($, 'ghostwrite')
  expect(text).toContain('MODE=bootstrap')
  expect(text).not.toContain('ISSUE SAMPLE')
})

test('a corpus over the cap is listed by name for the model to read', async ($: any, on: any) => {
  files(on, { [SPEC]: 'SPEC TEXT', '/v/corpus/a.md': 'x'.repeat(40000), '/v/corpus/b.md': 'y'.repeat(40000) })
  const text = await loaded($, 'ghostwrite')
  expect(text).toContain('`/v/corpus/a.md`, `/v/corpus/b.md`')
  expect(text).not.toContain('xxxx')
})

test('without GHOSTWRITING_DIR the default directory is read', async ($: any, on: any) => {
  files(on, { '/home/.claude/ghostwriting/voice-spec.md': 'HOME SPEC' }, { GHOSTWRITING_DIR: '' })
  const text = await loaded($, 'ghostwrite')
  expect(text).toContain('HOME SPEC')
})

test('no text is added for another skill', async ($: any, on: any) => {
  files(on, { [SPEC]: 'SPEC TEXT' })
  const text = await loaded($, 'session-skills:land-and-wrap')
  expect(text).toBe('')
})

test('the share skill gets the directory and whether it has a spec, and no file', async ($: any, on: any) => {
  const reads = files(on, { [SPEC]: 'SPEC TEXT' })
  const text = await loaded($, 'ghostwriting-skills:share-ghostwriting-spec')
  expect(text).toBe('\n\n---\n\n## Voice directory, located by the plugin\n\nVOICE=/v\nspec: /v/voice-spec.md\n')
  expect(reads).toEqual([])
})

test('the share skill is told when there is no spec', async ($: any, on: any) => {
  files(on, {}, { GHOSTWRITING_DIR: '' })
  const text = await loaded($, 'share-ghostwriting-spec')
  expect(text).toContain('VOICE=/home/.claude/ghostwriting\nNO SPEC\n')
})

test('a spec that is there and cannot be read is not a bootstrap', async ($: any, on: any) => {
  files(on, { [SPEC]: 'SPEC TEXT' }, {}, [SPEC])
  const text = await loaded($, 'ghostwrite')
  expect(text).toContain('VOICE=/v\n\nThe plugin could not read `/v/voice-spec.md`.')
  expect(text).not.toContain('MODE=bootstrap')
})

test('with no HOME the default directory is under USERPROFILE', async ($: any, on: any) => {
  files(on, { '/u/.claude/ghostwriting/voice-spec.md': 'PROFILE SPEC' }, { GHOSTWRITING_DIR: '', HOME: '', USERPROFILE: '/u' })
  const text = await loaded($, 'ghostwrite')
  expect(text).toContain('PROFILE SPEC')
})

test('a sample that cannot be read is listed, and the corpus is not called whole', async ($: any, on: any) => {
  files(on, { [SPEC]: 'SPEC TEXT', '/v/corpus/issues.md': 'ISSUE SAMPLE', '/v/corpus/pr-bodies.md': 'PR SAMPLE' }, {}, ['/v/corpus/pr-bodies.md'])
  const text = await loaded($, 'ghostwrite')
  expect(text).toContain('ISSUE SAMPLE')
  expect(text).not.toContain('every sample')
  expect(text).toMatch(/could not read[^\n]*`\/v\/corpus\/pr-bodies\.md`/)
})

test('a corpus far over the cap is not read at all', async ($: any, on: any) => {
  const reads = files(on, { [SPEC]: 'SPEC TEXT', '/v/corpus/a.txt': 'x'.repeat(300000) })
  const text = await loaded($, 'ghostwrite')
  expect(text).toContain('`/v/corpus/a.txt`')
  expect(reads).not.toContain('/v/corpus/a.txt')
})

test('a cache entry that is not a version is passed over', async ($: any, on: any) => {
  files(on, {
    [SPEC]: 'SPEC TEXT',
    [`${CACHE}/m/writing-conventions/.DS_Store`]: 'x',
    [`${CACHE}/m/writing-conventions/0.44.0/hooks/rules.md`]: 'NEW RULES',
    [`${CACHE}/m/writing-conventions/main/hooks/rules.md`]: 'BRANCH RULES',
  })
  const text = await loaded($, 'ghostwrite')
  expect(text).toContain('NEW RULES')
  expect(text).not.toContain('BRANCH RULES')
})

test('the newest rules file is taken across the old and the new plugin name', async ($: any, on: any) => {
  files(on, {
    [SPEC]: 'SPEC TEXT',
    [`${CACHE}/m/writing-conventions/0.55.2/hooks/rules.md`]: 'OLD NAME RULES',
    [`${CACHE}/m/writing-skills/0.56.0/hooks/rules.md`]: 'NEW NAME RULES',
  })
  const text = await loaded($, 'ghostwrite')
  expect(text).toContain('NEW NAME RULES')
  expect(text).not.toContain('OLD NAME RULES')
})

test('with no rules file the model is told to re-read it by hand', async ($: any, on: any) => {
  files(on, { [SPEC]: 'SPEC TEXT' })
  const text = await loaded($, 'ghostwrite')
  expect(text).toContain('did not find the always-on rules file')
})

// Under managed settings `cc-plugin-sec-default` sends `skill.prompt` past every
// plugin and prints a notice for each one it skips, so the plugin registers none.
test('the skill prompt is left as it is', async ($: any, on: any) => {
  files(on, { [SPEC]: 'SPEC TEXT' })
  on('skill.prompt', (_$: any, e: any) => ({ text: e.text }))
  expect((await $.skill.prompt({ skill: 'ghostwriting-skills:ghostwrite', text: 'SKILL' })).text).toBe('SKILL')
})

// For a typed slash command the engine runs skill.prompt inside prompt.submit's
// next(), as this stand-in does, and makes no Skill call.
function typed($: any, on: any) {
  on('skill.prompt', (_$: any, e: any) => ({ text: e.text }))
  on('prompt.submit', async (_$: any, e: any) => {
    const skill = e.command ? (await $.skill.prompt({ skill: e.command.name, text: 'SKILL' })).text : ''
    return { text: e.text, context: e.context, skill }
  })
}

const count = (r: any) => [...(r.context ?? []), r.skill].join('\n').split('SPEC TEXT').length - 1

test('the spec is added once for a typed command', async ($: any, on: any) => {
  files(on, { [SPEC]: 'SPEC TEXT' })
  typed($, on)
  expect(count(await $.prompt.submit({ text: '/ghostwrite', command: { name: 'ghostwrite', args: '' } }))).toBe(1)
  expect(count(await $.prompt.submit({ text: '/ghostwriting-skills:ghostwrite a PR', command: { name: 'ghostwriting-skills:ghostwrite', args: 'a PR' } }))).toBe(1)
})

test('no context is added for a prompt that is not one of these commands', async ($: any, on: any) => {
  files(on, { [SPEC]: 'SPEC TEXT' })
  typed($, on)
  expect((await $.prompt.submit({ text: 'draft a PR' })).context ?? []).toEqual([])
  expect((await $.prompt.submit({ text: '/land-and-wrap', command: { name: 'session-skills:land-and-wrap', args: '' } })).context ?? []).toEqual([])
})
