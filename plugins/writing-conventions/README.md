# writing-conventions

A [Claude Code](https://claude.ai/code) plugin that keeps an agent's writing plain: no AI tells, and
replies you can follow without having watched the work. A short set of rules is loaded into every
session, replies are checked against them, and text is reviewed before a command or tool publishes
it.

```sh
/plugin install writing-conventions@ianbrandt
```

Claude Code 2.1.308 or later is required.

## What you will see

- The rules in [`hooks/rules.md`](hooks/rules.md) are added to the first prompt of every session,
  again after `/clear` and compaction, and to every subagent's task. They cost about 1,800 tokens each time.
- A reply is linted when the turn ends. Hits such as a banned word are passed to the session with
  your next message to be fixed in the next reply, and the flagged reply stands as sent.
- A spaced em dash is closed up as the reply streams.
- `git commit` and the `gh pr`, `gh issue`, and `gh release` commands are reviewed by a model before
  they run. A violation blocks the command with a suggested rewrite, and the session fixes the text
  and runs it again.
- Other shell commands and MCP tools are reviewed the same way when a model classifies them as
  able to publish text, such as `glab mr create` or a Jira tool.
- After a `Write` or `Edit` to a `.md`, `.markdown`, `.txt`, `.adoc`, or `.rst` file, the new text
  is reviewed and the session fixes what is found. Nothing is blocked.
- A draft the session hands you to post elsewhere goes in a fenced block tagged `draft`. The
  session has it reviewed with the plugin's lint tool and fixes it before the reply ends. A draft
  that was not reviewed that way is held back as it streams and reviewed when the reply ends. After
  a finding the session rewrites it in the same turn, and you see a lint tool call and then the
  corrected draft, with no extra prompt. After two rewrites with a finding in each, you are told and
  the draft is shown as written. A held draft appears only once it is reviewed, about 10 to 15
  seconds after it is written.
- A heading in a short commit message, issue, PR, or comment is flagged, and so is a bulleted list
  of the changes in the diff. Headings are allowed in a long body and where they follow the
  target's issue or PR template. A GitHub repo's issue template is read with `gh`, and its headings
  are removed before the review.

Each review is one model call, Sonnet by default, and usually takes a few seconds. When no model can
be called, the command goes through and you are told once per session, in a toast, that a review
did not run and why. Each later review is still tried.

## Settings

Set these in the `env` block of a settings file:

- `WRITING_CONVENTIONS_GATE_MODEL`: the review model, `sonnet` by default. Any model ID the
  session's endpoint serves works.
- `WRITING_CONVENTIONS_SHELL_CLASSIFIER=0`: review only `git commit` and `gh`.
- `WRITING_CONVENTIONS_STOP_READER=0`: skip review of `draft` blocks, in the lint tool too.

The classifier's answers are cached in `${CLAUDE_CONFIG_DIR:-~/.claude}/writing-conventions/`, one
line per command or tool. You can edit those files. Where a command or tool has both a
`CAN_PUBLISH` line and a `NEVER` line, it is reviewed.

## Limits

- `git push` is not reviewed, and neither is a file written with a shell redirect.
- With `claude -p` and the default text output, a reply with a draft that is corrected is printed,
  then the corrected reply after it. Under `--output-format stream-json` each reply has a `result`
  event of its own, and under `--output-format json` only the last reply is in `result`.
- The lint catches only the mechanical rules: banned words, spaced dashes, a missing Oxford comma,
  and an object that "says" or "wants" something. The rest depends on the session following the
  rules and on the model review.

## Flagging a word

When you flag a word as jargon or as AI writing, the session adds it to `hooks/rules.md` with its
plain replacement. With `ghostwriting-skills` installed, general rules from your edits to its drafts
are added to the same file.

## More

[DESIGN.md](docs/DESIGN.md) covers how each check works and the measurements behind the defaults,
including how to run the [evals](evals/). The reasoning and edge cases behind each rule are in
[STYLE-GUIDE.md](STYLE-GUIDE.md).
