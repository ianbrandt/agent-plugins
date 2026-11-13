---
type: regex
pattern: '\b(the|a|an|this|that|its|each|every|no)\s+(\w+\s+){0,2}(report|build|entry|option|version|pr|file|commit|test|spec|setting|property|task|plugin|row|section|paragraph|title|readme|changelog|body|message|comment|flag|value|script|block|catalog|alias|constraint|bound|closure|recipe|hook)\s+(says|tells|wants|knows|decides|claims|asks|declares|carries|holds|owns|names|states|expects|believes|thinks|intends|refuses|assumes|promises|configures|judges|offers)\b|\b(report|build|entry|option|version|pr|file|commit|test|spec|setting|property|task|plugin|row|section|paragraph|title|readme|changelog|body|message|comment|flag|value|script|block|catalog|alias|constraint|bound|closure|recipe|hook),?\s+whose\b'
flags: i
match: not_contains
---
