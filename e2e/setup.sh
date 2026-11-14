#!/bin/bash
# usage: setup.sh <dir> [resume]
# Builds <dir>/repo, a scratch repo with a bare <dir>/origin.git and a two-item local-only backlog.
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
# Runs every check in this repo. One line is added here for each backlog item.
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
: > BACKLOG-CHANGELOG.local.md
cat > BACKLOG.local.md <<'R'
# Backlog (local only)

Never commit or push this file. Highest ID used: R2

## R1: A greeting file

- Touches: `greeting.txt`, `check.sh`
- Check: `sh check.sh` exits 0, and `cat greeting.txt` prints `hello, lap`

Add `greeting.txt` at the repo root with the single line `hello, lap`. Add a line to `check.sh`
that fails when the file's content is anything else.

## R2: A farewell file

- Touches: `farewell.txt`, `README.md`
- Check: `cat farewell.txt` prints `goodbye, lap`, and `grep -c farewell README.md` prints `1`

Add `farewell.txt` at the repo root with the single line `goodbye, lap`, and mention the file in
one sentence in `README.md`.
R
cat > PLAN.local.md <<'R'
# Plan (local only)

Commit messages are one imperative sentence. The build is `sh check.sh`.
R
printf '%s\n' '/BACKLOG*.local.md' '/PLAN*.local.md' '/notes.local' '.claude/' >> .git/info/exclude

if [ "${2:-}" = resume ]; then
  WT=$D/repo/.claude/worktrees/r2-plum-wren
  git worktree add -q -b claude/r2-plum-wren "$WT" main
  ln -s "$D/repo/notes.local" "$WT/notes.local"
  echo 'goodbye, lap' > "$WT/farewell.txt"
  git -C "$WT" add farewell.txt; git -C "$WT" commit -q -m "Add the farewell file"
fi
