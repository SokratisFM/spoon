import { useEffect, useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { DiffResult, DiffTarget } from '../../../shared/types'
import { useAsync, useCachedAsync } from '../hooks'
import { commitDiffCache } from '../repoCache'
import { codeLineHeight, updateSettings, useSettings } from '../settings'

type LineKind = 'hunk' | 'add' | 'del' | 'ctx' | 'note'

const MAX_SPLIT_ROWS = 4000

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
export function SplitHalf({ line, side }: { line: Line | undefined; side: 'left' | 'right' }) {
  if (!line) return <span className="half empty" />
  const no = side === 'left' ? line.oldNo : line.newNo
  return (
    <span className={`half ${line.kind}`}>
      <span className="ln">{no ?? ''}</span>
      <span className="sign">{line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ''}</span>
      <span className="code">{line.text}</span>
    </span>
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
        <div className="diff-lines side-by-side">
          {rows.map((row, i) => {
            if ('full' in row) {
              const l = parsed.lines[row.full]
              return (
                <div key={i} className={`diff-line ${l.kind}`}>
                  <span className="code">{l.text}</span>
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
                <SplitHalf line={row.left !== undefined ? parsed.lines[row.left] : undefined} side="left" />
                <SplitHalf line={row.right !== undefined ? parsed.lines[row.right] : undefined} side="right" />
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
        <div className="diff-lines" style={{ height: virtualizer.getTotalSize(), minWidth: `calc(${parsed.maxLen + 2}ch + 8em)` }}>
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
                <span className="code">{l.text}</span>
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
    <div className="diff">
      {header}
      {body}
    </div>
  )
}
