// claude plugin test: keys() and bodyFiles() against the fixture, and walk()
// against a classifier cache.
import { expect, test } from 'claude-code/testing'
import { bodyFiles, keys, walk } from './keys'

// The fixture is text in this file, since a test can neither read a file nor
// import one that is not code. ${T} is a backtick, and ${D}{ is "${".
const T = '`'
const D = '$'
const FIXTURE = String.raw`
# One case per line:
#   <mode><TAB><command><TAB><expected keys>
# The mode is bash or pwsh. In the command, \n is a newline and \t a tab. The
# expected keys are the extractor's output lines, each written <segment>:<entry>
# and joined with " | ", or "-" for no output.
#
# Plain commands: the first word, then the subcommand candidates, then the task
# names below each key, which only a PROJECT class reads.
bash	ls -la	1:ls
bash	git status	1:git | 1:git status | 1:+git status
bash	git commit -m "Fix the thing"	1:git | 1:git commit | 1:git commit ? | 1:+git commit
bash	git -C "$WT" status	1:git | 1:git status | 1:+git status
bash	git -C status commit	1:git | 1:git status | 1:git commit | 1:git status commit | 1:+git status | 1:+git commit | 1:+git status commit
bash	svn --config-dir info --username status commit	1:svn | 1:svn info | 1:svn status | 1:svn commit | 1:svn info status | 1:svn info commit | 1:svn status commit | 1:+svn info | 1:+svn status | 1:+svn commit | 1:+svn info status | 1:+svn info commit | 1:+svn status commit | 1:+svn info status commit
bash	gh pr create --title x --body y	1:gh | 1:gh pr | 1:gh pr create | 1:+gh pr | 1:+gh create | 1:+gh x | 1:+gh y | 1:+gh pr create | 1:+gh pr x | 1:+gh pr y | 1:+gh pr create x | 1:+gh pr create y
# More than 4 candidates at one depth is READ rather than a dropped key.
bash	git -a a -b b -c c -d d -e e x	1:READ
# More than 8 task names below one key: only a PROJECT key reads the "!".
bash	make a b c d e f g h i	1:make | 1:make a | 1:make a b | 1:+make ! | 1:+make a b | 1:+make a c | 1:+make a d | 1:+make a e | 1:+make a f | 1:+make a g | 1:+make a h | 1:+make a i | 1:+make a b c | 1:+make a b d | 1:+make a b e | 1:+make a b f | 1:+make a b g | 1:+make a b h | 1:+make a b i
# A word that cannot be read as a name adds the marker "?" at its depth.
bash	hg "$verb" -m x	1:hg | 1:hg ? | 1:+hg ? | 1:+hg x
bash	make check "$task"	1:make | 1:make check | 1:make check ? | 1:+make check | 1:+make ? | 1:+make check ?
bash	ls "$dir"	1:ls | 1:ls ? | 1:+ls ?
bash	python3 -c 'print(1)'	1:python3 | 1:python3 ?
# A word directly after a flag may be that flag's value, so it adds the marker
# only when no name follows at that depth, and never among task names.
bash	git log --format "%h %s"	1:git | 1:git log | 1:git log ? | 1:+git log
bash	./gradlew test --tests "*Foo*"	1:./gradlew | 1:./gradlew test | 1:./gradlew test ? | 1:+./gradlew test
# Unless no name follows at that depth, when it may be the subcommand itself.
bash	hg -v "$verb"	1:hg | 1:hg ?
bash	hg -q "$verb" --message=text	1:hg | 1:hg ?
# Wrappers that run the command after them are dropped, with their operand.
bash	timeout 60 hg commit -m x	1:hg | 1:hg commit | 1:hg commit x | 1:+hg commit | 1:+hg x | 1:+hg commit x
bash	setsid hg commit -m x	1:hg | 1:hg commit | 1:hg commit x | 1:+hg commit | 1:+hg x | 1:+hg commit x
# Paths as the first word are keys as written.
bash	./gradlew build --info	1:./gradlew | 1:./gradlew build | 1:+./gradlew build
bash	"$WT"/gradlew check	1:$WT/gradlew | 1:$WT/gradlew check | 1:+$WT/gradlew check
# A command with a quoted or odd first word is reviewed.
bash	"my tool" run	1:READ
bash	a,b c	1:READ
bash	[ -f x ] && echo y	1:[ | 1:[ x | 1:+[ x | 2:echo | 2:echo y | 2:+echo y
# Leading assignments, redirections, shell words, and wrappers are dropped.
bash	FOO=1 sudo -E env BAR=2 nohup git push	1:git | 1:git push | 1:+git push
bash	if git diff --quiet; then echo same; fi	1:git | 1:git diff | 1:+git diff | 2:echo | 2:echo same | 2:+echo same
bash	for f in a b; do rm "$f"; done	1:rm | 1:rm ? | 1:+rm ?
bash	2>/dev/null ls	1:ls
bash	echo x > out.txt	1:echo | 1:echo x | 1:+echo x
bash	x="$(date)"	1:date
# Comments, with a quote in them.
bash	ls # don't do this	1:ls
bash	ls\n# it's a comment\npwd	1:ls | 2:pwd
bash	echo a#b	1:echo
# Separators, and the redirections that are not separators.
bash	ls foo 2>&1 | grep bar	1:ls | 1:ls foo | 1:+ls foo | 2:grep | 2:grep bar | 2:+grep bar
bash	make build &> log.txt	1:make | 1:make build | 1:+make build
bash	a && b || c; d & e	1:a | 2:b | 3:c | 4:d | 5:e
bash	{ ls; pwd; }	1:ls | 2:pwd
bash	echo ${D}{HOME}/x	1:echo | 1:echo ? | 1:+echo ?
bash	cp x.{txt,md} y	1:cp | 1:+cp y
# Single-quoted text is skipped when looking for substitutions: a commit
# message's Markdown backticks are not commands.
bash	git commit -m 'Use ${T}foo${T} here'	1:git | 1:git commit | 1:git commit ? | 1:+git commit
# A substitution inside double quotes is read (R8).
bash	grep "$(gh issue comment 1 --body 'x')" log.txt	1:grep | 1:grep ? | 1:+grep ? | 1:+grep log.txt | 2:gh | 2:gh issue | 2:gh issue comment | 2:+gh issue | 2:+gh comment | 2:+gh x | 2:+gh issue comment | 2:+gh issue x | 2:+gh issue comment x
bash	printf '%s' "$(printf x; hg commit -m 'y')"	1:printf | 1:+printf ? | 2:printf | 2:printf x | 2:+printf x | 3:hg | 3:hg commit | 3:hg commit y | 3:+hg commit | 3:+hg y | 3:+hg commit y
bash	echo "$(git log -1 --format=%s $(git rev-parse HEAD))"	1:echo | 1:echo ? | 1:+echo ? | 2:git | 2:git log | 2:git log ? | 2:+git log | 2:+git ? | 2:+git log ? | 3:git | 3:git rev-parse | 3:git rev-parse HEAD | 3:+git rev-parse | 3:+git HEAD | 3:+git rev-parse HEAD
bash	echo ${T}date${T}	1:echo | 1:echo ? | 1:+echo ? | 2:date
bash	echo "${T}hg commit -m x${T}"	1:echo | 1:echo ? | 1:+echo ? | 2:hg | 2:hg commit | 2:hg commit x | 2:+hg commit | 2:+hg x | 2:+hg commit x
# Pass 1 reads a substitution as the one word "$", so the words after it stay
# with the command around it, and pass 2 reads a process substitution's body.
bash	git diff $(git merge-base a b) HEAD	1:git | 1:git diff | 1:git diff ? | 1:+git diff | 1:+git ? | 1:+git HEAD | 1:+git diff ? | 1:+git diff HEAD | 2:git | 2:git merge-base | 2:git merge-base a | 2:+git merge-base | 2:+git a | 2:+git b | 2:+git merge-base a | 2:+git merge-base b | 2:+git merge-base a b
bash	diff <(gh pr view 1) x	1:diff | 1:diff ? | 1:+diff ? | 1:+diff x | 2:gh | 2:gh pr | 2:gh pr view | 2:+gh pr | 2:+gh view | 2:+gh pr view
bash	tee >(hg commit -m x) < f	1:tee | 1:tee ? | 1:+tee ? | 2:hg | 2:hg commit | 2:hg commit x | 2:+hg commit | 2:+hg x | 2:+hg commit x
bash	echo $(( $(wc -l < f) + 1 )) done	1:echo | 1:echo ? | 1:+echo ? | 1:+echo done | 2:wc
# Quotes nested inside a substitution inside quotes are misread, toward a review.
bash	echo "$(git commit -m "a; b")"	1:echo | 2:READ | 3:git | 3:git commit | 3:git commit ? | 3:+git commit
# Heredocs: the body is dropped in both passes.
bash	cat <<'EOF'\nhg commit -m "it's"\nEOF	1:cat
bash	cat <<EOF\nplain text, it's fine\nEOF\nls	1:cat | 2:ls
bash	cat <<-EOF\n\tbody\n\tEOF\nls	1:cat | 2:ls
bash	git commit -F- <<'EOF'\nThe report says so.\nEOF	1:git | 1:git commit | 1:+git commit
bash	cat <<EOF\neof\nhg commit -m x\nEOF	1:cat
bash	cat <<EOF | grep x\nbody\nEOF	1:cat | 2:grep | 2:grep x | 2:+grep x
bash	echo "<<EOF" x	1:echo | 1:echo ? | 1:+echo ? | 1:+echo x
# An expanding heredoc with a substitution in it is READ (R21-15).
bash	cat <<EOF\n$(hg commit -m x)\nEOF	1:READ
bash	cat <<EOF\n'$(hg commit -m x)'\nEOF	1:READ
bash	cat <<EOF\nuse ${T}foo${T}\nEOF	1:READ
# Unbalanced input is READ.
bash	echo "abc	1:READ
bash	echo 'abc	1:READ
bash	cat <<EOF\nbody	1:READ
bash	echo "$(date"	1:READ
bash	echo "a ${T} b"	1:READ
# A sentence in the command adds 0:PROSE: six words or more, the first
# capitalized and the last ending in ".", "!", or "?".
bash	curl -d '{"body":"The report says so and more."}' https://x	0:PROSE | 1:curl | 1:curl ?
bash	python3 -c 'print("Done, all six words are here!")'	0:PROSE | 1:python3 | 1:python3 ?
bash	python3 -c 'print("Only five words here.")'	1:python3 | 1:python3 ?
bash	python3 -c 'print("the lower case start of this one.")'	1:python3 | 1:python3 ?
bash	echo "The report says so and more.\"	0:PROSE | 1:READ
pwsh	Invoke-RestMethod -Body 'We moved the build to Gradle nine.'	0:PROSE | 1:Invoke-RestMethod | 1:Invoke-RestMethod ?
# An escaped newline or tab between words counts as a space, and a word may be quoted.
bash	python3 -c "p.write_text(p.read_text() + '\\nThe report says so and more.\\n')"	0:PROSE | 1:python3 | 1:python3 ?
bash	python3 -c 'print("The report\\nsays so\\tand more.")'	0:PROSE | 1:python3 | 1:python3 ?
pwsh	Invoke-RestMethod -Body "${T}nWe moved the build to Gradle nine.${T}n"	0:PROSE | 1:Invoke-RestMethod | 1:Invoke-RestMethod ?
bash	python3 -c 'print("The \\"report\\" says so and more.")'	0:PROSE | 1:python3 | 1:python3 ?
bash	python3 -c "print('The report says so and \\"more.\\"')"	0:PROSE | 1:python3 | 1:python3 ?
pwsh	Invoke-RestMethod -Body "We moved the ${T}"build${T}" to Gradle nine."	0:PROSE | 1:Invoke-RestMethod | 1:Invoke-RestMethod ?
# PowerShell.
pwsh	Get-ChildItem -Recurse | Select-Object Name	1:Get-ChildItem | 2:Select-Object | 2:Select-Object Name | 2:+Select-Object Name
pwsh	& "C:\Tools\X.exe" run	1:C:\Tools\X.exe | 1:C:\Tools\X.exe run | 1:+C:\Tools\X.exe run
pwsh	. ./script.ps1 -Force	1:./script.ps1
pwsh	Write-Output a${T}\nb	1:Write-Output | 1:Write-Output a | 1:Write-Output a b | 1:+Write-Output a | 1:+Write-Output b | 1:+Write-Output a b
pwsh	Write-Output 'it''s'	1:Write-Output
pwsh	Write-Output "say ""hi"" now"	1:Write-Output | 1:Write-Output ? | 1:+Write-Output ?
pwsh	$x = Get-Content f	1:Get-Content | 1:Get-Content f | 1:+Get-Content f
pwsh	$x = "a b"; ls	1:ls
pwsh	$body = @"\nThe report says so.\n"@\ngh pr create --body $body	1:gh | 1:gh pr | 1:gh pr create | 1:+gh pr | 1:+gh create | 1:+gh pr create
pwsh	$b = @'\n$(hg commit -m x)\n'@\nls	1:ls
pwsh	$b = @"\n$(hg commit -m x)\n"@	1:READ
pwsh	Write-Output "$(gh issue comment 1 --body x)"	1:Write-Output | 1:Write-Output ? | 1:+Write-Output ? | 2:gh | 2:gh issue | 2:gh issue comment | 2:+gh issue | 2:+gh comment | 2:+gh x | 2:+gh issue comment | 2:+gh issue x | 2:+gh issue comment x
pwsh	$b = @"\nno end	1:READ
pwsh	echo ${T}date${T}	1:echo | 1:echo date | 1:+echo date
# Body files. With the mode suffix "files", the extractor runs with files=1 and
# prints the operand of each body-file flag in a git commit or a gh pr, issue, or
# release command instead of keys, one line each: 1 when the command may change
# directory first (cd and the like anywhere in it, or git -C), else 0, then the
# operand. An operand of "-" is the command's stdin and is left out.
bashfiles	git commit -F msg.txt	0:msg.txt
bashfiles	git commit --file=msg.txt	0:msg.txt
bashfiles	git commit --file msg.txt -a	0:msg.txt
bashfiles	git commit -Fmsg.txt	0:msg.txt
bashfiles	git commit -aF msg.txt	0:msg.txt
bashfiles	git commit -m "Fix it" -F msg.txt	0:msg.txt
bashfiles	git commit -m x src/a.kt -F msg.txt	0:msg.txt
bashfiles	git commit -m x	-
bashfiles	git log -F x	-
# A flag's value is never a flag, even one that reads as -F, and nothing after -- is.
bashfiles	git commit -m '-F' private.txt	-
bashfiles	git commit -am "--file" private.txt	-
bashfiles	git commit --author -F x.txt	-
bashfiles	git commit -- -F x.txt	-
bashfiles	git commit -F - <<'EOF'\nThe body.\nEOF	-
bashfiles	git commit -F	-
# The working directory.
bashfiles	git -C sub commit -F msg.txt	1:msg.txt
bashfiles	git -c user.name=x commit -F msg.txt	0:msg.txt
bashfiles	cd sub && git commit -F msg.txt	1:msg.txt
bashfiles	git commit -F msg.txt; pushd ..	1:msg.txt
# An operand that is not a literal path is still printed, and the gate reports it.
bashfiles	git commit -F "my msg.txt"	0:""
bashfiles	git commit -F my\ msg.txt	0:my*msg.txt
bashfiles	git commit -F "$T/m.txt"	0:$T/m.txt
# gh, per subcommand: -m is --merge in pr merge and --milestone elsewhere, and -p
# is --prerelease in a release.
bashfiles	git commit -F m.txt && gh pr create --title x --body-file pr.md	0:m.txt | 0:pr.md
bashfiles	gh pr merge 5 -m -F m.txt	0:m.txt
bashfiles	gh pr create -m -F m.txt	-
bashfiles	gh release create v1 -p -F notes.md	0:notes.md
bashfiles	gh release edit v1 --notes-file=notes.md	0:notes.md
bashfiles	gh issue comment 5 --body-file c.md	0:c.md
bashfiles	gh api repos/x -F body=@x.md	-
bashfiles	echo "$(gh issue create -F b.md)"	0:b.md
bashfiles	git commit -F m.txt && git commit --amend -F m.txt	0:m.txt
# git and gh read the last body flag. git keeps the "=" of -F=x and takes a
# prefix of --file; gh drops it. git's -S takes only an attached value.
bashfiles	git commit -F a.txt -F b.txt	0:b.txt
bashfiles	git commit -F a.txt --file=- <<'EOF'\nThe body.\nEOF	-
bashfiles	git commit -F=msg.txt	0:=msg.txt
bashfiles	gh pr create -F=pr.md	0:pr.md
bashfiles	git commit --fil msg.txt	0:msg.txt
bashfiles	git commit --fil=msg.txt	0:msg.txt
bashfiles	git commit -SF msg.txt	-
bashfiles	git commit -uF msg.txt	-
# A letter takes a value in one gh verb and none in another.
bashfiles	gh pr review 5 -a -F r.md	0:r.md
bashfiles	gh pr review 5 -r -F r.md	0:r.md
bashfiles	gh pr merge 5 -a -F m.md	0:m.md
bashfiles	gh pr create -a me -F p.md	0:p.md
# git --work-tree and GIT_WORK_TREE move the directory a relative path resolves in.
bashfiles	git --work-tree=wt commit -F msg.txt	1:msg.txt
bashfiles	git --work-tree wt commit -F msg.txt	1:msg.txt
bashfiles	GIT_WORK_TREE=wt git commit -F msg.txt	1:msg.txt
bashfiles	git --git-dir=wt/.git commit -F msg.txt	0:msg.txt
# A command that cannot be split has its body files reported as not read, when
# it has a body-file flag.
bashfiles	git commit -F m.txt -m "open	1:""
bashfiles	git commit -m "open	-
pwshfiles	git commit -F msg.txt	0:msg.txt
pwshfiles	Set-Location sub; git commit -F msg.txt	1:msg.txt
# A sentence in the command adds no line in files mode: the body files are all it prints.
bashfiles	cat >> notes.md <<'EOF'\nThe README now lists the steps for the migration here.\nEOF	-
bashfiles	gh pr create --title "The README now lists the steps for the migration." -F body.md	0:body.md
pwshfiles	Set-Content notes.md 'The README now lists the steps for the migration here.'	-
pwshfiles	git commit -F "$env:TEMP\m.txt"	0:$env:TEMP\m.txt
pwshfiles	git commit -F C:\work\m.txt	0:C:\work\m.txt
`

// A fixture command as it is passed to the shell: \n is a newline, \t a tab,
// and \\ a backslash.
function command(text: string): string {
  return text.replace(/\\\\/g, '\x01').replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\x01/g, '\\')
}

test('every fixture case has its keys, or its body files with the mode suffix "files"', () => {
  let cases = 0
  for (const line of FIXTURE.split('\n')) {
    if (line === '' || line.startsWith('#')) continue
    const [mode, cmd] = line.split('\t')
    const shell = mode.startsWith('pwsh') ? 'pwsh' : 'bash'
    const lines = mode.endsWith('files') ? bodyFiles(command(cmd), shell) : keys(command(cmd), shell)
    expect([mode, cmd, lines.map(l => l.replace('\t', ':')).join(' | ') || '-'].join('\t')).toBe(line)
    cases++
  }
  expect(cases).toBe(147)
})

test('a 100 KB argument is read well inside the time a test has', () => {
  const K = 100000
  expect(keys('git commit -m "' + 'word '.repeat(K / 5) + '"', 'bash')).toEqual(['1\tgit', '1\tgit commit', '1\tgit commit ?', '1\t+git commit'])
  // No sentence: no word ends in ".", and each "'" is a letter or a quote.
  expect(keys('echo ' + "Aa' ".repeat(K / 4), 'bash')[0]).toBe('1\techo')
  expect(keys('echo ' + 'Aa '.repeat(K / 3), 'bash')[0]).toBe('1\techo')
  expect(keys('echo ' + 'Aa '.repeat(K / 3) + 'end.', 'bash')[0]).toBe('0\tPROSE')
  expect(keys('echo ' + '1'.repeat(K), 'bash')).toEqual(['1\techo'])
  expect(keys('make ' + 'a '.repeat(K / 2), 'bash')).toContain('1\t+make !')
  expect(keys('echo ' + '@"x '.repeat(K / 4) + '\n"@', 'pwsh')).toEqual(['1\tREAD'])
  expect(bodyFiles('git commit ' + '-a '.repeat(K / 3) + '-F f', 'bash')).toEqual(['0\tf'])
})

// verdict <command> <cache lines> [<project>] [<final>]: the walk of a Bash
// command's keys.
function verdict(cmd: string, cache: string[], scope = '/proj/a', final = false): string[] {
  return walk(keys(cmd, 'bash'), cache, scope, final)
}
const HG = ['*\tDESCEND\thg', '*\tCAN_PUBLISH\thg commit']
const MAKE = ['*\tPROJECT\tmake', '/proj/a\tNEVER\tmake check']

test('a key with no answer is asked about, and a NEVER settles the command', () => {
  expect(verdict('ls -la', [])).toEqual(['ASK', 'ASK\t*\tls'])
  expect(verdict('ls -la', ['*\tNEVER\tls'])).toEqual(['SAFE'])
  expect(verdict('', [])).toEqual(['SAFE'])
})

test('a publishing command is reviewed, and below a DESCEND only the subcommand is asked about', () => {
  expect(verdict('hg commit -m "Fix it"', [])).toEqual(['ASK', 'ASK\t*\thg', 'ASK\t*\thg commit', 'ASK\t/proj/a\thg commit'])
  expect(verdict('hg commit -m "Fix it"', HG)).toEqual(['READER'])
  expect(verdict('hg log', HG)).toEqual(['ASK', 'ASK\t*\thg log'])
  expect(verdict('hg log', [...HG, '*\tNEVER\thg log'])).toEqual(['SAFE'])
  expect(verdict('make', ['*\tDESCEND\tmake'])).toEqual(['SAFE'])
})

test('a command with an unanswered key is reviewed on the final walk', () => {
  expect(verdict('jj describe -m x', [])).toEqual(['ASK', 'ASK\t*\tjj', 'ASK\t*\tjj describe', 'ASK\t*\tjj describe x', 'ASK\t/proj/a\tjj describe', 'ASK\t/proj/a\tjj x', 'ASK\t/proj/a\tjj describe x'])
  expect(verdict('jj describe -m x', [], '/proj/a', true)).toEqual(['READER'])
})

test('a task name is read in its project only, and a task runner is SAFE only when every task is NEVER', () => {
  expect(verdict('make check', MAKE)).toEqual(['SAFE'])
  expect(verdict('make check', MAKE, '/proj/b')).toEqual(['ASK', 'ASK\t/proj/b\tmake check'])
  expect(verdict('make', MAKE)).toEqual(['READER'])
  expect(verdict('make check publish', MAKE)).toEqual(['ASK', 'ASK\t*\tmake check publish', 'ASK\t/proj/a\tmake publish', 'ASK\t/proj/a\tmake check publish'])
  expect(verdict('make check publish', MAKE, '/proj/a', true)).toEqual(['READER'])
  expect(verdict('make a b c d e f g h i', ['*\tPROJECT\tmake'])).toEqual(['READER'])
})

test('a task runner of two words has its task names asked about, in the project', () => {
  const NPM = ['*\tDESCEND\tnpm', '*\tPROJECT\tnpm run']
  expect(verdict('npm run build', NPM)).toEqual(['ASK', 'ASK\t/proj/a\tnpm run build'])
  expect(verdict('npm run build', [...NPM, '*\tNEVER\tnpm run build'])).toEqual(['ASK', 'ASK\t/proj/a\tnpm run build'])
  expect(verdict('npm run build', [...NPM, '/proj/a\tNEVER\tnpm run build'])).toEqual(['SAFE'])
})

test('a command is reviewed for a word that cannot be read as a name below DESCEND or PROJECT, and not below NEVER', () => {
  expect(verdict('hg "$verb" -m x', HG)).toEqual(['READER'])
  expect(verdict('make check "$task"', MAKE)).toEqual(['READER'])
  expect(verdict('ls "$dir"', ['*\tNEVER\tls'])).toEqual(['SAFE'])
})

test('a RUNS_CODE command is reviewed only with a sentence in it', () => {
  expect(verdict("python3 -c 'print(1)'", ['*\tRUNS_CODE\tpython3'])).toEqual(['SAFE'])
  expect(verdict("python3 -c 'print(\"The report says so and more.\")'", ['*\tRUNS_CODE\tpython3'])).toEqual(['READER'])
})

test('a command with a substitution in an expanding heredoc body, or a quoted first word, is reviewed with no lookup', () => {
  expect(verdict("cat <<EOF\n'$(hg commit -m x)'\nEOF", ['*\tNEVER\tcat', '*\tNEVER\thg'])).toEqual(['READER'])
  expect(verdict('"my tool" run', [])).toEqual(['READER'])
})

test('CAN_PUBLISH wins over NEVER for one key, and a cache line in any other form is ignored', () => {
  expect(verdict('ls', ['*\tNEVER\tls', '*\tCAN_PUBLISH\tls'])).toEqual(['READER'])
  expect(verdict('ls', ['*\tCAN_PUBLISH\tls', '*\tNEVER\tls'])).toEqual(['READER'])
  expect(verdict('ls', ['*\tMAYBE\tls', 'ls NEVER', '*\tNEVER\tls\tx', '*\tNEVER', '/proj/b\tNEVER\tls'])).toEqual(['ASK', 'ASK\t*\tls'])
})

test('a path as the first word is looked up in the project', () => {
  expect(verdict('./run x', [])).toEqual(['ASK', 'ASK\t/proj/a\t./run', 'ASK\t/proj/a\t./run x'])
  expect(verdict('./run x', ['*\tNEVER\t./run'])).toEqual(['ASK', 'ASK\t/proj/a\t./run', 'ASK\t/proj/a\t./run x'])
  expect(verdict('./run x', ['/proj/a\tNEVER\t./run'])).toEqual(['SAFE'])
})

test('a command with a DESCEND at depth 3 is reviewed', () => {
  const GH = ['*\tDESCEND\tgh', '*\tDESCEND\tgh pr']
  expect(verdict('gh pr create', [...GH, '*\tDESCEND\tgh pr create'])).toEqual(['READER'])
  expect(verdict('gh pr list', [...GH, '*\tNEVER\tgh pr list'])).toEqual(['SAFE'])
  expect(verdict('gh pr list', GH)).toEqual(['ASK', 'ASK\t*\tgh pr list'])
})

test('every segment is walked, and a key is asked about once', () => {
  expect(verdict('ls; hg log; ls', ['*\tDESCEND\thg'])).toEqual(['ASK', 'ASK\t*\tls', 'ASK\t*\thg log'])
  expect(verdict('hg log && hg commit -m x', [...HG, '*\tNEVER\thg log'])).toEqual(['READER'])
  expect(verdict('ls && hg log', ['*\tNEVER\tls', '*\tDESCEND\thg', '*\tNEVER\thg log'])).toEqual(['SAFE'])
})
