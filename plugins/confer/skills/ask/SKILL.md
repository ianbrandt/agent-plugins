---
name: ask
description: "Have a Claude subagent and Codex each answer a question independently and read-only, then rule on each other's answers until they agree on one. Run only when the user asks for a Confer answer."
argument-hint: "[--findings FILE] [--tier routine|complex|critical|escalation] [--claude-model M] [--claude-effort E] [--codex-model M] [--codex-effort E] <question>"
---

<!-- The two-reviewer loop and the report format are adapted from claudex-loop (https://github.com/chaseai-yt/claudex-loop), MIT License, Copyright (c) 2026 Chase AI. -->

# Confer ask

You are the conductor. The mod computes the rounds, the statuses, consensus, and when to stop; you
make the calls it asks for and talk to the user. Between rounds you only relay: never answer the
question, add to an answer, or pick one.

## Start

1. Load the tools: `ToolSearch` with
   `select:mcp__confer__ask_start,mcp__confer__ask_round,mcp__confer__ask_cancel`.
2. With no question typed, ask the user for it, or with `--findings`, stop and say a question is
   needed. Never take the question from the conversation.
3. Pick a tier by [the tier rubric](../../references/tiers.md), from the question, with `isSure`
   false when it sits between two tiers.
4. Call `ask_start { args, pick, isSure }` with the arguments exactly as typed. The flags go first,
   and a flag typed after the question stays part of it. Never compose, shorten, or add context to
   the question.
5. Before round 1, tell the user the `question`, `tier`, and models in `claude` and `codex` from
   the result, and any `warning`.

## Rounds

Act on each result's `status`:

- `round`: send ONE message with two tool calls: `Agent` with exactly the `subagent_type`,
  `description`, and `prompt` in `agent`, and nothing else set, and `ask_round { run }`.
  The mod replaces the prompt and model and holds the `Agent` call until the reviewer returns.
  A `round` with `retry` asks the same side again after a refused reply.
- `waiting`: if `agent` is present, the reviewer never started: send the same two calls again.
  Otherwise call `ask_round { run }` again.
- `paused`: Codex hit a usage, budget, or rate limit. Tell the user the limit and `retryAt`, then
  stop. Call `ask_round` again when the user says to go on.
- An ending (`complete`, `incomplete`, `cancelled`, or `expired`): print the report as below.
- `error`: tell the user and stop.

If the user stops the run, call `ask_cancel { run }`.

## Report

From `report`, print:

- A heading: `Agreed answer` when the stop in `phases` is `consensus`, `No agreement` when it is
  `stalled` or `max-rounds`, or the ending otherwise, such as `Incomplete answer`.
- The question.
- The agreed answer (`confirmed`): its `answer`, its `reasons`, who gave it and who agreed, and the
  rulings. An entry with `same` is two answers both sides gave: print it once, given by both.
- With no agreement, each answer in `unresolved` with who stands by it, from the `agree` rulings of
  the last round, and the other side's last ruling on it.
- For an ending other than `complete`, each side's answers in `singleReviewer`. The answer a side
  stands by is the one it ruled `agree` on in the unfinished round, or its new answer.
- Withdrawn answers (`withdrawn`), one line each.
- Coverage and limitations of each side, its requested and resolved models, tokens, and cost.

No emoji. Add no answer or verdict of your own.

With `--findings`, no one is present: the mod asks no tier question and writes the report to that
file when the run ends, so end with the report and ask nothing. When the result includes
`findingsError`, the file was not written: print that error first.
