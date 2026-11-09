# To do

## Check that held commands are refused where `tool.check` is skipped

session-skills 0.27.3 refuses a held push, a gh or glab write, and a hook-key write from a
`tool.call` hook once a shell call has run without its `tool.check` hook. Check that the refusal
takes effect on the managed machine. No step pushes to a real remote, and gh is not installed, so a
command that runs anyway fails harmlessly.

1. In PowerShell 7, pull the coding-skills clone, update the plugin, and record the versions.
   `claude plugin list` should show session-skills 0.27.3:

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

3. Start `claude` in `w`, in the permission mode you usually use. Ask Claude to run `git status`
   with the Bash tool. Nothing is refused until a call has run without the `tool.check` hook.

4. Ask Claude to run each of these, the first and last with the Bash tool and the second with the
   PowerShell tool, and to paste each tool result. Each should start with `Command refused:
   session-skills' permission check did not run`, and the second should not mention gh missing:

   ```
   git push held HEAD:refs/heads/main
   gh pr merge 1
   git config hook.sessionskills.enabled false
   ```

5. In PowerShell, outside Claude, check that the config write did not run. It should print nothing:

   ```powershell
   git config --local --get hook.sessionskills.enabled
   ```

6. Remove the probe directory:

   ```powershell
   Set-Location $env:TEMP; Remove-Item -Recurse -Force (Join-Path $env:TEMP backstopprobe)
   ```

Bring the versions and each result back to the Mac, then remove this item from the file.
