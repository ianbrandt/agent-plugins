---
max_turns: 8
tags: [tests, style]
runs: 2
---

Suggest five Spock specification method names (the quoted-string style, like `def "prints the current version"()`) for these behaviours. Reply with the five names only.

1. When a platform holds a dependency at its current version, the row says which platform, by its coordinates.
2. When that platform is itself outdated, the row carries the platform's later version too.
3. When no platform applies, the row is printed as before.
4. When two platforms hold the same dependency, the row names both.
5. When the constraint comes from a dependency's own strictly bound — not a platform — the row says nothing extra.
