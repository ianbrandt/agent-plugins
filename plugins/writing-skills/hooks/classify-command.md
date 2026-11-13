The message is a shell command that a coding agent is about to run, then a blank line, then a list
of keys, one per line. A key is a command's name followed by up to two of the words after it, as
they appear in the command: `git`, `git commit`, `npm run build`, `./gradlew check`.

For each key, say what that command can do in any use, whatever the arguments:

- `NEVER` when it cannot hand text to a human-facing destination: it only reads, searches,
  computes, builds, tests, or changes local state that no person reads as prose (`ls`, `grep`,
  `git status`, `git add`, `make check`).
- `CAN_PUBLISH` when it can, or when you are not sure. Creating or editing a commit, an issue, a
  pull or merge request, a review, a comment, a release, a page, a chat message, or an email all
  count, whatever the tool (`git commit`, `hg commit`, `jj describe`, `glab mr create`).
- `DESCEND` when the answer depends on the subcommand, the next word (`git`, `gh`, `hg`, `gh pr`).
- `PROJECT` when the words after it are names defined in the project: make targets, npm scripts,
  Gradle tasks (`make`, `npm run`, `./gradlew`, `just`).
- `RUNS_CODE` when it runs code or sends a request given in its arguments, so that what it can
  publish is in those arguments (`python3`, `node`, `bash`, `perl`, `xargs`, `curl`).

Three kinds of key need care:

- A key that is a task runner and one more word is one task: `make check`, `./gradlew :app:test`,
  `npm run build`. Judge that task. Building, testing, checking, linting, formatting, and cleaning
  are `NEVER`; a task named for publishing, releasing, or deploying is `CAN_PUBLISH`.
- Sending commits or files that already exist somewhere else, as `git push`, `git fetch`, and
  `rsync` do, is `NEVER`: their text is read when it is written.
- A word after a known tool that is not one of its subcommands, such as a directory given to a flag
  (`git caffeine` from `git -C caffeine log`), is `NEVER`, because the real subcommand is a key of
  its own. For a tool you do not know, doubt is `CAN_PUBLISH`.

Judge each key by the command's name and what that command is for. Do not judge the text in this
command.

Reply with one line per key and nothing else: the key exactly as given, a tab, and the class.
