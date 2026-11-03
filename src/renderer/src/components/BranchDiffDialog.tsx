// Two branches compared, the way GitHub shows a pull request's files: every changed file's diff in
// one scroll, and the files listed on the left (following the scroll; a click jumps to one).
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CompareFile, CompareMode, DiffResult } from '../../../shared/types'
import { cleanError, useAsync, usePersistentState } from '../hooks'
import { codeLineHeight, updateSettings, useSettings } from '../settings'
import { paletteVars } from '../syntax'
import { snapshots } from '../repoCache'
import { Modal } from './Modal'
import { BranchPicker } from './BranchPicker'
import { Split } from './Split'
import { FileList, statusSymbol, treeOrder } from './FileList'
import { CodeText, DiffLayoutToggle, pairLines, parseDiff, SplitHalf, useLineLooks } from './DiffView'
import { ChevronIcon, ListViewIcon, TreeViewIcon } from './Icons'

/** Files with more changed lines than this wait for a click, like GitHub's "Load diff". */
const BIG = 1500
const MAX_SPLIT_ROWS = 4000

interface Props {
  path: string
  base: string
  compare: string
  onClose: () => void
}

export function BranchDiffDialog({ path, base: initialBase, compare: initialCompare, onClose }: Props) {
  const settings = useSettings()
  const [base, setBase] = useState(initialBase)
  const [compare, setCompare] = useState(initialCompare)
  const [mode, setMode] = usePersistentState<CompareMode>('spoon.branchDiff.mode', 'changes')
  // The branches as Spoon last read them right away, then as they are now (one may have been made outside Spoon).
  const fresh = useAsync(() => window.spoon.openRepo(path).then((r) => r.refs), [path])
  const refs = fresh.data ?? snapshots.get(path)?.repo?.refs ?? []
  const result = useAsync(() => window.spoon.compareRefs(path, base, compare, mode), [path, base, compare, mode])
  const data = result.data
  const [filter, setFilter] = useState('')
  const files = useMemo(() => {
    if (!data) return []
    const q = filter.trim().toLowerCase()
    const shown = q ? data.files.filter((f) => f.path.toLowerCase().includes(q)) : data.files
    return settings.fileTree ? treeOrder(shown) : shown
  }, [data, filter, settings.fileTree])
  const totals = useMemo(
    () => (data?.files ?? []).reduce((t, f) => ({ added: t.added + (f.added ?? 0), removed: t.removed + (f.removed ?? 0) }), { added: 0, removed: 0 }),
    [data]
  )

  // Looked-at files fold away (and can be folded by hand); both start over for another comparison.
  const [viewed, setViewed] = useState<Set<string>>(new Set())
  const [folded, setFolded] = useState<Set<string>>(new Set())
  const pair = data ? `${data.from}..${data.to}` : ''
  useEffect(() => {
    setViewed(new Set())
    setFolded(new Set())
  }, [pair])
  const toggle = (set: Set<string>, p: string): Set<string> => {
    const next = new Set(set)
    if (next.has(p)) next.delete(p)
    else next.add(p)
    return next
  }
  const markViewed = (p: string): void => {
    const on = !viewed.has(p)
    setViewed(toggle(viewed, p))
    setFolded((f) => {
      const next = new Set(f)
      if (on) next.add(p)
      else next.delete(p)
      return next
    })
    // Marking a file whose header is stuck at the top brings the next file up, like GitHub.
    const el = sections.current.get(p)
    const box = scroller.current
    if (on && el && box && el.offsetTop < box.scrollTop) box.scrollTop = el.offsetTop
  }

  // The file at the top of the scroll is the one picked in the list.
  const scroller = useRef<HTMLDivElement>(null)
  const sections = useRef(new Map<string, HTMLElement>())
  const [current, setCurrent] = useState<string | null>(null)
  const frame = useRef(0)
  // A file jumped to stays picked until the scroll is moved by hand: near the end it can't reach the top.
  const jumped = useRef(false)
  const spy = (): void => {
    if (jumped.current) return
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      const box = scroller.current
      if (!box) return
      const top = box.scrollTop + 4
      let at = files[0]?.path ?? null
      for (const f of files) {
        const el = sections.current.get(f.path)
        if (!el) continue
        if (el.offsetTop > top) break
        at = f.path
      }
      setCurrent(at)
    })
  }
  useEffect(spy, [files])
  // The sections get the same handlers on every render, so scrolling (which moves the pick) doesn't
  // redraw them.
  const acts = useRef({ fold: (_: string) => {}, viewed: (_: string) => {} })
  acts.current = { fold: (p) => setFolded((s) => toggle(s, p)), viewed: markViewed }
  const onFold = useCallback((p: string) => acts.current.fold(p), [])
  const onViewed = useCallback((p: string) => acts.current.viewed(p), [])
  const register = useCallback((p: string, el: HTMLElement | null) => (el ? sections.current.set(p, el) : sections.current.delete(p)), [])
  const jump = (p: string): void => {
    const el = sections.current.get(p)
    if (el && scroller.current) scroller.current.scrollTop = el.offsetTop
    jumped.current = true
    setCurrent(p)
  }

  const allFolded = files.length > 0 && files.every((f) => folded.has(f.path))
  const picker = (value: string, set: (v: string) => void, label: string) => (
    <BranchPicker className="bd-pick" refs={refs} value={value} onChange={set} title={label} />
  )

  const summary = data && (
    <span className="bd-summary muted">
      {data.ahead} commit{data.ahead === 1 ? '' : 's'}
      {mode === 'all' && data.behind > 0 && <> ahead, {data.behind} behind</>} · {data.files.length} file{data.files.length === 1 ? '' : 's'} ·{' '}
      <span className="plus">+{totals.added}</span> <span className="minus">−{totals.removed}</span>
    </span>
  )

  let body
  if (result.error) body = <div className="empty-state small error-text">{result.error}</div>
  else if (!data) body = <div className="empty-state small muted">Comparing…</div>
  else if (!data.files.length)
    body = (
      <div className="empty-state muted">
        {mode === 'changes' ? `${compare} has no changes that ${base} doesn't have.` : `${base} and ${compare} are the same.`}
      </div>
    )
  else
    body = (
      <Split id="branch-diff" direction="row" mode="rem" initial={18} min={10} max={40}>
        <div className="bd-files">
          <div className="bd-files-head">
            <input className="bd-filter" placeholder="Filter files" value={filter} onChange={(e) => setFilter(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
            <span className="view-toggle" role="group" aria-label="Show files as">
              <button className={settings.fileTree ? '' : 'on'} title="As a list" onClick={() => updateSettings({ fileTree: false })}>
                <ListViewIcon />
              </button>
              <button className={settings.fileTree ? 'on' : ''} title="As folders" onClick={() => updateSettings({ fileTree: true })}>
                <TreeViewIcon />
              </button>
            </span>
          </div>
          <FileList
            files={files}
            selected={new Set(current ? [current] : [])}
            focused={current}
            onSelect={(_, f) => jump(f.path)}
            emptyText="No files match."
            area="branch-diff"
            tree={settings.fileTree}
            dim={viewed}
            follow
          />
        </div>
        <div
          className="bd-scroll"
          ref={scroller}
          onScroll={spy}
          onWheel={() => (jumped.current = false)}
          onPointerDown={() => (jumped.current = false)}
          onKeyDown={() => (jumped.current = false)} style={paletteVars(settings.syntaxPalette, settings.syntaxIdeBackground)}>
          {files.map((f) => (
            <FileSection
              key={`${pair}|${f.path}`}
              path={path}
              from={data.from}
              to={data.to}
              file={f}
              folded={folded.has(f.path)}
              viewed={viewed.has(f.path)}
              onFold={onFold}
              onViewed={onViewed}
              register={register}
              root={scroller}
            />
          ))}
        </div>
      </Split>
    )

  return (
    <div className="branch-diff-modal">
      <Modal
        title="Compare Branches"
        onClose={onClose}
        wide
        titleExtra={summary}
        footer={
          <>
            {data && data.files.length > 0 && (
              <span className="muted" style={{ marginRight: 'auto' }}>
                {viewed.size}/{data.files.length} viewed
              </span>
            )}
            <button className="btn primary" onClick={onClose}>
              Close
            </button>
          </>
        }
      >
        <div className="bd-bar">
          {picker(base, setBase, 'Base: what the changes are compared against')}
          <span className="muted">←</span>
          {picker(compare, setCompare, 'Compare: the branch whose changes are shown')}
          <button
            className="btn"
            title="Swap the two branches"
            onClick={() => {
              setBase(compare)
              setCompare(base)
            }}
          >
            ⇄
          </button>
          <span className="segmented bd-mode">
            <button
              className={mode === 'changes' ? 'on' : ''}
              onClick={() => setMode('changes')}
              title={`Only what ${compare} changed since it split from ${base}, like a pull request`}
            >
              What it changed
            </button>
            <button
              className={mode === 'all' ? 'on' : ''}
              onClick={() => setMode('all')}
              title={`Everything that's different between ${base} and ${compare}, including what ${base} changed since they split`}
            >
              Every difference
            </button>
          </span>
          <span className="spacer" />
          {data && data.files.length > 0 && (
            <button className="btn" onClick={() => setFolded(allFolded ? new Set() : new Set(files.map((f) => f.path)))}>
              {allFolded ? 'Expand All' : 'Collapse All'}
            </button>
          )}
          <DiffLayoutToggle />
        </div>
        <div className={`bd-body ${result.loading ? 'loading' : ''}`}>{body}</div>
      </Modal>
    </div>
  )
}

interface SectionProps {
  path: string
  from: string
  to: string
  file: CompareFile
  folded: boolean
  viewed: boolean
  onFold: (path: string) => void
  onViewed: (path: string) => void
  register: (path: string, el: HTMLElement | null) => void
  root: React.RefObject<HTMLDivElement | null>
}

/** One file: a header that sticks while its diff scrolls by, and the diff, loaded once it's near. */
const FileSection = memo(function FileSection(p: SectionProps) {
  const { file } = p
  const settings = useSettings()
  const lineH = codeLineHeight(settings)
  const el = useRef<HTMLElement>(null)
  const [near, setNear] = useState(false)
  useEffect(() => {
    if (!el.current) return
    const seen = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && setNear(true), { root: p.root.current, rootMargin: '1500px 0px' })
    seen.observe(el.current)
    return () => seen.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const changed = (file.added ?? 0) + (file.removed ?? 0)
  const [forced, setForced] = useState(false)
  const binary = file.added === null
  const want = near && !p.folded && !binary && (changed <= BIG || forced)
  const [diff, setDiff] = useState<{ d: DiffResult } | { error: string } | null>(null)
  useEffect(() => {
    if (!want || diff) return
    let live = true
    window.spoon
      .diff(p.path, { kind: 'range', from: p.from, to: p.to, file })
      .then((d) => live && setDiff({ d }), (e: Error) => live && setDiff({ error: cleanError(e) }))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [want])
  const parsed = useMemo(() => (diff && 'd' in diff && !diff.d.binary ? parseDiff(diff.d.text) : null), [diff])
  const { look } = useLineLooks(parsed, file.path)
  const rows = useMemo(() => (parsed && settings.diffLayout === 'split' ? pairLines(parsed.lines) : null), [parsed, settings.diffLayout])
  const split = !!rows && rows.length <= MAX_SPLIT_ROWS

  let content
  if (p.folded) content = null
  else if (binary) content = <div className="bd-note muted">Binary file — no text diff.</div>
  else if (changed > BIG && !forced)
    content = (
      <div className="bd-note muted">
        A large diff: {changed.toLocaleString()} lines changed.{' '}
        <button className="btn" onClick={() => setForced(true)}>
          Load Diff
        </button>
      </div>
    )
  else if (diff && 'error' in diff) content = <div className="bd-note error-text">{diff.error}</div>
  else if (diff && diff.d.binary) content = <div className="bd-note muted">Binary file — no text diff.</div>
  else if (!parsed) content = <div className="bd-wait" style={{ height: Math.min(changed * 1.5 + 4, BIG * 1.5) * lineH }} />
  else if (!parsed.lines.length) content = <div className="bd-note muted">No content changes (mode or rename only).</div>
  else
    content = (
      <div className="bd-code">
        <div className={`diff-lines bd-lines syntax-${settings.diffSyntax} ${split ? 'side-by-side' : ''}`} style={{ '--bd-line': `${lineH}px` } as React.CSSProperties}>
          {split
            ? rows!.map((row, i) => {
                if ('full' in row) {
                  const l = parsed.lines[row.full]
                  return (
                    <div key={i} className={`diff-line ${l.kind}`}>
                      <span className="code">{l.text}</span>
                    </div>
                  )
                }
                const L = row.left !== undefined ? parsed.lines[row.left] : undefined
                const R = row.right !== undefined ? parsed.lines[row.right] : undefined
                return (
                  <div key={i} className="diff-line split-row">
                    <SplitHalf line={L} side="left" code={L ? <CodeText text={L.text} {...look(row.left!)} /> : undefined} />
                    <SplitHalf line={R} side="right" code={R ? <CodeText text={R.text} {...look(row.right!)} /> : undefined} />
                  </div>
                )
              })
            : parsed.lines.map((l, i) => (
                <div key={i} className={`diff-line ${l.kind}`}>
                  <span className="ln">{l.oldNo ?? ''}</span>
                  <span className="ln">{l.newNo ?? ''}</span>
                  <span className="sign">{l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ''}</span>
                  <span className="code">{l.kind === 'hunk' || l.kind === 'note' ? l.text : <CodeText text={l.text} {...look(i)} />}</span>
                </div>
              ))}
        </div>
        {'d' in diff! && diff.d.truncated && <div className="list-footnote">Diff truncated — file is too large to show in full.</div>}
      </div>
    )

  const status = file.status === '?' ? 'A' : file.status
  return (
    <section
      ref={(node) => {
        el.current = node
        p.register(file.path, node)
      }}
      className={`bd-file ${p.viewed ? 'viewed' : ''}`}
    >
      <header className="bd-file-head" onClick={() => p.onFold(file.path)}>
        <ChevronIcon className={`icon chevron ${p.folded ? '' : 'open'}`} />
        <span className={`status status-${status}`}>{statusSymbol(file.status)}</span>
        <span className="bd-file-path" title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}>
          {file.oldPath && <span className="muted">{file.oldPath} → </span>}
          {file.path}
        </span>
        {!binary && (
          <span className="diff-stats">
            <span className="plus">+{file.added}</span>
            <span className="minus">−{file.removed}</span>
          </span>
        )}
        <span className="spacer" />
        <label className="check viewed-toggle" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={p.viewed} onChange={() => p.onViewed(file.path)} /> Viewed
        </label>
      </header>
      {content}
    </section>
  )
})
