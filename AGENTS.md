# Agent notes for this repo

## TODO.md is the inter-machine handoff

Work moves between the Mac and the Windows machine through `TODO.md` at
the repo root. On this machine, add the next step as a new `##` item. On
the other machine, carry the item out, and commit the results as a
replacement item under the same heading. A commit reaches the other
machine by a push that the user asks for, never by a step in an item.
The file itself is never deleted; when nothing is pending, only the `# To do`
heading remains.

A probe item: an imperative-form title ("Check …"), numbered steps with
the exact commands to run, and a closing instruction on what to do with
the results. A results item: an analysis-form title ("Analyze the …
results") and sections for what matched, what differed, and what is
still open.

## Clean up scratch probe directories

Scratch directories written under `$env:TEMP` (`backstopprobe`,
`hookprobe`, …) or `/tmp` are removed at the end of the session that
created them, with `Remove-Item -Recurse -Force` on Windows or `rm -rf`
on the Mac. The probe repos and their remotes are disposable.
