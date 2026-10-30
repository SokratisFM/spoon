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
  /**
   * Per export copy, the source's content hash when the two were last the same: an edit in the
   * export is only brought back by itself while the source is still that (otherwise both changed,
   * say a teammate's fix was pulled, and it's yours to decide).
   */
  base: Record<string, string>
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
      skipped: readStored(key('skipNew', path), []),
      base: readStored(key('base', path), {})
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
  if ('base' in patch) save('base', path, next.base)
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

// ---------- generations ----------

// Bumped when a repository's exports are linked differently or its agent stops: work started before
// (a scan, a queued bring-back) then does nothing.
const gens = new Map<string, number>()
const genOf = (path: string): number => gens.get(path) ?? 0
const bump = (path: string): void => void gens.set(path, genOf(path) + 1)

/** An automatic step failed: shown in the Exports section and as a toast, whichever tab is showing. */
function reportFailure(path: string, message: string): void {
  update(path, { error: message })
  window.dispatchEvent(new CustomEvent<string>('spoon:toast', { detail: `${path.split('/').pop()}: ${message}` }))
}

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
function run(path: string, label: string, fn: () => Promise<unknown>, failTitle: string, touched: string[], auto = false): Promise<boolean> {
  const task = opStateOf(path).queue.then(async () => {
    setOpState(path, { busy: { label, network: false } })
    try {
      await fn()
      return true
    } catch (err) {
      // Automatic steps report in the Exports section and a toast (the Unity project's tab may not
      // be showing); what you asked for shows its error right away.
      if (auto) reportFailure(path, `${failTitle}: ${cleanError(err)}`)
      else setOpState(path, { error: { title: failTitle, message: cleanError(err) } })
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
  const gen = genOf(path)
  const dirs = exportsState(path).dirs
  if (!dirs?.length) return update(path, { links: null, added: [] })
  try {
    const found = await window.spoon.scanExports(path, dirs)
    // The repository's status leaves out changes inside submodules (Assets/MainLib…), and a local
    // package can be a repository of its own: each source is checked against its own repository.
    // When that status can't be read, every source in it counts as changed (never overwritten).
    const dirty = new Set<string>()
    const problems: string[] = []
    for (const dir of new Set(found.map((l) => l.sourceRepo).filter(Boolean))) {
      try {
        const tree = await window.spoon.workingTree(dir)
        for (const f of [...tree.staged, ...tree.unstaged]) dirty.add(`${dir}/${f.path}`)
      } catch (err) {
        for (const l of found) if (l.sourceRepo === dir) dirty.add(l.sourcePath)
        problems.push(`Couldn’t read ${dir.split('/').pop()}’s changes, so its files aren’t brought back by themselves: ${cleanError(err)}`)
      }
    }
    let added: ExportNew[] = []
    try {
      added = await window.spoon.exportNewFiles(path, dirs)
    } catch (err) {
      problems.push(`Couldn’t look for new files in the exports: ${cleanError(err)}`)
    }
    // Linked differently (or stopped) meanwhile: these results are for the old setup.
    if (genOf(path) !== gen) return
    // Copies that match their source: what an edit in them is measured against.
    const s = exportsState(path)
    const base = { ...s.base }
    for (const l of found) if (l.state === 'same' && l.sourceHash) base[l.export] = l.sourceHash
    setExportSources(path, Object.fromEntries(found.map((l) => [l.sourcePath, l.export])))
    update(path, { links: found, added, dirty, base, error: problems.join('\n') || null })
    autoApply(path)
  } catch (err) {
    if (genOf(path) === gen) update(path, { error: cleanError(err) })
  }
}

// ---------- actions ----------

/**
 * The source has changes of yours that a bring-back would overwrite: uncommitted changes, or no
 * history to fall back on (untracked, ignored, outside any repository). Changes only Spoon made
 * (earlier bring-backs) don't count.
 */
export const yours = (s: ExportsState, l: ExportLink): boolean =>
  (!l.sourceRepo || !l.sourceTracked || s.dirty.has(l.sourcePath)) && s.wrote[l.source] !== l.sourceMtime

/**
 * An edit in an export that's safe to bring back without asking: the copy was saved after Unity's
 * export run, the source is still what it was when the two last matched, and it has no changes of yours.
 */
const autoSafe = (s: ExportsState, l: ExportLink): boolean =>
  l.state === 'export-newer' && !l.inRun && !!l.sourceHash && s.base[l.export] === l.sourceHash && !yours(s, l)

/** Edits made in an export: newer than the source, and not brought back or set aside yet. */
export const editedOf = (s: ExportsState): ExportLink[] =>
  (s.links ?? []).filter((l) => l.state === 'export-newer' && s.handled[l.export] !== l.exportMtime)

export function markHandled(path: string, list: ExportLink[]): void {
  const s = exportsState(path)
  update(path, { handled: { ...s.handled, ...Object.fromEntries(list.map((l) => [l.export, l.exportMtime])) } })
}

export function setDirs(path: string, dirs: string[] | null): void {
  bump(path)
  update(path, { dirs, links: null, added: [], error: null })
  if (!dirs) setExportSources(path, null)
  linkedVersion++
  notify()
  // A running agent watches the new folders (App starts or stops it when linking makes it needed).
  const agent = agents.get(path)
  if (agent && dirs?.length) {
    agent.stop()
    agents.set(path, start(path))
    started.set(path, JSON.stringify(dirs))
  } else void scan(path)
}

export function setAuto(path: string, auto: boolean): void {
  update(path, { auto })
  if (auto) autoApply(path)
}

export function skipNew(path: string, exp: string): void {
  update(path, { skipped: [...exportsState(path).skipped, exp] })
}

// Automatic bring-backs and adds that failed, by the export file's save time: not tried again (and
// the error not shown again) until it's saved again.
const failed = new Map<string, Record<string, number>>()
const failedOf = (path: string): Record<string, number> => failed.get(path) ?? (failed.set(path, {}), failed.get(path)!)

export function bringBackNow(path: string, list: ExportLink[], label: string, auto = false): Promise<boolean> {
  const gen = genOf(path)
  let done = list
  return run(
    path,
    label,
    async () => {
      // An automatic one waits its turn behind other git work: by then it may no longer apply.
      if (auto) {
        const s = exportsState(path)
        if (genOf(path) !== gen || !s.auto) return (done = [])
        done = list.filter((l) => s.handled[l.export] !== l.exportMtime)
      }
      if (!done.length) return
      // Main checks each file is still as scanned (else it fails, and the next scan looks again).
      const times = await window.spoon.exportBringBack(
        path,
        done.map((l) => ({ exp: l.export, src: l.source, exportMtime: l.exportMtime, sourceMtime: l.sourceMtime }))
      )
      update(path, { wrote: { ...exportsState(path).wrote, ...times } })
    },
    'Bring back failed',
    list.map((l) => l.sourceRepo).filter(Boolean),
    auto
  ).then((ok) => {
    if (ok) markHandled(path, done)
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
    touched ? [touched] : [],
    auto
  )
  if (!ok && auto) failedOf(path)[n.export] = n.saved
  void scan(path)
  return { ok, meta: result.meta }
}

const applying = new Set<string>()

/** Brings back edits and adds new files whose folder is certain, when that's on. */
function autoApply(path: string): void {
  const s = exportsState(path)
  if (!s.auto || applying.has(path)) return
  const f = failedOf(path)
  const edits = editedOf(s).filter((l) => autoSafe(s, l) && f[l.export] !== l.exportMtime)
  const fresh = s.added.filter((n) => n.certain && !s.skipped.includes(n.export) && f[n.export] !== n.saved)
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
  void window.spoon.watchExports(path, dirs).then((missing) => {
    if (missing.length) reportFailure(path, `Not watching ${missing.join(', ')}: ${missing.length === 1 ? 'it isn’t' : 'they aren’t'} there. Export again, or change the linked exports.`)
  })
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
      bump(path)
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
