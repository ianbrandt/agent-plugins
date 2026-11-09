# To do

## Check that held commands are refused where PowerShell's `tool.check` is skipped

In session-skills 0.27.4, a command its permission check would refuse is refused before the check
runs, and a skipped check is recorded per tool, after a failed call too. In the 0.27.3 check, Bash
calls were checked and the PowerShell call was not. No step pushes to a real remote.

1. In PowerShell 7, pull the coding-skills clone, update the plugin, and record the versions.
   `claude plugin list` should show session-skills 0.27.4:

   ```powershell
   claude plugin marketplace update ianbrandt
   claude plugin update session-skills@ianbrandt
   claude plugin list
   ```

2. Set up the probe repo:

   ```powershell
   $d = Join-Path $env:TEMP backstopprobe; Remove-Item -Recurse -Force $d -ErrorAction Ignore
   New-Item -ItemType Directory $d | Out-Null; Set-Location $d
   git init -q w; Set-Location w; git commit -q --allow-empty -m x
   git remote add held https://github.com/ianbrandt/no-such-backstop-probe.git
   ```

3. Start `claude` in `w`, in the permission mode you usually use. Ask Claude to run each of these
   with the PowerShell tool, in order, and to paste each tool result. Note whether the toast about a
   skipped `tool.check` hook appears on each call:

   ```
   git push held HEAD:refs/heads/main
   git status
   git config remote.held.url https://example.com/x.git
   ```

   The push should be refused with `Push refused`, and without `permission check did not run`.
   `git status` should run. The config write should be refused, starting with `Command refused:
   session-skills' permission check did not run`. If a permission prompt appears for it instead,
   answer No.

4. Ask Claude to run this with the Bash tool. A permission prompt should appear: answer No, and
   record whether it appeared:

   ```
   git config hook.sessionskills.enabled false
   ```

5. In PowerShell, outside Claude, check that neither config write ran. The first should print the
   GitHub URL, and the second nothing:

   ```powershell
   git config --local --get remote.held.url
   git config --local --get hook.sessionskills.enabled
   ```

6. Remove the probe directory:

   ```powershell
   Set-Location $env:TEMP; Remove-Item -Recurse -Force (Join-Path $env:TEMP backstopprobe)
   ```

Bring the versions and each result back to the Mac as a results item under this heading.
