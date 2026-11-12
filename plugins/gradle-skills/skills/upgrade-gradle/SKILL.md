---
name: upgrade-gradle
description: Upgrade the Gradle wrapper to the latest version, with build validation.
paths: "**/gradle-wrapper.properties"
---

# Upgrade Gradle

Upgrade every Gradle wrapper to the latest stable version and validate the build. No prerequisites.

## Running the validation build

Run the step-4 validation build from the main thread, as one background command (`run_in_background`
in Claude Code) with its output redirected to a log file in a temp or scratch directory outside the
repo. Do not delegate it to a sub-agent: a sub-agent is not re-invoked when a background command it
started exits, and a foreground call is capped at 10 minutes, so a sub-agent either returns before
the build finishes, which kills the build, or cannot run a longer build at all.

## Workflow

### 1. Discover the version

```
https://services.gradle.org/versions/current             # latest stable
https://services.gradle.org/versions/release-candidate   # current RC, or {} if none
```

Use `version` from the stable response. Mention an available RC; adopt it only if the maintainer asks.

On a minor or major bump, skim the upgrade guide for the new version and report anything that affects
this build: `https://docs.gradle.org/<version>/userguide/upgrading_version_<major>.html` within a
major, `upgrading_major_version_<major>.html` across one. A patch bump needs no guide.

### 2. Find every wrapper

```
find . -name gradle-wrapper.properties -not -path '*/build/*' -not -path '*/.claude/worktrees/*'
```

Each hit is a separate build with its own wrapper. Upgrade each in its own directory (steps 3–4).

An included build without a wrapper of its own runs on the including build's Gradle. There is no
wrapper to upgrade, but validate it all the same:

```
grep -rn --include='settings.gradle.kts' --include='settings.gradle' includeBuild . \
  | grep -v -e '/build/' -e '/.claude/worktrees/'
```

For each hit with no `gradle-wrapper.properties` of its own, add `:<name>:build` to that including
build's validation (step 4). `<name>` is the included build's directory name, or the `name` set in
its `includeBuild` block. Builds under `pluginManagement { includeBuild(...) }` count too.

### 3. Apply the upgrade

Check that build's root build script for a `wrapper` task configuration (`tasks.wrapper { ... }`,
`tasks.named<Wrapper>("wrapper") { ... }`, `tasks.named("wrapper") { ... }`, or any variation
configuring the `Wrapper` task).

Run the `wrapper` task **twice** either way. The first run, on the old Gradle, writes the new version
into `gradle-wrapper.properties`; the second, on the new Gradle, regenerates `gradle-wrapper.jar`,
`gradlew`, and `gradlew.bat`. Editing `distributionUrl` by hand and running `./gradlew help` leaves
the old wrapper jar in place.

If `distributionSha256Sum` is set in the properties file, the new distribution's checksum is
required: `https://services.gradle.org/distributions/gradle-<version>-<bin|all>.zip.sha256`, matching
the distribution type in the current `distributionUrl`.

**Path A—task exists** (it is the source of truth; `./gradlew wrapper` rewrites the properties file
from it):

1. Update `gradleVersion` in the task block, and `distributionSha256Sum` if it is set there. If a
   checksum is set in the properties file but not in the task, pass
   `--gradle-distribution-sha256-sum <sum>` on both runs
2. Run that build's `./gradlew wrapper` twice

**Path B—no task:** run this twice in that build, with the same options both times:

```
./gradlew wrapper --gradle-version <version> [--distribution-type all] \
  [--gradle-distribution-sha256-sum <sum>]
```

Pass `--distribution-type all` when the current `distributionUrl` ends in `-all.zip`, and the checksum
option when one is set in the properties file. A bare second `./gradlew wrapper` resets the
distribution type to `bin` and keeps the old checksum, so the next build fails verification.

### 4. Validation

```
./gradlew build [:<name>:build ...] [<repo tasks>] [--warning-mode=summary] > <log> 2>&1
```

Add the `:<name>:build` tasks from step 2, and any verification tasks documented in the repo, as in
its `CLAUDE.md` or `CONTRIBUTING`. A root `build` does not fan out across included builds. If it does
not transitively cover an upgraded wrapper's build, also run that build's `./gradlew build` or the
aggregator task reaching it; when the task set is not obvious, confirm it with the maintainer.

Gradle prints the deprecation summary line only in `summary` and `fail` modes. Pass
`--warning-mode=summary` unless `org.gradle.warning.mode=fail` is set in the build's or
`~/.gradle/gradle.properties`. Passing it would override that setting, so deprecations would no
longer fail the build.

Wait for the command's exit notification: exit code 0 is a pass. On a pass, read only one line:
`grep -a "Deprecated Gradle features were used in this build" <log>`. Report a hit, with a
suggestion to rerun with `--warning-mode all` to list the deprecations. On any other exit code,
take the failing task and the actionable error block (compiler errors with `file:line`, failed test
names with the assertion) from the log with `grep -a`, not by reading the whole log.
Must pass before reporting.

`--rerun-tasks` is your judgement: up-to-date checks ignore the Gradle version, so add it when the
validation must re-exercise the build. Validation build only.

### 5. Reporting

- Previous and new versions
- Every wrapper upgraded, and the modified files from `git status --short`. `gradlew` and
  `gradlew.bat` are often unchanged.
- Validation results, the tasks run, and any deprecation summary line
- Anything from the upgrade guide that affects this build
- A commit message in the style of recent `git log`. Commit only when the user asks, or as
  described in the repo's docs; otherwise leave the changes for the maintainer.

## Constraints

- **Scope:** Only the Gradle version. No dependency updates, build-logic changes, or unrelated
  refactors.
- **Git:** No `git commit`, `git push`, or branch creation unless the user asks, or as described
  in the repo's docs.
