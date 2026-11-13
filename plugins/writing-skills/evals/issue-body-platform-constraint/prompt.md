---
max_turns: 8
tags: [issue, style]
runs: 2
---

Write the body of a GitHub issue reporting this defect to the maintainer of a Gradle plugin. One to three sentences of problem statement, then the reproduction as a fenced block. Reply with the body only.

The defect: the report doesn't know about platforms: it says a later version is available for a library even when a platform (BOM) applied to the build holds that library at an exact version — the upgrade the report offers cannot be applied. Reproduction: a build with `implementation(platform("org.springframework.boot:spring-boot-dependencies:3.3.0"))` and `implementation("com.fasterxml.jackson.core:jackson-databind")`, running `./gradlew dependencyUpdates`, prints `jackson-databind [2.17.1 -> 2.18.2]` although the platform pins 2.17.1. Verified on v0.51.0.
