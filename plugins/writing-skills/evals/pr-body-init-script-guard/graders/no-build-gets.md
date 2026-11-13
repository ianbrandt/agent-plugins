---
type: regex
pattern: '\b(builds?|projects?|scripts?)\b(?:(?![.!?]\s)[^\n]){0,120}?\b(gets?|keeps?|refers? to)\b'
flags: i
match: not_contains
---
