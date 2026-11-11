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

## Harden the session-skills push hold on managed Windows CLI

On Mac Desktop with unmanaged settings, the current `tool.check` hook
in `plugins/session-skills/hooks/register.ts` answers
`{ decision: 'ask' }` for a held push and the ask prompt reaches the
user. On Windows CLI 2.1.319 under managed settings
(Team/Enterprise sign-in), `classic.*` events are routed past user
plugins by `cc-plugin-sec-default`, `tool.check` among them, so the
ask prompt is skipped and a public push is not blocked. On 2026-11-11
a push to `main` ran without asking for the go.

### Working

- `judge()` in `register.ts` detects every held push: a hold reason
  per `land-and-wrap` §1, a force push, and a host write through
  `gh` or `glab`.
- The per-clone config keys `session-skills.holdPublicPush`,
  `holdFork`, and `holdPrText` are read and applied.
- The hold-for-go rule is in `land-and-wrap` §1.
- The `AGENTS.md` push rule that contradicted the hold is removed in
  commit `09c934c` (2026-11-11).

### Not working

- Under managed settings on Windows CLI 2.1.319, `tool.check` is
  skipped and a skipped-hook warning is printed.
- An earlier version of the plugin had a `pre-push` hook via
  `GIT_CONFIG_PARAMETERS` and a 1700-line command lexer. The bypass
  was denied by the auto-mode classifier on both machines, and work
  stopped on the managed machine because of the refusals, so the
  whole design was removed (DESIGN.md §136-140).
- The current DESIGN.md §119-134 workaround is to turn off
  `askBeforeOutwardWrites` and rely on skill text plus an auto-mode
  rule in managed settings; the managed-settings rule is "not
  tested" (§134).
- A prior Fable 5.2 session on the Mac ended without a working fix.

### Path identified in this Windows session

- `tool.call` is a native event, not `classic.*`. DESIGN.md §124:
  "the native paths reached the model in every run there." So a
  `tool.call` hook is reached under managed settings.
- Add a `tool.call` branch on `Bash` and `PowerShell` in
  `register.ts`. Call the existing `judge()`; when the result has
  reasons for a non-dry-run push, return `{ deny: '<reasons>. Ask
  the user to run this push in a plain terminal.' }`. Keep the
  `tool.check` branch for Mac Desktop.
- The simpler path: no bypass token. Denial is absolute; the user
  runs the push themselves in PowerShell after the model asks in
  chat. Enforcement is airtight; the cost is one manual push per
  cycle.
- Alternative: an approval-token path, with a session-local flag set
  through a plugin tool once the user says go and consumed by the
  hook on each push. More complex, and the flag is a seam the model
  can set on its own.
- Decide whether the new branch is gated by `askBeforeOutwardWrites`
  or by a new option of its own.

### Context files

- `plugins/session-skills/hooks/register.ts`—the hooks, `judge()`,
  `pushHold()`; the existing `tool.check` registration is at line
  738 as of commit `09c934c`.
- `plugins/session-skills/docs/DESIGN.md` §119-140—managed machines
  and the history of the removed `pre-push` hook.
- `plugins/session-skills/skills/land-and-wrap/SKILL.md` §1—the
  hold rules and their lifts.
- `plugins/session-skills/hooks/register.test.ts`—extend the tests.

Record the fix (or the next dead end) back in this heading, and push.
