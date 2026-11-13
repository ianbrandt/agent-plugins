# Picking a tier

Pick the tier for a `plan`, `review`, or `ask` run before either model starts, and pass it to
`chooseTier` with `isSure`. Set `isSure` to false when the task sits between two tiers, and the
user is asked, with your pick first.

- **Routine**: a small change with precedent, where a defect would show up in tests or at once.
- **Complex**: a change spread over several modules, or a design with little precedent to follow.
- **Critical**: security, data loss, a public API or wire contract, or logic that fails silently,
  whatever the size.
- **Escalation**: never your pick. It runs when the user asks for it with `--tier escalation`, or
  picks it when asked, typically after a round stalled.

Take the higher of the two tiers that complexity and criticality point to, so a small change to
silent-failure logic is critical. A plan is tiered by what being wrong would cost, read against the
same rows. A question is tiered by what acting on a wrong answer would cost, read against the
same rows. The Claude model and effort for each tier, and the Codex model, are plugin settings,
with their defaults in `.claude-plugin/plugin.json`.

## Fable usage

Before each start call and each `review_fixes` call, call `mcp__ccd_session_mgmt__get_usage` where
it is listed, loading it with `ToolSearch`. Pass the `percentUsed` of the `plan.windows` entry
labeled `Weekly · Fable` as `fableUsedPercent`. Leave the field out where the tool is not listed,
`plan.status` is not `ok`, or no such window is returned. On an error about the field, call again
without it.

When a result includes `fallback`, tell the user why Opus runs in place of Fable, with the models:
for reason `not-served` the account is not served Fable, and for reason `usage` the weekly Fable
limit is `percent`% used. For reason `usage` after a start call, add that `--claude-model fable` runs Fable anyway. A fix
review takes no model flag.
