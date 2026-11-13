#!/usr/bin/env bash
# Checks the four plugin hooks that add text through tool.call: the rules in an Agent
# subagent's task, the rules in a Workflow agent's first tool result, the re-read request after a
# Markdown Write, and the voice data beside the ghostwrite Skill's result. It also checks the rules
# of three plugins in the main loop, and counts the notices for a skipped hook of a plugin in this
# checkout, which none should get since none registers a classic hook. One headless session
# loads every plugin in this checkout with project settings only, so the installed copies are not
# loaded, and each text is then looked up in the session transcripts on disk. Under managed
# settings the cc-plugin-sec-default guard still applies.
#   e2e/fallback-probe.sh <empty dir>
# The apiKeyHelper in the user settings file, if there is one, is passed alone with --settings.
# PROBE_CLAUDE (default claude) is the binary to run, and PROBE_MODEL (default sonnet) the model.
set -uo pipefail
plugins=$(cd "$(dirname "$0")/../plugins" && pwd)
dir=${1:?usage: e2e/fallback-probe.sh <empty dir>}
mkdir -p "$dir" && cd "$dir" || exit 1
here=$(cygpath -m "$PWD" 2>/dev/null || pwd)
cfg=${CLAUDE_CONFIG_DIR:-$HOME/.claude}
cfg=$(cygpath -u "$cfg" 2>/dev/null || echo "$cfg")
claude=${PROBE_CLAUDE:-claude}
mkdir -p voice

dirs=()
for p in "$plugins"/*/; do dirs+=(--plugin-dir "$(cygpath -m "${p%/}" 2>/dev/null || echo "${p%/}")"); done
keys=()
helper=$(grep -oE '"apiKeyHelper"[[:space:]]*:[[:space:]]*"([^"\\]|\\.)*"' "$cfg/settings.json" 2>/dev/null | head -1)
if [ -n "$helper" ]; then
  echo "{ $helper }" > keys.json
  keys=(--settings "$here/keys.json")
fi

prompt="Make exactly these four tool calls, one at a time, then reply with the word done.
1. Agent, subagent_type general-purpose, prompt: Run the Bash command echo sub. Then reply done.
2. Workflow (I opt in to multi-agent orchestration), with one agent whose prompt is: Run the Bash
   command echo wf. Then reply done.
3. Write, file_path: $here/w.md, content: hello
4. Skill, skill: ghostwriting-skills:ghostwrite. Do not follow the skill's instructions."
# An empty GHOSTWRITING_DIR still gets the voice data heading, in bootstrap mode.
env -u CLAUDE_CODE_ENTRYPOINT GHOSTWRITING_DIR="$here/voice" "$claude" -p "$prompt" \
  --model "${PROBE_MODEL:-sonnet}" "${dirs[@]}" --setting-sources project ${keys[@]+"${keys[@]}"} \
  --strict-mcp-config --allowedTools=Agent,Bash,Workflow,Write,Skill --output-format stream-json \
  --verbose --debug-file "$here/debug.log" < /dev/null > stream.jsonl 2> stderr.txt
echo "exit $?"

echo "claude $("$claude" --version)"
sid=$(grep -o '"session_id":"[^"]*"' stream.jsonl | head -1 | cut -d'"' -f4)
t=$([ -n "$sid" ] && find "$cfg/projects" -name "$sid.jsonl" 2>/dev/null | head -1)
if [ -z "$t" ]; then
  echo "session transcript not found under $cfg/projects"
  t=/dev/null
fi
rules='WRITING CONVENTIONS ACTIVE'
sub='You are a subagent with no user to ask'
# has <text> <file>...: whether any of the files includes the text.
has() { local s=$1; shift; [ "$(cat "$@" 2>/dev/null | grep -cF "$s")" -gt 0 ] && echo yes || echo no; }
# rows <type> <text>: whether a row of that type in the main transcript includes the text. Hook
# context is written as an attachment row, and again as an api-request-blob row when it is sent.
rows() { [ "$(grep -F "\"type\":\"$1\"" "$t" | grep -cF "$2")" -gt 0 ] && echo yes || echo no; }
a=$(ls "${t%.jsonl}"/subagents/agent-*.jsonl 2>/dev/null)
w=$(ls "${t%.jsonl}"/subagents/workflows/*/agent-*.jsonl 2>/dev/null)
echo "cc-plugin-sec-default seated: $(has 'sec-default@builtin seated' debug.log)"
echo "main loop rules: writing-skills $(has "$rules" "$t")  session-skills $(has 'SESSION RULES ACTIVE' "$t")  orchestration-skills $(has 'ORCHESTRATION MODE ACTIVE' "$t")"
mine='ghostwriting-skills|orchestration-skills|parallel-session-skills|roadmap-skills|session-skills|writing-skills|gradle-skills'
echo "skip notices for these plugins: $(grep -E "\[($mine)\].*was skipped" debug.log 2>/dev/null | wc -l | tr -d ' ')"
echo "agent    transcripts: $(echo $a | wc -w)  rules: $(has "$rules" $a)  subagent rule: $(has "$sub" $a)"
echo "workflow transcripts: $(echo $w | wc -w)  rules: $(has "$rules" $w)  subagent rule: $(has "$sub" $w)"
nudge='You just wrote prose to a file'
# The voice data heading appears in the skill's text too, so this is a line only the hook writes.
voice='MODE=bootstrap: there is no'
echo "write re-read request as hook context: $(rows attachment "$nudge")  in an API request: $(rows api-request-blob "$nudge")"
# The voice data is added as hook context, never to the skill's prompt, a user row.
echo "skill voice data in the skill prompt: $(rows user "$voice")  as hook context: $(rows attachment "$voice")  in an API request: $(rows api-request-blob "$voice")"
echo 'Tool calls in the output stream, the agents included:'
grep -o '"type":"tool_use","id":"[^"]*","name":"[^"]*"' stream.jsonl | sed 's/.*"name":"//; s/"$//' | sort | uniq -c
echo 'Debug log lines that mention the guard:'
grep -iE 'sec-default|bypass' debug.log | cut -c1-300 | head -40
