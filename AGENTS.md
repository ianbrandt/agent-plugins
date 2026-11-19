# Agent notes for this repo

## TODO.md is the inter-machine handoff

Work moves between the Mac and the Windows machine through `TODO.md` at
the repo root. On this machine, add the next step as a new `##` item. On
the other machine, carry the item out, and commit the results as a
replacement item under the same heading. The file itself is never deleted; when nothing is pending, only the `# To do`
heading remains.

A probe item: an imperative-form title ("Check …"), numbered steps with
the exact commands to run, and a closing instruction on what to do with
the results. A results item: an analysis-form title ("Analyze the …
results") and sections for what matched, what differed, and what is
still open.

## Project facts go in the repo

Project goals, conventions, and design decisions go in this file,
`CONTRIBUTING.md`, or a plugin's `docs/DESIGN.md`. An agent's memory is
kept for facts specific to one machine.

## Report a refusal under managed settings

On a machine with managed settings, Claude Code refuses some calls from a
plugin outside the organization's policy: a write of a Claude Code settings
file, a command with the path of one in its arguments or input, and a command
that runs a shell or an interpreter with a string from the model's tool calls
in the turn that the user's permission rules would not allow as a Bash
command. In the plugins here such a refusal is reported with an explanation
before Claude Code's message: what was refused, and what the user can do
instead. The call is never reshaped to get past the check, as by moving the
path into an environment variable or another spelling.

A different call without the effect the check guards against is not a
reshaping. For its ignore check Confer lists the ignored files under `.claude`
with `git ls-files` rather than pass the settings file's path to
`git check-ignore`: both are reads, and neither writes the file.

## Clean up scratch probe directories

Scratch directories written under `$env:TEMP` (`backstopprobe`,
`hookprobe`, …) or `/tmp` are removed at the end of the session that
created them, with `Remove-Item -Recurse -Force` on Windows or `rm -rf`
on the Mac. The probe repos and their remotes are disposable.
