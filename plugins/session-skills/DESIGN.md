# session-skills design

How the plugin is wired, for anyone changing it. The [README](README.md) covers using it.

## Tools and session rules

One hooks module, `hooks/register.ts`, which is a Claude Code mod and needs Claude Code 2.1.308 or
later, the oldest version supported. It registers six tools, named `mcp__session-skills__<tool>`,
and the skills call them where they once had bash to adapt:

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
adds the request for the next step to the result of a push, for a call on the main loop that was not
denied and did not fail. A command that a settings hook rewrote into a push is not seen. In four
runs of each arm on Sonnet 5.5, the first reply stated a next step 4 of 4 times with the request and
0 of 4 without it. Opus 5.5 stated one 2 of 2 times either way.

The holds in `land-and-wrap` are read from the skill text, so a session that pushes without the
skill pushes anyway: on 2026-11-06 a session pushed a cleared TODO to this public repo. A
`tool.check` hook on `Bash` and `PowerShell` reads the holds for the directory a push runs in, from
its `-C` or the last `cd` before it, and puts a held push to the user in the permission prompt with
the `git config` line that lifts the hold. A force push (a `--force` option, `-f` in a short-flag
group, or a `+` refspec) is put to the user whatever the holds, because it replaces commits a reviewer
may have read, and it is never refused outright, because it is a normal step after a rebase. A
hook's ask reaches a person in every permission mode,
and where nobody can be asked, as under `claude -p`, the push is refused. A dry run is not held,
and a subagent's push is held like any other. A path with a shell variable in it is not read, so
that push is checked in the session's repo.

The same hook puts every write to the host through `gh` or `glab` to the user, such as a comment, a
merge, a release, or a workflow run. Every subcommand is taken as a write except a short list of
reads (`view`, `list`, `diff`, `checks`, and the like), nouns that act on this machine only (`auth`,
`config`, `extension`), and a call for help. A list of writes was tried first, and an adversarial
pass found 101 of 120 probes it missed, among them `gh pr new`, `glab mr new`, and a verb new in a
recent release. An `api` call is read by its method instead: with a field and no method it is a
POST, as both CLIs send it, and a GraphQL call is a write unless its query is inline and starts with
`query` or `{`. Line continuations are joined and comment lines dropped before the command is read,
a `$(...)` or backtick substitution is read on its own even inside double quotes, and a command
with a quote left open is read again unmasked.

These asks hold whatever `origin`'s visibility, since a comment or a merge cannot be pulled back the
way a private push can. The one exception is a `gh pr create` or `glab mr create` in this clone's
own repo, with `holdPrText` lifted and past the fork hold. A PR aimed at another repo with `-R`, or
with `GH_REPO` or `GITLAB_REPO` anywhere in the command, is still asked about. Each write in a
chained command is checked, so a comment added after a PR opened unasked is still asked about. A write run
through `bash -c`, `eval`, or a user's own `gh alias` is not seen.

A follow-up prompt after the reply used to do this. It showed in the transcript as a message from the
plugin, it took a fenced block as the only sign of a next step, so it fired after "This session
carries on with R104", and it cost a turn.

No hook adds the rules to a subagent, because a subagent doesn't end a session.

## Native events only

Every hook is on a native event. Under managed settings, or a Team or Enterprise sign-in,
`cc-plugin-sec-default` sends each `classic.*` event past user plugins and prints a notice that the
hook was skipped, every session. On a managed Windows machine on 2.1.311 the native paths reached
the model in every run, so the classic hooks were removed on every machine, leaving one path to
test.
