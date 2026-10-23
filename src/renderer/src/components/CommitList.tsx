import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { Commit, Ref, RepoState } from '../../../shared/types'
import { LANE_COLORS, type Graph, type GraphRow } from '../graph'
import { hueFor, initials, shortDate } from '../format'
import { rowHeight, useSettings } from '../settings'
import { CloudIcon, TagIcon } from './Icons'
import type { Ops } from './RepoView'

const MAX_GRAPH_LANES = 14

interface Props {
  commits: Commit[]
  graph: Graph
  repo: RepoState
  selected: string | null
  onSelect: (hash: string) => void
  scrollTo: { hash: string; n: number } | null
  filter: string
  truncated: boolean
  ops: Ops
}

interface Badge {
  key: string
  label: string
  kind: 'head' | 'remote' | 'tag'
  remotes: string[] // remotes whose branch points at the same commit as this local branch
  current: boolean
}

/** Groups refs per commit, folding "origin/main" into "main" when both point at the same commit. */
function badgesByCommit(repo: RepoState): Map<string, Badge[]> {
  const map = new Map<string, Badge[]>()
  const byHash = new Map<string, Ref[]>()
  for (const r of repo.refs) byHash.set(r.target, [...(byHash.get(r.target) ?? []), r])

  for (const [hash, refs] of byHash) {
    const badges: Badge[] = []
    const folded = new Set<string>()
    for (const r of refs.filter((x) => x.kind === 'head')) {
      const remotes = refs
        .filter((x) => x.kind === 'remote' && x.name.slice(x.name.indexOf('/') + 1) === r.name)
        .map((x) => {
          folded.add(x.name)
          return x.name.split('/')[0]
        })
      badges.push({ key: r.fullName, label: r.name, kind: 'head', remotes, current: r.name === repo.headBranch })
    }
    for (const r of refs) {
      if (r.kind === 'remote' && !folded.has(r.name))
        badges.push({ key: r.fullName, label: r.name, kind: 'remote', remotes: [], current: false })
      if (r.kind === 'tag') badges.push({ key: r.fullName, label: r.name, kind: 'tag', remotes: [], current: false })
    }
    badges.sort((a, b) => Number(b.current) - Number(a.current))
    map.set(hash, badges)
  }
  return map
}

export function CommitList({ commits, graph, repo, selected, onSelect, scrollTo, filter, truncated, ops }: Props) {
  const settings = useSettings()
  const rowH = rowHeight(settings)
  const parentRef = useRef<HTMLDivElement>(null)
  const badges = useMemo(() => badgesByCommit(repo), [repo])

  const q = filter.trim().toLowerCase()
  const indices = useMemo(() => {
    const all = commits.map((_, i) => i)
    if (!q) return all
    return all.filter((i) => {
      const c = commits[i]
      return (
        c.subject.toLowerCase().includes(q) ||
        c.authorName.toLowerCase().includes(q) ||
        c.hash.startsWith(q) ||
        (badges.get(c.hash) ?? []).some((b) => b.label.toLowerCase().includes(q))
      )
    })
  }, [commits, q, badges])

  const showGraph = !q
  const laneW = Math.max(10, Math.round(rowH * 0.5))

  const virtualizer = useVirtualizer({
    count: indices.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowH,
    overscan: 12
  })

  useEffect(() => {
    virtualizer.measure()
  }, [rowH, virtualizer])

  useEffect(() => {
    if (!scrollTo) return
    const pos = indices.findIndex((i) => commits[i].hash === scrollTo.hash)
    if (pos !== -1) virtualizer.scrollToIndex(pos, { align: 'center' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollTo])

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const pos = indices.findIndex((i) => commits[i].hash === selected)
    const next = Math.max(0, Math.min(indices.length - 1, pos + (e.key === 'ArrowDown' ? 1 : -1)))
    if (indices[next] === undefined) return
    onSelect(commits[indices[next]].hash)
    virtualizer.scrollToIndex(next)
  }

  const gridTemplate = 'minmax(0, 1fr) 11.5rem 8.5rem 5rem'

  const onContextMenu = useCallback(
    async (c: Commit) => {
      onSelect(c.hash)
      const branches = (badges.get(c.hash) ?? []).filter((b) => b.kind !== 'tag' && !b.current)
      const choice = await window.spoon.contextMenu([
        ...branches.map((b) => ({ id: `branch:${b.key}`, label: `Checkout ${b.label}` })),
        { id: 'detach', label: 'Checkout Commit (Detached)…', enabled: c.hash !== repo.headHash || !!repo.headBranch },
        { separator: true },
        { id: 'hash', label: 'Copy Commit Hash' },
        { id: 'subject', label: 'Copy Commit Message' }
      ])
      if (!choice) return
      if (choice === 'detach') ops.checkout({ kind: 'commit', hash: c.hash }, `commit ${c.hash.slice(0, 7)}`)
      else if (choice === 'hash') navigator.clipboard.writeText(c.hash)
      else if (choice === 'subject') navigator.clipboard.writeText(c.subject)
      else {
        const b = branches.find((x) => `branch:${x.key}` === choice)!
        ops.checkout(b.kind === 'head' ? { kind: 'branch', name: b.label } : { kind: 'remote', name: b.label }, b.label)
      }
    },
    [badges, ops, onSelect, repo.headHash, repo.headBranch]
  )

  if (commits.length === 0) return <div className="empty-state muted">No commits yet.</div>

  return (
    <div className="commit-list">
      <div className="list-header" style={{ gridTemplateColumns: gridTemplate }}>
        <span className="header-desc">Description</span>
        <span>Author</span>
        <span>Date</span>
        <span>Commit</span>
      </div>
      <div className="list-scroll" ref={parentRef} tabIndex={0} onKeyDown={onKeyDown}>
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((v) => {
            const i = indices[v.index]
            const c = commits[i]
            return (
              <CommitRow
                key={c.hash}
                commit={c}
                row={showGraph ? graph.rows[i] : null}
                badges={badges.get(c.hash)}
                isHead={c.hash === repo.headHash}
                selected={c.hash === selected}
                onSelect={onSelect}
                onContextMenu={onContextMenu}
                top={v.start}
                rowH={rowH}
                laneW={laneW}
                gridTemplate={gridTemplate}
              />
            )
          })}
        </div>
        {truncated && !q && (
          <div className="list-footnote">Showing the latest {commits.length.toLocaleString()} commits.</div>
        )}
      </div>
    </div>
  )
}

interface RowProps {
  commit: Commit
  row: GraphRow | null
  badges: Badge[] | undefined
  isHead: boolean
  selected: boolean
  onSelect: (hash: string) => void
  onContextMenu: (c: Commit) => void
  top: number
  rowH: number
  laneW: number
  gridTemplate: string
}

const CommitRow = memo(function CommitRow(p: RowProps) {
  const { commit: c } = p
  return (
    <div
      className={`commit-row ${p.selected ? 'selected' : ''} ${p.isHead ? 'is-head' : ''}`}
      style={{ transform: `translateY(${p.top}px)`, height: p.rowH, gridTemplateColumns: p.gridTemplate }}
      onMouseDown={() => p.onSelect(c.hash)}
      onContextMenu={(e) => {
        e.preventDefault()
        p.onContextMenu(c)
      }}
    >
      <span className="cell subject">
        {p.row && <GraphCell row={p.row} rowH={p.rowH} laneW={p.laneW} isHead={p.isHead} />}
        {p.badges?.map((b) => (
          <span key={b.key} className={`ref-badge ${b.kind} ${b.current ? 'current' : ''}`}>
            {b.kind === 'tag' && <TagIcon />}
            {b.kind === 'remote' && <CloudIcon />}
            {b.label}
            {b.remotes.map((r) => (
              <span key={r} className="ref-remote">
                <CloudIcon /> {r}
              </span>
            ))}
          </span>
        ))}
        <span className="subject-text">{c.subject}</span>
      </span>
      <span className="cell author">
        <span className="avatar" style={{ '--hue': hueFor(c.authorEmail) } as React.CSSProperties}>
          {initials(c.authorName)}
        </span>
        <span className="ellipsis">{c.authorName}</span>
      </span>
      <span className="cell date">{shortDate(c.authorTime)}</span>
      <span className="cell hash mono">{c.hash.slice(0, 7)}</span>
    </div>
  )
})

function GraphCell({
  row,
  rowH,
  laneW,
  isHead
}: {
  row: GraphRow
  rowH: number
  laneW: number
  isHead: boolean
}) {
  // Each row is only as wide as its own lanes, so the text starts right after the graph (like Fork).
  const width = laneW * Math.min(row.width, MAX_GRAPH_LANES) + laneW * 0.5
  const x = (col: number): number => laneW * col + laneW / 2 + laneW * 0.25
  const mid = rowH / 2
  const stroke = Math.max(1.5, rowH * 0.06)
  const r = Math.max(3.5, rowH * 0.17)
  const color = (n: number): string => `var(--lane-${n % LANE_COLORS})`

  return (
    <svg className="graph" width={width} height={rowH}>
      {row.segments.map((s, i) => {
        const x1 = x(s.from)
        const x2 = x(s.to)
        let d: string
        if (s.kind === 'full') d = `M${x1} 0V${rowH}`
        else if (s.kind === 'top')
          d = x1 === x2 ? `M${x1} 0V${mid}` : `M${x1} 0C${x1} ${mid} ${x2} 0 ${x2} ${mid}`
        else d = x1 === x2 ? `M${x1} ${mid}V${rowH}` : `M${x1} ${mid}C${x1} ${rowH} ${x2} ${mid} ${x2} ${rowH}`
        return <path key={i} d={d} stroke={color(s.color)} strokeWidth={stroke} fill="none" />
      })}
      {row.isMerge ? (
        <circle cx={x(row.col)} cy={mid} r={r * 0.6} fill={color(row.color)} />
      ) : (
        <circle
          cx={x(row.col)}
          cy={mid}
          r={r}
          fill={isHead ? 'var(--bg-list)' : color(row.color)}
          stroke={color(row.color)}
          strokeWidth={isHead ? stroke * 1.4 : 0}
        />
      )}
    </svg>
  )
}
