// Assigns each commit a column ("lane") and computes the line segments to draw in its row.
// Lanes are never compacted, so a line passing through a row keeps its column.
import type { Commit } from '../../shared/types'

export interface Segment {
  /** full: straight through the row; top: from row top into the node; bottom: from the node to row bottom */
  kind: 'full' | 'top' | 'bottom'
  from: number
  to: number
  color: number
}

export interface GraphRow {
  col: number
  color: number
  isMerge: boolean
  segments: Segment[]
  width: number // columns used by this row
}

export interface Graph {
  rows: GraphRow[]
  maxWidth: number
}

/**
 * Reserved branch colors: a lane that starts at a commit whose branch matches a reserved prefix
 * takes that color; every other lane cycles through the free colors only.
 */
export interface ColorRules {
  colorAt: (hash: string) => number | null
  free: number[]
}

export function buildGraph(commits: Commit[], rules?: ColorRules): Graph {
  const lanes: (string | null)[] = []
  const colors: number[] = []
  let nextColor = 0
  let auto = 0
  const pick = (hash: string): number =>
    rules ? (rules.colorAt(hash) ?? rules.free[auto++ % rules.free.length]) : nextColor++
  let maxWidth = 1
  const rows: GraphRow[] = []

  const freeSlot = (): number => {
    const i = lanes.indexOf(null)
    return i === -1 ? lanes.length : i
  }

  for (const c of commits) {
    let col = lanes.indexOf(c.hash)
    const isTip = col === -1
    if (isTip) {
      col = freeSlot()
      lanes[col] = c.hash
      colors[col] = pick(c.hash)
    }
    const nodeColor = colors[col]
    const segments: Segment[] = []

    // Upper half: lines arriving from children, and lanes passing by.
    for (let i = 0; i < lanes.length; i++) {
      const h = lanes[i]
      if (h === null) continue
      if (h === c.hash) {
        if (!(isTip && i === col)) segments.push({ kind: 'top', from: i, to: col, color: colors[i] })
        lanes[i] = null
      } else {
        segments.push({ kind: 'full', from: i, to: i, color: colors[i] })
      }
    }
    const widthBefore = lanes.length

    // Lower half: lines leaving towards parents.
    c.parents.forEach((p, k) => {
      let j = lanes.indexOf(p)
      if (j === -1) {
        if (k === 0 && lanes[col] == null) {
          j = col
          colors[j] = nodeColor
        } else {
          j = freeSlot()
          colors[j] = pick(p)
        }
        lanes[j] = p
      }
      segments.push({ kind: 'bottom', from: col, to: j, color: colors[j] })
    })

    const width = Math.max(widthBefore, lanes.length, col + 1)
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop()
    maxWidth = Math.max(maxWidth, width)
    rows.push({ col, color: nodeColor, isMerge: c.parents.length > 1, segments, width })
  }

  return { rows, maxWidth }
}

export const LANE_COLORS = 8

/** The part of the graph that belongs to one branch line: a column and the rows it spans. */
export interface Spotlight {
  col: number
  top: number
  bottom: number
  nodes: Set<number>
}

/**
 * The branch line through a commit: from it, follow first parents down and first-parent children
 * up for as long as they stay in the same column (a lane belongs to one branch from tip to fork).
 */
export function spotlightAt(commits: Commit[], graph: Graph, start: number): Spotlight | null {
  const row = graph.rows[start]
  if (!row) return null
  const col = row.col
  const index = new Map(commits.map((c, i) => [c.hash, i]))
  const nodes = new Set([start])
  let top = start
  let bottom = start
  for (let cur = start; ; ) {
    const p = index.get(commits[cur].parents[0] ?? '')
    if (p === undefined || graph.rows[p]?.col !== col) break
    nodes.add(p)
    bottom = cur = p
  }
  // Children above: the nearest commit in the same column whose first parent is the current one.
  for (let cur = start, i = start - 1; i >= 0; i--) {
    if (graph.rows[i].col !== col) continue
    if (commits[i].parents[0] !== commits[cur].hash) break
    nodes.add(i)
    top = cur = i
  }
  return { col, top, bottom, nodes }
}
