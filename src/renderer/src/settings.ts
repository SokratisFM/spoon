// User-adjustable appearance. The whole UI is sized in rem, so changing the root font size
// (uiScale) scales every element; row heights are derived from the same numbers.
import { useSyncExternalStore } from 'react'
import { resolveTheme, type BaseThemeChoice, type ColorKey, type ThemeChoice, type ThemeDef } from './themes'
import * as storage from './storage'

export type Density = 'compact' | 'comfortable' | 'spacious'
export type DiffLayout = 'unified' | 'split'
/** grouped: submodule tabs sit next to their parent's tab; labelled: tabs stay put, with an "in parent" line. */
export type SubmoduleTabs = 'grouped' | 'labelled'
/** How tags show in the commit list: collapsed onto the graph dot (diamond or count badge), as one chip, or all. */
export type TagDisplay = 'diamond' | 'badge' | 'chip' | 'all'
/** How the checked-out commit stands out: tinted row with an edge bar, a HEAD label, or a glowing dot. */
export type HeadHighlight = 'band' | 'pill' | 'ring'

export type SidebarSection = 'submodules' | 'branches' | 'remotes' | 'tags' | 'stashes' | 'stale'
export const SIDEBAR_SECTIONS: { id: SidebarSection; label: string }[] = [
  { id: 'submodules', label: 'Submodules' },
  { id: 'branches', label: 'Branches' },
  { id: 'remotes', label: 'Remotes' },
  { id: 'tags', label: 'Tags' },
  { id: 'stashes', label: 'Stashes' },
  { id: 'stale', label: 'Stale branches' }
]

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
  /** Folder the project palette searches for repos you haven't opened yet. */
  scanFolder: string
  scanDepth: number
  scanNested: boolean
  /** Client ID of your own GitHub OAuth app, for "Sign in with browser". */
  githubClientId: string
  /** Sidebar sections in display order; hidden ones keep their place for when they're shown again. */
  sidebarSections: { id: SidebarSection; visible: boolean }[]
  /** Extra pull request groups; "Awaiting your review" is always shown. */
  prGroups: { yours: boolean; others: boolean }
  /** unified: one column with − and + lines; split: old file left, new file right. */
  diffLayout: DiffLayout
  submoduleTabs: SubmoduleTabs
  tagDisplay: TagDisplay
  headHighlight: HeadHighlight
  /** Branch labels show a cloud when the branch is also on a remote; this adds the remote's name. */
  showRemoteName: boolean
  /** Branch labels in their graph line's color (like Fork) instead of the accent color. */
  laneColoredBranches: boolean
  /** Fetch/Pull/Push play a little scene (dog, rope, big button) while they run. */
  playfulNet: boolean
  /** Branch colors (0–7, the theme's lane colors) reserved for branch-name prefixes. */
  reservedColors: Record<number, string[]>
  /** Reserved colors also apply to the branch's line in the graph. */
  reservedColorsGraph: boolean
  /** Jira site, e.g. https://acme.atlassian.net — ticket keys in branches and commits link to it. */
  jiraSite: string
  /** Optional project keys (e.g. "MAINLIB, CANFA") to limit which keys become links. */
  jiraProjects: string
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
  authorColors: [],
  scanFolder: '~',
  scanDepth: 3,
  scanNested: false,
  githubClientId: '',
  sidebarSections: SIDEBAR_SECTIONS.map((x) => ({ id: x.id, visible: true })),
  prGroups: { yours: false, others: false },
  diffLayout: 'unified',
  submoduleTabs: 'grouped',
  tagDisplay: 'diamond',
  headHighlight: 'band',
  showRemoteName: false,
  laneColoredBranches: true,
  playfulNet: false,
  reservedColors: {},
  reservedColorsGraph: true,
  jiraSite: 'https://fm-games.atlassian.net',
  jiraProjects: ''
}

export const SCALE_MIN = 0.8
export const SCALE_MAX = 2.0
export const SCALE_STEP = 0.05

const DENSITY_ROW: Record<Density, number> = { compact: 1.85, comfortable: 2.3, spacious: 2.8 }

function load(): Settings {
  try {
    const s = { ...DEFAULTS, ...JSON.parse(storage.getItem(KEY) ?? '{}') }
    // Themes from before named themes existed.
    if ((s.theme as string) === 'dark') s.theme = 'spoon-dark'
    if ((s.theme as string) === 'light') s.theme = 'spoon-light'
    // Sections added in later versions go to the end, visible.
    const known = new Set(s.sidebarSections.map((x: { id: SidebarSection }) => x.id))
    s.sidebarSections = [
      ...s.sidebarSections.filter((x: { id: SidebarSection }) => SIDEBAR_SECTIONS.some((d) => d.id === x.id)),
      ...SIDEBAR_SECTIONS.filter((d) => !known.has(d.id)).map((d) => ({ id: d.id, visible: true }))
    ]
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
  // Windows draws its caption buttons natively over the title bar; match them to the theme.
  window.spoon.setTitleBarColors?.(theme.colors['bg-chrome'], theme.colors.text, BASE_FONT_PX * s.uiScale * 3)
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
    storage.setItem(KEY, JSON.stringify(current))
  } catch {
    // not persisted; still applied for this session
  }
  apply(current)
  listeners.forEach((l) => l())
}

export function resetScale(): void {
  updateSettings({ uiScale: DEFAULTS.uiScale })
}

/** Current settings, for code outside React. */
export function getSettings(): Settings {
  return current
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

/** Prefix → reserved color index, longest prefix first so "feature/ui/" beats "feature/". */
export function reservedPrefixes(s: Settings): [string, number][] {
  return Object.entries(s.reservedColors)
    .flatMap(([i, prefixes]) => prefixes.map((p) => [p, Number(i)] as [string, number]))
    .sort((a, b) => b[0].length - a[0].length)
}
