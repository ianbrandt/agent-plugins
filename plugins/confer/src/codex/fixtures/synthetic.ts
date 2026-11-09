// Codex 0.167.0 transcripts and an MCP server listing built in the recorded format, not recorded.

import { lines } from './codex-0.167.0'

const failure = (message: string) =>
  lines(
    { type: 'thread.started', thread_id: '01a1b80d-0000-7000-8000-000000000000' },
    { type: 'turn.started' },
    { type: 'error', message },
    { type: 'turn.failed', error: { message } },
  )

export const usageLimit = failure(
  "You've hit your usage limit. Visit the usage page or try again at Oct 19th, 2026 12:06 AM.",
)

export const rateLimit = failure('exceeded retry limit, last status: 429 Too Many Requests')

export const budgetLimit = failure(
  'unexpected status 400 Bad Request: {"error":{"message":"Budget has been exceeded! Current cost: 25.0013, Max budget: 25.0","type":"budget_exceeded","param":null,"code":"400"}}',
)

export const mcpList = JSON.stringify([
  {
    name: 'docs',
    enabled: true,
    disabled_reason: null,
    transport: { type: 'stdio', command: 'docs-mcp', args: [], env: null, env_vars: [], cwd: null },
    startup_timeout_sec: null,
    tool_timeout_sec: null,
    auth_status: 'unsupported',
  },
  {
    name: 'browser',
    enabled: false,
    disabled_reason: null,
    transport: { type: 'stdio', command: 'browser-mcp', args: [], env: null, env_vars: [], cwd: null },
    startup_timeout_sec: 120.0,
    tool_timeout_sec: null,
    auth_status: 'unsupported',
  },
])
