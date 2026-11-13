---
name: sweep
description: >-
  Check the writing on a branch before it is pushed: the commit messages and
  the text the branch adds to docs, code comments, and test names, run through
  the lint tool in chunks. Report each hit, fix the files, and reword the
  commits not yet on a remote with a non-interactive autosquash rebase. Covers
  what the commit gate misses: commits made without the plugin, messages
  reworded in a rebase, code comments and test names, and a pattern repeated
  across commits. Trigger before a push or a pull request, from land-and-wrap,
  and on "sweep the branch". NOT for the whole repo, NOT for text already on a
  remote's default branch, and NOT for a single draft (call the lint tool on
  it directly).
---

# Sweep the branch

The range is the commits this branch will push. Text outside it is not read: the whole repo costs
one review-model call per chunk, gives a large diff of style edits, and would rewrite text already
published under the user's name, which is never edited after the fact.

## 1. Find the range

Take the range from the arguments where one is given, as `<base>..HEAD` or a bare base. Otherwise
the base is the remote default branch, `git rev-parse --abbrev-ref origin/HEAD`, or
`upstream/<default>` in a fork. Run every command with `git -C "$WT"`, where `$WT` is the checkout
the branch is in.

```
git -C "$WT" log --oneline "$BASE..HEAD"
git -C "$WT" rev-list "$BASE..HEAD" --not --remotes
```

The second list is the commits on no remote. Only those are rewritten. The message of a commit
already pushed, such as one on an open pull request, is left as it is, and a fix to the text that
commit added goes in a new commit.

## 2. Collect the text

- **Commit messages:** `git -C "$WT" log --format='%x1e%h%n%B' "$BASE..HEAD"`.
- **Prose files** (`.md`, `.markdown`, `.txt`, `.adoc`, `.rst`): each paragraph with a line added in
  `git -C "$WT" diff "$BASE...HEAD"`, as the paragraph reads at `HEAD`.
- **Source files:** each comment, doc comment, and test name the diff adds, with a whole comment
  block taken together.

Leave out generated files, lockfiles, vendored code, and text that quotes a violation on purpose:
test inputs to a lint, rule examples, eval prompts, and fixtures.

## 3. Lint it in chunks

Put each chunk in its own fenced block with the info string `draft`, one per commit message and one
per file, and pass several in the `text` of one `mcp__writing-skills__lint` call. Each fenced block
is reviewed as a separate draft. Write a label line before each fence, such as `commit a1b2c3d` or
`docs/DESIGN.md`, and nothing else outside the fences: the review model reads only the fenced
drafts, but the regex lint reads the whole input. A call reviews the first 50,000 characters of its
drafts, so start a new call before that. Each call is one review-model call, and with `WRITING_CONVENTIONS_STOP_READER=0` only the regex lint runs.

## 4. Report the hits

List each hit in the reply: the commit or `file:line`, the quoted text, and the rewrite. Where a
suggested rewrite reads worse than the original, or a finding is wrong, keep the text and give the
reason in one line.

## 5. Fix them

Start from a clean working tree, and record where the branch was: `ORIG=$(git -C "$WT" rev-parse
HEAD)`.

- **File text.** Find the commit that added the line with `git -C "$WT" blame -L <n>,<n> HEAD --
  <file>` before editing. Edit the file, then commit the fix with
  `git -C "$WT" commit --fixup=<sha> -- <file>`. Where that commit is already pushed, commit the fix
  with a message of its own instead.
- **Commit messages.** For each unpushed commit with a hit, write the new message to a file in the
  scratchpad with `Write`: the first line `amend! <sha>`, a blank line, then the whole new message.
  Commit it with `git -C "$WT" commit --allow-empty -F <that file>`. The commit gate reviews the new
  message as it would any other.

Then fold the fixes in, without moving the branch onto a newer base:

```
git -C "$WT" rebase --autosquash "$(git -C "$WT" merge-base "$BASE" HEAD)"
```

git 2.44 and later applies `--autosquash` without `-i`. Where a fixup conflicts with a later commit,
run `git -C "$WT" rebase --abort` and `git -C "$WT" reset --soft "$ORIG"`, then commit the staged
file fixes as one commit with a message of its own. The `amend!` commits are empty, so the reset
drops them, and the reply lists those messages as not reworded. Afterward
`git -C "$WT" log --oneline "$BASE..HEAD"` shows no `fixup!` or `amend!` subject.
