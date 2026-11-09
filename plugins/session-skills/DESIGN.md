# session-skills design

How the plugin is wired, for anyone changing it. The [README](README.md) covers using it.

## Tools and session rules

One hooks module, `hooks/register.ts`, which is a Claude Code mod and needs Claude Code 2.1.314 or
later, the oldest build checked for `tool.check`. It registers six tools, named
`mcp__session-skills__<tool>`, and the skills call them where they once had bash to adapt:

- `find_checkouts` fetches, then returns the primary checkout, the default branch, the ref a new
  branch should start from, and every worktree (`work-in-worktree` §1 and §2).
- `open_worktree` opens a worktree and branch from that ref and links the repo's local notes
  directory into it (§3).
- `prune_branches` prunes stale worktree registrations and deletes merged branches, including one a
  host squashed on merge, and never removes a worktree (§4).
- `remove_worktree` runs `git worktree remove` from the primary checkout, then deletes the
  worktree's directory where it is still on disk, as it is on Windows. A path outside
  `.claude/worktrees` is refused, and a path already unregistered is a no-op (§4, and
  `land-and-wrap` §2).
- `landing_facts` returns whether the repo is a fork, `origin`'s visibility, the landing mode, and
  the holds the user lifted (`land-and-wrap` §1).
- `edit_primary_file` edits a file that is only in the primary checkout, such as an untracked
  roadmap: one passage is replaced, or text is appended, and nothing is written when the passage
  has drifted.

In the terminal, `set_session_title` keeps the title, and a `turn.complete` hook applies it with
`$.command.run({ command: 'rename' })`. The call is refused from a `tool.call` hook, since `/rename`
waits for the session to be idle and that hook holds the turn. The command shows as one line in the
transcript, and the next turn gets a reminder that the user named the session. No event under
`cc-plugin-sec-default` is involved. A `claude -p` session and any other entry point have no such
tool, and the model prints a `/rename` block instead.

`hooks/checkouts.test.ts` and `hooks/register.test.ts` run under `claude plugin test`. The
tool definitions are in every session's context, at roughly 600 tokens by estimate for the six.

The module adds `hooks/rules.md` to the first prompt of every session, and again to a prompt or
a tool result once the model no longer reads it: after `/clear`, a compaction, or a plugin update
that changed the text. A fork starts with its parent's context, where the rules already are. That file has three rules that cannot go in a skill. One is the session title, given
once the subject of the session is known and again when a better one fits. How the title is set
differs by surface, so `{{title}}` in `rules.md` is replaced with one of two files, chosen by
`CLAUDE_CODE_ENTRYPOINT`: `title-desktop.md` for the desktop app's tool, and `title-print.md`
anywhere else, for a `/rename` command the user pastes. A session given several instructions at
once called another surface's tool in the desktop app and printed the title when the call failed. Another runs every turn:
weigh continuing this session against handing off to a fresh one without writing the weighing out,
and end a turn that closed a unit with the outcome: a hand-off block, a line that this session goes
on, or a line on what the next item waits on. The third applies whenever something out of scope turns up: raise it in the reply, write it
into the repo's backlog where it should outlive the session, and never leave it in a host's
suggested-task feature on its own. All three apply to every session that did real work, including
the ones that never open a worktree and so never load `land-and-wrap`. That is why they are injected
by a hook, and why they ship with the plugin instead of sitting in a personal global `CLAUDE.md`.

`{{wrap-up}}` in `rules.md` is replaced with `wrap-up-desktop.md` in the desktop app and removed
elsewhere. In that app a session calls the `wrap_up` tool at the end of a turn that ran a command.
Text after a call with an `ask` is never shown, and a call without one returns "nothing is pending",
which one session took as a reason to skip the hand-off block after a unit landed. Text written
before any tool call is folded into that call's activity, and another session wrote the block before
two more calls and closed with a pointer to it, so the block now goes after the last call.

The turn that runs `git push` is the last turn of a landing. In a census of October 2026 transcripts
from the four owned repos, 13 of the 16 turns that pushed held work ended with no next step, often
after a landing turn that had asked for the push and deferred the hand-off to it. A `tool.call` hook
adds the request for the next step to the result of a push, but not of a dry run or a call for help,
for a call on the main loop that was not denied and did not fail. A command that a settings hook rewrote into a push is not seen. In four
runs of each arm on Sonnet 5.5, the first reply stated a next step 4 of 4 times with the request and
0 of 4 without it. Opus 5.5 stated one 2 of 2 times either way.

The holds in `land-and-wrap` are read from the skill text, so a session that pushes without the
skill pushes anyway: on 2026-11-06 a session pushed a cleared TODO to this public repo. A
`tool.check` hook on `Bash` and `PowerShell` reads the holds for the repo each push in a command
runs in, and puts a held push to the user in the permission prompt with the `git config` line that
lifts the hold. The same hook reads the command given to `Monitor`, which runs where the Bash
tool does, and to two tools that run one in a terminal. `mcp__terminal__run_in_terminal` is read
in its `cwd`, or in an unknown directory when it reuses a tab or `cwd` starts with `~`.
`mcp__idea__execute_terminal_command` runs in the IDE's project with the IDE's shell, so its
directory is unknown and the command is read as both bash and PowerShell. `git send-pack`, `git http-push`, `git subtree push`, and `git lfs push` are pushes
too, and so is `git-push` run directly. A push in a command left to run later is read in a directory
that cannot be read: the command given to `git submodule foreach`, `git bisect run`, `git rebase -x`,
`git difftool -x`, or `git for-each-repo`, a `trap` action, and a function body, since a function
runs where it is called. That includes zsh's definitions with a quoted name or several names, as
in `'f'() { ... }` and `f g () { ... }`, and a PowerShell parameter's default value. A body that is
not in braces or parentheses, as zsh allows in `f() git push`, is not read, and the hold asks. So is
a function whose name is expanded, as in `$n() { ... }`, one set in zsh's `functions` array, and one
set, copied, or renamed through PowerShell's `function:` or `alias:` drive, or aliased with
`Set-Alias`. So is a function that runs with no call, as zsh's `TRAPZERR() { ... }`, `chpwd`, and
`command_not_found_handler` do, or a `trap` on `DEBUG`, `ERR`, `RETURN`, `ZERR`, or `CHLD` whose action runs
more than commands such as `echo` and `rm`. A subcommand git does not build in
is read as an alias from `git config` in the push's directory, as `alias.<name>` and git 2.54's
`alias.<name>.command`, and its expansion is checked in its place with the `-c` values given with
it, for gh and glab writes as well as pushes. Where `GH_REPO` or `GITLAB_REPO` is set in the
command, a PR in each expansion is held as one aimed at another repo. An alias that cannot be read
is held as a host write too. An alias is not read where the command sets config in the environment, as with
`GIT_CONFIG_COUNT` or `HOME`, or includes a file with `-c include.path`, so it is held as one that
cannot be read. A name such as `pr:m` is read only as `alias.<name>.command`, since git refuses it
as a key otherwise, and `gui`, `citool`, `instaweb`, and `send-email` are read as
aliases, since git runs an alias of that name where the program is not installed. A subcommand
with no alias is held as an alias that cannot be read where `help.autocorrect`, given with `-c` or
in config, is set to a value with which git may run it as the command it is closest to, such as
`1` or `immediate`, since `git pussh --force` then force-pushes. A push run
through `xargs` is held as one whose remote cannot be read, since xargs adds its input to the
push's arguments. A force push (a unique prefix of `--force`, `--force-with-lease`, `--mirror`, `--delete`, or
`--prune`, `-f` or `-d` in a short-flag group, a refspec that starts with `+` or deletes with a
leading `:`, a `+` refspec or a mirror set with `-c` or in the remote's config, or any config set in
the environment) is held whatever the holds, because it replaces commits a reviewer may have read,
and so is a push with `--no-verify`, which skips every pre-push hook. Neither is held for a push to
this machine. A force push after a rebase is written with the bypass described in "Pre-push
backstop", and is then asked about. A push that may recurse into submodules, by
`--recurse-submodules=on-demand` or `only`, `push.recurseSubmodules`, or `submodule.recurse`, is
held too where the index has a gitlink, since the submodules' remotes are not checked. The hook
reads the index before the command runs, so the push is held as well where a command that may run
before it may stage one: `git add -A` with a nested repo in the tree, a `git commit` with `-a`, `-p`,
or a pathspec where a nested repo replaced a tracked file, or any command not on the known-safe list
below. A `git commit` with none of those stages no nested repo, unless a pre-commit hook stages
one, which is not read. The gitlink
is checked rather than `.gitmodules`, because git also pushes a nested repo that has no entry there.
A recursion or mirror setting is read from its last value, as git reads it, so a push is not held
for a global `true` that a local `false` overrides. Where both recursion keys are set, git uses the
one set last, in config or with `-c`, whichever key it is. A mirror set with `-c` to a value git
reads as false does not force the push, but a mirror set in config is still read in that case, and
the push is held. A held push is refused with the command to run instead, and that command is asked
about ("Pre-push backstop"). A hook's ask reaches a person in every
permission mode, and where nobody can be asked, as under `claude -p`, the push is refused. Every
push but a dry run or a call for help, `git --help push` included, is checked, a subagent's included. The hook asks when it cannot
read a command at all: the engine skips a hook that throws, and the command would run unasked.

A command is read by one lexer, in `hooks/checkouts.ts`, with the rules of the shell that runs it.
It resolves quotes, a backslash or a PowerShell backtick before one character, bash's `$'...'` escapes, comments,
line continuations, redirections, `$((...))` and `$[...]` arithmetic, and quoted and unquoted
heredocs and PowerShell here-strings, and reads each `$(...)`, backtick, `<(...)`, bash 5.3
`${ ...; }`, subshell, and script block as commands of its own. git is read in any word of a simple
command, so `sudo -u x git push` is read, and so are `man git-push`, a URL that ends in `/git-push`,
and a path that ends in `/git`, which are asked about as pushes. The arguments of a git subcommand
or alias are not read, so `git grep -e git -e push` is no push. They are read only after a git that
follows an option, whose value it may be, as in `sudo -u git -g staff git push`. A substitution is read as git only
where it looks git up, as `$(which git)` does. Regexes were used before,
one pass at a time, and a review with live probes found commands they misread, among them a
backtick span in a quoted commit message read as a command, a `# --dry-run` comment read as a dry
run, and a quote in one command paired with a quote in the next. An adversarial pass on the lexer
found more, among them a heredoc closed as `EOF)` and `<<` in arithmetic read as a heredoc, and
each has a regression test. A second review with live probes found 25 commands that got past the
gate or were asked about as pushes, among them `git config -- session-skills.holdPublicPush false`,
`git $'\x70ush'`, and `git diff "$(git merge-base main HEAD)"`, and each has a regression test too.
Work on one command is capped, counting each rescan of arithmetic and each directory copied onto a
`pushd` stack, so a crafted nest of heredocs or a long run of `pushd` is asked about in milliseconds
rather than read for a minute.

The repo a push runs in is its `--git-dir` or an exported `GIT_DIR`, else its directory after an
`env -C`, each `-C`, and every `cd`, `pushd`, and `popd` before it. An `env -i` or `env -u GIT_DIR`
clears a `GIT_DIR` set before it, and a `--work-tree` does not change the repo. A `cd` after `&&` from the start of its list has run by the time the push runs, but one
after `||`, inside an `if` or a loop, or after a command that may have failed may not have, and
where the push may run in more than one directory the hold asks. It asks too after `popd` or `cd -`,
and after a call to a function the command defines, including one after `eval` or zsh's `noglob`,
`-`, or `repeat N`. A push or host write in the call itself, as in `wrap git push`, is asked about
too. Once the command defines a function, the hold asks after any command whose name is not written
out or is brace-expanded, other than git, gh, or glab looked up on the PATH, and after PowerShell's
`Invoke-Command`. It asks after a body in braces after a command's first word, as in
zsh's `() { ... }` or `repeat 1 { ... }`, an `eval` of words the shell splits or expands again, as in
`eval 'cd /x'` or `eval "$cmd"`, PowerShell's `Invoke-Expression`, a `GIT_DIR` set without `export` or with a relative path,
a path that starts with `~` or `$HOME`, a path with a variable in it after a `cd`, a path with `..` in
it, and a git subcommand that is not written out, such as `git $sub`. bash folds a `..` into the path
as written and git into the path on disk, and the two differ after a link, as a worktree's
`notes.local` is. A branch that ends in `exit` reaches nothing after it, so
`cd /x || exit 1; git push` is read in `/x`, unless the command defines a function named `exit`.
A `return` outside a function fails in bash, which runs on, so it is read as running on. The Bash tool runs bash or zsh, which differ on three
points: zsh runs the last command of a pipeline in the current shell, it sends only the last
pipeline of a list to the background, and it runs the command after `noglob`, `nocorrect`, `-`, or `repeat N`, where
bash fails. Where the two readings differ, the hold asks. A PowerShell
pipeline or subexpression, or the command after `$x =`, runs in the current runspace and can move
the location. A variable path
in the session's own directory, as in `cd "$WT"`, is read as the session's repo.

A push with no directory runs in the Bash tool's working directory, which a `cd` in an earlier call
moves, and a relative path is read against it. In a linked worktree the session's repo is the
primary checkout, but the branch checked out is the worktree's. The visibility is read for the remote
the push goes to: the one given in the command, else the one git picks from the branch's
`pushRemote`, `remote.pushDefault`, and the branch's remote, in that order, with origin last, and a
read of that config that fails holds the push. origin,
or a remote with the same push URLs, takes the visibility set in git config, and any other remote is
looked up with gh or glab by each of its push URLs, except a path on this machine, which is private.
The hold asks for a push to a URL that is not a remote, but not for one to a path on this machine.
It asks for a push whose remote is not written out or is changed for that push with `-c`,
`--config-env`, or a `GIT_CONFIG`, `HOME`, `XDG_CONFIG_HOME`, or `GIT_COMMON_DIR` variable set in
the command, as an assignment before a command's first word, with `env`, `export`, or `sudo`, after
a wrapper such as `timeout 60s` too, or in PowerShell with `$env:`, with `Set-Item`, `New-Item`, or
`Set-Content` on an `Env:` path, or with `[Environment]::SetEnvironmentVariable`. A variable in an
argument, as in `git commit -m 'HOME=/tmp'`, is not set. When a push's
remote is not written out, it is read as a force push if any remote has a mirror or a `+` refspec in
config. A push to a remote group set with `remotes.<name>` is read the same way, since git pushes to
each member and prefers a group to a remote of the same name. A `send-pack` or `http-push` takes a URL or a path, so its
remote is not read. `git push .` updates this repo and is not held.

A push with no remote is read against the branch config as it is when the hook runs, so it is asked
about where a command before it in the line is not known to leave the branch, its config, and the
directory as they were. A command listed after the push counts too where the line has an unquoted
heredoc body, a function, a loop, a background job, a PowerShell script block, or a compound
command in a pipeline, since each can run it first. A command in the same pipeline as the push
counts as well, but bash, zsh, and PowerShell finish a pipeline before the next command, so
`git push 2>&1 | tail -3 && git switch main` goes unasked. So does `git push && gh pr checks --watch`,
and `git push | tee push.log`, since `tee` is on the known-safe list. The known-safe commands are a few git commands (`add`, `commit`,
`status`, `diff`, `log`, `show`, `fetch`, `pull`, `merge`, `rebase`, `cherry-pick`, `revert`, `rm`, `mv`,
`tag`, `stash` other than `stash branch`, and some reads such as `rev-parse`, `remote -v`, and
`branch --show-current`), a push with no remote, refspec, `-u`, `--repo`, or `--receive-pack`, a `cd`
or `pushd` to a literal path with no `..`, reads such as `echo`, `cat`, `tee`, `[[`, `exit`, and
`Select-Object`, a gh or glab read such as `gh pr view` or `glab mr view`, a command that only sets
variables, `set` with `-e`, `-u`, `-x`, or `-o pipefail`, a PowerShell `if` and a condition such as
`$LASTEXITCODE -eq 0`, a test runner such as `npm test`, `npm run build`, or
`claude plugin test`, a Gradle run of only `clean`, `test`, `check`, or `build`, a Maven run of
only lifecycle phases up to `verify`, and any of these after `timeout`. A Maven goal such as
`gitflow:feature-start` can switch the branch, so the push after one is asked about. Each git form was run with git 2.56.0 and
left the branch, its config, and the directory as they were, except that under
`push.autoSetupRemote` a first push sets its branch's upstream to the remote it pushed to, which is
the remote a later push reads. gh and glab run a built-in command before an alias of the same
name. A `cd` to a path held in a variable, as in `cd "$WT" && git push`, is read as the session's
repo, so the hold reads that repo's config, and the pre-push hook checks the push where it runs. A git command on that list still makes the remote unread where it checks out
a branch, as a `git rebase` given a branch with or without `--root` does, or one that continues,
skips, or aborts, since HEAD is detached while the hook reads config and is back on the branch when
the push runs. So does a `fetch` or `pull` with `--set-upstream`, and a `git rebase -x`
that runs a command. Each of those options is read by any unique prefix, as git reads it. The push is asked about after any other command, such as
`gh pr checkout`, a git alias, a variable set before git, or `npm install`. After the same commands,
a push to a remote that is written out is read as one whose remote is not written out where config
has an `includeIf.onbranch` key, since a remote's URL can be set for one branch in a file included
under that key. git 2.56.0 sent `git switch release && git push origin release` to the push URL
set for `release` in such a file. A list of commands that
move the branch was tried first, and each review found commands missing from it, the last of them
`gh pr checkout`. An
adversarial pass found 18 commands that got past these checks, among them a PR body that starts with
`- H` read as `--head`, `git branch -u pub/main && git push`, and an abbreviated `git config --fil`,
and each has a regression test.

The hold reads git config before the command runs, so a write that changes where a later push goes
is put to the user too: a `git config` write to a key under `remote`, `remotes`, `url`, `branch`, `include`,
`includeIf`, `alias`, or `hook`, to `push.recurseSubmodules` or `submodule.recurse`, a removed or renamed
`push` or `submodule` section, `git remote add`, `rename`, `remove`, `rm`, or `set-url`, and `git submodule
set-url` or `sync`. So is a write to a `session-skills` key, since setting `holdPublicPush` or
`originVisibility` would lift a hold without the user, and `gh alias set` or `import`, since a gh
alias can run a push or a host write that the hook does not read. A `git config` command is read as
git reads it: the form before git 2.46 reads no option after the key, so
`git config session-skills.holdPublicPush false --get` writes the key. An edit to the config file with a file tool, `sed`, or a redirection such as `echo ... >> .git/config` is not seen.

The same hook puts every write to the host through `gh` or `glab` to the user, such as a comment, a
merge, a release, or a workflow run. Every subcommand is taken as a write except a short list of
reads (`view`, `list`, `diff`, `checks`, and the like), nouns that act on this machine only (`auth`,
`config`, `extension`), `clone` for a repo or a gist, and a call for help that does not follow an
option, whose value it may be. A list of writes was tried first, and an adversarial pass found 101 of
120 probes it missed, among them `gh pr new`, `glab mr new`, and a verb new in a recent release. An
`api` call is read by its method instead: with a field and no method it is a POST, as both CLIs send
it, and a GraphQL call is a write unless its `query` field is written out and starts with `query` or
`{`. The command is read by the same lexer as a push, with gh and glab found as `=gh` or a path
lookup such as `$(which gh)`. An option before the verb other than `-R` may take the verb as its
value, as cobra reads it, so the command is held. A PR is held as a push unless its last `--head`
is given a branch that is written out in the command.

These asks hold whatever `origin`'s visibility, since a comment or a merge cannot be pulled back the
way a private push can. The one exception is a `gh pr create` or `glab mr create` with `holdPrText`
lifted, in a clone whose only remote is origin. Both CLIs take the repo from `GH_REPO` or
`GITLAB_REPO` first, then from a default set with `gh repo set-default`, and then prefer a remote
named `upstream`, `github`, or `gitlab` to origin, so a PR is asked about where any of those may
apply, as in every fork. A PR aimed at another repo with `-R` is asked about too, and so is one
whose directory cannot be read. gh pushes the branch unless `--head` is given, and glab unless
`--push=false` is, so a PR that may push is also held as a push to origin, with the force and
submodule config that push reads. The PR is held when the default repo set with `gh repo set-default`
cannot be read. A `GH_REPO` set in a
shell profile is not seen, since the hook reads Claude Code's own environment. Each write in a
chained command is checked, so a comment added after a PR opened unasked is still asked about. A push or write run through `bash -c`, `eval`,
`Invoke-Expression`, `Start-Process`, a `git-<name>` program on the PATH such as git-town, a user's own `gh alias`, or
brace expansion is not seen, and neither is a force option held
in a variable, as in `git push $FORCE`. A PowerShell command with `--%` in it is asked about, since
the rest of its line is passed on unread.

The gate is built for commands a session might plausibly write while landing a branch, opening a PR,
or fixing a remote. It does not guard against a command written to get past the lexer. A third
review found 26 commands that got past it, most of them sibling forms of fixes from the second review, and
only those a session might write were fixed. These forms are not seen:

- a NUL in `$'...'`, bash's `$"..."`, an unquoted glob in a command word, and PowerShell's
  `` `u{...} `` escape
- an option value of `git` or `gh` before the real command, as in `env -u git git push`
- a git 2.54 subsection alias that differs from another only in letter case
- a hook key split by quotes, as in `hook.session''skills.command`
- a push in a directory held in a variable, as in `git -C "$OTHER" push`, read against the
  session's repo, though the pre-push hook checks it where it runs
- `NAME+=value`, a `GIT_DIR` cleared by a second `env`, and bash 5.3's `${ cd /x; }` in an
  assignment
- a command git or the shell runs from a value: `--receive-pack`, `--upload-pack`, an editor such
  as `GIT_EDITOR` or `core.editor`, a filter-branch filter, and `builtin trap`
- a `pushInsteadOf` that rewrites a relative path, and a push refspec in config that deletes
- an upstream set with an attached value, as in `git branch -upub/main`
- PowerShell's `$null=Set-Location` with no spaces, a module-qualified `Set-Location`, `Set-Item
  env:`, and `& (Get-Command git)`
- `"${GIT:-git}"`, and a shell alias that runs a relative path, which git runs
  from the repo's top level
- `-c` aliases nested so that each runs several more, which can take minutes to read, since each
  level is read with a work cap of its own

A follow-up prompt after the reply used to do this. It showed in the transcript as a message from the
plugin, it took a fenced block as the only sign of a next step, so it fired after "This session
carries on with R104", and it cost a turn.

No hook adds the rules to a subagent, because a subagent doesn't end a session.

## Pre-push backstop

The lexer cannot see a push run inside another program: `bash -c 'git push'`, `npm run release`,
`./gradlew release`, `git town ship`, or a script. So the module also adds a git `pre-push` hook,
`hooks/pre-push.sh`, to every git the session starts. On `session.start` and each `prompt.submit` it
sets `GIT_CONFIG_PARAMETERS` with `$.env.set` to its current value plus
`hook.sessionskills.event=pre-push` and `hook.sessionskills.command=sh <script> <records>`. Any
earlier `hook.sessionskills.*` entry, such as a parent session's in a nested `claude -p`, is
removed, and so is an inherited `hook.pre-push.enabled`, which would turn every pre-push hook off.
Every other entry is kept. It is set at session start for a `!` command typed before the first
prompt, and on each prompt so that a plugin update that moves the script is picked up. Both paths
are quoted for the shell and for `GIT_CONFIG_PARAMETERS`, and a Windows path is written with `/`,
which Git for Windows' `sh` reads. `GIT_CONFIG_PARAMETERS` survives a command's own
`GIT_CONFIG_COUNT` and `git -c`, and a config-based hook runs beside the repo's own hooks,
`core.hooksPath` included.

The script reads config from the repo, global, and system files only, so a `-c`, a
`GIT_CONFIG_PARAMETERS`, or a `GIT_CONFIG` on the push does not count, and makes no network call. A
push with no ref to update is allowed. Otherwise, in this order:

1. A URL that is a path on this machine, or names `localhost`, `127.0.0.1`, or `::1`, is allowed,
   force included. A drive letter such as `C:/repos/x` is a path only under Git for Windows, since
   git elsewhere reads it as an ssh host named `C`.
2. A forced update is refused: a delete, an update whose remote sha is not an ancestor of the local
   sha (an unknown one included), and any update to an existing tag.
3. A repo with an `upstream` remote is refused, unless `holdFork` is `false`.
4. With `holdPublicPush` set to `false`, the push is allowed.
5. A URL that `git remote get-url --push --all origin` prints is allowed where `originVisibility` is
   `private`. git passes the hook the URL after `insteadOf` and `pushInsteadOf`, as that command
   prints it.
6. A URL recorded as private in the last hour is allowed.
7. Anything else is refused.

A refused push is reported with the repo, the remote's name or its URL without userinfo, each ref
update, and the command to run so the user is asked: `git -C <dir> -c hook.sessionskills.enabled=false push
<remote> <refspecs>`, with `--force-with-lease=<ref>:<sha the hook saw>` for a forced update, so a
remote that moved before the retry is not overwritten. Under Git for Windows the repo is written as
`C:/...`, since `pwd` there can print an MSYS path such as `/tmp/x`, which git run from PowerShell
reads as `C:/tmp/x`.

The records are one file per session, `session-skills-<session id>.visibility` in `TMPDIR` or
`TEMP`, since a hooks module is given no data directory. Each line is `<visibility> <seconds>
<url>`, with the userinfo removed from a URL other than an ssh one, where it is the login, and the
last line for a URL is the one read. A line is written for every gh or glab lookup, public and
unknown included: the lookup of origin's push URLs at session start, where `originVisibility` is not
set, `landing_facts`, and each lookup the lexer makes. Where a line is not written, the hook refuses
the push. One file per URL, named by `git hash-object`, was not used because the hash depends on the
repo's object format.

Once a session, `git -c hook.pre-push.enabled=true hook list pre-push` must list `sessionskills`:
`$.process.run` adds `hook.pre-push.enabled=false` to every git it starts, and a later `-c` turns it
back on. Then `hook.pre-push.enabled` and `hook.sessionskills.enabled` must not be `false` in a
config file. git 2.54 added config-based hooks, and 2.55 added `hook.<event>.enabled`. Where
`$.env.set` is refused or the check fails, the reason is shown once, in a toast.

The lexer reads every push it can see, as before, but refuses a held push that does not carry the
bypass, since the hook would refuse it after an approval. The command given instead is the same push
with `-c hook.sessionskills.enabled=false` after `git` and every option kept, so `--force-with-lease
--force-if-includes` stays in the retry, and so do the variables assigned before `git`, such as
`HUSKY=0`. A push read through a git alias is given as `push` with the alias's expanded arguments.
A directory held in a variable is given as `<dir>`, since it is read as the session's repo, and a
retry run there pushes that repo's branch. A Windows directory is written with `/`,
since Git Bash drops an unquoted backslash. Where the repo or the remote cannot be read, the form `git -C <dir>
push <remote>` is given too, with both written out. A command with the bypass is asked about
whatever the holds, with the usual reasons added. The bypass is accepted on a push git reads itself
(`push`, `send-pack`, `http-push`, `subtree push`, and `lfs push`). On an alias or any other
subcommand, such as `git town`, the command is refused, since its push is not shown in the prompt. A
push whose every URL is a path on this machine or a loopback host gets no force line and no hold, a
fork's included, by the same test as the hook's first rule. `land-and-wrap` writes a held push and
every force push with the bypass from the start, so each is asked about once.

These are asked about in any command, whatever its program, since each can turn the hook off or
replace it: a hook key (`hook.<name>.enabled`, `.command`, or `.event`, in any letter case)
anywhere in the command's text, eval text and quotes included, and a write, unset, or clear of
`GIT_CONFIG_PARAMETERS` or `GIT_CONFIG_COUNT`. The second covers an assignment, an argument to
`export` or another setter, `unset`, `env -u`, `env -i`, and `env -`, and in PowerShell a `$env:`
assignment, `Remove-Item` or `Clear-Item` on an `Env:` path under any built-in alias, and
`[Environment]::SetEnvironmentVariable`. They are read as words, so `git commit -m "Fix
GIT_CONFIG handling"` is not held, and neither is `git add src/webhook.ts`.

A `gh pr create` without `--head`, a `glab mr create` without `--push=false`, and a `gh repo create
--push` are refused where the branch push they may make would be held by the same rules as a push,
since the hook would refuse that push after the PR is approved. This is checked before any other
hold on the PR. A `--head` given a quoted variable, as in `land-and-wrap`'s `--head "$BRANCH"`, may
be empty, so such a PR is asked about with the push's reason instead of refused. The instruction given is to push first with the bypass and then open the PR with
`--head` or `--push=false`, or to create the repo and push it as two commands. A Bash or PowerShell
result with the hook's refusal in it gets no request for the next step, and neither does one with
git's `failed to push some refs`, which a pipe through `tail` leaves after cutting the hook's lines.

`hooks/pre-push.test.sh` runs the script as git runs it, against a scratch repo, and once through
`git push` with the entry Setup writes for a path with a space and an apostrophe. `test.sh` runs it,
since a test under `claude plugin test` cannot start a process.

Not covered:

- `--no-verify`, or the bypass, inside another program, such as a script an agent wrote earlier.
- An approved bypass turns the hook off for every push its git process starts, including one from
  the repo's own pre-push hook.
- A process that does not get the variable: the desktop app's terminal panel, which the app starts
  itself, an IDE terminal, a container, ssh, `sudo`, and a shell profile that replaces the
  variable. Another plugin's push through `$.process.run` runs no pre-push hook at all.
- A push made with a git library such as JGit, a write through gh, glab, or an API from inside
  another program, and publishing to a package registry.
- LFS objects uploaded by a refused push: the repo's `git lfs` hook runs after ours refuses.
- A dry run to a held remote is refused too, since the hook cannot tell it from a push.
- A visibility change on the host within the hour a record is kept.
- `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM`, or `HOME` set on the push, which change the files the
  script reads, and an inherited `GIT_CONFIG_COUNT` entry that turns pre-push hooks off.
- A second push URL on `origin` is allowed with the first where `originVisibility` is `private`.
- A local bare repo whose own hook pushes onward: git clears `GIT_CONFIG_PARAMETERS` for it.
- A loopback address other than the three above, such as `127.0.0.2`, is refused.

## Native events only

Every hook is on a native event. Under managed settings, or a Team or Enterprise sign-in,
`cc-plugin-sec-default` sends each `classic.*` event past user plugins and prints a notice that the
hook was skipped, every session. On a managed Windows machine on 2.1.311 the native paths reached
the model in every run, so the classic hooks were removed on every machine, leaving one path to
test.

On the managed Windows machine on 2.1.319, a session-start toast on 2026-11-08 reported that
`cc-plugin-sec-default` sent `tool.check` past this plugin, so nothing is put to the user in a
permission prompt from a skipped tool. A fresh probe later that evening showed PowerShell `git
push` calls reaching this plugin's `tool.check` normally in the same build, with no
skipped-check prefix on the refusal. The 0.27.3 Windows result had every PowerShell call go
without the check; on 2.1.319 the skip fires at session start but not for every PowerShell
shell call, so the asymmetry is not stable across sessions on this build. `tool.check` fires inside a `tool.call` hook's
`next`, just before the tool runs, so whether a call's check will be skipped is not known before
the call starts. A `tool.call` hook on the same tools refuses what `tool.check` would refuse before calling
`next`, so a refusal needs no skip to be known. The `tool.check` hook records each call ID it
decides, and the `tool.call` hook reads that record after a call has run, failed calls included.
Once a call of a tool has run with no record, every later call of that tool that `tool.check`
would ask about is refused too, with its reasons. In the retry note, the other shell tool is
given only where that tool is not itself in the skipped set, so a session that has seen both
tools skip falls back to the chat / `!` note. In such a refusal, the bypass is given as the
command to retry or for the user to run, not as the way to ask the user: with no prompt to raise,
the auto-mode classifier denies it. The suggestion is optimistic on a fresh session,
since the asymmetry on `cc-plugin-sec-default` reads as a Claude Code defect rather than a
stable policy, and after one roundtrip where the other tool is also skipped, no further retry
through it is suggested. The
first such call of each tool runs unasked, and a call of that tool that runs with a record clears
the refusal. A held push also meets the pre-push hook, and its bypass is refused like any held
command.
