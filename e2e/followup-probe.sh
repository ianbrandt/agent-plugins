#!/usr/bin/env bash
# Checks that the two follow-ups run with no plugin prompt: a flagged draft is replaced with a call to
# the lint tool in the same turn, and a push gets the request for the next step in its own result.
# One headless session loads writing-skills and session-skills from this checkout, with project
# settings only, so the installed copies are not loaded, in a scratch repo with a bare origin. Under
# managed settings the cc-plugin-sec-default guard still applies.
#   e2e/followup-probe.sh <empty dir>
# The apiKeyHelper in the user settings file, if there is one, is passed alone with --settings.
# PROBE_CLAUDE (default claude) is the binary to run, and PROBE_MODEL (default sonnet) the model.
set -uo pipefail
plugins=$(cd "$(dirname "$0")/../plugins" && pwd)
plugins=$(cygpath -m "$plugins" 2>/dev/null || echo "$plugins")
dir=${1:?usage: e2e/followup-probe.sh <empty dir>}
mkdir -p "$dir" && cd "$dir" || exit 1
here=$(cygpath -m "$PWD" 2>/dev/null || pwd)
cfg=${CLAUDE_CONFIG_DIR:-$HOME/.claude}
cfg=$(cygpath -u "$cfg" 2>/dev/null || echo "$cfg")
claude=${PROBE_CLAUDE:-claude}
keys=()
helper=$(grep -oE '"apiKeyHelper"[[:space:]]*:[[:space:]]*"([^"\\]|\\.)*"' "$cfg/settings.json" 2>/dev/null | head -1)
if [ -n "$helper" ]; then
  echo "{ $helper }" > keys.json
  keys=(--settings "$here/keys.json")
fi
git init -q --bare origin.git
git clone -q origin.git repo 2>/dev/null
cd repo || exit 1
git -c user.name=probe -c user.email=probe@example.com commit -q --allow-empty -m init
git push -q origin HEAD 2>/dev/null

prompt='Do these two things, in order.
1. Run this Bash command: git -c user.name=probe -c user.email=probe@example.com commit -q --allow-empty -m next && git push -q origin HEAD
2. Then reply with one sentence of introduction, a two-sentence PR comment for publication in a draft block, and one closing sentence. The comment explains that the report says the build owns the cache, and that the plugin decides which version wins. Do not call the lint tool first.'
env -u CLAUDE_CODE_ENTRYPOINT "$claude" -p "$prompt" --model "${PROBE_MODEL:-sonnet}" \
  --plugin-dir "$plugins/writing-skills" --plugin-dir "$plugins/session-skills" \
  --setting-sources project ${keys[@]+"${keys[@]}"} --strict-mcp-config --allowedTools=Bash \
  --output-format stream-json --verbose --debug-file "$here/debug.log" < /dev/null > "$here/stream.jsonl" 2> "$here/stderr.txt"
echo "exit $?"
echo "claude $("$claude" --version)"
cd "$here" || exit 1
sid=$(grep -o '"session_id":"[^"]*"' stream.jsonl | head -1 | cut -d'"' -f4)
t=$([ -n "$sid" ] && find "$cfg/projects" -name "$sid.jsonl" 2>/dev/null | head -1)
if [ -z "$t" ]; then
  echo "session transcript not found under $cfg/projects"
  t=/dev/null
fi
count() { grep -cF "$1" "$t" | tr -d ' '; }
echo "plugin prompts in the transcript (want 0): $(count 'plugin sent a message')"
echo "lint calls the hook made (1 or 2 when the draft was flagged, 0 when it was clean): $(grep -c '"id":"toolu_writing_skills_' "$t" | tr -d ' ')"
echo "next-step request on the push result (want at least 1): $(count 'This command pushed work')"
echo 'Final reply:'
grep '"type":"result"' stream.jsonl | sed 's/.*"result":"//; s/","stop_reason.*//' | cut -c1-600
echo 'Debug log lines that mention the guard:'
grep -iE 'sec-default|bypass' debug.log | cut -c1-300 | head -20
