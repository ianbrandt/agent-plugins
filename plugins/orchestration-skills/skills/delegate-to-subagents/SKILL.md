---
name: delegate-to-subagents
description: >-
  Hand a unit of work to another agent without losing control of it: what is worth
  delegating at all, what every brief must include verbatim, how to bound a read-heavy
  fan-out, which agents need worktree isolation and which are broken by it, how to
  integrate parallel worktree diffs into atomic commits, and how to tell a finished stage
  from one that merely stopped talking. Trigger before launching a subagent, an Agent
  fan-out, or a Workflow stage, when a delegated stage returns something you are about to
  build on, and when two agents disagree. NOT for choosing which model or effort level a
  stage runs at (that's tier-model-and-effort), and NOT for the extra verification pass
  transform logic needs (that's verify-adversarially).
---

# Delegate to subagents—brief it, bound it, then check what came back

The main loop orchestrates. This skill covers everything from deciding a unit is worth handing
off to deciding the result is worth trusting.

## 1. Delegate the units that pay for the overhead

Every subagent costs a brief, a digest, and a re-read of context it does not share with you. That
overhead nets out only on work that is:

- **Substantial**—a meaty, self-contained unit, never a one-liner or a single edit.
- **Well-specified**—you can write down what done looks like before it starts.
- **Objectively verifiable**—a test suite, a compile, a count. Test-driven work is the ideal case:
  the tests are the oracle, so the delegate can tell for itself whether it succeeded.

Keep in the main loop: emergent work, fuzzy work, anything where the definition of done is what
you are still discovering.

**Verification is part of what a delegation costs.** A delegated diff stays unreviewed until you
review it, so do not launch a stage you cannot afford to check. Weigh it against the context you
have left, not against the context the launch consumes. In one session an implementation agent went
out in the same turn where the orchestrator acknowledged the session was nearly out of room; its
diff reached the next session uncommitted, never read line by line, with the binary-compatibility
gate unrun. Hand the whole unit to a fresh session instead. That costs a re-read and arrives with
someone able to check the result.

Delegate outward regardless of size: **bulky reads**. A search agent that reads twenty files and
returns a conclusion keeps twenty files out of your context, which matters most when the
orchestrator is the one holding the long-running plan.

## 2. Announce before, summarize after

State each delegation and its rationale **before** launching it, and summarize what came back.

Subagent output returns to you, not to the user's transcript. The user never sees work you do not
summarize. A fan-out of five agents that produces one line of "done" is five agents'
worth of findings thrown away.

## 3. Write the brief as if it inherits nothing

A delegate does not apply your conventions by reading that conventions exist. Put in **every**
brief, verbatim:

- The **scope**: what to change and what not to touch.
- The **style rules** that apply to the files it will write.
- The **prohibitions**: for a parallel-worktree agent, no `commit`, no `merge`, no `push`, and no
  edits to shared docs—the orchestrator reconciles those once, at the end.
- The **reporting contract**: a stage that ends without a structured report is treated as failed,
  **and its findings are written to a file under the scratchpad as well as returned**.
- The **tools it holds** for the wall this particular task might hit. A delegate that does not know
  it can drive a browser reports a Cloudflare 403 as a dead end.

**Give a mechanical delegate the shell access its task needs.** In one set of runs, a delegate that
was denied a one-line `perl -pi` rewrite edited 14 files one at a time instead, at about 3.5 times
the wall time and 5 times the output tokens. At Low effort it did not retry its denied test command
in a simpler form, so the check never ran.

**End a search or mechanical brief with this sentence**, from Anthropic's Claude Code team: "Time
matters here: do not spend time that can be avoided, and the earlier a correct result is obtained,
the better." In three runs per arm, a search subagent finished in a median 10s instead of 17s and
with the same answer. Leave it out of an adversarial verify brief: the verifier was 10% faster but
missed a number-literal defect in 2 runs of 3, against 1 of 3 without it.

Reading global conventions is not the same as applying them. The verbatim copy is the cheap half
of this rule, and the check in section 6 catches what the copy misses.

The file-drop half of the reporting contract is what makes the return text survivable. In one
session the two agents whose briefs required findings on disk both returned cleanly; the third was
asked only for a return value, and that agent wrote its code, finished `clean build`, went silent,
and was killed twenty minutes in having reported nothing. Its result—457 tests, 67 failures—was
recovered by reading the worktree's build reports directly. Only the on-disk copy made that
possible; nothing else recorded what the agent had found.

**Put the findings file's name in the brief, and keep it off four names.** Claude Code refuses a
subagent's Write to a file named `findings.md`, `report.md`, `summary.md`, or `analysis.md`, in
any case, with "Subagents should return findings as text, not write report files". The agent then
returns the text only, and nothing is on disk if it later goes silent. Only the file name is
checked: in a 2026-10-20 probe, `R12-findings.md`, `findings.txt`, and `notes.md` were all written,
in the scratchpad and in `notes.local/`, and a write through Bash was never refused.

## 4. Bound a read-heavy fan-out

Cap each subset agent at roughly **10 files, read once**. An over-scoped census agent overruns its
context, dies, and retries from scratch—one burned about **800k tokens over 4 retries**, against
about **150k** for each of its bounded siblings on the same job.

A `parallel()` call is a barrier: the stage runs only as long as its slowest agent, so one stuck
agent blocks everything behind it. Recovery is cheap—stop, re-scope that stage, resume. Identical
prompts hit the cache, so re-running the surrounding stages costs almost nothing.

## 5. Isolation: pick it per agent, not per fan-out

`isolation: 'worktree'` branches the agent from the **primary checkout's HEAD**—usually the default
branch—**not** from your feature-branch worktree. It cannot see uncommitted or unmerged work.

| Agent's job | Isolation | Why |
|---|---|---|
| Verifier, live probe, anything measuring branch state | none | It must see the feature branch. An isolated verifier may be testing the default branch and reporting a green that means nothing. |
| Parallel writer touching files another writer touches | worktree | Non-isolated writers see each other's half-done state, fail each other's suites even on disjoint files, and burn tokens chasing phantom pre-existing corruption. |
| Two or more adversarial verifiers | serial, or one scratch copy each | See below. |

**A verifier doing its job is a writer.** An adversarial verifier worth its cost writes scratch
probes and mutates the code under test, to prove a check actually distinguishes the branch it
is meant to select. Two verifiers fanned out with `parallel()` into one worktree means one agent
is mutating the logic the other is measuring: a false-result generator. In one run, two verifiers each reported the
other's probe files as findings while the rule under test was being mutated mid-measurement. Run
verify agents serially, or give each its own scratch copy. Do **not** reach for
`isolation: 'worktree'` as the fix—that puts them on the wrong branch instead.

To verify feature-branch code with an isolated agent at all, merge to the isolated agents' base
first. Always check which commit an isolated agent branched from. A wrong-base pass is not always
worthless: it can surface a bug in the base that your change fixes, and hand you adversarial
fixtures for free.

## 6. A stage that stopped talking did not finish

The failure looks like a holding message—"Pausing here until the build finishes"—with no status, no
files listed, and no red-then-green. It reads as merely truncated, so the diff sitting on the branch
gets treated as reviewed. Nobody has read it.

State in every brief that a stage ending without a structured report is treated as failed. Saying so
is **not sufficient**: in one run two stages ended on holding messages, the second against a brief
that included that prohibition verbatim, and both unreported diffs shipped a silent defect. One
built a detached configuration that emptied the facts a report depended on while every test stayed
green; the other swapped two constructor arguments, flipping report rows from outdated to
up-to-date. Both were one-liners a reader would have waved through, so check with
a **probe**, not by reading the diff.

**Noticing that a stage stopped is your job, not the user's.** A background agent that hangs or dies
sends no notification, so nothing arrives to tell you. Check liveness before reporting on a run, and
read it off evidence rather than off the task chips: completed agents keep their chips, which once
made three chips look like three live agents when only one was still running. What to look at is the
agent transcript's mtime, whether its work is on disk in the worktree, and whether any build process
is actually using CPU. An agent whose build finished ten minutes ago and has written nothing since
has stopped, whatever its chip shows.

## 7. Verify the fix stage specifically

Fix stages run after the reviewers, so their diffs are the one part of the pipeline nobody reviewed.

- Confirm the fix actually reached its target, in the tree you care about.
- Run live probes on correctness-critical logic against compiled classes, not against the diff.
- For a soundness-critical unit, write the missing regression test **yourself** and watch it go red
  then green. A test the fix stage wrote and reported as passing proves nothing about the fix.

Reviewers should run live probes too, not only read the diff.

## 8. Arbitrate disagreement by spot-check, not by rank

When a delegate contradicts you, do not ship your version on authority. Sample its claims against
the source.

The delegate read deeper on its narrow slice and is usually right. In one roadmap pass the
orchestrator was wrong on **all four** disagreements; a seven-claim spot-check against the source
settled it in a few minutes.

**That deference does not extend to what a delegate reports as impossible.** "I could not
reach it" describes one agent's attempt with the tools it believed it had. It is not a finding about
the world, and passing it along as one hands the user a dead end that is not there. A corpus agent
reported `mvnrepository.com/popular` as 403 behind Cloudflare "to both curl and WebFetch"; that
reached the user unchallenged, and the page then loaded in a browser on the first try. Probe a
reported blocker yourself before repeating it, especially when you hold a tool the delegate was
never told about.

## 9. Integrating parallel worktrees

- Pull each worktree's work in through a patch file: `git -C <worktree> diff --output=<patch file>`,
  then `git apply <patch file>`. Give the patch file as an absolute path outside both checkouts,
  since `-C` puts a relative one in the worktree. A pipe between the two is not safe in every
  shell, since Windows PowerShell 5.1 re-encodes the text that goes through one.
- **Strip agent artifacts before committing**: think-aloud comments, progress banners, test names
  that do not match what the test does.
- Reconcile shared docs once, yourself, since no delegate was allowed to touch them.
- Commit serially and atomically. A diff spanning several features gets hunk-split so each commit is
  one logical change and can be reverted on its own.
