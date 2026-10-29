// Settings search: every option on every tab, filtered as you type. An option is any element
// directly inside a tab's page; it matches when each word of the query is in its text (label,
// hint, choices) or in the extra words below, which catch what people might call it.

/** Extra search words, by a phrase in the option's own text. */
const RELATED: [string, string][] = [
  ['interface size', 'font zoom scale text bigger smaller ui'],
  ['diff font size', 'font code text size monospace'],
  ['row spacing', 'density compact spacious height rows'],
  ['popups open', 'dialogs modal position top middle center window'],
  ['diff layout', 'split side by side unified'],
  ['syntax colors in diffs', 'highlighting language code colours subtle'],
  ['syntax colors from', 'ide rider vscode vs code cursor scheme import theme colours'],
  ['words that changed', 'word diff inline changes highlight'],
  ['tags in the commit list', 'labels tag diamond'],
  ['squish branches', 'squash collapse fold hide commits compact history'],
  ['branch labels like their graph line', 'lane colours colors'],
  ['playful toolbar', 'fun dog rope animation fetch pull push'],
  ['remote’s name', 'origin cloud'],
  ['branch spotlight', 'highlight lane focus dim fade'],
  ['fade the commits', 'dim spotlight highlight'],
  ['checked-out commit', 'head current highlight'],
  ['submodule tabs', 'submodules tabs grouped'],
  ['sidebar', 'sections hide reorder stashes stale behind branches tags remotes'],
  ['branch colors', 'reserved prefix candidates colours graph'],
  ['pull request list', 'pr prs github review awaiting'],
  ['theme', 'dark light mode appearance colors colours discord custom'],
  ['color commits by author', 'authors people colours'],
  ['github', 'account login sign in token pull requests pr'],
  ['jira', 'tickets issues atlassian keys'],
  ['claude', 'ai review assistant agent'],
  ['mainlib', 'submodule update changelog confluence version'],
  ['atlassian', 'confluence token jira account'],
  ['updates', 'version upgrade release install'],
  ['search for repositories', 'scan folder projects find'],
  ['your projects', 'recent list forget remove']
]

const label = (el: Element): string =>
  (el.querySelector('.field-label, label, b, h4')?.textContent ?? el.textContent ?? '').trim().replace(/[:(].*$/, '').trim()

function relatedOf(text: string, el: Element): string {
  const words = RELATED.filter(([phrase]) => text.includes(phrase)).map(([, w]) => w)
  if (el.querySelector('kbd')) words.push('shortcut keybind key')
  return words.join(' ')
}

/** How many single-letter edits turn a into b. */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = cur
    }
  }
  return row[b.length]
}

export interface SearchResult {
  counts: Record<string, number>
  total: number
  /** Close matches when nothing matched: option labels. */
  suggestions: string[]
}

/** Hides the options under root that don't match, notes why the others did, and counts them per tab. */
export function filterOptions(root: HTMLElement, query: string): SearchResult {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  const counts: Record<string, number> = {}
  const near: { label: string; score: number }[] = []
  let total = 0
  for (const group of Array.from(root.querySelectorAll<HTMLElement>('.search-group'))) {
    let n = 0
    for (const el of Array.from(group.querySelector('.search-opts')?.children ?? [])) {
      const text = (el.textContent ?? '').toLowerCase()
      if (!text.trim()) {
        el.classList.add('search-miss')
        continue
      }
      const related = relatedOf(text, el)
      const hay = `${text} ${related}`
      const hit = tokens.every((t) => hay.includes(t))
      el.classList.toggle('search-miss', !hit)
      // Found only through a related word: say which.
      const via = hit ? tokens.filter((t) => !text.includes(t)).map((t) => related.split(' ').find((w) => w.includes(t)) ?? t) : []
      if (via.length) el.setAttribute('data-why', `· ${via.join(', ')}`)
      else el.removeAttribute('data-why')
      if (hit) n++
      else {
        const words = `${label(el)} ${related}`.toLowerCase().split(/\W+/).filter((w) => w.length > 2)
        const score = tokens.reduce((sum, t) => sum + Math.min(...words.map((w) => distance(t, w.slice(0, t.length + 1)))), 0)
        near.push({ label: label(el), score })
      }
    }
    group.classList.toggle('search-empty', n === 0)
    counts[group.dataset.tab ?? ''] = n
    total += n
  }
  const limit = Math.max(1, Math.round(query.length / 4))
  const suggestions = total
    ? []
    : [...new Map(near.filter((x) => x.label && x.score <= limit).sort((a, b) => a.score - b.score).map((x) => [x.label, x])).keys()].slice(0, 3)
  return { counts, total, suggestions }
}

/** Puts every option back (when the search is cleared). */
export function clearFilter(root: HTMLElement): void {
  root.querySelectorAll('.search-miss').forEach((el) => el.classList.remove('search-miss'))
  root.querySelectorAll('[data-why]').forEach((el) => el.removeAttribute('data-why'))
}
