// The voice data, added beside the `ghostwrite` skill's text as the skill loads,
// so the spec, the samples, and the always-on rules are in front of the model
// whole. Left to the model, the reads were a locate snippet and three or more
// file reads, any of which could be skipped or cut short. The voice directory
// alone is added for `share-ghostwriting-spec`, which reads the spec itself.
import type { Register } from 'claude-code'

// ponytail: every sample is appended up to this many characters of corpus, and
// past it only the file names are, for the model to pick by genre. Pick by genre
// here if a corpus that large turns up.
const CORPUS_CAP = 64000

function file(path: string, text: string): string {
  return `<file path="${path}">\n${text}\n</file>\n`
}

// Whether version `a` is later than `b`, part by part as numbers.
function later(a: number[], b: number[]): boolean {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  }
  return false
}

// The newest installed copy of the writing-skills rules, or none, looked for
// under the plugin's old name too. An entry that is not named for a version,
// such as a .DS_Store, is passed over.
// ponytail: the newest copy in the cache, which is not always the one this
// session loaded (a --plugin-dir run, a pinned version). Read the installed
// plugins record if that turns out to matter.
async function rules($: any, config: string): Promise<string> {
  const cache = `${config}/plugins/cache`
  let best = ''
  let bestKey: number[] = []
  for (const market of await $.fs.list(cache).catch(() => [])) {
    for (const plugin of ['writing-skills', 'writing-conventions']) {
      for (const version of await $.fs.list(`${cache}/${market.name}/${plugin}`).catch(() => [])) {
        if (!/^\d+(\.\d+)*$/.test(version.name)) continue
        const key = version.name.split('.').map(Number)
        if (best === '' || later(key, bestKey)) {
          best = `${cache}/${market.name}/${plugin}/${version.name}/hooks/rules.md`
          bestKey = key
        }
      }
    }
  }
  return best
}

const home = async ($: any): Promise<string> => (await $.env.get('HOME')) || (await $.env.get('USERPROFILE')) || ''

// The plugin's voice_dir option, then GHOSTWRITING_DIR, then the default.
async function located($: any, configured: string | undefined): Promise<string> {
  return configured || (await $.env.get('GHOSTWRITING_DIR')) || `${await home($)}/.claude/ghostwriting`
}

async function directory($: any, configured: string | undefined): Promise<string> {
  const dir = await located($, configured)
  const found = (await $.fs.exists(`${dir}/voice-spec.md`).catch(() => false)) ? `spec: ${dir}/voice-spec.md` : 'NO SPEC'
  return `\n\n---\n\n## Voice directory, located by the plugin\n\nVOICE=${dir}\n${found}\n`
}

async function voice($: any, configured: string | undefined): Promise<string> {
  const dir = await located($, configured)
  const head = '\n\n---\n\n## Voice data, loaded by the plugin\n\n'
  let spec: string
  try {
    spec = await $.fs.read(`${dir}/voice-spec.md`)
  } catch {
    // Only a spec that is not there is a bootstrap, which ends in writing a new
    // one. After any other failure the model is given the directory to read.
    if (await $.fs.exists(`${dir}/voice-spec.md`).catch(() => true)) {
      return `${head}VOICE=${dir}\n\nThe plugin could not read \`${dir}/voice-spec.md\`. Read it, the corpus, and the always-on rules file yourself, each whole.\n`
    }
    return `${head}VOICE=${dir}\n\nMODE=bootstrap: there is no \`${dir}/voice-spec.md\`. Go to §5.\n`
  }
  let out = `${head}The plugin read these files whole as this skill loaded. They are §1's reads, already done: do not read these files again. If the request points at voice data somewhere else, read it there instead and ignore what follows.\n\nVOICE=${dir}\n\n${file(`${dir}/voice-spec.md`, spec)}`
  const entries = (await $.fs.list(`${dir}/corpus`).catch(() => []))
    .filter((e: any) => e.kind !== 'dir' && /\.(md|markdown|txt)$/i.test(e.name))
    .sort((a: any, b: any) => (a.name < b.name ? -1 : 1))
  const names: string[] = entries.map((e: any) => e.name)
  const listed = (which: string[]) => which.map(n => `\`${dir}/corpus/${n}\``).join(', ')
  // A character is at most four bytes, so a corpus over four times the cap on
  // disk is over it, and none of it is read.
  let over = entries.reduce((sum: number, e: any) => sum + (e.size ?? 0), 0) > CORPUS_CAP * 4
  const samples: string[] = []
  const unread: string[] = []
  for (const name of over ? [] : names) {
    try {
      samples.push(file(`${dir}/corpus/${name}`, await $.fs.read(`${dir}/corpus/${name}`)))
    } catch {
      unread.push(name)
    }
  }
  over ||= samples.join('').length > CORPUS_CAP
  if (names.length === 0) out += 'There is no corpus: draft on the spec alone and record the gap in §4.\n'
  else if (over) out += `\nThe corpus is too large to append. Read two or three of these that match the genre, each whole: ${listed(names)}\n`
  else {
    out += `\nThe corpus, ${unread.length === 0 ? 'every sample' : 'the samples the plugin could read'}:\n\n${samples.join('\n')}`
    if (unread.length > 0) out += `\nThe plugin could not read ${listed(unread)}. Read each of those yourself, whole, and say so in the hand-over if that fails too.\n`
  }
  const path = await rules($, (await $.env.get('CLAUDE_CONFIG_DIR')) || `${await home($)}/.claude`)
  const found = path === '' ? undefined : await $.fs.read(path).catch(() => undefined)
  if (found !== undefined) out += `\nThe always-on rules file, re-read for §1:\n\n${file(path, found)}`
  else out += '\nThe plugin did not find the always-on rules file. Re-read the one from §0 yourself, for §1.\n'
  return out
}

// The text added after the skill's own, or '' for any other skill.
async function added($: any, skill: string, configured: unknown): Promise<string> {
  const name = skill.split(':').pop()
  if (name === 'ghostwrite') return voice($, configured)
  return name === 'share-ghostwriting-spec' ? directory($, configured) : ''
}

export const register: Register = (on, options) => {
  // Not skill.prompt: under managed settings `cc-plugin-sec-default` sends it
  // past this plugin and prints a notice, so the text goes beside the Skill
  // tool's result instead.
  on('tool.call', { tool: 'Skill' }, async ($, e: any, next: any) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError) return ran
    try {
      const text = await added($, String(e.skill ?? ''), (options as any)?.voice_dir)
      return text ? { ...ran, context: [...(ran.context ?? []), text] } : ran
    } catch {
      return ran
    }
  })

  // No Skill call is made for a typed slash command. Context added after next()
  // is dropped, so the text goes in before it.
  on('prompt.submit', async ($, e: any, next: any) => {
    const skill = String(e.command?.name ?? '')
    const text = skill ? await added($, skill, (options as any)?.voice_dir).catch(() => '') : ''
    return next(text ? { ...e, context: [...(e.context ?? []), text] } : e)
  })
}
