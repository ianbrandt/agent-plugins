// Usage: npm run eval:ask -- <routine|complex|critical|check> [case id ...]
// check verifies each case's terms without running a question.
// Asks each case's question with no one present and appends a scored row to ~/.claude/tmp/confer-evals/runs/<stamp>-ask-<tier>/results.jsonl.
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { headless, project, runDir, tiers } from './headless.mjs'
import { row, scoreAsk } from './score.ts'

const [tier, ...ids] = process.argv.slice(2)
const checking = tier === 'check'
if (!checking && !tiers.includes(tier ?? '')) {
  console.error('Usage: npm run eval:ask -- <routine|complex|critical|check> [case id ...]')
  process.exit(2)
}
const cases = join(dirname(fileURLToPath(import.meta.url)), 'ask-cases')
const run = checking ? '' : runDir(`ask-${tier}`)
const tools = 'Skill,ToolSearch,Agent,Read,Grep,Glob,mcp__confer__ask_start,mcp__confer__ask_round,mcp__confer__ask_cancel,mcp__confer__git'

// Fails a case with no question or no repo/, a point with no terms, or a term that is in the question, so the framing would not hide the point.
function check(c) {
  if (typeof c.question !== 'string' || c.question.trim() === '') throw new Error('the case has no question')
  if (!existsSync(join(cases, c.id, 'repo'))) throw new Error('the case has no repo/')
  for (const p of c.points) {
    if (p.terms.length === 0) throw new Error(`${p.point} has no terms`)
    for (const t of p.terms) if (new RegExp(t, 'i').test(c.question)) throw new Error(`${p.point}: "${t}" is in the question`)
  }
}

const all = readdirSync(cases, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => ({ id: d.name, ...JSON.parse(readFileSync(join(cases, d.name, 'case.json'), 'utf8')) }))
for (const c of all.filter(c => ids.length === 0 || ids.includes(c.id))) {
  if (checking) {
    try {
      check(c)
      console.log(`ok ${c.id}`)
    } catch (e) {
      console.log(`FAIL ${c.id}: ${e.message}`)
      process.exitCode = 1
    }
    continue
  }
  const findings = join(run, `${c.id}.findings.json`)
  const log = join(run, `${c.id}.jsonl`)
  let out
  try {
    const text = headless(project(`ask-${c.id}`, join(cases, c.id, 'repo')), `/confer:ask --tier ${tier} --findings "${findings}" ${c.question}`, tools)
    appendFileSync(log, text)
    out = row(c, tier, existsSync(findings) ? JSON.parse(readFileSync(findings, 'utf8')) : undefined, text, { findings, log }, scoreAsk)
  } catch (e) {
    out = { case: c.id, tier, error: String(e.message), log }
  }
  appendFileSync(join(run, 'results.jsonl'), `${JSON.stringify(out)}\n`)
  console.log(JSON.stringify(out))
}
