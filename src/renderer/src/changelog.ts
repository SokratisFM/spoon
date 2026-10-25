// Reads the MainLib changelog page (Confluence storage format): a table with one row per version,
// the version and its status in the first cell ("4.1.0 · Rummy 500 Fiogonia · Android …" or
// "Release Candidate"), and the tickets as a list in the second.

export interface ChangelogTicket {
  key: string | null
  title: string
  url: string | null
}

export interface ChangelogEntry {
  version: string
  /** rc: Release Candidate; shipped: released in a game (named in `game`). */
  status: 'rc' | 'shipped' | null
  game: string | null
  tickets: ChangelogTicket[]
}

const VERSION = /\d+(?:\.\d+)+/
const NOT_A_GAME = [/^\d{1,2}\/\d{1,2}\/\d{2,4}$/, /^(android|ios|webgl|fbig|amazon|windows)$/i, /^\d+(\.\d+)+b?\d*$/i, /^release candidate$/i]

function ticketOf(li: Element): ChangelogTicket {
  // A plain link to /browse/KEY, or a Jira macro with a key parameter.
  const link = [...li.querySelectorAll('a')].find((a) => /\/browse\/[A-Z][A-Z0-9]+-\d+/.test(a.getAttribute('href') ?? ''))
  const macroKey = [...li.getElementsByTagName('ac:parameter')].find((p) => p.getAttribute('ac:name') === 'key')?.textContent
  const href = link?.getAttribute('href') ?? null
  const key = (href && /\/browse\/([A-Z][A-Z0-9]+-\d+)/.exec(href)?.[1]) || macroKey || null
  const title = (li.textContent ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\(TBA\)/gi, '')
    .trim()
    .replace(/[.;,]$/, '')
    .trim()
  return { key, title: title || key || '', url: href ? href.replace(/\?.*$/, '') : null }
}

export function parseChangelog(html: string): Map<string, ChangelogEntry> {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const out = new Map<string, ChangelogEntry>()
  for (const row of doc.querySelectorAll('tr')) {
    const cells = row.querySelectorAll(':scope > td, :scope > th')
    if (cells.length < 2) continue
    const head = cells[0]
    const heading = head.querySelector('h1, h2, h3, h4, h5, h6, a') ?? head
    const version = VERSION.exec(heading.textContent ?? '')?.[0]
    if (!version || out.has(version)) continue
    const text = (head.textContent ?? '').replace(/\s+/g, ' ')
    const rc = /release candidate/i.test(text)
    const game = rc
      ? null
      : ([...head.querySelectorAll('strong, b')].map((s) => (s.textContent ?? '').trim()).find((t) => t && !NOT_A_GAME.some((r) => r.test(t))) ?? null)
    const items = [...cells[1].querySelectorAll('li')].filter((li) => !li.parentElement?.closest('li'))
    out.set(version, {
      version,
      status: rc ? 'rc' : game ? 'shipped' : null,
      game,
      tickets: items.map(ticketOf).filter((t) => t.title)
    })
  }
  return out
}
