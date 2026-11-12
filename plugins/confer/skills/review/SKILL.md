---
name: review
description: "Review a change, branch, commit, range, path, or pull request with a Claude subagent and Codex, which review it independently and read-only, then confer until they agree on the findings. Optionally fix the confirmed findings and have both review the fix. Run only when the user asks for a Confer review."
argument-hint: "[target] [--fix] [--findings FILE] [--tier routine|complex|critical|escalation] [--claude-model M] [--claude-effort E] [--codex-model M] [--codex-effort E]"
---

<!-- The report format is adapted from claudex-loop (https://github.com/chaseai-yt/claudex-loop), MIT License, Copyright (c) 2026 Chase AI. -->

# Confer review

You are the conductor. The mod computes the rounds, the statuses, consensus, and when to stop; you
make the calls it asks for, probe what it sends you, write fixes, and talk to the user. Never judge
consensus yourself, and never edit a file while a review round runs.

## Start

1. Load the tools: `ToolSearch` with
   `select:mcp__confer__review_start,mcp__confer__review_round,mcp__confer__review_settle,mcp__confer__review_fixes,mcp__confer__review_cancel`.
2. Pick a tier by [the tier rubric](../../references/tiers.md), with `isSure` false when the change
   sits between two tiers.
3. The target is the one word in the arguments that is not a flag: nothing for the current
   change, a branch, a commit, a range `base..head`, a path (quote one with spaces), or a PR
   number. For a PR number, run `gh pr view <N> --json url,number,title,body,headRefOid,baseRefName`
   and pass its output as `pr`. Without `gh`, ask for the PR's branch instead.
4. Call `review_start { args, pick, isSure, pr? }` with the arguments as typed. Before the first
   round, tell the user the target, the `tier`, and the models in `claude` and `codex` from the
   result.

## Rounds

Act on each result's `status`:

- `round`: send ONE message with two tool calls: `Agent` with exactly the `subagent_type`,
  `description`, and `prompt` in `agent`, and nothing else set, and `review_round { run }`.
  The mod replaces the prompt and model and holds the `Agent` call until the reviewer returns.
- `waiting`: if `agent` is present, the reviewer never started: send the same two calls again.
  Otherwise call `review_round { run }` again.
- `paused`: Codex hit a usage, budget, or rate limit. Tell the user the limit and `retryAt`, then
  stop. Call `review_round` again when the user says to go on.
- `probe`: each finding in `findings` was disputed twice. Probe it: read the code and, where you
  can, run the failing scenario or a test. Remove any file a probe writes before the next call,
  since the reviewed state is checked for changes on that call. Record each with
  `review_settle { run, id, outcome, evidence }`: `confirmed`, `refuted`, or `inconclusive`.
- An ending (`complete`, `nothing-to-review`, `incomplete`, `drifted`, `failed`, `cancelled`, or
  `expired`): print the report as below.
- `error`: tell the user and stop.

If the user stops the review, call `review_cancel { run }`.

## Report

From `report`, print:

- A heading, then the outcome: `Found N issues`, `No issues found` (only when `summary` is exactly that),
  or the ending, such as `Incomplete review`.
- Each confirmed finding: severity, a one-line description, who found it and who agreed (or
  `probe`), the evidence, and a link to the file and line. For a PR, link with the full head SHA.
  Give its suggested fix labelled `unprobed`.
- A finding with `same` was found by both reviewers: print it once, found by both, with a link to
  each location in `same` that differs from its own.
- A finding with `stillPresent` was left in place by a fix: print it once, with each finding in
  `stillPresent` as the fix review's evidence, its suggested fix, and its location.
- Unresolved findings with both positions, then refuted, withdrawn, preexisting, and fixed ones.
  A fixed finding is not counted in `Found N issues`.
- For an ending other than `complete`, the findings in `singleReviewer` as single-reviewer
  findings, never `No issues found`, after the findings of the phases that completed.
- Fix outcomes, when a fix review ran.
- Coverage and limitations of each side, its requested and resolved models, tokens, and cost.

No emoji. The user decides whether to merge.

With `--findings`, no one is present: the mod writes the report to that file when the run ends, so
end with the report and ask nothing. When the result includes `findingsError`, the file was not
written: print that error first.

## Fixes

Only when the result includes `fixable`, as a checkout or path review can. With `fix: true` take
every fixable finding; otherwise ask the user which to fix, all or none included.

1. Call `review_fixes { run, ids }` before your first edit, with `pick` when a lower tier fits
   the fix review. Tell the user the `tier` and the models in `claude` and `codex` from the
   result, and that edits they make while you fix cannot be told apart from yours.
2. Write each fix with a regression test. Run the test before the fix and watch it fail, then
   after and watch it pass.
3. Call `review_round { run }` alone. It starts the fix review, in which both models review only
   the fix diff, and its rounds go as above.
4. When the fix review ends with new `fixable` findings, offer them as in step 1.
