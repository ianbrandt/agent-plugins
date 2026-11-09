#!/bin/sh
# The session's pre-push hook, run as git runs it: in a scratch repo, with the
# remote's name and URL as arguments and each ref update on stdin. Run by test.sh.
set -u
here=$(cd "$(dirname "$0")" && pwd)
script="$here/pre-push.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
unset GIT_CONFIG_PARAMETERS GIT_CONFIG_COUNT GIT_DIR GIT_WORK_TREE
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
pass=0
fail=0

repo="$tmp/repo"
records="$tmp/records dir's/visibility"
mkdir -p "${records%/*}"
git init -q -b main "$repo"
cd "$repo" || exit 1
git -c user.name=t -c user.email=t@t commit -q --allow-empty -m a
a=$(git rev-parse HEAD)
git -c user.name=t -c user.email=t@t commit -q --allow-empty -m b
b=$(git rev-parse HEAD)
git checkout -q --orphan other
git -c user.name=t -c user.email=t@t commit -q --allow-empty -m c
c=$(git rev-parse HEAD)
git checkout -q main
zero=0000000000000000000000000000000000000000
gh=https://github.com/o/r.git

reset() {
  for r in $(git remote); do git remote remove "$r"; done
  git config --remove-section session-skills 2>/dev/null
  git config --remove-section url.https://github.com/ 2>/dev/null
  rm -f "$records"
  git remote add origin "$gh"
}

# check <name> <expected exit> <remote> <url> <stdin> [text the output must have]...
check() {
  name=$1 want=$2 remote=$3 url=$4 refs=$5
  shift 5
  out=$(printf '%s\n' "$refs" | sh "$script" "$records" "$remote" "$url" 2>&1)
  got=$?
  ok=1
  [ "$got" = "$want" ] || ok=0
  for text in "$@"; do
    case $text in
      '!'*) case $out in *"${text#!}"*) ok=0 ;; esac ;;
      *) case $out in *"$text"*) ;; *) ok=0 ;; esac ;;
    esac
  done
  if [ $ok = 1 ]; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    printf 'FAIL %s: exit %s, wanted %s\n%s\n' "$name" "$got" "$want" "$out"
  fi
}

# A record as the plugin writes it, after an older one for another URL.
record() {
  printf 'private %s https://example.com/x\n%s %s %s\n' "$now" "$2" "$3" "$1" > "$records"
}
now=$(date +%s)
ff="refs/heads/main $b refs/heads/main $a"

reset
for url in /srv/bare.git ./bare ../bare file:///srv/bare.git bare.git \
  ssh://git@localhost/r.git http://127.0.0.1:8080/r.git 'http://[::1]/r.git' localhost:r.git git@localhost:r.git ssh://u@localhost:22/r; do
  check "a delete to the local URL $url is allowed" 0 x "$url" "(delete) $zero refs/heads/main $b"
done
# A drive letter is a path only under Git for Windows; elsewhere git reads it as an ssh host.
case $(uname -s) in MINGW* | MSYS* | CYGWIN*) drive=0 ;; *) drive=1 ;; esac
for url in 'C:/repos/bare' 'C:\repos\bare' g:o/r.git; do
  check "a delete to $url is read by the platform" "$drive" x "$url" "(delete) $zero refs/heads/main $b"
done
for url in 'http://127.0.0.2:9?x@localhost/r.git' 'http://127.0.0.2#@localhost/r.git'; do
  check "a host after ? or # in $url is not the host" 1 x "$url" "(delete) $zero refs/heads/main $b"
done

# Under Git for Windows the directory is printed as C:/..., which git reads the
# same from PowerShell and from Git Bash.
case $drive in 0) dir=$(pwd -W) ;; *) dir=$repo ;; esac
check 'a push to a remote of unknown visibility is refused' 1 origin "$gh" "$ff" \
  "Repo: $dir" 'Remote: origin' 'refs/heads/main:refs/heads/main' \
  "git -C $dir -c hook.sessionskills.enabled=false push origin refs/heads/main:refs/heads/main" 'holdPublicPush false' 'dry run'
check 'a new branch is not forced' 1 origin "$gh" "refs/heads/x $b refs/heads/x $zero" '!--force-with-lease'
check 'a push with nothing to update is allowed' 0 origin "$gh" ''
check 'a source with spaces is read from the end of the line' 1 origin "$gh" ":/fix the bug $b refs/heads/x $zero" \
  "':/fix the bug:refs/heads/x'" '!--force-with-lease'
check 'a token in a remote name that git rewrote is not printed' 1 'https://x:s3cret@github.com/o/r.git' "$gh" "$ff" '!s3cret'
check 'an ssh user is kept in the printed remote' 1 ssh://git@github.com/o/r.git ssh://git@github.com/o/r.git "$ff" \
  'Remote: ssh://git@github.com/o/r.git'

git config session-skills.originVisibility private
check "origin's URL with originVisibility private is allowed" 0 origin "$gh" "$ff"
check 'another URL is not origin' 1 x https://github.com/o/other.git "$ff"
git config session-skills.originVisibility PRIVATE
check 'originVisibility is read in any case' 0 origin "$gh" "$ff"
git config session-skills.originVisibility public
check 'originVisibility public is refused' 1 origin "$gh" "$ff"

reset
git remote set-url origin gh:o/r.git
git config url.https://github.com/.insteadOf gh:
git config session-skills.originVisibility private
check "origin's URL is compared after insteadOf" 0 origin "$gh" "$ff"

reset
git config session-skills.holdPublicPush false
check 'a lifted holdPublicPush allows the push' 0 origin "$gh" "$ff"
check 'a lifted holdPublicPush still refuses a delete' 1 origin "$gh" "(delete) $zero refs/heads/x $b" \
  ':refs/heads/x' "push --force-with-lease=refs/heads/x:$b origin :refs/heads/x" '!holdPublicPush false'
check 'a non-fast-forward is forced' 1 origin "$gh" "refs/heads/main $c refs/heads/main $b" \
  '+refs/heads/main:refs/heads/main' "push --force-with-lease=refs/heads/main:$b origin refs/heads/main:refs/heads/main"
check 'an unknown remote sha is forced' 1 origin "$gh" "refs/heads/main $b refs/heads/main 1111111111111111111111111111111111111111"
check 'a tag update is forced even as a fast-forward' 1 origin "$gh" "refs/tags/v1 $b refs/tags/v1 $a" '+refs/tags/v1:refs/tags/v1'
check 'a new tag is not forced' 0 origin "$gh" "refs/tags/v2 $b refs/tags/v2 $zero"
check 'every ref is reported' 1 origin "$gh" "$ff
refs/heads/x $c refs/heads/x $b" 'refs/heads/main:refs/heads/main' '+refs/heads/x:refs/heads/x'

reset
git remote add upstream https://github.com/up/r.git
git config session-skills.originVisibility private
check 'a fork is refused' 1 origin "$gh" "$ff" 'fork' 'holdFork false'
git config session-skills.holdFork false
check 'a lifted holdFork with a private origin is allowed' 0 origin "$gh" "$ff"
git config --unset session-skills.holdFork
check 'a fork may push to a local path' 0 x /srv/bare.git "$ff"

reset
record "$gh" private "$now"
check 'a private record from now is allowed' 0 origin "$gh" "$ff"
record "$gh" private $((now - 3601))
check 'a private record over an hour old is refused' 1 origin "$gh" "$ff"
record "$gh" public "$now"
check 'a public record is refused' 1 origin "$gh" "$ff"
record "$gh" unknown "$now"
check 'an unknown record is refused' 1 origin "$gh" "$ff"
printf 'private soon %s\n' "$gh" > "$records"
check 'a record that cannot be read is refused' 1 origin "$gh" "$ff"
record https://github.com/o/r.git private "$now"
check 'a token is removed before the lookup and never printed' 0 'https://x:s3cret@github.com/o/r.git' 'https://x:s3cret@github.com/o/r.git' "$ff"
rm -f "$records"
check 'a URL with a token is printed without it' 1 'https://x:s3cret@github.com/o/r.git' 'https://x:s3cret@github.com/o/r.git' "$ff" \
  'Remote: https://github.com/o/r.git' '!s3cret'
record git@github.com:o/r.git private "$now"
check 'an scp-style URL is looked up as written' 0 origin git@github.com:o/r.git "$ff"
printf 'private %s %s\npublic %s %s\n' "$now" "$gh" "$now" "$gh" > "$records"
check 'the last record for a URL is the one read' 1 origin "$gh" "$ff"

reset
printf '[session-skills]\n\tholdPublicPush = false\n' > "$tmp/lift"
check_env() {
  out=$(printf '%s\n' "$ff" | env "$@" sh "$script" "$records" origin "$gh" 2>&1)
  if [ $? = 1 ]; then pass=$((pass + 1)); else fail=$((fail + 1)); printf 'FAIL config in %s counted\n%s\n' "$1" "$out"; fi
}
check_env GIT_CONFIG="$tmp/lift"
out=$(printf '%s\n' "$ff" | GIT_CONFIG_PARAMETERS="'session-skills.holdpublicpush'='false'" GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=session-skills.originVisibility GIT_CONFIG_VALUE_0=private sh "$script" "$records" origin "$gh" 2>&1)
if [ $? = 1 ]; then pass=$((pass + 1)); else fail=$((fail + 1)); printf 'FAIL config in the environment counted\n%s\n' "$out"; fi

# Through git itself, with the entry Setup writes for a path with a space and an
# apostrophe: a script git cannot start fails the push.
bare="$tmp/bare.git"
git init -q --bare "$bare"
dir="$tmp/it's here"
mkdir -p "$dir"
cp "$script" "$dir/pre-push.sh"
shq() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }
entry="'hook.sessionskills.event'='pre-push' 'hook.sessionskills.command'=$(shq "sh $(shq "$dir/pre-push.sh") $(shq "$records")")"
if GIT_CONFIG_PARAMETERS="$entry" git -c hook.pre-push.enabled=true hook list pre-push 2>&1 | grep -qx sessionskills \
  && GIT_CONFIG_PARAMETERS="$entry" git push -q --force "$bare" "$c:refs/heads/main" 2>"$tmp/err"; then
  pass=$((pass + 1))
else
  fail=$((fail + 1))
  printf 'FAIL the hook did not run from the Setup entry\n'
  cat "$tmp/err"
fi

echo "$pass pass, $fail fail"
[ "$fail" = 0 ]
