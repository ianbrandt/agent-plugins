// The plugin's one hooks module: hooks.json may list only one.
import type { Register } from 'claude-code'
import { repair } from './dash'
import { checksDrafts, flagged, register as gate } from './gate'
import { hold } from './hold'

export const register: Register = (on, options) => {
  gate(on, options)
  // The review reads a draft as the user would have seen it, so the dash repair
  // runs first.
  on('turn.step', async function* ($, e, next) {
    const stream = repair($, e, next)
    if (e.agentId || !(await checksDrafts($))) return yield* stream
    return yield* hold(stream, answer => flagged($, e.turnId, answer))
  })
}
