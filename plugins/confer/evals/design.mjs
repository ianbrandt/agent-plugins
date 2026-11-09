// Usage: npm run eval:design -- <routine|complex|critical|check> [case id ...]
// check verifies each case's terms without running a design review.
// Reviews each case's design with no one present and appends a scored row to ~/.claude/tmp/confer-evals/runs/<stamp>-design-<tier>/results.jsonl.
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { base, commit, git, headless, must, runDir, tiers } from './headless.mjs'
import { row, scoreDesign } from './score.ts'

const [tier, ...ids] = process.argv.slice(2)
const checking = tier === 'check'
if (!checking && !tiers.includes(tier ?? '')) {
  console.error('Usage: npm run eval:design -- <routine|complex|critical|check> [case id ...]')
  process.exit(2)
}
const cases = join(dirname(fileURLToPath(import.meta.url)), 'design-cases')
const run = checking ? '' : runDir(`design-${tier}`)
const tools = 'Skill,ToolSearch,Agent,Read,Grep,Glob,Edit,mcp__confer__plan_start,mcp__confer__plan_round,mcp__confer__plan_revision,mcp__confer__plan_cancel,mcp__confer__git'

// The design as the one file of a fresh repository, which the conductor revises in place.
function build(c) {
  const dir = join(base, 'repos', `design-${c.id}`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  must(git(dir, 'init', '-q'), 'git init')
  copyFileSync(join(cases, c.id, 'design.md'), join(dir, 'design.md'))
  commit(dir, 'Add the design')
  return dir
}

// Fails a case when a gap has no terms, a term is no regular expression, or a term is already in the design, so the gap would not be missing.
function check(c) {
  const design = readFileSync(join(cases, c.id, 'design.md'), 'utf8')
  for (const g of c.gaps) {
    if (g.terms.length === 0) throw new Error(`${g.defect} has no terms`)
    for (const t of g.terms) if (new RegExp(t, 'i').test(design)) throw new Error(`${g.defect}: "${t}" is in the design`)
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
    const text = headless(build(c), `/confer:plan design.md --tier ${tier} --findings "${findings}"`, tools)
    appendFileSync(log, text)
    out = row(c, tier, existsSync(findings) ? JSON.parse(readFileSync(findings, 'utf8')) : undefined, text, { findings, log }, scoreDesign)
  } catch (e) {
    out = { case: c.id, tier, error: String(e.message), log }
  }
  appendFileSync(join(run, 'results.jsonl'), `${JSON.stringify(out)}\n`)
  console.log(JSON.stringify(out))
}
