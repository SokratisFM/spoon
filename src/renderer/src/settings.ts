// User-adjustable appearance. The whole UI is sized in rem, so changing the root font size
// (uiScale) scales every element; row heights are derived from the same numbers.
import { useSyncExternalStore } from 'react'
import { resolveTheme, type BaseThemeChoice, type ColorKey, type ThemeChoice, type ThemeDef } from './themes'

export type Density = 'compact' | 'comfortable' | 'spacious'

export interface AuthorColor {
  name: string // author name (or email), matched case-insensitively
  color: string
}

export interface Settings {
  uiScale: number // 0.8 – 2.0, multiplies everything
  codeSize: number // diff font size in px at 100% scale
  density: Density
  theme: ThemeChoice
  /** The theme the Custom theme starts from; customColors override its colors. */
  customBase: BaseThemeChoice
  customColors: Partial<Record<ColorKey, string>>
  authorColorsEnabled: boolean
  authorColors: AuthorColor[]
}

const BASE_FONT_PX = 13
const KEY = 'spoon.settings'
const DEFAULTS: Settings = {
  uiScale: 1.15,
  codeSize: 12.5,
  density: 'comfortable',
  theme: 'system',
  customBase: 'spoon-dark',
  customColors: {},
  authorColorsEnabled: false,
  authorColors: []
}

export const SCALE_MIN = 0.8
export const SCALE_MAX = 2.0
export const SCALE_STEP = 0.05

const DENSITY_ROW: Record<Density, number> = { compact: 1.85, comfortable: 2.3, spacious: 2.8 }

function load(): Settings {
  try {
    const s = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
    // Themes from before named themes existed.
    if ((s.theme as string) === 'dark') s.theme = 'spoon-dark'
    if ((s.theme as string) === 'light') s.theme = 'spoon-light'
    return s
  } catch {
    return DEFAULTS
  }
}

/** The theme currently on screen, with custom colors applied. */
export function activeTheme(s: Settings): ThemeDef {
  if (s.theme !== 'custom') return resolveTheme(s.theme)
  const base = resolveTheme(s.customBase)
  return { ...base, name: 'Custom', colors: { ...base.colors, ...s.customColors } }
}

let appliedExtra: string[] = []

let current = load()
const listeners = new Set<() => void>()

function apply(s: Settings): void {
  const root = document.documentElement
  root.style.fontSize = `${BASE_FONT_PX * s.uiScale}px`
  root.style.setProperty('--code-size', `${(s.codeSize * s.uiScale).toFixed(2)}px`)
  root.style.setProperty('--row-h', `${rowHeight(s)}px`)
  root.dataset.density = s.density

  const theme = activeTheme(s)
  for (const [key, value] of Object.entries(theme.colors)) root.style.setProperty(`--${key}`, value)
  appliedExtra.forEach((k) => root.style.removeProperty(k))
  appliedExtra = Object.keys(theme.extra ?? {})
  for (const [k, v] of Object.entries(theme.extra ?? {})) root.style.setProperty(k, v)
  root.style.colorScheme = theme.scheme
}
apply(current)
// "System" and "Claude" follow the macOS appearance.
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  apply(current)
  listeners.forEach((l) => l())
})

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

/** Color for a commit author, if author coloring is on and the author is listed. */
export function authorColorMap(s: Settings): Map<string, string> | null {
  if (!s.authorColorsEnabled || s.authorColors.length === 0) return null
  return new Map(s.authorColors.filter((a) => a.name.trim()).map((a) => [a.name.trim().toLowerCase(), a.color]))
}
