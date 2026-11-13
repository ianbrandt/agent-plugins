---
max_turns: 8
tags: [pr, style]
runs: 2
---

Write the PR description. Two to four sentences, no headings. Reply with the body only.

The PR changes the README's init script so it applies the settings plugin from settingsEvaluated instead of beforeSettings, and only when a build doesn't apply it already. With the old script, configuring DependencyUpdatesTask by type failed in most builds that also apply the plugin, because the task was registered by the init script's copy of the class. One case is still broken: a build that applies io.github.ben-manes.versions in its root build script still gets two copies of the plugin, since the init script runs before that plugins block. The README section now includes the steps to move such a build to the settings plugin.
