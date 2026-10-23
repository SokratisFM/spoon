// Version, platform and built-in configuration (spoon.config.json), plus live update status.
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { AppInfo, UpdateState } from '../../shared/types'

let info: AppInfo | null = null
let update: UpdateState | null = null
const listeners = new Set<() => void>()
const notify = (): void => listeners.forEach((l) => l())

window.spoon.appInfo().then((i) => {
  info = i
  notify()
})
window.spoon.updateState().then((s) => {
  update = s
  notify()
})
window.spoon.onUpdateState((s) => {
  update = s
  notify()
})

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useAppInfo(): AppInfo | null {
  return useSyncExternalStore(subscribe, () => info)
}

export function useUpdateState(): UpdateState | null {
  return useSyncExternalStore(subscribe, () => update)
}

/** Re-renders every minute, for "checked 5 minutes ago" style labels. */
export function useMinuteTick(): void {
  const [, set] = useState(0)
  useEffect(() => {
    const t = setInterval(() => set((n) => n + 1), 60_000)
    return () => clearInterval(t)
  }, [])
}
