---
name: verify-adversarially
description: >-
  Run one independent pass whose only job is to construct an input that makes
  correctness-critical transform logic produce silently wrong or silently skipped output:
  position-preserving text rewriters, AST rewriters, name re-keying, anything that fails by
  succeeding quietly with corrupted state. Includes the known blind spots to probe (prefix
  hijacks, masked pre-checks, dual-used helpers), the rule that each hypothesis is settled
  by a live probe rather than a code trace, the generated sweep for a screen that must agree
  with a compiler, and the requirement that every confirmed finding becomes a regression test. Trigger after implement-review-fix on transform or rewrite
  logic, and whenever a green suite is the only evidence that such logic is correct. NOT for
  ordinary code review, and NOT for how to launch or isolate the agent that runs it (that's
  delegate-to-subagents).
---

# Verify adversarially—a green suite is not evidence for this kind of code

For correctness-critical transform and rewrite logic, a green suite plus a standard review is
**necessary but not sufficient**. Silently wrong logic never throws. It succeeds, quietly, with
corrupted state. Such a bug ships with the suite "all green".

## 1. When this pass is required

Logic whose failure mode is silence:

- Position-preserving text rewriters.
- AST rewriters.
- Name re-keying and any mapping rebuild.
- Anything that transforms a structure and returns a structure of the same type.

For that logic, after **implement → review → fix**, run one **independent adversarial verifier**
whose sole job is constructing an input that produces silently wrong or silently skipped output.
Not "review this again". The verifier's deliverable is a failing input, or a documented failure to
find one.

## 2. The known blind spots

Probe these first. Each one has shipped past a green suite and a human review:

- **Prefix hijack**—a renamed entity captures a longer key it does not own, because the match was on
  a prefix.
- **Masked pre-check**—a reachable sibling path bypasses a guard the design assumed was universal.
- **Dual-used helper**—one list, lambda, or table feeding two consumers, when a newly added term is
  valid for only one of them. Whenever you extend a seam, check **every existing consumer** of it,
  not just the one you were working on.

## 3. Settle each hypothesis with a live probe

A code trace produces a plausible story but no result, so run a probe.

- Write a temporary test against the real code wherever it is feasible, and run it.
- Probe against compiled classes, not against the diff.
- **Stub `git`, `gh`, and `glab` on the PATH before the first real-shell probe of a command
  reader.** A probe that runs the command the reader screens runs it for real. One verify pass ran
  the real `gh pr merge 3` before its `gh` stub existed, and it merged nothing only because the
  scratch directory had no remote. A stub that prints its arguments and working directory is enough.
- **Report a refuted probe as refuted, not dropped.** A hypothesis you raised and silently stopped
  mentioning reads to everyone downstream as a hypothesis you confirmed. The refutation is a finding.

This is the same rule that governs rejected design alternatives: every approach ruled out by
reasoning alone is an untested hypothesis. One rejected fix rested on a claim about which
repositories a build object exposes; the claim was false, a single probe would have shown it, and
the branch built on it solved a different problem than the one reported. Probe the one fact that
discriminates each rejected option, before writing the fix.

## 4. A screen that must agree with a compiler: list the forms, then sweep

A screen that must refuse exactly what javac or kotlinc refuses fails one case at a time. Each fix
inferred from a few probes leaked the next case: on one such screen, the test matrix
grew by one dimension per round over five rounds.

- **List every reachable form before the first fix.** Each syntactic form, modifier, and position
  the screen can meet goes in a list first, and the probes cover the list. Far fewer rounds were
  needed when a screen was briefed this way.
- **After a rule leaks twice, switch to a generated sweep.** Generate the cross product of the
  listed forms, often thousands of pairs, compile each one, and compare the compiler's verdict with
  the screen's. Keep a rule only when the sweep finds zero missed refusals.
- **Refuse what the rule cannot prove.** Where a form cannot be shown to compile, the screen
  refuses it, since a missed refusal passes silently.

## 5. Every confirmed finding becomes a regression test

A finding left as a note in a report does not stop the bug from coming back. Turn each confirmed
one into a test that fails on the old logic and passes on the new. Write it yourself and watch it go red then green—a
test written by the stage that produced the fix proves nothing about the fix.

## 6. Running the verifier

The verifier writes: scratch probes, and mutations to the code under test to prove a check actually
distinguishes the branch it is meant to select. That makes it a writer, with all the isolation
consequences that follow. Run verify agents serially or give each its own scratch copy, and keep them out of
worktree isolation, which would branch them off the wrong commit. The full rules are in the sibling
skill `delegate-to-subagents`.
