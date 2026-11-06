# coding-skills

A personal [Claude Code](https://claude.ai/code) plugin marketplace: topic-scoped
skills for software work, published under the `ianbrandt` marketplace.

## Install

Add the marketplace, then install the plugins below. The Claude Code Desktop plugin UI does both
without the commands. Claude Code 2.1.308 is the oldest version supported: hooks and tools run in
hooks modules, which are Claude Code mods.

```sh
/plugin marketplace add IanBrandt/coding-skills
```

### Start here

These two are mostly rules that load with the first prompt, so they change every session without being
invoked.

```sh
/plugin install writing-conventions@ianbrandt
/plugin install orchestration-skills@ianbrandt
```

- [`writing-conventions`](plugins/writing-conventions) changes how a session writes: to you, in
  repo docs, and in anything published under your name. Jargon, personified subjects, and
  back-references a cold reader cannot follow are kept out of replies, and a lint reports each miss
  in the next turn.
- [`orchestration-skills`](plugins/orchestration-skills) changes how a session hands work to other
  agents. It covers what is worth delegating and at what tier, puts scope and prohibitions in
  every brief, isolates the agents that would corrupt a shared worktree, and treats a stage that
  stopped producing output as failed rather than finished. You are asked before a decision you
  cannot undo is made.

### Add for the work you do

```sh
/plugin install ghostwriting-skills@ianbrandt
/plugin install session-skills@ianbrandt
/plugin install parallel-session-skills@ianbrandt
/plugin install roadmap-skills@ianbrandt
/plugin install gradle-skills@ianbrandt
```

- [`ghostwriting-skills`](plugins/ghostwriting-skills) drafts text that ships under your name from a
  voice spec built out of your writing, hands each draft over for your go, and logs what your edits
  change. With `writing-conventions` installed, the general rules from those edits are added to
  that plugin's always-on file.
- [`session-skills`](plugins/session-skills) puts a unit of work in its own git worktree and gets it
  back out again, landing it by what the repo is rather than by a mode you declare. It also has two
  small session-start rules: how a session gets its title, and a per-turn judgment
  of whether the work is better served by continuing here or handing off to a fresh session.
- [`parallel-session-skills`](plugins/parallel-session-skills) keeps two or three sessions off each
  other's files, through a claim ledger of the paths each lane will touch. It also has the
  unattended conductor that runs several lanes at once and refills them as they finish. Install it
  if you run more than one session against a repo at a time; it needs `session-skills`.
- [`roadmap-skills`](plugins/roadmap-skills) backs a lane with a markdown backlog: `Rn` items in
  priority order, claimed one at a time or fed to the conductor in a batch. Claiming one needs
  `session-skills`; feeding the conductor needs `parallel-session-skills` as well.
- [`gradle-skills`](plugins/gradle-skills) upgrades Gradle dependencies and the wrapper, one
  verified atomic commit at a time. Gradle builds only.

## Checks

`test.sh` runs every check that needs no model call, in about seven seconds. It needs `claude` and
`node` on the `PATH`.

```bash
./test.sh
```

- `claude plugin test` in each plugin that has a hooks module.
- [`graders.test.mjs`](graders.test.mjs): each regex grader in an eval suite, against one text it
  has to match and one it must not. A regex grader with no texts fails.
- For each plugin changed since `origin/main`, a `version` in `.claude-plugin/marketplace.json` that
  differs from the one on `origin/main`. An installed session reads a cache keyed by version, so
  it keeps the old copy of a plugin until the version changes. One new version is enough for every
  commit waiting to be pushed, and no new version is needed for a change to only evals, tests, or
  a plugin's `README.md` or `DESIGN.md`. Versions follow SemVer: the major part goes up for a
  breaking change, the minor part for a new feature or a change in behavior, and the patch part
  only for a fix. In a plugin still at 0.x, a breaking change is a minor bump too.

The same script runs in GitHub Actions on Linux and Windows for each push and pull request
([`test.yml`](.github/workflows/test.yml)). A pass on Windows does not replace a live run there: the
unit tests run against mocked file and git calls. Checks that need another machine are listed in
[`TODO.md`](TODO.md).

The eval suites call a model and cost money. Each is run from its plugin's directory, with the
command in that plugin's README, or in `DESIGN.md` for `writing-conventions`. So do the
[end-to-end tests](e2e/README.md), which run `next-roadmap-item` end to end in a scratch repo.

## License

Licensed under MIT. See [LICENSE.md](LICENSE.md).
