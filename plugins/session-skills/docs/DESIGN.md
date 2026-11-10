# session-skills design

How the plugin is wired, for anyone changing it. The [README](../README.md) covers using it.

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

A follow-up prompt after the reply used to do this. It showed in the transcript as a message from the
plugin, it took a fenced block as the only sign of a next step, so it fired after "This session
carries on with R104", and it cost a turn.

No hook adds the rules to a subagent, because a subagent doesn't end a session.

## Push and host-write prompt

The holds in `land-and-wrap` are read from the skill text, so a session that pushes without the
skill pushes anyway: on 2026-11-06 a session pushed a cleared TODO to this public repo. With the
`askBeforeOutwardWrites` option on, its default, a `tool.check` hook on `Bash`, `PowerShell`,
`Monitor`, and the two terminal tools answers `ask` for:

- a push that a hold in `land-and-wrap` §1 applies to, with the `git config` line that lifts it
- any force push, whatever the holds, since it replaces commits a reviewer may have read
- a write to the host with `gh` or `glab`, such as a comment, a merge, or a POST through `api`
- a write to a `session-skills.*` git config key, or a `git remote remove`, `rm`, `rename`, or
  `set-url`, which could lift a hold or change where a push goes

After Yes the command runs as written. The ask reaches a person in every permission mode, and the
engine's own denial stands. The hook asks when it cannot read a command at all, since the engine
skips a hook that throws.

The hold reads git config in the directory the push runs in: the last `cd` or `-C` in the command,
else the Bash tool's working directory. A directory held in a variable cannot be read, and the push
is asked about. The visibility is read for the remote the push goes to: the one written in the
command, else the one git picks from the branch's `pushRemote`, `remote.pushDefault`, and the
branch's remote, with origin last. origin, or a remote with the same push URLs, takes
`originVisibility` from git config, and any other remote is looked up with gh or glab by each of
its push URLs. A path on this machine is private, and a push to one is not held, in a fork too.
`mcp__terminal__run_in_terminal` is read in its `cwd`, and in a directory that cannot be read when it
reuses a tab or `cwd` starts with `~`. `mcp__idea__execute_terminal_command` runs in the IDE's
project with the IDE's shell, so the command is read as both bash and PowerShell in a directory that
cannot be read.

A `gh pr create` or `glab mr create` goes unasked only with `holdPrText` lifted, past the fork hold,
in a clone whose only remote is origin, with no `GH_REPO` or `GITLAB_REPO`, and where a push of the
branch to origin would not be held, since either CLI may push the branch.

The command is read loosely, as the retired personal guard this hook replaces read it: split on
shell separators outside quotes, with quotes and escapes resolved, and with comments,
redirections, PowerShell here-string bodies, and heredoc bodies dropped, unless a shell reads the
heredoc. A `$(...)`, `${...}`, or backtick span stays in its word, which then cannot be read, so a
`git -C $(...) push` is asked about, and the commands inside an unquoted substitution are read too. git, gh, and glab are found in any word of a simple
command, so `sudo git push` is read, and `echo git push` is asked about too. A review with live probes
found four commands an agent might write that went unasked, among them `git push 2>&1 | tail -5`, which
read `2>` as a remote on this machine, and each has a regression test. A push in a quoted
substitution, a git or gh alias, `eval`, `bash -c`, or a script is not seen, and neither is a force
set in config. These gaps are accepted, since the prompt is there for a session that misreads a go,
not for a command written to get past it.

## Managed machines

Under managed settings, or a Team or Enterprise sign-in, `cc-plugin-sec-default` sends each
`classic.*` event past user plugins and prints a notice that the hook was skipped. On the managed
Windows machine on 2.1.319 it also sent `tool.check` past this plugin, so the prompt above was never
raised and a skipped-hook warning was shown. Every other hook is on a native event, and the native
paths reached the model in every run there.

Whether a machine is managed cannot be learned in time: a hook that read the managed settings at
session start and then registered `tool.check` was refused on 2.1.322 with "a hook may not register
hooks". So the prompt is an option, read when the module loads, and a managed user turns it off
once. With it off, no `tool.check` hook is registered and nothing warns. The hold then rests on the
skill text and on an auto mode rule an admin puts in managed settings. In a probe on 2.1.322 under
`claude -p` in auto mode, a rule in a settings file blocked an action the user did not ask for and
let a requested one through. The same rule returned by a plugin's `settings.read` hook had no
effect. The managed-settings rule itself is not tested.

Before this design, the module also added a git `pre-push` hook to every git the session started
through `GIT_CONFIG_PARAMETERS`, refused a held push with a bypass to run instead, refused a skipped
tool's later calls, and read commands with a 1,700-line lexer. The auto mode classifier denied the
bypass on both machines, and the refusals stopped work on the managed machine, so all of it was
removed.
