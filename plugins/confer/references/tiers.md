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
same rows. The model and effort for each tier are in `src/tier/tier.ts`.
