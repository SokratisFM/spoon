// Unity exports in the background: for each Unity repository with linked exports that's open in a
// tab (itself, or a submodule of it such as Assets/MainLib), the exports are watched and scanned,
// and edits and new files made in Android Studio or Xcode are brought back by themselves, whichever
// tab is showing. The Exports sidebar section (UnityExports) shows this state and offers the actions.
import { useSyncExternalStore } from 'react'
import type { ExportLink, ExportNew } from '../../shared/types'
import { cleanError, readStored } from './hooks'
import * as storage from './storage'
import { opStateOf, setOpState } from './repoCache'
import { setExportSources } from './exportMarks'

export interface ExportsState {
  /** The linked export folders; null = not set up. */
  dirs: string[] | null
  /** Edits and new files are brought back by themselves. */
  auto: boolean
  links: ExportLink[] | null
  /** Files made in the exports that have no source yet. */
  added: ExportNew[]
  /** Sources with uncommitted changes, by absolute path: an export edit never overwrites those by itself. */
  dirty: Set<string>
  error: string | null
  /** Export edits already brought back or set aside, by the export copy's save time. */
  handled: Record<string, number>
  /** Sources Spoon brought back, by their save time then: still that time = not edited since. */
  wrote: Record<string, number>
  /** New files set aside ("Leave Out"). */
  skipped: string[]
}

const fileName = (p: string): string => p.split('/').pop() ?? p

// ---------- the store ----------

const states = new Map<string, ExportsState>()
const listeners = new Set<() => void>()
const notify = (): void => listeners.forEach((l) => l())

const key = (kind: string, path: string): string => (kind ? `spoon.exports.${kind}.${path}` : `spoon.exports.${path}`)
const save = (kind: string, path: string, value: unknown): void => {
  try {
    storage.setItem(key(kind, path), JSON.stringify(value))
  } catch {
    // keep in memory
  }
}

export function exportsState(path: string): ExportsState {
  let s = states.get(path)
  if (!s) {
    s = {
      dirs: readStored<string[] | null>(key('', path), null),
      auto: readStored(key('auto', path), true),
      links: null,
      added: [],
      dirty: new Set(),
      error: null,
      handled: readStored(key('handled', path), {}),
      wrote: readStored(key('wrote', path), {}),
      skipped: readStored(key('skipNew', path), [])
    }
    states.set(path, s)
  }
  return s
}

function update(path: string, patch: Partial<ExportsState>): void {
  const next = { ...exportsState(path), ...patch }
  states.set(path, next)
  if ('dirs' in patch) save('', path, next.dirs)
  if ('auto' in patch) save('auto', path, next.auto)
  if ('handled' in patch) save('handled', path, next.handled)
  if ('wrote' in patch) save('wrote', path, next.wrote)
  if ('skipped' in patch) save('skipNew', path, next.skipped)
  notify()
}

export function useExportsState(path: string): ExportsState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => exportsState(path)
  )
}

/** Changes every time any repository's exports are linked or unlinked (App starts agents on it). */
export function useLinkedExports(): (path: string) => boolean {
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => linkedVersion
  )
  return (path) => !!exportsState(path).dirs?.length
}
let linkedVersion = 0

// ---------- repositories changing ----------

/** Tells the repository views (this one, a submodule, a package's) that files changed under them. */
function changed(paths: string[]): void {
  window.dispatchEvent(new CustomEvent<string[]>('spoon:repo-changed', { detail: [...new Set(paths)] }))
}

/**
 * Like a repository view's ops.run, without needing the view: after the repository's queued git
 * work, with its busy label, and git's error kept for when its tab shows. Repositories it touched
 * refresh afterwards.
 */
function run(path: string, label: string, fn: () => Promise<unknown>, failTitle: string, touched: string[]): Promise<boolean> {
  const task = opStateOf(path).queue.then(async () => {
    setOpState(path, { busy: { label, network: false } })
    try {
      await fn()
      return true
    } catch (err) {
      setOpState(path, { error: { title: failTitle, message: cleanError(err) } })
      return false
    } finally {
      setOpState(path, { busy: null })
      changed([path, ...touched])
    }
  })
  setOpState(path, { queue: task })
  return task
}

// ---------- scanning ----------

const scanning = new Map<string, Promise<void>>()
const again = new Set<string>()

/** Scans the repository's exports (one scan at a time; a request meanwhile scans once more after). */
export function scan(path: string): Promise<void> {
  const running = scanning.get(path)
  if (running) {
    again.add(path)
    return running
  }
  const p = (async () => {
    try {
      do {
        again.delete(path)
        await scanOnce(path)
      } while (again.has(path))
    } finally {
      scanning.delete(path)
    }
  })()
  scanning.set(path, p)
  return p
}

async function scanOnce(path: string): Promise<void> {
  const dirs = exportsState(path).dirs
  if (!dirs?.length) return update(path, { links: null, added: [] })
  try {
    const found = await window.spoon.scanExports(path, dirs)
    // The repository's status leaves out changes inside submodules (Assets/MainLib…), and a local
    // package can be a repository of its own: each source is checked against its own repository.
    const dirty = new Set<string>()
    for (const dir of new Set(found.map((l) => l.sourceRepo))) {
      const tree = await window.spoon.workingTree(dir).catch(() => ({ staged: [], unstaged: [] }))
      for (const f of [...tree.staged, ...tree.unstaged]) dirty.add(`${dir}/${f.path}`)
    }
    const added = await window.spoon.exportNewFiles(path, dirs).catch(() => [])
    setExportSources(path, Object.fromEntries(found.map((l) => [l.sourcePath, l.export])))
    update(path, { links: found, added, dirty, error: null })
    autoApply(path)
  } catch (err) {
    update(path, { error: cleanError(err) })
  }
}

// ---------- actions ----------

/** Uncommitted changes in the source that only Spoon made don't count: those are earlier bring-backs. */
export const yours = (s: ExportsState, l: ExportLink): boolean => s.dirty.has(l.sourcePath) && s.wrote[l.source] !== l.sourceMtime

/** Edits made in an export: newer than the source, and not brought back or set aside yet. */
export const editedOf = (s: ExportsState): ExportLink[] =>
  (s.links ?? []).filter((l) => l.state === 'export-newer' && s.handled[l.export] !== l.exportMtime)

export function markHandled(path: string, list: ExportLink[]): void {
  const s = exportsState(path)
  update(path, { handled: { ...s.handled, ...Object.fromEntries(list.map((l) => [l.export, l.exportMtime])) } })
}

export function setDirs(path: string, dirs: string[] | null): void {
  update(path, { dirs, links: null, added: [] })
  if (!dirs) setExportSources(path, null)
  linkedVersion++
  notify()
  void scan(path)
}

export function setAuto(path: string, auto: boolean): void {
  update(path, { auto })
  if (auto) autoApply(path)
}

export function skipNew(path: string, exp: string): void {
  update(path, { skipped: [...exportsState(path).skipped, exp] })
}

// Automatic bring-backs and adds that failed, by the export copy's save time (-1 for a new file):
// not tried again (and the error not shown again) until the export is saved again.
const failed = new Map<string, Record<string, number>>()
const failedOf = (path: string): Record<string, number> => failed.get(path) ?? (failed.set(path, {}), failed.get(path)!)

export function bringBackNow(path: string, list: ExportLink[], label: string, auto = false): Promise<boolean> {
  return run(
    path,
    label,
    async () => {
      const times: Record<string, number> = {}
      for (const l of list) times[l.source] = await window.spoon.exportBringBack(path, l.export, l.source)
      update(path, { wrote: { ...exportsState(path).wrote, ...times } })
    },
    'Bring back failed',
    list.map((l) => l.sourceRepo)
  ).then((ok) => {
    if (ok) markHandled(path, list)
    else if (auto) for (const l of list) failedOf(path)[l.export] = l.exportMtime
    void scan(path)
    return ok
  })
}

export async function relink(path: string, list: ExportLink[], force: boolean): Promise<void> {
  await run(
    path,
    list.length === 1 ? `Linking ${fileName(list[0].export)}…` : `Linking ${list.length} files…`,
    async () => {
      for (const l of list) await window.spoon.exportRelink(path, l.export, l.source, force)
    },
    'Relink failed',
    []
  )
  void scan(path)
}

/** Adds a new export file to a folder; resolves to whether it worked, and whether a .meta was made. */
export async function addNew(path: string, n: ExportNew, folder: string, auto = false): Promise<{ ok: boolean; meta: boolean }> {
  const result = { meta: true }
  const touched = n.folders.find((f) => f.id === folder)?.repo
  const ok = await run(
    path,
    auto ? `Adding ${fileName(n.export)} from the export…` : `Adding ${fileName(n.export)}…`,
    async () => Object.assign(result, await window.spoon.exportAdd(path, n.export, folder)),
    auto ? 'Couldn’t add a new file from the export' : 'Couldn’t add the file',
    touched ? [touched] : []
  )
  if (!ok && auto) failedOf(path)[n.export] = -1
  void scan(path)
  return { ok, meta: result.meta }
}

const applying = new Set<string>()

/** Brings back edits and adds new files whose folder is certain, when that's on. */
function autoApply(path: string): void {
  const s = exportsState(path)
  if (!s.auto || applying.has(path)) return
  const f = failedOf(path)
  const edits = editedOf(s).filter((l) => !yours(s, l) && f[l.export] !== l.exportMtime)
  const fresh = s.added.filter((n) => n.certain && !s.skipped.includes(n.export) && f[n.export] === undefined)
  if (!edits.length && !fresh.length) return
  applying.add(path)
  void (async () => {
    try {
      if (edits.length)
        await bringBackNow(
          path,
          edits,
          edits.length === 1 ? `Bringing back ${fileName(edits[0].source)} from the export…` : `Bringing back ${edits.length} files from exports…`,
          true
        )
      for (const n of fresh) await addNew(path, n, n.folders[0].id, true)
    } finally {
      applying.delete(path)
    }
  })()
}

// ---------- running agents ----------

interface Agent {
  stop: () => void
}
const agents = new Map<string, Agent>()

function start(path: string): Agent {
  const dirs = exportsState(path).dirs ?? []
  let timer: ReturnType<typeof setTimeout> | undefined
  const soon = (): void => {
    clearTimeout(timer)
    timer = setTimeout(() => void scan(path), 300)
  }
  window.spoon.watchExports(path, dirs)
  const off = window.spoon.onExportsChanged((repo) => repo === path && soon())
  // A refresh of this repository, a submodule of it or a source's repository (a commit, a checkout).
  const onLoaded = (e: Event): void => {
    const p = (e as CustomEvent<string>).detail
    if (p === path || p.startsWith(`${path}/`) || exportsState(path).links?.some((l) => l.sourceRepo === p)) soon()
  }
  window.addEventListener('spoon:repo-loaded', onLoaded)
  window.addEventListener('focus', soon)
  soon()
  return {
    stop: () => {
      clearTimeout(timer)
      off()
      window.removeEventListener('spoon:repo-loaded', onLoaded)
      window.removeEventListener('focus', soon)
      window.spoon.watchExports(path, [])
    }
  }
}

/** Runs agents for exactly these repositories (restarting one whose linked exports changed). */
const started = new Map<string, string>()
export function runAgents(paths: string[]): void {
  const want = new Map(paths.map((p) => [p, JSON.stringify(exportsState(p).dirs)]))
  for (const [p, a] of agents)
    if (want.get(p) !== started.get(p)) {
      a.stop()
      agents.delete(p)
      started.delete(p)
    }
  for (const [p, dirs] of want)
    if (!agents.has(p)) {
      agents.set(p, start(p))
      started.set(p, dirs)
    }
}
