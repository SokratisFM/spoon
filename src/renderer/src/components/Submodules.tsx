import { useEffect, useRef, useState } from 'react'
import type { Submodule } from '../../../shared/types'
import type { Ops } from './RepoView'
import { BackIcon, BoxIcon, ChevronIcon } from './Icons'
import { revealLabel } from '../platform'

export function submoduleStatus(s: Submodule): { label: string; tone: 'ok' | 'warn' | 'danger' | 'off' } {
  if (s.state === 'uninitialized') return { label: 'not initialized', tone: 'off' }
  if (s.state === 'conflict') return { label: 'conflict', tone: 'danger' }
  if (s.state === 'outdated') {
    if (s.relation === 'ahead') return { label: `${s.ahead} commit${s.ahead === 1 ? '' : 's'} ahead of recorded`, tone: 'warn' }
    if (s.relation === 'behind') return { label: `${s.behind} commit${s.behind === 1 ? '' : 's'} behind recorded`, tone: 'danger' }
    return { label: 'differs from recorded commit', tone: 'danger' }
  }
  if (s.dirty) return { label: 'modified', tone: 'warn' }
  return { label: 'up to date', tone: 'ok' }
}

export interface SubmoduleActions {
  open: (s: Submodule) => void
  update: (s: Submodule) => void
  menu: (s: Submodule) => void
}

export function submoduleActions(repoPath: string, ops: Ops, onOpenRepo: (path: string) => void): SubmoduleActions {
  const parent = repoPath.split('/').pop()
  const update = async (s: Submodule): Promise<void> => {
    // Update checks out the commit the parent records, detached. When you're ahead or on a branch,
    // that moves you backwards, so say so first.
    if (s.state === 'outdated' && (s.relation !== 'behind' || s.branch)) {
      const where = s.branch ? `on ${s.branch}` : `at ${s.hash.slice(0, 7)}`
      const ok = await window.spoon.confirm({
        message: `Move ${s.name} back to the commit ${parent} records?`,
        detail:
          `${s.name} is ${where}` +
          (s.relation === 'ahead' ? `, ${s.ahead} commit${s.ahead === 1 ? '' : 's'} ahead of what ${parent} records` : '') +
          `.\n\nUpdate checks out ${s.recorded.slice(0, 7)} without a branch. Your branch and its commits stay, ` +
          `uncommitted changes are kept unless they conflict.\n\n` +
          `To keep the newer commit instead, commit the ${s.path} change in ${parent}.`,
        confirmLabel: 'Move back'
      })
      if (!ok) return
    }
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
        { id: 'reveal', label: revealLabel },
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
                  <span className="sub-name">
                    {s.name}
                    {s.path !== s.name && <span className="sub-path">{s.path}</span>}
                  </span>
                  <span className="sub-branch mono" title={s.branch ?? s.hash}>
                    {s.branch ?? `detached at ${s.hash.slice(0, 7)}`}
                  </span>
                  <span className={`sub-meta tone-${st.tone}`}>{st.label}</span>
                </div>
                {/* Catching up is "Update"; going back to the recorded commit is "Reset". */}
                {(s.state === 'outdated' || s.state === 'uninitialized') && (
                  <button className="mini-btn" onClick={() => actions.update(s)}>
                    {s.state === 'uninitialized' ? 'Initialize' : s.relation === 'behind' ? 'Update' : 'Reset'}
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

/** Shown inside a submodule, where the parent shows its submodules chip: jumps back to the parent. */
export function ParentChip({ parent, onOpen }: { parent: string; onOpen: (path: string) => void }) {
  return (
    <button className="sub-chip parent-chip" onClick={() => onOpen(parent)} title={`Back to ${parent}`}>
      <BackIcon />
      {parent.split('/').pop()}
    </button>
  )
}
