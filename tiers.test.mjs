// node --test: Confer and orchestration-skills name their tiers alike. Confer has
// no mechanical tier, and the defaults differ on purpose.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const config = plugin => JSON.parse(readFileSync(new URL(`plugins/${plugin}/.claude-plugin/plugin.json`, import.meta.url), 'utf8')).userConfig
const confer = config('confer')
const orchestration = config('orchestration-skills')
const tiersOf = (settings, prefix) =>
  Object.keys(settings).flatMap(key => key.match(new RegExp(`^${prefix}([A-Z]?[a-z]+)Model$`))?.[1].toLowerCase() ?? [])
const up = tier => tier[0].toUpperCase() + tier.slice(1)

test('the tiers of Confer are the tiers of orchestration-skills after mechanical', () => {
  assert.deepEqual(tiersOf(orchestration, ''), ['mechanical', ...tiersOf(confer, 'claude')])
})

test('each shared tier has the same model and effort settings in both plugins, defaults aside', () => {
  for (const tier of tiersOf(confer, 'claude')) {
    for (const knob of ['Model', 'Effort']) {
      const { default: _a, title: _b, description: _c, ...ours } = orchestration[`${tier}${knob}`]
      const { default: _d, title: _e, description: _f, ...theirs } = confer[`claude${up(tier)}${knob}`]
      assert.deepEqual(ours, theirs, `${tier}${knob}`)
    }
  }
})
