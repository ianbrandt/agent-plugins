---
name: conduct-a-pipeline
description: >-
  Run several lanes at once, unattended, as one conductor session: hold 2–5
  file-disjoint units of work in flight, build each in its own worktree via a
  background Workflow, and process each as it finishes—rolling, refilled after
  every completion, until the work runs out or the plan is invalidated. Includes
  the deviations that exist only because no human is in the loop: the mandatory
  build gate on a self-reported green, the retry-then-flag rule, the watchdog for
  a pipeline that died without notifying, and the stop conditions. Trigger on
  "run several items unattended", "autopilot", "keep the pipeline full", or any
  multi-lane run with nobody watching. NOT for a single unit of work (that's
  work-on-a-branch, then land-and-wrap), and NOT for deciding
  what the candidates are—that comes from the repo's backlog plugin.
---

# Conduct a pipeline

One session conducts and delegates each build to a Workflow. The conductor holds up to N
file-disjoint units of work in flight, builds each in its own worktree via a background Workflow,
and processes each as it finishes—a rolling pipeline, refilled after every completion, running until
candidates run out or the plan is invalidated.

Per-lane mechanics come from `work-on-a-branch` for the backlog seam, `work-in-worktree` for the worktree,
`claim-a-lane` for the claim ledger, and `land-and-wrap` for landing. This skill adds the conductor
layer and the **unattended deviations**—each one exists because there is no human in the loop.
*This skill is the Workflow orchestration opt-in for every unit built under it.*

**Candidates come from the backlog** (`work-on-a-branch` §0), not from here. A backlog plugin supplies
an ordered list of workable units and records each one done in its own form; this skill covers how
many run at once, what happens when one fails, and when to stop. With no backlog plugin, the user
supplies the list up front and the conductor runs it dry.

How a completed unit is **processed** follows `land-and-wrap` §1: fork-ness, the landing mode, the
push mode, and the post mode. A conductor run is unattended, so in a confirm mode it attempts no
push and no post. In `merge` mode each unit lands serially on the default branch: rebase, mandatory
build, fast-forward, and a push in `auto-push` only (§2a). In `pr` mode each unit's branch is
rebased, built, and pushed under the same rule, and its PR text is written to a local file (§2b).
On a fork, each unit is processed like `pr` mode, against `upstream` (§2c). Only `merge` units
serialize, since only they move a shared branch.

## 0. Arguments

**cap** = units in flight, clamped to 2–5 (default 3), of which at most **2 concurrently building
code units** when the repo's build system shares one daemon or home per machine (lock timeouts and
OOM-killed daemons masquerade as unit failures); cheap, isolated builds are exempt from the sub-cap.
**max-items** caps units ***claimed***, not just completed—stop filling when claims-this-run reach
it. A backlog plugin may add its own arguments, such as a hint biasing candidate order.

## 1. Conductor setup—once

The conductor roots in the **main checkout** and never edits repo files outside a unit's worktree,
the run-state file and the PR draft files excepted. **It reaches a lane only by absolute path and
`git -C <worktree>`, never by `cd`**: in the desktop app, one `cd <lane worktree> &&` in a
conductor's Bash call moved the session's working directory into that lane. Get the candidate list from the backlog; if it
is empty, stop. Run the hygiene pass once—`work-on-a-branch` §4's prune, then `claim-a-lane` §2's dead-claim reap. Then:

- **Read how units land** with `mcp__session-skills__landing_facts` (`land-and-wrap` §1): fork-ness,
  the landing mode, the push mode, and the post mode. For a landing mode still unknown, skip the
  question to the user, since nobody is there to answer: take §2a and push nothing.
- **Create the run-state file** `.claude/pipeline-run.json`—git-ignored where the backlog is tracked,
  git-excluded where it isn't, and deliberately NOT under `.claude/claims/`, where the hygiene reaper
  would parse it as a claim and delete it. Per-unit `{status, worktree, branch, taskId, attempts,
  touches}`, plus the landing facts, `landed`/`staged`, `flagged`, `claimedCount`, and the recent
  completion/failure window. **Rewrite it on every state change; re-read it at the top of every
  wake**—context can be summarized mid-run, and IDs, counters, and flags held only in context don't
  survive that. It doubles as the morning-after record.
- Give the session a title, spelled out, the way `session-skills`' session rules specify.

No pause follows—this skill runs unattended.

## 2. The loop—a rolling pipeline

**Every wake begins the same way**—Workflow-completion notification or watchdog: re-read the
run-state file, then **poll the status of every in-flight task**. A Workflow that died without
completing sends no notification: found by polling it is treated the same as a `failed` report; left
unpolled it occupies its slot forever. So **whenever builds are in flight, arm a bounded watchdog**
(Monitor with an until-condition on task completion and a 30–60 minute timeout)—the all-dead
pipeline is the one stall no completion event can break.

**Candidates:** re-derive after every completion. The backlog supplies what is workable and in what
order (`work-on-a-branch` §0); from that list, remove what is unavailable at the session layer:

- **claimed**—it is listed in a live claim;
- **not disjoint**—any path it expects to edit falls inside a live claim's `touches` globs, or inside
  those of a unit staged this run (kept in the run-state file);
- **already in flight** by any of `work-on-a-branch` §2's three tells. **The conductor never takes the
  resume path**: a unit in flight stays out of candidates rather than being resumed here—it is an
  attended session's to finish. **A missing claim does not make it open**: a session that wrapped
  cleanly deleted its own claim and left the work in flight, so check the backlog's pin and `git
  worktree list` before reading an unclaimed unit as free;
- **flagged or staged this run**—a flagged unit's claim was released, and a staged `pr` unit stays
  open in the backlog until its PR merges, so without the exclusion either one is re-picked and
  re-burned on every refill.

Keep candidates in the backlog's order so fills take the topmost eligible units first. A unit whose
paths can't be predicted well enough to declare declares the broadest glob it might reach; that
costs parallelism and never costs correctness.

**Fill:** while in-flight < cap, claimed < max-items, and a candidate exists: open its worktree +
branch per `work-in-worktree` §2 and write its claim per `claim-a-lane` §3, **with its
`touches` globs**—the conductor is the one reader that depends on them being accurate, since it is
holding several lanes open at once. Where the branch needs a name for its destination
(`work-on-a-branch` §3: `pr` mode or a fork), give it one then, since nobody is present at landing to
supply one. **Pass the unit's ID as `open_worktree`'s `id` input.** It names the worktree directory
`<id>-<color-animal>` and the branch `claude/<id>-<color-animal>`; a branch named for its destination
is renamed after the worktree opens (`work-in-worktree` §2), while the directory keeps its name.
A backlog that pins a unit by branch or worktree name (`work-on-a-branch` §2's tell 1 or 2) can then
read the ID straight off the worktree directory for as long as it exists, which matters most in `pr`
mode, where the worktree outlives the fill that opened it.

**When a build reports files outside its declared globs, rewrite that claim before the next fill.**
A stale `touches` is worse than none: it reads as a checked disjointness guarantee. After all claims
in a fill batch are written, **re-read the ledger once more immediately before spawning each
build**—the write-then-check tie-break leaves the earlier writer blind to a later one. Then emit the
unit's one-line tier plan (`tier-model-and-effort`) and spawn its build as a **background Workflow**
sized to the work: design → implement test-first → adversarial review → fix → re-verify for code;
research → synthesize for design and research work. Small units (a note, a doc move) skip the
Workflow: the conductor does them inline in the worktree and processes them in the same pass.

**Every build brief includes, verbatim:**

- work ONLY under `<absolute worktree path>`—never the main checkout, never another worktree;
- you MAY create WIP checkpoint commits at stage boundaries (message `WIP: <stage>`)—a failed-stage
  retry resets to them; you must NEVER `git merge`, `git push`, rewrite history, or edit the backlog
  files—the conductor owns processing and backlog reconciliation (the unit's own new design or notes
  file is fine);
- no `git push` even to a scratch test repo, since every push raises a permission prompt the user
  cannot tell apart from a real one; update a scratch bare `origin` from its side instead (`git -C
  origin.git fetch <checkout> <branch>:<branch>`, or `git -C origin.git branch -D <branch>`);
- NO writes of any kind to the remote host (GitHub, GitLab, Bitbucket, or any other)—no issues,
  comments, PRs, or merge requests, no write commands from a host CLI (`gh`, `glab`, or another);
  draft any outreach text as local files for the conductor to process;
- repo conventions apply: test-first, in whatever style guide the repo or the backlog plugin
  supplies, pasted verbatim rather than referenced; delete agent artifacts (think-aloud comments,
  banners, mismatched test names)—cleanup is part of the work, not a later pass;
- final message = a structured report: `status` (`ready` | `failed` | `plan_invalidating`), what was
  built, files touched, findings, and anything that surprised you, also written to
  `<notes directory>/<unit ID>/<stage>-findings.md` before you return (a file named
  `findings.md` or `report.md` is refused to a subagent).

Verify stages run as plain agents in the unit's worktree (no isolation—a worktree-isolated agent
branches from the default branch's HEAD and would test the wrong tree). Tier per stage
(`tier-model-and-effort`): mechanical work at the mechanical model or `effort: 'low'`, loud-oracle
stages only; design and adversarial-verify at `'high'`/`'xhigh'`. Set each unit's verify tier from
its own answer to one question: would the test suite catch this unit going silently wrong? A unit
the suite covers gets a `'high'` verify or none. Never reuse one Workflow template's stage tiers
across every unit. Where a cross-provider review skill is installed (`tier-model-and-effort` §1),
a silent-failure unit's Workflow ends before its verify, and the conductor runs that review on the
unit's worktree while processing the completion.

**Process each completion—one at a time:**

1. Read the report. `plan_invalidating` → §3. `failed` → `git reset --hard` to the last WIP
   checkpoint (without checkpoints a retry compounds on a half-mutated tree), then one re-scoped
   retry resuming the Workflow from its run ID (byte-identical stages cache-hit). **A retry
   re-occupies the unit's slot—it is not a completion and does not trigger a refill.** A recognizable
   **infra failure** (build-tool lock timeout, daemon OOM) gets one extra uncounted retry and must
   not feed the stop rules. On a second real failure, **flag** the unit: record it in `flagged`, release
   its claim, leave its worktree + branch (WIP commits are autopsy evidence), report it in the
   wrap-up, continue with the others.
2. `ready` → inspect the diff (`git -C $WT status` / `diff`), strip any surviving agent artifacts,
   then **squash the WIP checkpoints into atomic, past-tense commits** (soft-reset to the merge-base,
   re-commit in logical units).
3. **A Workflow's self-reported green has been wrong.** `ready` is an unverified report until the
   conductor's build gate passes: agents have reported it on a red tree—having run a scoped subset,
   misread the output, or last built before their own final edit. **The conductor runs the build
   gate itself** on every completed unit, in the arm below that processes it, and a `ready` report
   failing that gate is a `failed` report—back to step 1. Never substitute the report for the gate,
   and never skip the gate because the report was detailed or confident. The gate is the repo's
   **full build** (from its contributor docs), run from `$WT`, never a scoped single-module test: a
   module-scoped gate can pass while a sibling module's fixtures stay red. `land-and-wrap`'s
   risk-based skip is off here. An attended session can skip because the next session rebuilds;
   here the next session is this loop applying the same skip, and at stop time there is none.
4. **Then process it by how units land** (§1): §2a in `merge` mode or with the mode unknown, §2b in
   `pr` mode, and §2c on a fork.

### 2a. `merge`—land serially on the default branch

Per `land-and-wrap` §2 `merge`, with these unattended deviations:

- Rebase onto the default branch. **Record the unit done in the backlog after the rebase.** Where
  the backlog's record is a tracked-file edit, make it the final fresh commit on the rebased tip:
  doing it before conflicts with the previous landing's backlog edit on every serial landing, and
  unattended conflict resolution silently mangles a sibling's backlog state. Where the backlog
  lives outside the tree—an untracked local-only file, an issue tracker—there is no commit to make;
  record it once the unit passes the build gate, through the backlog plugin's own mechanics.
- **Build gate** (step 3), on the rebased tip.
- Fast-forward the default branch from the main checkout, by `land-and-wrap` §2's `merge` step 3:
  it has the command for a main checkout that a human session has put on another branch. On
  `--ff-only` refusal, or a rejected `git fetch .`—a human session landed inside
  your rebase→build window—**re-rebase onto the moved branch and retry, bounded (3 attempts)**; never
  relax `--ff-only`.
- **Push** in `auto-push`, and never with the landing mode unknown. In `confirm-push` keep landing
  each unit on the local default branch, attempt no push, and present the accumulated unpushed
  range (`origin/$DEFAULT..$DEFAULT`) at stop, for the user to push. Then delete the claim; remove the worktree (`work-in-worktree` §3) and its branch; update the run-state file.

### 2b. `pr`—push each branch in `auto-push`, and write its PR text to a file

Per `land-and-wrap` §2 `pr`, with these unattended deviations. No shared branch moves, so units do
NOT serialize:

- Fetch, then rebase onto `origin/$DEFAULT`. Record the unit in the backlog by `land-and-wrap` §2's
  `pr` rule: a tracked-file record is the final commit on the rebased branch and merges with the PR;
  outside the tree, record the unit as in review once it passes the build gate, so a declined PR
  leaves it open.
- **Build gate** (step 3), on the rebased branch.
- **Push the branch** in `auto-push`. In `confirm-push` leave it unpushed for the wrap-up.
- **Write the PR title and body**, in the repo's PR style, to `<id>-pr-draft.md` in the repo's notes
  directory, or `.claude/pr-drafts/` where the repo has none (git-ignored or git-excluded like the
  run-state file), with the create link from the push's `remote:` lines where there is one. Open
  the PR (`land-and-wrap` §2 `pr` step 6) only in `auto-post`, and only where the branch was
  pushed. In `confirm-post` the file is where the text is left for the user.
- **Leave the worktree + branch in place** until the PR merges. Delete the claim; update the
  run-state file (`staged`, not `landed`).

### 2c. A fork—a branch for a pull request against `upstream`

Per `land-and-wrap` §3. There is no shared branch, so units do NOT serialize. Process the unit by
§2b, rebased onto `upstream/$DEFAULT`, with two differences: nothing is pushed to `upstream`, and
no PR, issue, or comment is posted, since a fork is always `confirm-post`.

- Keep the squashed atomic commits **on the unit's branch**; do not merge them.
- **Build gate** (step 3) before recording it done. A red unit is not "done".
- Record it done in the backlog, with a note of how far it got. Draft any issue, comment, or PR text
  as local files under the repo's notes directory, or `.claude/pr-drafts/` where it has none.
- **Leave the worktree + branch in place** until the PR merges. Delete the claim; update the
  run-state file (`staged`, not `landed`).

5. **Post-completion premise check:** `plan_invalidating` is self-reported and an agent can miss
   it—if the completed unit's diff touched a shared seam that in-flight or queued units build on, or
   contradicts an assumption the backlog's ordering rests on, treat it as plan invalidation (§3) even
   though `ready` was reported.
6. Refill the pipeline (fresh candidate derivation) and log one line:
   `landed <id> <name> (<sha>)—N in flight, M landed.` after §2a /
   `staged <id> <name> on <branch>—N in flight, M staged.` after §2b or §2c.

**Stuck build:** a Workflow far past its runtime for work of that size with no progress (the watchdog
gets you here) → TaskStop it, re-scope the stuck stage, resume from the run ID; never let one stuck
unit starve the pipeline.

## 3. Stop conditions—wrap, notify, end

Stopping means: let in-flight builds finish (or TaskStop them if the stop reason poisons their
premises), process whatever is finished-and-green (**conductor-run build gate, no skip**), then wrap.
Stop when:

- **Candidates run out**—nothing passes the filters. The normal end.
- **Plan invalidated**—a unit self-reports it, or the §2.5 check trips: a prerequisite discovered
  wrong, a spike refuting a settled ruling, a finding that materially changes what sibling units
  assume. Do NOT improvise a revised plan—stop and report; re-planning is the user's session.
- **Default branch red after a §2a landing**—one fix-forward attempt; still red → stop immediately.
  No analogue in §2b or §2c: nothing lands on a shared branch, so a red unit is simply left flagged
  and unstaged.
- **The failure window trips**—≥2 failures within any 3 consecutive completions (ordered by
  completion time), or ≥3 units flagged in the run.
- **max-items reached.**

On stop: finalize the run-state file, send a PushNotification (one line—units landed/staged, stop
reason), then a full wrap-up per `land-and-wrap` §4:

- landed and staged units with SHAs;
- after §2a in `confirm-push`, the unpushed `origin/$DEFAULT..$DEFAULT` range, for the user to
  push;
- after §2b, each branch with its PR text file (`<id>-pr-draft.md` in the notes directory, or
  `.claude/pr-drafts/`) or opened PR, and for an unpushed branch its `origin/$DEFAULT..<branch>` range;
- after §2c, the branch names to sync;
- flagged units with why, what the backlog has left, and a recommendation for the next attended
  session.

Title the session again where a better title fits. No stop path skips the notification and wrap-up.

## 4. Ledger etiquette

The conductor is a peer, not an owner: honor foreign claims when picking (a human session may be
working that unit right now), never `git worktree remove` a worktree it didn't create, and keep its
own claims accurate—one per in-flight unit, written with `write_claim`, deleted with `release_claim` at completion. Everything
in `claim-a-lane` about the ledger binds here N-fold.
