// House-style lint over prose, ported from an awk script function for function.
// lint(text) returns one line per flagged sentence:
//   <group>\t<matched text>
// With `note` it returns the note the next turn opens with instead, or '' when
// the text is clean. Pure: no files, no environment. Every line of the result
// ends in a newline.
//
// Five groups. Banned words and spaced em dashes are exact. A missing Oxford
// comma is caught only in a list of single words with two commas before the
// final "and" or "or" ("json, xml, html and plain"). A multi-word item, or a
// list with one comma ("a, b and c"), looks too much like a clause to flag.
// Inanimate agency is precision-first. A match is a determiner-led or pronoun
// subject followed by a verb of speech, volition, cognition, or configuration
// (finite, or a participle such as "a file declaring an alias"). The subject is
// checked against an animate list. Passives and adjectival participles are
// excluded by the gap words, and reduced passives ("the rule stated in", "three
// named endpoints") by the word after the verb. The noun-or-verb forms (names,
// states, claims, offers) are kept only when an object-like word follows. Left out
// on purpose: holds, keeps, writes, uses, adds, sets, and "notes". In a hand
// check of 90 hits the first group was mostly code mechanics (a map holds a value,
// a task writes a file, allowed in gate-prompt.md as a program doing its job), and
// "notes" is nearly always the noun. The finite subject patterns are tried
// shortest first, so "the report says we decided" is caught on "the report says"
// before the longer span that includes the human clause is tried.
// The fifth group is a bulleted or numbered item that opens on bold text
// ("- **Label.** text"), matched on the raw line outside a fence.
//
// A pattern that can meet a character outside ASCII has the `u` flag, so that
// one outside the BMP is one character, as it is to awk in a UTF-8 locale. POSIX
// matching is leftmost-longest and JavaScript's is leftmost-first: in each
// pattern below, where two matches of different lengths can start at one place,
// the greedy order tries the longer one first.

// [[:alnum:]] as macOS awk reads it in a UTF-8 locale: ASCII and the Latin-1
// letters. In the C locale it is ASCII alone, and awk works in bytes there.
const AL = '0-9A-Za-zªµºÀ-ÖØ-öø-ÿ'
const re = (source: string, flags = '') => new RegExp(source, 'u' + flags)

const WORD = `[${AL}'’—_\\-]+`
const W = `${WORD} `
const DET = '(the|a|an|this|that|these|those|each|every|its|our|my|your|neither|either|both|no)'
const ADV = '((never|also|always|still|then|only|just|already|itself) )?'
const VERB = '(says|said|tells|told|wants|wanted|knows|knew|decides|decided|claims|claimed|asks|asked' +
  '|expects|expected|promises|promised|believes|believed|thinks|thought|concludes|concluded' +
  '|states|stated|declares|declared|insists|insisted|refuses|refused|assumes|assumed' +
  '|credits|credited|names|named|judges|judged|offers|offered|withholds|withheld|intends|intended' +
  '|wishes|wished|cares|cared|remembers|remembered|forgets|forgot|exempts|exempted' +
  '|configures|configured|enables|enabled|owns|owned|gives|gave|carries|carried' +
  '|produces|produced|shares|shared|joins|joined)'
const PART = '(saying|telling|wanting|knowing|deciding|claiming|asking|expecting|promising|believing' +
  '|thinking|concluding|stating|declaring|insisting|refusing|assuming|crediting|naming|judging' +
  '|offering|withholding|intending|wishing|exempting|configuring|enabling|owning|giving|carrying' +
  '|producing|sharing|joining)'
const SB = `(^|[^${AL}_\\-])`
const NB = `([^${AL}_\\-]|$)`

// Finite subject patterns with one to five words between the determiner and
// the verb, tried in that order (see the header). Then the relative clause,
// the bare pronoun, the "whose" possessive, and the participle.
type Kind = 'finite' | 'rel' | 'whose' | 'part'
const P: RegExp[] = []
const KIND: Kind[] = []
for (let k = 1, span = ''; k <= 5; k++) {
  span += W
  P.push(re(`${SB}${DET} ${span}${ADV}${VERB}${NB}`))
  KIND.push('finite')
}
P.push(re(`${SB}${WORD},? (that|which) ${ADV}${VERB}${NB}`))
KIND.push('rel')
P.push(re(`${SB}(it|this|that|neither|either|both|each) ${ADV}${VERB}${NB}`))
KIND.push('finite')
P.push(re(`${SB}${DET} (${W})?(${W})?(${W})?${WORD},? whose `))
KIND.push('whose')
P.push(re(`${SB}${DET} (${W})?(${W})?(${W})?${PART} `))
KIND.push('part')
// In each of the nine a determiner or pronoun comes first, then a verb from one
// of the lists or "whose", so a sentence with no verb after its first determiner
// matches none of them, and the nine are skipped for it.
const GATE_SUBJ = re(`${SB}(${DET}|it|which) `)
const GATE_VERB = re(`${SB}(${VERB}|${PART}|whose)${NB}`)
const P_BANNED = re(`${SB}(load-bearing|vacuous|vacuously|non-vacuous|owe|owes|owed|shape|shapes|slot|slots` +
  `|channel|channels|deleak|de-risk|derisk)${NB}`)
const P_DASH = /[ \t]—|—[ \t]/u
const P_OXFORD = /(^|[^0-9A-Za-z_-])[0-9A-Za-z_-]+, [0-9A-Za-z_-]+, [0-9A-Za-z_-]+ (and|or) [0-9A-Za-z_-]+/u
// Subjects that act: people, roles, and the agents and sessions that contain one.
const ANIMATE = ' i we you he she they user users author authors maintainer maintainers reviewer reviewers' +
  ' team teams developer developers dev devs engineer engineers contributor contributors reader' +
  ' readers writer writers person people agent agents assistant model human humans folks everyone' +
  ' someone anybody nobody who session sessions subagent subagents verifier verifiers orchestrator' +
  ' conductor delegate delegates critic judge customer customers client clients stakeholder' +
  ' stakeholders owner owners manager managers lead leads designer designers tester testers' +
  ' colleague colleagues operator operators reporter reporters commenter commenters requester' +
  ' requesters bot bots vendor vendors sponsor sponsors '
// A gap word from this list means a passive, an adjectival participle, or a
// clause boundary, so the verb is not this subject's.
const SKIPGAP = " is are was were be been being to not n't does do did can could will would may might must" +
  ' should has have had the a an this that these those each every its our my your neither' +
  ' either both no if when unless because since while whether after before until where' +
  ' which who whom and or but '
// After a past form, a preposition means a reduced passive ("the rule stated in").
const PREP = ' in at on by above below under over within there here earlier through via from with as for' +
  ' into onto than '
// A past form is a verb rather than a participle only when an object-like word
// follows: "the report concluded the build is fine", not "three named endpoints".
const PASTOBJ = ' the a an its their this that these those what which who how why where when whether it' +
  ' them him her me us you one no every each some any all both several many none nothing' +
  ' something anything everything code quote '
const AMBIG = ' names states claims offers judges credits wishes cares shares '
const NOOBJ = ' of is are was were and or as for to in on at by with from than '
// After "that"/"which"/"who", a determiner or pronoun means a clause object
// ("the spec states that the build is fine"), a verb means the noun reading
// ("the four claims that need a live run").
const CLAUSE = ' the a an its their this these those it we you they i there '
// "the loop gives up" is phrasal, not a verb of giving.
const PHRASAL = ' up way in out back off '
const RULE: Record<string, string> = {
  'banned word': 'that word is banned in prose; use a plain synonym',
  'spaced em dash': 'an em dash takes no surrounding spaces: write word—word, never word — word',
  'oxford comma': 'a list of three or more items takes a comma before the final "and" or "or": write a, b, and c',
  'inanimate agency': 'an inanimate subject must not take a verb of speech, volition, or cognition; say who the real actor is, or rewrite around the act',
  'bold list item': 'a list of findings takes no bold; start each item with its plain words',
}
const ORDER = ['banned word', 'spaced em dash', 'oxford comma', 'inanimate agency', 'bold list item']

const LEAD = re(`^[^${AL}]+`)
const TAIL = re(`[^${AL}]+$`)
const NEXT_WORD = re(`^[${AL}'’_\\-]+[^${AL}]+`)
const WORD_END = re(`[^${AL}'’_\\-].*$`, 's')
const NOT_WORD = re(`[^${AL}'’_\\-]`, 'g')
const BOUNDARY = re(`[${AL}_\\-]`)

// One run's position: the open fence, the lines held since it opened, and the
// hits so far with the first example of each group.
type Run = { note: boolean; fence: string; held: string[]; total: number; count: Record<string, number>; example: Record<string, string>; out: string }

// awk's records: a final line with no newline is still one, and a final
// newline adds none.
function records(text: string): string[] {
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

// awk's tolower. İ is the one letter that JavaScript lowercases to two
// characters, and awk in a UTF-8 locale lowercases it to i. The offsets found in
// the lowered sentence are used on the sentence as written, so the two have to
// be the same length.
function lower(s: string): string {
  return s.replace(/İ/gu, 'i').toLowerCase()
}

// One line at a time: a newline always ends a sentence, and none of the
// reductions in prose() spans one.
export function lint(text: string, options?: { note?: boolean }): string {
  const r: Run = { note: !!options?.note, fence: '', held: [], total: 0, count: {}, example: {}, out: '' }
  for (const line of records(text)) fenced(r, line)
  if (r.fence !== '') for (const x of r.held) prose(r, x)
  if (r.note) {
    if (r.total === 0) return ''
    r.out += 'A house-style lint flagged the previous reply:\n'
    for (const g of ORDER) {
      if (r.count[g]) r.out += `- ${g} x${r.count[g]}, e.g. "${r.example[g]}". Rule: ${RULE[g]}.\n`
    }
    r.out += 'Apply these rules in the reply you are about to write, including in markdown headings. Do not re-send the previous reply and do not correct it; there is no need to mention this note unless the user asks about it. Leave a literal sense (a Slack channel, an array shape, a timetable slot) alone.\n'
  }
  return r.out
}

function hit(r: Run, g: string, ex: string): void {
  r.total++
  r.count[g] = (r.count[g] ?? 0) + 1
  if (!(g in r.example)) r.example[g] = ex
  if (!r.note) r.out += `${g}\t${ex}\n`
}

// One hit per sentence at most. An excluded match is stepped past so a real hit
// later in the same sentence is still found: "the grounds that the rule wants"
// is excluded on "that", then "the rule wants" is tried on its own.
function agency(r: Run, s: string, l: string): void {
  const subject = GATE_SUBJ.exec(l)
  if (!subject) return
  if (!GATE_VERB.test(l.slice(subject.index))) return
  for (let p = 0; p < P.length; p++) {
    const kind = KIND[p]
    let pos = 0
    while (pos < l.length) {
      const found = P[p].exec(l.slice(pos))
      if (!found) break
      // stepping past an excluded match must not turn the middle of a word into a start-of-text boundary
      if (found.index === 0 && pos > 0 && BOUNDARY.test(l[pos - 1])) { pos++; continue }
      const start = pos + found.index
      const len = found[0].length
      pos = start + 1
      const span = trim(l.slice(start, start + len))
      const nextc = l[start + len - 1]     // the boundary character right after the verb
      let after = l.slice(start + len).replace(LEAD, '')
      const after2 = after.replace(NEXT_WORD, '').replace(WORD_END, '')
      after = after.replace(WORD_END, '')
      if (/^that said/.test(span)) continue
      const words = span.split(/[ \t]+/)
      const m = words.length - 1
      const verb = (kind === 'whose' ? 'whose' : words[m]).replace(NOT_WORD, '')
      let subOk = true
      for (let i = 0; i < m; i++) {
        const w = words[i].replace(NOT_WORD, '')
        if (ANIMATE.includes(` ${w} `)) subOk = false
        if (i > 0 && !(kind === 'rel' && i === 1) && SKIPGAP.includes(` ${w} `)) subOk = false
        if (i === m - 1 && /('s|’s|s')$/.test(w)) subOk = false
      }
      if (!subOk) continue
      if (kind !== 'whose' && kind !== 'part' && !verb.endsWith('s')) {
        // a past form: a verb only when an object-like word follows, else a participle or a reduced passive
        if (/[,.;:]/.test(nextc)) continue
        if (PREP.includes(` ${after} `)) continue
        if (after !== '' && !/^[0-9]/.test(after) && !PASTOBJ.includes(` ${after} `)) continue
        if (verb === 'named' && (after === 'code' || after === 'quote')) continue   // "a case named `foo`"
      }
      if (/^(gives|gave)$/.test(verb) && PHRASAL.includes(` ${after} `)) continue
      if (AMBIG.includes(` ${verb} `)) {
        // a noun-or-verb word is a verb here only when an object-like word follows it:
        // "the report names the file", not "the spec names, 163 lines" or "the shorter names re-wrapped"
        if (/[,.;:]/.test(nextc) || after === '' || NOOBJ.includes(` ${after} `)) continue
        if (/^(that|which|who)$/.test(after)) { if (!CLAUSE.includes(` ${after2} `)) continue }
        else if (!PASTOBJ.includes(` ${after} `) && !adverb(after)) continue
      }
      hit(r, 'inanimate agency', example(s.slice(start, start + len)))
      return
    }
  }
}

// Fenced blocks are dropped by matching the opening marker (three or more of
// the same character, closed by at least as many); a fence left open at the end
// of the text is treated as prose, so a truncated reply is still linted.
function fenced(r: Run, x: string): void {
  const marker = /^[ \t]*(`{3,}|~{3,})/u.exec(x)
  if (marker) {
    const m = marker[1]
    if (r.fence === '') { r.fence = m; r.held = [x]; return }
    if (m[0] === r.fence[0] && m.length >= r.fence.length) { r.fence = ''; r.held = []; return }
  }
  if (r.fence !== '') { r.held.push(x); return }
  // A bulleted or numbered item that opens on bold text, checked before prose()
  // drops the asterisks.
  const bold = /^[ \t]*([-*+]|[0-9]+[.)])[ \t]+\*\*[^*]+\*\*/u.exec(x)
  if (bold) hit(r, 'bold list item', example(bold[0].replace(/^[^*]+/u, '')))
  prose(r, x)
}

// Inline code, straight or curly double-quoted text, and markdown emphasis or
// link syntax around a word are reduced so the sentence keeps its grammar. The
// sentence break before a newline is taken off the end of the line first.
function prose(r: Run, x: string): void {
  x = x.replace(/`[^`]*`/gu, 'CODE')
  x = x.replace(/"[^"]*"/gu, 'QUOTE')
  x = x.replace(/“[^”]*”/gu, 'QUOTE')
  x = x.replace(/\]\([^)]*\)/gu, '')
  x = x.replace(/[*\[]+/gu, '')
  // A dash that fills a table cell stands for an empty value, so its spaces are markdown. No two
  // runs of spaces are next to each other in the pattern, so a long run is matched in linear time.
  x = x.replace(/(^[ \t>]*|(?<!\\)\|[ \t]*)—[ \t]*(?=\||\r?$)/gu, '$1')
  // literal senses stay: a Slack or byte channel, an array shape, a time slot
  x = x.replace(/[Ss]lack channel|[Mm]essage channel|[Bb]yte channel|[Rr]elease channel|[Aa]rray shape|[Tt]ensor shape|[Tt]imetable slot|[Tt]ime slot/gu, 'LITERAL')
  // With each lookbehind a match can start only where a run of these starts,
  // which is where awk's leftmost match starts. Without it a long run of dots
  // with no space after it is scanned once from each of its characters.
  x = x.replace(/(?<![.!?;:])[.!?;:]+[ \t]*$/u, '')
  for (const s of x.split(/(?<![.!?;:])[.!?;:]+[ \t]+/u)) {
    if (/^[ \t]*$/.test(s)) continue
    const l = lower(s)
    const dash = P_DASH.exec(s)
    if (dash) hit(r, 'spaced em dash', dash[0])
    const banned = P_BANNED.exec(l)
    if (banned) hit(r, 'banned word', trim(s.slice(banned.index, banned.index + banned[0].length)))
    const oxford = P_OXFORD.exec(s)
    if (oxford) hit(r, 'oxford comma', example(oxford[0]))
    agency(r, s, l)
  }
}

function trim(x: string): string {
  return x.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '')
}

// The reported text starts and ends on a word, so no boundary character is left
// on either end of it in the note.
function example(x: string): string {
  return x.replace(LEAD, '').replace(TAIL, '')
}

// "states plainly" keeps the verb reading; "names imply" does not.
function adverb(w: string): boolean {
  return /[a-z][a-z]ly$/.test(w) && !' imply apply reply supply rely comply multiply ally family early only likely '.includes(` ${w} `)
}
