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

## Plugins

Install the plugins for the work you do. Most of them add rules with the first prompt of every
session, so they change how a session works without being invoked.

### Writing

```sh
/plugin install writing-skills@ianbrandt
/plugin install ghostwriting-skills@ianbrandt
```

- [`writing-skills`](plugins/writing-skills) changes how a session writes: to you, in
  repo docs, and in anything published under your name. Jargon, personified subjects, and
  back-references a cold reader cannot follow are kept out of replies, and a lint reports each miss
  in the next turn.
- [`ghostwriting-skills`](plugins/ghostwriting-skills) drafts text that ships under your name from a
  voice spec built out of your writing, hands each draft over for your go, and logs what your edits
  change. With `writing-skills` installed, the general rules from those edits are added to
  that plugin's always-on file.

### Delegation and Review

```sh
/plugin install orchestration-skills@ianbrandt
/plugin install confer@ianbrandt
```

- [`orchestration-skills`](plugins/orchestration-skills) changes how a session hands work to other
  agents. It covers what is worth delegating and at what tier, puts scope and prohibitions in
  every brief, isolates the agents that would corrupt a shared worktree, and treats a stage that
  stopped producing output as failed rather than finished. You are asked before a decision you
  cannot undo is made.
- [`confer`](plugins/confer) has a Claude subagent and OpenAI's Codex review a change or a plan, or
  answer a question, independently, then rule on each other's findings until they agree. It needs
  the Codex CLI.

### Branches and Sessions

`parallel-session-skills` and `roadmap-skills` both need `session-skills`.

```sh
/plugin install session-skills@ianbrandt
/plugin install parallel-session-skills@ianbrandt
/plugin install roadmap-skills@ianbrandt
```

- [`session-skills`](plugins/session-skills) puts a unit of work on its own branch and gets it
  back off again, landing it by what the repo is rather than by a mode you declare. It also has two
  small session-start rules: how a session gets its title, and a per-turn judgment
  of whether the work is better served by continuing here or handing off to a fresh session.
- [`parallel-session-skills`](plugins/parallel-session-skills) keeps two or three sessions off each
  other's files, with a git worktree for each and a claim ledger of the paths each lane will touch. It also has the
  unattended conductor that runs several lanes at once and refills them as they finish. Install it
  if you run more than one session against a repo at a time.
- [`roadmap-skills`](plugins/roadmap-skills) backs a lane with a markdown backlog: `Rn` items in
  priority order, claimed one at a time or fed to the conductor in a batch. Feeding the conductor needs
  `parallel-session-skills` as well.

### Gradle

```sh
/plugin install gradle-skills@ianbrandt
```

- [`gradle-skills`](plugins/gradle-skills) upgrades Gradle dependencies and the wrapper, one
  verified atomic commit at a time.

## Contributing

How to contribute is in [CONTRIBUTING.md](CONTRIBUTING.md), and how the plugins are built,
tested, and released is in [DEVELOP.md](DEVELOP.md).

## License

Licensed under MIT. See [LICENSE.md](LICENSE.md).
