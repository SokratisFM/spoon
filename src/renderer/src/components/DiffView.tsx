import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { DiffResult, DiffTarget } from '../../../shared/types'
import { useAsync, useCachedAsync, usePersistentState } from '../hooks'
import { contextMenu } from '../menus'
import { changedWords, colorRuns, detectLanguage, extensionOf, ideSchemes, LANGUAGES, paletteVars, unityIds, unityPlaces, type Token } from '../syntax'
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

// Syntax tokens per parsed diff and language (filled in as coloring goes), so showing a diff again
// doesn't color it again.
const coloredDiffs = new WeakMap<Parsed, Map<string, { tokens: (Token[] | undefined)[]; done: boolean }>>()

const sign = (l: Line): string => (l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : '')

/** A hunk header: git's line, or the place in a Unity file the hunk is in. */
function HunkText({ text, place }: { text: string; place?: string }) {
  if (!place) return <>{text}</>
  return (
    <>
      {/^@@[^@]*@@/.exec(text)?.[0] ?? text} <span className="hunk-place">{place}</span>
    </>
  )
}

interface LineLook {
  tokens?: Token[]
  words?: Range[]
  faded?: Range[]
}

/** One row of the unified view. Memoized: scrolling and coloring only redraw rows that changed. */
const UnifiedRow = memo(function UnifiedRow(p: {
  line: Line
  top: number
  lineH: number
  tokens?: Token[]
  words?: Range[]
  faded?: Range[]
  place?: string
  actionLabel?: string
  onAction?: (hunk: number, header: string) => void
}) {
  const l = p.line
  return (
    <div className={`diff-line ${l.kind}`} style={{ transform: `translateY(${p.top}px)`, height: p.lineH, lineHeight: `${p.lineH}px` }}>
      <span className="ln">{l.oldNo ?? ''}</span>
      <span className="ln">{l.newNo ?? ''}</span>
      <span className="sign">{sign(l)}</span>
      <span className="code">
        {l.kind === 'hunk' ? (
          <HunkText text={l.text} place={p.place} />
        ) : l.kind === 'note' ? (
          l.text
        ) : (
          <CodeText text={l.text} tokens={p.tokens} words={p.words} faded={p.faded} />
        )}
      </span>
      {l.kind === 'hunk' && p.onAction && (
        <button className="hunk-btn" onClick={() => p.onAction!(l.hunk!, l.text)}>
          {p.actionLabel}
        </button>
      )}
    </div>
  )
})

/** A full-width row of the split view (hunk headers and notes). */
const SplitFullRow = memo(function SplitFullRow(p: {
  line: Line
  place?: string
  actionLabel?: string
  onAction?: (hunk: number, header: string) => void
}) {
  const l = p.line
  return (
    <div className={`diff-line ${l.kind}`}>
      <span className="code">{l.kind === 'hunk' ? <HunkText text={l.text} place={p.place} /> : l.text}</span>
      {l.kind === 'hunk' && p.onAction && (
        <button className="hunk-btn" onClick={() => p.onAction!(l.hunk!, l.text)}>
          {p.actionLabel}
        </button>
      )}
    </div>
  )
})

/** A two-sided row of the split view. Memoized like the unified rows. */
const SplitPairRow = memo(function SplitPairRow(p: {
  left?: Line
  right?: Line
  lt?: Token[]
  lw?: Range[]
  lf?: Range[]
  rt?: Token[]
  rw?: Range[]
  rf?: Range[]
}) {
  return (
    <div className="diff-line split-row">
      <SplitHalf line={p.left} side="left" code={p.left ? <CodeText text={p.left.text} tokens={p.lt} words={p.lw} faded={p.lf} /> : undefined} />
      <SplitHalf line={p.right} side="right" code={p.right ? <CodeText text={p.right.text} tokens={p.rt} words={p.rw} faded={p.rf} /> : undefined} />
    </div>
  )
})

// Parsed lines of cached diffs, so showing a commit's file again doesn't parse it again.
const parsedDiffs = new WeakMap<DiffResult, ReturnType<typeof parseDiff>>()

export function DiffView({ path, target, nonce, hunkAction }: Props) {
  const settings = useSettings()
  const lineH = codeLineHeight(settings)
  const key = target ? JSON.stringify(target) : ''
  // A commit's diff never changes, so it's cached; working-tree diffs reload on every refresh.
  const isCommit = target?.kind === 'commit'
  // Each result says which file it's for: while another file loads, the previous one's diff (and its
  // hunk buttons, which would act on the new file) isn't shown. A refresh of the same file keeps it.
  const liveFor = `${path}|${key}`
  const loaded = useAsync(
    () => (target && !isCommit ? window.spoon.diff(path, target).then((d) => ({ for: liveFor, d })) : Promise.resolve(null)),
    [path, key, isCommit ? null : nonce]
  )
  const current = loaded.data?.for === liveFor
  const live = {
    data: current ? loaded.data!.d : null,
    error: current || !loaded.loading ? loaded.error : null,
    loading: loaded.loading && !current
  }
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
  // Syntax colors arrive after the lines, hunk by hunk (a grammar loads on first use); until then
  // lines are plain. Each hunk's old and new side is colored on its own.
  const [, setColorTick] = useState(0)
  useEffect(() => {
    if (!parsed || !lang || !syntaxOn || parsed.lines.length > MAX_COLORED) return
    const byLang = coloredDiffs.get(parsed) ?? new Map()
    coloredDiffs.set(parsed, byLang)
    if (byLang.get(lang)?.done) return
    const entry = { tokens: [] as (Token[] | undefined)[], done: false }
    byLang.set(lang, entry)
    const runs: number[][] = []
    let oldRun: number[] = []
    let newRun: number[] = []
    const flush = (): void => {
      if (oldRun.length) runs.push(oldRun)
      if (newRun.length) runs.push(newRun)
      oldRun = []
      newRun = []
    }
    parsed.lines.forEach((l, i) => {
      if (l.kind === 'hunk') flush()
      if (l.kind === 'ctx' || l.kind === 'del') oldRun.push(i)
      if (l.kind === 'ctx' || l.kind === 'add') newRun.push(i)
    })
    flush()
    let cancelled = false
    let shown = 0
    colorRuns(
      runs.map((run) => run.map((i) => parsed.lines[i].text)),
      lang,
      (r, toks) => {
        runs[r].forEach((li, k) => (entry.tokens[li] = toks[k]))
        const now = performance.now()
        if (now - shown > 80) {
          shown = now
          setColorTick((t) => t + 1)
        }
      },
      () => cancelled
    )
      .then(() => {
        if (cancelled) return
        entry.done = true
        setColorTick((t) => t + 1)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
      if (!entry.done) byLang.delete(lang)
    }
  }, [parsed, lang, syntaxOn])
  const tokens = parsed && lang && syntaxOn ? coloredDiffs.get(parsed)?.get(lang)?.tokens : undefined

  // The words that changed between a removed line and the added line it pairs with, worked out
  // only for the rows being drawn, and kept.
  const partner = useMemo(() => {
    if (!parsed) return null
    const map = new Map<number, number>()
    for (const row of pairLines(parsed.lines)) {
      if ('full' in row || row.left === undefined || row.right === undefined) continue
      if (parsed.lines[row.left].kind !== 'del' || parsed.lines[row.right].kind !== 'add') continue
      map.set(row.left, row.right)
      map.set(row.right, row.left)
    }
    return map
  }, [parsed])
  const looks = useMemo(() => ({ words: new Map<number, Range[]>(), faded: new Map<number, Range[]>() }), [parsed])
  const wordsAt = (i: number): Range[] | undefined => {
    if (!settings.diffWordChanges || !parsed || !partner?.has(i)) return undefined
    const known = looks.words.get(i)
    if (known) return known
    const j = partner.get(i)!
    const [del, add] = parsed.lines[i].kind === 'del' ? [i, j] : [j, i]
    const [a, b] = changedWords(parsed.lines[del].text, parsed.lines[add].text)
    looks.words.set(del, a)
    looks.words.set(add, b)
    return looks.words.get(i)
  }
  const fadedAt = (i: number): Range[] | undefined => {
    if (lang !== 'unity' || !parsed) return undefined
    let f = looks.faded.get(i)
    if (!f) looks.faded.set(i, (f = unityIds(parsed.lines[i].text)))
    return f.length ? f : undefined
  }
  const look = (i: number): LineLook => ({ tokens: tokens?.[i], words: wordsAt(i), faded: fadedAt(i) })

  // Unity scenes and prefabs: which GameObject and component each hunk is in, read from the whole file.
  const [places, setPlaces] = useState<{ parsed: Parsed; byHunk: Map<number, string> } | null>(null)
  useEffect(() => {
    if (lang !== 'unity' || !parsed || !target) return
    let live = true
    window.spoon
      .diffFile(path, target)
      .then((f) => {
        if (!live || !f) return
        const placeOfLine = unityPlaces(f.text)
        const byHunk = new Map<number, string>()
        let hunk = -1
        for (const l of parsed.lines) {
          if (l.kind === 'hunk') hunk = l.hunk!
          else if (hunk >= 0 && !byHunk.has(hunk) && (l.kind === 'add' || l.kind === 'del')) {
            const no = f.side === 'new' ? (l.newNo ?? l.oldNo) : l.oldNo
            byHunk.set(hunk, (no ? placeOfLine(no) : null) ?? '')
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

  // The hunk button's handler stays the same function, so memoized rows don't redraw for it.
  const actionRef = useRef(hunkAction)
  actionRef.current = hunkAction
  const onAction = useCallback((hunk: number, header: string) => actionRef.current?.run(hunk, header), [])

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
      <span className="diff-path" title={target.kind === 'text' ? undefined : file.path}>
        {target.kind === 'text' ? (
          <>
            <span className="muted">From → </span>To
          </>
        ) : (
          <>
            {file.oldPath && <span className="muted">{file.oldPath} → </span>}
            {file.path}
          </>
        )}
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
    body = (
      <div className="empty-state small muted">
        {target.kind === 'files' ? 'The two files are identical.' : 'No content changes (mode or rename only).'}
      </div>
    )
  else if (parsed && split && rows)
    body = (
      <div className="diff-scroll" ref={parentRef}>
        <div className={`diff-lines side-by-side syntax-${settings.diffSyntax}`}>
          {rows.map((row, i) => {
            if ('full' in row) {
              const l = parsed.lines[row.full]
              return (
                <SplitFullRow
                  key={i}
                  line={l}
                  place={placeOf(l)}
                  actionLabel={hunkAction?.label}
                  onAction={hunkAction && !data.truncated ? onAction : undefined}
                />
              )
            }
            const [L, R] = [row.left !== undefined ? look(row.left) : null, row.right !== undefined ? look(row.right) : null]
            return (
              <SplitPairRow
                key={i}
                left={row.left !== undefined ? parsed.lines[row.left] : undefined}
                right={row.right !== undefined ? parsed.lines[row.right] : undefined}
                lt={L?.tokens}
                lw={L?.words}
                lf={L?.faded}
                rt={R?.tokens}
                rw={R?.words}
                rf={R?.faded}
              />
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
            const lk = l.kind === 'hunk' || l.kind === 'note' ? null : look(v.index)
            return (
              <UnifiedRow
                key={v.index}
                line={l}
                top={v.start}
                lineH={lineH}
                tokens={lk?.tokens}
                words={lk?.words}
                faded={lk?.faded}
                place={l.kind === 'hunk' ? placeOf(l) : undefined}
                actionLabel={hunkAction?.label}
                onAction={hunkAction && !data.truncated ? onAction : undefined}
              />
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
