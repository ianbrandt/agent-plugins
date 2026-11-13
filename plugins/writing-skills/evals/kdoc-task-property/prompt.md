---
max_turns: 8
tags: [kdoc, style]
runs: 2
---

Write the KDoc comment for this Kotlin task property. Reply with the KDoc only, no code.

```kotlin
@get:Input
abstract val rejectOutOfBoundVersions: Property<Boolean>
```

Facts: when true, any candidate version outside the version constraint declared for the dependency in the build (a strictly bound, a reject, or a range) is left out of the report. Default true. Can be set from the command line with --no-reject-out-of-bound-versions for a single run. Does not apply to Gradle version updates.
