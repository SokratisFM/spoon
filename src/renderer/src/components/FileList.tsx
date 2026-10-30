import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { FileChange, FileStatus } from '../../../shared/types'
import { splitPath } from '../format'
import { rowHeight, useSettings } from '../settings'
import { isMac } from '../platform'
import { usePersistentState } from '../hooks'
import { ChevronIcon, FolderIcon, LinkIcon } from './Icons'

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

/** Like Fork: + for added (and untracked), − for deleted, M for modified; the rest by letter. */
export function statusSymbol(status: FileStatus): string {
  return status === 'A' || status === '?' ? '+' : status === 'D' ? '−' : status === 'U' ? '!' : status
}

type Row =
  | { kind: 'dir'; path: string; label: string; depth: number; files: FileChange[] }
  | { kind: 'file'; file: FileChange; depth: number }

/**
 * Files as a folder tree: folders first, then files, each by name; a folder holding only one folder
 * shows as one row ("Assets/Scripts"). Collapsed folders hide what's in them.
 */
function treeRows(files: FileChange[], collapsed: Set<string>): Row[] {
  interface Node {
    dirs: Map<string, Node>
    files: FileChange[]
    all: FileChange[]
  }
  const root: Node = { dirs: new Map(), files: [], all: [] }
  for (const f of files) {
    const parts = f.path.split('/')
    let n = root
    for (const part of parts.slice(0, -1)) {
      let next = n.dirs.get(part)
      if (!next) n.dirs.set(part, (next = { dirs: new Map(), files: [], all: [] }))
      next.all.push(f)
      n = next
    }
    n.files.push(f)
  }
  const rows: Row[] = []
  const walk = (n: Node, prefix: string, depth: number): void => {
    for (const name of [...n.dirs.keys()].sort((a, b) => a.localeCompare(b))) {
      let child = n.dirs.get(name)!
      let label = name
      while (child.files.length === 0 && child.dirs.size === 1) {
        const [[only, next]] = [...child.dirs.entries()]
        label += `/${only}`
        child = next
      }
      const path = prefix + label
      rows.push({ kind: 'dir', path, label, depth, files: child.all })
      if (!collapsed.has(path)) walk(child, `${path}/`, depth + 1)
    }
    const name = (f: FileChange): string => f.path.slice(f.path.lastIndexOf('/') + 1)
    for (const f of [...n.files].sort((a, b) => name(a).localeCompare(name(b)))) rows.push({ kind: 'file', file: f, depth })
  }
  walk(root, '', 0)
  return rows
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
  /** Names the list for animations that move rows between lists. */
  area?: string
  /** Show the files as a folder tree. */
  tree?: boolean
  /** Files to mark with a link icon, with its tooltip (sources of a Unity export's native files). */
  marks?: Map<string, string>
}

export function FileList({ files: allFiles, selected, focused, onSelect, onActivate, onContextMenu, emptyText, area, tree, marks }: Props) {
  const settings = useSettings()
  const rowH = Math.round(rowHeight(settings) * 0.92)
  const parentRef = useRef<HTMLDivElement>(null)
  const anchor = useRef<number>(0)
  // In the tree, collapsed folders (remembered per list) and the rows as shown; `files` is then the
  // visible files in tree order, which is what ranges and the arrow keys go by.
  const [collapsedList, setCollapsed] = usePersistentState<string[]>(`spoon.files.collapsed.${area ?? 'list'}`, [])
  const collapsed = useMemo(() => new Set(collapsedList), [collapsedList])
  const rows = useMemo<Row[]>(
    () => (tree ? treeRows(allFiles, collapsed) : allFiles.map((file) => ({ kind: 'file' as const, file, depth: 0 }))),
    [tree, allFiles, collapsed]
  )
  const files = useMemo(() => rows.flatMap((r) => (r.kind === 'file' ? [r.file] : [])), [rows])
  const indexOf = useMemo(() => new Map(files.map((f, i) => [f.path, i])), [files])
  const toggle = (dir: string): void =>
    setCollapsed(collapsed.has(dir) ? collapsedList.filter((d) => d !== dir) : [...collapsedList, dir])
  const setOpen = (dir: string, open: boolean): void => {
    if (open === !collapsed.has(dir)) return
    setCollapsed(open ? collapsedList.filter((d) => d !== dir) : [...collapsedList, dir])
  }
  // In the tree, the keyboard can sit on a folder row too (selecting everything in it).
  const [focusDir, setFocusDir] = useState<string | null>(null)
  const pickDir = (r: Extract<Row, { kind: 'dir' }>): void => {
    setFocusDir(r.path)
    onSelect(new Set(r.files.map((f) => f.path)), r.files[0])
  }
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowH,
    overscan: 10
  })

  useEffect(() => {
    virtualizer.measure()
  }, [rowH, virtualizer])

  const selectedFiles = (): FileChange[] => allFiles.filter((f) => selected.has(f.path))

  const click = (index: number, e: React.MouseEvent): void => {
    // ⌃-click on a Mac is a right-click; the context menu decides what it applies to.
    if (isMac && e.ctrlKey && e.button === 0) return
    setFocusDir(null)
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
    if (e.key === 'a' && (e.metaKey || e.ctrlKey) && allFiles.length) {
      e.preventDefault()
      onSelect(new Set(allFiles.map((f) => f.path)), allFiles.find((f) => f.path === focused) ?? allFiles[0])
      return
    }
    if (tree && ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      // Like a Finder or IDE tree: ↑/↓ move over files and folders, ← collapses a folder (or goes to
      // the folder of a file, collapsing it), → expands a folder (or goes into an open one).
      e.preventDefault()
      const at = focusDir !== null ? rows.findIndex((r) => r.kind === 'dir' && r.path === focusDir) : rows.findIndex((r) => r.kind === 'file' && r.file.path === focused)
      const row = rows[at]
      const go = (i: number): void => {
        const r = rows[i]
        if (!r) return
        if (r.kind === 'dir') pickDir(r)
        else {
          setFocusDir(null)
          anchor.current = indexOf.get(r.file.path) ?? 0
          onSelect(new Set([r.file.path]), r.file)
        }
        virtualizer.scrollToIndex(i)
      }
      const parentOf = (i: number): number => {
        for (let j = i - 1; j >= 0; j--) if (rows[j].kind === 'dir' && rows[j].depth < rows[i].depth) return j
        return -1
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') return go(at < 0 ? 0 : Math.max(0, Math.min(rows.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1))))
      if (!row) return
      if (e.key === 'ArrowLeft') {
        if (row.kind === 'dir' && !collapsed.has(row.path)) return setOpen(row.path, false)
        const parent = parentOf(at)
        if (parent < 0) return
        const dir = rows[parent] as Extract<Row, { kind: 'dir' }>
        // From a file its folder closes over it; from a closed folder it's just a step up.
        if (row.kind === 'file') setOpen(dir.path, false)
        pickDir(dir)
        virtualizer.scrollToIndex(parent)
        return
      }
      if (row.kind !== 'dir') return
      if (collapsed.has(row.path)) return setOpen(row.path, true)
      return go(at + 1)
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const pos = files.findIndex((f) => f.path === focused)
    const next = Math.max(0, Math.min(files.length - 1, pos + (e.key === 'ArrowDown' ? 1 : -1)))
    if (!files[next]) return
    anchor.current = next
    onSelect(new Set([files[next].path]), files[next])
    const row = rows.findIndex((r) => r.kind === 'file' && r.file.path === files[next].path)
    if (row >= 0) virtualizer.scrollToIndex(row)
  }

  if (allFiles.length === 0) return <div className="empty-state small muted">{emptyText}</div>

  return (
    <div className="file-list" ref={parentRef} tabIndex={0} onKeyDown={onKeyDown} data-area={area}>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((v) => {
          const r = rows[v.index]
          const indent = tree ? { paddingLeft: `calc(0.6rem + ${r.depth * 1.1}rem)` } : undefined
          if (r.kind === 'dir') {
            const inside = new Set(r.files.map((f) => f.path))
            const all = r.files.every((f) => selected.has(f.path))
            return (
              <div
                key={`dir:${r.path}`}
                className={`file-row dir ${all ? 'selected' : ''} ${focusDir === r.path ? 'focused' : ''}`}
                style={{ transform: `translateY(${v.start}px)`, height: rowH, ...indent }}
                // A folder selects everything in it (so Stage, Discard and the menu act on all of it).
                onMouseDown={(e) => {
                  if (isMac && e.ctrlKey && e.button === 0) return
                  if (e.button === 2 && all) return
                  setFocusDir(r.path)
                  onSelect(inside, r.files[0])
                }}
                onDoubleClick={() => onActivate?.(r.files)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  onContextMenu?.(r.files)
                }}
                title={`${r.path}/ · ${r.files.length} file${r.files.length === 1 ? '' : 's'}`}
              >
                <button
                  className="dir-toggle"
                  aria-label={collapsed.has(r.path) ? 'Expand' : 'Collapse'}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => toggle(r.path)}
                >
                  <ChevronIcon className={`icon chevron ${collapsed.has(r.path) ? '' : 'open'}`} />
                </button>
                <FolderIcon className="icon dir-icon" />
                <span className="file-name">{r.label}</span>
                <span className="file-dir">{r.files.length}</span>
              </div>
            )
          }
          const f = r.file
          const { dir, name } = splitPath(f.path)
          const status = f.status === '?' ? 'A' : f.status
          const index = indexOf.get(f.path)!
          return (
            <div
              key={`${f.status}:${f.path}`}
              data-path={f.path}
              className={`file-row ${selected.has(f.path) ? 'selected' : ''} ${f.path === focused && focusDir === null ? 'focused' : ''}`}
              style={{ transform: `translateY(${v.start}px)`, height: rowH, ...(tree ? { paddingLeft: `calc(0.6rem + ${r.depth * 1.1}rem + 1.25rem)` } : {}) }}
              onMouseDown={(e) => click(index, e)}
              onDoubleClick={() => onActivate?.([f])}
              onContextMenu={(e) => {
                e.preventDefault()
                onContextMenu?.(selected.has(f.path) ? selectedFiles() : [f])
              }}
              title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}
            >
              <span className={`status status-${status}`} title={STATUS_LABEL[f.status]}>
                {statusSymbol(f.status)}
              </span>
              <span className="file-name">{name}</span>
              {marks?.has(f.path) && (
                <span className="file-mark" title={marks.get(f.path)}>
                  <LinkIcon />
                </span>
              )}
              {!tree && <span className="file-dir">{dir.replace(/\/$/, '')}</span>}
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
