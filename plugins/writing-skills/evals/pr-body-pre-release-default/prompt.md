---
max_turns: 8
tags: [pr, style]
runs: 2
---

Draft the pull request description for this branch. Keep it short; the maintainer knows the codebase. Reply with the body only.

What the branch does: the report now prints a breadcrumb for dependency updates, current version, then latest stable, then latest pre-release, the same form already printed for Gradle updates. The rejectPreReleases task property, which merged after the last release and has not shipped, now defaults to false so the pre-release step is printed by default; with it set to true the row is printed as before. The gradleReleaseChannel option keeps its released default of release-candidate. Three specs were added and the README section on pre-releases was updated. The issue is #440.
