---
name: ask-when-needed
description: >-
  Decide almost everything without the user, and stop only for the small set of decisions
  that are hard to reverse: a wire contract or public API, a data schema or file format, a
  permanent name (branch, PR title, issue title, release tag, published URL), text
  publishing under the user's name, a push to a public repository, a precedent later work
  will copy, or a destructive step with no undo. Offer 2-4 real tradeoff options via
  AskUserQuestion, recommended option first. Trigger before any such call, and when a
  subagent or an unattended run hits one and
  must escalate with no user present to answer. NOT for routine judgment calls, anything the
  code, tests, or git log can answer, "should I proceed?" after the user already said what
  to do, or progress reports—deciding those without asking is the point of this skill, not
  an exception to it.
---

# Ask when needed—stop only for the calls the user can't undo

A small number of decisions are worth an interruption; everything else, decide yourself and
move on.

## 1. Stop when the decision is hard to reverse

The test is whether the decision can be undone cheaply, not how hard or how important it is.
Solve a hard problem with a cheap revert without asking. Stop for an easy call that later
work will copy.

- A **contract**: a wire format, a public API, a data schema, a file format, a CLI flag name.
- A **permanent name**: a branch, a PR title, an issue title, a release tag, a published URL.
- **Text publishing under the user's name**: an issue, PR, comment, review, or release note.
- **A push to a public repository**: the commits, their messages, and the branch name all become
  public and permanent. A later force-push does not unpublish what was already fetched, forked, or
  indexed. Merging into a local branch can be undone cheaply, but the push publishes, so
  hold it and present the unpushed range instead. A private repo is exempt, since a
  push there can still be undone.
- A **precedent**: a call later work will build on and copy, so changing it later means
  changing everything downstream too.
- A **destructive step**: deleting, overwriting, or force-pushing over something with no undo.

Stop *before* the work that depends on the answer, not after. Do everything that does not
depend on it first, so the question costs one decision, not a rebuild.

## 2. Do not stop for anything else

Interruptions the user did not need make them read the next one less carefully. Decide these
yourself and state the assumption in one line:

- Routine judgment calls with a conventional default.
- Anything the code, the tests, or `git log` can answer—go read it instead of asking.
- "Should I proceed?" after the user already said what to do. Approval of a plan covers its
  steps.
- Progress reports, and questions whose answer does not change what you build next.

If both readings lead to the same work, there is no question—pick one and move on.

## 3. Present the choice as a real tradeoff

Use `AskUserQuestion`. Two to four options, each with **what you get** and **what it
costs**. An option with no downside listed usually means the downside was never looked for.

- Put the recommended option first and mark it `(Recommended)`.
- Write each description as `Pro: … Con: …`, or as one sentence of each.
- Be specific about costs: "adds a plugin to version and maintain" beats "some overhead".
- Use `preview` when options differ in something visual—a file layout, a config block, two
  candidate wordings side by side.
- Ask at most two questions at once. A third usually means you are asking about things you
  should decide yourself.

How an option's wording reads—plain language, no jargon coined mid-session—is governed by
the always-on rules of the `writing-skills` plugin, not by this one.

## 4. Escalating with no user present

Two cases, and they take different fixes:

- **A subagent.** There is no one to ask, so settling the decision silently just picks an
  answer nobody reviewed. Put the decision and its options in the result instead—the agent
  reading the report is the one positioned to stop and ask.
- **An unattended or queued run.** Send a `PushNotification` alongside the question. Lead
  with the decision, not "input needed"—the person checking their phone should be able to
  act on the notification without opening the transcript. It suppresses itself when the user
  is at the terminal, so it cannot spam a session they are actively watching.

## 5. Read the answer as given

An answer that redirects, refuses the framing, or asks for a different format is still a
real answer. Follow it as given; do not re-ask the same question worded differently hoping
for the original menu.

A user who reaffirms a request after you raised a concern has decided—proceed with the full
request, do not raise the same concern again. Approval of one posting does not carry forward
to the next one: a new posting is a new decision under section 1.
