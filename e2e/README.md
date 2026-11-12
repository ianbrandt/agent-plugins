# End-to-end tests

Each test is one headless session that claims, builds, and lands an item in a scratch repo, with
every plugin loaded from this checkout. These tests are the check that `roadmap-skills`,
`session-skills`, and `parallel-session-skills` work together: their unit tests in `test.sh` run
against mocked git and model calls. A test takes about a minute and calls a model, so run them
before a push that changes how those plugins claim, open, or land work, not on every commit.

```bash
e2e/run.sh first /tmp/e2e-1
```

- `first` starts in the repo root with `/roadmap-skills:next-roadmap-item R1`. The primary checkout
  is clean and on `main`, so the item is built on a branch there, with no worktree, under a claim
  written for the primary checkout.
- `resume` starts inside a worktree for R2 that already has half of the item committed, with
  `/roadmap-skills:next-roadmap-item R2`. The session has to adopt that worktree rather than open a
  second one or a branch in the primary checkout.

[`setup.sh`](setup.sh) builds the scratch repo: a bare `origin.git`, a two-item local-only roadmap,
and `session-skills.landing merge`, so the item is fast-forwarded into `main`. The clone is on
`confirm-push`, the default, and the run is unattended, so no push is attempted.
The session transcript goes to `<dir>/session.jsonl` and the repo's state afterward to
`<dir>/state.txt`. `python3 e2e/calls.py <dir>/session.jsonl` prints the plugins loaded and each
tool call with the first line of its result.

A test passes when:

- every plugin is listed as `<name>@inline` in the init event, and none as `@ianbrandt`;
- the item is built and fast-forwarded into `main`, and `origin.git` is unchanged;
- the item is gone from the roadmap and has a done-record in the changelog;
- the primary checkout is on `main` with the item's branch deleted, no claim is left, and in
  `resume` the worktree is removed, with no error from a plugin tool and no Bash command run in
  place of one. In `first`, the branch is opened with `git switch -c`, which no tool replaces, and
  `write_claim` and `release_claim` are both called with the primary checkout's path.

Run each kind several times before trusting a pass, one at a time, since a session given the same
prompt does not always make the same calls.

## The guard probes

Two separate checks are for the `cc-plugin-sec-default` guard, which is seated only under managed
settings. Each runs one headless session and looks its markers up in the session transcripts on
disk, so a result does not depend on the model quoting a marker back.

[`tool-call-probe.sh`](tool-call-probe.sh) loads a scratch plugin that changes an Agent prompt and
a Bash command, denies a Grep call, and adds context to a Read result and a Write result. For each
case it prints whether the hook ran and whether the change was recorded and sent, then the debug
log lines about the guard. [`tool-call-rounds.sh`](tool-call-rounds.sh) runs it until three runs of
each setup are complete: project settings, user settings too, and 2.1.310 from npm.

[`fallback-probe.sh`](fallback-probe.sh) loads every plugin in this checkout and checks the four
hooks that add text through `tool.call`: the rules in an Agent subagent's task and in a
Workflow agent's, the re-read request after a Markdown Write, and the voice data beside the
ghostwrite Skill's result. It also checks the main-loop rules of three plugins, and counts the
notices that a hook of one of these plugins was skipped, which should be 0.

[`followup-probe.sh`](followup-probe.sh) loads `writing-conventions` and `session-skills`, then runs
one turn that pushes and writes a draft the review model should flag. It prints the count of plugin
prompts in the transcript, which should be 0, the lint calls the hook made, and whether the push
result includes the request for the next step.

```bash
e2e/tool-call-rounds.sh /tmp/rounds-1
e2e/fallback-probe.sh /tmp/fallback-1
e2e/followup-probe.sh /tmp/followup-1
```
