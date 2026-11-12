// Publication gate: check the human-facing text in a git commit, a gh command, a
// call to an MCP tool that can publish, a prose file just written, or a draft in a
// `draft` fence in the reply, against the four prohibitions, before a reader sees
// it.
//
// The check is one `$.model.complete` call with gate-prompt.md as the system
// prompt, rules.md appended to it so that the rules are written down once, and
// the text under review as the message. The model comes from
// WRITING_CONVENTIONS_GATE_MODEL, or the `sonnet` alias when that is unset. An
// alias is resolved the way `--model` resolves one, on a first-party install and
// on a proxy in front of Bedrock or Vertex alike.
//
// A commit must not be stopped because no model could be called, so every
// failure lets the event through, and the user is told once. Only a finding with its
// quote in the text under review blocks a command, a call, or a reply.
import type { Register } from 'claude-code'
import type { Call } from './hold'
import { bodyFiles, keys, type Mode, walk } from './keys'
import { lint } from './lint'
import { headings, linked, literal, repoFlag, unheaded, unquoted } from './template'
import { bytes, drafts, excerpt, findings, verdict as word } from './text'

// The first CLI where hooks modules are on by default, and the oldest one the
// module was checked on, by the live checks in the README. On an older one the
// module does nothing, and the user is told once.
const CHECKED = [2, 1, 286]

let warned = false

// Whether CLI version `base` is the oldest checked one or later. dash.ts calls this
// with a version read through its $.
export function atLeast(base: unknown): boolean {
  const v = String(base).split('.').map(Number)
  for (let i = 0; i < 3; i++) if (v[i] !== CHECKED[i]) return v[i] > CHECKED[i]
  return true
}

async function isChecked($: any): Promise<boolean> {
  const ok = atLeast((await $.session.version()).base)
  if (!ok && !warned) {
    warned = true
    $.ui.toast(`The gate and the reply lint are off. They need Claude Code ${CHECKED.join('.')} or later.`, { timeoutMs: 15000 })
  }
  return ok
}

// What a check found: `block` for a finding, `context` for a note to the model,
// or neither.
type Verdict = { block?: string; context?: string }

const CAP = 50000
const ADVICE = 'Each rewrite after -> is only a suggestion; where one reads stiffly, write the sentence the way a person would say it.'

// Commands in four families are always reviewed, whatever is cached, even after
// a wrong NEVER from the classifier. Matching the command text
// covers `git -C <path> commit`, which no `Bash(git commit *)` rule matches.
const FAMILIES = /git commit|git -C[\s\S]*commit|gh pr |gh issue |gh release /

// An issue command, alone: template headings are removed from its body, and
// from no other command's. A `cat` that reads a heredoc into the body is the
// one other command allowed beside it. keys() reads two equal commands as one,
// so a second `gh issue` is counted here.
const ISSUE = /^\s*(?:\w+=\S*\s+)*gh issue (?:create|new|edit)\b/
function alone(cmd: string, mode: Mode): boolean {
  const text = literal(cmd)
  return ISSUE.test(cmd) && unquoted(text).match(/gh issue /g)?.length === 1 && keys(text, mode).every(l => /^(0\tPROSE|1\t(?!READ$).*|\d+\tcat)$/.test(l))
}

// A model call that failed, or a reply that could not be used. The message is
// the reason, as the user is shown it.
class Off extends Error {}

function why(reply: any): string {
  if (reply.reason === 'api-error') return `API error ${reply.error}${reply.status ? `, HTTP ${reply.status}` : ''}`
  if (reply.reason === 'aborted') return `the call was cut off, or had no reply within ${TIMEOUT / 1000} seconds`
  return 'the reply had no text'
}

const TIMEOUT = 60000

async function ask($: any, system: string[], prompt: string): Promise<string> {
  const parts: string[] = []
  for (const f of system) parts.push(await $.fs.read(`${$.plugin.root}/hooks/${f}`))
  const reply = await $.model.complete({
    model: (await $.env.get('WRITING_CONVENTIONS_GATE_MODEL')) || 'sonnet',
    system: [{ text: parts.join(''), cache: true }],
    prompt,
    // An unset effort resolves to high today. It is set here so that the level depends neither on
    // the session's effort nor on a default that could change (docs/DESIGN.md).
    effort: 'high',
    timeoutMs: TIMEOUT,
  })
  if (!reply.isAnswered) throw new Off(why(reply))
  return reply.text
}

// The user is told the first time in a session that a check could not run,
// through a toast, which the user is shown and the model is not. The host
// prints the plugin's name before a toast. The reason is in the toast because
// the debug log is written only in a session started with --debug.
let told = false

function off($: any, e: unknown): Verdict {
  if (!told) {
    told = true
    const reason = (e instanceof Error ? e.message : String(e)).slice(0, 200)
    $.ui.toast(`A model review did not run: ${reason}. That commit, PR, MCP, file, or draft text was not read. Each later check is still tried, but a later failure is not reported. The reply lint still runs.`, { timeoutMs: 15000 })
  }
  return {}
}

// The classifiers' answers are kept per user, outside the plugin's directory,
// which is per version. A file is named for a hash of the classifier's prompt,
// so a changed prompt starts a new file. The user can read and edit it.
function hash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(16)
}

async function cachePath($: any, name: string, prompt: string): Promise<string> {
  const config = (await $.env.get('CLAUDE_CONFIG_DIR')) || `${(await $.env.get('HOME')) || (await $.env.get('USERPROFILE'))}/.claude`
  return `${config}/writing-conventions/${name}-${hash(await $.fs.read(`${$.plugin.root}/hooks/${prompt}`))}.txt`
}

// A cache the user saved from an editor may have CRLF line ends.
const lines = (text: string) => text.split(/\r?\n/).filter(l => l !== '')

async function cached($: any, path: string): Promise<string[]> {
  return lines(await $.fs.read(path).catch(() => ''))
}

// ponytail: read, then write the whole file, one append at a time in this
// session. Another session's append in between is lost, and its key is asked
// about again.
let writing: Promise<void> = Promise.resolve()

function keep($: any, path: string, answers: string[]): Promise<void> {
  writing = writing.then(async () => {
    const old = await $.fs.read(path).catch(() => '')
    await $.fs.write(path, `${old}${answers.join('\n')}\n`)
  }).catch(() => {})
  return writing
}

// publishes($, cmd, mode, proj): whether a command outside the four families
// is reviewed. keys() splits it into keys, and walk() looks them up in
// the cache, one line per answer, <scope><TAB><class><TAB><key>, where a key
// below a task runner or under a path is kept per project. One call answers
// every key the cache has no line for, and a key it leaves out, or answers in
// any other form, is doubt: it reads as CAN_PUBLISH and is not kept.
async function publishes($: any, cmd: string, mode: 'bash' | 'pwsh', proj: string): Promise<boolean> {
  // walk() reads no keys as a safe command, so a command that could not be
  // split is reviewed.
  let keyLines: string[]
  try {
    keyLines = keys(cmd, mode)
  } catch {
    return true
  }
  const path = await cachePath($, 'shell-commands', 'classify-command.md')
  const known = await cached($, path)
  const first = walk(keyLines, known, proj)
  if (first[0] !== 'ASK') return first[0] === 'READER'
  const want = new Map<string, string[]>()
  for (const line of first.slice(1)) {
    const [, scope, key] = line.split('\t')
    want.set(key, [...(want.get(key) ?? []), scope])
  }
  const reply = await ask($, ['classify-command.md'], `${cmd}\n\n${[...want.keys()].join('\n')}`)
  const answers: string[] = []
  for (const line of reply.split('\n')) {
    const m = /[ \t]+(NEVER|CAN_PUBLISH|DESCEND|PROJECT|RUNS_CODE)\r?$/.exec(line)
    const key = m ? line.slice(0, m.index) : ''
    for (const scope of (m && want.get(key)) || []) answers.push(`${scope}\t${m![1]}\t${key}`)
    want.delete(key)
  }
  if (answers.length > 0) await keep($, path, answers)
  return walk(keyLines, [...known, ...answers], proj, true)[0] !== 'SAFE'
}

type Bodies = { read: { name: string; text: string }[]; unread: string[] }

// bodies($, cmd, mode, base, proj): the files the command passes a commit, PR,
// issue, or release body in, and a line for each one that is not read.
// bodyFiles() finds the files, from the flags written down there, and the review
// model never chooses one. A file is read only when the text on disk is the text the
// command will publish, as far as can be told: a literal path that is in no
// other word of the command, since a command that writes the file first
// publishes other text; relative to the directory the command starts in, with
// no cd and no git -C; a readable regular file, not a link, in the project or a
// temporary directory; and at most 1 MB with no NUL in its first 8 KB. Up to 4
// files are read, with CAP characters in all.
async function bodies($: any, cmd: string, mode: 'bash' | 'pwsh', base: string, proj: string): Promise<Bodies> {
  const out: Bodies = { read: [], unread: [] }
  // A Windows path uses "\" as the separator; the checks below all read "/", so
  // every path is normalized in pwsh mode, and the realPath returned by stat is
  // normalized too. In bash mode they are normalized only where the session's
  // directory starts with a drive letter, which is Git Bash on Windows: anywhere
  // else "\" may be a character in a POSIX filename.
  const win = mode === 'bash' && /^[A-Za-z]:[\\/]/.test(base)
  const toSlash = (p: string) => (mode === 'pwsh' || win ? p.replace(/\\/g, '/') : p)
  const real = async (p: string | undefined) => {
    if (!p) return undefined
    const rp = (await $.fs.stat(p, { resolve: true }).catch(() => undefined))?.realPath
    return rp ? toSlash(rp) : undefined
  }
  const baseN = toSlash(base)
  // Git Bash on Windows reads "/tmp/x" as a file in the temporary directory and
  // "/c/x" as "C:/x", and the engine opens neither as written.
  const tmpN = toSlash(await tmp($))
  const mapped = (p: string) => (!win ? p : p.startsWith('/tmp/') ? `${tmpN}/${p.slice(5)}` : p.replace(/^\/([A-Za-z])\//, '$1:/'))
  let total = 0
  for (const line of bodyFiles(cmd, mode)) {
    const tab = line.indexOf('\t')
    const moved = line.slice(0, tab) === '1'
    const op = line.slice(tab + 1)
    const opN = toSlash(op)
    let why = ''
    let text = ''
    const absolute = /^(\/|[A-Za-z]:\/)/.test(opN)
    const path = absolute ? mapped(opN) : `${baseN}/${opN}`
    if (opN === '' || /[^A-Za-z0-9._/+@,:=-]/.test(opN)) why = 'it is not a literal path'
    else if (!absolute && moved) why = 'the command may change directory first'
    else if (cmd.split(opN.slice(opN.lastIndexOf('/') + 1)).length > 2) why = 'the command names it more than once, so it may write the file before reading it'
    else {
      const stat = await $.fs.stat(path, { resolve: true }).catch(() => undefined)
      if (!stat || stat.isLink || stat.kind !== 'file' || !stat.realPath) why = 'it is not a regular file'
      else {
        const realPath = toSlash(stat.realPath)
        const roots = [await real(proj), await real(await tmp($)), await real('/tmp')]
        const dir = realPath.slice(0, realPath.lastIndexOf('/') + 1)
        if (!roots.some(r => r && dir.startsWith(`${r.replace(/\/$/, '')}/`))) why = 'it is outside the project and the temporary directory'
        else if (stat.size > 1048576) why = 'it is over 1 MB'
        else {
          const got = await $.fs.read(path).catch(() => undefined)
          if (got === undefined) why = 'it cannot be read'
          else if (got.slice(0, 8192).includes('\0')) why = 'it is not text'
          else if (out.read.length >= 4 || total + got.length > CAP) why = `the gate reads at most 4 body files and ${CAP} characters`
          else text = got
        }
      }
    }
    if (why) out.unread.push(`The body in ${op} was not read: ${why}.`)
    else {
      total += text.length
      out.read.push({ name: op, text })
    }
  }
  return out
}

// read($, prompt, sources): the review model's verdict on `prompt`, and the
// findings in it that quote one of `sources`. The model can see text quoted from an
// untrusted source, so no finding is acted on until its quote is found in the
// text under review.
async function read($: any, prompt: string, sources: string[]): Promise<{ found: string; local: boolean }> {
  const verdict = await ask($, ['gate-prompt.md', 'rules.md'], prompt)
  return { found: findings(verdict, sources).replace(/\n+$/, ''), local: word(verdict) === 'LOCAL' }
}

const join = (...parts: string[]) => parts.filter(p => p !== '').join('\n')

// A shell command, checked before it runs. `input` is what the review model is sent.
async function shell($: any, input: any): Promise<Verdict> {
  const cmd = String(input.tool_input.command ?? '')
  const mode = input.tool_name === 'PowerShell' ? 'pwsh' : 'bash'
  const proj = (await $.session.root()) || input.cwd || '/'
  let toFile = false
  if (!FAMILIES.test(cmd)) {
    if ((await $.env.get('WRITING_CONVENTIONS_SHELL_CLASSIFIER')) === '0') return {}
    if (!(await publishes($, cmd, mode, proj))) return {}
    toFile = true
  }
  const { read: files, unread } = await bodies($, cmd, mode, input.cwd, proj)
  // The headings of the repo's issue template are allowed in an issue.
  const repo = repoFlag(cmd)
  const kept = alone(cmd, mode) ? await headings($, input.cwd, [cmd, ...files.map(f => f.text)], repo ? [repo] : [], repo === undefined) : new Set<string>()
  const shown = { ...input, tool_input: { ...input.tool_input, command: unheaded(cmd, kept) } }
  const prompt = JSON.stringify(shown) + files.map(f => `\n\nFile: ${f.name}\n\n${unheaded(f.text, kept)}`).join('')
  const { found, local } = await read($, prompt, [cmd, ...files.map(f => f.text)])
  const notRead = unread.join('\n')
  if (found === '') return notRead ? { context: notRead } : {}
  // The review model answers LOCAL when the text only goes into a file on this
  // machine, such as a script that rewrites a local file. That is the file
  // check's case, so the findings come back and nothing is blocked. In the four
  // families a finding always blocks.
  if (toFile && local) return { context: join(found, `Fix the quoted text in the file after the command runs. ${ADVICE}`, notRead) }
  return { block: join(found, `Rewrite the quoted text and run the command again. ${ADVICE}`, notRead) }
}

// strings(value): every string value at any depth, and no key.
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  return value && typeof value === 'object' ? Object.values(value).flatMap(strings) : []
}

// A call to an MCP tool. Whether the tool can publish is asked of a model once
// per tool and kept, one line per answer, so no server or tool name is written
// here but the ones in LOCAL_TOOLS. For one tool a CAN_PUBLISH line wins over a
// NEVER line, and a line in any other form is ignored.
async function mcp($: any, input: any): Promise<Verdict> {
  const path = await cachePath($, 'mcp-tools', 'classify-prompt.md')
  const mine = (await cached($, path)).map(l => l.split(/[ \t]+/).filter(w => w !== '')).filter(w => w.length === 2 && w[0] === input.tool_name)
  let cls = mine.some(w => w[1] === 'CAN_PUBLISH') ? 'CAN_PUBLISH' : mine.some(w => w[1] === 'NEVER') ? 'NEVER' : ''
  if (cls === '') {
    const reply = await ask($, ['classify-prompt.md'], JSON.stringify(input))
    // The first line that is not blank. A line with only a carriage return
    // counts, so the answer after it is doubt.
    cls = (reply.split('\n').find(l => /[^ \t]/.test(l)) ?? '').replace(/\r$/, '')
    // A reply in any other form is doubt, which reads as CAN_PUBLISH and is not kept.
    if (cls === 'NEVER' || cls === 'CAN_PUBLISH') await keep($, path, [`${input.tool_name} ${cls}`])
    else cls = 'CAN_PUBLISH'
  }
  if (cls !== 'CAN_PUBLISH') return {}
  // The review model is sent the whole input, structure included, and a finding
  // has to quote one of the string values in tool_input. Each value is a source of
  // its own, so no quote can match across two of them.
  const { found } = await read($, JSON.stringify(input), strings(input.tool_input))
  return found === '' ? {} : { block: join(found, `Rewrite the quoted text and make the call again. ${ADVICE}`) }
}

// A prose file just written. Only the text the tool wrote is read, and the
// review model is sent the text under review, not the tool call, which for a Write
// includes the whole file. A file is cheap to fix after the fact and a blocked edit
// stops the turn, so the findings come back as context and nothing is blocked.
async function file($: any, e: any): Promise<Verdict> {
  const path = String(e.tool_input?.file_path ?? '')
  if (!/\.(md|markdown|txt|adoc|rst)$/i.test(path)) return {}
  let text = String(e.tool_input.content ?? '')
  let unread = ''
  if (e.tool_name === 'Edit') {
    const fresh = String(e.tool_input.new_string ?? '')
    if (!/\S/.test(fresh)) return { context: `Not reviewed: this edit to ${path} only deleted text.` }
    // The text the Edit wrote where the caller has it, or else the file on disk.
    let whole: string | undefined = e.whole
    if (whole === undefined) {
      const stat = await $.fs.stat(path).catch(() => undefined)
      whole = stat?.kind === 'file' && stat.size <= 1048576 ? await $.fs.read(path).catch(() => undefined) : undefined
    } else if (bytes(whole) > 1048576) whole = undefined
    if (whole === undefined) {
      text = fresh
      unread = `Only the new text was reviewed, not the sentences around it: ${path} is over 1 MB or could not be read.`
    } else text = excerpt(fresh, whole, CAP) || fresh
  }
  if (text.length > CAP) {
    text = text.slice(0, CAP)
    unread = `Only the first ${CAP} characters of the text were reviewed.`
  }
  // A file may be the draft of an issue, to a repo it links or to the session's.
  const kept = await headings($, await $.session.cwd(), [text], linked(text), true)
  const { found } = await read($, `File: ${path}\n\n${unheaded(text, kept)}`, [text])
  return { context: join(found && `${found}\nFix the quoted text in ${path}. ${ADVICE}`, unread) }
}

// Tools of this marketplace's plugins that write a file on this machine and
// send text nowhere else. The tool classifier answered CAN_PUBLISH for each in
// every live run (README, "MCP calls"), and a blocked edit stops the turn. Such
// a call is read as the file check reads an Edit, after it runs, and nothing is
// blocked. The two fields are the file's path and the new text. A tool with
// none writes no prose: a claim is JSON.
const LOCAL_TOOLS: Record<string, [string, string] | null> = {
  'mcp__session-skills__edit_primary_file': ['path', 'new'],
  'mcp__parallel-session-skills__write_claim': null,
}

// The rewrites asked for in this turn. Each one costs a whole re-emitted reply,
// so they stop after two when something is found in each rewrite.
let fixups = { turn: '', count: 0, from: '' }

// The drafts the review model passed when the lint tool was called on them, by
// their text, so that the check at the end of the turn sends only the others.
// ponytail: kept in memory, so after a hot reload a draft is reviewed again.
const passed = new Set<string>()
const keyOf = (draft: string) => draft.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '')

// review($, text, from): the verified findings on `text`, drafts that each end
// on a line with only \x01. Each one stays a source of its own, so no finding
// can quote across two of them. A draft may be an issue, to a repo linked in
// `from` or to the session's. Its destination is not known, so these headings
// are removed from a pull request draft too, and they are flagged at the gh pr
// gate instead.
async function review($: any, text: string, from: string): Promise<string> {
  const kept = await headings($, await $.session.cwd(), [text], linked(from), true)
  return (await read($, unheaded(text, kept).replace(/\x01/g, '\n'), text.split('\x01'))).found
}

async function readerOff($: any): Promise<boolean> {
  return (await $.env.get('WRITING_CONVENTIONS_STOP_READER')) === '0'
}

// The lint tool's answer: the reply lint's lines, then the review model's
// findings on the drafts in `input`, or on all of it where no draft fence is
// in it. A draft with no finding is kept as passed.
async function lintTool($: any, input: string): Promise<string> {
  const flagged = lint(drafts(input, { unwrap: true })).replace(/\n+$/, '')
  const verdict = await gate($, async () => {
    const text = (drafts(input) || `${input}\x01\n`).slice(0, CAP)
    if ((await readerOff($)) || !/[^ \t\r\n\x01]/.test(text)) return {}
    const found = await review($, text, input)
    if (found === '') for (const d of text.split('\x01')) passed.add(keyOf(d))
    return { context: found && join(found, `Rewrite the quoted text, then call this tool again on the new draft. ${ADVICE}`) }
  })
  return join(flagged, verdict.context ?? '') || 'clean'
}

// A reply in which a draft for publication is tagged. Only the text inside a
// `draft` fence is reviewed, so nothing else in the reply is judged by the
// model, and a reply with no such fence, or only drafts the lint tool passed,
// costs no call. An untagged draft is read by the reply lint alone.
async function stop($: any, turnId: string, answer: string): Promise<Verdict> {
  if (await readerOff($)) return {}
  // The cap comes off before the review model is sent the drafts, so a quote
  // from past it is never verified.
  const text = drafts(answer).split('\x01\n').filter(d => d !== '' && !passed.has(keyOf(d))).map(d => `${d}\x01\n`).join('').slice(0, CAP)
  if (text === '') return {}
  if (fixups.turn !== turnId) fixups = { turn: turnId, count: 0, from: '' }
  // A rewrite starts at its draft, so a repo linked before the draft is read from
  // the reply it replaced.
  const from = fixups.from + answer
  const found = await review($, text, from)
  if (found === '') return {}
  fixups.from = from
  if (fixups.count >= 2) {
    $.ui.toast('The draft in this reply still reads as a violation after two rewrites. Review is unresolved and the reply stands.', { timeoutMs: 15000 })
    return {}
  }
  fixups.count++
  return { block: join(found, `This is the check that runs when a reply ends. Your reply was shown up to its first draft. The draft and the text after it were held, so write them now, with each quoted sentence rewritten. ${ADVICE}`) }
}

// Set once the lint tool is listed: a reply cannot be replaced with a call to a
// tool that is not there, so a draft is then shown as written.
let listed = false
export async function checksDrafts($: any): Promise<boolean> {
  return listed && (await isChecked($).catch(() => false)) && !(await readerOff($))
}

// What a held reply is replaced with, if anything: a call to the lint tool, with
// the findings kept for that call to return, so the draft is not reviewed twice.
const awaiting = new Map<string, string>()
let calls = 0
export async function flagged($: any, turnId: string, answer: string): Promise<Call | undefined> {
  const verdict = await gate($, () => stop($, turnId, answer))
  if (!verdict.block) return undefined
  const id = `toolu_writing_conventions_${Date.now()}_${++calls}`
  awaiting.set(id, verdict.block)
  return { tool: TOOL, id }
}

// Runs one check. A check that throws does not stop the event.
async function gate($: any, check: () => Promise<Verdict>): Promise<Verdict> {
  try {
    return (await isChecked($)) ? await check() : {}
  } catch (e) {
    return off($, e)
  }
}

// The reply lint and the reminders around it. None of them asks for a rewrite,
// since that costs a full re-emission of an answer the user has already seen.
// The correction is made in the next reply instead.
const REMINDER = 'Style, for this reply and any prose written to files: an inanimate subject takes no agentive verb—"the entry declared in the `plugins` block", never "the `plugins` block owns/says/gives". Em dashes unspaced (word—word). Plain words.'
const NUDGE = "You just wrote prose to a file. Re-read it now for inanimate agency (report/build/entry/declaration as subject of says/gives/owns/configures/carries), spaced em dashes, and banned vocabulary; fix in place before moving on. If this text will publish under the user's name, have a fresh-context subagent sweep it against the rules before hand-over."

// The lint tool, for a skill that has a draft to check before the reply.
const TOOL = 'mcp__writing-conventions__lint'

// Where the note on a session's last reply is kept until the next prompt: a
// file named for the session, so that it is still read in a resumed session.
// With no session id there is no safe place, since one session's note in a
// shared file would be read by another.
// The temporary directory: TMPDIR, or TEMP or TMP as Windows has them.
async function tmp($: any): Promise<string> {
  return (await $.env.get('TMPDIR')) || (await $.env.get('TEMP')) || (await $.env.get('TMP')) || '/tmp'
}

async function notePath($: any, session: unknown): Promise<string> {
  const id = String(session ?? '').replace(/[^A-Za-z0-9_-]/g, '_')
  return id && `${await tmp($)}/claude-reply-lint-${id}.txt`
}

// Whether the model still reads this text: false after /clear, a compaction,
// or a plugin update that changed it, and undefined where the conversation is
// not read back, as a Workflow agent's is not on 2.1.310. Context added to a
// tool call is in its result.
async function isRead($: any, text: string, agentId?: string): Promise<boolean | undefined> {
  const messages = await $.session.messages({ ...(agentId && { agentId }), as: 'api' }).catch(() => undefined)
  if (!Array.isArray(messages)) return undefined
  const has = (b: any): boolean => b.type === 'text' ? String(b.text).includes(text)
    : b.type === 'tool_result' && (typeof b.content === 'string' ? b.content.includes(text) : Array.isArray(b.content) && b.content.some(has))
  return messages.some(m => m.role === 'user' && Array.isArray(m.content) && m.content.some(has))
}

// The first message of a conversation, which a compaction or /clear replaces,
// and '' where the conversation is not read back.
async function head($: any, agentId?: string): Promise<string> {
  const messages = await $.session.messages({ ...(agentId && { agentId }), as: 'api' }).catch(() => undefined)
  return Array.isArray(messages) ? JSON.stringify(messages[0] ?? null) : ''
}

// The context added after a Write or Edit: for a file with prose in it, code
// comments included, the re-read request, and the gate's findings on a prose
// file beside it.
async function wrote($: any, e: any): Promise<string[]> {
  const verdict = await gate($, () => file($, e))
  const isProse = /\.(md|markdown|txt|kt|kts|java|groovy)$/i.test(String(e.tool_input?.file_path ?? ''))
  return [...(isProse && (await isChecked($).catch(() => false)) ? [NUDGE] : []), ...(verdict.context ? [verdict.context] : [])]
}

// The file as the Edit in this result wrote it. A classic.PostToolUse hook
// beneath, such as a formatter, may have changed it on disk since. The Edit
// tool may write newString changed, with an escape decoded, so the text is
// used only where it has every line the patch added.
function edited(done: any): string | undefined {
  const { originalFile: was, oldString: old, newString: fresh, structuredPatch: patch } = done
  if (typeof was !== 'string' || typeof old !== 'string' || typeof fresh !== 'string' || old === '' || !was.includes(old) || !Array.isArray(patch)) return undefined
  const text = done.replaceAll ? was.split(old).join(fresh) : was.replace(old, () => fresh)
  const lines = new Set(text.split('\n'))
  const added = patch.flatMap((h: any) => h.lines ?? []).filter((l: string) => l.startsWith('+')).map((l: string) => l.slice(1))
  return added.every((l: string) => lines.has(l)) ? text : undefined
}

// The next turn opens with the saved note, then the standing reminder.
async function turnNote($: any, session: unknown): Promise<string> {
  const path = await notePath($, session).catch(() => '')
  const note = path ? await $.fs.read(path).catch(() => '') : ''
  if (note) await $.fs.write(path, '').catch(() => {})
  return note + REMINDER
}

// The lint tool is answered here. A file written with Write or Edit is
// checked after it is written, and any other command or MCP call before it
// runs.
async function call($: any, e: any, next: any): Promise<any> {
  // A draft may come inside its fence, and lint() drops every closed fence.
  if (e.tool === TOOL) {
    const found = awaiting.get((e as any).tool_use_id)
    awaiting.delete((e as any).tool_use_id)
    return { result: found ?? await lintTool($, String((e as any).text ?? '')) }
  }
  if (e.tool === 'Write' || e.tool === 'Edit') {
    const ran = await next(e)
    // What was written is in the result, after any hook beneath rewrote the
    // call. A denied or failed call has no filePath, and a staged write is a
    // settings file held for review.
    const done = (ran as any).result ?? {}
    if (done.staged || typeof done.filePath !== 'string') return ran
    const added = await wrote($, { tool_name: e.tool, tool_input: { file_path: done.filePath, content: done.content, new_string: done.newString }, whole: edited(done) })
    return added.length > 0 ? { ...ran, context: [...(ran.context ?? []), ...added] } : ran
  }
  if (!/^(Bash$|PowerShell$|mcp__)/.test(e.tool)) return next(e)
  if (e.tool in LOCAL_TOOLS) {
    const ran = await next(e)
    const fields = LOCAL_TOOLS[e.tool]
    if (!fields || ran.deny !== undefined || (ran as any).isError) return ran
    const [path, fresh] = fields.map(f => (e as any)[f])
    const found = await gate($, () => file($, { tool_name: 'Edit', tool_input: { file_path: path, new_string: fresh } }))
    return found.context ? { ...ran, context: [...(ran.context ?? []), found.context] } : ran
  }
  const { tool, tool_use_id, agentId, ...tool_input } = e as any
  const verdict = await gate($, async () => {
    const input = { session_id: await $.session.id(), cwd: await $.session.cwd(), tool_name: tool, tool_input, tool_use_id }
    return tool.startsWith('mcp__') ? mcp($, input) : shell($, input)
  })
  if (verdict.block) return { deny: verdict.block }
  const ran = await next(e)
  return verdict.context && ran.deny === undefined
    ? { ...ran, context: [...(ran.context ?? []), verdict.context] }
    : ran
}

// A Workflow's agents start without the rules, and after an automatic
// compaction in the middle of a turn the main loop goes without them
// until the next prompt. They are added to the next tool result, and not again
// until the model reads them back, or the conversation they were added to is
// compacted again: calls that run in parallel all start before any result is
// read back, and a Workflow agent's conversation is never read back.
// ponytail: kept in memory, so after a hot reload a running Workflow agent gets the rules a second time.
const added = new Map<string, string>()
async function restore($: any, e: any, ran: any): Promise<any> {
  if (ran.deny !== undefined) return ran
  const key = e.agentId ?? (await $.session.id().catch(() => ''))
  const wanted = e.agentId ? await isChecked($).catch(() => false) : true
  const rules = wanted ? await $.fs.read(`${$.plugin.root}/hooks/rules.md`).catch(() => '') : ''
  if (!rules) return ran
  const read = await isRead($, rules, e.agentId)
  if (read) added.delete(key)
  if (read || (read === undefined && !e.agentId)) return ran
  const at = await head($, e.agentId)
  if (added.get(key) === at) return ran
  added.set(key, at)
  return { ...ran, context: [...(ran.context ?? []), rules] }
}

export const register: Register = on => {
  on('tool.call', async ($, e, next) => restore($, e, await call($, e, next)))

  // The rules go into a subagent's task at spawn: auto mode refuses an Agent
  // call if a tool.call hook changed its input after review. A Workflow agent
  // gets them with its first tool result, and a resumed run keeps its prompt.
  on('agent.spawn', async ($, e: any, next: any) => {
    if (e.workflow || e.resume) return next(e)
    const rules = (await isChecked($).catch(() => false)) ? await $.fs.read(`${$.plugin.root}/hooks/rules.md`).catch(() => '') : ''
    return next(rules && !e.prompt.includes(rules) ? { ...e, prompt: `${rules}\n\n${e.prompt}` } : e)
  })

  on('session.start', async ($, e, next) => {
    if (await isChecked($)) {
      listed = await $.tool.register({
        name: 'lint',
        description: 'Lint prose against the writing-conventions patterns (inanimate agency, spaced em dashes, banned words, a missing Oxford comma, and a bold list label), then have a review model read it against the writing conventions. Returns one line per flagged sentence, <group><TAB><matched text>, then each finding of the review model as "quote" -> rewrite, or "clean". Call it on each draft for publication before the reply ends.',
        inputSchema: { type: 'object', properties: { text: { type: 'string', description: 'The prose to lint.' } }, required: ['text'] },
      }).then(() => true, () => false)
    }
    return next(e)
  })

  // The final reply is linted and the note saved. lint() drops every closed
  // fence, so the fence lines of a draft block come off first and its text stays
  // in place: a draft is prose, and this is the one check left on it when the
  // review model cannot run. An interrupted turn and a subagent's turn are not
  // checked.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId || e.reason !== 'answer') return next(e)
    if (await isChecked($).catch(() => false)) {
      const note = lint(drafts(String(e.answer ?? ''), { unwrap: true }), { note: true })
      const path = await notePath($, await $.session.id().catch(() => '')).catch(() => '')
      // After a clean reply the note from the one before it is cleared.
      if (path && (note || (await $.fs.exists(path).catch(() => false)))) await $.fs.write(path, note).catch(() => {})
    }
    return next(e)
  })

  // The note and the reminder go with every prompt, and the rules come first
  // on the first prompt and once the model no longer reads them.
  on('prompt.submit', async ($, e: any, next: any) => {
    const rules = await $.fs.read(`${$.plugin.root}/hooks/rules.md`).catch(() => '')
    const added = rules && !(await isRead($, rules)) ? [rules] : []
    if (await isChecked($).catch(() => false)) added.push(await turnNote($, await $.session.id().catch(() => '')))
    return next(added.length > 0 ? { ...e, context: [...(e.context ?? []), ...added] } : e)
  })
}
