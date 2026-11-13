---
max_turns: 8
tags: [comment, style]
runs: 2
---

Write a one- or two-line code comment to go above this guard. Reply with the comment only.

```kotlin
if (declared.strictVersion.isNotEmpty() && candidate !in declared.strictRange) continue
```

Why the guard exists: the build declares a strictly range, and a candidate outside it can never be selected — Gradle's resolution refuses it — so a report that offers it as an available update is telling the user about an upgrade the build cannot take. The range check is the same one Gradle applies during resolution.
