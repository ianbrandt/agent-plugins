---
name: import-codex-models
description: "Copy Codex model ids from the user's Codex `config.toml` into Confer's user settings, so that each Confer tier runs on an id Codex can serve. Run once after installing Confer against a non-OpenAI Codex provider, and again whenever the user's Codex models change."
---

# Confer import Codex models

Copy the Codex model ids from the user's Codex `config.toml` (and its catalog, where
there is one) into Confer's user settings, filling `codexRoutineModel`,
`codexComplexModel`, `codexCriticalModel`, and `codexEscalationModel`.

Use this when the user's Codex provider does not serve the standard OpenAI
subscription model ids: a self-hosted LiteLLM gateway, a corporate
OpenAI-compatible endpoint, or any other `[model_providers.*]` block with its
own slugs.

## Steps

1. **Resolve the Codex home.** On Windows, use `$env:CODEX_HOME` if set, else
   `$env:USERPROFILE\.codex`. On POSIX, use `$CODEX_HOME` if set, else
   `$HOME/.codex`. Stop with a clear message if the directory does not exist.
2. **Read `<codex-home>/config.toml`.** Extract the top-level `model = "<id>"`
   and the optional `model_catalog_json = "<path>"` by regex on the top-level
   lines (both keys live at the top of the file by Codex convention; full TOML
   parsing is not needed). Stop if the file is missing, if no `model` key is
   found, or if its value is empty.
3. **Read the catalog, where one is set.** If `config.toml` includes a
   `model_catalog_json` entry, read that JSON file. Expect
   `{ "models": [{ "slug": "...", "priority": N }, ...] }`. Sort the entries
   by `priority` ascending (lower number = higher slot in Codex's catalog UI).
   If the catalog cannot be read or parsed, warn the user and fall through to
   the no-catalog case in step 4.
4. **Build the tier-to-slug mapping.**
   - Two or more catalog entries: the lowest-priority slug fills
     `codexCriticalModel` and `codexEscalationModel`; the next fills
     `codexRoutineModel` and `codexComplexModel`.
   - Exactly one catalog entry: that single slug fills all four tiers.
   - No catalog, or catalog read failed: the top-level `model` from
     `config.toml` fills all four tiers.
5. **Open the Claude Code user settings.** Resolve the path in this order:
   `$env:CLAUDE_CONFIG_DIR\settings.json` where that variable is set (as it
   is on a managed machine that redirects `.claude` out of the user profile);
   `$env:USERPROFILE\.claude\settings.json` otherwise on Windows;
   `$HOME/.claude/settings.json` on POSIX. Create the file with
   `{"pluginConfigs": {}}` if it is missing. Stop if the file is present but
   not valid JSON; report the parse error and the line, and do not try to
   rewrite it.
6. **Find the Confer plugin key.** Under `pluginConfigs`, use the first key
   whose name is `confer` or starts with `confer@`. If neither is present,
   create `confer@ianbrandt`.
7. **Write the four tier values** under
   `pluginConfigs.<key>.options.codexRoutineModel`,
   `.codexComplexModel`, `.codexCriticalModel`, and
   `.codexEscalationModel`. Create each key if missing, else overwrite it;
   only the keys the user has touched appear under `options` by default.
   Preserve every other key in the file.
8. **Report back the four resulting ids** with the Codex home and the files
   read. Mention the fallback explicitly when the mapping came from a short
   catalog or from the top-level `model` alone.

## Notes

- The priority-based tier mapping is a Confer convention, not something Codex
  documents. Where a user's provider does not match the lowest-priority slug
  with the most capable model, the user tunes any tier by hand through
  `/plugin` after the import.
- Existing values under the four tier keys are overwritten on each import.
  Warn the user before writing where the keys already contain user-set ids
  that differ from both the plugin's packaged defaults (`gpt-6.1-sol`,
  `gpt-6-astra`) and the ids about to be written.
