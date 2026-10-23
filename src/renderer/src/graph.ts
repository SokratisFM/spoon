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

export function buildGraph(commits: Commit[]): Graph {
  const lanes: (string | null)[] = []
  const colors: number[] = []
  let nextColor = 0
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
      colors[col] = nextColor++
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
          colors[j] = nextColor++
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
