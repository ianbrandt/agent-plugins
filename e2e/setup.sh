#!/bin/bash
# usage: setup.sh <dir> [resume]
# Builds <dir>/repo, a scratch repo with a bare <dir>/origin.git and a two-item local-only roadmap.
# With `resume`, also adds a worktree for R2 with half of the item committed.
set -euo pipefail
rm -rf "$1"; mkdir -p "$1/repo" "$1/voice"
D=$(cd "$1" && pwd)
cd "$D/repo"
git init -q -b main
git config user.name "E2E Tester"; git config user.email e2e@example.invalid
cat > README.md <<'R'
# scratch

A scratch project for an end-to-end test. Run `sh check.sh` to check it.
R
cat > check.sh <<'R'
#!/bin/sh
# Runs every check in this repo. Each roadmap item adds its own line.
set -e
echo ok
R
git add -A; git commit -q -m "Start the scratch project"
git init -q --bare "$D/origin.git"
git -C "$D/origin.git" fetch -q "$D/repo" main:main
git -C "$D/origin.git" symbolic-ref HEAD refs/heads/main
git remote add origin "$D/origin.git"
git fetch -q origin
git remote set-head origin main
git branch -q --set-upstream-to=origin/main main
git config session-skills.landing merge
mkdir notes.local
: > ROADMAP-CHANGELOG.local.md
cat > ROADMAP.local.md <<'R'
# Roadmap (local-only)

Local-only: excluded via `.git/info/exclude`, never committed or pushed. Forward-only: a landed item
is deleted here and its done-record is appended to `ROADMAP-CHANGELOG.local.md`.

Items have stable `Rn` IDs, in priority order. No item requires the user present. Commit messages
are one imperative sentence. The mechanical gate is `sh check.sh`.

## R1: a greeting file

Add `greeting.txt` at the repo root with the single line `hello, lap`. Add a line to `check.sh`
that fails when the file's content is anything else.

- Touches: `greeting.txt`, `check.sh`.
- Check: `sh check.sh` exits 0, and `cat greeting.txt` prints `hello, lap`.

## R2: a farewell file

Add `farewell.txt` at the repo root with the single line `goodbye, lap`, and mention the file in
one sentence in `README.md`.

- Touches: `farewell.txt`, `README.md`.
- Check: `cat farewell.txt` prints `goodbye, lap`, and `grep -c farewell README.md` prints `1`.
R
printf '%s\n' '/ROADMAP*.local.md' '/notes.local' '.claude/' >> .git/info/exclude

if [ "${2:-}" = resume ]; then
  WT=$D/repo/.claude/worktrees/r2-plum-wren
  git worktree add -q -b claude/r2-plum-wren "$WT" main
  ln -s "$D/repo/notes.local" "$WT/notes.local"
  echo 'goodbye, lap' > "$WT/farewell.txt"
  git -C "$WT" add farewell.txt; git -C "$WT" commit -q -m "Add the farewell file"
fi
