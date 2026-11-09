# To do

## Check the pre-push hook's Windows path fix and the tool.call hooks

session-skills 0.27.2 prints the refused push's repo with `pwd -W` under Git for Windows. Check
that, and whether the plugin's `tool.call` hooks run where `cc-plugin-sec-default` skips its
`tool.check`. No step pushes to a real remote.

1. In PowerShell 7, pull the coding-skills clone, update the plugin, and record the versions.
   `claude plugin list` should show session-skills 0.27.2:

   ```powershell
   claude plugin marketplace update ianbrandt
   claude plugin update session-skills@ianbrandt
   claude plugin list
   ```

2. In Git Bash, from the coding-skills clone, run the hook's tests. The last line should be
   `49 pass, 0 fail`:

   ```bash
   sh plugins/session-skills/hooks/pre-push.test.sh
   ```

3. Set up the probe repo again:

   ```powershell
   $d = Join-Path $env:TEMP backstopprobe; Remove-Item -Recurse -Force $d -ErrorAction Ignore
   New-Item -ItemType Directory $d | Out-Null; Set-Location $d
   git init -q --bare o.git; git init -q w; Set-Location w; git commit -q --allow-empty -m x
   git remote add held https://github.com/ianbrandt/no-such-backstop-probe.git
   $sha = git rev-parse HEAD
   [IO.File]::WriteAllText("$PWD\refs.txt", "refs/heads/main $sha refs/heads/main 0000000000000000000000000000000000000000`n")
   ```

4. Start `claude` in `w`. Ask Claude to run this with the PowerShell tool, then with the Bash tool,
   and paste both outputs. The `Repo:` line should be `C:/...` in both:

   ```
   git hook run --to-stdin=refs.txt pre-push -- held https://github.com/ianbrandt/no-such-backstop-probe.git
   ```

5. Ask Claude to run `git push ../o.git HEAD:refs/heads/main` with the Bash tool, then ask whether
   the tool result included a request to end the reply with the next step. Note any toast that
   says a `tool.call` hook was skipped.

Bring the versions and each result back to the Mac, then remove this item from the file.
