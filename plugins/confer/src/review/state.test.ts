import type { EngineInterface } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { forget, getRun, inMemory, remember, save } from './state'
import type { Attempt, RunState } from './state'

const limit = 4 * 2 ** 20

// $.fs.write refuses text over 4 MiB, which left the state unsaved and the run's worktree and refs in place.
test('a state over 4 MiB is saved without the prompts and replies of earlier rounds', async () => {
  const written: Record<string, string> = {}
  const write = async (path: string, text: string) => {
    if (new TextEncoder().encode(text).length > limit) throw new Error('over 4 MiB')
    written[path] = text
  }
  const $ = { fs: { write } } as unknown as EngineInterface
  const attempt = (round: number, side: Attempt['side']): Attempt => ({
    phase: 0,
    round,
    side,
    number: 1,
    status: round === 1 ? 'replied' : 'waiting',
    prompt: 'p'.repeat(limit / 2),
    raw: round === 1 ? 'r'.repeat(limit / 2) : undefined,
    model: 'm',
    effort: 'high',
  })
  const run = {
    id: 'abcdef01',
    dir: '/runs/abcdef01',
    phases: [{ number: 0, round: 2 }],
    attempts: [attempt(1, 'claude'), attempt(1, 'codex'), attempt(2, 'claude')],
  } as unknown as RunState

  await save($, remember(run), 5)

  const saved = JSON.parse(written['/runs/abcdef01/state.json']!)
  expect(saved.updatedAt).toBe(5)
  expect(saved.attempts.map((a: Attempt) => [a.round, a.prompt?.length, a.raw?.length])).toEqual([
    [1, undefined, undefined],
    [1, undefined, undefined],
    [2, limit / 2, undefined],
  ])
  expect(run.attempts[0]!.prompt).toHaveLength(limit / 2)
})

test('a copy that is no longer the cached one is not saved', async () => {
  const written: Record<string, string> = {}
  const $ = { fs: { write: async (path: string, text: string) => void (written[path] = text) } } as unknown as EngineInterface
  const run = { id: 'abcdef02', dir: '/runs/abcdef02', phases: [], attempts: [] } as unknown as RunState
  remember(run)
  forget(run.id)

  expect(await save($, run, 5).catch(e => e)).toBeInstanceOf(Error)
  expect(written).toEqual({})
})

// A state.json as another session left it, read through a $ whose reads can be held, and a held read can return an earlier text.
function disk(id: string) {
  const file = { text: '' as string | undefined, held: undefined as Promise<string | void> | undefined }
  const written: Record<string, string> = {}
  const $ = {
    env: { get: async (name: string) => (name === 'CLAUDE_CONFIG_DIR' ? '/c' : undefined) },
    fs: {
      read: async (path: string) => {
        const held = file.held
        file.held = undefined
        const earlier = await held
        if (path !== `/c/tmp/confer/${id}/state.json` || file.text === undefined) throw new Error(`ENOENT: ${path}`)
        return earlier ?? file.text
      },
      write: async (path: string, text: string) => void (written[path] = text),
    },
  } as unknown as EngineInterface
  const put = (change: object) => (file.text = JSON.stringify({ id, dir: `/c/tmp/confer/${id}`, status: 'running', phases: [], attempts: [], updatedAt: 1, ...change }))
  return { $, file, written, put }
}

test('a run read again from an unchanged state.json is the copy already in use, so a call holding it can save it', async () => {
  const { $, written, put } = disk('abcdef03')
  put({})
  const held = (await getRun($, 'abcdef03'))!
  expect(await getRun($, 'abcdef03')).toBe(held)
  await save($, held, 5)
  expect(JSON.parse(written['/c/tmp/confer/abcdef03/state.json']!)).toMatchObject({ updatedAt: 5 })
})

test('a newer state.json read while another call cached an older copy replaces that copy', async () => {
  const { $, file, put } = disk('abcdef04')
  put({})
  let open = () => {}
  file.held = new Promise<void>(resolve => (open = resolve))
  const slow = getRun($, 'abcdef04')
  expect(await getRun($, 'abcdef04')).toMatchObject({ status: 'running' })
  put({ status: 'cancelled', updatedAt: 2 })
  open()
  expect(await slow).toMatchObject({ status: 'cancelled' })
})

test('an older state.json read while another call cached a newer copy leaves that copy in use', async () => {
  const { $, file, put } = disk('abcdef05')
  const older = put({})
  let open = (_?: string) => {}
  file.held = new Promise<string | void>(resolve => (open = resolve))
  const slow = getRun($, 'abcdef05')
  put({ status: 'cancelled', updatedAt: 2 })
  const newer = await getRun($, 'abcdef05')
  open(older)
  expect(await slow).toBe(newer)
})

test('a state.json with the same updatedAt read while another call cached an older copy replaces that copy', async () => {
  const { $, file, put } = disk('abcdef06')
  put({})
  let open = () => {}
  file.held = new Promise<void>(resolve => (open = resolve))
  const slow = getRun($, 'abcdef06')
  expect(await getRun($, 'abcdef06')).toMatchObject({ status: 'running' })
  put({ status: 'cancelled' })
  open()
  expect(await slow).toMatchObject({ status: 'cancelled' })
})

test('an older state.json with the same updatedAt read while another call cached a newer copy leaves that copy in use', async () => {
  const { $, file, put } = disk('abcdef07')
  const older = put({})
  let open = (_?: string) => {}
  file.held = new Promise<string | void>(resolve => (open = resolve))
  const slow = getRun($, 'abcdef07')
  put({ status: 'cancelled' })
  const newer = await getRun($, 'abcdef07')
  open(older)
  expect(await slow).toBe(newer)
})

test('an older state.json read again while a third call cached a newer copy leaves that copy in use', async () => {
  const { $, file, put } = disk('abcdef08')
  const first = put({})
  let open = (_?: string) => {}
  file.held = new Promise<string | void>(resolve => (open = resolve))
  const slow = getRun($, 'abcdef08')
  const second = put({ status: 'cancelled', updatedAt: 2 })
  await getRun($, 'abcdef08')
  let reopen = (_?: string) => {}
  file.held = new Promise<string | void>(resolve => (reopen = resolve))
  open(first)
  for (let i = 0; file.held !== undefined && i < 100; i++) await Promise.resolve()
  expect(file.held).toBeUndefined()
  put({ status: 'cancelled', updatedAt: 3 })
  const newest = await getRun($, 'abcdef08')
  reopen(second)
  expect(await slow).toBe(newest)
})

async function expectDropped(id: string, unreadable: string | undefined) {
  const { $, file, written, put } = disk(id)
  put({})
  const copy = (await getRun($, id))!
  file.text = unreadable
  expect(await getRun($, id)).toBeUndefined()
  expect(inMemory().includes(copy)).toBe(false)
  expect(await save($, copy, 5).catch(e => e)).toBeInstanceOf(Error)
  expect(written).toEqual({})
}

test('a run whose state.json no longer parses is dropped, so its copy is not saved', () => expectDropped('abcdef09', '{'))

test('a run whose state.json is gone is dropped, so its copy is not saved', () => expectDropped('abcdef0a', undefined))

test('a run this process created is kept while its state.json cannot be read', async () => {
  const { $, file } = disk('abcdef0b')
  file.text = undefined
  const run = remember({ id: 'abcdef0b', dir: '/c/tmp/confer/abcdef0b', phases: [], attempts: [{ status: 'running' }] } as unknown as RunState)
  expect(await getRun($, 'abcdef0b')).toBe(run)
  expect(run.attempts[0]!.status).toBe('running')
})

test('state.json keeps only the prompt of a waiting Claude attempt', async () => {
  const written: Record<string, string> = {}
  const $ = { fs: { write: async (path: string, text: string) => void (written[path] = text) } } as unknown as EngineInterface
  const attempt = (side: Attempt['side'], status: Attempt['status'], prompt: string): Attempt => ({ phase: 0, round: 1, side, number: 1, status, prompt, model: 'm', effort: 'high' })
  const run = {
    id: 'abcdef0b',
    dir: '/runs/abcdef0b',
    phases: [{ number: 0, round: 1 }],
    attempts: [attempt('claude', 'replied', 'a'), attempt('codex', 'running', 'b'), attempt('claude', 'waiting', 'p')],
  } as unknown as RunState

  await save($, remember(run), 5)

  expect(JSON.parse(written['/runs/abcdef0b/state.json']!).attempts.map((a: Attempt) => a.prompt)).toEqual([undefined, undefined, 'p'])
  expect(run.attempts.map(a => a.prompt)).toEqual(['a', 'b', 'p'])
})
