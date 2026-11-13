#!/usr/bin/env bash
# Checks whether the writing-skills review prompt is read from the prompt cache on this
# machine's endpoint: first-party, Bedrock, Vertex, or a gateway. One headless session runs six
# reviews at high effort from a scratch plugin's session.start hook, with the gate prompt from
# this checkout: three with the cache mark on the system prompt, as gate.ts sends it, then three
# with the same text as the first block of the prompt. User settings are loaded, so the endpoint and any apiKeyHelper
# configured there apply.
#   e2e/cache-probe.sh <empty dir>
# Each line printed is one call's usage. A cached arm works when its second and third calls show
# cache_read_input_tokens. cache_creation_input_tokens on every call means each call pays the
# cache-write price and none reads it back.
# PROBE_CLAUDE (default claude) is the binary to run, and PROBE_MODEL (default sonnet) the model.
set -uo pipefail
hooks=$(cd "$(dirname "$0")/../plugins/writing-skills/hooks" && pwd)
hooks=$(cygpath -m "$hooks" 2>/dev/null || echo "$hooks")
dir=${1:?usage: e2e/cache-probe.sh <empty dir>}
mkdir -p "$dir/plugin/.claude-plugin" "$dir/plugin/hooks" && cd "$dir" || exit 1
here=$(cygpath -m "$PWD" 2>/dev/null || pwd)
claude=${PROBE_CLAUDE:-claude}

echo '{ "name": "cache-probe", "version": "0.0.1" }' > plugin/.claude-plugin/plugin.json
echo '{ "modules": ["./register.ts"] }' > plugin/hooks/hooks.json
cat > plugin/hooks/register.ts <<EOF
const HOOKS = '$hooks'
const OUT = '$here/usage.jsonl'
const MODEL = '${PROBE_MODEL:-sonnet}'
export const register = (on: any) => {
  on('session.start', async (\$: any, e: any, next: any) => {
    const fixed = (await \$.fs.read(\`\${HOOKS}/gate-prompt.md\`)) + (await \$.fs.read(\`\${HOOKS}/rules.md\`))
    const drafts = ['The build is green.', 'The fix is in the next release.', 'The test now covers the empty case.']
    let out = ''
    for (const arm of ['system', 'prompt']) {
      for (const draft of drafts) {
        const text = \`File: draft.md\n\n\${draft}\`
        const request = arm === 'system'
          ? { model: MODEL, system: [{ text: fixed, cache: true }], prompt: text }
          : { model: MODEL, prompt: [{ text: fixed, cache: true }, { text: \`\n\n\${text}\` }] }
        const r = await \$.model.complete({ ...request, effort: 'high', timeoutMs: 60000 })
        out += JSON.stringify({ arm, ok: r.isAnswered, usage: r.usage, reason: r.isAnswered ? undefined : r.reason }) + '\n'
      }
    }
    await \$.fs.write(OUT, out)
    return next(e)
  })
}
EOF

env -u CLAUDE_CODE_ENTRYPOINT "$claude" -p 'Reply with the word done.' --model "${PROBE_MODEL:-sonnet}" \
  --plugin-dir "$here/plugin" --strict-mcp-config < /dev/null > "$here/reply.txt" 2> "$here/stderr.txt"
echo "exit $?"
echo "claude $("$claude" --version)"
env | grep -oE '^(CLAUDE_CODE_USE_[A-Z]+|ANTHROPIC_BASE_URL)=' | sed 's/=$/ is set/'
cat "$here/usage.jsonl" 2>/dev/null || echo "no usage.jsonl: see $here/stderr.txt"
