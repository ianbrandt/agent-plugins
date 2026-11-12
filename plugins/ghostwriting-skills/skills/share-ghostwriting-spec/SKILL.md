---
name: share-ghostwriting-spec
description: >-
  Export the user's voice spec as an anonymized seed another writer can
  bootstrap from: keep the Voice, per-genre form, and Procedure sections, drop
  the delta log and corpus, scrub identifying content, and write the result to
  a file the user reads before sharing it. Trigger on "share my voice spec",
  "export my spec", "anonymize my spec", or "make a team spec". NOT for
  drafting text (that's ghostwrite), and never for exporting the corpus or the
  delta log.
---

# Share a ghostwriting spec—anonymized export

The export is a **seed**: house style another writer bootstraps from, not a copy of the user's
voice. The user reviews the export you build before it leaves their machine, and **only the user
shares it.**

## 0. Locate the spec
A `## Voice directory, located by the plugin` section follows this skill's text. `$VOICE` below is
the directory on its `VOICE=` line: the plugin's `voice_dir` option, then `$GHOSTWRITING_DIR`, then
`~/.claude/ghostwriting`. The next line is the spec's path, or `NO SPEC`.

No spec ⇒ stop and say so; bootstrap first (ghostwrite §5).

## 1. Select what ships
Start from `voice-spec.md` and keep every body section except the delta log: **Voice**, the
per-genre form, **Procedure**, and any further house-style sections that were added to the spec
(posting mechanics for a platform, register with a particular kind of collaborator). Match that
section by what is in it—one entry per genre, giving what goes in, in what order, and what never
appears—not by its title. In `ghostwrite` §5 it is **Per-genre form**, and in a spec written
before that convention it may be titled something else, **Per-genre caps** among them.

- **The delta log and the corpus never ship.** Replace the log with an empty one. Sweep the
  dropped log for any rule not yet promoted into the body; carry the rule text over, never an
  entry's exhibits.
- **Keep the house style, and mark the voice for refitting.** Keep the caps and any other
  house-style section as-is. Mark the Voice section as a placeholder the recipient refits from their
  own samples during bootstrap—a recipient who keeps it would be writing as the exporter, not as
  themselves.

## 2. Scrub the remainder
Check every line that ships against this list, and rewrite or drop what matches:
- person, team, and org names;
- repo, project, and product names;
- URLs and issue/PR references;
- quoted or paraphrased draft text;
- dates or events tied to identifiable work.

A rule that can't be stated without its private referent doesn't ship.

## 3. Write it, then hand over the path
Write the export to `$VOICE/voice-spec-seed.md`, overwriting any earlier run, and give the user
that path. Nothing else: a spec-sized document pasted into chat is unreadable and unusable, so
the general rule that text awaiting approval goes in the reply deliberately does not apply here.

- The seed file sits beside the spec and is a build output. If `$VOICE` is versioned, say so once
  and suggest ignoring `voice-spec-seed.md`.
- Do not write, upload, or send the export anywhere else. Scrubbing is a first pass; the user's read
  of that file is the last anonymization check, and only the user shares it.
- Say in one line what the scrub dropped and any judgment call worth their attention.

## 4. Seeding a recipient
The recipient runs the ghostwrite bootstrap (§5) with the export as the seed spec: the caps are
kept, the Voice placeholder is refit from their samples, and their delta log starts empty and
diverges from there. One seed can serve a whole team, and each writer still ends up with a spec of
their own.
