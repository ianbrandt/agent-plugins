#!/bin/bash
# usage: run.sh first|resume <dir>
# Builds a scratch repo in <dir>, runs one headless session on it with every plugin in this
# checkout loaded and the installed @ianbrandt copies turned off, then writes the repo's state.
# E2E_PLUGINS points at another checkout's plugins, and E2E_MODEL sets the model (opus by default).
# MCP servers from the user's config are not loaded, and CLAUDE_CODE_ENTRYPOINT is cleared so
# that a run started from the desktop app is not treated as a desktop session.
set -uo pipefail
S=$(cd "$(dirname "$0")" && pwd)
P=${E2E_PLUGINS:-$(cd "$S/../plugins" && pwd)}
mkdir -p "$2"; D=$(cd "$2" && pwd)
case $1 in
  first) "$S/setup.sh" "$D" > /dev/null; cwd=$D/repo; prompt='/roadmap-skills:next-roadmap-item R1' ;;
  resume) "$S/setup.sh" "$D" resume > /dev/null; cwd=$D/repo/.claude/worktrees/r2-plum-wren
    prompt='/roadmap-skills:next-roadmap-item R2' ;;
  *) echo "usage: run.sh first|resume <dir>" >&2; exit 2 ;;
esac

dirs=(); off=()
for p in "$P"/*/; do
  dirs+=(--plugin-dir "${p%/}")
  off+=("\"$(basename "$p")@ianbrandt\":false")
done
settings="{\"enabledPlugins\":{$(IFS=,; echo "${off[*]}")}}"

(cd "$cwd" && env -u CLAUDE_CODE_ENTRYPOINT GHOSTWRITING_DIR="$D/voice" claude -p "$prompt" \
  --model "${E2E_MODEL:-opus}" "${dirs[@]}" --settings "$settings" --strict-mcp-config \
  --permission-mode acceptEdits \
  --allowedTools Bash Read Edit Write Glob Grep Skill Agent \
    mcp__roadmap-skills mcp__session-skills mcp__parallel-session-skills mcp__writing-skills \
  --output-format stream-json --verbose > "$D/session.jsonl" 2> "$D/session.err" < /dev/null)
echo "exit $?" > "$D/state.txt"

R=$D/repo
{ git -C "$R" worktree list; git -C "$R" branch -a; git -C "$R" log --oneline -5 main
  git -C "$R" status --short
  echo '--- origin'; git -C "$D/origin.git" log --oneline main
  echo '--- roadmap'; grep '^## ' "$R/ROADMAP.local.md"
  echo '--- changelog'; cat "$R/ROADMAP-CHANGELOG.local.md"
  echo '--- claims'; ls -A "$R/.claude/claims" 2>&1
  echo '--- worktrees dir'; ls -A "$R/.claude/worktrees" 2>&1
  echo '--- check'; (cd "$R" && sh check.sh; cat ./*.txt)
} >> "$D/state.txt" 2>&1
