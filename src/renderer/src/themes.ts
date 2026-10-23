// Color themes. Each theme sets the base colors below; hover, selection, diff backgrounds and
// borders are derived from them in styles.css, so a theme (or a custom palette) only needs these.

export type ColorKey =
  | 'bg'
  | 'bg-chrome'
  | 'bg-list'
  | 'bg-panel'
  | 'bg-elev'
  | 'border'
  | 'text'
  | 'text-muted'
  | 'text-faint'
  | 'accent'
  | 'accent-text'
  | 'add'
  | 'del'
  | 'warn'
  | 'danger'
  | 'rename'
  | 'lane-0'
  | 'lane-1'
  | 'lane-2'
  | 'lane-3'
  | 'lane-4'
  | 'lane-5'
  | 'lane-6'
  | 'lane-7'

/** The elements a user can recolor in the Custom theme, in display order. */
export const COLOR_ELEMENTS: { group: string; items: { key: ColorKey; label: string }[] }[] = [
  {
    group: 'Surfaces',
    items: [
      { key: 'bg', label: 'Window background' },
      { key: 'bg-chrome', label: 'Toolbar and sidebar' },
      { key: 'bg-list', label: 'Commit list and diff' },
      { key: 'bg-panel', label: 'Detail panels' },
      { key: 'bg-elev', label: 'Buttons and popups' },
      { key: 'border', label: 'Borders' }
    ]
  },
  {
    group: 'Text and accent',
    items: [
      { key: 'text', label: 'Text' },
      { key: 'text-muted', label: 'Secondary text' },
      { key: 'text-faint', label: 'Faint text' },
      { key: 'accent', label: 'Accent and selection' },
      { key: 'accent-text', label: 'Text on accent' }
    ]
  },
  {
    group: 'Changes and status',
    items: [
      { key: 'add', label: 'Added lines' },
      { key: 'del', label: 'Removed lines' },
      { key: 'rename', label: 'Renamed files' },
      { key: 'warn', label: 'Warnings and tags' },
      { key: 'danger', label: 'Errors' }
    ]
  },
  {
    group: 'Commit graph',
    items: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ key: `lane-${i}` as ColorKey, label: `Lane ${i + 1}` }))
  }
]

export interface ThemeDef {
  name: string
  scheme: 'dark' | 'light'
  colors: Record<ColorKey, string>
  /** Direct overrides of derived tokens, for themes that copy an app exactly. */
  extra?: Record<string, string>
}

const spoonDark: ThemeDef = {
  name: 'Spoon Dark',
  scheme: 'dark',
  colors: {
    bg: '#131418',
    'bg-chrome': '#18191e',
    'bg-list': '#1b1c21',
    'bg-panel': '#1e1f25',
    'bg-elev': '#26272e',
    border: '#2a2c33',
    text: '#e7e8ec',
    'text-muted': '#8f929c',
    'text-faint': '#5f626c',
    accent: '#7b93ff',
    'accent-text': '#ffffff',
    add: '#5fd49a',
    del: '#ff7a85',
    warn: '#e7b85c',
    danger: '#ff7a85',
    rename: '#c792ea',
    'lane-0': '#7b93ff',
    'lane-1': '#f2915f',
    'lane-2': '#4fd1a1',
    'lane-3': '#e7b85c',
    'lane-4': '#c792ea',
    'lane-5': '#4fc3f7',
    'lane-6': '#ff6e9c',
    'lane-7': '#a3d76e'
  }
}

const spoonLight: ThemeDef = {
  name: 'Spoon Light',
  scheme: 'light',
  colors: {
    bg: '#f4f4f6',
    'bg-chrome': '#ececef',
    'bg-list': '#ffffff',
    'bg-panel': '#fafafb',
    'bg-elev': '#ffffff',
    border: '#e1e1e6',
    text: '#1c1d22',
    'text-muted': '#686b76',
    'text-faint': '#a2a4ad',
    accent: '#4f6bed',
    'accent-text': '#ffffff',
    add: '#1d8a4c',
    del: '#c42f42',
    warn: '#b7791f',
    danger: '#d43c4c',
    rename: '#9b5fd0',
    'lane-0': '#4f6bed',
    'lane-1': '#e0703a',
    'lane-2': '#1fa77a',
    'lane-3': '#c79316',
    'lane-4': '#9b5fd0',
    'lane-5': '#1e9fd6',
    'lane-6': '#e0457b',
    'lane-7': '#6aa52e'
  },
  extra: { '--shadow': 'rgba(0, 0, 0, 0.14)' }
}

// Discord's dark theme: server rail #1e1f22, channel sidebar #2b2d31, chat #313338, blurple accent,
// and its gray hover/selected washes instead of tinted ones.
const discord: ThemeDef = {
  name: 'Discord Dark',
  scheme: 'dark',
  colors: {
    bg: '#1e1f22',
    'bg-chrome': '#2b2d31',
    'bg-list': '#313338',
    'bg-panel': '#2b2d31',
    'bg-elev': '#383a40',
    border: '#3f4147',
    text: '#dbdee1',
    'text-muted': '#b5bac1',
    'text-faint': '#80848e',
    accent: '#5865f2',
    'accent-text': '#ffffff',
    add: '#23a55a',
    del: '#f23f43',
    warn: '#f0b232',
    danger: '#f23f43',
    rename: '#eb459e',
    'lane-0': '#5865f2',
    'lane-1': '#23a55a',
    'lane-2': '#f0b232',
    'lane-3': '#eb459e',
    'lane-4': '#00a8fc',
    'lane-5': '#f47b67',
    'lane-6': '#57f287',
    'lane-7': '#b5bac1'
  },
  extra: {
    '--bg-hover': 'rgba(78, 80, 88, 0.3)',
    '--bg-selected': 'rgba(78, 80, 88, 0.48)',
    '--bg-selected-strong': 'rgba(78, 80, 88, 0.6)',
    '--shadow': 'rgba(0, 0, 0, 0.45)'
  }
}

// Claude Desktop: warm neutrals with the clay accent.
const claudeDark: ThemeDef = {
  name: 'Claude Dark',
  scheme: 'dark',
  colors: {
    bg: '#1a1918',
    'bg-chrome': '#1f1e1d',
    'bg-list': '#262624',
    'bg-panel': '#2a2927',
    'bg-elev': '#30302e',
    border: '#3a3935',
    text: '#f5f4ef',
    'text-muted': '#b8b5a9',
    'text-faint': '#85837b',
    accent: '#d97757',
    'accent-text': '#ffffff',
    add: '#7cad6f',
    del: '#e0705f',
    warn: '#d9a74a',
    danger: '#e0705f',
    rename: '#b593d6',
    'lane-0': '#d97757',
    'lane-1': '#6a9bcc',
    'lane-2': '#8fb373',
    'lane-3': '#d9a74a',
    'lane-4': '#b593d6',
    'lane-5': '#5fb3b3',
    'lane-6': '#e08aa4',
    'lane-7': '#a8a08a'
  }
}

const claudeLight: ThemeDef = {
  name: 'Claude Light',
  scheme: 'light',
  colors: {
    bg: '#e9e6dc',
    'bg-chrome': '#f0eee6',
    'bg-list': '#faf9f5',
    'bg-panel': '#f5f4ee',
    'bg-elev': '#ffffff',
    border: '#e0ddd2',
    text: '#1f1e1d',
    'text-muted': '#5e5d59',
    'text-faint': '#9c9a92',
    accent: '#c96442',
    'accent-text': '#ffffff',
    add: '#4f7d3a',
    del: '#b8432f',
    warn: '#a77a1c',
    danger: '#b8432f',
    rename: '#7b5ca8',
    'lane-0': '#c96442',
    'lane-1': '#3f7cb8',
    'lane-2': '#5e8a45',
    'lane-3': '#a77a1c',
    'lane-4': '#7b5ca8',
    'lane-5': '#2f8a8a',
    'lane-6': '#b5507a',
    'lane-7': '#7a735f'
  },
  extra: { '--shadow': 'rgba(40, 30, 10, 0.14)' }
}

export type ThemeChoice = 'system' | 'spoon-dark' | 'spoon-light' | 'discord' | 'claude' | 'custom'
export type BaseThemeChoice = Exclude<ThemeChoice, 'custom'>

export const THEME_CHOICES: { id: ThemeChoice; name: string; hint?: string }[] = [
  { id: 'system', name: 'System', hint: 'Spoon Dark or Light, following macOS' },
  { id: 'spoon-dark', name: 'Spoon Dark' },
  { id: 'spoon-light', name: 'Spoon Light' },
  { id: 'discord', name: 'Discord Dark' },
  { id: 'claude', name: 'Claude', hint: 'Dark or light, following macOS' },
  { id: 'custom', name: 'Custom', hint: 'Pick a color for every element' }
]

export function systemIsDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function resolveTheme(choice: BaseThemeChoice, dark = systemIsDark()): ThemeDef {
  switch (choice) {
    case 'spoon-dark':
      return spoonDark
    case 'spoon-light':
      return spoonLight
    case 'discord':
      return discord
    case 'claude':
      return dark ? claudeDark : claudeLight
    default:
      return dark ? spoonDark : spoonLight
  }
}

/** Distinct, readable colors for auto-assigning authors. */
export const AUTHOR_PALETTE = [
  '#7b93ff',
  '#f2915f',
  '#4fd1a1',
  '#e7b85c',
  '#c792ea',
  '#4fc3f7',
  '#ff6e9c',
  '#a3d76e',
  '#f07178',
  '#89ddff',
  '#ffcb6b',
  '#b39ddb'
]
