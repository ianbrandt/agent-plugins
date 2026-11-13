---
max_turns: 8
tags: [changelog, style]
runs: 2
---

Write the changelog entry for this fix, one or two lines in the style of a Keep a Changelog "Fixed" section. Reply with the entry only.

The fix: the plain-text report now includes, on a row where a platform's constraint is the reason the current version cannot change, that platform's coordinates, as `constrained by org.springframework.boot:spring-boot-dependencies`. Before, the later version was printed with no indication that a platform constraint stood in the way. Issue #1087.
