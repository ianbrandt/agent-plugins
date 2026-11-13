ORCHESTRATION MODE ACTIVE

These rules govern work you hand to another agent: subagents, Workflow stages, parallel worktrees.
The main loop orchestrates; delegate units that are well-specified, substantial, and objectively
verifiable. A subagent has fixed overhead (brief, digest, re-read), so it pays off only on meaty
self-contained units—never a one-liner. Keep emergent or fuzzy work in the main loop.

## Before launching

- **Announce the delegation and why**, then summarize what came back. Subagent output returns to
  you, not to the user's transcript, so the user never sees work you do not summarize.
- **Put scope, style, and VCS/docs prohibitions verbatim in every brief.** A delegate told only to
  "follow the repo conventions" does not apply them. In a parallel-worktree brief, forbid
  `commit`/`merge`/`push` and shared-doc edits; the orchestrator reconciles and commits serially.
- **Require findings on disk, and list the tools the task may need.** If you ask only for a return
  value, everything is lost when the agent goes silent: one agent did exactly that, and its result
  had to be reconstructed from the worktree's build reports. Give the file a path and a name such as
  `R12-findings.md`: Claude Code refuses a subagent's Write to a file named `findings.md`,
  `report.md`, `summary.md`, or `analysis.md`, in any case. A delegate that is not told it can drive
  a browser reports a Cloudflare 403 as a dead end.
- **Do not launch a stage you cannot afford to verify.** A delegated diff is unreviewed until you
  review it. Weigh that against the context you have left, and hand the whole unit to a fresh
  session rather than passing on a diff nobody read.
- **Bound read-heavy fan-out.** Cap a census-style agent at roughly 10 files, read once. An
  over-scoped reader overruns context, dies, and retries from scratch: one such agent burned ~800k
  tokens over 4 retries against ~150k for its bounded siblings.
- **Pick the tier per stage.** Set model by the stage's capability class and effort by its
  deliberation need. Design and verify run at the Critical tier. The Escalation tier is for
  questions the Critical tier has tried and left open, within the limits in the
  `tier-model-and-effort` skill. Never write a model name from memory: take each tier's model and
  effort from the table at the end of these rules.
- **State each stage's tier in the message that launches it.** Nothing later checks the tiers in an
  up-front plan. One session announced `Workflow—design@high, implement@medium, docs@low,
  adversarial-verify@high` and then ran no Workflow, built the item inline, and set no model on
  either agent it launched. Pass the stage's level as `effort` on `Agent` (Claude Code 2.1.292
  and later, any subagent but a fork) or on a Workflow `agent()`: `low` for a mechanical stage,
  `medium` or `high` for implementation and review, `xhigh` for design and adversarial verify.
  Never announce an effort you cannot apply.

## Isolation

- `isolation: 'worktree'` branches from the **primary checkout's HEAD**, usually the default branch,
  not your feature-branch worktree. A worktree-isolated agent asked to verify committed work may be
  testing the wrong branch. Check which commit an isolated agent branched from.
- A **non-isolated** agent runs in your session worktree: right for verifiers and live probes, wrong
  for parallel writers, which see each other's half-done state and chase phantom corruption.
- **A thorough verifier also writes**—it mutates the code under test to prove a check catches what
  it is meant to catch. Two verifiers fanned out into one worktree produce false
  results, not just wasted tokens. Run verify agents serially, or give each its own scratch copy.

## Trusting what comes back

- **A stage that ends on a holding message ("pausing until the build finishes") is failed work.**
  Say so in every brief, and still inspect the tree yourself: two stages in one run ended that way
  against a brief that included that prohibition verbatim, and both shipped a silent defect that
  only a live probe caught.
- **Verify the fix stage.** Fix stages run after the reviewers, so their diffs are unreviewed.
  Confirm the fix reached its target and watch a regression test go red then green.
- **Arbitrate a disagreement by spot-check, not by rank.** The delegate read deeper on its narrow
  slice and is usually right: in one pass the orchestrator was wrong on all four disagreements.
  Defer to it on what it found, never on what it reports as impossible—probe a blocker yourself
  before repeating it. One agent's "403 behind Cloudflare" reached the user as a dead end, but the
  page loaded in a browser on the first try.
- **Noticing that an agent stopped is your job.** A background agent that hangs or dies sends no
  notification, and completed agents keep their chips, so three chips once looked like three live
  agents when only one was running. Read liveness off the agent transcript's mtime, the work on
  disk, and actual CPU.

## Open-ended scope

When several paths are viable, **pick and recommend** the one that balances good context against
weekly usage—do not enumerate options at length or open a multi-session rabbit hole. Prefer landing
a clean, complete, tested increment. Spend subagents and workflows where they clearly pay off.

## Escalation

Stop and call `AskUserQuestion` before a decision that is **hard to reverse**: a wire contract or
public API, a data schema or file format, a branch or PR name that becomes permanent, text that
publishes under the user's name, a push to a public repository, or a call that later work will build
on. Offer 2-4 options, and state what each one costs as well as what it buys.

**This overrides the default bias against blocking questions.** It does not license asking about
routine judgment calls, anything the code or git history can answer, or "should I proceed?" after
the user already said what to do.

In a subagent, with no user to ask, put the decision and its options in your result instead of
settling it silently. The agent reading your report is the one who can stop.

## The skills behind these rules

`delegate-to-subagents`—the full coordination protocol: briefs, fan-out, isolation, integration.
`tier-model-and-effort`—which stage runs at which tier, the effort labels, and when to opt into a Workflow.
`verify-adversarially`—the extra pass correctness-critical transform logic needs before it ships.
`ask-when-needed`—the trigger and anti-trigger lists for stopping, and the tradeoff format.
