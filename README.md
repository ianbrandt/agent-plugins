# Agentic Development Plugins

A [Claude Code](https://claude.ai/code) plugin marketplace: topic-scoped
skills for software work, published under the `ianbrandt` marketplace.

## Install

Add the marketplace, then install the plugins below. The Claude Code Desktop plugin UI does both
without the commands. Claude Code 2.1.308 is the oldest version supported, and `session-skills`
needs 2.1.314: hooks and tools run in hooks modules, which are Claude Code mods.

```sh
/plugin marketplace add ianbrandt/agent-plugins
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
/plugin install confer@ianbrandt
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
- [`confer`](plugins/confer) has a Claude subagent and OpenAI's Codex review a change or a plan, or
  answer a question, independently, then rule on each other's findings until they agree. It needs
  the Codex CLI.
- [`gradle-skills`](plugins/gradle-skills) upgrades Gradle dependencies and the wrapper, one
  verified atomic commit at a time. Gradle builds only.

How to contribute is in [CONTRIBUTING.md](CONTRIBUTING.md), and how the plugins are built,
tested, and released is in [DEVELOP.md](DEVELOP.md).

## License

Licensed under MIT. See [LICENSE.md](LICENSE.md).
