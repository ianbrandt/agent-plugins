# session-skills design

How the plugin is wired, for anyone changing it. The [README](../README.md) covers using it.

## Tools and session rules

One hooks module, `hooks/register.ts`, which is a Claude Code mod. It was run on Claude Code
2.1.314 and later, and on nothing older. It registers seven tools, named
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
- `landing_facts` returns whether the repo is a fork, the push mode, the post mode, and the landing
  mode (`land-and-wrap` §1).
- `set_push_policy` sets the push mode, the post mode, or both, and writes the permission rules
  for them (see "Push and post modes").
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
tool definitions are in every session's context, at roughly 1,150 tokens for the seven, counted as
four characters to a token.

The module adds `hooks/rules.md` to the first prompt of every session, and again to a prompt or
a tool result once the model no longer reads it: after `/clear`, a compaction, or a plugin update
that changed the text. A fork starts with its parent's context, where the rules already are. That file has four rules that cannot go in a skill. One is the session title, given
once the subject of the session is known and again when a better one fits. How the title is set
differs by surface, so `{{title}}` in `rules.md` is replaced with one of two files, chosen by
`CLAUDE_CODE_ENTRYPOINT`: `title-desktop.md` for the desktop app's tool, and `title-print.md`
anywhere else, for a `/rename` command the user pastes. A session given several instructions at
once called another surface's tool in the desktop app and printed the title when the call failed. Another runs every turn:
weigh continuing this session against handing off to a fresh one without writing the weighing out,
and end a turn that closed a unit with the outcome: a hand-off block, a line that this session goes
on, or a line on what the next item waits on. The third applies whenever something out of scope turns up: raise it in the reply, write it
into the repo's backlog where it should outlive the session, and never leave it in a host's
suggested-task feature on its own. The fourth is that a push or a post runs only at the user's
request, written as a plain command. All four apply to every session that did real work, including
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

## Push and post modes

In auto mode a push to any branch of the session's repo and a `gh pr create` are allowed by
default, so a session that never loads `land-and-wrap` pushes unasked: on 2026-11-06 a session
pushed a cleared TODO to this public repo. A clone has two modes in per-clone git config, each the
user's choice whatever the repo's visibility: `session-skills.pushMode`, which is `confirm-push` or
`auto-push`, and `session-skills.postMode`, which is `confirm-post` or `auto-post`. Unset is the
confirm mode. A post is a PR or MR, an issue, a comment, or a release written with `gh` or `glab`.
A fork is always `confirm-post`, since its posts are published in someone else's project.
`holdPublicPush false` and `holdPrText false`, the keys of 0.29.0, are still read as the auto
modes. `holdFork` and `originVisibility` are no longer read.

In a confirm mode the prompt is raised by `permissions.ask` rules in `.claude/settings.local.json`,
which Claude Code applies in every permission mode. The rules are `git push *` and
`git -C * push *`, one for each post subcommand, such as `gh pr create *`, and `gh api` with each
flag that makes a write. Each rule is written for `Bash` and for `PowerShell`, beside whatever else
the file has, in three places:

- A `session.start` hook adds the rules for the primary checkout and for the directory the session
  starts in. It never takes a rule out.
- `open_worktree` adds them for the new worktree.
- `set_push_policy` writes the two git config keys, then adds and removes rules in the primary
  checkout and every worktree in `git worktree list`. Before a switch to an auto mode the user is
  asked with `$.ui.ask`, which is rejected in a `-p` run, and the modes then stay as they are.

`**/.claude/settings.local.json` is appended to `.git/info/exclude` where nothing ignores the file.

Each of these was measured on 2.1.322, in one run per case:

- In a headless auto mode session, `git push origin <branch>` ran with no rule, and did not run
  with the rules, in the plain form and under `git -C`. The results of the same five cases were the
  same on the Windows machine under managed settings, with no notice about a hook in the logs.
- On macOS a session started in a worktree applied the rules in the primary checkout's file. On
  Windows it applied only the file in the worktree, which is why the rules are written to each
  worktree.
- A ` *` at the end of a pattern also matched the command with nothing after it. A `* ` inside a
  pattern needed at least one word, so `git push *` and `git -C * push *` are two rules. A command
  after `cd . &&` was matched.
- An interactive session applied a file written by the `session.start` hook at once: the prompt
  was raised in the first session of a fresh clone. A `-p` session did not apply it until its next
  start.
- An edit of `.claude/settings.local.json` that was requested only in a file was blocked by the
  auto mode classifier as Self-Modification. The tool writes the file itself, after the user's
  answer.

No rule matches `git -c key=value push`, a push in a script or an alias, a write through `gh api`
with none of the flags, or a command sent through `Monitor` or a terminal tool, since a rule cannot
match an MCP tool's input. A push to the default branch of a `pr` clone has no prompt of its own in
`auto-push`. Whether a subagent's prompt is shown is not in the docs, a cloud session reads no local
settings, and bypass mode was not probed. For these, the paragraph in `hooks/rules.md` is the only
check.

Through 0.29.0 a `tool.check` hook read each shell command and answered `ask` for a push to a
remote not known to be private. Under managed settings `cc-plugin-sec-default` returns the
organization's verdict on `tool.check` in place of a user plugin's, so the hook had to be turned
off there with an option, and the push then ran unasked. Before that, the module added a git
`pre-push` hook through `GIT_CONFIG_PARAMETERS` and read commands with a 1,700-line lexer. The auto
mode classifier denied its bypass on both machines.
