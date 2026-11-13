---
max_turns: 8
tags: [comment, style]
runs: 2
---

Write a short GitHub comment for the maintainer of a project I contribute to. Reply with the comment only.

Context: I have two merged PRs, #1092 (a task property that rejects versions outside the declared bound) and #1093 (a task property that rejects pre-releases, with a preReleaseVersionIf hook for custom patterns). I am about to open a third PR that improves composite build support, and the two properties matter for it because a filter written as a build-script closure cannot be serialized into the configuration cache — the merged report of a composite build knows nothing about it — while a boolean task property carries over. The comment should tell him why the two merged properties matter for the composite PR, briefly.
