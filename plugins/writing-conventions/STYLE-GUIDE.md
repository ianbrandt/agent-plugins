# Writing conventions in full

This is the long form of [`hooks/rules.md`](hooks/rules.md), which is loaded into every session:
the reasoning behind each rule, and its edge cases. Sessions follow the short form and the gate
checks against it, so a rule is changed there first and explained here. Nothing loads this file.
It is read by whoever changes a rule or wants the reason for one.

Writing as the user, for text they sign and post, is covered by `ghostwrite` in the
`ghostwriting-skills` plugin when that plugin is installed. When to stop and hand a decision to the
user is covered by `ask-when-needed` in the `orchestration-skills` plugin.

Sections 1 to 7 cover writing to the user, and §8 is the long form of the prohibitions. All of it
applies to text a human reads. Agent-facing files, such as skills, hook payloads, and subagent
briefs, follow the prohibitions and skip the form rules, so they are formatted for whatever a model
reads best.

## 1. Assume the reader has read nothing since their last message

The user does not read the transcript. They read your last message, and they read it after a gap
during which they were doing something else.

- No back-references. Not "the fix above", not "as noted earlier", not "that file". Write out
  the file, the function, and the decision in full, every time, even when you wrote them out two
  messages ago.
- No term you coined mid-session. A label you invented to think with ("the guard path", "the
  cold branch") means nothing to someone who was not thinking alongside you. Replace it with the
  concrete thing it stands for.
- Lead with the outcome, then what is left. The reader cannot act on a chronology of what you
  tried.
- Write the point, do not leave it to be assembled. Correct facts in the right order still fail
  when the conclusion drawn from them stays in your head. "Most builds won't need a rule at all" is
  a bare fact; the point was that nothing has to be migrated to take the improvement up. Ask of
  each paragraph what the reader is meant to do with it, and write that sentence.
- Offer independent options independently. When a choice is drafted as a package, such as a reformat
  against disabling five rules, the reader cannot see that any subset is open. State the all and
  none cases too.
- Re-establish the subject at the top of a wrap-up. One clause stating the repo, branch, or
  feature costs nothing and rescues a reader who has three sessions open.
- A set the reader has not met takes the bare plural. "This PR corrects defects found in a
  review", not "the defects". A reader takes the definite article to mean a set they already know,
  and in the first sentence of a body there is none. The same holds in a title and a branch name.
- Write the thing, not a reference to it. In "Other than the intersection with the other option"
  only the topic is given, and the reader has to reconstruct the rest. Put the intersection itself
  in the sentence. A reference works only where the reader has already been given the thing.

## 2. Choose the altitude before writing the words

Write the amount of detail that lets the reader do the next thing, and no more.

- Show reasoning only where the reader could reasonably have chosen differently. Give a
  decision with one conventional answer one line stating what you did. Give a decision where you
  rejected a plausible alternative one sentence stating the alternative and the fact that ruled it
  out. When reasoning is shown for a call nobody would question, the calls that do need it are
  harder to find.
- Write a mechanism's name only when the reader will touch it, and otherwise describe the
  outcome.
  "Cached the fetch with `@lru_cache(maxsize=1000)`" when they may tune the size; "responses are
  cached now" when they will not. The reader has no use for the name of a mechanism in code they
  never open, and has to ask a second question when given only an outcome where they need the
  setting.
- Distinguish an explanation the reader asked for from prose defending an unchallenged choice.
  If the last user message asked "why" or "how", answer in full—that is the deliverable. If nobody
  questioned the choice and the paragraph exists to justify it, delete the paragraph. Defending a
  simplification in prose puts back the complexity that was cut.
- Hedge a judgment, state a measurement. Certainty is part of altitude. A verdict on intent, on
  someone else's report, or on anything you cannot see is hedged; a number you measured is
  stated flat, and hedging that understates evidence you have. A claim you could check gets checked
  before it gets hedged, because otherwise the reader has to do the checking.
- State an inferred cause, and hedge it. With two facts set side by side, the reader has to infer
  the link. "`node_repl` was enabled again in `~/.codex/config.toml` about an hour after I disabled
  it, with the ChatGPT app open" became "If I disable `node_repl`, it seems to be re-enabled in
  `~/.codex/config.toml` if I happen to open the ChatGPT macOS app."
- Put a number in the same sentence as the conclusion drawn from it, even when it is also in a
  table above: "The majority (~70%) of the builds in the corpus don't filter at all." Without the
  number, the reader has to go back to the table to check the claim.
- Give a count a reader can use. A diffstat is notation: "rewriting 33 files for +380/-209" drew
  "That's not going to mean anything to your average human", and "rewriting 33 files" is enough.
- Spell out whole numbers zero through nine in prose, and use numerals for 10 or greater: "five
  databases", "28 days". Numerals stay in measurements, percentages, versions, error codes, numbered
  sections, tables, and notation such as `65s`. A count beside a number of another kind is spelled
  out even above nine, as in the Microsoft guide's "fifteen 20-page articles". "(8 returned 404)"
  became "(eight returned 404)", since eight is a count and 404 is an error code. Rewrite a sentence
  that would start with a numeral: "8 of those returned 404." became a parenthetical on the sentence
  before. The same guide's rule that one numeral in a type makes the rest numerals is not used here,
  since "the other 37" and "eight" were written side by side by hand.
- Show a small change so that the difference is visible. "`version("3.18.2")` becomes
  `version ("3.18.2")`" drew "You showed the before and after as the same", since two inline code
  spans that differ by one space look identical. Use a form where the difference is visible, or
  describe the change in words.
- Match the altitude to the reader's next move. Someone reviewing a diff needs enough to
  disagree with it. Someone who asked for status needs the current state and the blocker. Writing
  review-grade detail into a status reply makes them hunt for the one sentence they wanted. When
  both a summary and the full account are worth having, write the summary and link the account.

## 3. Point at files instead of reproducing them

- When a report, note, or plan already lives in a file, link it and say what changed and why.
  Reproducing the body in chat spends the tokens twice and buries the point.
- Text the user has to approve is the exception, and goes in the reply itself. A draft they will
  post under their name, or any text written to get their go, gets pasted into a fenced
  block. Tool output is displayed to you, not reliably to them, so after a `cat`, a Read, or "I
  wrote it to `draft.md`" the user has seen nothing. Before writing that you showed a draft, find
  its block in your own response text; if it is not there, it was not shown.
- Link any file worth opening with an absolute path. Claude Code desktop does not reliably
  track which worktree a session is in, so a repo-relative href can resolve against the wrong tree
  and open nothing. This matters most when a session's notes and its code sit in different trees.
- Write the file's name and link it in the same breath. Never a bare filename, never an
  unlinked "wrote it to `notes/`". When files from two trees are cited in a reply, link both.
- In a fork, write an upstream issue in chat as a full Markdown link. A bare `#123` resolves against
  the fork and 404s where the fork has no such issue. In a commit message or PR body targeting
  upstream, a bare `#123` is correct.

## 4. Cut what the reader can already see

- Leave out local-verification boilerplate. "Full test suite passes (247 tests); the formatter
  is clean" adds nothing when CI reports pass/fail, and the rote all-green summary reads as an AI
  tell. A local result CI will not show—a manual repro, a benchmark number, a timing—is worth
  stating.
- Do not restate the diff, and do not summarize your own summary. If the code is in the reply or
  one click away in a linked file, a prose walkthrough duplicates it; a closing paragraph that
  repeats the opening one is filler.
- Leave out a doc's intro and outro. With "In this section we will" and a closing summary, the
  reader is handed what the headings and the body already include. Open on the fact.
- Check text already in the repo before reusing it. A claim copied from a doc, a comment, or an
  earlier draft gets checked the way one you wrote does, and the same fix is made in the source it
  came from when the edit lands. An approved draft goes stale the same way: where later work in the
  session changes the fact, re-check the draft against what was found after it, not only against
  these rules.
- Say a fact once. A mechanism and the consequence that follows from it are one fact, so a
  closing sentence explaining why the mechanism led to the result goes; the reader accepted the
  point a sentence ago. A justification clause for a reason already given is the same failure, and
  it is where an epigram is most often written.

- Err short, and let the reader ask. The two failures cost different amounts. A draft that
  leaves something out costs the reader one sentence asking for it; a draft that over-explains costs
  them a read, a judgment, and a correction round, every time. So where the choice is close, cut.
- An unneeded paragraph is paid for three times: in the tokens spent writing it, in the reader's
  attention, and in the correction round where they ask for it to be cut. The first is paid on every
  draft, whether or not anyone pushes back. Where an agent writes most of the comments, commit
  messages, issues, and PR bodies in a repo, the second is the limit that matters: the reader's
  limit is how much of it they can follow well enough to review, and every unneeded paragraph uses
  part of it. Short is the norm here for those reasons, not as a preference.
- Keep every fact the reader needs, and cut the rest. A true sentence still goes when nothing
  the reader does next depends on it. An aside on release status is the common case: that a change
  is not in a release yet, or that nothing released is affected, is accurate, and a reviewer of the
  change acts the same without it. Keep it only where it changes what the reader does, such as a
  migration they would otherwise plan for.
- Short is relative to the change. A one-sentence body on a large, complex PR fails this rule
  as surely as a twenty-sentence body on a small one. The test is whether a reviewer could act on
  it without asking, not a sentence count, and a genre's usual size is where most pieces land
  rather than a limit any piece has to hit.
- A heading in a short genre usually means the text is too long. A Markdown heading or a bulleted
  list in a short commit message, issue, or PR body usually means the text is too long for its
  genre. Cut it to the genre's usual size, and structure only what is left: a complex change may
  use headings and lists, since twenty paragraphs do read better under headings and more than a few
  parallel items do read better as bullets. A bullet changelog that repeats the diff is cut at any
  length. A target's issue or PR template is followed, headings included, even on a tracker the
  gate cannot read, such as YouTrack. The gate judges whether a body is long enough for its
  headings, and allows a heading in a release note and the list of squashed commits in a
  squash-merge message.

## 5. Close a turn with a status sign-off, not a report

At the end of a significant task, a few lines: what is left, stated plainly ("nothing apparent"
counts), and where to do it—this session or a fresh one, with a one-line reason. Where the
wrap-up contents are defined in the user's global instructions, follow those for what goes in it and
this section for how it reads. Keep it short enough that the reader takes it in at a glance.

Open items and next steps are a bulleted list of specific instructions, never prose. Prose makes
the reader extract the actions themselves, and an action buried mid-paragraph reads as commentary
rather than as something to do. Separate what needs their decision from what happens next, order the
next steps, and write each one so it can be acted on without rereading: the action, where it
happens, and what it waits on. A command goes in the item rather than being described. Prose is
still right for the reasoning behind a decision; it is wrong for the list of what to do.

When one command does the work, give the command first. Listing the mechanics behind it (rebase
this, resolve that conflict, then merge) is worse than the single line that runs it: it reads as
work the reader has to do by hand, and it restates what the command already does, which the command
would do differently anyway. Give the invocation, where to run it from, and any precondition the
command cannot check for itself. A skill invocation counts as a command. Spell out mechanics only
where the reader has to perform them, or where a step falls outside what the command covers.

Anything the reader will run goes in its own fenced block, never inline. Inline code cannot be
copied in one gesture; a fenced block has a copy control on the desktop surface, which is the reason
to quote it. This covers shell commands, slash commands, skill invocations, and launch prompts for a
fresh session. Two forms, and the distinction matters:

- A shell command goes in a `bash`-tagged block, one command per block, no leading `$`, and no
  output interleaved inside the fence.
- A prompt goes in a plain untagged block, because it is typed to an agent rather than to a
  shell. Tagging it `bash` mislabels it and can attach a run control to something that is not a
  command.

Inline code stays right for a file, a flag, a function, or a command that is being discussed rather
than handed over to run.

## 6. Catch the jargon you coined this session

The banned-word list in `hooks/rules.md` has the known offenders, and the rule is wider than the
list. The larger risk is vocabulary you invented an hour ago and no longer hear as invented.

Before sending, scan your reply for any noun phrase that is not one of: a name in the codebase, a
standard term of the craft, or a plain English word. Anything left is a term you minted. Either
replace it with the concrete thing, or define it in the same sentence on first use. Replacing is
usually the better of the two, since a term that has to be defined is rarely needed.

The same scan catches abstraction drift: in a sentence about "the approach" or "the mechanism" where
the concrete noun would fit, the reader cannot tell what the sentence is about.

Take the target document's noun, and none of its phrasing. Grep the file you are editing for
how a concept is named there and use that word, so the edit reads as part of the file. Constructions
are the opposite case: the plainer phrasing wins even in a file full of the other one, and an
inherited construction gets fixed where it came from rather than copied forward into new text.

Scan sentence form too, not only vocabulary. An epigram—a line that would work as a slide title—and
a rhetorical antithesis ("they chose to skip it; we chose to fix it") are tells at the sentence
level, and a word check finds neither. Rewrite each as the plain fact it stands for. Two unrelated
facts in two matched clauses joined by "and" are a third: give the sentence one predicate.

One idea per sentence, 10 to 20 words. A sentence with two subordinate clauses gets split. First
drafts land at 30 to 40 words, which is the usual reason a paragraph reads as written by a model, so
the count is worth checking on a paragraph that reads heavy.

Count two-part sentences across a piece. A "fact, so consequence" sentence is fine on its own, and
people write them too. The defect is how many there are: 14 of them in three commit messages and a
PR body read as AI-generated, though none was wrong alone. Make each extra consequence its own
sentence or a subordinate clause, and leave a sentence the user wrote alone. "A jar is then read as
an automatic module named after the file, where javac keeps it in the unnamed module" became "A jar
is then read as an automatic module named after the file. javac keeps that jar in the unnamed module
instead." This is separate from matched clauses (§8), which are two unrelated facts in one sentence.

Write an effect that has not happened yet in the future tense, and introduce the event it waits on
with "after". "The declaration is shown as a badge on the Plugin Portal from the next release" was
hard to follow, since the present tense reads as already true. It became "The declaration will be
shown as a badge on the Plugin Portal after the next release."

Use emphasis rarely. This covers `**bold**`, `*italic*`, and `_italic_` alike. A list of
findings takes none, and a fact placed first needs no marking. Two reasons to keep it rare in prose:
none of it survives where the text is read plain, in a terminal, a commit message, or a log, and in
rendered text it is overused to the point of reading as a tell. The bar is something that strongly
warrants being called out, which is a few times a document rather than a few times a paragraph.
Below that bar, reaching for it means the phrasing needs work, since the word that matters can go at
the front of the sentence instead. Heavy bold stays right in an agent-facing file, where it shows a
model what it must not skip, which is where the form rules stop.

Personification is the third, and the easiest to miss, since every word in the sentence can be
plain. Check each subject against its verb: if a person doing that verb would be speaking, wanting,
perceiving, or possessing, and the subject is a thing, rewrite it. The rule and the repair are in
`hooks/rules.md`. Run this one on chat replies too, not only on published prose.

Scan again after reordering. After moving a paragraph or a sentence, run the whole scan again
from the top rather than over the moved part: a pronoun that sat next to its noun when the sentence
was written is now several nouns away from it, and a clause added during the move has never been
read at all. One epigram was added that way to a draft the user had already approved, and after an
insertion just ahead of it a "Those are" referred to the wrong sentence.

## 7. Log a word the user flags

Check before conceding. When the user calls a word AI-generated, grep the target document for it
and answer with what you find, rather than swapping it out on the spot. A flagged word that
survives that check usually means the defect is one line down, in the construction rather than in
the word.

When the user calls something jargon, or rewrites a phrase of yours into plainer English, add it to
the Vocabulary rule in this plugin's `hooks/rules.md`. Log the rule, not the instance: the word
plus the plain alternative that replaces it, one line, in the same form as the entries already
there. Do not paste diffs, and do not log a word you used once and caught yourself on.

That file is the live list, so the edit is a plugin change, made in the marketplace repo the plugin
ships from—the copy an installed session runs is a version-keyed cache, and editing it is lost on
the next update. An installed plugin picks the new word up only after the plugin's next release,
so apply the correction from memory for the rest of the session rather than waiting for it.

## 8. The prohibitions, in full

Each of these is stated in the always-on file in a line and a pair. This is the reasoning and the edge
cases, kept here so the always-on file stays short enough to be read every turn.

### Scope

These rules govern text a human reads: chat replies, summaries, and anything published under the
user's name. Files written for agents to read—skills, hook payloads, subagent briefs—are partly
exempt, by kind of rule:

- Prohibitions bind everywhere, agent-facing files included: the banned vocabulary below, no
  inanimate agency, no epigrams, unspaced em dashes. These are precision rules rather than register
  choices, and "the report includes X" reads more clearly than "the report says X" for a model too.
- Form rules—bold, redundancy, register, length, and the whole "Write for the reader" section—do
  not bind agent-facing files. Heavy bold shows a model what it must not skip, a critical rule
  restated in two places survives a truncated read, and those files are written in an imperative
  rule-stating voice rather than the user's own. Format them for whatever a model reads best.

### Register

Write plain North-American engineering English. If a plain word exists, use it; write the concrete
thing instead of abstracting it. Banned in chat replies, not only in published prose:

- "load-bearing"—say "critical", "the thing X depends on", or say which dependency.
- "vacuous"/"vacuously"/"non-vacuous"—state the condition instead: "trivially true because the list
  is empty", "the check never fires here", "the test would still pass if the logic were deleted".
- "shape", as a noun for a design or a structure—say "pattern" or "approach", or rewrite the
  clause around the plain noun that fits.
- "owed"—state the obligation: "what the verifier has to check", "what the fix still needs".
- "slot", as a noun for a field or a place a value is stored—say "field", or write the member's
  name. A timetable slot is the literal sense; a "configured slot" is not idiomatic, and "a slot of
  its own" personifies on top of it.
- "channel", as a noun for a configuration or delivery mechanism—say "way", "approach", or write the
  thing itself ("system properties", "the command line"). A message channel or a byte channel is
  the literal sense and is fine; a "configuration channel" is not idiomatic software engineering.
- Coinages built by bolting a prefix onto a verb ("deleak", "de-risk", "unblock" as a noun). If the
  word isn't already English, say what happens: "remove the coupling", "cut the risk".
- Intensifiers—drop them: "Gradle's own" is "Gradle's". The claim is the same with the bare noun or
  verb, and the intensifier reads as the writer leaning on it.
- A deferential frame around a question ("worth your ruling", "I'd defer to you on", "your call").
  An open question takes a question mark and stands on its own. With the frame the ask reads as
  narration, in a courtier's voice. Offering to do the work is a different act and is not covered
  here: "I could restore binary compatibility in a v0.58.1" is a statement of a capability, and the
  reader can decline it without a round trip.

- A judgment stood in for a mechanism's name—"nag" for a deprecation warning, "noise" for a
  report's output. Print the mechanism's name and let the reader judge it. This one binds a local
  note as much as posted text, since the wording in a note is what gets copied into a draft.

The live list is rule 3 of `hooks/rules.md`, where a word the user flags is added. It is added
here too only when it needs an edge case explained. Every entry is one example of a
class: "heap floor" for a minimum heap and "bucket" for a configuration are the same coinage failure
as "shape" for a design, and none of the three is fixed by a synonym. Rewrite the clause around the
plain thing instead, since a swapped word usually leaves the coined idea in place.

"Name" as a verb is uncommon, so it reads as AI writing in most places. Say "declare", "print",
"report", "list", "state", or "spell out": "print the file in the warning", not "name the file in
the warning". This is not a ban, unlike the list above—it is the right word often enough to keep,
and the literal senses are untouched (a `name` field, naming a variable, a branch name). "Named" as
an abstract act is already ruled out in the inanimate-agency paragraph below, but that paragraph is
easy to read as covering only an inanimate subject, and not an imperative ("Fix: name every
cause…").

No inanimate agency. An inanimate subject does not take a verb of speech, volition, perception,
or possession. A report, an entry, a row, a project, a version, a build, or a PR does not say, tell,
name, offer, get, take, want, know, decide, carry, hold, withhold, produce, share, or join anything.
A build, a build script, or a project also does not configure, set, enable, or turn on anything:
those are the author's acts, and the build is what gets configured rather than what configures. Write
"what is configured in the build", never "what the build configured". The prohibition is not limited
to verbs: `whose`, and any noun granting an inanimate thing a role or an entitlement, personify it
the same way. "the system property, whose place is in the middle" attributes a place to it; write
"the system property is read between them" instead.
Grammatically it is personification: the subject is given an agent role the verb reserves for
something animate, and it is a recognizable AI-writing tell. Rewrite around what happens, and prefer
the literal act—printed, shown, included, left out—over an abstract one like "named" or "marked".
The personification can also remain in a passive: a build that "is shown" newer versions perceives
them as surely as one that sees them. Write "newer pre-releases are still reported when the current
version is itself a pre-release". Going passive is only half the fix for the other reason too, since
an abstract passive is no longer personified but is hard to follow: say who the real actor is where
there is one, and write a condition as an if/then sentence rather than compressing it into a noun
phrase. A passive that clears both of those tests can still fail a third: it has to be a phrase a
person would say on one read. "a module is held to the version its platform fixes" is not, and the
repair rebuilds the sentence around the observable effect: "versions outside a platform's
constraints are no longer reported". It binds everywhere text leaves this machine: chat, published
prose, repo docs, code comments, commit messages, test names, and product output strings. Matching a
document already full of the construction is not a defence for new text.

No epigrams, no rhetorical antithesis. A sentence that would work as a slide title gets
rewritten as the plain fact it stands for. The two forms are the X-is-not-Y aphorism and the paired
contrast ("they chose to skip it; we chose to fix it"). The pull is strongest in a document about
rules, where an aphorism reads as authority.

No matched clauses for unrelated facts. Two facts that have nothing to do with each other,
written as two clauses of the same grammar and about the same length and joined by "and", read as
composed rather than said. The figure is isocolon, and with two members a bicolon. A commit message
drafted as "A chain of four or more calls is no longer forced onto multiple lines, and a class with
one constructor parameter stays on one line" was flagged as AI-written for the construction alone,
since every word in it is plain. The repair is one sentence with one predicate that covers both
facts: "Two defaults are changed in `.editorconfig` so that call chains and one-parameter class
signatures that fit on one line stay there." Splitting at the "and" does not repair it, because two
sentences of the same build side by side are the same figure. An ordinary compound sentence is not
this: a cause and its effect, a change and its result, or two facts about one subject belong
together, and their clauses rarely match. The lint cannot flag it, since whether two facts are
related is not visible to a pattern, so scan for it by eye. It is checked at the gate.

Every pronoun resolves. Each "it", "this", and "that" points at one named thing the reader can
find in the same paragraph, and a bare "this" opening a sentence usually stands in for a whole
preceding idea rather than a noun. Use the concrete noun, or "this PR" when there is none. This is
the no-back-references rule of §1 at sentence scale, and it is the one most often broken in a long
draft: six logged corrections on one voice spec were breaks of it. One case is outside the rule: a
claim can be true of the code and false of the output, so check a resolved claim against what the
reader will see, not only against the implementation.

A reversal takes "but". A clause that reverses the one before it is joined with "but", never
"and": "the task settings are inherited within a build, but none of them are applied to an included
build". "And" reads as continuation, so the reader is past the turn before noticing it was one.

Prefer a finite coordinated clause over a trailing participle, even at a couple more words:
"and was closed as not planned", not ", closed as not planned". The participial tail reads as
compressed next to the finite clause, which reads at speaking pace.

Em dashes take no spaces—`word—word`, or restructure with a comma, colon, semicolon, or
period. The spaced form is a recognizable AI-writing tell and nonstandard US typography. It binds
everywhere text leaves this machine: chat, published prose, repo docs, code comments, and product
output strings. A markdown heading is not an exception—write `## Title—subtitle`, never
`## Title — subtitle`. A heading reads as formatting rather than prose, which is why this is where
the spaced form survives longest; every spaced dash in one recent measured reply sat in a heading.
Spaced dashes already in a file are not a reason to add more. Sweep for the spaced form before
posting and before committing. One exception: never retro-edit an already-published post to fix
them—that churn is a signal of AI authorship. Repo content is fair game to sweep whole.

A list of three or more takes the Oxford comma: "json, xml, html, and plain", never "json, xml,
html and plain". The same holds before a final "or". It binds on every surface, including log
messages and code comments, where a terse list is most often written without it.

Units stay consistent and idiomatic across a piece. Pick one form for a quantity and keep it
in prose and in exhibits alike: `1m5s` beside `65s` in the same set of timings makes the reader
convert between them to compare two rows. The idiomatic form for the magnitude is the one to pick,
so seconds below a minute and minutes-and-seconds above one.

The user's private circumstances never enter a public artifact. Their employer, team, clients,
unreleased work, or plans for any of them stay out of repo docs, commit messages, issues, and PRs,
even when the work is motivated by them. State the need the artifact is for, never the private
situation behind it.
