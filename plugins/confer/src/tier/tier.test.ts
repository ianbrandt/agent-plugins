import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, OpEventResult } from 'claude-code'
import type { TierChoice } from './tier'

const choose = async ($: Engine, fields: object): Promise<TierChoice | string> => {
  const { text = '' } = await $.command.run({
    command: 'confer-tier',
    args: JSON.stringify({ command: 'review', pick: 'complex', isSure: true, args: '', ...fields }),
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })
  return text.startsWith('{') ? JSON.parse(text) : text
}

type Reply = OpEventResult<'model.complete'>
const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const served: Reply = { value: { isAnswered: true, text: 'OK', usage } }
const notFound: Reply = { value: { isAnswered: false, reason: 'api-error', status: 404, error: 'model_not_found', usage } }

// Answers each model check with `reply` and lists the models checked.
const serve = (on: On, reply: Reply = served) => {
  const checked: string[] = []
  on('model.complete', (_, e) => {
    checked.push(e.model)
    return reply
  })
  return checked
}

// Answers the tier question with `answer`, or dismisses it when `answer` is an Error.
const answer = (on: On, answer: string | Error) => {
  const asked: unknown[] = []
  on('tool.call', { tool: 'AskUserQuestion' }, (_, e) => {
    asked.push(e.questions)
    if (answer instanceof Error) throw answer
    return { result: { questions: e.questions, answers: { [e.questions[0]!.question]: answer } } }
  })
  return asked
}

test('a sure pick runs at its tier with no question', async ($, on) => {
  mock.env(on, {})
  const asked = answer(on, 'Routine')

  expect(await choose($, {})).toEqual({
    tier: 'complex',
    claude: { model: 'opus', effort: 'high' },
    codex: { model: 'gpt-6.1-sol', effort: 'xhigh' },
    args: [],
  })
  expect(asked).toEqual([])
})

test('each tier pairs the models and efforts of the table', async ($, on) => {
  mock.env(on, {})
  serve(on)
  const sides = async (tier: string) => {
    const choice = (await choose($, { args: `--tier ${tier}` })) as TierChoice
    return [choice.claude, choice.codex]
  }

  expect(await sides('routine')).toEqual([
    { model: 'sonnet', effort: 'high' },
    { model: 'gpt-6.1-sol', effort: 'medium' },
  ])
  expect(await sides('critical')).toEqual([
    { model: 'fable', effort: 'high' },
    { model: 'gpt-6-astra', effort: 'high' },
  ])
  expect(await sides('escalation')).toEqual([
    { model: 'fable', effort: 'xhigh' },
    { model: 'gpt-6-astra', effort: 'max' },
  ])
})

test('Fable tiers fall back to Opus where the account is not served Fable', async ($, on) => {
  mock.env(on, {})
  const checked = serve(on, notFound)

  expect(((await choose($, { args: '--tier critical' })) as TierChoice).claude).toEqual({ model: 'opus', effort: 'xhigh' })
  expect(((await choose($, { args: '--tier escalation' })) as TierChoice).claude).toEqual({ model: 'opus', effort: 'max' })
  expect(checked).toEqual(['fable', 'fable'])
})

test('a model the engine refuses to send falls back too, and other failures keep Fable', async ($, on) => {
  mock.env(on, {})
  let reply: Reply = { deny: 'fable is not in availableModels' }
  on('model.complete', () => reply)

  expect(((await choose($, { pick: 'critical' })) as TierChoice).claude.model).toBe('opus')
  reply = { value: { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage } }
  expect(((await choose($, { pick: 'critical' })) as TierChoice).claude.model).toBe('fable')
})

test('a Claude model set in the arguments is not checked', async ($, on) => {
  mock.env(on, {})
  const checked = serve(on, notFound)

  const choice = (await choose($, { args: '--tier critical --claude-model fable' })) as TierChoice

  expect(choice.claude).toEqual({ model: 'fable', effort: 'high' })
  expect(checked).toEqual([])
})

test('an unsure pick is asked about, the pick first', async ($, on) => {
  mock.env(on, {})
  const asked = answer(on, 'Critical')

  const choice = (await choose($, { pick: 'routine', isSure: false })) as TierChoice

  expect(choice.tier).toBe('critical')
  expect(asked).toEqual([
    [
      expect.objectContaining({
        question: 'Which tier should Confer run this review at?',
        options: ['Routine (Recommended)', 'Complex', 'Critical', 'Escalation'].map((label) => expect.objectContaining({ label })),
      }),
    ],
  ])
})

test('the recommended label and a typed tier name are both answers', async ($, on) => {
  mock.env(on, {})
  let next = 'Routine (Recommended)'
  on('tool.call', { tool: 'AskUserQuestion' }, (_, e) => ({ result: { questions: e.questions, answers: { [e.questions[0]!.question]: next } } }))

  expect(((await choose($, { pick: 'routine', isSure: false })) as TierChoice).tier).toBe('routine')
  next = ' escalation '
  expect(((await choose($, { pick: 'routine', isSure: false })) as TierChoice).tier).toBe('escalation')
})

test('an answer that is no tier fails the choice', async ($, on) => {
  answer(on, 'Opus for both')

  expect(await choose($, { isSure: false })).toBe('Error: "Opus for both" is not a tier: routine, complex, critical, or escalation.')
})

test('a dismissed question, or no one to ask, takes the pick', async ($, on) => {
  mock.env(on, {})
  answer(on, new Error('dismissed'))

  expect(((await choose($, { pick: 'critical', isSure: false })) as TierChoice).tier).toBe('critical')
})

test('arguments set either side, and the tier fills the rest', async ($, on) => {
  mock.env(on, {})
  const asked = answer(on, 'Routine')

  const choice = await choose($, { args: '--fix --claude-model opus --codex-effort=low src/' })

  expect(choice).toEqual({
    tier: 'complex',
    claude: { model: 'opus', effort: 'high' },
    codex: { model: 'gpt-6.1-sol', effort: 'low' },
    args: ['--fix', 'src/'],
  })
  expect(asked).toEqual([])
})

test('quotes keep a path with spaces in one word', async ($, on) => {
  mock.env(on, {})
  const choice = (await choose($, { args: `--fix "src/a dir/x.ts" 'it''s' --tier=routine "" src\\x.ts` })) as TierChoice

  expect(choice.tier).toBe('routine')
  expect(choice.args).toEqual(['--fix', 'src/a dir/x.ts', 'its', '', 'src\\x.ts'])
})

test('an unclosed quote fails the choice', async ($) => {
  expect(await choose($, { args: '"src/a dir' })).toBe('Error: The arguments have an unclosed " quote.')
})

test('no question is asked when arguments set both sides or the tier', async ($, on) => {
  mock.env(on, {})
  serve(on)
  const asked = answer(on, 'Routine')

  const first = (await choose($, { isSure: false, args: '--claude-effort low --codex-model bedrock-gpt-6.1-sol' })) as TierChoice
  const second = (await choose($, { isSure: false, args: '--tier critical' })) as TierChoice

  expect(first).toEqual({
    tier: 'complex',
    claude: { model: 'opus', effort: 'low' },
    codex: { model: 'bedrock-gpt-6.1-sol', effort: 'xhigh' },
    args: [],
  })
  expect(second).toEqual({
    tier: 'critical',
    claude: { model: 'fable', effort: 'high' },
    codex: { model: 'gpt-6-astra', effort: 'high' },
    args: [],
  })
  expect(asked).toEqual([])
})

test('the question covers only the side no argument sets', async ($, on) => {
  mock.env(on, {})
  const asked = answer(on, 'Routine')

  const choice = (await choose($, { isSure: false, args: '--claude-effort max' })) as TierChoice

  expect(choice.claude).toEqual({ model: 'sonnet', effort: 'max' })
  expect(asked).toEqual([[expect.objectContaining({ question: 'Which tier should Codex run this review at?' })]])
})

test('Confer never picks escalation itself', async ($) => {
  expect(await choose($, { pick: 'escalation' })).toBe('Error: Escalation runs only when the user asks for it.')
})

test('an ANTHROPIC_DEFAULT_*_MODEL env var pins the alias to the id the main session uses', async ($, on) => {
  serve(on)
  on('env.get', (_, e) => ({ value: e.name === 'ANTHROPIC_DEFAULT_SONNET_MODEL' ? 'bedrock-claude-sonnet-5-5[1m]' : undefined }))

  const choice = (await choose($, { pick: 'routine' })) as TierChoice

  expect(choice.claude).toEqual({ model: 'bedrock-claude-sonnet-5-5[1m]', effort: 'high' })
})

test('an alias passed as --claude-model is pinned through the env var too', async ($, on) => {
  const checked = serve(on)
  on('env.get', (_, e) => ({ value: e.name === 'ANTHROPIC_DEFAULT_OPUS_MODEL' ? 'bedrock-claude-opus-5-5' : undefined }))

  const choice = (await choose($, { args: '--tier critical --claude-model opus' })) as TierChoice

  expect(choice.claude).toEqual({ model: 'bedrock-claude-opus-5-5', effort: 'high' })
  expect(checked).toEqual([])
})

test('a bad argument fails the choice', async ($) => {
  expect(await choose($, { args: '--claude-effort extra' })).toBe('Error: --claude-effort takes low, medium, high, xhigh, or max, not "extra".')
  expect(await choose($, { args: '--tier' })).toBe('Error: --tier needs a value.')
  expect(await choose($, { args: '--codex-model' })).toBe('Error: --codex-model needs a value.')
})
