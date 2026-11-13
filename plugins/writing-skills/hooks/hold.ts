// A reply's text streams up to its first `draft` fence, and the rest of the
// response is held. When the reply ends the turn, `check` reads what was held: a
// clean reply is then shown whole, and a flagged one is replaced with a call to a
// tool, so the same turn goes on and the model writes it again. The user sees the
// tool call and the corrected reply, with no prompt in between. A response that
// asks for tools is shown as it came, since it does not end the turn, and so is
// one cut off by max_tokens or a refusal, which the reply lint still reads.
//
// The fence is read as drafts() in text.ts reads it. A line is kept back only
// while it could still turn out to be a fence marker, so plain text streams as it
// comes.
import { fenceLine } from './text'

const mayBeMarker = (line: string) => /^[ \t]*(`{0,2}|~{0,2}|`{3,}[^\n]*|~{3,}[^\n]*)$/.test(line)

// The call that replaces a flagged reply: the tool's name and the call's id.
export type Call = { tool: string; id: string }

export async function* hold(
  stream: AsyncIterable<any>,
  check: (answer: string) => Promise<Call | undefined>,
): AsyncGenerator<any, any> {
  const it = stream[Symbol.asyncIterator]()
  // The response's text for the review, each block on lines of its own, as it
  // would be read by the user.
  let answer = ''
  let before = ''
  let top = -1
  // The open fence, the text kept back from the current line, and whether the
  // current line has already been ruled out as a marker.
  let fence = ''
  let line = ''
  let inLine = false
  let block: number | undefined
  const read = (chunk: any) => {
    if (chunk.index !== block && answer !== '' && !answer.endsWith('\n')) answer += '\n'
    answer += chunk.text
  }
  // From the draft fence on: every chunk, and the text in them.
  let held: any[] | undefined
  let text = ''
  let stop: any
  for (;;) {
    let step: IteratorResult<any, any>
    let failed: unknown
    try {
      step = await it.next()
    } catch (error) {
      step = { done: true, value: undefined }
      failed = error ?? new Error('turn.step failed')
    }
    const chunk: any = step.done ? undefined : step.value
    if (typeof chunk?.index === 'number') top = Math.max(top, chunk.index)

    if (held) {
      if (chunk) {
        held.push(chunk)
        if (chunk.kind === 'text') {
          read(chunk)
          block = chunk.index
          text += chunk.text
        }
        if (chunk.kind === 'stop') stop = chunk
        continue
      }
      const reason = stop?.stopReason ?? step.value?.stopReason
      const call = !failed && (reason === 'end_turn' || reason === 'stop_sequence') ? await check(answer) : undefined
      if (call) {
        const index = top + 1
        const input = { text }
        yield { kind: 'tool', index, id: call.id, name: call.tool }
        yield { kind: 'input', index, json: JSON.stringify(input) }
        yield { kind: 'stop', usage: null, ...stop, stopReason: 'tool_use' }
        return { ...step.value, answer: before, toolUses: [{ name: call.tool, input }], stopReason: 'tool_use' }
      }
      for (const c of held) yield c
      if (failed) throw failed
      return step.value
    }

    if (chunk?.kind === 'text') {
      read(chunk)
      if (chunk.index !== block) {
        block = chunk.index
        fence = ''
        inLine = false
      }
      const piece = line + chunk.text
      line = ''
      let out = ''
      let i = 0
      while (i < piece.length) {
        const newline = piece.indexOf('\n', i)
        const end = newline < 0 ? piece.length : newline + 1
        const current = piece.slice(i, newline < 0 ? piece.length : newline)
        if (newline < 0 && !inLine && mayBeMarker(current)) { line = current; break }
        const moved = newline < 0 || inLine ? undefined : fenceLine(current, fence)
        if (moved?.draft) {
          text = piece.slice(i)
          before = answer.slice(0, answer.length - text.length)
          held = [{ ...chunk, text }]
          break
        }
        if (moved) fence = moved.fence
        out += piece.slice(i, end)
        inLine = newline < 0
        i = end
      }
      if (out !== '') yield { ...chunk, text: out }
      continue
    }

    // Any other chunk ends the line: what was kept back was no marker, and text
    // that follows starts over.
    if (line !== '') yield { kind: 'text', index: block, text: line }
    line = ''
    fence = ''
    inLine = false
    if (failed) throw failed
    if (step.done) return step.value
    yield chunk
  }
}
