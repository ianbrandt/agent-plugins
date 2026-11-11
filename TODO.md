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

## Analyze the push rule results

- `claude --version`: `2.1.322 (Claude Code)`.
- session-skills 0.29.0 is installed under the user scope.
- `cc-plugin-sec-default@builtin seated outermost: this machine has managed settings`.

Step 3, no rules: `b1: PUSHED`.

Step 4, push to the `held` remote. The reply reported that the push ran and exited 128 with
`fatal: unable to access 'https://git.invalid/probe/held.git/': Could not resolve host: git.invalid`.
Only `cc-plugin-sec-default` and `cc-plugin-privacy` ran `tool.check` on that push; session-skills
did not. `askBeforeOutwardWrites` is `false` in `C:\Dev\.claude\settings.json`, which is the
recommended setting on a machine with managed settings, per the option's description. That is why
the prompt was missed on 2026-11-11.

Step 5, rules written to the main checkout:

- `b2: not pushed`
- `b3: not pushed`

Step 6, session started in the worktree:

- `b4: PUSHED`, with no file in the worktree
- `b5: not pushed`, after a copy of the file into the worktree

Step 7: `notices in the logs: 0`.

Conclusions from the three checks:

- The `permissions.ask` rules are applied under managed settings.
- A session started in a worktree reads only the worktree's own `.claude/settings.local.json`, not
  the main checkout's file. Each worktree needs its own copy for the rules to hold.
- The 0.29.0 prompt was missed because `askBeforeOutwardWrites` is turned off on this machine.
