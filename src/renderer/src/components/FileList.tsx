import { useEffect, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { FileChange } from '../../../shared/types'
import { splitPath } from '../format'
import { rowHeight, useSettings } from '../settings'

const STATUS_LABEL: Record<string, string> = {
  A: 'Added',
  M: 'Modified',
  D: 'Deleted',
  R: 'Renamed',
  C: 'Copied',
  T: 'Type changed',
  U: 'Conflicted',
  '?': 'Untracked'
}

interface Props {
  files: FileChange[]
  /** Selected paths. ⌘-click toggles, ⇧-click selects a range. */
  selected: Set<string>
  /** The file whose diff is shown: the one clicked last. */
  focused: string | null
  onSelect: (selected: Set<string>, focused: FileChange) => void
  /** Double-click or Enter, e.g. stage/unstage. */
  onActivate?: (files: FileChange[]) => void
  onContextMenu?: (files: FileChange[]) => void
  emptyText: string
}

export function FileList({ files, selected, focused, onSelect, onActivate, onContextMenu, emptyText }: Props) {
  const settings = useSettings()
  const rowH = Math.round(rowHeight(settings) * 0.92)
  const parentRef = useRef<HTMLDivElement>(null)
  const anchor = useRef<number>(0)
  const virtualizer = useVirtualizer({
    count: files.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowH,
    overscan: 10
  })

  useEffect(() => {
    virtualizer.measure()
  }, [rowH, virtualizer])

  const selectedFiles = (): FileChange[] => files.filter((f) => selected.has(f.path))

  const click = (index: number, e: React.MouseEvent): void => {
    const f = files[index]
    if (e.shiftKey) {
      const [a, b] = [Math.min(anchor.current, index), Math.max(anchor.current, index)]
      onSelect(new Set(files.slice(a, b + 1).map((x) => x.path)), f)
      return
    }
    anchor.current = index
    if (e.metaKey || e.ctrlKey) {
      const next = new Set(selected)
      if (next.has(f.path)) next.delete(f.path)
      else next.add(f.path)
      onSelect(next, f)
    } else if (!(e.button === 2 && selected.has(f.path))) {
      onSelect(new Set([f.path]), f)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && onActivate) {
      e.preventDefault()
      const sel = selectedFiles()
      if (sel.length) onActivate(sel)
      return
    }
    if (e.key === 'a' && e.metaKey && files.length) {
      e.preventDefault()
      onSelect(new Set(files.map((f) => f.path)), files.find((f) => f.path === focused) ?? files[0])
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const pos = files.findIndex((f) => f.path === focused)
    const next = Math.max(0, Math.min(files.length - 1, pos + (e.key === 'ArrowDown' ? 1 : -1)))
    if (!files[next]) return
    anchor.current = next
    onSelect(new Set([files[next].path]), files[next])
    virtualizer.scrollToIndex(next)
  }

  if (files.length === 0) return <div className="empty-state small muted">{emptyText}</div>

  return (
    <div className="file-list" ref={parentRef} tabIndex={0} onKeyDown={onKeyDown}>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((v) => {
          const f = files[v.index]
          const { dir, name } = splitPath(f.path)
          const status = f.status === '?' ? 'A' : f.status
          return (
            <div
              key={`${f.status}:${f.path}`}
              className={`file-row ${selected.has(f.path) ? 'selected' : ''} ${f.path === focused ? 'focused' : ''}`}
              style={{ transform: `translateY(${v.start}px)`, height: rowH }}
              onMouseDown={(e) => click(v.index, e)}
              onDoubleClick={() => onActivate?.([f])}
              onContextMenu={(e) => {
                e.preventDefault()
                onContextMenu?.(selected.has(f.path) ? selectedFiles() : [f])
              }}
              title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}
            >
              <span className={`status status-${status}`} title={STATUS_LABEL[f.status]}>
                {f.status === '?' ? '+' : f.status}
              </span>
              <span className="file-name">{name}</span>
              <span className="file-dir">{dir.replace(/\/$/, '')}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function sameFile(a: FileChange | null, b: FileChange): boolean {
  return !!a && a.path === b.path && a.status === b.status
}
