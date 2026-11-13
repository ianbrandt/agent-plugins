---
name: ghostwrite
description: >-
  Draft text that ships under the user's name (issues, PRs, comments, commit
  messages, docs, code comments) in their voice, from a voice spec derived from
  their hand-written samples: read the spec, draft to its caps, self-review,
  and log the delta after the user edits. Derives the spec from samples when the
  user has none. Trigger on drafting or reviewing anything the user will post
  under their name, and on "log the delta" / "update my voice spec". NOT for
  text the assistant signs, and never for retro-editing already-published
  writing.
---

# Ghostwrite—draft in the user's voice

Only the method is in this skill: the voice is read from the user's data (§0). The user signs the
text, so the user reads your draft first and **posts it themselves.**

## 0. Locate the voice data—and detect the mode
**A `## Voice data, loaded by the plugin` section follows this skill's text.** The plugin's hooks
module located the voice directory as the skill loaded and did §1's reads: the spec, the corpus, and
the always-on rules file are in that section, each whole. Use them from there and read none of those
files again. A file the plugin could not read or find is listed there instead, for you to read.
`$VOICE` below is the directory on that section's `VOICE=` line: the plugin's `voice_dir` option,
then `$GHOSTWRITING_DIR`, then `~/.claude/ghostwriting`. `MODE=bootstrap` there means no spec.

- `$VOICE/voice-spec.md`—voice rules, per-genre form, delta log, procedure.
- `$VOICE/corpus/`—hand-written samples, one file per piece or genre.

Either path may be a symlink into a private repo. On Windows `~` is the user profile directory, and
a linked voice directory is a junction (`mklink /J`), or is set with `voice_dir` or
`GHOSTWRITING_DIR` instead. The voice data is never stored in this skill, in a
project repo, or in memory. No spec ⇒ **bootstrap** (§5).

**Always-on rules are kept elsewhere, split by when they load.** Prohibitions that must hold in chat
replies too—typography, formatting tells, banned vocabulary—are kept in an always-on rules file that
loads every session: the `writing-skills` plugin's `hooks/rules.md` when that plugin is
installed, or the user's global `CLAUDE.md` (`~/.claude/CLAUDE.md`) when they keep them there
instead. Check which of those loaded in this session, and follow a pointer rather than assuming a
file; `voice-spec.md` is the positive spec, read on demand. Both are maintained here (§4, §5). With
no always-on file at all, the prohibitions go in the spec too.

**The spec has no copy of a rule in the always-on file.** You add rules to that file from here, so a
rule general enough to bind every surface is routed there and deleted from the spec, not kept in
both. What stays in the spec is the user's register and their per-genre form. The two copies of
a duplicated rule get edited apart, and the weaker one is the one read at drafting time.

## 1. Read the spec before drafting
Read `voice-spec.md` end to end, delta log included, and read two or three corpus samples matching
the genre—as models to imitate, not background. Read each file whole, the rules file below
included: no `head`, no line limit. In a cut-off read the end of the file is lost, which is where
the delta log and the latest rules are.
Re-read the spec per session, even with a summary of it in context. No corpus, or no sample for the
genre ⇒ draft on the spec alone and record the gap in §4.

**Re-read the always-on rules file from §0 in the same pass**, even though it loaded at session
start: by drafting time that copy sits far back in the context, where it is weakly attended, and
most rule breaks happen deep in long sessions. Reading it again immediately before drafting puts
the prohibitions where they bind.

This also applies to **reviewing** a draft—carried over from an earlier session, written by another
agent, or by you hours ago. Before calling a draft ready, do the same reads.

## 2. Draft to the spec
Write to the spec's entry for the genre—its form and size. No entry ⇒ use the nearest neighbor
and record the gap in §4. **Most drafts should come in under the cap**: exceed one only
when the content does not fit under it, never for thoroughness. A fact the user gave always
qualifies: never drop a given fact to fit a cap. Keep the fact, and use the hand-over line (§3) to
say which part runs over. Everything else about the draft comes from the spec, not your defaults.

**Check the end of the body against the form, not only the opening.** When the genre's entry is
opening prose and then exhibits, as an issue entry usually is, every line after the first exhibit is
an exhibit too. A fact left over at the end, such as the version where the problem was seen, goes in
a one-fact bullet or in the opening sentences, never in a closing sentence of prose.

**Imitate, then check.** Draft by matching the corpus samples and the spec's **Contrast pairs**,
sentence rhythm included, and only then check the rule list for what imitation missed. The register
comes out closer when you write to match the user's sentences than when you write from prohibitions;
a draft written from the rule list alone drifts back to the default register.

## 3. Self-review, lint, rewrite, then hand it over
Check the draft against the spec rule by rule and fix what you broke **before** the user sees it; a
rule you broke and fixed yourself still goes to §4 as a procedure failure, recorded when §4 runs.

**Then run the lint over the draft.** With `writing-skills` installed, call its
`mcp__writing-skills__lint` tool with the draft as `text`. It returns one line per flagged
sentence and the review model's findings, each with a suggested rewrite, or `clean` for clean text.
Fix a real hit by hand, in place, and leave a false positive alone. Call it last on the draft
exactly as you hand it over: a draft with no clean result is reviewed again after the reply, and a
finding then costs a fix-up turn. With no such tool in the session, use the hand-over line to say
the lint did not run.

**For a short draft with no lint hits, skip the rewrite below and go straight to the hand-over.**
Short means up to about five sentences of prose, which covers most PR bodies, comments, and commit
messages; fenced exhibits do not count. On drafts that size the rewrite has returned the text word
for word, or swapped one inanimate-agency break for another, at over a minute and tens of thousands
of tokens per piece. A longer draft, or a short one the lint flagged, gets the rewrite.

Self-review is not enough for register tells in a longer draft: you re-read your own draft with the
same tendency that produced it, and its tells read as natural. A report of violations is not enough
either, since each fix comes from that same tendency, and rounds of find-and-fix rarely converge. So
before the first hand-over of such a piece, **have a fresh-context subagent rewrite it**. Give the
subagent nothing but the draft verbatim, the always-on rules file from §0 (or the spec's
prohibitions when there is none), the spec's **Contrast pairs** section verbatim, the spec's entry
for the genre verbatim, the corpus samples §1 read for the genre, the genre's cap, and this brief:

> Rewrite the draft so it breaks none of the rules and reads like the samples, imitating the
> right-hand side of each contrast pair. You may restructure it to the genre entry's form: the
> content of the opening sentence, and the order of prose and exhibits. Where a sample and the genre
> entry differ, follow the entry; the samples are older than some of its rules. For every sentence,
> find the subject and check its verb against the inanimate-agency rule; replace a noun that stands
> in for a thing as a metaphor with the thing's literal name; fix dashes and banned words. Keep
> every fact, number, name, link, code span, and fenced block as given, and add nothing. Stay inside
> the cap, unless that means dropping a fact; then keep the fact. Return only the rewritten text.

Pick a mid-tier model over the smallest: writing text without the tells is harder than spotting them
in given text. Then check the rewrite before you adopt it:

1. **Diff it against your draft for meaning.** Restore any fact the rewrite dropped or changed, and
   remove anything it added.
2. **Run the lint over it again**, because tells survive a rewrite. Fix a real hit by hand, in
   place, and don't send the text back for another rewrite round.
3. **Check it against the genre entry's form**, the opening and every line after the first
   exhibit. A rewrite that imitates an older sample can bring back a form that was dropped from
   the entry since.

Each rule break the rewrite or the lint fixed is a §4 procedure failure. Re-run the rewrite only
after substantive redrafting.

A rewrite you don't adopt still ran, so it is neither adopted nor skipped. Report it with the
reason in the hand-over line below, next to the drafts; saying so mid-turn is not enough.

Then hand it over: the body exactly as asked, and nothing else. At most one line may follow it, and
only to say that a check did not run or that you rejected the rewrite and why, to ask a question
that must be settled before posting, or to say which part runs over a cap (§2). The spec's
prohibitions apply to that line too. No rewrite notes, no draft history, no delta-log entries: those
go in §4. Then wait for an explicit go. A question about scope or wording is part of the review, and
is not the go.

## 4. Log the delta
**When the user says a draft reads as AI-written, or asks whether this procedure ran, answer that
first**, before any redraft: which steps ran, which you skipped or cut short, and which result you
overrode, such as a rejected rewrite. Then redraft. A silent redraft leaves the user unable to tell
a procedure failure from a missing rule.

§4 runs once per piece, after the user edits the draft or gives the go, and never inside the
hand-over. Diff their version against yours, add the rule breaks you fixed yourself in §3, and
**classify each change first**; the two failures take opposite fixes:

- **Missing rule**—the spec didn't cover it. Append a delta-log entry: date, the piece, what you
  wrote, what they changed it to, and the rule that generalizes. Say which entry it amends or
  supersedes.
- **Procedure failure**—the spec covered it and the draft broke it anyway. Record it as one; add
  **no** new rule.

Route each new rule by the §0 split: must hold in every response ⇒ the always-on file from §0;
genre form or size ⇒ `voice-spec.md`. When that always-on file ships from a plugin, the edit is a
plugin change: make it in the repo the plugin is published from, not the installed cache.
Installed sessions keep the old list until the plugin's next release, so tell the user the edit
takes effect after one. A delta-log entry for a change to a standing rule is promoted into the spec's
body, so that every standing rule is read there.

A failure that **recurs** is promoted a second time: into the spec's **Contrast pairs** section, as
the drafted sentence and the user's rewrite, verbatim. The pairs are what you imitate in §2. The
tendency that produced the draft reads the rule-breaking form as natural, so an example of the
idiomatic alternative prevents the next instance better than the generalized rule alone.

Log only what recurs or would recur, and don't paste diffs.

## 5. Bootstrap—derive a spec from samples
The one attended path: **ask (AskUserQuestion) about anything that isn't obvious** rather than
guessing. One-time setup; afterwards proceed from §1.

1. **Ask where the hand-written samples are** and which genres to cover. Samples must be the
   user's own unassisted writing.
2. **Collect them into `$VOICE/corpus/`** by copy or symlink. Never rewrite a sample.
3. **Extract observable regularities**, per genre: sentence length and structure, person and
   hedging, how evidence is presented, openings and closings, formatting habits (headings, bullets,
   emphasis, links), title style, and typical length. Sort each finding by the §0 split as you go.
4. **Write `voice-spec.md`** with five sections: **Voice** (cross-genre rules), **Per-genre form**
   (one entry per genre: what goes in, in what order, and what never appears), **Contrast pairs** (seeded with one before→after pair
   contrasting a default-register draft with the samples), **Delta log** (starts empty), and
   **Procedure** (§1–§4 in a line each, so the spec stands alone).
5. **Route the always-on rules** the samples imply: the step-3 prohibitions belong in the always-on
   file from §0, which already includes the typography and banned-vocabulary rules when it is the
   `writing-skills` file—add only what it lacks. With no always-on file, they go in the spec's
   prohibitions section. Show any edit and ask before making it, and where the file ships from a
   plugin, make the edit by the rule in §4.
6. **Say what you could not derive.** Write no entry for a genre with no sample—don't invent one.

A **seed spec**—a `share-ghostwriting-spec` export—replaces derivation from scratch: copy it in as
the starting `voice-spec.md`, keep its per-genre form, refit its Voice placeholder from the user's
samples (steps 1–3), and note in the delta log any seed rule the samples contradict.

A spec describes one writer, so don't blend samples from several writers.
