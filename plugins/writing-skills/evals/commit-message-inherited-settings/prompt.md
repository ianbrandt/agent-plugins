---
max_turns: 8
tags: [commit, style]
runs: 2
---

Write the commit message for this change, subject line plus a short body. Reply with the message only.

The change: in a Gradle dependency-update plugin, the report task now applies the root project's settings (the revision, the release channel, and the reject rules) to the entries it merges from an included build. Before this, entries merged from an included build were reported with that build's own settings, so with pre-release rejection configured in the root project, pre-releases were still listed for included builds. Two specs were added.
