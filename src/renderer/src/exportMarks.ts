// Which files are the sources of native files in a Unity export (see UnityExports), so Local Changes
// can mark them: an edit made in Android Studio or Xcode lands in them. Kept per Unity repository
// and remembered, so a submodule's or package's own tab knows too.
import { useMemo, useSyncExternalStore } from 'react'
import { readStored } from './hooks'
import * as storage from './storage'

const KEY = 'spoon.exportSources'
/** Unity repository → source's absolute path → the export file that uses it. */
let all = readStored<Record<string, Record<string, string>>>(KEY, {})
const listeners = new Set<() => void>()

export function setExportSources(unityRepo: string, sources: Record<string, string> | null): void {
  if (JSON.stringify(all[unityRepo] ?? null) === JSON.stringify(sources)) return
  const next = { ...all }
  if (sources) next[unityRepo] = sources
  else delete next[unityRepo]
  all = next
  try {
    storage.setItem(KEY, JSON.stringify(all))
  } catch {
    // keep in memory
  }
  listeners.forEach((l) => l())
}

/** The files in `repo` that exports use, by path relative to it, with a tooltip. */
export function useExportMarks(repo: string): Map<string, string> {
  const current = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => all
  )
  return useMemo(() => {
    const marks = new Map<string, string>()
    const prefix = repo.replace(/\/$/, '') + '/'
    for (const [unity, sources] of Object.entries(current))
      for (const [abs, exp] of Object.entries(sources))
        if (abs.startsWith(prefix)) {
          const name = unity.split('/').pop()
          marks.set(abs.slice(prefix.length), `Used by ${name}’s native export:\n${exp}\n\nEdits made in ${/\/Libraries\//.test(exp) ? 'Xcode' : 'Android Studio'} land in this file.`)
        }
    return marks
  }, [current, repo])
}
