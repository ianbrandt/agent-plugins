// `codex exec --json` output recorded from Codex 0.167.0.

export const lines = (...events: unknown[]) => events.map(event => JSON.stringify(event) + '\n').join('')

export const completed = lines(
  { type: 'thread.started', thread_id: '01a1b80c-01e1-7c60-811e-b52b8eb2bb62' },
  { type: 'turn.started' },
  { type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: 'I’ll run `git status --short` once.' } },
  {
    type: 'item.started',
    item: { id: 'item_1', type: 'command_execution', command: "/bin/zsh -lc 'git status --short'", aggregated_output: '', exit_code: null, status: 'in_progress' },
  },
  {
    type: 'item.completed',
    item: {
      id: 'item_1',
      type: 'command_execution',
      command: "/bin/zsh -lc 'git status --short'",
      aggregated_output: ' D delete.txt\nMM existing.txt\n?? new.txt\n',
      exit_code: 0,
      status: 'completed',
    },
  },
  { type: 'item.completed', item: { id: 'item_2', type: 'agent_message', text: '{"ok":true}' } },
  {
    type: 'turn.completed',
    usage: { input_tokens: 24427, cached_input_tokens: 17536, cache_write_input_tokens: 0, output_tokens: 63, reasoning_output_tokens: 0 },
  },
)

export const unknownModel = lines(
  { type: 'thread.started', thread_id: '01a1b80d-1f05-7fd2-8973-d1dc40670f79' },
  {
    type: 'item.completed',
    item: {
      id: 'item_0',
      type: 'error',
      message: 'Configured service tier `priority` is not advertised as supported for model `confer-no-such-model` and will be omitted from requests.',
    },
  },
  {
    type: 'item.completed',
    item: {
      id: 'item_1',
      type: 'error',
      message: 'Model metadata for `confer-no-such-model` not found. Defaulting to fallback metadata; this can degrade performance and cause issues.',
    },
  },
  { type: 'turn.started' },
  { type: 'error', message: "The 'confer-no-such-model' model is not supported when using Codex with a ChatGPT account." },
  { type: 'turn.failed', error: { message: "The 'confer-no-such-model' model is not supported when using Codex with a ChatGPT account." } },
)
