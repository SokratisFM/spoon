import { useEffect, useRef, useState } from 'react'
import type { Submodule } from '../../../shared/types'
import type { Ops } from './RepoView'
import { BoxIcon, ChevronIcon } from './Icons'

export function submoduleStatus(s: Submodule): { label: string; tone: 'ok' | 'warn' | 'danger' | 'off' } {
  if (s.state === 'uninitialized') return { label: 'not initialized', tone: 'off' }
  if (s.state === 'conflict') return { label: 'conflict', tone: 'danger' }
  if (s.state === 'outdated') return { label: 'out of date', tone: 'danger' }
  if (s.dirty) return { label: 'modified', tone: 'warn' }
  return { label: 'up to date', tone: 'ok' }
}

export interface SubmoduleActions {
  open: (s: Submodule) => void
  update: (s: Submodule) => void
  menu: (s: Submodule) => void
}

export function submoduleActions(repoPath: string, ops: Ops, onOpenRepo: (path: string) => void): SubmoduleActions {
  const update = (s: Submodule): void => {
    ops.run(`Updating ${s.name}…`, () => window.spoon.updateSubmodule(repoPath, s.path), 'Submodule update failed')
  }
  const open = (s: Submodule): void => onOpenRepo(`${repoPath}/${s.path}`)
  return {
    open,
    update,
    menu: async (s) => {
      const choice = await window.spoon.contextMenu([
        { id: 'open', label: 'Open in New Tab', enabled: s.state !== 'uninitialized' },
        { id: 'update', label: s.state === 'uninitialized' ? 'Initialize' : 'Update to Recorded Commit' },
        { separator: true },
        { id: 'reveal', label: 'Reveal in Finder' },
        { id: 'copy', label: 'Copy Path' }
      ])
      if (choice === 'open') open(s)
      else if (choice === 'update') update(s)
      else if (choice === 'reveal') window.spoon.revealInFinder(`${repoPath}/${s.path}`)
      else if (choice === 'copy') navigator.clipboard.writeText(s.path)
    }
  }
}

/** Header chip ("2 submodules ▾") with a dropdown listing each submodule and its state. */
export function SubmoduleChip({ submodules, actions }: { submodules: Submodule[]; actions: SubmoduleActions }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (submodules.length === 0) return null
  const attention = submodules.some((s) => submoduleStatus(s).tone !== 'ok')

  return (
    <div className="sub-chip-wrap" ref={ref}>
      <button className={`sub-chip ${open ? 'on' : ''}`} onClick={() => setOpen((o) => !o)}>
        <BoxIcon />
        {submodules.length} submodule{submodules.length === 1 ? '' : 's'}
        {attention && <span className="tone-dot warn" />}
        <ChevronIcon className={`icon chevron ${open ? 'open' : ''}`} />
      </button>
      {open && (
        <div className="sub-menu">
          {submodules.map((s) => {
            const st = submoduleStatus(s)
            return (
              <div
                key={s.path}
                className="sub-row"
                onDoubleClick={() => s.state !== 'uninitialized' && actions.open(s)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  actions.menu(s)
                }}
              >
                <span className={`tone-dot ${st.tone}`} />
                <div className="sub-text">
                  <span className="sub-name">{s.name}</span>
                  <span className="sub-meta">
                    {s.path !== s.name && `${s.path} · `}
                    {s.branch ?? s.hash.slice(0, 7)} · {st.label}
                  </span>
                </div>
                {(s.state === 'outdated' || s.state === 'uninitialized') && (
                  <button className="mini-btn" onClick={() => actions.update(s)}>
                    {s.state === 'uninitialized' ? 'Initialize' : 'Update'}
                  </button>
                )}
                {s.state !== 'uninitialized' && (
                  <button
                    className="mini-btn"
                    onClick={() => {
                      setOpen(false)
                      actions.open(s)
                    }}
                  >
                    Open
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
