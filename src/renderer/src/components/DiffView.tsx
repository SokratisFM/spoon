import { useEffect, useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { DiffTarget } from '../../../shared/types'
import { useAsync } from '../hooks'
import { codeLineHeight, useSettings } from '../settings'

type LineKind = 'hunk' | 'add' | 'del' | 'ctx' | 'note'

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

interface Props {
  path: string
  target: DiffTarget | null
  /** Changes whenever the underlying files may have changed, forcing a reload. */
  nonce?: unknown
  hunkAction?: HunkAction
}

export function DiffView({ path, target, nonce, hunkAction }: Props) {
  const settings = useSettings()
  const lineH = codeLineHeight(settings)
  const key = target ? JSON.stringify(target) : ''
  const { data, error, loading } = useAsync(
    () => (target ? window.spoon.diff(path, target) : Promise.resolve(null)),
    [path, key, nonce]
  )
  const parsed = useMemo(() => (data && !data.binary ? parseDiff(data.text) : null), [data])
  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: parsed?.lines.length ?? 0,
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
    </div>
  )

  let body
  if (error) body = <div className="empty-state small error-text">{error}</div>
  else if (!data) body = loading ? <div className="empty-state small muted">Loading…</div> : null
  else if (data.binary) body = <div className="empty-state small muted">Binary file — no text diff.</div>
  else if (parsed && parsed.lines.length === 0)
    body = <div className="empty-state small muted">No content changes (mode or rename only).</div>
  else if (parsed)
    body = (
      <div className="diff-scroll" ref={parentRef}>
        <div
          className="diff-lines"
          style={{ height: virtualizer.getTotalSize(), minWidth: `calc(${parsed.maxLen + 2}ch + 8em)` }}
        >
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
