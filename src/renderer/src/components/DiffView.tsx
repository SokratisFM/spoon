import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { DiffResult, DiffTarget } from '../../../shared/types'
import { useAsync, useCachedAsync, usePersistentState } from '../hooks'
import { contextMenu } from '../menus'
import { changedWords, detectLanguage, extensionOf, ideSchemes, LANGUAGES, paletteVars, tokenize, unityIds, unityPlace, type Token } from '../syntax'
import type { SyntaxPalette } from '../../../shared/types'
import { commitDiffCache } from '../repoCache'
import { codeLineHeight, getSettings, updateSettings, useSettings } from '../settings'

type LineKind = 'hunk' | 'add' | 'del' | 'ctx' | 'note'

const MAX_SPLIT_ROWS = 4000
/** Bigger diffs show uncolored: coloring them would hold up the window. */
const MAX_COLORED = 8000

export interface Line {
  kind: LineKind
  text: string
  oldNo?: number
  newNo?: number
  hunk?: number // index of the hunk, on 'hunk' lines
}

export interface HunkAction {
  label: string
  run: (hunkIndex: number, hunkHeader: string) => void
}

interface Parsed {
  lines: Line[]
  added: number
  removed: number
  maxLen: number
}

export function parseDiff(text: string): Parsed {
  const lines: Line[] = []
  let oldNo = 0
  let newNo = 0
  let added = 0
  let removed = 0
  let inHunk = false
  let maxLen = 0
  let hunks = 0

  for (const raw of text.split('\n')) {
    if (raw.startsWith('@@')) {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(raw)
      if (m) {
        oldNo = Number(m[1])
        newNo = Number(m[2])
        inHunk = true
        lines.push({ kind: 'hunk', text: raw, hunk: hunks++ })
        continue
      }
    }
    if (!inHunk) continue // file headers (diff --git, index, ---, +++)
    if (raw.startsWith('diff --git')) {
      inHunk = false
      continue
    }
    const text = raw.slice(1).replace(/\t/g, '    ')
    maxLen = Math.max(maxLen, text.length)
    if (raw[0] === '+') {
      lines.push({ kind: 'add', text, newNo: newNo++ })
      added++
    } else if (raw[0] === '-') {
      lines.push({ kind: 'del', text, oldNo: oldNo++ })
      removed++
    } else if (raw[0] === ' ') {
      lines.push({ kind: 'ctx', text, oldNo: oldNo++, newNo: newNo++ })
    } else if (raw[0] === '\\') {
      lines.push({ kind: 'note', text: raw.slice(2) })
    }
  }
  return { lines, added, removed, maxLen }
}

/** A row of the split view: indexes into the parsed lines for each side, or a full-width row. */
export type SplitRow = { full: number } | { left?: number; right?: number }

/**
 * Pairs lines for side-by-side display: context lines sit on both sides, a run of removed lines
 * lines up with the run of added lines that follows it, and hunk headers span both columns.
 */
export function pairLines(lines: Line[]): SplitRow[] {
  const rows: SplitRow[] = []
  let dels: number[] = []
  let adds: number[] = []
  const flush = (): void => {
    for (let i = 0; i < Math.max(dels.length, adds.length); i++) rows.push({ left: dels[i], right: adds[i] })
    dels = []
    adds = []
  }
  lines.forEach((l, i) => {
    if (l.kind === 'del') {
      if (adds.length) flush()
      dels.push(i)
    } else if (l.kind === 'add') adds.push(i)
    else {
      flush()
      rows.push(l.kind === 'ctx' ? { left: i, right: i } : { full: i })
    }
  })
  flush()
  return rows
}

/** One side of a split row: line number, sign and code, or an empty filler. */
export function SplitHalf({ line, side, code }: { line: Line | undefined; side: 'left' | 'right'; code?: ReactNode }) {
  if (!line) return <span className="half empty" />
  const no = side === 'left' ? line.oldNo : line.newNo
  return (
    <span className={`half ${line.kind}`}>
      <span className="ln">{no ?? ''}</span>
      <span className="sign">{line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ''}</span>
      <span className="code">{code ?? line.text}</span>
    </span>
  )
}

type Range = [number, number]

/**
 * A line of code with its colors: syntax tokens, the words that changed (on a changed line) and
 * faded Unity object ids, cut into spans wherever any of them starts or ends.
 */
export function CodeText({ text, tokens, words, faded }: { text: string; tokens?: Token[]; words?: Range[]; faded?: Range[] }) {
  if (!tokens && !words?.length && !faded?.length) return <>{text}</>
  const kinds: Array<{ from: number; to: number; kind: string | null }> = []
  let at = 0
  for (const t of tokens ?? [{ text, kind: null }]) {
    kinds.push({ from: at, to: at + t.text.length, kind: t.kind })
    at += t.text.length
  }
  const cuts = new Set<number>([0, text.length])
  kinds.forEach((k) => (cuts.add(k.from), cuts.add(k.to)))
  for (const [a, b] of [...(words ?? []), ...(faded ?? [])]) cuts.add(a), cuts.add(b)
  const points = [...cuts].filter((p) => p <= text.length).sort((a, b) => a - b)
  const inside = (list: Range[] | undefined, p: number): boolean => !!list?.some(([a, b]) => p >= a && p < b)
  const out: ReactNode[] = []
  let k = 0
  for (let i = 0; i < points.length - 1; i++) {
    const [from, to] = [points[i], points[i + 1]]
    if (from === to) continue
    while (k < kinds.length - 1 && kinds[k].to <= from) k++
    const cls = [
      kinds[k]?.kind ? `t-${kinds[k].kind}` : '',
      inside(words, from) ? 'w-changed' : '',
      inside(faded, from) ? 'u-id' : ''
    ]
      .filter(Boolean)
      .join(' ')
    out.push(
      cls ? (
        <span key={from} className={cls}>
          {text.slice(from, to)}
        </span>
      ) : (
        text.slice(from, to)
      )
    )
  }
  return <>{out}</>
}

/** The language chip in a diff's header: what was detected, and a menu to pick another. */
function LanguageChip(p: { ext: string; lang: string | null; detected: string | null; chosen: boolean; onPick: (choice: string) => void }) {
  const { ext, lang, detected, chosen, onPick } = p
  const label = (id: string | null): string => (id ? (LANGUAGES.find(([x]) => x === id)?.[1] ?? id) : 'Plain text')
  return (
    <button
      className="lang-chip"
      title={`Colored as ${label(lang)}. Click to choose another language for .${ext} files.`}
      onClick={async () => {
        const choice = await contextMenu([
          { label: `Language for .${ext} files`, enabled: false },
          { id: 'auto', label: `Detect automatically (${label(detected)})`, kind: 'checkbox', checked: !chosen },
          { separator: true },
          ...LANGUAGES.map(([id, name]) => ({ id, label: name, kind: 'checkbox' as const, checked: chosen && lang === id })),
          { separator: true },
          { id: 'plain', label: 'Plain text', kind: 'checkbox', checked: chosen && !lang }
        ])
        if (choice) onPick(choice)
      }}
    >
      {label(lang)}
    </button>
  )
}

export function DiffLayoutToggle() {
  const { diffLayout } = useSettings()
  return (
    <span className="layout-toggle" role="group" aria-label="Diff layout">
      {(
        [
          ['unified', 'Unified'],
          ['split', 'Split']
        ] as const
      ).map(([id, label]) => (
        <button key={id} className={diffLayout === id ? 'on' : ''} onClick={() => updateSettings({ diffLayout: id })}>
          {label}
        </button>
      ))}
    </span>
  )
}

interface Props {
  path: string
  target: DiffTarget | null
  /** Changes whenever the underlying files may have changed, forcing a reload. */
  nonce?: unknown
  hunkAction?: HunkAction
}

// Parsed lines of cached diffs, so showing a commit's file again doesn't parse it again.
const parsedDiffs = new WeakMap<DiffResult, ReturnType<typeof parseDiff>>()

export function DiffView({ path, target, nonce, hunkAction }: Props) {
  const settings = useSettings()
  const lineH = codeLineHeight(settings)
  const key = target ? JSON.stringify(target) : ''
  // A commit's diff never changes, so it's cached; working-tree diffs reload on every refresh.
  const isCommit = target?.kind === 'commit'
  const live = useAsync(
    () => (target && !isCommit ? window.spoon.diff(path, target) : Promise.resolve(null)),
    [path, key, isCommit ? null : nonce]
  )
  const cached = useCachedAsync(commitDiffCache, isCommit ? `${path}|${key}` : null, () => window.spoon.diff(path, target!))
  const { data, error, loading } = isCommit ? cached : live
  // An unchanged diff keeps its parsed lines, so nothing below re-renders.
  const lastParsed = useRef<{ text: string; parsed: ReturnType<typeof parseDiff> } | null>(null)
  const parsed = useMemo(() => {
    if (!data || data.binary) return null
    const known = parsedDiffs.get(data)
    if (known) return known
    const next = lastParsed.current?.text === data.text ? lastParsed.current.parsed : parseDiff(data.text)
    lastParsed.current = { text: data.text, parsed: next }
    parsedDiffs.set(data, next)
    return next
  }, [data])
  // Split view wraps long lines so both sides stay visible; wrapped rows have varying heights, so it
  // isn't virtualized and very large diffs fall back to the unified view.
  const rows = useMemo(() => (parsed && settings.diffLayout === 'split' ? pairLines(parsed.lines) : null), [parsed, settings.diffLayout])
  const split = !!rows && rows.length <= MAX_SPLIT_ROWS
  const parentRef = useRef<HTMLDivElement>(null)

  // Syntax colors: the language from the file's extension (or the one picked for that extension).
  const filePath = target?.file.path ?? ''
  const ext = extensionOf(filePath)
  const [langChoice, setLangChoice] = usePersistentState<Record<string, string>>('spoon.diff.langs', {})
  const sample = useMemo(() => (parsed ? parsed.lines.slice(0, 8).map((l) => l.text).join('\n') : ''), [parsed])
  const detected = filePath ? detectLanguage(filePath, sample) : null
  const chosen = langChoice[ext]
  const lang = chosen === 'plain' ? null : (chosen ?? detected)
  const syntaxOn = settings.diffSyntax !== 'off' && !!lang
  const pickLanguage = (choice: string): void => {
    const next = { ...langChoice }
    if (choice === 'auto') delete next[ext]
    else next[ext] = choice
    setLangChoice(next)
  }
  // The tokens arrive a moment after the lines (a grammar loads on first use); until then lines are plain.
  // Old and new lines are colored as two separate texts, so a line is read in the context around it.
  const [colored, setColored] = useState<{ parsed: Parsed; lang: string; tokens: (Token[] | undefined)[] } | null>(null)
  useEffect(() => {
    if (!parsed || !lang || !syntaxOn || parsed.lines.length > MAX_COLORED) return
    let live = true
    const oldSide: number[] = []
    const newSide: number[] = []
    parsed.lines.forEach((l, i) => {
      if (l.kind === 'ctx' || l.kind === 'del') oldSide.push(i)
      if (l.kind === 'ctx' || l.kind === 'add') newSide.push(i)
    })
    const text = (side: number[]): string[] => side.map((i) => parsed.lines[i].text)
    Promise.all([tokenize(text(oldSide), lang), tokenize(text(newSide), lang)])
      .then(([o, n]) => {
        if (!live) return
        const tokens: (Token[] | undefined)[] = []
        oldSide.forEach((li, k) => (tokens[li] = o[k]))
        newSide.forEach((li, k) => (tokens[li] = n[k]))
        setColored({ parsed, lang, tokens })
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [parsed, lang, syntaxOn])
  const tokens = syntaxOn && colored && colored.parsed === parsed && colored.lang === lang ? colored.tokens : null

  // The words that changed between a removed line and the added line it pairs with.
  const words = useMemo(() => {
    if (!parsed || !settings.diffWordChanges || parsed.lines.length > MAX_COLORED) return null
    const marks: (Range[] | undefined)[] = []
    for (const row of pairLines(parsed.lines)) {
      if ('full' in row || row.left === undefined || row.right === undefined) continue
      const [a, b] = [parsed.lines[row.left], parsed.lines[row.right]]
      if (a.kind !== 'del' || b.kind !== 'add') continue
      ;[marks[row.left], marks[row.right]] = changedWords(a.text, b.text)
    }
    return marks
  }, [parsed, settings.diffWordChanges])

  // Unity scenes and prefabs: which GameObject and component each hunk is in, read from the whole file.
  const [places, setPlaces] = useState<{ parsed: Parsed; byHunk: Map<number, string> } | null>(null)
  useEffect(() => {
    if (lang !== 'unity' || !parsed || !target) return
    let live = true
    window.spoon
      .diffFile(path, target)
      .then((f) => {
        if (!live || !f) return
        const fileLines = f.text.split('\n')
        const byHunk = new Map<number, string>()
        let hunk = -1
        for (const l of parsed.lines) {
          if (l.kind === 'hunk') hunk = l.hunk!
          else if (hunk >= 0 && !byHunk.has(hunk) && (l.kind === 'add' || l.kind === 'del')) {
            const no = f.side === 'new' ? (l.newNo ?? l.oldNo) : l.oldNo
            const place = no ? unityPlace(fileLines, no) : null
            byHunk.set(hunk, place ?? '')
          }
        }
        setPlaces({ parsed, byHunk })
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed, lang, path, key])
  const placeOf = (l: Line): string | undefined =>
    places && places.parsed === parsed && l.hunk !== undefined ? places.byHunk.get(l.hunk) || undefined : undefined

  // An IDE scheme not chosen yet is offered once, on a colored diff: use it, try it here, or not now.
  const [offer, setOffer] = useState<SyntaxPalette | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const offering = syntaxOn && !settings.syntaxPalette
  useEffect(() => {
    if (!offering) return
    let live = true
    ideSchemes().then((list) => {
      if (!live) return
      setOffer(list.find((p) => p.active && !getSettings().syntaxOffersDismissed.includes(p.id)) ?? null)
    })
    return () => {
      live = false
    }
  }, [offering])
  const shownOffer = offering && offer && !settings.syntaxOffersDismissed.includes(offer.id) ? offer : null
  const palette = settings.syntaxPalette ?? (previewing && shownOffer ? shownOffer : null)
  const ideName = (p: SyntaxPalette): string => ({ rider: 'Rider', vscode: 'VS Code', cursor: 'Cursor', file: 'The file' })[p.source]

  const code = (l: Line, i: number): ReactNode => (
    <CodeText text={l.text} tokens={tokens?.[i]} words={words?.[i]} faded={lang === 'unity' ? unityIds(l.text) : undefined} />
  )
  const hunkText = (l: Line): ReactNode => {
    const place = placeOf(l)
    if (!place) return l.text
    return (
      <>
        {/^@@[^@]*@@/.exec(l.text)?.[0] ?? l.text} <span className="hunk-place">{place}</span>
      </>
    )
  }

  const virtualizer = useVirtualizer({
    count: split ? 0 : (parsed?.lines.length ?? 0),
    getScrollElement: () => parentRef.current,
    estimateSize: () => lineH,
    overscan: 30
  })

  useEffect(() => {
    virtualizer.measure()
  }, [lineH, virtualizer])

  useEffect(() => {
    parentRef.current?.scrollTo({ top: 0, left: 0 })
  }, [key])

  if (!target) return <div className="diff empty-state muted">Select a file to see its changes.</div>

  const file = target.file
  const header = (
    <div className="diff-header">
      <span className="diff-path" title={file.path}>
        {file.oldPath && <span className="muted">{file.oldPath} → </span>}
        {file.path}
      </span>
      {parsed && (
        <span className="diff-stats">
          <span className="plus">+{parsed.added}</span>
          <span className="minus">−{parsed.removed}</span>
        </span>
      )}
      {parsed && !data?.binary && (
        <LanguageChip ext={ext} lang={lang} detected={detected} chosen={chosen !== undefined} onPick={pickLanguage} />
      )}
      <DiffLayoutToggle />
    </div>
  )

  let body
  if (error) body = <div className="empty-state small error-text">{error}</div>
  else if (!data) body = loading ? <div className="empty-state small muted">Loading…</div> : null
  else if (data.binary) body = <div className="empty-state small muted">Binary file — no text diff.</div>
  else if (parsed && parsed.lines.length === 0)
    body = <div className="empty-state small muted">No content changes (mode or rename only).</div>
  else if (parsed && split && rows)
    body = (
      <div className="diff-scroll" ref={parentRef}>
        <div className={`diff-lines side-by-side syntax-${settings.diffSyntax}`}>
          {rows.map((row, i) => {
            if ('full' in row) {
              const l = parsed.lines[row.full]
              return (
                <div key={i} className={`diff-line ${l.kind}`}>
                  <span className="code">{l.kind === 'hunk' ? hunkText(l) : code(l, row.full)}</span>
                  {l.kind === 'hunk' && hunkAction && !data.truncated && (
                    <button className="hunk-btn" onClick={() => hunkAction.run(l.hunk!, l.text)}>
                      {hunkAction.label}
                    </button>
                  )}
                </div>
              )
            }
            return (
              <div key={i} className="diff-line split-row">
                <SplitHalf
                  line={row.left !== undefined ? parsed.lines[row.left] : undefined}
                  side="left"
                  code={row.left !== undefined ? code(parsed.lines[row.left], row.left) : undefined}
                />
                <SplitHalf
                  line={row.right !== undefined ? parsed.lines[row.right] : undefined}
                  side="right"
                  code={row.right !== undefined ? code(parsed.lines[row.right], row.right) : undefined}
                />
              </div>
            )
          })}
        </div>
        {data.truncated && <div className="list-footnote">Diff truncated — file is too large to show in full.</div>}
      </div>
    )
  else if (parsed)
    body = (
      <div className="diff-scroll" ref={parentRef}>
        {rows && !split && (
          <div className="list-footnote">This diff is too large for side by side; showing it unified.</div>
        )}
        <div className={`diff-lines syntax-${settings.diffSyntax}`} style={{ height: virtualizer.getTotalSize(), minWidth: `calc(${parsed.maxLen + 2}ch + 12em)` }}>
          {virtualizer.getVirtualItems().map((v) => {
            const l = parsed.lines[v.index]
            return (
              <div
                key={v.index}
                className={`diff-line ${l.kind}`}
                style={{ transform: `translateY(${v.start}px)`, height: lineH, lineHeight: `${lineH}px` }}
              >
                <span className="ln">{l.oldNo ?? ''}</span>
                <span className="ln">{l.newNo ?? ''}</span>
                <span className="sign">{l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ''}</span>
                <span className="code">{l.kind === 'hunk' ? hunkText(l) : l.kind === 'note' ? l.text : code(l, v.index)}</span>
                {l.kind === 'hunk' && hunkAction && !data.truncated && (
                  <button className="hunk-btn" onClick={() => hunkAction.run(l.hunk!, l.text)}>
                    {hunkAction.label}
                  </button>
                )}
              </div>
            )
          })}
        </div>
        {data.truncated && <div className="list-footnote">Diff truncated — file is too large to show in full.</div>}
      </div>
    )

  return (
    <div className="diff" style={paletteVars(palette, settings.syntaxIdeBackground || previewing)}>
      {header}
      {shownOffer && (
        <div className="syn-offer">
          <span>
            {ideName(shownOffer)} uses <b>{shownOffer.name}</b>. Color diffs the same way?
          </span>
          <button className="btn primary" onClick={() => updateSettings({ syntaxPalette: shownOffer })}>
            Use {ideName(shownOffer)}’s colors
          </button>
          <button className="btn" onClick={() => setPreviewing((p) => !p)}>
            {previewing ? 'Stop preview' : 'Preview'}
          </button>
          <button
            className="btn"
            onClick={() => {
              setPreviewing(false)
              updateSettings({ syntaxOffersDismissed: [...settings.syntaxOffersDismissed, shownOffer.id] })
            }}
          >
            Not now
          </button>
        </div>
      )}
      {body}
    </div>
  )
}
