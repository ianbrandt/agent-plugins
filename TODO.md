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

Clear this item in a commit with the results in its message, including any error text.

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

Clear this item in a commit with the results in its message.

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
`Test-Path` output.

## Check the interactive push prompt on the Windows machine

The headless steps of the push and post mode check passed on Windows: the `session.start` hook
writes four `push` rules to `.claude/settings.local.json`, and a headless `git push` is asked about
and declined. These steps check the two prompts that need a person. On the Windows machine, in
PowerShell 7:

1. Pull `main` in the clone of this repo, then set up a scratch clone. `$p` is the plugin in the
   clone of this repo:

   ```powershell
   $p = (Join-Path (git rev-parse --show-toplevel) plugins/session-skills).Replace('\', '/')
   $d = (Join-Path $env:TEMP pushmodeprobe).Replace('\', '/'); Remove-Item -Recurse -Force $d -ErrorAction Ignore
   New-Item -ItemType Directory $d | Out-Null
   git init -q --bare -b main "$d/remote.git"
   git init -q -b main "$d/clone"; Set-Location "$d/clone"
   git config user.name probe; git config user.email probe@example.invalid
   Set-Content note.txt probe; git add note.txt; git commit -q -m First
   git remote add origin "$d/remote.git"; git push -q -u origin main
   'b2', 'b3' | ForEach-Object { git branch $_ }
   ```

2. Start an interactive session. `user` is in the list of setting sources because a session on
   the Windows machine is not logged in without it:

   ```powershell
   claude --plugin-dir $p --setting-sources 'user,project,local' --permission-mode auto
   ```

3. Enter `Run this exact command: git push origin b2`. A permission prompt should be raised.
   Answer Yes.
4. Enter `Switch this clone to auto-push with the set_push_policy tool`. A question that starts
   with "Switch this clone to auto-push?" should be raised. Answer Switch.
5. Enter `Run this exact command: git push origin b3`. It should run with no prompt.
6. Exit the session, then list the branches on the remote and remove the scratch folder. The list
   should be `b2`, `b3`, and `main`:

   ```powershell
   git -C "$d/remote.git" branch --list
   Set-Location $env:TEMP; Remove-Item -Recurse -Force $d
   ```

Replace this item with an "Analyze the interactive push prompt results" item: for steps 3 to 5,
whether each prompt was raised and what any warning on screen read, and the output of step 6.
