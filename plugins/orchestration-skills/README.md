# orchestration-skills

A [Claude Code](https://claude.ai/code) plugin of rules for delegating work to subagents and
checking what comes back. Most delegation failures look like success: a stage that ends on a holding
message is read as truncated rather than failed, a worktree-isolated verifier reports green against
the wrong branch, and two verifiers in one worktree each mutate the code the other is measuring.
Each rule here comes from a failure like those, and the measured cost is given with the rule.

## Skills

### `delegate-to-subagents`

The coordination protocol. What is worth handing off at all (substantial, well-specified,
objectively verifiable—never a one-liner), what goes into every brief verbatim, and how far a
read-heavy fan-out can be scoped before an agent overruns its context and retries from scratch.
Includes the isolation table: verifiers and live probes run non-isolated so they see the feature
branch, parallel writers get their own worktrees so they stop failing each other's suites, and
adversarial verifiers run serially because a verifier doing its job mutates the code under test.
Ends with how to integrate parallel worktree diffs into commits that can each be reverted alone.

### `tier-model-and-effort`

Model and effort as two independent knobs: capability class versus deliberation need. Includes five
tiers, each a model and an effort: Mechanical, Routine, Complex, Critical, and Escalation, the same
names Confer uses. These tiers are used in every other file in this plugin in place of model names,
since model names go out of date sooner than the rules do. Also covers the desktop effort labels, why a session's high effort setting should
not be applied to every stage, and what opting into Ultracode does and does not include.

### `verify-adversarially`

The extra pass that correctness-critical transform logic needs. Position-preserving rewriters, AST
rewriters, and name re-keying fail by succeeding quietly with corrupted state, so a bug in them
ships with the suite green. One independent verifier, whose only deliverable is an input that
produces silently wrong output or a documented failure to find one. Covers the three blind spots
that have each let a bug ship past a green suite, and each hypothesis has to be settled by a live
probe against compiled code rather than a code trace.

### `ask-when-needed`

The escalation protocol, for the decisions no agent should settle alone. The agent stops before a
decision that is hard to reverse: a wire contract or public API, a data schema or file format, a
branch or PR name that becomes permanent, text publishing under the user's name, a push to a public
repository, or a call later work will build on. Everything else is decided without asking,
including "should I proceed?" once the user has already said what to do. The agent asks with
`AskUserQuestion`, giving two to four options and stating for each what it costs as well as what it
buys. A subagent with no one to ask puts the decision and its options in its report instead of
settling it silently, which is why this skill is in the same plugin as the delegation rules.

## How it is wired

One hooks module, `hooks/register.ts`, which is a Claude Code mod and needs Claude Code 2.1.308 or
later, the oldest version supported. No shell is involved. `hooks/rules.md` is added to the first
prompt of every session, and again after `/clear` and compaction. That file is the short
form that is always loaded, and the full protocols are in the four skills. A subagent's task starts with
one rule only, the escalation paragraph addressed to a subagent: a hard-to-reverse decision is reported in its result with the options
instead of being settled silently. The rest of the file applies to the agent doing the delegating,
so it is not injected into subagents.

## Settings

Each tier's model and effort is a plugin setting, `<tier>Model` and `<tier>Effort`, and the tiers
as set are added to the end of `hooks/rules.md` when it is injected. The defaults are Haiku at Low
for Mechanical, Sonnet at Medium for Routine, Opus at High for Complex, Opus at Extra for Critical,
and Fable at High for Escalation. They differ from Confer's defaults on purpose, since Confer is
for questions, plans, and reviews and this plugin for everyday building. On an account that is not
served Fable 5.2, set `escalationModel` to `opus` with `escalationEffort` at `max`.

## Evals

[`evals/`](evals/) is a `claude plugin eval` suite of five chat cases: a model stated for each
agent launched, a parallel-worktree brief that forbids commit and push, a file format other teams
will read put to the user as options, a routine local commit made without a question, and a stage
that ended on a holding message. Run it from the plugin directory:

```bash
claude plugin eval . --runs 4 --judge-model sonnet --no-publish -j 4
```

On 2026-10-08, with four runs per case, the plugin scored 0.95 and no plugin 0.40, a gap of +0.55.
Two cases scored 0.00 without the plugin and 1.00 with it: the model per agent and the brief. The
file-format case scored 0.00 without the plugin and 0.75 with it. In the one failing run a single
format was proposed and the others were listed as rejected alternatives. The other two cases scored
1.00 in both arms: the routine commit, which guards against the plugin asking where it should act,
and the holding message, which measures nothing about the plugin's gain. The run cost $4.46 and
took 221 seconds.

## The incident numbers

The anecdotes in these skills are from real runs, with the project names removed. The numbers are
kept because they are the evidence for each rule. An over-scoped census agent burning ~800k tokens
over four retries against ~150k for its bounded siblings is why the fan-out cap is 10 files. An
orchestrator being wrong on all four of its disagreements with a delegate is why disagreements get
settled by spot-check instead of by rank. Two stages in one run ended on holding messages, the
second against a brief that included the prohibition verbatim, which is why the tree is still
inspected after the rule is written into the brief.
