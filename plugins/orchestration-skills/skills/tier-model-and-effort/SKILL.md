---
name: tier-model-and-effort
description: >-
  Pick the model and the reasoning effort for each stage of a piece of work, as two
  independent knobs: capability class versus deliberation need. Includes the dated model
  tier table used by this repo's other skills, the effort labels shown in the user's picker,
  the rule that a session running hot should not make every stage pay for it, and what
  opting into Workflow orchestration does and does not include. Trigger when planning a
  multi-stage run, when writing per-stage model or effort overrides, when a stage is
  underperforming or overspending, and on "which model should this use". NOT for how to
  brief or bound a delegated agent (that's delegate-to-subagents).
---

# Tier model and effort—two knobs, set per stage

Model and effort are independent. Set model by the stage's **capability class** and effort by its
**deliberation need**. Fix a capability shortfall with a bigger model, not more thinking, and give
careful multi-step bookkeeping more effort, not a bigger model. Setting both high everywhere is how
a run costs four times what it needed to.

## 1. The model tiers

**Table current as of 2026-11-09.** Model names age fast; re-tune this table when releases land,
and treat every other skill's tier language ("the apex tier", "a task hero") as pointing here rather
than at a name. No other part of this plugin includes a model name.

| Tier | Model | Use it for | Cost note |
|---|---|---|---|
| Apex | Fable 5.2 | A narrow set: architecture or strategy with no precedent to follow, a tie-break when an everyday verify and the build disagree on something that fails silently, and a stage the everyday tier has already tried at Extra and left open. Run it at High. | Twice the everyday tier's price per token. On FrontierCode 2.0 at High it scored what the everyday tier scored at Max, for half the cost per task. On Pro and standard Team seats, Fable usage is capped at half the weekly limit. Aim it; never default to it. |
| Everyday | Opus 5.5 | The orchestrator and the workhorse: the main loop, design, adversarial verification, and judge stages. Raise its effort to Extra before reaching for the apex tier. | The baseline. |
| Task hero | Sonnet 5.5 | Any unit that is well-specified and objectively verifiable, inside a Workflow or not. Test-driven work is the ideal case. | Cheap enough to fan out. |
| Mechanical | Haiku 5.5 | Stages with a loud oracle: tests, compiles, a verifiable count, bulk reads, fixture sweeps, doc updates. | Cheapest. Only where failure is loud. |

**A stage is not apex work because of its kind.** Design and verify stages run on the everyday
tier. In one unattended pipeline run, every unit's verify went to the apex tier from one reused
Workflow template, whether or not a failure in that unit could go unnoticed. Stages at that tier
accounted for about a fifth of the session's tokens and, at its rate, about half of its cost.

**"Mechanical" means failure is loud.** A stage that could fail silently is not mechanical, however
rote it looks. Give it a task-hero model and a real check.

**A unit with both kinds of work is two stages.** When one agent runs a mechanical harvest and
then makes the judgment the whole result rests on, the judgment inherits the harvest's tier and gets
no deliberation of its own. One corpus agent fetched metadata for 1,870 artifacts—loud enough that a
path bug showed up as 664 consecutive 404s—and in the same run decided whether suffixes like `.SP2`
and `.jre11` were release variants or genuine pre-releases. That second call was the entire
argument, it fails silently, and it went out at the tier the fetching deserved. Harvest cheap, then
judge at the tier the judgment needs.

**A re-verify runs at or below the tier of the verify before it.** After a fix, the check is whether
named findings were resolved, plus a read of the fix diff for anything new it broke. That is
well-specified and objectively checkable, so it is task-hero work at Medium or High. In the pipeline
run above, re-verify passes used about 40% of the apex tier's tokens.

### A second provider, where one is installed

A skill that runs another provider's model is optional, and nothing here depends on one. Where one
appears in the session's skill list:

- **Silent-failure verify.** A cross-provider review skill, such as `claudex-code-review` from the
  `claudex-loop` plugin, replaces the verify stage for a unit whose failure could go unnoticed. It
  does not run beside an everyday verify. Pass Extra effort and the Claude reviewer's model (the
  everyday tier) explicitly, or both come from that skill's defaults and the CLI's configuration.
- **A stalled stage.** A routing skill, such as `claudex-route`, hands the reproduction and the
  failed approaches to the other provider. Try it before the apex tier.
- **Its model.** The other provider's top model, `gpt-6-astra` as of 2026-09-24, with `gpt-6-sol`
  as the step down when that plan's quota runs low. Usage on that side counts against the other
  provider's plan, not the Claude weekly limit. The Claude reviewer inside a cross-provider review
  still counts.

Without one, a silent-failure verify runs on the everyday tier at Extra, and a stalled stage goes to
the apex tier at High.

## 2. The effort labels

The desktop picker shows: **Low / Medium / High / Extra / Max / Ultracode**. There is no "default"
label, so write guidance in these terms. "Extra" is the API's `xhigh`.

Rough fit:

- **Low**—mechanical stages with a loud oracle.
- **Medium / High**—ordinary implementation and review.
  A task-hero stage starts at Medium: the vendor
  recalibrated that model's levels as of 2026-10-04, and Medium is its documented starting point
  for agentic coding. At Low it sometimes reports a change as done without running a check that
  exercises it, so in a task-hero brief at Low, require test or build output in the result.
- **Extra**—design, adversarial verification, judge stages, and careful multi-step bookkeeping.
- **Max**—no stage. A stage where an Extra pass has already stalled goes to a second provider where
  one is installed (§1), then to the apex tier at High. On FrontierCode 2.0 (2026-11-09), the apex
  tier at High matched the everyday tier at Max for half the cost per task, and the apex tier at
  Max scored below the apex tier at Extra for three times the cost. Raise the apex tier to Extra only where a
  gain is measured.

**A session running at a high effort should not make every stage pay for it.** Set the expensive
tier on the stages that need it and let the rest run cheap.

## 3. Override per stage, do not pause for the picker

Model and effort are user-side settings, and they are only weakly observable from inside a session:
effort is never surfaced, and the environment block's model name can lag a mid-session change.

So do not stop and ask the user to change a picker. Launch at the everyday baseline, keep the main
loop there, and set the tier explicitly on the stages that need something else.

**Pass `effort` on every `Agent` launch whose stage level differs from the session's.** Since
Claude Code 2.1.292 (2026-10-06), the `Agent` tool takes `effort` as well as `model`, for any
subagent except a fork, and both are set on a Workflow's `agent(..., {model, effort})` too. Claude
passes `effort` only when a level is asked for by the user, in CLAUDE.md, or in a skill, and the
stage levels in §2 are that request. In a probe on 2026-10-17, Opus 5.5 and Sonnet 5.5 passed
`effort: 'low'` for a file read in 4 of 4 runs from a skill's stage table alone, and in 0 of 2 with
no skill. On an older Claude Code, the tool has no `effort` parameter and a subagent inherits the
session's effort. The `CLAUDE_CODE_EFFORT_LEVEL` variable, where set, overrides both. Never
announce an effort setting you have no way to apply.

**Launch a mechanical agent at `low`.** Its model has taken an effort setting since 2026-10, so a
mechanical agent launched with no `effort` from a session at Extra runs at Extra. On one rename
task with a test oracle, Extra used about 4 times the output tokens and 2.5 times the wall time of
Low, and all 3 runs passed at each.

**A delegated call to another CLI is a third case.** A second provider's CLI, or a nested
`claude -p`, reads its own configuration, and the host session cannot see what is set in it. Its
default effort may sit below the session's, and it may report no observed model at all. So pass
model and effort explicitly on every such call, and log the requested pair and the observed pair
separately: when the CLI reports nothing, the requested pair is the only record of what ran, and
that should be recorded in the log. In one session a second provider's default effort was `low`,
and a plan review would have run at that effort had the runner call not passed `--effort high`.

**Announce each stage's tier in the message that launches it.** An up-front plan is worth
writing—the user sees what a run will cost before it starts—but nothing later checks it, and a
plan written before the stages are known describes stages that never happen. So plan only what you
actually intend to delegate, restate the tier as you launch each stage, and say plainly when a
planned stage turns out not to run. In one session the plan `Workflow—design@high, implement@medium,
docs@low, adversarial-verify@high` was announced within a minute of the claim, before any source had
been read. That session then ran no Workflow at all, built the item inline in the main loop, sent
both delegated agents out with no model override, and never launched the apex judgment pass it
promised an hour later.

The apex tier can be spawned unattended for the narrow set in the table. Its cost is the reason to
**aim** it, not the reason to avoid it.

## 4. Ultracode: what it is and what it is not

**Ultracode = Extra effort (`xhigh`) plus automatic Workflow orchestration.**

It is deliberately non-persistent—no settings key, no environment variable, no hook. Opt in per turn
(the keyword `ultracode`, or asking for a workflow) or per session (`/effort ultracode`).

An instruction in a `SKILL.md` to **use the Workflow tool** opts that skill into orchestration on
its own, scoped to its own task. That grants orchestration **only**, not the effort half. Extra
effort still needs the explicit opt-in.

## 5. Open-ended scope: pick and recommend

When several paths are viable, pick the one that balances good context against weekly usage, and
recommend it—rather than enumerating options at length or pushing into unfocused deep work. Prefer
landing a clean, complete, tested increment over opening a multi-session rabbit hole in the same
turn. Spend subagents and workflows where they clearly pay off, not lavishly.
