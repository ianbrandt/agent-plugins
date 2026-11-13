---
max_turns: 8
tags: [commit, style]
runs: 2
---

Write a commit message for this fix. Reply with the message only.

Bug: when a plugin is declared through a version catalog alias with a strictly bound, the report says the bound comes from the plugins block declaration — the wrong source. The fix reads the bound from the catalog entry, whose file is now printed as the source. A regression spec covers the alias case.
