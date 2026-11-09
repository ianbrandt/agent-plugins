// Helpers shared by the eval runners.
import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, cpSync, mkdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

export const base = join(homedir(), '.claude', 'tmp', 'confer-evals')
export const tiers = ['routine', 'complex', 'critical']
// shortcut: a fixed 30-minute limit, so a critical-tier case that needs longer ends expired; raise it when one does.
const timeout = 30 * 60 * 1000

export const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' })
export const must = (r, what) => {
  if (r.status !== 0) throw new Error(`${what}: ${r.stderr}`)
  return r.stdout
}

// A fixed identity and date, so the reviewers see no real author and every build of a case has the same SHAs.
const identity = { GIT_AUTHOR_NAME: 'Eval Author', GIT_AUTHOR_EMAIL: 'author@example.invalid', GIT_COMMITTER_NAME: 'Eval Author', GIT_COMMITTER_EMAIL: 'author@example.invalid', GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z' }
export const commit = (dir, message) => {
  must(git(dir, 'add', '-A'), 'git add')
  must(spawnSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', message], { cwd: dir, encoding: 'utf8', env: { ...process.env, ...identity } }), 'git commit')
}

// A case's project as the one commit of a fresh repository.
export function project(name, src) {
  const dir = join(base, 'repos', name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  must(git(dir, 'init', '-q'), 'git init')
  cpSync(src, dir, { recursive: true })
  commit(dir, 'Add the project')
  // -p skips the trust dialog, so project hooks and MCP servers in the checkout would run.
  if (must(git(dir, 'ls-tree', '--name-only', 'HEAD', '--', '.claude', '.mcp.json'), 'git ls-tree').trim()) throw new Error('the checkout has project hooks or MCP servers')
  return dir
}

export function runDir(tier) {
  const run = join(base, 'runs', `${new Date().toISOString().replace(/[:.]/g, '-')}-${tier}`)
  mkdirSync(run, { recursive: true })
  return run
}

// The checkout these evals are in, loaded in place of the installed Confer, so a run tests this checkout's code.
const plugin = dirname(dirname(fileURLToPath(import.meta.url)))

// Runs a command in Claude Code with no one present, and returns its stream-json output.
export function headless(cwd, prompt, tools) {
  const r = spawnSync('claude', ['-p', prompt, '--plugin-dir', plugin, '--output-format', 'stream-json', '--verbose', '--allowedTools', tools], { cwd, encoding: 'utf8', timeout, killSignal: 'SIGTERM', maxBuffer: 1 << 30 })
  return `${r.stdout ?? ''}${r.stderr ?? ''}`
}

// Runs a command in Claude Code over stream-json, with the runner as the user: AskUserQuestion is answered with answer(input), Write
// and Edit inside cwd are allowed, and any other tool not in tools is denied. Each finished turn gets reply(its text) as the next turn
// until reply returns undefined.
// Once the tool named last returns, the turn is interrupted and the run ends, with the session's cost in the interrupted turn's result.
// Each line is appended to log as it arrives, so a run that hangs shows where.
export function converse(cwd, prompt, tools, { answer, reply, last, log }) {
  const p = spawn('claude', ['-p', '--plugin-dir', plugin, '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--replay-user-messages', '--permission-prompt-tool', 'stdio', '--permission-mode', 'manual', '--allowedTools', tools], { cwd })
  const send = o => p.stdin.write(`${JSON.stringify(o)}\n`)
  const user = content => send({ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null })
  // A write after the process exits fails with EPIPE, which would otherwise end the runner.
  p.stdin.on('error', () => {})
  let out = ''
  let err = ''
  let turn = []
  let stopping = false
  const ends = new Set()
  // Writes under ~/.claude, where the checkouts are, ask for permission even when Write and Edit are in tools.
  const inside = input => typeof input?.file_path === 'string' && resolve(cwd, input.file_path).startsWith(`${cwd}${sep}`)
  p.stderr.on('data', d => (err += d))
  const timer = setTimeout(() => p.kill('SIGTERM'), timeout)
  createInterface({ input: p.stdout }).on('line', line => {
    out += `${line}\n`
    appendFileSync(log, `${line}\n`)
    let e
    try {
      e = JSON.parse(line)
    } catch {
      return
    }
    if (e.type === 'assistant' && e.parent_tool_use_id == null) {
      for (const b of e.message?.content ?? []) {
        if (b.type === 'text') turn.push(b.text)
        if (b.type === 'tool_use' && b.name === last) ends.add(b.id)
      }
    } else if (e.type === 'control_request' && e.request?.subtype === 'can_use_tool') {
      const { tool_name, input } = e.request
      const response =
        tool_name === 'AskUserQuestion' ? { behavior: 'allow', updatedInput: { ...input, answers: answer(input) } }
        : (tool_name === 'Write' || tool_name === 'Edit') && inside(input) ? { behavior: 'allow', updatedInput: input }
        : { behavior: 'deny', message: 'Not allowed in this eval.' }
      send({ type: 'control_response', response: { subtype: 'success', request_id: e.request_id, response } })
    } else if (!stopping && e.type === 'user' && Array.isArray(e.message?.content) && e.message.content.some(b => b.type === 'tool_result' && ends.has(b.tool_use_id))) {
      stopping = true
      send({ type: 'control_request', request_id: 'end', request: { subtype: 'interrupt' } })
    } else if (e.type === 'result') {
      const next = stopping ? undefined : reply(turn.join('\n'))
      turn = []
      if (next === undefined) p.stdin.end()
      else user(next)
    }
  })
  user(prompt)
  return new Promise((done, fail) => {
    p.on('error', fail)
    p.on('close', () => {
      clearTimeout(timer)
      appendFileSync(log, err)
      done(`${out}${err}`)
    })
  })
}
