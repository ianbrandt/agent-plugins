# ghostwriting-skills

A [Claude Code](https://claude.ai/code) plugin for drafting text that ships under your name—issues,
PRs, comments, commit messages, docs, code comments—in your voice rather than the model's default
register. Only the method is in the skills. Your voice data is read from a directory you keep
outside this repo.

## Where your voice data lives

A `voice-spec.md` (voice rules, per-genre form, a delta log of your edits) and a `corpus/` of your
hand-written samples. The directory is asked for when the plugin is enabled (the `voice_dir`
option); left empty, the skills use `$GHOSTWRITING_DIR`, then `~/.claude/ghostwriting/`. The
directory can be a symlink into a private repo.

[`hooks/voice.ts`](hooks/voice.ts) adds that data beside the Skill tool's result when the model runs
the `ghostwrite` skill: the spec, every corpus sample up to 64,000 characters in all, and the
`writing-conventions` rules file when that plugin is installed. Past that size the samples are
listed by name for the model to read by genre. For `share-ghostwriting-spec` only the directory is
added, with whether it has a spec. When a skill is typed as a slash command, the same text is added
as context on the prompt instead, as checked on 2.1.310. No `skill.prompt` hook is registered:
under managed settings `cc-plugin-sec-default` passes over it and prints a notice that it was
skipped. A hooks module is a Claude Code mod, and 2.1.308 is the oldest version supported, so neither
skill has a shell snippet to locate the directory by hand.
[`hooks/voice.test.ts`](hooks/voice.test.ts) runs under `claude plugin test`.

## Skills

### `ghostwrite`

The drafting protocol and the correction loop it runs inside.

- Read the spec, then draft to its caps for the genre, imitating your corpus samples and the spec's
  contrast pairs rather than writing from a rule list. Most drafts should come in under the cap.
- Self-review, lint, then a fresh-context rewrite by a subagent given only the draft, the rules, and
  your spec's contrast pairs, since a draft's tells read as natural to the model that produced it.
  The lint is the `writing-conventions` plugin's, when that plugin is installed. The rewrite is
  skipped for a draft of up to about five sentences with no lint hits. A longer one is rewritten,
  then checked for dropped facts and linted again, because some tells survive a rewrite. Then the
  draft goes in the reply for your explicit go, with at most one line after it: a check that did not
  run, a question to settle before posting, or the part that runs over a cap because a fact you gave
  would not fit. Posting is left to you.
- Log the delta once, after you edit or give the go, never in the hand-over. A rule missing from
  the spec is added as a new entry. A rule that was in the spec and was broken anyway is recorded as
  a procedure failure, with no new rule. A rule general enough to bind every reply is routed to the
  always-on writing rules file your session loads, when one does (the `writing-conventions` plugin's
  `hooks/rules.md`, or your global `CLAUDE.md`); everything about the form and size of one genre
  stays in your spec.
- Bootstrap when you have no spec yet: an interview for hand-written samples, then a first spec
  derived from the samples, with the gaps stated rather than invented. A seed exported by
  `share-ghostwriting-spec` from someone else's spec replaces derivation from scratch.

### `share-ghostwriting-spec`

Exports your spec as an anonymized seed a teammate can bootstrap from. The per-genre form and
procedure are kept as house style; the delta log and corpus are left out; names, repos, URLs, and
quoted drafts are scrubbed; and the export is written to a file beside your spec for you to read
before it goes anywhere. A recipient runs the `ghostwrite` bootstrap with the seed, which keeps
your caps as a starting point and derives the voice rules from the recipient's samples.

## Measuring it

[`evals/`](evals/) is a `claude plugin eval` suite of one PR-body drafting task, one issue-body
task, and one README-section task. In each case `ghostwrite` is run against a fixture voice spec for
an invented maintainer, copied into the workspace by a scaffold script, and the reply is graded for
spaced dashes, banned words, and personified subjects. Two judge-model checks follow: the body kept
every fact it was given, and it fits the spec's limit for the genre. No length or format is given in
any prompt, so a form pass means the limit was read from the spec. The spec's location is in the
prompt for both runs, and the fixture spec has no Procedure section, so the two runs differ only by
the plugin's drafting procedure. Run it from the plugin directory:

```bash
claude plugin eval . --scaffold --runs 4 --judge-model sonnet --no-publish -j 4
```

No shell is granted in the cases and `writing-conventions` is not loaded, so the lint step in
`ghostwrite` does not run. Only the README section is longer than five sentences, so the subagent
rewrite runs only in that case, and a run of it with no subagent call fails a scored check. On a
single-turn prompt the default register is already clean, so every arm, including no plugin, passes
personification on nearly every run. Results are written under `evals/results/`, which is ignored.

`ghostwrite` hands over the body and at most one line after it. When process notes were added around
each body, most with a spaced em dash, the plugin scored 0.28 below no plugin.

In the latest run, on 2026-10-08 with four runs per case, the plugin scored 1.00 and no plugin 0.95.
Most of the gap was on the README-section case (+0.18), the PR body with a report constraint was
+0.04, and the issue body had no gap. A PR body case with spaced dashes and personified subjects in
its facts was removed that day, since every body passed every check with and without the plugin: the prohibitions in the
fixture spec are read in both runs.

## Works with `writing-conventions`

Neither plugin needs the other. `writing-conventions` loads the prohibitions in every session (no
personified subjects, no spaced em dashes, a banned-word list), and they apply to chat replies too.
This plugin is run on demand to draft in your voice. With both installed, the general rules
that come out of your edits are added to the file that is loaded in every session.
