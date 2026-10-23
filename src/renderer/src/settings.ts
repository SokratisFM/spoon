// User-adjustable appearance. The whole UI is sized in rem, so changing the root font size
// (uiScale) scales every element; row heights are derived from the same numbers.
import { useSyncExternalStore } from 'react'

export type Density = 'compact' | 'comfortable' | 'spacious'
export type Theme = 'system' | 'dark' | 'light'

export interface Settings {
  uiScale: number // 0.8 – 2.0, multiplies everything
  codeSize: number // diff font size in px at 100% scale
  density: Density
  theme: Theme
}

const BASE_FONT_PX = 13
const KEY = 'spoon.settings'
const DEFAULTS: Settings = { uiScale: 1.15, codeSize: 12.5, density: 'comfortable', theme: 'system' }

export const SCALE_MIN = 0.8
export const SCALE_MAX = 2.0
export const SCALE_STEP = 0.05

const DENSITY_ROW: Record<Density, number> = { compact: 1.85, comfortable: 2.3, spacious: 2.8 }

function load(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return DEFAULTS
  }
}

let current = load()
const listeners = new Set<() => void>()

function apply(s: Settings): void {
  const root = document.documentElement
  root.style.fontSize = `${BASE_FONT_PX * s.uiScale}px`
  root.style.setProperty('--code-size', `${(s.codeSize * s.uiScale).toFixed(2)}px`)
  root.style.setProperty('--row-h', `${rowHeight(s)}px`)
  root.dataset.density = s.density
  if (s.theme === 'system') delete root.dataset.theme
  else root.dataset.theme = s.theme
}
apply(current)

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch }
  current.uiScale = Math.round(clamp(current.uiScale, SCALE_MIN, SCALE_MAX) * 100) / 100
  current.codeSize = clamp(current.codeSize, 9, 24)
  try {
    localStorage.setItem(KEY, JSON.stringify(current))
  } catch {
    // not persisted; still applied for this session
  }
  apply(current)
  listeners.forEach((l) => l())
}

export function resetScale(): void {
  updateSettings({ uiScale: DEFAULTS.uiScale })
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current
  )
}

/** Height of one list row (commit list, file lists, sidebar) in px. */
export function rowHeight(s: Settings): number {
  return Math.round(BASE_FONT_PX * s.uiScale * DENSITY_ROW[s.density])
}

/** Height of one diff line in px. */
export function codeLineHeight(s: Settings): number {
  return Math.round(s.codeSize * s.uiScale * 1.6)
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
