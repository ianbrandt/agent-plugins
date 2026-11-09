import type { EngineInterface } from 'claude-code'

export type GitToolResult = { exitCode: number; stdout: string; stderr: string; truncated: boolean }

// `value` is set for an option that takes one: `required` for `--x=v`, `-xv`, or `-x v`, `optional`
// for `--x`, `--x=v`, `-x`, or `-xv`. Any other spelling, a bundle or an abbreviation, is refused.
type Option = { value?: 'required' | 'optional'; matches?: { test: (value: string) => boolean }; isDashAllowed?: boolean }
type Options = Record<string, Option>

const flag: Option = {}
const any: Option = { value: 'required' }
const number: Option = { value: 'required', matches: /^\d+$/ }
const score: Option = { value: 'optional', matches: /^\d+%?$/ }
const word: Option = { value: 'required', matches: /^[\w-]+$/ }
// `%G` placeholders run gpg, and Git reads `%+G`, `%-G`, and `% G` as the same placeholder.
const format: Option = { value: 'required', matches: /^(?![\s\S]*%[-+ ]?G)/ }
const builtInFormats = ['oneline', 'short', 'medium', 'full', 'fuller', 'reference', 'email', 'mboxrd', 'raw']
// Any other name is looked up as pretty.<name> in the user's config, which may hold a %G placeholder.
const isPretty = (value: string) => builtInFormats.includes(value) || ((value.includes('%') || /^t?format:/.test(value)) && format.matches!.test(value))
const pretty: Option = { value: 'required', matches: { test: isPretty } }

const flags = (...names: string[]): Options => Object.fromEntries(names.map(name => [name, flag]))
const all = (option: Option, ...names: string[]): Options => Object.fromEntries(names.map(name => [name, option]))

const diffOptions: Options = {
  ...flags('-p', '-u', '--patch', '-s', '--no-patch', '--raw', '--patch-with-raw', '--patch-with-stat', '--compact-summary', '--numstat'),
  ...flags('--shortstat', '--summary', '--name-only', '--name-status', '-z', '--full-index', '--binary', '--minimal', '--patience'),
  ...flags('--histogram', '-W', '--function-context', '--no-color', '--find-copies-harder', '--no-renames', '-D', '--irreversible-delete'),
  ...flags('--pickaxe-all', '--pickaxe-regex', '-R', '-a', '--text', '--ignore-cr-at-eol', '--ignore-space-at-eol', '-b'),
  ...flags('--ignore-space-change', '-w', '--ignore-all-space', '--ignore-blank-lines', '--no-prefix', '--default-prefix', '--check'),
  ...flags('--exit-code', '--quiet'),
  '--stat': { value: 'optional', matches: /^\d*(,\d*){0,2}$/ },
  '--dirstat': { value: 'optional', matches: /^[\w,.%]+$/ },
  '--abbrev': { value: 'optional', matches: /^\d+$/ },
  '--diff-algorithm': word,
  '-U': number,
  '--unified': number,
  '--inter-hunk-context': number,
  '--word-diff': { value: 'optional', matches: /^(color|plain|porcelain|none)$/ },
  '--word-diff-regex': any,
  '--color-words': { value: 'optional' },
  '--color': { value: 'optional', matches: /^(always|never|auto)$/ },
  '--color-moved': { value: 'optional', matches: /^[\w-]+$/ },
  ...all(score, '-M', '-C', '--find-renames', '--find-copies'),
  ...all({ value: 'optional', matches: /^\d*%?(\/\d+%?)?$/ }, '-B', '--break-rewrites'),
  '--diff-filter': { value: 'required', matches: /^[ACDMRTUXB*]+$/i },
  ...all(any, '-S', '-G', '-I', '--ignore-matching-lines', '--src-prefix', '--dst-prefix'),
  '--relative': { value: 'optional' },
  '--ignore-submodules': { value: 'optional', matches: /^(none|untracked|dirty|all)$/ },
}

const logOptions: Options = {
  ...diffOptions,
  ...flags('--all-match', '--invert-grep', '-i', '--regexp-ignore-case', '-E', '--extended-regexp', '-F', '--fixed-strings', '-P'),
  ...flags('--perl-regexp', '--basic-regexp', '--merges', '--no-merges', '--first-parent', '--exclude-first-parent-only', '--not'),
  ...flags('--all', '--reflog', '-g', '--walk-reflogs', '--merge', '--boundary', '--left-right', '--left-only', '--right-only'),
  ...flags('--cherry-pick', '--cherry-mark', '--cherry', '--simplify-by-decoration', '--full-history', '--dense', '--sparse'),
  ...flags('--simplify-merges', '--show-pulls', '--topo-order', '--date-order', '--author-date-order', '--reverse', '--do-walk'),
  ...flags('--follow', '--oneline', '--abbrev-commit', '--no-abbrev-commit', '--no-expand-tabs', '--no-notes', '--relative-date'),
  ...flags('--parents', '--children', '--graph', '--no-decorate', '--source', '--use-mailmap', '--mailmap', '--log-size'),
  ...flags('--full-diff', '-m', '--cc', '--dd', '--no-diff-merges', '-t', '--root'),
  '-n': number,
  ...all(number, '--max-count', '--skip', '--min-parents', '--max-parents'),
  ...all(any, '--since', '--after', '--until', '--before', '--since-as-filter', '--author', '--committer', '--grep', '-L'),
  ...all(any, '--glob', '--exclude', '--encoding', '--date', '--decorate-refs', '--decorate-refs-exclude'),
  ...all({ value: 'optional' }, '--branches', '--tags', '--remotes', '--ancestry-path', '--notes'),
  '--no-walk': { value: 'optional', matches: /^(sorted|unsorted)$/ },
  '--expand-tabs': { value: 'optional', matches: /^\d+$/ },
  '--decorate': { value: 'optional', matches: /^(short|full|auto|no)$/ },
  // remerge and r are left out: a remerge diff writes a temporary object directory.
  '--diff-merges': { value: 'required', matches: /^(off|none|on|first-parent|1|separate|m|combined|c|dense-combined|cc)$/ },
  '--format': pretty,
  '--pretty': { ...pretty, value: 'optional' },
}

const subcommands: Record<string, { options: Options; guards: string[]; isNumberShortcut?: boolean }> = {
  diff: { options: { ...diffOptions, ...flags('--cached', '--staged', '--merge-base') }, guards: ['--no-ext-diff', '--no-textconv'] },
  // log.showSignature in the user's config would run gpg on a signed commit.
  show: { options: logOptions, guards: ['--no-ext-diff', '--no-textconv', '--no-show-signature'], isNumberShortcut: true },
  log: { options: logOptions, guards: ['--no-ext-diff', '--no-textconv', '--no-show-signature'], isNumberShortcut: true },
  blame: {
    options: {
      ...flags('-b', '--root', '--show-stats', '-l', '-t', '-s', '-e', '--show-email', '-w', '-n', '--show-number', '-f'),
      ...flags('--show-name', '-p', '--porcelain', '--line-porcelain', '--incremental', '--reverse', '--first-parent'),
      ...flags('--color-lines', '--color-by-age', '--minimal'),
      ...all(any, '-L', '--encoding', '--date', '--since', '--ignore-rev'),
      ...all(score, '-M', '-C'),
      '--abbrev': { value: 'optional', matches: /^\d+$/ },
    },
    guards: ['--no-ext-diff', '--no-textconv'],
  },
  'ls-files': {
    options: {
      ...flags('-c', '--cached', '-d', '--deleted', '-m', '--modified', '-o', '--others', '-i', '--ignored', '-s', '--stage'),
      ...flags('-u', '--unmerged', '-k', '--killed', '--directory', '--no-empty-directory', '--eol', '-z', '-t', '-v', '-f'),
      ...flags('--full-name', '--error-unmatch', '--exclude-standard', '--deduplicate', '--sparse'),
      '--abbrev': { value: 'optional', matches: /^\d+$/ },
      ...all(any, '--with-tree', '-x', '--exclude'),
      '--format': format,
    },
    guards: [],
  },
  'ls-tree': {
    options: {
      ...flags('-d', '-r', '-t', '-l', '--long', '-z', '--name-only', '--name-status', '--object-only', '--full-name', '--full-tree'),
      '--abbrev': { value: 'optional', matches: /^\d+$/ },
      '--format': format,
    },
    guards: [],
  },
  'cat-file': { options: flags('-p', '-t', '-s', '-e', '--mailmap', '--use-mailmap'), guards: [] },
  'rev-parse': {
    options: {
      ...flags('--verify', '-q', '--quiet', '--symbolic', '--symbolic-full-name', '--show-toplevel', '--show-prefix', '--show-cdup'),
      ...flags('--git-dir', '--git-common-dir', '--absolute-git-dir', '--is-inside-work-tree', '--is-inside-git-dir'),
      ...flags('--is-bare-repository', '--is-shallow-repository', '--all', '--not', '--revs-only', '--no-revs', '--flags', '--no-flags'),
      '--short': { value: 'optional', matches: /^\d+$/ },
      '--abbrev-ref': { value: 'optional', matches: /^(strict|loose)$/ },
      '--show-object-format': { value: 'optional', matches: /^(storage|input|output)$/ },
      ...all({ value: 'optional' }, '--branches', '--tags', '--remotes'),
    },
    // rev-parse echoes an option it does not know, so it takes no guards.
    guards: [],
  },
  'merge-base': { options: flags('-a', '--all', '--octopus', '--independent', '--is-ancestor', '--fork-point'), guards: [] },
  grep: {
    options: {
      ...flags('-i', '--ignore-case', '-I', '-a', '--text', '-w', '--word-regexp', '-v', '--invert-match', '-h', '-H', '--full-name'),
      ...flags('-E', '--extended-regexp', '-G', '--basic-regexp', '-F', '--fixed-strings', '-P', '--perl-regexp', '-n'),
      ...flags('--line-number', '--column', '-l', '--files-with-matches', '--name-only', '-L', '--files-without-match', '-z'),
      ...flags('--null', '-o', '--only-matching', '-c', '--count', '--no-color', '--break', '--heading', '-p', '--show-function'),
      ...flags('-W', '--function-context', '--and', '--or', '--not', '--all-match', '-q', '--quiet', '--cached', '--untracked'),
      '--color': { value: 'optional', matches: /^(always|never|auto)$/ },
      ...all(number, '-A', '-B', '-C', '--after-context', '--before-context', '--context', '-m', '--max-count', '--max-depth'),
      '-e': { value: 'required', isDashAllowed: true },
    },
    guards: ['--no-textconv'],
    isNumberShortcut: true,
  },
}

// Set to Git's defaults: the user's format.pretty could run gpg, and the user's log.diffMerges could make -m a remerge diff.
const prefix = ['git', '-c', 'core.fsmonitor=false', '-c', 'format.pretty=medium', '-c', 'log.diffMerges=separate', '--no-lazy-fetch', '--no-pager', '--no-optional-locks']
// A diff with a path outside the repository becomes an implicit --no-index, which reads any file.
const isOutside = (arg: string) => /^([A-Za-z]:|[\\/])/.test(arg) || arg.split(/[\\/]/).includes('..')
const timeoutMs = 60_000
const stdoutLimitBytes = 256 * 1024

export function gitToolArgv(args: readonly string[]): { argv: string[] } | { refused: string } {
  const [name = '', ...rest] = args
  const subcommand = Object.hasOwn(subcommands, name) ? subcommands[name] : undefined
  if (subcommand === undefined) return { refused: `\`${name}\` is not one of ${Object.keys(subcommands).join(', ')}.` }
  const lookup = (option: string) => (Object.hasOwn(subcommand.options, option) ? subcommand.options[option] : undefined)
  const refused = (arg: string) => ({ refused: `git ${name} does not allow \`${arg}\` here.` })
  let isPaths = false
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!
    if (isPaths || arg === '--' || !arg.startsWith('-')) {
      if (name === 'diff' && isOutside(arg)) return refused(arg)
      isPaths ||= arg === '--'
      continue
    }
    if (subcommand.isNumberShortcut && /^-\d+$/.test(arg)) continue
    const isLong = arg.startsWith('--')
    const split = isLong ? arg.indexOf('=') : 2
    const key = split < 0 ? arg : arg.slice(0, split)
    const value = split < 0 || split >= arg.length ? undefined : arg.slice(isLong ? split + 1 : split)
    const option = lookup(key)
    if (option === undefined || (value !== undefined && option.value === undefined)) return refused(arg)
    if (value !== undefined) {
      if (!(option.matches?.test(value) ?? true)) return refused(arg)
    } else if (option.value === 'required') {
      // Only a short option takes its value as the next argument; a long one is written `--x=v`.
      const next = rest[++i]
      if (isLong || next === undefined || (next.startsWith('-') && !option.isDashAllowed) || !(option.matches?.test(next) ?? true)) return refused(arg)
    }
  }
  return { argv: [...prefix, name, ...subcommand.guards, ...rest] }
}

export async function runGitTool($: EngineInterface, cwd: string, args: readonly string[]): Promise<GitToolResult | { refused: string }> {
  const built = gitToolArgv(args)
  if ('refused' in built) return built
  const result = await $.process.run(built.argv, { cwd, timeoutMs })
  const bytes = new TextEncoder().encode(result.stdout)
  let end = bytes.length
  if (end > stdoutLimitBytes) {
    end = stdoutLimitBytes
    while ((bytes[end]! & 0xc0) === 0x80) end--
  }
  return {
    exitCode: result.exitCode,
    stdout: end === bytes.length ? result.stdout : new TextDecoder().decode(bytes.subarray(0, end)),
    stderr: result.stderr,
    truncated: result.isStdoutTruncated || end < bytes.length,
  }
}
