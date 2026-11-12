---
name: upgrade-dependencies
description: Check for and upgrade Gradle dependencies and settings.gradle plugins one at a time, verifying each.
paths: "**/libs.versions.toml,**/settings.gradle.kts,**/settings.gradle"
---

# Upgrade Dependencies

Check for, upgrade, and verify Gradle dependencies one at a time. No prerequisites: the Gradle
Versions Plugin's `dependencyUpdates` task reports the updates, and the plugin is injected by an init
script into any build without it. The plugin needs Gradle 8.4 or later; on an older wrapper, run
`upgrade-gradle` first or ask the maintainer.

Every configuration's declared dependencies are reported, including the settings and build-script
classpaths, but versions that arrive only transitively are not. `buildHealth`, where applied,
enriches verification.

## Composite and included builds

Each directory with its own `settings.gradle(.kts)` is a build, and so is `buildSrc`. Each has its own
catalog, repositories, and plugins, and gets its own report (step 2), unless its report is merged
into another build's through `dependencyUpdatesAggregation`:

```
find . \( -name 'settings.gradle.kts' -o -name 'settings.gradle' -o -type d -name buildSrc \) \
  -not -path '*/build/*' -not -path '*/.claude/worktrees/*'
grep -rn --include='*.gradle.kts' --include='*.gradle' dependencyUpdatesAggregation . \
  | grep -v -e '/build/' -e '/.claude/worktrees/'
```

## Running a verification build

Run every **verification** build (steps 5 and 6) from the main thread, as one background command
(`run_in_background` in Claude Code) with its output redirected to a log file in a temp or scratch
directory outside the repo. Do not delegate it to a sub-agent: a sub-agent is not re-invoked when a
background command it started exits, and a foreground call is capped at 10 minutes, so a sub-agent
either returns before the build has a verdict, which kills the build, or cannot run a longer build at
all.

## Workflow

### 1. Set the run options

1. **Verification tasks**—run after each change (step 5) and once at the end (step 6). Where
   validation commands are documented in the repo, as in its `CLAUDE.md`, or a verification routine
   for this project is in the user's memory, use those over the defaults here.
   Single-build default: `build buildHealth` (drop `buildHealth` if that plugin is absent).
   Lifecycle tasks do not fan out across included builds: address an included build's task by full
   path (`:included:task`), and include any aggregator task reaching builds the root lifecycle does
   not—e.g. `build :modules:buildHealth examplesCheck`. When the right set is not obvious, propose
   one from the enumeration and confirm it with the maintainer. Step 6 may use a heavier set
   (`clean build buildHealth`).

2. **Push**—the only opt-in, default off. Push only after every round and the final verification pass,
   and only if the maintainer opted in.

**Commits are automatic.** Iterate through every update without stopping for approval, committing each
verified round as its own atomic commit (step 4) in the repo's commit-message convention (derive it
from recent `git log`). Never fold multiple dependencies into one commit; batch only what must move
together (step 4).

One dependency update plus its verification is one **round**.

### 2. Check for updates

Run `dependencyUpdates` once per build, from that build's directory. A build listed in a
`dependencyUpdatesAggregation` entry is the exception: with Versions Plugin 0.66.0 or later, every
project of that build is merged into the aggregating build's report. Run `dependencyUpdates` once
from the aggregating build, and run it separately only in the builds not listed in any entry.

```
./gradlew dependencyUpdates --output-formatter=json -q -p <build-dir>      # plugin already applied
./gradlew dependencyUpdates --output-formatter=json -q -p <build-dir> \
  --init-script <absolute-path>/gvp.init.gradle.kts                        # plugin not applied
```

The plugin is already applied when `ben-manes.versions` appears in that build's settings script,
build scripts, catalog, or build logic, or in `~/.gradle/init.d`. **Never add the init script to
such a build:** where `DependencyUpdatesTask` is configured by type in the build, it fails with "is
not a subclass of the given type". An init script applies to every build in one invocation, so run
each build on its own with `-p`, never as `:included:dependencyUpdates` from the root.

Settings plugins are reported where `io.github.ben-manes.versions.settings` is applied, as the init
script does, and where the core ID `io.github.ben-manes.versions` is applied in the settings
`plugins { }` block. Where the plugin is applied only in build scripts, look up each plugin in
the settings `plugins { }` block by hand: fetch
`https://plugins.gradle.org/m2/<id-with-dots-as-slashes>/<id>.gradle.plugin/maven-metadata.xml`, or
the same path under that build's `pluginManagement { repositories }`, and take the highest stable
version.

Write the init script outside the repo, in a temp or scratch directory, and pass its absolute path:
`--init-script` resolves a relative path against the working directory, not against `-p`.

```kotlin
import com.github.benmanes.gradle.versions.VersionsSettingsPlugin

initscript {
  repositories { gradlePluginPortal() }
  dependencies { classpath("io.github.ben-manes:gradle-versions-plugin:latest.release") }
}

gradle.beforeSettings(Action<Settings> {
  pluginManager.apply(VersionsSettingsPlugin::class.java)
})
```

Read each report with `jq`, from `build/dependencyUpdates/report.json` under the build directory
unless `outputDir` or `reportfileName` is set on the task:

- **`.outdated.dependencies[]`**: `group`, `name`, `version`, and `available`. The newest release is
  in whichever of `available.release`, `.milestone`, or `.integration` is set, matching the task's
  `revision`. `available.minor` is the newest version in the current major, `available.patch` the
  newest in the current minor. Take `available.preRelease` only when the current version is itself a
  pre-release.
- A plugin, from a settings or build `plugins { }` block, is reported by its marker,
  `<id>:<id>.gradle.plugin`.
- **`.exceeded`**: re-run that build with `--refresh-dependencies`. Never use it on the first run.
- **`.unresolved`** and **`.skipped`**: carry them into the step-7 report; they are not upgrades.
- **`.gradle`**: a newer Gradle. Mention it; `upgrade-gradle` handles it.

Versions outside a `strictly` or `reject` bound, or outside a consumed platform's constraints, are
already left out of the report. Where the plugin is already applied, the rules the maintainer set on
the task apply too.

Find where each entry is declared: a `libs.versions.toml` alias or `[versions]` entry, a
settings `plugins { }` block, or a build script. In a Versions Plugin 0.66.0+ report of more than
one project, the projects where an entry is declared are listed in its `declaringProjects` field;
`projects` is present only where versions differ between projects. An entry declared nowhere in the
build, such as the Kotlin compiler classpath filled by `kotlin-dsl`, is not an upgrade: list it in
step 7 and move on. The same coordinate and version declared in one shared catalog, or repeated
across settings files, is **one** update, and so are entries for different coordinates that share
one `[versions]` reference.

### 3. Self-update the Gradle Versions Plugin first

If the plugin is applied in a build and has an update
(`io.github.ben-manes.versions`, `io.github.ben-manes.versions.settings`, or the deprecated
`com.github.ben-manes.versions`), upgrade only that plugin before anything else: run it as a normal
round (step 4), then re-run step 2 and continue from the refreshed report. Keep the plugin ID
already in use unless asked.

In that round, read the "Migrating from prior versions" section of the plugin's
[README](https://github.com/ben-manes/gradle-versions-plugin#migrating-from-prior-versions), from the
subsection for the current version up through every version skipped over. Apply each *Important*
item in the same round, and raise each *Tip* with the maintainer.

### 4. Update one dependency at a time

One dependency per round, one commit per round. Settings plugins count as single dependencies.

**Prioritize by compatibility relationships:**
1. Build toolchain plugins (compiler plugins, annotation processors, code generators)—update and test
   with the CURRENT language/platform version BEFORE upgrading the language/platform itself
2. Other Gradle plugins, settings plugins included, before any library
3. BOM/platform dependencies before their constituent libraries
4. Core libraries before their dependents
5. Independent libraries last

A settings plugin that affects the toolchain, such as a toolchain resolver, goes with the toolchain
updates.

**Each round:**
1. Update only its version, to the newest release from step 2, where it is **declared**: in that
   build's `libs.versions.toml` (never another build's catalog), in the `settings.gradle(.kts)`
   `plugins { }` block for an inline-versioned settings plugin, or in the build script. When the
   same settings-plugin id+version repeats across files, update **all** of them in this one round,
   and likewise every entry that shares a `[versions]` reference.
2. Identify affected modules: for catalog entries, search for usages of the alias; for a settings
   plugin, note the declaring file(s)
3. Run verification (step 5)
4. If it passed, commit this single dependency and continue straight to the next round without
   pausing. If it failed on a major-version bump and an `available.minor` newer than the current
   version is listed for the entry, revert and retry once at that minor; if that passes, commit it,
   record the major as blocked, and continue. Any other failure: **stop and report; do not commit,
   do not push, do not touch another dependency.**

**Watch for:** compiler/toolchain API changes; breaking changes in build plugins or test frameworks;
behavioral changes affecting existing code; new deprecations or required source changes;
settings-plugin major bumps (review release notes for renamed DSL extensions or a raised minimum
Gradle version).

**Batching:** only when dependencies *must* move together (a library and its required companion
version). Explain why; still one round, one commit.

### 5. Verification

After each version change:

```
./gradlew <per-round tasks> > <log> 2>&1
```

Single-build default `./gradlew build buildHealth`; composite, the step-1 set, e.g.
`./gradlew build :modules:buildHealth examplesCheck`.

`--rerun-tasks` is your judgement, default off: reach for it only when you distrust the incremental
result—a toolchain / compiler-plugin or code-generator upgrade, signs of stale caching (a task
reported `UP-TO-DATE` that the change should have touched, or entries under `.exceeded`), or a
deliberate from-scratch check.

Wait for the command's exit notification:

- **Success:** exit code 0. The log stays unread. When `buildHealth` ran, confirm it passed by
  reading `build/reports/dependency-analysis/should-fail.txt` under the root project it ran in:
  `false` there means it passed. Grepping the log for its result is unreliable.
- **Failure:** any other exit code. Take which task failed and the actionable error block (compiler
  errors with `file:line`, failed test names with the assertion, or the `buildHealth` advice) from
  the log with `grep -a`, not by reading the whole log: only what is needed to decide fix-vs-revert.

Verification must pass before a round is committed.

### 6. Final verification, then push

After every round has passed and been committed, run `./gradlew <final tasks>` once, the same
way as step 5. May use the heavier step-1 set; a from-scratch check is often worth
`--rerun-tasks` even when the per-round builds ran without it. Skip this run when the last round
already ran the final task set on the same tree.

Then re-run `dependencyUpdates` as in step 2 and confirm the report shows 0 outdated, apart from the
entries listed in step 7 as held back or not upgraded.

- If either check fails, **stop and report; do not push.**
- If both pass and push was enabled in step 1, `git push`. Otherwise stop
  here, with every verified upgrade committed for the maintainer.

### 7. Reporting

- What changed and why
- Verification results, per-round and final
- Majors held back at their latest minor, with the failure that blocked each
- Entries not upgraded: unresolved, skipped, and those declared nowhere in the build
- What was committed and whether the branch was pushed; if push was off,
  note the commits are left for the maintainer
- *Tip*s from the Versions Plugin's migration notes (step 3)
- If a round or the final verification failed, exactly where the run stopped and what was and was not
  committed or pushed
- Follow-up ideas kept separate from completed work

## Constraints

- **Version catalog:** Do not rename aliases, bundles, or plugin aliases unless asked. Maintain
  existing formatting and style.
- **Settings plugins:** Upgrade inline versions in place; do not migrate them into the catalog unless
  asked.
- **Versions Plugin:** Do not apply it to the build, or leave the init script in the repo, unless
  asked.
- **Scope:** Keep diffs focused and minimal. No unrelated refactors, no unrelated version changes, no
  new dependencies without clear justification.
- **Git:** Do not create branches unless explicitly instructed. (Commit and push rules: steps 1, 4,
  5, 6.)
