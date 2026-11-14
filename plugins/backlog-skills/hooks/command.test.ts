// claude plugin test: the commit messages and PR texts read from a shell command.
import { expect, test } from 'claude-code/testing'
import { sent } from './command'

const bash = (cmd: string, cwd = '/repo') => sent(cmd, 'bash', cwd)
const texts = (cmd: string) => bash(cmd).map(s => s.texts)

test('each -m and --message value of a git commit is read, in order', () => {
  expect(bash('git commit -m "Fix R1" -m \'Body\' --message=Third')).toEqual([{ what: 'the commit message', dir: '/repo', texts: ['Fix R1', 'Body', 'Third'], files: [], unread: [] }])
  expect(texts('git commit -am"Fix R1"')).toEqual([['Fix R1']])
  expect(texts('git commit --amend -m R1')).toEqual([['R1']])
})

test('a commit in a chain, behind git -C or an assignment, is found, and other commands are not', () => {
  expect(texts('git add x && git commit -m "Fix R1" || echo R2; git log R3')).toEqual([['Fix R1']])
  expect(bash('GIT_AUTHOR_NAME=x git -C sub -c a=b commit -m R1')[0].dir).toBe('/repo/sub')
  expect(bash('cd /other && git -C ../sub commit -m R1')[0].dir).toBe('/sub')
  expect(bash('git log --grep commit -m R1')).toEqual([])
  expect(texts('if true; then git commit -m R1; fi')).toEqual([['R1']])
})

test('a quoted heredoc in a substitution is read as it is, and an unquoted one with a substitution is not', () => {
  expect(texts("git commit -m \"$(cat <<'EOF'\nFix R1\n\nBody.\nEOF\n)\"")).toEqual([['Fix R1\n\nBody.\n']])
  expect(texts('git commit -m "$(cat <<EOF\nFix R1\nEOF\n)"')).toEqual([['Fix R1\n']])
  expect(bash('git commit -m "$(cat <<EOF\nFix $X\nEOF\n)"')[0].unread).toEqual(['a value is built from a variable or a substitution'])
})

test('-F - and --body-file - read the heredoc, the here-string, or what echo pipes in', () => {
  expect(texts("git commit -F - <<'EOF'\nFix R1\nEOF")).toEqual([['Fix R1\n']])
  expect(texts("git commit -F - <<-EOF\n\tFix R1\n\tEOF\n")).toEqual([['Fix R1\n']])
  expect(texts("git commit --file=- <<< 'Fix R1'")).toEqual([['Fix R1']])
  expect(texts("echo -n 'Fix R1' | git commit -F /dev/stdin")).toEqual([['Fix R1']])
  expect(texts("cat <<'EOF' | gh pr create -t T --body-file -\nBody R1\nEOF\n")).toEqual([['T', 'Body R1\n']])
  expect(bash('make | git commit -F -')[0].unread).toEqual(['the text is read from stdin'])
})

test('a named file is resolved from the directory the command runs in', () => {
  expect(bash('git commit -F msg.txt')[0].files).toEqual(['/repo/msg.txt'])
  expect(bash('cd sub && git commit --file ../msg.txt 2>&1')[0].files).toEqual(['/repo/msg.txt'])
  expect(bash('git -C /wt commit -Fmsg.txt')[0].files).toEqual(['/wt/msg.txt'])
  expect(bash('cd "$WT" && git commit -F msg.txt')[0].unread).toEqual(['the directory of msg.txt is not known'])
})

test('a value from a variable or a substitution, and a message from an editor, are not read', () => {
  const dyn = 'a value is built from a variable or a substitution'
  expect(bash('git commit -m "$MSG"')[0].unread).toEqual([dyn])
  expect(bash('git commit -m"$MSG"')[0].unread).toEqual([dyn])
  expect(bash('git commit -m "Fix `date`"')[0].unread).toEqual([dyn])
  expect(bash('git commit -F "$F"')[0].unread).toEqual(['a file name is built from a variable or a substitution'])
  expect(bash('git commit')[0].unread).toEqual(['the message comes from an editor'])
  expect(bash('git commit --amend')[0].unread).toEqual(['the message comes from an editor'])
  expect(bash('git commit --amend --no-edit')[0].unread).toEqual([])
  expect(bash('git commit -C HEAD')[0]).toMatchObject({ texts: [], unread: [] })
  expect(bash("git commit -m 'R1")).toEqual([{ what: 'the command', texts: [], files: [], unread: ['the command could not be split into words'] }])
})

test('gh pr create and gh pr edit read the title and the body', () => {
  expect(bash('gh pr create --title "R1 fix" --body=Body -B main')[0]).toMatchObject({ what: 'the PR title and body', texts: ['R1 fix', 'Body'] })
  expect(texts('gh pr create -tR1 -b "x" -a me')).toEqual([['R1', 'x']])
  expect(texts('gh pr edit 12 --title R1 --add-label bug')).toEqual([['R1']])
  expect(bash('gh pr edit 12 -F body.md')[0].files).toEqual(['/repo/body.md'])
  expect(bash('gh pr view 12 --title R1')).toEqual([])
})

test('PowerShell strings, here-strings, and a here-string piped into -F - are read', () => {
  const pwsh = (cmd: string) => sent(cmd, 'pwsh', 'C:\\repo')
  expect(pwsh("git commit -m 'It''s R1'; git status")[0].texts).toEqual(["It's R1"])
  expect(pwsh('git commit -m "Fix`tR1"')[0].texts).toEqual(['Fix\tR1'])
  expect(pwsh("git commit -m @'\nFix R1\n'@")[0].texts).toEqual(['Fix R1'])
  expect(pwsh("@'\r\nFix R1\r\n'@ | git commit -F -")[0].texts).toEqual(['Fix R1'])
  expect(pwsh('git commit -m "Fix $x"')[0].unread).toEqual(['a value is built from a variable or a substitution'])
  expect(pwsh('git.exe commit -F msg.txt')[0].files).toEqual(['C:/repo/msg.txt'])
})
