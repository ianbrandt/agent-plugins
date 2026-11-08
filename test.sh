#!/usr/bin/env bash
# Every check that needs no model call: each plugin's `claude plugin test` suite and shell tests,
# the eval regex graders against known texts, and a version in marketplace.json that differs from
# origin/main's for each plugin changed since then. Needs `claude` and `node` on the PATH.
set -uo pipefail
cd "$(dirname "$0")"
failed=0

for hooks in plugins/*/hooks/hooks.json; do
  plugin=${hooks%/hooks/hooks.json}
  if out=$(claude plugin test "$plugin" 2>&1); then
    echo "ok    $plugin: $(printf '%s\n' "$out" | grep -E '^ *[0-9]+ pass' | tr -s ' ')"
  else
    printf '%s\n' "$out"
    echo "FAIL  $plugin"
    failed=1
  fi
done

for t in plugins/*/hooks/*.test.sh; do
  if out=$(sh "$t" 2>&1); then
    echo "ok    $t: $(printf '%s\n' "$out" | tail -1)"
  else
    printf '%s\n' "$out"
    echo "FAIL  $t"
    failed=1
  fi
done

if out=$(node --test graders.test.mjs 2>&1); then
  echo "ok    eval regex graders: $(printf '%s\n' "$out" | grep -E '^. pass ' | tr -d 'ℹ#' | tr -s ' ')"
else
  printf '%s\n' "$out"
  echo "FAIL  eval regex graders"
  failed=1
fi

# Evals, tests, README.md, and DESIGN.md are not loaded in a session that installs the plugin, so
# they need no new version.
versions() {
  node -e 'for (const p of JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).plugins) console.log(p.name, p.version)' "$1"
}
stale=0
# Git Bash rewrites an argument with a colon in it as a list of Windows paths, and
# origin/main:<path> reached git as origin\main;<path>. MSYS_NO_PATHCONV turns that off.
old=$(mktemp)
if ! why=$(MSYS_NO_PATHCONV=1 git show origin/main:.claude-plugin/marketplace.json 2>&1 > "$old"); then
  echo "skip  versions: $why"
elif base=$(versions "$old"); then
  while read -r name version; do
    MSYS_NO_PATHCONV=1 git diff --quiet origin/main -- "plugins/$name" ":(exclude)plugins/$name/evals" ":(exclude)plugins/$name/hooks/*.test.ts" ":(exclude)plugins/$name/hooks/*.test.sh" \
      ":(exclude)plugins/$name/README.md" ":(exclude)plugins/$name/DESIGN.md" && continue
    if printf '%s\n' "$base" | grep -qxF "$name $version"; then
      echo "FAIL  plugins/$name differs from origin/main and its version is still $version"
      stale=1
    fi
  done < <(versions .claude-plugin/marketplace.json)
  [ $stale = 0 ] && echo "ok    versions checked against origin/main"
else
  echo "FAIL  versions: marketplace.json on origin/main was not read"
  stale=1
fi
rm -f "$old"

exit $((failed | stale))
