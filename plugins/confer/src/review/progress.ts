import type { EngineInterface } from 'claude-code'
import type { Attempt, RunState } from './state'

const names = { claude: 'Claude', codex: 'Codex' }

// Nothing is shown during a round call while Codex runs, so each reviewer's start and end is a line in the transcript.
function log($: EngineInterface, run: RunState, attempt: Attempt, text: string): void {
  const kind = attempt.phase > 0 ? 'fix review' : run.ask !== undefined ? 'ask' : run.design !== undefined ? 'plan' : 'review'
  const tier = run.phases.find(p => p.number === attempt.phase)?.tier
  const retry = attempt.number > 1 ? `, attempt ${attempt.number}` : ''
  $.ui.log(`Confer ${run.id} ${kind}, ${tier}, round ${attempt.round}${retry}: ${names[attempt.side]} ${text}`)
}

export async function logStart($: EngineInterface, run: RunState, attempt: Attempt): Promise<void> {
  attempt.startedAt = await $.clock.now()
  log($, run, attempt, `started (${attempt.model}, ${attempt.effort})`)
}

export async function logEnd($: EngineInterface, run: RunState, attempt: Attempt): Promise<void> {
  const after = attempt.startedAt === undefined ? '' : ` after ${Math.round(((await $.clock.now()) - attempt.startedAt) / 1000)}s`
  if (attempt.status === 'replied') log($, run, attempt, `returned${after}`)
  else if (attempt.status === 'failed') log($, run, attempt, `failed${after}: ${attempt.failure?.split('\n')[0]}`)
  else if (attempt.status === 'limited') log($, run, attempt, `hit a ${run.pause?.limit.replace(/_/g, ' ')}`)
}
