# To do

## Check that Git for Windows runs a pre-push hook set through the environment

session-skills will add a `pre-push` hook to each session by setting `GIT_CONFIG_PARAMETERS`, so
that a push run from inside another program is still checked. This works on macOS with git 2.56.0.
Check it on the Windows machine, in a scratch directory, with no real remote involved.

1. In PowerShell 7, record the version:

   ```powershell
   git --version
   ```

2. Set up a local bare remote and a repo with one commit:

   ```powershell
   $d = Join-Path $env:TEMP hookprobe; Remove-Item -Recurse -Force $d -ErrorAction Ignore
   New-Item -ItemType Directory $d | Out-Null; Set-Location $d
   git init -q --bare o.git; git init -q w; Set-Location w; git commit -q --allow-empty -m x
   ```

3. Push with the hook given as `-c`, then through the environment. Each push should print
   `HOOK-RAN` and fail with `failed to push some refs`:

   ```powershell
   git -c hook.probe.event=pre-push -c hook.probe.command='echo HOOK-RAN; false' push ../o.git HEAD:refs/heads/main
   $env:GIT_CONFIG_PARAMETERS = "'hook.probe.event'='pre-push' 'hook.probe.command'='echo HOOK-RAN; false'"
   git push ../o.git HEAD:refs/heads/main
   Remove-Item Env:GIT_CONFIG_PARAMETERS
   ```

4. In Git Bash, from the same `w` directory, the push should print `HOOK-RAN` and fail the same way:

   ```bash
   export GIT_CONFIG_PARAMETERS="'hook.probe.event'='pre-push' 'hook.probe.command'='echo HOOK-RAN; false'"
   git push ../o.git HEAD:refs/heads/main
   unset GIT_CONFIG_PARAMETERS
   ```

5. In a Claude Code CLI session under the managed settings, ask Claude to run
   `echo $env:GIT_CONFIG_PARAMETERS` in PowerShell and `echo "$GIT_CONFIG_PARAMETERS"` in Bash after
   setting the variable in a `settings.json` `env` entry, to see whether a value set for the
   session reaches both tools.

Record the git version and each result in R559.1 on the Mac, then delete this file.
