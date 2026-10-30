// What's New: Spoon's own CHANGELOG.md, bundled into the app. Each "## <version> — <date>" starts a
// version; each "- **New:** …" line is an item, its tag shown as a pill and the rest as Markdown.
import raw from '../../../CHANGELOG.md?raw'
import { inlineMarkdown } from './components/Markdown'

export type ChangeTag = 'new' | 'improved' | 'fixed'

export interface ChangeItem {
  tag: ChangeTag | null
  html: string
}

export interface ChangeVersion {
  /** null for a section without a version ("Earlier versions"). */
  version: string | null
  title: string
  date: string | null
  items: ChangeItem[]
}

export function parseChangelog(text: string): ChangeVersion[] {
  return text
    .split(/^## /m)
    .slice(1)
    .map((section) => {
      const [head, ...lines] = section.split('\n')
      const m = /^(\d+\.\d+\.\d+)\s*(?:[—–-]\s*(\S+))?/.exec(head.trim())
      const items: ChangeItem[] = []
      for (const line of lines) {
        if (/^\s*[-*] /.test(line)) {
          const body = line.replace(/^\s*[-*] /, '')
          const t = /^\*\*(New|Improved|Fixed):\*\*\s*/i.exec(body)
          items.push({ tag: t ? (t[1].toLowerCase() as ChangeTag) : null, html: inlineMarkdown(t ? body.slice(t[0].length) : body) })
        } else if (line.trim() && items.length) {
          // A wrapped line belongs to the item above it.
          const last = items[items.length - 1]
          last.html += ' ' + inlineMarkdown(line.trim())
        }
      }
      return { version: m?.[1] ?? null, title: head.trim(), date: m?.[2] ?? null, items }
    })
}

let parsed: ChangeVersion[] | null = null
export function changelog(): ChangeVersion[] {
  return (parsed ??= parseChangelog(raw))
}

/** a > b for x.y.z versions. */
export function newerVersion(a: string, b: string): boolean {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  return false
}
