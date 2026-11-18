// A conflicted file read as its parts: unchanged text, and conflicts (<<<<<<< ours ||||||| base
// ======= theirs >>>>>>>), each resolved by picking a side, both, or text of your own. Pure, so it
// can be tested without the window.
//
// Every line keeps its own ending: lines are split on \n and a \r stays on its line, so a file with
// mixed endings (common in Unity's .cs files) is written back exactly as it was outside what you chose.
// show() takes the \r off for display.

export type Segment =
  | { kind: 'text'; lines: string[] }
  | {
      kind: 'conflict'
      ours: string[]
      base: string[] | null
      theirs: string[]
      oursLabel: string
      theirsLabel: string
      /** The marker lines as they were, for writing a conflict back unresolved. */
      markers: { start: string; base: string | null; mid: string; end: string }
    }

export type Conflict = Extract<Segment, { kind: 'conflict' }>
export type Choice = 'ours' | 'theirs' | 'ours-theirs' | 'theirs-ours' | { custom: string }

const START = /^<{7}(?: (.*))?$/
const BASE = /^\|{7}(?: .*)?$/
const MID = /^={7}$/
const END = /^>{7}(?: (.*))?$/

/** A line without its \r (for display, and for telling markers apart). */
export const show = (line: string): string => (line.endsWith('\r') ? line.slice(0, -1) : line)

/**
 * The file split into text and conflicts; null when it has none, or they can't be told apart for sure:
 * a conflict that's never closed, one inside another, or a second ======= line (a heading underline,
 * say), which would put the split between the sides in the wrong place.
 */
export function parseConflicts(text: string): Segment[] | null {
  const lines = text.split('\n')
  const out: Segment[] = []
  let plain: string[] = []
  let found = false
  for (let i = 0; i < lines.length; i++) {
    const start = START.exec(show(lines[i]))
    if (!start) {
      plain.push(lines[i])
      continue
    }
    const ours: string[] = []
    let base: string[] | null = null
    const theirs: string[] = []
    let part: 'ours' | 'base' | 'theirs' = 'ours'
    let baseLine: string | null = null
    let midLine = ''
    let end: RegExpExecArray | null = null
    let j = i + 1
    for (; j < lines.length; j++) {
      const raw = lines[j]
      const l = show(raw)
      if (part === 'ours' && BASE.test(l)) {
        part = 'base'
        base = []
        baseLine = raw
      } else if (MID.test(l)) {
        if (part === 'theirs') return null // a second =======: which one splits the sides is a guess
        part = 'theirs'
        midLine = raw
      } else if (part === 'theirs' && (end = END.exec(l))) break
      else if (START.test(l)) return null // a conflict inside a conflict: not something to resolve here
      else (part === 'ours' ? ours : part === 'base' ? base! : theirs).push(raw)
    }
    if (!end) return null // never closed
    if (plain.length) out.push({ kind: 'text', lines: plain })
    plain = []
    out.push({
      kind: 'conflict',
      ours,
      base,
      theirs,
      oursLabel: start[1] ?? '',
      theirsLabel: end[1] ?? '',
      markers: { start: lines[i], base: baseLine, mid: midLine, end: lines[j] }
    })
    found = true
    i = j
  }
  out.push({ kind: 'text', lines: plain })
  return found ? out : null
}

/** The ending a conflict's own lines mostly use ('\r' for CRLF): what text you type in it gets. */
const endingOf = (c: Conflict): string => {
  const all = [...c.ours, ...c.theirs, c.markers.start]
  return all.filter((l) => l.endsWith('\r')).length * 2 > all.length ? '\r' : ''
}

/** A conflict's lines once resolved that way (each still with its own ending). */
export function chosenLines(c: Conflict, choice: Choice): string[] {
  if (typeof choice === 'object') {
    if (choice.custom === '') return []
    const cr = endingOf(c)
    return choice.custom.replace(/\r\n/g, '\n').split('\n').map((l) => l + cr)
  }
  if (choice === 'ours') return c.ours
  if (choice === 'theirs') return c.theirs
  return choice === 'ours-theirs' ? [...c.ours, ...c.theirs] : [...c.theirs, ...c.ours]
}

/** The file's text with each conflict resolved by its choice; one without a choice keeps its markers. */
export function resolveText(segments: Segment[], choices: (Choice | null)[]): string {
  const lines: string[] = []
  let n = 0
  for (const s of segments) {
    if (s.kind === 'text') {
      lines.push(...s.lines)
      continue
    }
    const choice = choices[n++]
    if (choice) lines.push(...chosenLines(s, choice))
    else lines.push(s.markers.start, ...s.ours, ...(s.base ? [s.markers.base!, ...s.base] : []), s.markers.mid, ...s.theirs, s.markers.end)
  }
  return lines.join('\n')
}

/** Text still holding conflict markers (a line starting <<<<<<< or >>>>>>>). */
export const hasMarkers = (text: string): boolean => /^(<{7}|>{7})( |\r?$)/m.test(text)
