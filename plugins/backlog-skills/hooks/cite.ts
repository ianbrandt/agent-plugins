// IDs written without their titles (design D7). An item is cited as `ID: Title`.
import { ID, KEYS, scan } from './format'

const B = `(?<!\\w)${ID}(?!\\w|\\.\\d)`
// One ID, or a range or list of them, as in `R144 to R149` or `R3, R7, and R9`.
const GROUP = new RegExp(`${B}(?:(?:,? and |, | to )${B})*`, 'g')
const FIELD_LINE = new RegExp(`^\\s*(?:[-*+]\\s+)?(?:${KEYS.join('|')}):`)

// Each ID in `known` that appears in `text` without its title, in order, once.
export function bareIds(text: string, known: Set<string>): string[] {
  const prose = scan(text).lines
    .filter(l => !l.code && !FIELD_LINE.test(l.text))
    .map(l => l.text)
    .join('\n')
    // shortcut: a code span closes on the next run of as many backticks, not of exactly as many.
    .replace(/(`+)[\s\S]*?\1/g, ' ')
  const cited = new Set<string>()
  const bare: string[] = []
  for (const m of prose.matchAll(GROUP)) {
    const titled = /^:[ \t]+\S/.test(prose.slice(m.index! + m[0].length))
    for (const id of m[0].match(new RegExp(B, 'g'))!) {
      if (!known.has(id)) continue
      if (titled) cited.add(id)
      else if (!cited.has(id) && !bare.includes(id)) bare.push(id)
    }
  }
  return bare
}
