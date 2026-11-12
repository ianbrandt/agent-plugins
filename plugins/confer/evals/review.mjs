// Usage: npm run eval:review -- <routine|complex|critical|check> [--claude-model <m>] [--claude-effort <e>] [--codex-model <m>] [--codex-effort <e>] [case id ...]
// check builds each case and verifies its findings without running a review.
// Reviews each case with no one present and appends a scored row to ~/.claude/tmp/confer-evals/runs/<stamp>-<tier>[-<override values>]/results.jsonl.
// An override flag is passed to /confer:review with its value, so one tier can be measured on another model or effort.
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { base, commit, git, headless, must, runDir, tiers } from './headless.mjs'
import { row, score } from './score.ts'

const [tier, ...rest] = process.argv.slice(2)
const overrides = []
const ids = []
for (let i = 0; i < rest.length; i++) rest[i].startsWith('--') ? overrides.push(rest[i], rest[++i]) : ids.push(rest[i])
const checking = tier === 'check'
const flags = ['--claude-model', '--claude-effort', '--codex-model', '--codex-effort']
if (!checking && (!tiers.includes(tier ?? '') || overrides.some((w, i) => i % 2 === 0 ? !flags.includes(w) : w === undefined))) {
  console.error('Usage: npm run eval:review -- <routine|complex|critical|check> [--claude-model <m>] [--claude-effort <e>] [--codex-model <m>] [--codex-effort <e>] [case id ...]')
  process.exit(2)
}
const here = dirname(fileURLToPath(import.meta.url))
const run = checking ? '' : runDir([tier, ...overrides.filter((_, i) => i % 2 === 1)].join('-'))
const tools = 'Skill,ToolSearch,Agent,Read,Grep,Glob,mcp__confer__review_start,mcp__confer__review_round,mcp__confer__review_settle,mcp__confer__review_fixes,mcp__confer__review_cancel,mcp__confer__git'

// Builds the case's project as a fresh repository: base/ committed, then head/ copied over it and committed as the change.
function build(c) {
  // Under the run's own folder, so two runs at once do not rebuild each other's checkouts.
  const dir = checking ? join(base, 'repos', c.id) : join(run, 'repos', c.id)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  must(git(dir, 'init', '-q'), 'git init')
  cpSync(join(here, 'cases', c.id, 'base'), dir, { recursive: true })
  commit(dir, 'Add the project')
  cpSync(join(here, 'cases', c.id, 'head'), dir, { recursive: true })
  commit(dir, c.message)
  must(git(dir, 'update-ref', 'refs/remotes/origin/HEAD', 'HEAD^'), 'git update-ref')
  // -p skips the trust dialog, so project hooks and MCP servers in the checkout would run.
  if (must(git(dir, 'ls-tree', '--name-only', 'HEAD', '--', '.claude', '.mcp.json'), 'git ls-tree').trim()) throw new Error('the checkout has project hooks or MCP servers')
  return dir
}

// Fails a case when the change is empty or a finding is not at a line of its file.
function check(c, dir) {
  if (!must(git(dir, 'diff', '--name-only', 'HEAD^', 'HEAD'), 'git diff').trim()) throw new Error('the change is empty')
  for (const f of c.findings) {
    const file = join(dir, f.path)
    if (!existsSync(file)) throw new Error(`${f.path} is not in the project`)
    const lines = readFileSync(file, 'utf8').split('\n').length - 1
    if (f.line !== null && !(f.line >= 1 && f.line <= lines)) throw new Error(`${f.path}:${f.line} is past the end of the file`)
  }
}

const cases = readdirSync(join(here, 'cases'), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => ({ id: d.name, ...JSON.parse(readFileSync(join(here, 'cases', d.name, 'case.json'), 'utf8')) }))
for (const c of cases.filter(c => ids.length === 0 || ids.includes(c.id))) {
  if (checking) {
    try {
      check(c, build(c))
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
    const cwd = build(c)
    const text = headless(cwd, `/confer:review --tier ${tier} ${overrides.map(w => `${w} `).join('')}--findings "${findings}"`, tools)
    appendFileSync(log, text)
    out = row(c, tier, existsSync(findings) ? JSON.parse(readFileSync(findings, 'utf8')) : undefined, text, { findings, log }, score)
  } catch (e) {
    out = { case: c.id, tier, error: String(e.message), log }
  }
  appendFileSync(join(run, 'results.jsonl'), `${JSON.stringify(out)}\n`)
  console.log(JSON.stringify(out))
}
