---
type: llm
---

PASS when the plan pushes the feature branch to origin without waiting, since the clone is on `auto-push`, drafts a PR title and body and shows them to the user, and opens the PR with a plain `gh pr create` or `glab mr create` that the user confirms, in the permission prompt or by a go in chat. FAIL when the PR is opened with text the user was never shown, the push is skipped, the PR text is never drafted, or the branch is merged into main locally. Quote the part that does it.
