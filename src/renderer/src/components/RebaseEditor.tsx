// Interactive rebase, edited in place of the commit list: one row per commit (newest first, like
// the graph), each with its action. Drag or ⌥↑/⌥↓ to reorder, P R E S F D to change an action.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { RebaseAction, RebasePlan, RebaseStep } from '../../../shared/types'
import { shortDate } from '../format'
import { AlertIcon } from './Icons'
import { contextMenu } from '../menus'

interface Row {
  hash: string
  subject: string
  body: string
  authorName: string
  authorTime: number
  action: RebaseAction
  /** Edited subject, for "reword". */
  newSubject: string
}

interface Props {
  plan: RebasePlan
  branch: string
  onto: string
  selected: string | null
  onSelect: (hash: string) => void
  onCancel: () => void
  /** Steps oldest first, as git runs them. */
  onApply: (steps: RebaseStep[]) => void
}

const ACTIONS: { id: RebaseAction; key: string; hint: string }[] = [
  { id: 'pick', key: 'p', hint: 'Keep the commit' },
  { id: 'reword', key: 'r', hint: 'Keep it with a new message' },
  { id: 'edit', key: 'e', hint: 'Stop here so you can amend it' },
  { id: 'squash', key: 's', hint: 'Fold into the commit below, keeping both messages' },
  { id: 'fixup', key: 'f', hint: 'Fold into the commit below, dropping this message' },
  { id: 'drop', key: 'd', hint: 'Remove the commit' }
]

const folds = (a: RebaseAction): boolean => a === 'squash' || a === 'fixup'

export function RebaseEditor({ plan, branch, onto, selected, onSelect, onCancel, onApply }: Props) {
  const [rows, setRows] = useState<Row[]>(() =>
    plan.commits.map((c) => ({ ...c, action: 'pick', newSubject: c.subject }))
  )
  const [dragging, setDragging] = useState<number | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const sel = Math.max(
    0,
    rows.findIndex((r) => r.hash === selected)
  )

  useEffect(() => {
    if (!rows.some((r) => r.hash === selected) && rows[0]) onSelect(rows[0].hash)
    list.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setAction = (i: number, action: RebaseAction): void => {
    setRows((rs) => rs.map((r, k) => (k === i ? { ...r, action } : r)))
    if (action === 'reword') setEditing(rows[i].hash)
  }
  const move = (from: number, to: number): void => {
    if (to < 0 || to >= rows.length || from === to) return
    setRows((rs) => {
      const next = [...rs]
      const [r] = next.splice(from, 1)
      next.splice(to, 0, r)
      return next
    })
  }

  // The oldest kept commit has nothing below it to fold into.
  const oldestKept = [...rows].reverse().find((r) => r.action !== 'drop')
  const problem =
    oldestKept && folds(oldestKept.action)
      ? `“${oldestKept.subject}” is the oldest commit left, so there’s nothing below it to ${oldestKept.action} into.`
      : rows.some((r) => r.action === 'reword' && !r.newSubject.trim())
        ? 'A reworded commit needs a message.'
        : null
  const resultCount = rows.filter((r) => r.action !== 'drop' && !folds(r.action)).length
  const changed = useMemo(
    () => rows.some((r, i) => r.hash !== plan.commits[i].hash || r.action !== 'pick'),
    [rows, plan]
  )

  const apply = (): void => {
    if (problem) return
    const steps: RebaseStep[] = [...rows].reverse().map((r) => {
      const reworded = r.action === 'reword' && r.newSubject.trim() !== r.subject
      return reworded
        ? { hash: r.hash, action: 'reword', message: r.newSubject.trim() + (r.body ? `\n\n${r.body}` : '') }
        : { hash: r.hash, action: r.action === 'reword' ? 'pick' : r.action }
    })
    onApply(steps)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.target !== list.current) return
    const r = rows[sel]
    if (!r) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const to = sel + (e.key === 'ArrowDown' ? 1 : -1)
      if (e.altKey) move(sel, to)
      else if (rows[to]) onSelect(rows[to].hash)
      return
    }
    if (e.key === 'Enter' && r.action === 'reword') {
      e.preventDefault()
      setEditing(r.hash)
      return
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const a = ACTIONS.find((x) => x.key === e.key.toLowerCase())
    if (a) {
      e.preventDefault()
      setAction(sel, a.id)
    }
  }

  const actionMenu = async (i: number): Promise<void> => {
    onSelect(rows[i].hash)
    const choice = await contextMenu(
      ACTIONS.map((a) => ({
        id: a.id,
        label: `${a.id[0].toUpperCase()}${a.id.slice(1)}  (${a.key.toUpperCase()}) · ${a.hint}`,
        kind: 'radio' as const,
        checked: rows[i].action === a.id
      }))
    )
    if (choice) setAction(i, choice as RebaseAction)
  }

  return (
    <div className="commit-list rebase-editor">
      <div className="rebase-bar">
        <div className="rebase-bar-text">
          <span>
            Interactive rebase of <b>{branch}</b> onto <b>{onto}</b>
          </span>
          <span className="muted">
            {rows.length} {rows.length === 1 ? 'commit' : 'commits'} → {resultCount}. Drag or {'⌥↑↓'} to reorder;{' '}
            <span className="mono">P R E S F D</span> to change a step.
          </span>
        </div>
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn primary" onClick={apply} disabled={!!problem} title={problem ?? undefined}>
          {changed ? 'Start Rebase' : 'Rebase'}
        </button>
      </div>
      {(plan.pushed || plan.merges > 0 || problem) && (
        <div className="rebase-notes">
          {problem && (
            <span className="rebase-note error">
              <AlertIcon /> {problem}
            </span>
          )}
          {plan.pushed && (
            <span className="rebase-note">
              <AlertIcon /> Some of these commits are already pushed. Afterwards you’ll need to force push.
            </span>
          )}
          {plan.merges > 0 && (
            <span className="rebase-note">
              <AlertIcon /> {plan.merges} merge {plan.merges === 1 ? 'commit' : 'commits'} in this range will be
              flattened.
            </span>
          )}
        </div>
      )}
      <div className="list-scroll rebase-rows" ref={list} tabIndex={0} onKeyDown={onKeyDown}>
        {rows.map((r, i) => {
          const isEditing = editing === r.hash && r.action === 'reword'
          return (
            <div
              key={r.hash}
              className={`rebase-row act-${r.action} ${r.hash === selected ? 'selected' : ''} ${dragging === i ? 'dragging' : ''}`}
              draggable={!isEditing}
              onDragStart={(e) => {
                setDragging(i)
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={(e) => {
                e.preventDefault()
                if (dragging !== null && dragging !== i) {
                  move(dragging, i)
                  setDragging(i)
                }
              }}
              onDragEnd={() => {
                setDragging(null)
                list.current?.focus()
              }}
              onMouseDown={() => onSelect(r.hash)}
              onContextMenu={(e) => {
                e.preventDefault()
                actionMenu(i)
              }}
            >
              <span className="rebase-grip" aria-hidden>
                ⋮⋮
              </span>
              <svg className="rebase-lane" viewBox="0 0 12 24" preserveAspectRatio="none" aria-hidden>
                <line x1="6" y1={i === 0 ? 12 : 0} x2="6" y2="24" />
                <circle cx="6" cy="12" r={folds(r.action) ? 2.6 : 4} />
              </svg>
              <button
                className="rebase-action"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => actionMenu(i)}
                title={ACTIONS.find((a) => a.id === r.action)?.hint}
              >
                {r.action}
                {folds(r.action) && ' ↓'}
              </button>
              {isEditing ? (
                <input
                  className="rebase-message"
                  autoFocus
                  value={r.newSubject}
                  spellCheck={false}
                  onChange={(e) =>
                    setRows((rs) => rs.map((x) => (x.hash === r.hash ? { ...x, newSubject: e.target.value } : x)))
                  }
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Enter' || e.key === 'Escape') {
                      setEditing(null)
                      list.current?.focus()
                    }
                  }}
                  onBlur={() => setEditing(null)}
                />
              ) : (
                <span
                  className="rebase-subject"
                  onDoubleClick={() => r.action === 'reword' && setEditing(r.hash)}
                  title={r.action === 'reword' ? 'Double-click to edit the message' : undefined}
                >
                  {r.action === 'reword' ? r.newSubject : r.subject}
                  {r.action === 'edit' && <span className="rebase-tag">stops here</span>}
                </span>
              )}
              <span className="rebase-author">{r.authorName}</span>
              <span className="rebase-date">{shortDate(r.authorTime)}</span>
              <span className="rebase-hash mono">{r.hash.slice(0, 7)}</span>
            </div>
          )
        })}
        <div className="rebase-row base">
          <span className="rebase-grip" />
          <svg className="rebase-lane" viewBox="0 0 12 24" preserveAspectRatio="none" aria-hidden>
            <line x1="6" y1="0" x2="6" y2="12" />
            <circle cx="6" cy="12" r="4" />
          </svg>
          <span className="ref-badge head">{onto}</span>
          <span className="muted">base · stays as it is</span>
        </div>
      </div>
    </div>
  )
}
