# To do

## Run `/confer:review` once on the Windows machine

`/confer:review` has run against real models on macOS, but never on Windows. On the Windows
machine:

1. Pull `main` in the clone of this repo, and run `npm ci` in `plugins/confer`.
2. In a small Git repository with one uncommitted edit, start
   `claude --plugin-dir <clone>/plugins/confer` and run `/confer:review --tier routine`. The review
   should end with a report from both reviewers. Codex starts there through the `codex.cmd` shim,
   with no shell.
3. Run it again and press Esc while Codex is running. Within a minute, no `pwsh.exe` started by
   Codex should be left in Task Manager. Then ask Claude to cancel the review, and check that the
   worktree under `%USERPROFILE%\.claude\tmp\confer\<run>\` is gone.
4. Run step 2 from a UNC path to the same repository, such as `\\localhost\c$\<path>`.

Clear this item in a commit with the results in its message, including any error text, and push.

## Switch the Windows machine from claudex-loop to Confer

Do this after the item above passes. On the Windows machine:

1. Install Confer from the `ianbrandt` marketplace. `claude plugin list` should show Confer 0.12.5:

   ```shell
   claude plugin marketplace update ianbrandt
   claude plugin install confer@ianbrandt
   ```

2. If claudex-loop or a `confer@confer` install from a local checkout is in the output of
   `claude plugin list`, uninstall it and remove its marketplace. Check the names with
   `claude plugin marketplace list`:

   ```shell
   claude plugin uninstall claudex-loop@claudex-loop
   claude plugin marketplace remove claudex-loop
   ```

3. Remove any lines about claudex-loop from `%USERPROFILE%\.claude\CLAUDE.md`.
4. In a new session, check that `/confer:review`, `/confer:plan`, and `/confer:ask` are listed.

Clear this item in a commit with the results in its message, and push.

## Check whether Codex's read-only sandbox works on Windows

Confer runs Codex with `--approve-for-me` on Windows, because Codex 0.167 refused every command in
its `read-only` sandbox there. Codex 0.167 also lists a `windows_sandbox_service` feature as under
development. These steps check whether `read-only` now runs a command that reads a file and refuses
one that writes. On the Windows machine, in PowerShell 7:

1. Update Codex the way it was installed, then record the version and every sandbox feature:

   ```powershell
   codex --version
   codex features list | Select-String -Pattern 'sandbox'
   ```

2. Set up a scratch folder:

   ```powershell
   $d = Join-Path $env:TEMP codexsandboxprobe; Remove-Item -Recurse -Force $d -ErrorAction Ignore
   New-Item -ItemType Directory $d | Out-Null; Set-Location $d
   git init -q; Set-Content probe.txt 'PROBE-READ-OK'
   ```

3. Run Codex in `read-only` with no other setting, then check whether the write happened. The read
   should print `PROBE-READ-OK`, and `Test-Path` should print `False`:

   ```powershell
   codex exec -s read-only -c 'approval_policy="never"' --skip-git-repo-check 'Run Get-Content probe.txt, then run Set-Content written.txt x. Report the exact output or error of each command.'
   Test-Path written.txt
   ```

4. Remove `written.txt` if it exists, then run step 3 again with the feature turned on:

   ```powershell
   Remove-Item written.txt -ErrorAction Ignore
   codex exec -s read-only --enable windows_sandbox_service -c 'approval_policy="never"' --skip-git-repo-check 'Run Get-Content probe.txt, then run Set-Content written.txt x. Report the exact output or error of each command.'
   Test-Path written.txt
   ```

5. If step 1 lists another Windows sandbox feature, or `codex exec --help` shows a Windows sandbox
   option, run step 4 with it in place of `--enable windows_sandbox_service`.

6. Remove the scratch folder:

   ```powershell
   Set-Location $env:TEMP; Remove-Item -Recurse -Force (Join-Path $env:TEMP codexsandboxprobe)
   ```

Replace this item with an "Analyze the Codex read-only sandbox results" item: the versions and
features from step 1, and for each run, Codex's report of each command, any error text, and the
`Test-Path` output. Then push.

## Check per-clone push rules on the managed Windows CLI

In auto mode a `git push` is allowed by default, and on 2026-11-11 a push to `main` ran on the
Windows machine without the `session-skills` 0.29.0 prompt. The planned replacement is a set of
`permissions.ask` rules in the clone's `.claude/settings.local.json`, with no hook involved. Check
three things there: whether those rules are applied under managed settings, which file is read by a
session started in a worktree, and why the 0.29.0 prompt was missed. Every push in these steps goes
to a bare repository in a scratch folder, or to a host that does not exist.

On the Windows machine, in PowerShell 7, with `session-skills` 0.29.0 installed and its
`askBeforeOutwardWrites` option on:

1. Record the versions, and whether `cc-plugin-sec-default` is active:

   ```powershell
   claude --version
   claude plugin list | Select-String -SimpleMatch -Context 0,2 ' session-skills@'
   $d = (Join-Path $env:TEMP pushrulesprobe).Replace('\', '/')
   Remove-Item -Recurse -Force $d -ErrorAction Ignore; New-Item -ItemType Directory $d | Out-Null
   $null | claude -p 'Reply with ok.' --debug-file "$d/seat.log" | Out-Null
   (Select-String -Path "$d/seat.log" -Pattern 'sec-default').Line
   ```

2. Set up a clone with a local remote, a worktree, and six unpushed branches. `Push-Probe` runs one
   push in a headless auto mode session, then prints whether the branch arrived:

   ```powershell
   git init -q --bare -b main "$d/remote.git"
   git init -q -b main "$d/clone"; Set-Location "$d/clone"
   git config user.name probe; git config user.email probe@example.invalid
   Set-Content .gitignore '.claude/'; git add .gitignore; git commit -q -m First
   git remote add origin "$d/remote.git"; git push -q -u origin main
   git remote add held https://git.invalid/probe/held.git
   Set-Content note.txt probe; git add note.txt; git commit -q -m 'Add note'
   'b1', 'b2', 'b3', 'b4', 'b5', 'b6' | ForEach-Object { git branch $_ }
   git worktree add -q -b wt "$d/clone/.claude/worktrees/wt"
   function Push-Probe($dir, $branch, $command) {
     Push-Location $dir
     $null | claude -p "Run this exact command as one shell call and report what happened: $command" --permission-mode auto --debug-file "$d/$branch.log" > "$d/$branch.txt"
     Pop-Location
     $arrived = git -C "$d/remote.git" branch --list $branch
     '{0}: {1}' -f $branch, $(if ($arrived) { 'PUSHED' } else { 'not pushed' })
   }
   ```

3. Push with no rules. `b1: PUSHED` is expected. If `not pushed` is printed, auto mode may be turned
   off on this machine. In that case keep `$d/b1.txt` for the results, and go to step 8.

   ```powershell
   Push-Probe "$d/clone" b1 'git push origin b1'
   ```

4. Push to a remote of unknown visibility. With 0.29.0 installed, a prompt is expected for this
   push. On macOS the call is denied before git runs. If the reply includes
   `Could not resolve host`, the push ran unasked. If `tool.check` is not among the events on the
   `session-skills` line, the option is off on this machine.

   ```powershell
   $null | claude -p 'Run this exact command as one shell call and report what happened: git push held b6' --permission-mode auto --debug-file "$d/held.log" > "$d/held.txt"
   Get-Content "$d/held.txt"
   (Select-String -Path "$d/held.log" -Pattern 'tool\.check|tried to|passed over|hooks? .{0,40}(skipped|failed)').Line
   ```

5. Add the rules to the main checkout, and push from it in both forms. `b2: not pushed` and
   `b3: not pushed` are expected:

   ```powershell
   $ask = 'git push *', 'git -C * push *' | ForEach-Object { "Bash($_)"; "PowerShell($_)" }
   @{ permissions = @{ ask = @($ask) } } | ConvertTo-Json -Depth 3 | Set-Content "$d/clone/.claude/settings.local.json"
   Push-Probe "$d/clone" b2 'git push origin b2'
   Push-Probe "$d/clone" b3 "git -C '$d/clone/.claude/worktrees/wt' push origin b3"
   ```

6. Push from a session started in the worktree. Per the Claude Code docs, a session in a worktree on
   Windows does not read the main checkout's file, so `b4: PUSHED` is expected. `b5: not pushed` is
   expected once the worktree has a copy of the file:

   ```powershell
   Push-Probe "$d/clone/.claude/worktrees/wt" b4 'git push origin b4'
   New-Item -ItemType Directory "$d/clone/.claude/worktrees/wt/.claude" | Out-Null
   Copy-Item "$d/clone/.claude/settings.local.json" "$d/clone/.claude/worktrees/wt/.claude/"
   Push-Probe "$d/clone/.claude/worktrees/wt" b5 'git push origin b5'
   ```

7. Count the log lines of the five runs that report a hook as skipped, failed, or passed over.
   `notices in the logs: 0` is printed on macOS:

   ```powershell
   $notices = @(Select-String -Path "$d/b*.log" -Pattern 'tried to|passed over|hooks? .{0,40}(skipped|failed)')
   'notices in the logs: {0}' -f $notices.Count
   $notices.Line
   ```

8. Remove the scratch folder:

   ```powershell
   Set-Location $env:TEMP; Remove-Item -Recurse -Force $d
   ```

Replace this item with an "Analyze the push rule results" item. Include the output of steps 1 and 3
to 7 as printed. Commit it, and ask before pushing.
