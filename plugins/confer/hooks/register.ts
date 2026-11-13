import type { EngineInterface, Register } from 'claude-code'
import { askCancel, askRound, startAsk } from '../src/ask/ask'
import { runCodex } from '../src/codex/run'
import { cancelDesign, designRound, reviseDesign, startDesign } from '../src/design/design'
import { isOffered, onAgentCall, onSpawn, onTurn } from '../src/review/agent'
import { reviewerPrefix } from '../src/review/attempts'
import { cancel, endUnattended, gitTool, round, settleFinding, start, startFixes } from '../src/review/review'
import { chooseTier } from '../src/tier/tier'

const efforts = ['low', 'medium', 'high', 'xhigh', 'max']
const tiers = ['routine', 'complex', 'critical', 'escalation']
const fableUsedPercent = {
  type: 'number',
  minimum: 0,
  maximum: 100,
  description: 'The percent of the weekly Fable limit used, not remaining, from the desktop app\'s get_usage tool. Leave it out where that tool is not listed or reports no Fable window.',
}
const run = { type: 'string', description: 'The run id review_start returned.' }
const designRun = { type: 'string', description: 'The run id plan_start returned.' }
const askRun = { type: 'string', description: 'The run id ask_start returned.' }

const reviewerPrompt = [
  'You are a read-only reviewer that Confer runs. Your task prompt has the brief, the points so far, and the reply contract for this round.',
  'Read files with Read, Grep, and Glob, and run Git with the mcp__confer__git tool, passing the run id from the brief. Do not edit, build, or run anything.',
  'Reply with the one JSON object the contract asks for, and nothing else.',
].join('\n\n')

const tools = [
  {
    name: 'review_start',
    description:
      'Start a Confer review: Claude and Codex review the change independently and read-only, then rule on each other\'s findings until they agree. Returns JSON: status "round" with run, agent, tier, and models, "nothing-to-review" with report, or error.',
    inputSchema: {
      type: 'object',
      properties: {
        args: { type: 'string', description: 'The review command\'s arguments as the user typed them: tier flags, --fix, --findings with an absolute file path, and an optional branch, commit, range, or path.' },
        pick: { type: 'string', enum: tiers, description: 'The tier picked from references/tiers.md.' },
        isSure: { type: 'boolean', description: 'False to ask the user to confirm the tier.' },
        fableUsedPercent,
        pr: {
          type: 'object',
          description: 'For a PR, the output of `gh pr view N --json url,number,title,body,headRefOid,baseRefName`.',
          properties: { url: { type: 'string' }, number: { type: 'number' }, title: { type: 'string' }, body: { type: 'string' }, headRefOid: { type: 'string' }, baseRefName: { type: 'string' } },
          required: ['url', 'number', 'headRefOid', 'baseRefName'],
        },
      },
      required: ['args', 'pick', 'isSure'],
    },
  },
  {
    name: 'review_round',
    description:
      'Run Codex for the current round and apply both replies once the Claude reviewer has returned. Send it in one message with the round\'s Agent call. Returns JSON with status round, waiting, paused, probe, an ending with report, or error.',
    inputSchema: { type: 'object', properties: { run }, required: ['run'] },
  },
  {
    name: 'review_settle',
    description: 'Record the probe of a finding the reviewers disputed twice. Returns JSON: status probe while others remain, then the ending with report.',
    inputSchema: {
      type: 'object',
      properties: {
        run,
        id: { type: 'string', description: 'The finding id, such as C1 or X2.' },
        outcome: { type: 'string', enum: ['confirmed', 'refuted', 'inconclusive'] },
        evidence: { type: 'string', description: 'What the probe showed.' },
      },
      required: ['run', 'id', 'outcome', 'evidence'],
    },
  },
  {
    name: 'review_fixes',
    description: 'Start a fix review of confirmed findings, before the first edit. Returns JSON: status fixing with tier, models, and instructions, or error.',
    inputSchema: {
      type: 'object',
      properties: {
        run,
        ids: { type: 'array', items: { type: 'string' }, description: 'The confirmed findings to fix.' },
        pick: { type: 'string', enum: tiers, description: 'The tier of the fix review; the review\'s own when left out. Tier flags typed for the review still apply.' },
        fableUsedPercent,
      },
      required: ['run', 'ids'],
    },
  },
  {
    name: 'review_cancel',
    description: 'Stop a review the user wants stopped, and remove what it created. Refused while a reviewer runs.',
    inputSchema: { type: 'object', properties: { run }, required: ['run'] },
  },
  {
    name: 'ask_start',
    description:
      'Start a Confer question: Claude and Codex each answer it independently and read-only, then rule on each other\'s answers until they agree on one. Returns JSON: status "round" with run, agent, question, tier, and models, or error.',
    inputSchema: {
      type: 'object',
      properties: {
        args: { type: 'string', description: 'The ask command\'s arguments exactly as the user typed them: tier flags and --findings with an absolute file path, then the question.' },
        pick: { type: 'string', enum: tiers, description: 'The tier picked from references/tiers.md.' },
        isSure: { type: 'boolean', description: 'False to ask the user to confirm the tier.' },
        fableUsedPercent,
      },
      required: ['args', 'pick', 'isSure'],
    },
  },
  {
    name: 'ask_round',
    description:
      'Run Codex for the current ask round and apply both replies once the Claude reviewer has returned. Send it in one message with the round\'s Agent call. Returns JSON with status round, waiting, paused, an ending with report, or error.',
    inputSchema: { type: 'object', properties: { run: askRun }, required: ['run'] },
  },
  {
    name: 'ask_cancel',
    description: 'Stop a question the user wants stopped. Refused while a reviewer runs.',
    inputSchema: { type: 'object', properties: { run: askRun }, required: ['run'] },
  },
  {
    name: 'git',
    description:
      'Run one read-only Git command in the reviewed checkout: diff, show, log, blame, ls-files, ls-tree, cat-file, rev-parse, merge-base, or grep, with options from an allowlist. Returns JSON with exitCode, stdout, stderr, and truncated, or refused.',
    inputSchema: {
      type: 'object',
      properties: { run, args: { type: 'array', items: { type: 'string' }, description: 'The Git arguments, subcommand first, such as ["diff", "<base>", "<tree>"].' } },
      required: ['run', 'args'],
    },
    isDeferred: false,
  },
  {
    name: 'plan_start',
    description:
      'Start a Confer plan review: Claude and Codex critique the analysis, requirements, design, or plan in one file independently and read-only, then rule on each other\'s points as the conductor revises the file between rounds. Returns JSON: status "round" with run, agent, tier, and models, or error.',
    inputSchema: {
      type: 'object',
      properties: {
        args: { type: 'string', description: 'The plan command\'s arguments as the user typed them: tier flags and the path of the file.' },
        pick: { type: 'string', enum: tiers, description: 'The tier picked from references/tiers.md.' },
        isSure: { type: 'boolean', description: 'False to ask the user to confirm the tier.' },
        fableUsedPercent,
      },
      required: ['args', 'pick', 'isSure'],
    },
  },
  {
    name: 'plan_round',
    description:
      'Run Codex for the current plan round and apply both replies once the Claude reviewer has returned. Send it in one message with the round\'s Agent call. Returns JSON with status round, waiting, paused, revise, an ending with report, or error.',
    inputSchema: { type: 'object', properties: { run: designRun }, required: ['run'] },
  },
  {
    name: 'plan_revision',
    description: 'Record the revised file as the next version, after editing it. Returns JSON: status round with agent, or error.',
    inputSchema: {
      type: 'object',
      properties: { run: designRun, notes: { type: 'string', description: 'What changed and why, and how each agreed point was addressed or why not.' } },
      required: ['run'],
    },
  },
  {
    name: 'plan_cancel',
    description: 'Stop a plan review the user wants stopped. Refused while a reviewer runs.',
    inputSchema: { type: 'object', properties: { run: designRun }, required: ['run'] },
  },
]

async function answer(work: () => Promise<unknown>) {
  try {
    return { result: JSON.stringify(await work()) }
  } catch (error) {
    return { result: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) }
  }
}

async function registerAll($: EngineInterface) {
  for (const effort of efforts) {
    await $.agent.register({
      name: `reviewer-${effort}`,
      description: 'A read-only reviewer, dispatched only by the Confer review, plan, and ask skills.',
      prompt: reviewerPrompt,
      effort,
      tools: ['Read', 'Grep', 'Glob', 'mcp__confer__git'],
      omitClaudeMd: true,
      maxTurns: 200,
    })
  }
  for (const tool of tools) await $.tool.register(tool)
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await registerAll($)
    return started
  })

  on('tool.call', { tool: 'mcp__confer__review_start' }, ($, e) => answer(() => start($, e as never, options)))
  on('tool.call', { tool: 'mcp__confer__review_round' }, ($, e) => answer(() => round($, e as never, options)))
  on('tool.call', { tool: 'mcp__confer__review_settle' }, ($, e) => answer(() => settleFinding($, e as never)))
  on('tool.call', { tool: 'mcp__confer__review_fixes' }, ($, e) => answer(() => startFixes($, e as never, options)))
  on('tool.call', { tool: 'mcp__confer__review_cancel' }, ($, e) => answer(() => cancel($, e as never)))
  on('tool.call', { tool: 'mcp__confer__ask_start' }, ($, e) => answer(() => startAsk($, e as never, options)))
  on('tool.call', { tool: 'mcp__confer__ask_round' }, ($, e) => answer(() => askRound($, e as never, options)))
  on('tool.call', { tool: 'mcp__confer__ask_cancel' }, ($, e) => answer(() => askCancel($, e as never)))
  on('tool.call', { tool: 'mcp__confer__git' }, ($, e) => answer(() => gitTool($, e as never)))
  on('tool.call', { tool: 'mcp__confer__plan_start' }, ($, e) => answer(() => startDesign($, e as never, options)))
  on('tool.call', { tool: 'mcp__confer__plan_round' }, ($, e) => answer(() => designRound($, e as never, options)))
  on('tool.call', { tool: 'mcp__confer__plan_revision' }, ($, e) => answer(() => reviseDesign($, e as never)))
  on('tool.call', { tool: 'mcp__confer__plan_cancel' }, ($, e) => answer(() => cancelDesign($, e as never)))
  on('tool.call', { tool: 'Agent' }, ($, e, next) => onAgentCall($, e, next))
  on('agent.offer', ($, e, next) => (e.agent.startsWith(reviewerPrefix) && !isOffered(e.agent) ? { isOffered: false } : next(e)))
  on('agent.spawn', ($, e, next) => (e.subagentType.startsWith(reviewerPrefix) ? onSpawn($, e, next) : next(e)))
  on('session.end', async ($, e, next) => {
    await endUnattended($).catch(() => undefined)
    return next(e)
  })
  on('turn.complete', async ($, e, next) => {
    await onTurn($, e)
    return next(e)
  })

  // Tests reach the runner and the tier choice through these commands, which are never registered.
  on('command.run', { command: 'codex-run' }, async ($, e) => {
    try {
      return { text: JSON.stringify(await runCodex($, { ...JSON.parse(e.args), worktree: options.worktree !== false })) }
    } catch (error) {
      return { text: String(error) }
    }
  })

  on('command.run', { command: 'confer-tier' }, async ($, e) => {
    try {
      return { text: JSON.stringify(await chooseTier($, JSON.parse(e.args), options)) }
    } catch (error) {
      return { text: String(error) }
    }
  })
}
