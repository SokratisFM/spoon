// JSON for Text compare: whether a text is JSON (and where it breaks if not), and reformatting it.
// Formatting only moves whitespace between tokens, so numbers (even ones too big for JavaScript),
// strings and the order of keys stay exactly as written.

export type JsonCheck =
  | { json: false }
  | { json: true; ok: true }
  | { json: true; ok: false; message: string; pos: number; line: number; col: number }

/** Text that starts like an object or array is treated as JSON and checked. */
export function checkJson(text: string): JsonCheck {
  if (!/^\s*[[{]/.test(text)) return { json: false }
  try {
    JSON.parse(text)
    return { json: true, ok: true }
  } catch (err) {
    const raw = (err as Error).message
    const at = /position (\d+)/.exec(raw)
    const pos = at ? Number(at[1]) : text.length
    const before = text.slice(0, pos)
    const line = before.split('\n').length
    const col = pos - before.lastIndexOf('\n')
    const message = raw
      .replace(/\s*\(line \d+ column \d+\)/, '')
      .replace(/ in JSON at position \d+/, '')
      .replace(/^JSON\.parse: /, '')
    return { json: true, ok: false, message, pos, line, col }
  }
}

/** Pretty-printed (two spaces) or compact JSON; the text must be valid JSON. */
export function formatJson(text: string, mode: 'pretty' | 'compact'): string {
  const pretty = mode === 'pretty'
  let out = ''
  let depth = 0
  const newline = (): string => (pretty ? `\n${'  '.repeat(depth)}` : '')
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') {
      // A whole string, escapes included, exactly as written.
      let j = i + 1
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1
      out += text.slice(i, j + 1)
      i = j
    } else if (c === '{' || c === '[') {
      // An empty one stays on one line: {} and [].
      let j = i + 1
      while (j < text.length && /\s/.test(text[j])) j++
      if (text[j] === (c === '{' ? '}' : ']')) {
        out += c + text[j]
        i = j
      } else {
        depth++
        out += c + newline()
      }
    } else if (c === '}' || c === ']') {
      depth--
      out += newline() + c
    } else if (c === ',') out += ',' + newline()
    else if (c === ':') out += pretty ? ': ' : ':'
    else if (!/\s/.test(c)) out += c
  }
  return out
}
