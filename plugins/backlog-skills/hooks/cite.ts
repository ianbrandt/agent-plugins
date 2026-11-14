// IDs written without their titles (design D7). An item is cited as `ID: Title`.
import { GROUP, KEYS, idList, idsIn, scan } from './format'

const FIELD_LINE = new RegExp(`^\\s*(?:[-*+]\\s+)?(?:${KEYS.join('|')}):`)

// Each ID in `known` that appears in `text` without its title, in order, once.
export function bareIds(text: string, known: Set<string>): string[] {
  const prose = scan(text).lines
    .filter(l => !l.code && !FIELD_LINE.test(l.text))
    .map(l => l.text)
    .join('\n')
    // A code span ends in its paragraph. shortcut: it closes on the next run of as many backticks, not of exactly as many.
    .replace(/(`+)(?:(?!\n[ \t]*\n)[\s\S])*?\1/g, ' ')
  const cited = new Set<string>()
  const bare: string[] = []
  for (const m of prose.matchAll(new RegExp(GROUP, 'g'))) {
    const titled = /^:[ \t]+\S/.test(prose.slice(m.index! + m[0].length))
    // Every ID in a cited range counts as cited. In a bare one, only the IDs written are reported.
    for (const id of (titled && idList(m[0])) || idsIn(m[0])) {
      if (!known.has(id)) continue
      if (titled) cited.add(id)
      else if (!cited.has(id) && !bare.includes(id)) bare.push(id)
    }
  }
  return bare
}
