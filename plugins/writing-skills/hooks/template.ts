// The headings an issue may keep: the field labels of the target repo's issue
// forms and the headings of its Markdown issue templates, as GitHub lays them
// out in a new issue. Each heading with one of them as its text is removed from
// what the review model is sent, so that item 5 of gate-prompt.md flags every
// other heading.

// A heading line, or the first line of a body quoted in a shell command.
const HEADING = /(^ {0,3}|["'])#{1,6}[ \t]+([^\n]*?)(?:[ \t]+#+)?[ \t]*\r?$\n?/gm

// A YAML label as written on one line, quoted or plain, up to a comment.
function scalar(v: string): string {
  if (v.startsWith("'")) return v.replace(/^'((?:[^']|'')*)'(?:[ \t]+#.*)?$/, '$1').replace(/''/g, "'")
  if (v.startsWith('"')) return v.replace(/^"((?:[^"\\]|\\.)*)"(?:[ \t]+#.*)?$/, '$1')
  return v.replace(/[ \t]+#.*$/, '')
}

// labels(files): the label of every field in the issue forms among `files`,
// and every heading in the Markdown templates. A checkbox option's label is a
// list item, `- label:`, and is not matched.
// shortcut: a label written as a block scalar (`label: >-`) is skipped; read
// the next lines if a form in use writes one.
export function labels(files: { name: string; text: string }[]): string[] {
  const out: string[] = []
  for (const { name, text } of files) {
    const t = text.replace(/\r/g, '')
    if (/\.ya?ml$/i.test(name)) {
      for (const m of t.matchAll(/^[ \t]+label:[ \t]*(.*?)[ \t]*$/gm)) if (!/^[>|]/.test(m[1])) out.push(scalar(m[1]))
    } else if (/\.md$/i.test(name)) {
      for (const m of t.replace(/^---\n[\s\S]*?\n---\n/, '').matchAll(HEADING)) out.push(m[2])
    }
  }
  return out.filter(l => l !== '')
}

// unheaded(text, allowed): the text with each heading removed, along with its
// line end, where the heading's text is in `allowed`.
export function unheaded(text: string, allowed: Set<string>): string {
  return allowed.size === 0 ? text : text.replace(HEADING, (line, quote, label) => (allowed.has(label) ? quote : line))
}

// The repos linked in a text by a github.com URL, at most three. A path under
// one of GitHub's own pages is no repo.
export function linked(text: string): string[] {
  const found = [...text.matchAll(/(?:^|[^\w.-])github\.com\/(?!(?:orgs|users|settings|apps|marketplace|sponsors|topics|features|enterprises)\/)([\w-]+\/[\w.-]+)/g)]
    .map(m => m[1].replace(/\.+$/, '').replace(/\.git$/, ''))
  return [...new Set(found)].slice(0, 3)
}

// The command with each heredoc body taken out where the delimiter is
// quoted. No command in such a body runs, and a quote in it closes nothing.
export function literal(cmd: string): string {
  return cmd.replace(/(<<-?[ \t]*(["'])([^"'\s]+)\2[^\n]*\n)[\s\S]*?^([ \t]*\3)$/gm, '$1$4')
}

// The command with each quoted argument emptied, so that the text of a body is
// not read as a flag. The quoted value of a repo flag is kept.
export function unquoted(cmd: string): string {
  return cmd.replace(/(--repo(?:=|\s+)|-R\s*)?("(?:[^"\\]|\\[\s\S])*"|'[^']*')/g, (arg, flag) => (flag ? arg : '""'))
}

// The repo a gh command is run against, given with the last --repo or -R, or
// else with GH_REPO before the command: undefined where none is given, and ''
// where the one given is not a repo on github.com.
export function repoFlag(cmd: string): string | undefined {
  const flags = [...unquoted(literal(cmd)).matchAll(/(?:^|\s)(?:--repo(?:=|\s+)|-R\s*)(["']?)(\S+?)\1(?=\s|$)/g)]
  const raw = flags.length > 0 ? flags[flags.length - 1][2] : /^\s*(?:\w+=\S*\s+)*?GH_REPO=(["']?)(\S+?)\1\s/.exec(cmd)?.[2]
  if (raw === undefined) return undefined
  const repo = raw.replace(/^https?:\/\//, '').replace(/^github\.com\//, '').replace(/\.git$|\/$/, '')
  return /^[\w-]+\/[\w.-]+$/.test(repo) ? repo : ''
}

const QUERY = 'query($owner:String!,$name:String!){repository(owner:$owner,name:$name){object(expression:"HEAD:.github/ISSUE_TEMPLATE"){... on Tree{entries{name object{... on Blob{text}}}}}}}'

// Each repo's templates and each directory's repo are read with gh once a
// session. After a failed read, the repo has no templates for the rest of the
// session, so that offline each check does not wait for gh to time out.
const templates = new Map<string, Promise<string[]>>()
const defaults = new Map<string, Promise<string>>()

function once<T>(cache: Map<string, Promise<T>>, key: string, read: () => Promise<T>, none: T): Promise<T> {
  if (!cache.has(key)) cache.set(key, read().catch(() => none))
  return cache.get(key)!
}

async function gh($: any, cwd: string, argv: string[]): Promise<string> {
  const ran = await $.process.run(['gh', ...argv], { cwd, timeoutMs: 5000 })
  if (ran.exitCode !== 0) throw new Error(ran.stderr)
  return ran.stdout
}

// For a repo with no .github/ISSUE_TEMPLATE, the templates in its owner's
// .github repo are used, as on GitHub.
function labelsOf($: any, cwd: string, repo: string): Promise<string[]> {
  const [owner, name] = repo.split('/')
  return once(templates, repo, async () => {
    const found = JSON.parse(await gh($, cwd, ['api', 'graphql', '-f', `query=${QUERY}`, '-f', `owner=${owner}`, '-f', `name=${name}`])).data?.repository
    if (found && !found.object && name !== '.github') return labelsOf($, cwd, `${owner}/.github`)
    return labels((found?.object?.entries ?? []).map((e: any) => ({ name: String(e.name), text: String(e.object?.text ?? '') })))
  }, [])
}

// headings($, cwd, texts, repos, here): the headings allowed in an issue to
// `repos`, and to the repo gh picks in `cwd` where `here` is set. Where no text
// has a heading, gh is not run.
export async function headings($: any, cwd: string, texts: string[], repos: string[], here: boolean): Promise<Set<string>> {
  if (!texts.some(t => new RegExp(HEADING.source, 'm').test(t))) return new Set()
  const local = here ? await once(defaults, cwd, async () => (await gh($, cwd, ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'])).trim(), '') : ''
  const all = [...new Set([...repos, local].filter(r => r !== ''))]
  return new Set((await Promise.all(all.map(r => labelsOf($, cwd, r)))).flat())
}
