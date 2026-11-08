# To do

## Check the session-skills pre-push backstop on Windows

Since 0.27.0, session-skills adds a `pre-push` hook to every git a session starts, by setting
`GIT_CONFIG_PARAMETERS`, and refuses a held push before it runs. Check both on the Windows machine,
under its managed settings, in a scratch directory. No step pushes to a real remote: `held` points
at a GitHub repo that does not exist.

1. In PowerShell 7, update the plugin and record the versions. `claude plugin list` should show
   session-skills 0.27.1:

   ```powershell
   claude plugin marketplace update ianbrandt
   claude plugin update session-skills@ianbrandt
   claude plugin list
   claude --version
   git --version
   ```

2. Set up a repo with a local bare remote and a held one:

   ```powershell
   $d = Join-Path $env:TEMP backstopprobe; Remove-Item -Recurse -Force $d -ErrorAction Ignore
   New-Item -ItemType Directory $d | Out-Null; Set-Location $d
   git init -q --bare o.git; git init -q w; Set-Location w; git commit -q --allow-empty -m x
   git remote add held https://github.com/ianbrandt/no-such-backstop-probe.git
   $sha = git rev-parse HEAD
   # One line ending in LF, as git gives the hook its stdin.
   [IO.File]::WriteAllText("$PWD\refs.txt", "refs/heads/main $sha refs/heads/main 0000000000000000000000000000000000000000`n")
   ```

3. Start `claude` in `w`. Note whether a `session-skills: the pre-push backstop is off` toast
   appears, and its reason if it does. One that says `GIT_CONFIG_PARAMETERS could not be set` means
   the managed settings refuse `$.env.set`.

4. In that session, ask Claude to run each of these with the Bash tool, then with the PowerShell
   tool, then with the Monitor tool, and paste the output of each:

   ```
   git hook list pre-push
   git config --get-all hook.sessionskills.command
   ```

   The list should include `sessionskills`, and the command should include the path to
   `pre-push.sh` under the plugin's cache directory, written with `/`. The second command is asked
   about, since it includes a hook key; approve it.

5. Ask Claude to run this with the Bash tool and then with the PowerShell tool. It runs the hook
   without pushing. The first should print `push refused by the session's pre-push hook` and exit 1,
   and the second should print nothing and exit 0:

   ```
   git hook run --to-stdin=refs.txt pre-push -- held https://github.com/ianbrandt/no-such-backstop-probe.git
   git hook run --to-stdin=refs.txt pre-push -- o ../o.git
   ```

6. Ask Claude to run `git push held HEAD:refs/heads/main` with the PowerShell tool, and then with
   the Bash tool.
   Each should be refused before it runs, with a command to run instead that starts with
   `git -C C:/` (forward slashes) and has `-c hook.sessionskills.enabled=false` after the directory.
   Let Claude run that command, and decline it at the permission prompt. Then ask Claude to run
   `git push ../o.git HEAD:refs/heads/main`, which should go through without a prompt.

7. Check a plugin path with a space and an apostrophe. Quit the session, copy the plugin, and start
   one with the copy:

   ```powershell
   $p = Join-Path $env:TEMP "it's here"; Remove-Item -Recurse -Force $p -ErrorAction Ignore
   New-Item -ItemType Directory $p | Out-Null
   Copy-Item -Recurse (Join-Path $HOME '.claude\plugins\cache\ianbrandt\session-skills\0.27.1') (Join-Path $p 'session-skills')
   claude --plugin-dir (Join-Path $p 'session-skills')
   ```

   Repeat steps 4 and 5 with the Bash tool. The command should now include the path to the copy
   under `it's here`. If it still has the cache directory's path, run `claude plugin disable
   session-skills@ianbrandt`, repeat this step, and then run `claude plugin enable
   session-skills@ianbrandt`.

8. In Git Bash, from the coding-skills clone, run the hook's tests. The last line should be
   `49 pass, 0 fail`:

   ```bash
   sh plugins/session-skills/hooks/pre-push.test.sh
   ```

Bring the versions and each result back to the Mac, then remove this item from the file.
