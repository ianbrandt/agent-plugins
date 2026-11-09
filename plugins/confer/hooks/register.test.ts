import { expect, test } from 'claude-code/testing'

test('Confer loads and passes session.start through', async ($, on) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  const started = await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  expect(started).toEqual({ cwd: '/' })
})
