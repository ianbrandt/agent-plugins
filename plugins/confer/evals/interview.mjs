// Usage: npm run eval:interview -- <run|check> [case id ...]
// check verifies each case without running an interview.
// Drafts each case's plan with /confer:plan at the routine tier, answering the conductor's questions from the case, stops once the
// review is started, and appends a scored row to ~/.claude/tmp/confer-evals/runs/<stamp>-interview/results.jsonl.
import { appendFileSync, copyFileSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { converse, project, runDir } from './headless.mjs'
import { questionsIn, recommended, scoreInterview, scripted, session } from './score.ts'

const [mode, ...ids] = process.argv.slice(2)
if (mode !== 'run' && mode !== 'check') {
  console.error('Usage: npm run eval:interview -- <run|check> [case id ...]')
  process.exit(2)
}
const checking = mode === 'check'
const cases = join(dirname(fileURLToPath(import.meta.url)), 'interview-cases')
const run = checking ? '' : runDir('interview')
// Write is for the new file. Agent and plan_round are left out, so no reviewer can start if the interrupt comes late.
const tools = 'Skill,ToolSearch,Read,Grep,Glob,Write,Edit,mcp__confer__plan_start'
const maxReplies = 5

// Fails a case that could not be scored: no goal or repo/, a file already in repo/, an entry with no terms or a term that is no
// regular expression, a constraint the goal or a scripted answer gives away or that repo/ does not show, or no scripted answer that
// contains the file.
function check(c) {
  if (typeof c.goal !== 'string' || c.goal.trim() === '') throw new Error('the case has no goal')
  const repo = join(cases, c.id, 'repo')
  if (!existsSync(repo)) throw new Error('the case has no repo/')
  if (existsSync(join(repo, c.file))) throw new Error(`${c.file} is already in repo/`)
  const files = readdirSync(repo, { recursive: true, withFileTypes: true }).filter(d => d.isFile()).map(d => readFileSync(join(d.parentPath, d.name), 'utf8'))
  for (const e of [...c.constraints, ...c.questions, ...c.needless, ...c.sections]) {
    const label = e.constraint ?? e.question ?? e.section
    if (e.terms.length === 0) throw new Error(`${label} has no terms`)
    for (const t of e.terms) {
      try {
        new RegExp(t, 'i')
      } catch {
        throw new Error(`${label}: "${t}" is not a regular expression`)
      }
    }
  }
  for (const k of c.constraints) {
    for (const t of k.terms) {
      if (new RegExp(t, 'i').test(c.goal)) throw new Error(`${k.constraint}: "${t}" is in the goal`)
      const giving = c.questions.find(q => new RegExp(t, 'i').test(q.answer))
      if (giving) throw new Error(`${k.constraint}: "${t}" is in the answer to ${giving.question}`)
    }
    if (!files.some(f => k.terms.some(t => new RegExp(t, 'i').test(f)))) throw new Error(`${k.constraint}: no term is in repo/`)
  }
  if (!c.questions.some(q => q.answer.includes(c.file))) throw new Error(`no scripted answer contains ${c.file}`)
}

async function interview(c) {
  const dir = project(`interview-${c.id}`, join(cases, c.id, 'repo'))
  const answer = input => Object.fromEntries(input.questions.map(q => [q.question, scripted(c, `${q.question}\n${q.header}`)?.answer ?? recommended(q)]))
  let replies = 0
  const reply = text => {
    if (replies++ === maxReplies) return undefined
    const answers = new Set(questionsIn(text).flatMap(q => scripted(c, q)?.answer ?? []))
    return [...answers, 'The assumptions are right, and for anything else, go with your recommendations.'].join(' ')
  }
  const log = join(run, `${c.id}.jsonl`)
  const text = await converse(dir, `/confer:plan --tier routine ${c.goal}`, tools, { answer, reply, last: 'mcp__confer__plan_start', log })
  // The next build of the case deletes the checkout, so the file is kept beside the log.
  const written = join(dir, c.file)
  const file = existsSync(written) ? join(run, `${c.id}.md`) : undefined
  if (file) copyFileSync(written, file)
  return { case: c.id, ...scoreInterview(c, file && readFileSync(file, 'utf8'), text), ...session(text), file, log }
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
  let out
  try {
    out = await interview(c)
  } catch (e) {
    out = { case: c.id, error: String(e.message) }
  }
  appendFileSync(join(run, 'results.jsonl'), `${JSON.stringify(out)}\n`)
  console.log(JSON.stringify(out))
}
