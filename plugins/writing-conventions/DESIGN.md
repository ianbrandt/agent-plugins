# writing-conventions design

How the plugin works and the measurements behind its defaults, for anyone changing it. The
[README](README.md) covers installing and using it.

Every rule in `hooks/rules.md` arrived the same way: a specific draft came back wrong, and the
correction became a rule.

## What loads every session

The hooks module adds [`hooks/rules.md`](hooks/rules.md) to the first prompt of every session, and
again to a prompt or a tool result once the model no longer reads it: after `/clear`, a compaction,
or a plugin update that changed the text. It adds them to the start of every Agent subagent's task,
and to a Workflow agent's first tool result, since a subagent's report is what a later summary is
built from. Every hook is on a native event: under managed settings, `cc-plugin-sec-default` sends
each `classic.*` event past user plugins and prints a notice that the hook was skipped. The reasoning behind each rule, and its edge cases,
are in [`STYLE-GUIDE.md`](STYLE-GUIDE.md), which nothing loads. A draft for publication goes in
a fence tagged `draft` under the last rule in `rules.md`, and the draft check below looks for that
tag.

Prohibitions apply everywhere, `SKILL.md` files included, because they are about precision rather
than register. Form rules—bold, redundancy, length, and the reader-facing voice—do not apply to
agent-facing files, so those files are formatted for whatever a model reads best.

The reply lint runs on both ends of a turn, from the plugin's hooks module
([`hooks/gate.ts`](hooks/gate.ts)). On `turn.complete` the final reply is linted and what is found is saved.
On `prompt.submit` the next turn opens with those hits and a one-line reminder, and the saved
note is cleared. After a `Write` or an `Edit`, the session is asked to re-read the file just written
when it is prose, or is a source file with comments and test names in it (`.md`, `.markdown`,
`.txt`, `.kt`, `.kts`, `.java`, `.groovy`, in any letter case). The lint itself is `lint()` in
[`hooks/lint.ts`](hooks/lint.ts), a pure function over text, tested in
[`hooks/lint.test.ts`](hooks/lint.test.ts). The module also registers it as a tool,
`mcp__writing-conventions__lint`, which the session calls on each chat draft before the reply ends
([Chat drafts](#chat-drafts)).

A word is letters and digits in ASCII and Latin-1, so `café` is one word, and a character outside
those is read whole.

The lint flags the mechanically detectable subset of the rules: the banned vocabulary, spaced em
dashes, a missing Oxford comma in a list of single words, an inanimate subject paired with a verb of
speech, volition, or cognition, and a bulleted or numbered item that opens on bold text. The Oxford
comma check needs two commas before the final "and" or "or", because a one-comma list ("a, b and c")
matches too many ordinary clauses. The agency set is deliberately narrow. An earlier version also
matched possession verbs (holds, carries, keeps) and scored about 40% precision on a hand-checked
sample, mostly on code mechanics such as a map that holds a value; with the current set fewer
sentences are flagged, and each hit is one the model can act on.

Matched clauses are left to the gate. A pattern for two clauses of similar length joined by "and"
matched 44 of 582 sentences in this repo's last 400 commit messages and 27 of 419 in its READMEs,
nearly all of them ordinary compound sentences, and it did not match the sentence the rule was
written from. Whether two facts are related cannot be told from a pattern match.

The lint never asks for a rewrite. A reply is shown as it streams, so a corrected answer requires
re-emitting the entire original, which you have already read and which stays in the
transcript beside it. Carrying the hits into the next turn costs a few dozen tokens instead, and the
flagged reply stands as sent.

Each line of the note ends with the rule that line is about, because a note that contained only the
pattern and a reference to "the rules loaded at session start" did no better than sending nothing:
across six two-turn trials per arm, no note left 6 of 6 next replies dirty, the note with the
reference left 5 of 6 dirty, and the same mechanism with the rule stated inline left 0 of 6 dirty.
Literal senses ("a Slack channel", "an array shape") are not flagged. Text inside code fences,
backticks, and double quotes is never matched. A clean reply clears whatever the previous one left
pending. Rules that need judgment to detect are left to the model's review passes, but a
construction the lint cannot match is still a violation.

## Spaced em dashes in a reply

[`hooks/dash.ts`](hooks/dash.ts) closes up a spaced em dash as the reply streams, through a
`turn.step` hook in the plugin's hooks module, so `word — word` is shown and stored as `word—word`.
The fix has to be made in the stream: a hook on the stored reply alone leaves the screen
showing the spaced form while the reply arrives.

What the lint skips is left as written: a fenced block, inline code, and text in straight or
curly double quotes. A fence counts when it opens in a block quote or on a list item's first line,
and a code span or a quote left open at the end of a line stays open until it closes or a blank
line ends the paragraph. A `draft` fence is the exception, since its text is for publication, though a
fence inside it is left alone. The other findings in a draft still need the review model, so the draft
check is unchanged. Three more cases are left as written because the spaces are markdown: a dash with
no letter, code span, or quote before it on its line, as after a list or heading marker, a dash
alone in a table cell, and spaces between a dash and a line break. The reply lint and the review
model skip a dash alone in a table cell too, so a table with an empty cell is not flagged.

Text is held back only while the next piece of the stream could change it: spaces that may precede
a dash, a run of backticks, and a line that may open a fence. When a chunk of another kind arrives,
what is held is written first, and any more text for a block already begun is passed through as
written. In a 900-word reply no such chunk arrived inside a text block.

[`hooks/dash.test.ts`](hooks/dash.test.ts) checks each case whole and cut into random pieces, under
`claude plugin test`. [`hooks/register.ts`](hooks/register.ts) registers this hook and the gate's,
because `hooks.json` may list only one module.

## What runs the hooks

Everything runs in the plugin's hooks module, [`hooks/register.ts`](hooks/register.ts), so a
Windows session runs the same code as any other and no shell is involved.

The oldest version supported is 2.1.308. Below 2.1.286 the gate and the reply lint are off, and the
user is told once in a toast. `claude --debug` logs a module that did not load.

## The gate at publication

In the census behind this plugin, 101 of 107 corrections were to text that ships: PR bodies,
comments, issue bodies, commit messages, and docs. A lint over chat is never run on those, so a
`tool.call` hook checks the commands that publish them: `git commit`, every `gh pr`, `gh issue`, and
`gh release` subcommand, and any other command that can publish (see "Other shell commands"),
through the `Bash` tool and through the `PowerShell` tool both. Covering only `Bash` leaves every
commit ungated on a Windows session where the PowerShell tool is the shell.
[`hooks/gate.ts`](hooks/gate.ts) sends the command to a model, which pulls out the commit message or
the title and body and checks that text against the four prohibitions: inanimate agency, mechanics
(spaced em dashes and the Oxford comma), the banned words, and rule 4's epigrams, paired contrasts,
and matched clauses. The model also judges structure in a commit message, an issue, a pull request,
or a comment: a Markdown heading in a body of about ten sentences or fewer, and a bullet changelog
at any length. Headings and lists in a longer body are allowed. So are parallel bullets of evidence
or findings, and the headings and checkboxes of the target's issue or PR template, including a
template the gate cannot read, such as a YouTrack one. On Sonnet 5.5, when this check was a string
match, three bodies were refused 3 times out of 3: a PR body of 9 paragraphs under five headings, a
short PR body filled in on a GitHub PR template, and a YouTrack issue on its template. With the
judgment, both templates passed 5 times out of 5, and no heading in the long body was flagged on 5
checks. A one-sentence PR body under two headings with a bullet changelog, and a two-sentence issue
under two headings, were still refused 5 times out of 5. With "headings over sections of a sentence
or two" as the example, the long body was refused 2 times out of 3, so the model is told to judge
the length of the whole body. Draft release notes
in a pull request body are allowed when they are introduced as release notes, as they are in a
release bump PR. On Sonnet 5.5 one such body was refused 3 times out of 3 before that case was
added and passed 3 times out of 3 after, and its bullets with no introduction, or under "Changes:",
were still refused 3 times out of 3. Length is judged only in this check, and no other form is
judged. Tense and mood
are not judged either, since the tense of a commit subject is chosen per project, and the rewrite in
a finding is in the tense of the quoted words. On Sonnet 5.5 the past-tense subjects "Removed R484
from the roadmap" and "Removed R486 from the roadmap" were blocked with an imperative rewrite on 6
of 200 checks before that sentence was added to `gate-prompt.md`, and on none of 200 after. Sixteen
other past-tense commit subjects were blocked on 5 of 80 checks before and on 1 of 80 after. All 6
of those were findings of inanimate agency, 5 of them on "what a kept comment break leaves open",
which was flagged on 4 of 5 checks before and 1 of 5 after. The model replies `PASS`, `SKIP` for a
command that publishes nothing new (`gh pr view`, `gh pr checks`, `--amend --no-edit`, a label
change), or `VIOLATION` with one line per offending sentence: the quoted words, then a plain
rewrite.

An issue to a repo with an issue template follows the template, headings included. Before the model
is sent the text, [`hooks/template.ts`](hooks/template.ts) removes each heading that is a field
label of one of the repo's issue forms or a heading of its Markdown templates, so item 5 flags only
the other headings. The templates are read from `.github/ISSUE_TEMPLATE` with one `gh api graphql`
call per repo, kept for the session. After a failed call the repo has no templates for the rest of
the session, so offline no later check waits for gh. For a repo with none, the owner's `.github`
templates are used, as on GitHub. Headings are removed only from a command that starts with
`gh issue create`, `new`, or `edit` and has no other command in it but a `cat` that reads a heredoc
into the body. The repo is the one given with the last `--repo` or `-R` outside a quoted argument,
or with `GH_REPO`, or else the one `gh repo view` reports; a
repo given on a host other than github.com has no templates. No repo is given in a draft or a prose
file, so the templates of each repo linked from it with a `github.com` URL are used, and those of
the `gh repo view` one too. Since a draft's destination is not known, template headings are also
removed from a pull request draft, and they are flagged when it is published with `gh pr`. No `gh`
call is made for text with no heading. With the headings left in, a
feature request to anthropics/claude-code was refused 3 times out of 3 on Sonnet 5.5, and with them
removed it passed 3 times out of 3.

`findings()` in [`hooks/text.ts`](hooks/text.ts) looks for each quote in the command, with runs of
whitespace collapsed. A finding with its quote in the command comes back as the tool's error, and
the session fixes the text and runs the command again. A finding whose rewrite is the quote itself
is dropped, and so is every finding in a reply with a later `PASS` line, where the model took its
findings back. Of the 200 checks above after the tense sentence, 4 replies were one of the two. The
command goes through on a reply in any other form, as it does on a failed call, because the text the
model reads can quote an untrusted source.

The check is one `$.model.complete` call, with
[`hooks/gate-prompt.md`](hooks/gate-prompt.md) as the system prompt and the hook input as the
message. [`hooks/rules.md`](hooks/rules.md) is appended to that prompt, so a word added to the rules
is checked at the gate with no second edit. Which model answers comes from `WRITING_CONVENTIONS_GATE_MODEL`, or from the `sonnet` alias
when that is unset; set it in the `env` block of a settings file to any id the session's endpoint
serves.

An alias is enough there because `$.model.complete` resolves one the way `--model` does, through
`ANTHROPIC_DEFAULT_SONNET_MODEL` and the related variables, so the default works on a first-party
install and on a LiteLLM proxy in front of Bedrock or Vertex alike. That is the reason the check is
not a prompt-type hook, where an alias in the `model` field is not resolved: `"model": "sonnet"`
there is sent to the API verbatim, a proxy answers HTTP 400
`Invalid model name passed in model=sonnet`, and Claude Code logs `unrecognized_model` with
`query_source: hook_prompt`. Since that field is a free-form string checked at call time rather than
at load time, the only symptom was a hook error on every commit, and the check never ran.

Sonnet is the default because Haiku, Claude Code's default for a check like this, denied 10 of 24
checks on a dozen clean commit messages and then rejected its own suggested rewrites, so a session
could not commit at all. Haiku 5.5 later matched Sonnet 5.5 on that set, but on a larger one of 35
texts with an inanimate-agency violation it denied 58 of 70 checks where Sonnet 5.5 denied 66, it
was no faster, and 9 of its 190 calls ended with no reply. On Sonnet 5.5, five runs on the original
set allowed 57 of 60 clean checks and denied 40 of 40 planted ones.

In item 1 of the gate prompt, agency is judged by a test rather than a verb list: the subject is a
build, a run, a project, a script, a class, a setting, an option, a commit, or a file, and the verb
is an act that a person performs or chose in the code or the configuration. With a verb list, a
sentence got through whenever its verb was not on the list. With the test, 25 of 30 checks on sentences with unlisted verbs were
denied, and sentences about a program at run time ("the task writes the report", "the build fails
with") were allowed on 30 of 30. The cost is more findings on text an earlier review found clean: a
finding was kept on 52 of 120 checks of 60 posted texts. Matched clauses are caught on 17 of 18
planted commit messages and flagged on 1 of 40 checks of ordinary compound sentences.

A report or a page showing a value or an entry in it, a function taking a parameter, code needing or
compiling against a library, and a plugin requiring a dependency are listed as runtime jobs, and
"takes" and "needs" are off the verb list. A report that shows a conclusion, as in "the report shows
the fix works", is still flagged. Blind Opus judges read the findings kept on those 60 texts in the
commit message, MCP comment, prose file, and chat draft requests below, two runs each at `high`,
against `rules.md`. Of 475 calls on the earlier prompt, 58 came back with only findings the judges
rejected, 46 of them on agency, most often "the report shows" or "it takes the same predicate". With
the change, 36 of 477 did, and a finding was kept on 143 checks against 180. Twelve sentences with a
person's act and a verb in neither version were flagged on 35 of 36 checks against 33 of 36, and ten
sentences of the newly listed runtime jobs on none of 30 against 8 of 30. On the 35 planted texts,
the planted sentence was flagged on 240 of 279 checks against 238 of 278. Here a planted text counts
as caught only when its planted sentence was flagged, not on a finding elsewhere in it as in the
table below. The rest of the rejected agency findings are the test working as intended, such as "a
build that relies on that fallback gets the same report".

Two related facts joined by "while" or "but" are no longer read as matched clauses, but two
unrelated facts are matched clauses whatever joins them. The matched-clause example in `rules.md`,
with "while" or "but" in place of "and", was flagged on 8 of 8 checks, and the two reversals given
under rule 6 on none of 8. On the 20 clean texts with "while" or ", but", 6 of 40 calls came back
with only rejected findings, against 7 of 39 before.

Every review and both classifiers are sent at `high` effort. It is set in `gate.ts` so that the
level depends neither on the session's effort nor on a default that could change. It is the level an
unset effort resolved to: 15 clean texts were sent with no effort from sessions at Low and at Max,
and with `high`, and the median reply was 525 to 746 output tokens in each case. In an earlier run
of the 60 clean texts as PR bodies at `medium`, the median was 64. Prose files were reviewed at
`medium` until the runtime jobs above. With them, the planted sentence was flagged on 171 of 210
prose-file checks at `medium` against 184 of 210 on the earlier prompt, and 20 of 120 clean files
came back with only rejected findings, against 9 of 118 at `high`. Every other run labeled `high` in
this document was sent with no effort set, which resolved to `high` as above. On Sonnet 5.5, with
the gate prompt from before the runtime jobs above, the same 60 posted texts that an earlier review
found clean and 35 texts with a planted inanimate-agency violation were each sent twice at `high`
and at `medium`, in the request each kind of review makes:

| Request | Planted caught, `high` | At `medium` | Clean with a finding, `high` | At `medium` | Median clean review |
| --- | --- | --- | --- | --- | --- |
| `gh pr create` body | 65/69 | 68/70 | 45/119 | 49/120 | 4.4 s, 1.6 s |
| `git commit` message | 67/69 | 63/70 | 45/119 | 55/120 | 4.5 s, 1.7 s |
| MCP comment | 67/70 | 66/70 | 42/119 | 53/120 | 4.1 s, 1.5 s |
| Prose file | 68/70 | 69/70 | 46/119 | 46/120 | 4.3 s, 2.4 s |
| Chat draft | 67/69 | 68/70 | 47/118 | 59/120 | 4.5 s, 1.9 s |

Between the two runs at `high`, the count of clean texts with a finding differed by zero to four.
At `medium` the count rose by 10 to 12 on the commit message, MCP comment, and chat draft, by four
on the PR body, and not at all on the prose file. Over all five requests, a finding was kept on
262 of 600 clean checks at `medium` against 225 of 594 at `high`, and the commit message lost
planted catches. A total under 70 or 120 means a call came back empty. When the findings on 25 of
the clean texts were judged in an earlier run, 30 of 41 were real problems, so a count of clean
texts with a finding is not a count of false alarms. The 52 of 120 above and the 42 of 120 below are
counts on the same clean texts at `high`, from earlier versions of the gate prompt and rules.
A call is given at most 60 seconds, and the longest of the 1,710 calls took 22.5 seconds. At `low`,
a finding was kept on 63 of 120 checks of the clean texts against 42 at `high`. Haiku 4.5,
Sonnet 4.5, and Opus 4.1 each answered a call with `effort` set, so an older model set in
`WRITING_CONVENTIONS_GATE_MODEL` still answers. A gateway, Bedrock, and Vertex were not tried
with `effort` set. If it were refused there, every review would be off, not only the prose-file
review.

In an earlier run at `medium`, one reply in 40 put its reasoning ahead of `VIOLATION`, and Sonnet
4.5 has put `VIOLATION` inside a code fence. The verdict is the first line that is a verdict word,
so lines before it are skipped and the findings after it are still used.

The system prompt is marked for the prompt cache. The review prompt is 5,793 tokens, and a call
within five minutes of the last one reads it from the cache at a tenth of the input price. That
does not make a call faster. Over 15 drafts at `high`, each sent once with the mark and
once without, the median difference was 9 ms, because the time goes to thinking: 300 to 1,300
output tokens at about 6 ms each on a draft that passes. Over 15 clean PR bodies at `medium`, where
the median reply was 5 tokens, it was 45 ms. The command classifier's 842-token prompt is cached
too, and the MCP classifier's 358-token prompt is under the minimum. According to the type notes
for `$.model.complete`, text marked in the system prompt is not found again on Bedrock, Vertex, or
a gateway. Through a LiteLLM proxy in front of the Anthropic API on Claude Code 2.1.318, it was
found again: in `e2e/cache-probe.sh`, the second and third reviews each read the whole review
prompt, 5,655 tokens at the time, from the cache. Bedrock and Vertex were not measured.

Every failure lets the command through, so a commit is not blocked when no model can be called. The
first time in a session that a check fails, the user is told once that model review is off, in a
toast, which is shown to the user and not to the model. A reply from a call that was answered is not
such a failure, whatever its form.

The cost is one call per `git commit` and per `gh pr`, `gh issue`, or `gh release` command, read-only
ones included. One hook covers all four command families, because the command text is
matched in the module rather than through a hook `if` pattern. `git -C <path> commit` is gated that
way too, and no `Bash(git commit *)` rule matches that form, which is the one a worktree session uses.
[`hooks/gate.test.ts`](hooks/gate.test.ts) checks the plumbing under `claude plugin test`, against a
stand-in for the model: which commands are sent to the model, which replies block a command, and the
fail-open path.

### Other shell commands

Any other command is reviewed when the classifier model answers that it can publish. That
way `hg commit`, `svn commit`, `jj describe`, `glab mr create`, and a CLI nobody here has heard of
are read like `git commit`, with no command name written in the plugin.
`keys()` in [`hooks/keys.ts`](hooks/keys.ts) splits the command into
keys: each simple command's first word, up to two subcommand candidates after it, and the words after
each key in case it is a task runner. A substitution inside double quotes counts as a command, but
single-quoted text and heredoc bodies do not. It is tested in
[`hooks/keys.test.ts`](hooks/keys.test.ts).

Each key has one of five classes: `NEVER`, `CAN_PUBLISH`, `DESCEND` when the answer depends on the
subcommand (`git`, `hg`), `PROJECT` when the words after it are the project's task names (`make`,
`npm run`, `./gradlew`), or `RUNS_CODE` for an interpreter or `curl`. Keys with no class cost one
classifier call for the whole command, with [`hooks/classify-command.md`](hooks/classify-command.md)
as the prompt. A key missing from the reply is doubt: it reads as `CAN_PUBLISH` and is not kept. A
command with keys that are all `NEVER` makes no call.

The answers are appended to
`${CLAUDE_CONFIG_DIR:-~/.claude}/writing-conventions/shell-commands-<hash>.txt`, one line each:
`<scope><TAB><class><TAB><key>`. The scope is `*` for a key every project shares, or the project
directory for a task name or a program run by path. The file is yours to read and edit, and for one
key a `CAN_PUBLISH` line wins over the other classes.

The four command families above are reviewed whatever is in the file, so a wrong `NEVER` can only
cost coverage of other commands. A command is also reviewed when it has a quote left open, or a word
that cannot be read as a name in a subcommand position, such as `hg "$verb"`. A `RUNS_CODE` command
is read only when it contains a sentence: six or more words, the first capitalized and the last
ending in `.`, `!`, or `?`. A `\n` or `\t` escape between words counts as a space, and a word may be
quoted. Interpreters run in about 16% of commands on the machine this was measured on, and a short
message posted through `curl` or a script is not read. `WRITING_CONVENTIONS_SHELL_CLASSIFIER=0`
turns this off and leaves the four families.

A command that only writes a local file is not blocked, just as a `Write` or `Edit` to a prose file
is not (see "Prose files"). The
review model answers `LOCAL` in place of `VIOLATION` when nothing in the command sends the text anywhere
else, and doubt is `VIOLATION`. The findings then come back as `additionalContext`, and the session
fixes the file after the command runs. A `LOCAL` answer still blocks the four families and an MCP
call. In a live run on Sonnet 5.5, two local-file scripts came back `LOCAL` 6 times out of 6. Four
scripts that post their text through a webhook, `gh api`, `hg commit -l`, or `glab release create`
were blocked 12 times out of 12.

A session in a worktree edits a file that lives only in the primary checkout with the
`edit_primary_file` tool of `session-skills`, because a worktree guard can refuse an `Edit` there.
That is an MCP call and not a command, so no `LOCAL` answer applies to it. It is read after it runs,
as an `Edit` is (see "MCP calls").

A body passed by file path is read by the gate, for the four families only: `git commit -F` or
`--file`, and `-F`, `--body-file`, or `--notes-file` on `gh pr`, `gh issue`, and `gh release`. The
flags that take a value are listed per command in `keys.ts`, from each command's
`--help`, so that `git commit -m '-F' notes.txt` reads no file. The review model is sent each file after the
hook input, under a `File: <path>` line, and a finding may quote it. A file is read only when the
text on disk is the text the command will publish, as far as the gate can tell:

- The path is literal, with no variable, glob, `~`, or quoted space in it.
- No other word of the command includes its file name, since a command that writes the file first
  publishes different text from what is in the file now.
- A relative path resolves against the session's `cwd`, and the command has no `cd`, `pushd`,
  `Set-Location`, `git -C`, `git --work-tree`, or `GIT_WORK_TREE` in it.
- It is a readable regular file, not a link, inside the project or a temporary directory, at most
  1 MB, with no NUL byte in its first 8 KB.

Where one command passes two body flags, only the last one is read, as git and gh do. Up to 4 files
are read per command, 50,000 characters in all. Each file that is not read is listed back to the
session with the reason, in the block reason or as `additionalContext`.

The test by file name has two known costs. When a command rewrites the file without its name
appearing, such as `make notes && gh release create v1 -F notes.md`, the old text is read. When the
name appears again only to delete the file, such as `git commit -F msg.txt && rm msg.txt`, no file
is read. A body flag is not found at all after a wrapper that takes a value (`sudo -u me`,
`nice -n 5`) or in a program called by path (`/usr/bin/git`), and nothing is reported for it. A body
file for any other command, such as `hg commit -l`, is not read.

Replayed from an empty cache over 122,260 shell commands from one machine's history, 3.6% of
commands made a classifier call and 9.5% were reviewed, against 4.1% for the four families
alone. Of the rest, 1.8% were `python3` with a sentence in the code, 1.7% were programs run by path
that the classifier did not know, 0.9% were `git merge`, `rebase`, `tag`, and `cherry-pick`, and
0.5% were commands that could not be split into keys. Planted inanimate-agency sentences in `hg commit`,
`svn commit`, `jj describe`, and `glab mr create` were each blocked, and clean messages in the same
four went through.

### MCP calls

A team that publishes through an MCP server, such as Jira and Bitbucket with no `gh` installed, gets
the same read. The `tool.call` hook that reads a shell command reads a call to any `mcp__` tool. No
server or tool name is written in it, but for two local tools of this marketplace (below). The first call to a tool costs one classifier call, with
[`hooks/classify-prompt.md`](hooks/classify-prompt.md) as the system prompt: can this tool hand text
to a human-facing destination? The answer is `CAN_PUBLISH` or `NEVER`, doubt is `CAN_PUBLISH`, and
a reply in any other form is treated as doubt and not kept. On 30 hand-labeled tools with sample
inputs (Jira, Confluence, Bitbucket, GitHub, GitLab, Slack, mail, and read-only search and browser
tools), all 20 publishing tools came back `CAN_PUBLISH` and all 10 others `NEVER`.

The answer is appended as one line, `<tool name> <answer>`, to
`${CLAUDE_CONFIG_DIR:-~/.claude}/writing-conventions/mcp-tools-<hash>.txt`, where the hash is of the
classifier prompt, so a changed prompt starts a new file. The file is yours to read and edit: for one tool a `CAN_PUBLISH` line wins
over a `NEVER` line, and a malformed line is ignored. A `NEVER` tool costs no model call after the
first. A wrong `NEVER` is a lasting gap on that machine until the line is edited.

For a `CAN_PUBLISH` tool the whole `tool_input` is sent to the review model, structure included, so text
split across short fields is read together. A finding has to quote the decoded string values of
`tool_input`. In a rich-text body such as Atlassian Document Format one sentence can be split
across text nodes, and the review model quotes it as its pieces, `"The report " + "says so."`; each piece
is looked for on its own and nothing is joined.

Two tools of this marketplace write a file on this machine and send text nowhere else:
`edit_primary_file` of `session-skills` and `write_claim` of `parallel-session-skills`. Both are
listed in `gate.ts`, and a call to either is never classified or blocked. After an
`edit_primary_file` call the new text is read as an `Edit` to that file is (see "Prose files"), and
the findings come back as context. A claim is JSON, so no part of a `write_claim` call is read.
Before the two were listed, in a live run on Sonnet 5.5, the classifier answered `CAN_PUBLISH` for
each tool 10 times out of 10, and a call with three planted violations was blocked each time.
`delete_item` of `roadmap-skills` came back `NEVER` 13 times out of 13.

A tool that a plugin registers is answered by that plugin's `tool.call` handler. When that plugin
is loaded before this one, its handler answers first and the gate is never called: in 9 live runs
with `--plugin-dir` in that order, no call was classified or read. The 33 runs above had this
plugin first.

### Prose files

A `Write` or `Edit` to a `.md`, `.markdown`, `.txt`, `.adoc`, or `.rst` file is read the same way
after the fact, from the result of its `tool.call`. Nothing is blocked, because a file is cheap to
fix and a blocked edit stops the turn: a verified finding is added as context to the tool result,
and the session fixes the file in place. The advisory re-read request on `Write|Edit` is unchanged and still fires
for the same files, so a session in which the review model cannot run keeps it. For a source file
there is only the re-read request.

The review model has no tools, so the gate reads, and only the text the tool just wrote. For a
`Write` the text under review is `content`. For an `Edit` it is the whole paragraphs, bounded by
blank lines, that contain `new_string` in the edited file (`excerpt()` in
[`hooks/text.ts`](hooks/text.ts)): replacing "includes" with "says" in "The report includes the
version." makes a violation that the one word does not show. The size of the excerpt follows the
edit and not the file, so a release note added to a large changelog is read. The review model is
sent that text and the file path, not the tool call.

The edited file is rebuilt from the `Edit` result's `originalFile`, `oldString`, and `newString`,
and is read from disk only where the result lacks them or where the rebuilt text is missing a line
of the result's `structuredPatch`. The check runs after the `PostToolUse` hooks beneath it, and a
formatter among them may have reflowed the file, so that `new_string` is no longer found there.

What is not read is stated in the same feedback: text past the first 50,000 characters, an `Edit`
that only deletes, and the sentences around an `Edit` to a file over 1 MB, where `new_string` alone
is read. A draft written to a file with a shell redirect is not read at all.

### Chat drafts

A draft the session hands its user to paste somewhere else is never in a shell command or an MCP
tool call. A draft for publication goes in its own fenced block with the info string `draft`; that rule
is loaded into every session.

The review runs before the reply ends where it can. Under the same rule, the session calls
`mcp__writing-conventions__lint` on each draft and fixes what comes back in the same reply. The tool
runs the reply lint and then sends the draft to the review model. A draft with no finding is kept in
memory as passed, by its text with the whitespace at either end trimmed. Without the fence, the
whole `text` is read as one draft. A `turn.complete` hook can return only text and usage, so the check runs on the stream.

A reply's text streams through a `turn.step` hook (`hooks/hold.ts`) up to its first `draft` fence,
and the rest of the response is held. A line is kept back only while it could still be a fence
marker, so plain text is not delayed. When the response ends the turn, the text inside each `draft`
fence is sent to the review model, except the drafts passed by the tool, and nothing else in the reply
is. A clean reply is then released whole and in order. A reply with no such fence costs one scan and
no model call. A draft changed after the tool passed it is read again. A response that asks for
tools is released with no review, since it does not end the turn. A subagent's response is not held.

After a verified finding, what was held is replaced with a call to `mcp__writing-conventions__lint`,
and the findings are kept for that call to return, so the draft is not reviewed twice. The engine runs the
tool and the same turn goes on, so there is no second turn and no prompt in the transcript. This was
measured on 2.1.316, on Sonnet and on Opus with thinking on, in auto mode and with default
permissions, and on 2.1.309 (R513). The tool result is worded as facts, with a request for the rewrite: the check ran when the reply
ended, and the reply was shown only up to the draft. In an earlier wording the model was also told
to say nothing about the review. It took that for an injection, refused the finding, and told the
user. A request sent again with a hidden `$.session.append` row in place
of the tool call did not work, because the row is not in that request.

The rewrites are counted per turn and stop after two; the third time, the user is told that review
is unresolved, and the reply is released. The hold is off where the lint tool could not be listed,
since there is no tool to call. A failed review or a broken stream releases what was held. A reply
cut off by `max_tokens` or a refusal is released with no review, and the reply lint still reads it.

A lint tool removed with `--disallowedTools` comes back to the model as an error, and the reply is
then written and shown. Under `claude -p --max-turns`, a flagged reply on the last allowed turn is
lost, since the call uses up the limit and the run ends in `error_max_turns`. A run with room for the
rewrite is not affected, and the evals allow 8 turns.
Set `WRITING_CONVENTIONS_STOP_READER=0` to turn this check off, in the tool and at the end of a reply.

Tagging keeps this check cheap, since an untagged draft has no reliable form: without the rule,
drafts came back in plain fences, blockquotes, and between `---` rules, and a plain fence of 8 words
or more also showed up in 4 of 12 ordinary replies. On Sonnet 5.5, with the draft mentioned only as
a by-product of a coding task, 9 of 10 replies that included a draft tagged it, and none of 12
ordinary replies used the tag. The miss gave review feedback as the body of the reply rather than as
a block. A draft the session does not tag is checked by the reply lint alone.

The lint drops every closed fenced block before matching, so the `draft` fences are unwrapped
first (`drafts()` in [`hooks/text.ts`](hooks/text.ts), the same scanner the draft check uses), and
the whole reply is still linted in one pass. A code fence inside a draft is still a fence and is
still dropped, which is why a draft that includes one goes in a longer fence.

### What is not gated

A `git push` is not read, because a branch name is chosen long before it.

Adding a word to the banned list is a plugin change rather than a local edit, and installed
sessions get it after the plugin's next release ([Releases](../../DEVELOP.md#releases)).

## Measuring it

[`evals/`](evals/) is a `claude plugin eval` suite of drafting tasks built from the corrections that
motivated this plugin: commit messages, PR bodies, an issue body, a maintainer comment, a README
paragraph, KDoc, a changelog entry, Spock method names, a code comment, and a status reply. The facts
in each prompt are stated the way a user would state them, without the rules, and most include tells
a session is likely to copy into a draft: a personified report or build, a spaced em dash, a banned
word, or a "whose" after a file. With clean facts, the scores with and without the plugin differed
little, because the model's default register already passes.

Each case has regex graders for spaced dashes, banned words, and a narrow personification pattern,
plus a judge-model grader for personification and, where the genre calls for it, one for form. The
form graders check only this plugin's rules: lead with the outcome, and no narration of how the
change came about. Sentence counts and heading limits are left to `ghostwrite`. Both judges fail a
draft only for a sentence they can quote: with looser wording, the personification judge failed 11
of 24 runs with and without the plugin, and only one of the 11 drafts had a real violation.

Run the suite from the plugin directory:

```bash
claude plugin eval . --runs 2 --judge-model sonnet --no-publish -j 4
```

Each run scores the same prompts with and without the plugin loaded and reports the difference. A
run costs a fraction of a dollar, so the suite is for a change to the rules file or the hooks, not
for every commit. Results go under `evals/results/`, which is ignored. The draft check is on during
a run, and a rewrite adds a tool call to the turn's count. `max_turns` is 8 in every case.

The latest whole-suite run, on 2026-10-08, scored 0.94 with the plugin and 0.83 without. The score
without the plugin moved by 0.05 between two runs of the same prompts, so a gain from a single run is
known only to within about that much. Tells copied from the facts still get through: "the README told
users" has appeared in plugin-loaded PR body drafts. A score from before CLI 2.1.289 is not
comparable with a later one, because the judge for `--judge-model sonnet` changed to Sonnet 5.5
there.

## Prior art

Surveyed on 2026-09-11. Most published fixes for AI-sounding prose are a rules file or a rewrite
pass run on request: [humanizer](https://github.com/blader/humanizer),
[stop-slop](https://github.com/hardikpandya/stop-slop), and
[agent-style](https://github.com/yzhao062/agent-style). Only stop-slop has a rule against inanimate
agency, and agent-style is the only one with a measurement: a 10-task bench where sentence length,
dashes, and jargon accounted for nearly all of the change.
[vale-ai-tells](https://github.com/tbhb/vale-ai-tells) is a Vale package with regexes for
personification, paired contrasts, and one-line closers, with false positives counted against the
Go and Python standard library docs. Its patterns are broader than the agency set in `lint.ts`.

Users in Claude Code issues report that style instructions drift after a few turns and return in
the next session (anthropics/claude-code#77136 and #57952), and the only fixes reported to hold were
a hook or a CI grep. Per Claude Code's docs, `CLAUDE.md` is advisory and hooks are deterministic,
so text that ships is checked at the gate here rather than left to the rules alone. The short
`rules.md` and the reminder at the next prompt are based on two results: instruction following
falls as the count of instructions grows ([IFScale](https://arxiv.org/abs/2507.11538)), and a
reminder at the end of the prompt restored most lost compliance
([arXiv 2603.23530](https://arxiv.org/abs/2603.23530)).
