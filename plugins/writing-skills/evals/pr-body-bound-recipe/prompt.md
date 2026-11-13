---
max_turns: 8
tags: [pr, style]
runs: 2
---

Write the PR description. Two to four sentences, no headings. Reply with the body only.

The PR replaces a README recipe — a rejectVersionIf closure named satisfiesDeclaredBound that the README told users to paste into their build scripts — with a task property rejectOutOfBoundVersions, on by default, that drops any candidate outside the version constraint the build declares for that dependency. The recipe could not be serialized into the configuration cache, so it never applied to the merged report of a composite build; the property is a boolean and serializes. The README now documents the property and the recipe is removed. Fixes #1091.
