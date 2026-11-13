// claude plugin test: lint() in lint.ts.
import { expect, test } from 'claude-code/testing'
import { lint } from './lint'
import { drafts } from './text'

// [group, text]. The cases are in this file because a test cannot read one:
// only code is loaded, and a test has no `$.fs`. A '-' group means the text
// must come back clean.
const CORPUS: [string, string][] = [
  ['inanimate agency', 'The build script says the tests pass.'],
  ['inanimate agency', 'The report says everything is fine.'],
  ['inanimate agency', 'The report concluded the build is fine.'],
  ['inanimate agency', 'The stability report stated a regression.'],
  ['inanimate agency', 'The cap is gone, so the report offers the upgrade anyway.'],
  ['inanimate agency', 'so the report is no longer a function of the declarations the build wrote, which the README states plainly.'],
  ['-', 'so the report is no longer a function of the declarations the build wrote.'],
  ['inanimate agency', 'The deprecation message names the replacement id.'],
  ['inanimate agency', 'It exempts a range on the grounds that the rule wants an interval.'],
  ['inanimate agency', 'Recovery runs only when the declared version states a range.'],
  ['inanimate agency', 'the system property, whose place is in the middle, is read second.'],
  ['inanimate agency', 'A module whose version is unset is skipped.'],
  ['inanimate agency', 'The roadmap entry names the file, and the alias, which declares the version, is kept.'],
  ['inanimate agency', 'Its own text says the item is gated.'],
  ['inanimate agency', 'The commit that decides the default lands last.'],
  ['inanimate agency', 'Neither declares a constraint on the classpath.'],
  ['-', 'The user says the build is slow on CI.'],
  ['-', 'The maintainer wrote the original recovery in 2023.'],
  ['-', 'The function returns early when the list is empty, keeping the loop simple.'],
  ['-', 'Gradle flattens the alias to a bare require on the marker.'],
  ['-', 'The claim file is named by the session that holds the lease.'],
  ['-', 'I wrote the fix and we decided to keep the flag off by default.'],
  ['-', 'The value is used only when the declared version is exact.'],
  ['-', 'This keeps the diff small and the behaviour unchanged.'],
  ['-', 'That said, the guard is still worth a test.'],
  ['-', 'The declared bound is a ceiling, not a floor.'],
  ['-', 'The rule stated in the README covers this case.'],
  ['-', 'A reviewer who knows the codebase can confirm this in minutes.'],
  ['-', 'Run the suite before you commit anything.'],
  ['-', 'A session\'s notes are kept under the scratchpad.'],
  ['-', 'A map holds a value until the loop gives up.'],
  ['-', 'The old names are kept, and the members added last week stay.'],
  ['-', 'The fix holds up well under load.'],
  ['-', 'My first attempt used map notation.'],
  ['-', 'The adversarial pass found two defects.'],
  ['-', 'the file names in the warning are sorted'],
  ['-', 'Two processes hold each other open.'],
  ['-', 'A subagent who asks for the file gets it.'],
  ['-', 'Draft release notes below, followed by the release notes you approved.'],
  ['-', 'The spike notes measured only through 8.14.4.'],
  ['-', 'The verifier claimed the two settings overwrite each other.'],
  ['-', 'Covered by a composite test if Ben asks for a reproducer.'],
  ['-', 'Without that noted, the change surprises every repo.'],
  ['-', 'The API exposes three named endpoints.'],
  ['-', 'Coordinates go in with the pom artifact declared through the block.'],
  ['-', 'One probe for the four claims that need a live run.'],
  ['-', 'Discovered by the platform scan rather than declared, carrying a dynamic version.'],
  ['-', 'The two warning strings and the spec names, 163 lines of README alone.'],
  ['-', 'A scenario column so both unrolled names read correctly.'],
  ['-', 'The likely cause with its one unconfirmed step named, then the fix in two parts.'],
  ['-', 'The ladder the model\'s own field names imply is three levels.'],
  ['-', 'The three names proposed and declined, with the reasons.'],
  ['-', 'Covered when a CI job fails or Ben asks for a rerun.'],
  ['-', 'I fixed the indentation and wrongly assumed the rest was fine.'],
  ['-', 'A case named `foo` covers the empty list, and a field named "x" holds it.'],
  ['inanimate agency', 'The stability report claimed a regression.'],
  ['inanimate agency', 'The title now names `rejectPreReleases`.'],
  ['inanimate agency', 'The fenced output below it already names the artifact.'],
  ['inanimate agency', 'The body says nothing about the five review commits.'],
  ['inanimate agency', 'The revision that asks for snapshots gets them filtered.'],
  ['inanimate agency', 'The report says, roughly, that the build is fine.'],
  ['inanimate agency', 'The alias, which declares the version, is kept.'],
  ['inanimate agency', 'The build configures the toolchain.'],
  ['inanimate agency', 'The plugins block owns the version.'],
  ['inanimate agency', 'The entry carries both versions.'],
  ['inanimate agency', 'With a `libs.versions.toml` declaring an alias for that plugin id'],
  ['inanimate agency', 'The report says we decided it.'],
  ['inanimate agency', 'The build script says the user wants a refund.'],
  ['inanimate agency', 'That is what the report said.'],
  ['inanimate agency', 'The spec states that the build is fine.'],
  ['inanimate agency', 'The report—from CI says the build is fine.'],
  ['-', 'The customer wants a refund.'],
  ['-', 'The stakeholder decided the scope.'],
  ['-', 'The team, which decided the scope, is small.'],
  ['-', 'The user says we decided it.'],
  ['-', 'The task writes a file and the build fails.'],
  ['-', 'A map holds a value until the loop gives up.'],
  ['-', 'I said "the report says X" and rewrote it.'],
  ['-', 'Inline `the report says` is code, and so is this fence:\n```\nthe report says everything\n```\n'],
  ['inanimate agency', 'Intro.\n```bash\ngit log\nThe report says everything is fine, and this fence is never closed.'],
  ['-', 'A four-backtick wrapper shows a fence:\n````\n```\nthe report says everything\n```\n````\n'],
  ['-', 'I said “the report says X” and moved on.'],
  ['inanimate agency', 'The **report** says everything is fine.'],
  ['inanimate agency', 'The [report](https://x/y) says everything is fine.'],
  ['inanimate agency', 'The release notes, whose format changed, need updates.'],
  ['banned word', 'This fix is not vacuous at all.'],
  ['banned word', 'That channel predates the options.'],
  ['-', 'Post it in the Slack channel and check the array shape.'],
  ['spaced em dash', 'This is one thing — and another.'],
  ['-', 'This is correct—no space here, nothing else flagged.'],
  ['-', '| Plugin | Version |\n| --- | --- |\n| writing-skills | — |\n| — | 0.54.0 |'],
  ['spaced em dash', '| Plugin | Note |\n| --- | --- |\n| writing-skills | one — two |'],
  ['-', 'Plugin | Version\n--- | ---\n— | 0.54.0\nsession-skills | —'],
  ['-', '> Plugin | Version\n> --- | ---\n> — | 0.54.0'],
  ['-', '| Plugin | Version |\n| --- | --- |\n| writing-skills | **—** |'],
  ['-', '| Plugin | Version |\n| --- | --- |\n| writing-skills | [—](https://example.com/status) |'],
  ['spaced em dash', '| Label | Value |\n| --- | --- |\n| left \\| — | present |'],
  ['spaced em dash', '> A quote.\n> — Its author'],
  ['-', 'Headings: ## Title—subtitle'],
  ['oxford comma', 'The built-in formatters are json, xml, html, plain, text and problems.'],
  ['oxford comma', 'Run it on JDK 8, 11, 17 or 21.'],
  ['oxford comma', 'The formatters are `json`, `xml`, `html` and `plain`.'],
  ['-', 'The built-in formatters are json, xml, html, plain, text, and problems.'],
  ['-', 'Run it on JDK 8, 11, 17, or 21.'],
  ['-', 'If it fails, retry and report.'],
  // A list item that opens on bold text. Bold later in the item, bold outside a list, and a fenced list stay clean.
  ['bold list item', '- **Typed lookup fails.** The lookup fails whenever the two copies differ.'],
  ['bold list item', 'Findings:\n\n1. **Groovy by name works.** It still works.'],
  ['-', '- The lookup fails with **every** copy.'],
  ['-', '**Note:** the lookup fails.'],
  ['-', '```\n- **Typed lookup fails.** It fails.\n```'],
]

// The groups in lint()'s result, without the matched text.
function groups(text: string): string[] {
  return lint(text).split('\n').filter(line => line !== '').map(line => line.slice(0, line.indexOf('\t')))
}

test('each case is flagged with its group, or comes back clean', () => {
  for (const [group, text] of CORPUS) {
    if (group === '-') expect([text, lint(text)]).toEqual([text, ''])
    else expect([text, groups(text)]).toEqual([text, expect.arrayContaining([group])])
  }
})

test('the note has a count, an example, and the rule for each group', () => {
  const note = lint('A — B — C, and the report says so.', { note: true })
  expect(note).toMatch(/^A house-style lint flagged the previous reply:\n/)
  expect(note).toContain('- spaced em dash x1, e.g. " —". Rule: an em dash takes no surrounding spaces: write word—word, never word — word.\n')
  expect(note).toContain('- inanimate agency x1, e.g. "the report says". Rule: an inanimate subject must not take a verb of speech, volition, or cognition; say who the real actor is')
  expect(note).toMatch(/\nApply these rules in the reply you are about to write[^\n]*\n$/)
  expect(note).not.toContain('loaded at session start')
})

test('clean text makes no note', () => {
  expect(lint('Plain prose, nothing flagged.', { note: true })).toBe('')
  expect(lint('', { note: true })).toBe('')
})

// The draft fence comes off before the lint, as the Stop hook takes it off, so
// the draft is still read when the review model cannot run. Every other fence
// is dropped, a code fence inside a draft included.
test('a draft is linted as prose once its fence lines are off', () => {
  const note = (reply: string) => lint(drafts(reply, { unwrap: true }), { note: true })
  expect(note('Here it is.\n\n```draft\nThis shape is vacuous.\n```\n')).toContain('banned word x1')
  expect(note('Here it is.\n\n```python\nThis shape is vacuous.\n```\n')).toBe('')
  expect(note('Here it is.\n\n````draft\nPlain text.\n\n```python\nThis shape is vacuous.\n```\n````\n')).toBe('')
})

test('a 40,000-line reply is counted line by line', () => {
  let reply = ''
  for (let i = 0; i < 40000; i++) reply += `line ${i} says "hi" \\ the shape\n`
  expect(lint(reply, { note: true })).toContain('- banned word x40000, e.g. "shape".')
})

test('a line of 100,000 spaces before a dash is linted in under a second', () => {
  const start = Date.now()
  expect(lint(`${' '.repeat(100000)}— x`)).toContain('spaced em dash')
  expect(Date.now() - start).toBeLessThan(1000)
})

// These expected values are not copied from the awk script, which was wrong in
// a UTF-8 locale: macOS awk stops on a multibyte character after a past form,
// and it cuts the example at the wrong byte after a letter such as İ.
test('a character outside ASCII is one character', () => {
  expect(lint('a 😀vacuous😀 b')).toBe('banned word\t😀vacuous😀\n')
  expect(lint('The naïve report says so.')).toBe('inanimate agency\tThe naïve report says\n')
  expect(lint('The rule stated—in the README.')).toBe('')
  expect(lint('The report said—the build is fine.')).toBe('inanimate agency\tThe report said\n')
  expect(lint('İ the report says so.')).toBe('inanimate agency\tthe report says\n')
})
