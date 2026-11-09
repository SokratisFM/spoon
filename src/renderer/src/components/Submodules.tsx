import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { cleanError } from '../hooks'
import type { Submodule } from '../../../shared/types'
import type { Ops } from './RepoView'
import { BackIcon, BoxIcon, ChevronIcon } from './Icons'
import { revealLabel } from '../platform'
import { contextMenu } from '../menus'

/**
 * Submodules whose automatic download was already tried this session ("<repo>\0<path>"), or a whole
 * repository's ("<repo>\0*": one whose clone already said why its submodules didn't come down).
 */
export const triedSubmodules = new Set<string>()

/** A download of a repository's never-downloaded submodules, running beside its other git work. */
export interface SubmoduleDownload {
  /** The submodules asked for (paths in the repository). */
  paths: string[]
  /** The one coming down now (a nested one shows as itself). */
  current: string | null
  /** How many of the asked-for ones are in. */
  done: number
  phase: 'connecting' | 'receiving' | 'resolving' | 'checking out'
  pct: number | null
  /** "497.00 MiB | 1.20 MiB/s", as git says it. */
  amount: string | null
  error?: string
}
const downloads = new Map<string, SubmoduleDownload>()
const downloadListeners = new Set<() => void>()
const notifyDownloads = (): void => downloadListeners.forEach((l) => l())

export function useSubmoduleDownload(repo: string): SubmoduleDownload | null {
  return useSyncExternalStore(
    (l) => {
      downloadListeners.add(l)
      return () => downloadListeners.delete(l)
    },
    () => downloads.get(repo) ?? null
  )
}
/** The finished (or failed) download's record goes once its result has been shown. */
export function clearSubmoduleDownload(repo: string): void {
  if (downloads.delete(repo)) notifyDownloads()
}

/**
 * Downloads the submodules, following git's progress (which submodule, how far along). It keeps going
 * when the tab is closed or switched; onEnd runs when it's over, whichever way.
 */
export function startSubmoduleDownload(repo: string, paths: string[], onEnd: () => void): void {
  if (downloads.get(repo) && !downloads.get(repo)!.error) return
  let state: SubmoduleDownload = { paths, current: null, done: 0, phase: 'connecting', pct: null, amount: null }
  const set = (next: SubmoduleDownload): void => {
    state = next
    downloads.set(repo, next)
  }
  set(state)
  notifyDownloads()
  // git reports many times a second: the view catches up at most ~6 times a second.
  let timer: ReturnType<typeof setTimeout> | null = null
  const later = (): void => {
    timer ??= setTimeout(() => {
      timer = null
      notifyDownloads()
    }, 150)
  }
  const top = new Set(paths)
  const off = window.spoon.onProgress((key, line) => {
    if (key !== `${repo}\0submodules`) return
    const into = /Cloning into '(.+)'/.exec(line)?.[1]
    if (into) {
      const rel = into.startsWith(`${repo}/`) ? into.slice(repo.length + 1) : into
      set({ ...state, current: rel, phase: 'connecting', pct: null, amount: null })
      return later()
    }
    const checked = /^Submodule path '(.+)': checked out/.exec(line.trim())?.[1]
    if (checked && top.has(checked)) {
      set({ ...state, done: Math.min(paths.length, state.done + 1) })
      return later()
    }
    const receiving = /Receiving objects:\s+(\d{1,3})%[^,]*(?:,\s*(.+?))?\s*(?:,\s*done\.)?$/.exec(line.trim())
    if (receiving) {
      set({ ...state, phase: 'receiving', pct: Number(receiving[1]), amount: receiving[2]?.replace(/,\s*done\.?$/, '') ?? state.amount })
      return later()
    }
    const resolving = /Resolving deltas:\s+(\d{1,3})%/.exec(line)
    if (resolving) {
      set({ ...state, phase: 'resolving', pct: Number(resolving[1]) })
      return later()
    }
    const updating = /Updating files:\s+(\d{1,3})%/.exec(line)
    if (updating) {
      set({ ...state, phase: 'checking out', pct: Number(updating[1]) })
      later()
    }
  })
  const end = (error?: string): void => {
    off()
    if (timer) clearTimeout(timer)
    if (error && error !== 'Cancelled.') set({ ...state, error })
    else downloads.delete(repo)
    notifyDownloads()
    onEnd()
  }
  window.spoon.downloadNewSubmodules(repo).then(
    () => end(),
    (err) => end(cleanError(err))
  )
}

/** The header's "Downloading MainLib (1 of 4) · 64% · 497 MiB" line, with its own Cancel. */
export function SubmoduleDownloadStatus({ repo }: { repo: string }) {
  const d = useSubmoduleDownload(repo)
  if (!d || d.error) return null
  const name = d.current ? d.current.split('/').pop() : null
  const count = d.paths.length > 1 ? ` (${Math.min(d.done + 1, d.paths.length)} of ${d.paths.length})` : ''
  const step =
    d.phase === 'connecting'
      ? 'connecting…'
      : d.phase === 'receiving'
        ? `${d.pct}%${d.amount ? ` · ${d.amount.split('|')[0].trim()}` : ''}`
        : d.phase === 'resolving'
          ? `unpacking ${d.pct}%`
          : `checking out ${d.pct}%`
  const speed = d.phase === 'receiving' ? d.amount?.split('|')[1]?.trim() : null
  const title = `Downloading ${d.paths.join(', ')}${speed ? ` (${speed})` : ''}. You can fetch, pull and commit meanwhile.`
  return (
    <span className="sub-download" title={title}>
      <span className="spinner" />
      <span className="sub-download-text">
        Downloading {name ?? (d.paths.length === 1 ? d.paths[0].split('/').pop() : 'submodules')}
        {count}
        <span className="muted"> · {step}</span>
      </span>
      <button className="mini-btn" onClick={() => window.spoon.cancelSubmoduleDownload(repo)} title="Stop downloading the submodules">
        Cancel
      </button>
    </span>
  )
}

export function submoduleStatus(s: Submodule): { label: string; tone: 'ok' | 'warn' | 'danger' | 'off' } {
  if (s.state === 'uninitialized') return { label: 'not initialized', tone: 'off' }
  if (s.state === 'conflict') return { label: 'conflict', tone: 'danger' }
  if (s.state === 'outdated') {
    if (s.relation === 'ahead')
      return { label: `${s.ahead} commit${s.ahead === 1 ? '' : 's'} ahead of recorded`, tone: 'warn' }
    if (s.relation === 'behind')
      return { label: `${s.behind} commit${s.behind === 1 ? '' : 's'} behind recorded`, tone: 'danger' }
    return { label: 'differs from recorded commit', tone: 'danger' }
  }
  if (s.dirty) return { label: 'modified', tone: 'warn' }
  return { label: 'up to date', tone: 'ok' }
}

export interface SubmoduleActions {
  open: (s: Submodule) => void
  update: (s: Submodule) => void
  menu: (s: Submodule) => void
  /** The team's shared library submodule (MainLib): can be moved to a newer version branch. */
  isMainlib: (s: Submodule) => boolean
  updateMainlib: (s: Submodule) => void
}

export function submoduleActions(
  repoPath: string,
  ops: Ops,
  onOpenRepo: (path: string) => void,
  /** Opens the dialog that explains and confirms an update/reset. */
  askUpdate: (s: Submodule) => void,
  /** The MainLib submodule's name (Settings) and its update dialog. */
  mainlibName: string,
  openMainlib: (s: Submodule) => void
): SubmoduleActions {
  const isMainlib = (s: Submodule): boolean =>
    !!mainlibName && s.state !== 'uninitialized' && s.name.toLowerCase() === mainlibName.toLowerCase()
  const update = (s: Submodule): void => {
    if (s.state === 'uninitialized')
      ops.run(
        `Initializing ${s.name}…`,
        () => window.spoon.updateSubmodule(repoPath, s.path),
        'Submodule update failed'
      )
    else askUpdate(s)
  }
  const open = (s: Submodule): void => onOpenRepo(`${repoPath}/${s.path}`)
  return {
    open,
    update,
    isMainlib,
    updateMainlib: openMainlib,
    menu: async (s) => {
      const choice = await contextMenu([
        ...(isMainlib(s) ? [{ id: 'mainlib', label: `Update ${s.name} to a Newer Version…` }, { separator: true }] : []),
        { id: 'open', label: 'Open in New Tab', enabled: s.state !== 'uninitialized' },
        { id: 'update', label: s.state === 'uninitialized' ? 'Initialize' : 'Update to Recorded Commit' },
        { separator: true },
        { id: 'reveal', label: revealLabel, icon: 'reveal' as const },
        { id: 'copy', label: 'Copy Path' }
      ])
      if (choice === 'mainlib') openMainlib(s)
      else if (choice === 'open') open(s)
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
                className={`sub-row ${s.state === 'uninitialized' ? 'disabled' : ''}`}
                title={s.state === 'uninitialized' ? 'Initialize it to open it' : `Open ${s.name} in a tab`}
                onClick={() => {
                  if (s.state === 'uninitialized') return
                  setOpen(false)
                  actions.open(s)
                }}
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
                {actions.isMainlib(s) && (
                  <button
                    className="mini-btn mainlib-btn"
                    title={`Move ${s.name} to a newer version branch`}
                    onClick={(e) => {
                      e.stopPropagation()
                      setOpen(false)
                      actions.updateMainlib(s)
                    }}
                  >
                    New version…
                  </button>
                )}
                {/* Catching up is "Update"; going back to the recorded commit is "Reset". */}
                {(s.state === 'outdated' || s.state === 'uninitialized') && (
                  <button
                    className="mini-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      setOpen(false)
                      actions.update(s)
                    }}
                  >
                    {s.state === 'uninitialized' ? 'Initialize' : s.relation === 'behind' ? 'Update' : 'Reset'}
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
