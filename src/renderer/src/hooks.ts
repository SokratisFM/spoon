import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import * as storage from './storage'

export function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = storage.getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

function writeStored(key: string, value: unknown): void {
  try {
    storage.setItem(key, JSON.stringify(value))
  } catch {
    // storage unavailable; keep in memory only
  }
}

/** useState that survives restarts (layout sizes, collapsed sections, open tabs). */
export function usePersistentState<T>(key: string, fallback: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => readStored(key, fallback))
  const set = useCallback(
    (v: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v
        writeStored(key, next)
        return next
      })
    },
    [key]
  )
  return [value, set]
}

/** Runs an async loader whenever deps change, ignoring results from stale runs. */
export function useAsync<T>(
  load: () => Promise<T>,
  deps: unknown[]
): { data: T | null; error: string | null; loading: boolean } {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({
    data: null,
    error: null,
    loading: true
  })
  const run = useRef(0)
  useEffect(() => {
    const id = ++run.current
    setState((s) => ({ ...s, loading: true }))
    load().then(
      (data) => id === run.current && setState({ data, error: null, loading: false }),
      (err: Error) => id === run.current && setState({ data: null, error: cleanError(err), loading: false })
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return state
}

/**
 * useAsync over a cache: a cached value is returned in the same render (no loading flash), and
 * a fresh one is stored once loaded. A null key means nothing to load.
 */
export function useCachedAsync<T>(
  cache: { get(key: string): T | undefined; set(key: string, v: T): void },
  key: string | null,
  load: () => Promise<T>
): { data: T | null; error: string | null; loading: boolean } {
  const hit = key ? cache.get(key) : undefined
  const res = useAsync(
    () =>
      !key ? Promise.resolve(null) : hit !== undefined ? Promise.resolve(hit) : load().then((v) => (cache.set(key, v), v)),
    [key]
  )
  if (hit !== undefined) return { data: hit, error: null, loading: false }
  // While a new key loads, don't show the previous key's value.
  return res.loading ? { data: null, error: null, loading: true } : (res as { data: T | null; error: string | null; loading: boolean })
}

/** Strip Electron's "Error invoking remote method 'x': Error:" prefix. */
export function cleanError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/** Converts a pixel distance to rem at the current UI scale. */
export function pxToRem(px: number): number {
  return px / parseFloat(getComputedStyle(document.documentElement).fontSize)
}

/**
 * For a row of options (tabs, segmented controls): measures the child with class "on" and exposes
 * its position as CSS variables, so a ::before/::after indicator can slide to it.
 */
export function useSlidingIndicator<T extends HTMLElement>(): React.RefObject<T | null> {
  const ref = useRef<T>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const on = el.querySelector(':scope > .on') as HTMLElement | null
    if (!on) {
      el.style.setProperty('--ind-w', '0px')
      return
    }
    el.style.setProperty('--ind-x', `${on.offsetLeft}px`)
    el.style.setProperty('--ind-y', `${on.offsetTop}px`)
    el.style.setProperty('--ind-w', `${on.offsetWidth}px`)
    el.style.setProperty('--ind-h', `${on.offsetHeight}px`)
  })
  return ref
}
