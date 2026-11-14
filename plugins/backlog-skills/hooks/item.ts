// Deletes one item from a roadmap: from its heading to the next heading of the
// same or a higher level, or to the end of the file. Sub-items go with it.
// Other sessions add items while this one builds, so the end is found in the
// text as it is now. A line inside a fenced block is not a heading.
export function deleteItem(text: string, id: string): { text: string; removed: string[] } {
  if (!id.trim()) throw new Error('the ID is empty')
  const heads: { at: number; level: number; line: string }[] = []
  let fence = ''
  let at = 0
  for (const line of text.split('\n')) {
    if (fence) {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t\r]*$/.exec(line)?.[1]
      if (close && close[0] === fence[0] && close.length >= fence.length) fence = ''
    } else {
      const open = /^ {0,3}(?:(`{3,})[^`]*|(~{3,}.*))$/.exec(line)
      if (open) fence = open[1] ?? open[2].match(/^~+/)![0]
      else {
        const level = /^(#+) /.exec(line)?.[1].length
        if (level) heads.push({ at, level, line })
      }
    }
    at += line.length + 1
  }
  if (fence) throw new Error('a fenced block is not closed')
  const own = heads.filter(h => h.line.replace(/^#+ /, '').startsWith(id) && !/^[\w.]/.test(h.line.replace(/^#+ /, '').slice(id.length)))
  if (own.length !== 1) throw new Error(`${id}: ${own.length} headings`)
  const i = heads.indexOf(own[0])
  const end = heads.slice(i + 1).find(h => h.level <= own[0].level)?.at ?? text.length
  return {
    text: text.slice(0, own[0].at) + text.slice(end),
    removed: heads.filter(h => h.at >= own[0].at && h.at < end).map(h => h.line),
  }
}
