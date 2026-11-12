# gradle-skills

A [Claude Code](https://claude.ai/code) plugin providing skills for working with Gradle projects.

Claude Code 2.1.308 is the oldest version supported. This plugin has no hooks and needs no shell or interpreter beyond the build's Gradle wrapper.

## Skills

### `upgrade-dependencies`

Guides Claude through checking, upgrading, and verifying Gradle dependencies one at a time, including settings plugins (those applied in the `plugins { }` block of `settings.gradle(.kts)`). Claude iterates through every available update automatically, committing each verified upgrade as its own atomic commit (one per dependency), and optionally pushes once all upgrades pass.

Updates come from the [Gradle Versions Plugin](https://github.com/ben-manes/gradle-versions-plugin)'s `dependencyUpdates` JSON report, run once per build, so composite builds (`includeBuild`) and `buildSrc` are covered. Where a build does not apply the plugin, Claude injects it with a temporary init script, leaving the build unmodified.

**Requires:** Gradle 8.4 or later. Optionally enriched by the [dependency-analysis-gradle-plugin](https://github.com/autonomousapps/dependency-analysis-gradle-plugin) (for the `buildHealth` verification task).

**Works with:** any Gradle project, single or composite. Versions are upgraded where they are declared: a [version catalog](https://docs.gradle.org/current/userguide/platforms.html) (`libs.versions.toml`), a `settings.gradle(.kts)` `plugins { }` block, or a build script.

**Workflow:**
1. Settle the per-round and final verification tasks, and whether to push once everything passes (commits are automatic—one atomic commit per verified upgrade)
2. Enumerate the builds (root, every `includeBuild` target, and `buildSrc`) and run `dependencyUpdates` in each, through an init script where the build does not apply the plugin, or once from the aggregating build where `dependencyUpdatesAggregation` merges the others into its report
3. Update one dependency or settings plugin at a time, where it is declared
4. Verify with the chosen tasks after each change (adding `--rerun-tasks` when a from-scratch check is warranted); when a major-version bump fails, retry once at the latest minor
5. Commit each verified change and continue automatically through every update; push only after a final verification passes and a closing `dependencyUpdates` run shows nothing left outdated, and only if you opted into push

**Build output:** Each verification build runs in the background with its output written to a log file, and only the verdict is read back. The raw Gradle output stays out of the conversation, reducing context and plan (token) usage across a multi-round run.

### `upgrade-gradle`

Guides Claude through upgrading the Gradle wrapper to the latest available version.

**Requires:** nothing. The latest version comes from Gradle's [version service](https://services.gradle.org/versions/current), so no plugin needs to be applied.

**Works with:** any Gradle project with a [Gradle wrapper](https://docs.gradle.org/current/userguide/gradle_wrapper.html), single or composite: every wrapper in the project is upgraded, each in its own build.

**Workflow:**
1. Query `services.gradle.org/versions/current` for the latest Gradle version
2. Find every `gradle-wrapper.properties` in the project (the wrapper task is per-build, so each is upgraded in its own directory), and every `includeBuild` target with no wrapper of its own
3. For each: if that build's script has a `wrapper` task configuration, update the version there; otherwise pass it with `--gradle-version`, along with the distribution type and checksum where the build pins them. Either way, run `./gradlew wrapper` twice: the second run, on the new Gradle, regenerates `gradle-wrapper.jar` and the `gradlew` scripts
4. Run `build` to validate the upgrade, plus `:<name>:build` for each included build without a wrapper and any verification tasks documented in the repo, then check the log for a deprecation summary

**Build output:** The validation build runs in the background with its output written to a log file, and only the verdict is read back.

## Installation

Install at user scope (available across all your projects):

```
/plugin marketplace add ianbrandt/agent-plugins
/plugin install gradle-skills@ianbrandt
```

### Bash permissions (optional)

The dependency update workflow runs `./gradlew` tasks and `git` commands (it commits each verified upgrade automatically). To avoid per-invocation approval prompts, add these permissions in `~/.claude/settings.json`:

```json
{
  "permissions": {
    "allow": [
      "Bash(./gradlew dependencyUpdates:*)",
      "Bash(./gradlew build:*)",
      "Bash(./gradlew buildHealth:*)",
      "Bash(./gradlew wrapper:*)",
      "Bash(git add:*)",
      "Bash(git commit:*)",
      "Bash(git push:*)"
    ]
  }
}
```

`git add` and `git commit` are used on every dependency run, but `git push` is needed only if you opt into push. If you choose verification tasks beyond the defaults (e.g. a `clean` cumulative run), add matching `Bash(./gradlew …)` entries.

`upgrade-gradle` reads the latest Gradle version and its checksum from [services.gradle.org](https://services.gradle.org/versions/current) over HTTPS (via `curl` or a web fetch). Allow that mechanism if you want to avoid a prompt for it.

## Updating

```
/plugin marketplace update ianbrandt
/plugin update gradle-skills@ianbrandt
```

## Usage

Invoke the skill by name:

```
/gradle-skills:upgrade-dependencies
/gradle-skills:upgrade-gradle
```

## License

MIT
