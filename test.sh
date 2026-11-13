#!/usr/bin/env bash
# Every check that needs no model call: each plugin's `claude plugin test` suite,
# the eval regex graders against known texts, the tier settings shared by Confer and
# orchestration-skills, `claude plugin validate` on each plugin, Confer's
# typecheck, and each marketplace.json entry's tag, commit, description, and keywords.
# Needs `claude` and `node` on the PATH.
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

if out=$(node --test graders.test.mjs 2>&1); then
  echo "ok    eval regex graders: $(printf '%s\n' "$out" | grep -E '^. pass ' | tr -d 'ℹ#' | tr -s ' ')"
else
  printf '%s\n' "$out"
  echo "FAIL  eval regex graders"
  failed=1
fi

if out=$(node --test tiers.test.mjs 2>&1); then
  echo "ok    tier settings shared by Confer and orchestration-skills"
else
  printf '%s\n' "$out"
  echo "FAIL  tier settings shared by Confer and orchestration-skills"
  failed=1
fi

invalid=0
for plugin in plugins/*/; do
  if ! out=$(claude plugin validate "$plugin" 2>&1); then
    printf '%s\n' "$out"
    echo "FAIL  claude plugin validate $plugin"
    invalid=1
  fi
done
[ $invalid = 0 ] && echo "ok    claude plugin validate on each plugin" || failed=1

# Confer's TypeScript compiler is a dev dependency.
if out=$(cd plugins/confer && npm ci --silent && npm run -s typecheck 2>&1); then
  echo "ok    plugins/confer: typecheck"
else
  printf '%s\n' "$out"
  echo "FAIL  plugins/confer: typecheck"
  failed=1
fi

# Each entry is pinned to the commit tagged <name>-v<version>, and that commit has the plugin in it.
# Git Bash rewrites an argument with a colon in it as a list of Windows paths, and
# <sha>:<path> reached git as <sha>;<path>. MSYS_NO_PATHCONV turns that off.
pins() {
  node -e 'for (const p of JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).plugins) console.log(p.name, p.version, p.source.ref, p.source.sha, p.source.path)' "$1"
}
stale=0
while read -r name version ref sha path; do
  if [ "$ref" != "$name-v$version" ] || [ "$path" != "plugins/$name" ]; then
    echo "FAIL  $name $version is pinned to $ref at $path, not $name-v$version at plugins/$name"
    stale=1
  elif [ "$(git rev-parse -q --verify "refs/tags/$ref^{commit}")" != "$sha" ]; then
    echo "FAIL  $name: tag $ref is not at the pinned commit $sha"
    stale=1
  elif ! MSYS_NO_PATHCONV=1 git cat-file -e "$sha:plugins/$name/.claude-plugin/plugin.json" 2>/dev/null; then
    echo "FAIL  $name: commit $sha has no plugins/$name"
    stale=1
  fi
done < <(pins .claude-plugin/marketplace.json)
[ $stale = 0 ] && echo "ok    marketplace pins match their tags"

# Each entry's description and keywords match the plugin.json at its pinned commit.
drift=0
if out=$(node -e '
  const { execFileSync } = require("child_process")
  let ok = true
  for (const p of JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).plugins) {
    let j
    try { j = JSON.parse(execFileSync("git", ["show", `${p.source.sha}:${p.source.path}/.claude-plugin/plugin.json`], { stdio: ["ignore", "pipe", "ignore"] })) } catch { continue }
    for (const k of ["description", "keywords"])
      if (JSON.stringify(j[k]) !== JSON.stringify(p[k])) { console.log(`FAIL  ${p.name}: ${k} does not match plugin.json at ${p.source.ref}`); ok = false }
  }
  process.exit(ok ? 0 : 1)' .claude-plugin/marketplace.json); then
  echo "ok    marketplace descriptions and keywords match plugin.json"
else
  printf '%s\n' "$out"
  drift=1
fi

exit $((failed | stale | drift))
