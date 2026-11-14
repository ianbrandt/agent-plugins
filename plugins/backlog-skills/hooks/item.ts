import { headings, scan } from './format'

// Deletes one item from a backlog file: from its heading to the next heading of
// the same or a higher level, or to the end of the file. Sub-items go with it.
// The write tools in write.ts use it for the backlog and for the parked and
// declined files. Headings and fences are read as parseBacklog reads them.
export function deleteItem(text: string, id: string): { text: string; removed: string[] } {
  if (!id.trim()) throw new Error('the ID is empty')
  const { lines, unclosed } = scan(text)
  if (unclosed) throw new Error('a fenced block is not closed')
  const heads = headings(text, lines, 6)
  // Only an item heading, ## or ###, is the item's: prose may use #### and deeper (D4).
  const own = heads.filter(h => (h.level === 2 || h.level === 3) && h.rest.startsWith(id) && !/^[\w.]/.test(h.rest.slice(id.length)))
  if (own.length !== 1) throw new Error(`${id}: ${own.length} headings`)
  const { line: { at }, end } = own[0]
  return {
    text: text.slice(0, at) + text.slice(end),
    removed: heads.filter(h => h.line.at >= at && h.line.at < end).map(h => h.line.text),
  }
}
