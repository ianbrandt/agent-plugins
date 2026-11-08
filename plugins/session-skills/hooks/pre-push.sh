#!/bin/sh
# session-skills' pre-push hook, added for the session through
# GIT_CONFIG_PARAMETERS (DESIGN.md, "Pre-push backstop"). git runs it as
# `sh pre-push.sh <records> <remote> <url>`, with each ref update on stdin. It
# allows a push to this machine or to a remote known to be private, and refuses
# a forced update, a fork's push, and everything else. No network call is made.
records=$1 remote=$2 url=$3
# Config given with -c or in the push's own environment does not count.
# git push ignores GIT_CONFIG, and git config would read it.
unset GIT_CONFIG_PARAMETERS GIT_CONFIG_COUNT GIT_CONFIG

# The URL with any userinfo removed, so a token is never printed or compared.
# An scp-style URL is kept as written, and so is an ssh URL, where the userinfo is
# the login.
clean() {
  case $1 in
    ssh://* | git+ssh://* | ssh+git://*) printf '%s' "$1" ;;
    *://*)
      rest=${1#*://}
      host=${rest%%/*}
      printf '%s://%s%s' "${1%%://*}" "${host##*@}" "${rest#"$host"}" ;;
    *) printf '%s' "$1" ;;
  esac
}

# Whether the URL is a path on this machine or names a loopback host. Without
# `://`, a colon before any slash makes it scp-style, unless it is a drive letter
# under Git for Windows: elsewhere git reads `C:/x` as host C.
case $(uname -s) in MINGW* | MSYS* | CYGWIN*) drive='[A-Za-z]' ;; *) drive='' ;; esac
here() {
  case $1 in
    file://*) return 0 ;;
    *://*)
      rest=${1#*://}
      host=${rest%%[/?#]*} ;;
    *:*)
      host=${1%%:*}
      case $host in */*) return 0 ;; esac
      [ -n "$drive" ] && case $host in $drive) return 0 ;; esac ;;
    *) return 0 ;;
  esac
  host=${host##*@}
  case $host in
    \[*) host=${host#\[}; host=${host%%\]*} ;;
    *) host=${host%%:*} ;;
  esac
  case $(printf '%s' "$host" | tr 'A-Z' 'a-z') in localhost | 127.0.0.1 | ::1) return 0 ;; esac
  return 1
}

# A word as the shell reads it back, quoted only where it needs to be.
q() {
  case $1 in
    '' | *[!A-Za-z0-9_./:@+=,-]*) printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")" ;;
    *) printf '%s' "$1" ;;
  esac
}

if here "$url"; then
  cat > /dev/null
  exit 0
fi

forced= report= leases= specs=
# git writes each line as `<local ref> <sha> <remote ref> <sha>`, and the local
# ref is the source as typed, which may have spaces in it.
while read -r line; do
  [ -n "$line" ] || continue
  rsha=${line##* } line=${line% *}
  rref=${line##* } line=${line% *}
  lsha=${line##* } lref=${line% *}
  how=
  case $lsha in *[!0]*) ;; *) how=delete ;; esac
  if [ -z "$how" ]; then
    case $rsha in
      *[!0]*)
        # git rejects a tag update without force, whatever its ancestry.
        case $rref in refs/tags/*) how=forced ;; esac
        [ -n "$how" ] || git merge-base --is-ancestor "$rsha" "$lsha" 2> /dev/null || how=forced ;;
    esac
  fi
  case $how in
    delete) report="$report :$rref" ;;
    forced) report="$report +$lref:$rref" ;;
    *) report="$report $lref:$rref" ;;
  esac
  [ -n "$how" ] && forced=1 && leases="$leases $(q "--force-with-lease=$rref:$rsha")"
  if [ "$how" = delete ]; then specs="$specs $(q ":$rref")"; else specs="$specs $(q "$lref:$rref")"; fi
done

# An up-to-date push runs the hook with no ref to update.
[ -n "$specs" ] || exit 0

setting() { git config --get "session-skills.$1" 2> /dev/null; }
lift=holdPublicPush
key=$(clean "$url")

if [ -n "$forced" ]; then
  why="it replaces or deletes a ref on the remote, which a reviewer may already have read"
  lift=
elif git remote get-url upstream > /dev/null 2>&1 && [ "$(setting holdFork)" != false ]; then
  why="this repo is a fork, and a fork never pushes"
  lift=holdFork
elif [ "$(setting holdPublicPush)" = false ]; then
  exit 0
else
  vis=$(setting originVisibility | tr 'A-Z' 'a-z')
  if [ "$vis" = private ] && git remote get-url --push --all origin 2> /dev/null | grep -qxF -- "$url"; then exit 0; fi
  # The last line for this URL in the session's records, written by the plugin
  # each time it looks a visibility up: `<visibility> <seconds> <url>`.
  found=
  if [ -n "$records" ] && [ -r "$records" ]; then
    while read -r v t u; do [ "$u" = "$key" ] && found="$v $t"; done < "$records"
  fi
  set -- $found
  if [ "${1:-}" = private ]; then
    case ${2:-x} in
      *[!0-9]*) ;;
      *) age=$(($(date +%s) - $2)); [ "$age" -ge 0 ] && [ "$age" -le 3600 ] && exit 0 ;;
    esac
  fi
  why="the remote is not known to be private"
fi

# git passes a URL as the remote's name where the push named no remote, before
# any insteadOf rewrite.
case $remote in *://*) remote=$(clean "$remote") ;; esac
dir=$(pwd)
{
  echo "session-skills: push refused by the session's pre-push hook: $why."
  echo "Repo: $dir"
  echo "Remote: $remote"
  echo "Ref updates:$report"
  echo "The hook cannot tell a dry run from a real push. If the refused command was a dry run, nothing was sent and nothing needs to run again."
  echo "A release task or a \`git town ship\` stopped partway may have left a local version commit, a tag, or an unpushed branch."
  if [ -n "$lift" ]; then
    echo "The user can push from their own terminal, or lift the hold for this clone with \`git config session-skills.$lift false\`."
  else
    echo "The user can push from their own terminal."
  fi
  echo "To ask the user, run: git -C $(q "$dir") -c hook.sessionskills.enabled=false push$leases $(q "$remote")$specs"
} >&2
exit 1
