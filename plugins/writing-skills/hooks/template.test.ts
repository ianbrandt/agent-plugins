// claude plugin test: the parsers in template.ts.
import { expect, test } from 'claude-code/testing'
import { labels, linked, repoFlag, unheaded } from './template'

test('a form label is read as YAML writes it on one line', () => {
  const form = "body:\n  - attributes:\n      label: Version # which one\n  - attributes:\n      label: 'It''s broken'\n  - attributes:\n      label: >-\n        Folded\n  - attributes:\n      label: \"Quoted\"\r\n"
  expect(labels([{ name: 'bug.yaml', text: form }])).toEqual(['Version', "It's broken", 'Quoted'])
  const commented = "body:\n  - attributes:\n      label: \"Problem Statement\" # shown\n  - attributes:\n      label: 'It''s' # c\n"
  expect(labels([{ name: 'bug.yml', text: commented }])).toEqual(['Problem Statement', "It's"])
})

test('a heading is matched indented up to three spaces, with a closing sequence, or after a quote', () => {
  const allowed = new Set(['Steps', 'C#'])
  expect(unheaded('   ## Steps ##\nRun it.\n    ## Steps\n### C#\n--body "## Steps\nx', allowed)).toBe('   Run it.\n    ## Steps\n--body "x')
  expect(labels([{ name: 'bug.md', text: '---\nname: Bug\n---\n## Steps ##\n' }])).toEqual(['Steps'])
})

test('a repo is linked only by a github.com URL to a repo', () => {
  expect(linked('https://github.com/o/r/issues and git@github.com:x/y and https://gist.github.com/u/abc https://api.github.com/repos/o/r https://github.com/orgs/foo/x https://github.com/a/b.git.')).toEqual(['o/r', 'a/b'])
})

test('the repo flag is the last one given, and a repo off github.com is none', () => {
  expect(repoFlag('gh issue create --title "-R x/y" --repo=o/r')).toBe('o/r')
  expect(repoFlag("gh issue create -R 'https://github.com/o/r.git'")).toBe('o/r')
  expect(repoFlag('A=1 GH_REPO=o/r gh issue create')).toBe('o/r')
  expect(repoFlag('gh issue create --repo ghe.example.com/o/r')).toBe('')
  expect(repoFlag('gh issue create --body x')).toBeUndefined()
  // A flag inside a quoted argument is text, not a flag.
  expect(repoFlag('gh issue create --repo o/r --body "Run gh -R x/y status, or \\"gh --repo x/z\\"."')).toBe('o/r')
  expect(repoFlag("gh issue create --body 'Run gh -R x/y.'")).toBeUndefined()
  expect(repoFlag("gh issue create --repo o/r --body-file - <<'EOF'\nRun gh -R x/y status.\nEOF")).toBe('o/r')
})
