// migrate_backlog (design, Migration): turns an old roadmap into the backlog
// files and the plan. Converting the roadmap's items and header takes
// judgment, so the session supplies that text; the tool does every mechanical
// step and records each in a marker, so a rerun continues where a call stopped.
import { type FileName, type Problem, GROUP, branchId, headings, idsGrouped, parseBacklog, parseHeadings, scan } from './format'
import { problemsOf, settleLocked } from './journal'
import { LOCAL, TRACKED } from './kind'
import { withLock } from './lock'
import { type Repo, claims, deletedOnDefault, facts, filesOf, git, run, why } from './repo'
import { MIGRATION, answer } from './tools'
import { dateOf } from './write'

export const MIGRATE_TOOLS = [
  {
    name: 'migrate_backlog',
    description: 'Migrate an old roadmap to the backlog files and the plan. Called with no text, it returns the preconditions, the old files with their IDs and headers, and what to pass. Called with the converted backlog and plan (or run: true when no text is needed), it does every step: the exclusions, the marker, the backup, the writes, the checks, and the deletion of the old files. A repeated call continues an interrupted migration.',
    inputSchema: {
      type: 'object',
      properties: {
        backlog: { type: 'string', description: "The old roadmap's items converted to the backlog format, from the first item heading on. The tool writes the title and the Highest ID used line." },
        plan: { type: 'string', description: 'The plan, from the old header, without the rules already stated in this plugin. "" for no plan.' },
        branch: { type: 'string', description: 'Tracked roadmap only: the branch the migration is committed on, checked out in the primary checkout or a worktree. Not the default branch.' },
        message: { type: 'string', description: 'Tracked roadmap only: the commit message.' },
        run: { type: 'boolean', description: 'True to do the steps when no text is needed, as when continuing a migration whose backlog and plan were written.' },
      },
    },
  },
]

type Dest = { started: boolean; hash?: string; none?: boolean }
type Marker = { complete: boolean; tracked: boolean; branch?: string; backup: string; old: string[]; dests: Record<string, Dest> }
type Setup = { tracked: boolean; root: string; branch?: string; old: string[]; checks: [boolean, string][] }
type Role = FileName | 'plan'

// Each old file's role. The parked, declined, and changelog files are copied unchanged.
const ROLE: Record<string, Role> = {
  'ROADMAP.local.md': 'backlog', 'ROADMAP-PARKED.local.md': 'parked', 'ROADMAP-DECLINED.local.md': 'declined', 'ROADMAP-CHANGELOG.local.md': 'changelog',
  'ROADMAP.md': 'backlog', 'docs/roadmap.md': 'backlog', 'ROADMAP-PARKED.md': 'parked', 'ROADMAP-DECLINED.md': 'declined',
}
const LOCAL_OLD = /^ROADMAP(-.*)?\.local\.md$/

const fail = (message: string): never => { throw new Error(message) }
const read = ($: any, path: string): Promise<string | undefined> => $.fs.read(path).catch(() => undefined)
const top = (id: string) => Number(/\d+/.exec(id)![0])
const list = (xs: string[]) => xs.join(', ') || 'none'
const markerAt = (repo: Repo) => `${repo.common}/backlog/migration/marker.json`

async function put($: any, path: string, text: string, what: string): Promise<void> {
  await $.fs.write(path, text)
  if ((await read($, path)) !== text) fail(`${path} did not read back as written, ${what}`)
}

// git with its arguments in one array, for a call with a list of paths.
async function must($: any, root: string, argv: string[]): Promise<string> {
  const r = await run($, root, argv)
  if (r.exitCode !== 0) fail(`git ${argv.join(' ')} in ${root}: ${why(r)}`)
  return String(r.stdout)
}

async function hashOf($: any, repo: Repo, text: string): Promise<string> {
  const r = await run($, repo.main, ['hash-object', '--stdin'], text)
  if (r.exitCode !== 0) fail(`git hash-object --stdin in ${repo.main}: ${why(r)}`)
  return String(r.stdout).trim()
}

// The marker of a migration that did not finish. One that does not parse is
// refused: nothing about it can be trusted.
async function markerOf($: any, repo: Repo): Promise<Marker> {
  const at = markerAt(repo)
  try {
    const m = JSON.parse((await read($, at)) ?? '')
    if (typeof m.backup !== 'string' || !Array.isArray(m.old) || !m.dests || typeof m.dests !== 'object') throw new Error()
    return m
  } catch {
    return fail(`the migration marker ${at} does not parse. Compare the files it lists with the old ones, then remove it by hand and start again`)
  }
}

// Each heading of level 2 to 4 that starts with an ID, a range, or a list, in
// any of the old forms: `R12: Title`, `R12—Title`, `R12 Title`.
const LED = new RegExp(`^(${GROUP})`)
function ledHeadings(text: string): { ids: string[]; line: number }[] {
  return headings(text, scan(text).lines, 4).filter(h => h.level >= 2).flatMap(h => {
    const m = LED.exec(h.rest)
    return m ? [{ ids: idsGrouped(m[1]), line: h.line.n }] : []
  })
}
const idsOf = (text: string) => [...new Set(ledHeadings(text).flatMap(h => h.ids))]

// Which migration, in which checkout, and every precondition, each as passed or not.
async function setup($: any, repo: Repo, m: Marker | undefined, e: any): Promise<Setup> {
  const checks: [boolean, string][] = []
  const check = (ok: boolean, text: string) => checks.push([ok, text])
  const localOld = repo.files.filter(n => LOCAL_OLD.test(n))
  // A fork's tracked roadmap is the upstream project's.
  const trackedOld = repo.hasUpstream ? [] : repo.tracked.filter(t => t !== 'BACKLOG.md')
  const tracked = m ? m.tracked : trackedOld.length > 0
  let root = repo.main
  let branch: string | undefined
  if (tracked) {
    branch = m?.branch ?? e.branch
    const def = repo.defaultRef.replace(/^refs\/(heads|remotes\/origin)\//, '')
    if (m && e.branch !== undefined && e.branch !== m.branch) check(false, `the migration's branch is ${m.branch}, not ${e.branch}`)
    if (!repo.defaultRef) check(false, 'the default branch is not known: there is no origin/HEAD, main, or master')
    if (typeof branch !== 'string' || !branch) check(false, `branch: pass branch, a branch other than ${def || 'the default branch'} checked out in the primary checkout or a worktree. The migration is committed on it`)
    else if (branch === def) check(false, `branch: ${branch} is the default branch. Pass a new branch for the migration`)
    else {
      const w = repo.worktrees.find(w => w.branch === branch)
      if (!w) check(false, `branch: ${branch} is not checked out in the primary checkout or a worktree`)
      else { root = w.path; check(true, `branch: ${branch}, checked out in ${root}`) }
    }
    if (typeof e.message !== 'string' || !e.message.trim()) check(false, 'message: pass the commit message for the migration')
  } else if (e.branch !== undefined || e.message !== undefined) check(false, 'a local-only roadmap is not committed: leave out branch and message')

  let old: string[]
  if (m) old = m.old
  else if (tracked) {
    const names: string[] = (await $.fs.list(root).catch(() => [])).map((f: any) => f.name)
    const inRoot = (await git($, root, 'ls-files', '--', 'ROADMAP.md', 'docs/roadmap.md', 'ROADMAP-PARKED.md', 'ROADMAP-DECLINED.md')).split(/\r?\n/).filter(Boolean)
    old = inRoot
    if (localOld.length) check(false, `this repo has a tracked roadmap and local-only roadmap files (${list(localOld)}). Move the local-only files out of the primary checkout first`)
    if (inRoot.filter(n => ROLE[n] === 'backlog').length !== 1) check(false, `the tracked roadmap is one of ROADMAP.md and docs/roadmap.md, and ${root} has ${list(inRoot.filter(n => ROLE[n] === 'backlog'))}`)
    const other = names.filter(n => /^ROADMAP/.test(n) && !inRoot.includes(n))
    if (other.length) check(false, `files the migration does not know: ${list(other)}. Merge them into the roadmap or move them out first`)
  } else {
    old = localOld
    const other = localOld.filter(n => !ROLE[n])
    if (other.length) check(false, `files the migration does not know: ${list(other)}. Merge them into the roadmap or move them out first`)
  }

  const ledger = await claims($, repo.main, repo.worktrees)
  const live = ledger.live.filter(c => c.branch !== branch)
  if (live.length || ledger.unread.length) check(false, `the claim ledger in ${repo.main}/.claude/claims is not empty: ${list([...live.map(c => `${c.file} (${c.branch})`), ...ledger.unread.map(f => `${f} does not parse`)])}`)
  else check(true, 'the claim ledger is empty')

  const names: string[] = (await $.fs.list(root).catch(() => [])).map((f: any) => f.name)
  const found = names.filter(n => /^(BACKLOG|PLAN)/.test(n) && !m?.dests[n]?.started)
  if (found.length) check(false, `${root} has ${list(found)}, which the migration did not write. Move them out first, so every BACKLOG* and PLAN* file is the migration's`)
  else check(true, 'no BACKLOG* or PLAN* file but the migration\'s')

  if (tracked) {
    const own = branch ? branchId(branch) : undefined
    const flying = [...repo.inFlight].filter(id => id !== own)
    if (flying.length) check(false, `branches or worktrees with commits the default branch lacks, which edit the roadmap: ${list(flying)}. Land or park them first`)
    else check(true, 'no item branch has commits the default branch lacks')
    if (!m && old.length) {
      const st = await must($, root, ['status', '--porcelain', '--', ...old])
      if (st.trim()) check(false, `the old roadmap files have changes that are not committed:\n${st.trimEnd()}`)
      else check(true, 'the old roadmap files are committed')
    }
  }
  return { tracked, root, branch, old, checks }
}

// The old files' text: on a local-only roadmap from the backup once there is
// one, since step 6 deletes the files; on a tracked one from HEAD once git rm ran.
async function oldTexts($: any, s: Setup, m?: Marker): Promise<Record<string, string>> {
  const texts: Record<string, string> = {}
  for (const name of s.old) {
    let t = !s.tracked && m ? await read($, `${m.backup}/${name}`) : undefined
    t ??= await read($, `${s.root}/${name}`)
    if (t === undefined && s.tracked) t = await git($, s.root, 'show', `HEAD:${name}`).catch(() => undefined)
    // After the migration's commit: the commit before the one that deleted the file.
    if (t === undefined && s.tracked) {
      const del = (await git($, s.root, 'rev-list', '-1', 'HEAD', '--', name).catch(() => '')).trim()
      if (del) t = await git($, s.root, 'show', `${del}^:${name}`).catch(() => undefined)
    }
    texts[name] = t ?? fail(`${s.root}/${name} cannot be read${s.tracked ? '' : `, and ${m ? `${m.backup} has no copy of it` : 'there is no backup yet'}`}`)
  }
  return texts
}

// D3's rule: the highest ID in every old file, and on a tracked roadmap with no
// Highest ID used line, in the headings deleted on the default branch too.
async function highestOf($: any, repo: Repo, s: Setup, texts: Record<string, string>): Promise<number> {
  // The roadmap's line only, since an old one may be quoted in a changelog's prose.
  const roadmap = s.old.find(n => ROLE[n] === 'backlog')
  const line = (roadmap ? [/Highest ID used\W*[A-Z]+(\d+)/.exec(texts[roadmap])?.[1] ?? []] : []).flat().map(Number)
  const ids = Object.values(texts).flatMap(idsOf)
  if (s.tracked && !line.length) ids.push(...(await deletedOnDefault($, repo)))
  return Math.max(0, ...line, ...ids.map(top))
}

// The header of an old file, everything above its first ID heading, numbered.
function headerOf(text: string): string[] {
  const first = ledHeadings(text)[0]?.line ?? Infinity
  return text.split('\n').slice(0, Math.min(first - 1, text.split('\n').length)).map((l, i) => `    ${i + 1}: ${l.replace(/\r$/, '')}`)
}

// The headings a copied file has that the tools will not read, since they read
// `ID: Title` only, and the changelog records with no recognized status.
function unread(name: string, text: string, role: Role): string[] {
  const read = new Set(parseHeadings(text).map(h => h.line))
  const missed = ledHeadings(text).filter(h => !read.has(h.line))
  const out = missed.length ? [`  ${name}: headings that start with an ID but are not written as \`ID: Title\`, so the tools do not read them: ${missed.map(h => `${list(h.ids)} line ${h.line}`).join('; ')}`] : []
  if (role === 'changelog') {
    const bare = parseHeadings(text).filter(h => !h.status)
    if (bare.length) out.push(`  ${name}: records with no recognized status, which open the gates of their IDs: ${bare.map(h => `${list(h.ids)} line ${h.line}`).join('; ')}`)
  }
  return out
}

// The session's items, with nothing above the first item heading.
function itemsOf(v: unknown): string {
  if (typeof v !== 'string') fail('backlog is not text')
  const text = (v as string).replace(/\r\n/g, '\n')
  const first = headings(text, scan(text).lines).find(h => h.level > 1)
  if (text.slice(0, first?.line.at ?? text.length).trim()) fail('backlog has text above its first item heading. Pass the items only, from the first `## ID: Title` on: the tool writes the title and the Highest ID used line')
  return text.trim()
}

const where = (s: Setup) => (s.tracked ? TRACKED : LOCAL)
const roleName = (s: Setup, role: Role) => where(s)[role]!

async function migrate($: any, e: any): Promise<string> {
  const go = e.run === true || e.backlog !== undefined || e.plan !== undefined
  const repo = await facts($)
  if (!repo) fail('not inside a git repository')
  if (repo!.kind !== 'needs-migration' && repo!.kind !== 'partial-migration') {
    fail(`there is no old roadmap to migrate: the kind is ${repo!.kind}${MIGRATION[repo!.kind] ? `. ${MIGRATION[repo!.kind]}` : ''}`)
  }
  return withLock($, repo!, async lock => {
    const out = await settleLocked($, repo!, lock)
    // A marker found with needs-migration is complete or stale, and a new migration replaces it.
    const m = repo!.kind === 'partial-migration' ? await markerOf($, repo!) : undefined
    const s = await setup($, repo!, m, e)
    const texts = await oldTexts($, s, m)
    const roadmap = s.old.find(n => ROLE[n] === 'backlog')
    const highest = await highestOf($, repo!, s, texts)
    const backup = m?.backup ?? `${repo!.main}/notes.local/backlog-migration/${dateOf(await $.clock.now())}`

    // Each destination: kept when an earlier call wrote it and it is unchanged,
    // else written, with any file there saved as <name>.found first.
    const dests = [...new Set(['backlog', ...s.old.map(n => ROLE[n]).filter(r => r !== 'backlog'), 'plan'] as Role[])]
    const state: Record<string, 'new' | 'kept' | 'found'> = {}
    for (const r of dests) {
      const name = roleName(s, r)
      const d = m?.dests[name]
      const now = await read($, `${s.root}/${name}`)
      state[r] = now === undefined ? (d?.none && d.started ? 'kept' : 'new') : d?.hash !== undefined && d.hash === (await hashOf($, repo!, now)) ? 'kept' : 'found'
    }
    const from = (r: Role) => r === 'backlog' ? 'the backlog text' : r === 'plan' ? 'the plan text' : `a copy of ${s.old.find(n => ROLE[n] === r)}`

    if (!go) {
      out.push(`migration: ${s.tracked ? 'tracked' : 'local-only'}, in ${s.root}`)
      out.push(m ? `marker: ${markerAt(repo!)}, from a migration that did not finish. This call continues it` : `marker: none yet${(await $.fs.exists(markerAt(repo!))) ? `. The old marker at ${markerAt(repo!)} will be replaced` : ''}`)
      out.push('preconditions:', ...s.checks.map(([ok, t]) => `  ${ok ? 'ok' : 'not met'}: ${t}`),
        '  not checked: no other session is working this repo on the old roadmap rule. Ask the user to stop any such session before the next call.')
      out.push('destinations:', ...dests.map(r => `  ${s.root}/${roleName(s, r)}: ${state[r] === 'kept' ? 'kept, written by an earlier call and unchanged' : `${from(r)}${state[r] === 'found' ? `. The file there now will be saved as ${roleName(s, r)}.found in ${backup}` : ''}`}`))
      out.push(`Highest ID used will be R${highest}.`, 'old files:')
      for (const name of s.old) {
        const lines = headerOf(texts[name])
        out.push(`  ${s.root}/${name}: IDs ${list(idsOf(texts[name]))}`, `  header, lines 1 to ${lines.length}:`, ...lines)
      }
      out.push(...s.old.flatMap(n => (ROLE[n] === 'backlog' ? [] : unread(roleName(s, ROLE[n]), texts[n], ROLE[n]))))
      out.push('Next, call migrate_backlog again with:',
        `- backlog, unless kept: the items of ${roadmap ?? 'the old roadmap (there is none, so pass "")'}, from the first item heading on, with nothing above it. Each item is \`## ID: Title\` and each sub-item \`### ID.n: Title\`, one heading for every ID listed for it above and no other ID. An item's field list is the first block under its heading, one \`- Key: value\` line each, with the keys Touches, Gated by, Needs, Branch, and Check. Prose follows, with headings of level 4 and deeper only. Drop section and band headings.`,
        '- plan, unless kept: the plan, from the headers above, without the rules already stated in this plugin; "" for no plan.',
        ...(s.tracked ? ['- branch and message: the branch the migration is committed on, and the commit message.'] : []),
        '- run: true, when every destination is kept.')
      return out.join('\n')
    }

    const unmet = s.checks.filter(([ok]) => !ok).map(([, t]) => `  ${t}`)
    if (unmet.length) fail(`nothing was written, since these preconditions are not met:\n${unmet.join('\n')}`)

    // The new text of each destination, checked in full before anything is written.
    const next: Partial<Record<Role, string>> = {}
    for (const r of dests) {
      if (state[r] === 'kept') {
        if ((r === 'backlog' && e.backlog !== undefined) || (r === 'plan' && e.plan !== undefined)) out.push(`${roleName(s, r)} is kept from an earlier call, so the ${r} text passed was not used`)
        continue
      }
      if (r === 'backlog') {
        if (e.backlog === undefined) fail(`nothing was written: pass backlog, since ${roleName(s, r)} is not written yet`)
        const items = itemsOf(e.backlog)
        const head = s.tracked ? `# Backlog\n\nHighest ID used: R${highest}\n` : `# Backlog (local only)\n\nNever commit or push this file. Highest ID used: R${highest}\n`
        next.backlog = items ? `${head}\n${items}\n` : head
      } else if (r === 'plan') {
        if (typeof e.plan !== 'string') fail(`nothing was written: pass plan, or "" for no plan, since ${roleName(s, r)} is not written yet`)
        if (e.plan.trim()) next.plan = `${e.plan.replace(/\r\n/g, '\n').trimEnd()}\n`
      } else next[r] = texts[s.old.find(n => ROLE[n] === r)!]
    }
    const textOf = async (r: Role) => next[r] ?? (await read($, `${s.root}/${roleName(s, r)}`))
    const files = filesOf({ backlog: (await textOf('backlog')) ?? '', parked: await textOf('parked'), declined: await textOf('declined'), changelog: s.tracked ? undefined : await textOf('changelog') })
    const was = new Set(roadmap ? idsOf(texts[roadmap]) : [])
    const now = new Set(files.backlog.items.map(i => i.id))
    const lost = [...was].filter(id => !now.has(id))
    const added = [...now].filter(id => !was.has(id))
    if (lost.length || added.length) {
      fail(`nothing ${m ? 'more ' : ''}was written, since the IDs in the new backlog differ from those in ${roadmap ?? 'the old roadmap'}:\n  missing from the new backlog: ${list(lost)}\n  not in the old roadmap: ${list(added)}`)
    }

    const lineOf = (p: Problem) => `  ${roleName(s, p.file ?? 'backlog')} line ${p.line} (${p.level} level): ${p.message}`
    const ps = problemsOf(files)
    const fileLevel = ps.filter(p => p.level === 'file')
    if (fileLevel.length) fail(`nothing ${m ? 'more ' : ''}was written, since the new files have file-level problems:\n${fileLevel.map(lineOf).join('\n')}`)

    // Step 1: the exclusions, each confirmed with git check-ignore.
    const exclude = `${repo!.common}/info/exclude`
    const lines = ['/notes.local', ...(s.tracked ? [] : ['/BACKLOG*.local.md', '/PLAN*.local.md'])]
    const had = (await read($, exclude)) ?? ''
    const missing = lines.filter(l => !had.split(/\r?\n/).includes(l))
    if (missing.length) {
      await put($, exclude, `${had && !had.endsWith('\n') ? `${had}\n` : had}${missing.join('\n')}\n`, 'so nothing else was written')
      out.push(`added ${missing.join(', ')} to ${exclude}`)
    }
    for (const p of ['notes.local', ...(s.tracked ? [] : Object.values(LOCAL) as string[])]) {
      const r = await run($, repo!.main, ['check-ignore', '-q', '--no-index', '--', p])
      if (r.exitCode === 1) fail(`git check-ignore does not show ${p} as ignored after ${exclude} was written, so nothing else was written`)
      if (r.exitCode !== 0) fail(`git check-ignore ${p} in ${repo!.main}: ${why(r)}`)
    }

    // Step 2: the marker, then on a local-only roadmap the backup of the old files.
    let marker: Marker
    if (m) marker = m
    else {
      let dir = backup
      for (let n = 2; await $.fs.exists(dir); n++) dir = `${backup}-${n}`
      marker = { complete: false, tracked: s.tracked, ...(s.branch ? { branch: s.branch } : {}), backup: dir, old: s.old, dests: {} }
    }
    if (!m && (await $.fs.exists(markerAt(repo!)))) out.push(`replaced the marker of an earlier migration at ${markerAt(repo!)}`)
    const save = () => put($, markerAt(repo!), JSON.stringify(marker, null, 2), 'so the migration stopped there')
    await save()
    out.push(`marker: ${markerAt(repo!)}`)
    if (!s.tracked) {
      for (const name of s.old) {
        const to = `${marker.backup}/${name}`
        const there = await read($, to)
        if (there === undefined) await put($, to, texts[name], 'so nothing else was written')
        else if (there !== texts[name]) fail(`${to} differs from ${s.root}/${name}, which changed after the backup. Compare the two before going on`)
      }
      out.push(`backup: ${marker.backup}`)
    }

    // Steps 3 and 5: each destination, recorded as started before its write and
    // with its hash after it.
    for (const r of dests) {
      const name = roleName(s, r)
      const path = `${s.root}/${name}`
      if (state[r] === 'kept') { out.push(`kept ${path}, written by an earlier call`); continue }
      if (state[r] === 'found') {
        let to = `${marker.backup}/${name}.found`
        for (let n = 2; await $.fs.exists(to); n++) to = `${marker.backup}/${name}.found.${n}`
        await put($, to, (await read($, path))!, 'so nothing else was written')
        out.push(`saved ${path} as ${to}, since an earlier call did not finish it or it was changed after`)
      }
      marker.dests[name] = { started: true }
      await save()
      if (next[r] === undefined) {
        marker.dests[name].none = true
        out.push(`no plan: ${name} was not written`)
      } else {
        await put($, path, next[r]!, 'so the migration stopped there. Call migrate_backlog again')
        marker.dests[name].hash = await hashOf($, repo!, next[r]!)
        out.push(`wrote ${path}`)
      }
      await save()
    }
    const other = ps.filter(p => p.level !== 'file')
    if (other.length) out.push('problems in the new backlog files, to fix with the write tools:', ...other.map(lineOf))
    out.push(...s.old.flatMap(n => (ROLE[n] === 'backlog' ? [] : unread(roleName(s, ROLE[n]), texts[n], ROLE[n]))))

    // Step 6: delete the old files, commit on a tracked roadmap, and mark the migration complete.
    const written = Object.keys(marker.dests).filter(n => !marker.dests[n].none)
    if (s.tracked) {
      await must($, s.root, ['add', '--', ...written])
      await must($, s.root, ['rm', '-q', '--ignore-unmatch', '--', ...s.old])
      const staged = await run($, s.root, ['diff', '--cached', '--quiet', '--', ...written, ...s.old])
      if (staged.exitCode === 1) await must($, s.root, ['commit', '-q', '-m', e.message, '--', ...written, ...s.old])
      else if (staged.exitCode !== 0) fail(`git diff --cached in ${s.root}: ${why(staged)}`)
      const inHead = async (p: string) => (await run($, s.root, ['cat-file', '-e', `HEAD:${p}`])).exitCode === 0
      const left: string[] = []
      for (const p of s.old) if (await inHead(p)) left.push(p)
      if (!(await inHead(roleName(s, 'backlog')))) fail(`HEAD of ${s.branch} has no ${roleName(s, 'backlog')}, so the migration is not complete`)
      if (left.length) fail(`HEAD of ${s.branch} still has ${list(left)}, so the migration is not complete`)
      out.push(`committed ${(await git($, s.root, 'rev-parse', 'HEAD')).trim()} on ${s.branch}`)
    } else {
      for (const name of s.old) {
        const path = `${s.root}/${name}`
        if (!(await $.fs.exists(path))) continue
        // git clean deletes only an untracked file, and -x includes the excluded ones.
        const r = await run($, s.root, ['clean', '-f', '-x', '-q', '--', `:(top,literal)${name}`])
        if (r.exitCode !== 0 || (await $.fs.exists(path))) fail(`${path} was not deleted${r.exitCode ? `: ${why(r)}` : ''}. Its copy is in ${marker.backup}; delete it by hand, then call migrate_backlog again`)
        out.push(`deleted ${path}`)
      }
    }
    marker.complete = true
    await save()
    out.push(s.tracked
      ? `The migration is complete. find_backlog returns migration-pending until ${s.branch} lands: land it through land-and-wrap.`
      : `The migration is complete. The old files are kept in ${marker.backup} until the user deletes them.`)
    return out.join('\n')
  })
}

export function migrateTools(on: any) {
  on('tool.call', { tool: 'mcp__backlog-skills__migrate_backlog' }, async ($: any, e: any) => answer('migrate_backlog', () => migrate($, e)))
}
