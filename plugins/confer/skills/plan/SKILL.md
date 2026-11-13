---
name: plan
description: "Work out the analysis, requirements, design, and plan for one increment or a roadmap with the user, or take a document the user already has, then have a Claude subagent and Codex critique it independently and read-only, revising the file between rounds until they agree. Run only when the user asks for a Confer plan."
argument-hint: "[file or goal] [--findings FILE] [--tier routine|complex|critical|escalation] [--claude-model M] [--claude-effort E] [--codex-model M] [--codex-effort E]"
---

<!-- The two-reviewer plan loop, the interview in Work it out, and the report format are adapted from claudex-loop (https://github.com/chaseai-yt/claudex-loop), MIT License, Copyright (c) 2026 Chase AI. -->

# Confer plan

You are the conductor. The mod computes the rounds, the statuses, consensus, and when to stop; you
make the calls it asks for, revise the document, and talk to the user. Never judge consensus
yourself, and never edit the file while a round runs.

## Start

1. Load the tools: `ToolSearch` with
   `select:mcp__confer__plan_start,mcp__confer__plan_round,mcp__confer__plan_revision,mcp__confer__plan_cancel`.
2. When the words in the arguments that are not flags or their values are one existing file, that
   is the file. Otherwise, work the document out first, as below.
3. Pick a tier by [the tier rubric](../../references/tiers.md), from the contents of the file, with
   `isSure` false when it sits between two tiers.
4. Call `plan_start { args, pick, isSure, fableUsedPercent? }` with the arguments as typed and the
   figure from [Fable usage](../../references/tiers.md#fable-usage). Before the first round, tell the user the file, the `tier`, the models in
   `claude` and `codex` from the result, and any `fallback`.

## Work it out

1. With `--findings`, no one can be asked: stop and say a file is needed. Otherwise, if the words
   are one word that looks like a path (it has a slash or a file extension) and matches no file,
   report the missing file and ask what to do. Otherwise, take the goal from the arguments, or from
   the conversation when there are none. With neither, ask what to plan.
2. Read the code the goal touches, with its callers and the writers of any shared state. For a
   roadmap, read the existing roadmap and the items in flight.
3. End a turn with the assumptions, since the user may not see text between tool calls or in your
   thinking: one numbered list headed Assumptions, each with its source, such as a file and line,
   and a request for corrections. Ask the questions of step 4 in the same text, below the list.
4. Ask only about decisions that change the outcome, each as a question ending in a question mark,
   with a recommendation, why it matters, and the cost of guessing wrong. Ask independent ones
   together, and offer to accept all remaining recommendations.
5. Ask where to write the file as a question, suggesting a path. If a file is already there, ask
   whether to review it as it is, overwrite it, or pick another path. Then write it with a heading
   for each of the analysis, the functional requirements, the nonfunctional requirements, the
   design, and the plan, each as long as the goal needs. A roadmap lists each item with its gates,
   the files it touches, and whether it needs someone present.
6. Pick the tier as in step 3 of Start, then call `plan_start` with the tier and model flags as
   typed, followed by the path of the file, and `fableUsedPercent` as in step 4 of Start. Tell the user the tier and models as in step 4 of
   Start, and go on to the rounds.

## Rounds

Act on each result's `status`:

- `round`: send ONE message with two tool calls: `Agent` with exactly the `subagent_type`,
  `description`, and `prompt` in `agent`, and nothing else set, and `plan_round { run }`.
  The mod replaces the prompt and model and holds the `Agent` call until the reviewer returns.
- `waiting`: if `agent` is present, the reviewer never started: send the same two calls again.
  Otherwise call `plan_round { run }` again.
- `paused`: Codex hit a usage, budget, or rate limit. Tell the user the limit and `retryAt`, then
  stop. Call `plan_round` again when the user says to go on.
- `revise`: the points are in `agreed`, `disputed`, and `open`. Edit the file at `file`, then call
  `plan_revision { run, notes }`, which returns the next `round`.
  - Address every `agreed` point, or say in `notes` why not.
  - Revise for the `disputed` and `open` points you accept, and say in `notes` which you do not.
  - Probe the fact a dispute turns on, and put the result in the document or the notes.
  - When a change replaces a behavior, change every passage that still states the old one,
    acceptance criteria included.
- An ending (`complete`, `incomplete`, `failed`, `cancelled`, or `expired`): print the report as
  below.
- `error`: tell the user and stop.

If the user stops the review, call `plan_cancel { run }`.

## Report

From `report` and `design`, print:

- A heading, then the stop: `consensus`, `stalled`, or `max-rounds` from `phases`, or the ending,
  such as `Incomplete plan review`.
- The agreed points the final version still has (`confirmed`): severity, a one-line description, the
  section in `path`, who found it and who agreed, and the evidence.
- The disputed and open points (`unresolved`) with both positions.
- Resolved points (`withdrawn`), then the single-reviewer points for an ending other than `complete`.
- Coverage and limitations of each side, its requested and resolved models, tokens, and cost.
- The file and its last version. An edit after the last round has not been reviewed.

No emoji. What is still disputed goes to the user with both positions.

With `--findings`, no one is present: revise without asking, and the mod writes the report to that
file when the run ends, so end with the report and ask nothing. When the result includes
`findingsError`, the file was not written: print that error first.
