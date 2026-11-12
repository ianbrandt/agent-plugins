# Development

## Releases

Each plugin is installed from the commit pinned in its `.claude-plugin/marketplace.json` entry, so a
push to `main` releases nothing. A release is a `<plugin>-v<version>` tag on the commit to ship,
then a commit on `main` to move the entry's `version`, `ref`, and `sha` to that tag. The
`version` has to go up: an installed plugin is not updated when only its `sha` moves. Versions
follow SemVer. The major part goes up for a breaking change, the minor part for a new feature or a
change in behavior, and the patch part only for a fix. In a plugin still at 0.x, a breaking change
is a minor bump too.

The tag is pushed with `main`, since CI checks each pin against its tag:

```bash
git push origin main gradle-skills-v1.12.0
```

## Checks

`test.sh` runs every check that needs no model call, in about 30 seconds. It needs `claude` and
`node` on the `PATH`.

```bash
./test.sh
```

- `claude plugin test` in each plugin that has a hooks module.
- [`graders.test.mjs`](graders.test.mjs): each regex grader in an eval suite, against one text it
  has to match and one it must not. A regex grader with no texts fails.
- `claude plugin validate` on each plugin, and Confer's typecheck.
- For each entry in `.claude-plugin/marketplace.json`, a `<plugin>-v<version>` tag at the pinned
  commit, the plugin's directory in that commit, and the same description and keywords as the
  `plugin.json` there.

The same script runs in GitHub Actions on Linux, macOS, and Windows for each push and pull request,
under Claude Code 2.1.317 and the latest release ([`test.yml`](.github/workflows/test.yml)). A pass on Windows does not replace a live run there: the
unit tests run against mocked file and git calls. Checks that need another machine are listed in
`TODO.md` at the root, and each is removed from it once its results are back.

The eval suites call a model and cost money. Each is run from its plugin's directory, with the
command in that plugin's README, or in `docs/DESIGN.md` for `writing-conventions`. So do the
[end-to-end tests](e2e/README.md), which run `next-roadmap-item` end to end in a scratch repo.

## Building Confer

Confer needs Node.js and Claude Code 2.1.317 or later. Run these commands in `plugins/confer`.

1. Install TypeScript:

   ```bash
   npm ci
   ```

2. Type-check, test, and validate the plugin:

   ```bash
   npm run typecheck
   claude plugin test
   claude plugin validate .
   ```

The plugin API of Claude Code 2.1.317 is declared in `types/claude-code/index.d.ts`. To update
that file, replace it with `.claude-plugin/types/claude-code/index.d.ts`, which Claude Code
writes when you run `claude --plugin-dir .` in `plugins/confer`.
