// Syntax colors from the IDEs on this Mac: the scheme Rider is using (read from the app, since the
// settings folder only keeps the changes) and the theme VS Code or Cursor is using. Each is turned
// into Spoon's few color slots, noting which IDE color each slot took and how close a match it is.
import { execFile } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import type { SyntaxPalette, SyntaxSlot } from '../shared/types'

const HOME = homedir()
const SUPPORT = join(HOME, 'Library', 'Application Support')

function unzip(args: string[]): Promise<string> {
  return new Promise((done, fail) =>
    execFile('unzip', args, { maxBuffer: 20 * 1024 * 1024 }, (err, out) => (err ? fail(err) : done(out)))
  )
}

const luminance = (hex: string): number => {
  const n = parseInt(hex.replace('#', '').slice(0, 6).padEnd(6, '0'), 16)
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
}
const color = (v: string | undefined): string | undefined => {
  if (!v) return undefined
  const hex = v.replace('#', '').trim()
  return /^[0-9a-f]{3,8}$/i.test(hex) ? `#${hex.padStart(6, '0').slice(0, 6).toLowerCase()}` : undefined
}

// ---------- JetBrains (Rider) ----------

/** attribute name → its colors, or the attribute it takes them from. */
type Attrs = Map<string, { fg?: string; bg?: string; base?: string }>

function parseScheme(xml: string): { name: string; attrs: Attrs; original?: string } {
  const name = /<scheme name="([^"]+)"/.exec(xml)?.[1] ?? 'Scheme'
  const original = /<property name="originalScheme">([^<]+)</.exec(xml)?.[1]
  const attrs: Attrs = new Map()
  const section = /<attributes>([\s\S]*?)<\/attributes>/.exec(xml)?.[1] ?? ''
  for (const m of section.matchAll(/<option name="([^"]+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/option>)/g)) {
    const base = /baseAttributes="([^"]+)"/.exec(m[2])?.[1]
    const inner = m[3] ?? ''
    attrs.set(m[1], {
      base,
      fg: color(/name="FOREGROUND" value="([^"]*)"/.exec(inner)?.[1]),
      bg: color(/name="BACKGROUND" value="([^"]*)"/.exec(inner)?.[1])
    })
  }
  return { name, attrs, original }
}

const RIDER_SLOTS: Record<SyntaxSlot, string[]> = {
  kw: ['DEFAULT_KEYWORD'],
  str: ['DEFAULT_STRING'],
  com: ['DEFAULT_LINE_COMMENT', 'DEFAULT_BLOCK_COMMENT'],
  type: ['DEFAULT_CLASS_REFERENCE', 'DEFAULT_CLASS_NAME'],
  num: ['DEFAULT_NUMBER'],
  fn: ['DEFAULT_FUNCTION_CALL', 'DEFAULT_FUNCTION_DECLARATION'],
  prop: ['YAML_SCALAR_KEY', 'JSON_PROPERTY_KEY', 'DEFAULT_INSTANCE_FIELD'],
  tag: ['XML_TAG_NAME', 'DEFAULT_TAG']
}

function riderPalette(scheme: { name: string; attrs: Attrs }, id: string, app: string, active: boolean): SyntaxPalette {
  const fgOf = (name: string, depth = 0): string | undefined => {
    const a = scheme.attrs.get(name)
    if (!a || depth > 8) return undefined
    return a.fg ?? (a.base ? fgOf(a.base, depth + 1) : undefined)
  }
  const colors: SyntaxPalette['colors'] = {}
  const origin: SyntaxPalette['origin'] = {}
  for (const [slot, names] of Object.entries(RIDER_SLOTS) as [SyntaxSlot, string[]][]) {
    const i = names.findIndex((n) => fgOf(n))
    if (i < 0) continue
    colors[slot] = fgOf(names[i])
    origin[slot] = { from: names[i], exact: i === 0 }
  }
  const text = scheme.attrs.get('TEXT')
  const seen = new Set<string>()
  const choices: [string, string][] = []
  // Only the colors of code (not the console, breadcrumbs and such), the general ones first.
  const codeNames = [...scheme.attrs.keys()]
    .filter((n) => /^(DEFAULT_|YAML_|XML_|JSON_|HTML_|CSS_|JS\.|ReSharper\.|SHADER|HLSL|CSHARP|MARKDOWN)/.test(n))
    .sort((a, b) => Number(!a.startsWith('DEFAULT_')) - Number(!b.startsWith('DEFAULT_')) || a.localeCompare(b))
  for (const name of codeNames) {
    const fg = fgOf(name)
    if (fg && !seen.has(fg)) {
      seen.add(fg)
      choices.push([name, fg])
    }
  }
  const bg = text?.bg
  return {
    id,
    name: scheme.name.replace(/^_@user_/, '').replace(/^Rider /, ''),
    source: 'rider',
    app,
    active,
    dark: bg ? luminance(bg) < 0.5 : true,
    bg,
    fg: text?.fg,
    colors,
    origin,
    choices
  }
}

const versionOf = (dir: string): number[] => (/(\d{4})\.(\d+)/.exec(dir) ?? []).slice(1).map(Number)

async function riderSchemes(): Promise<SyntaxPalette[]> {
  const jb = join(SUPPORT, 'JetBrains')
  if (!existsSync(jb)) return []
  const config = readdirSync(jb)
    .filter((d) => /^Rider\d{4}\.\d+$/.test(d))
    .sort((a, b) => {
      const [x, y] = [versionOf(a), versionOf(b)]
      return y[0] - x[0] || y[1] - x[1]
    })[0]
  if (!config) return []
  const app = ['/Applications/Rider.app', join(HOME, 'Applications', 'Rider.app')].find((p) => existsSync(p))
  let activeName: string | undefined
  try {
    activeName = /global_color_scheme name="([^"]+)"/.exec(readFileSync(join(jb, config, 'options', 'colors.scheme.xml'), 'utf8'))?.[1]
  } catch {
    activeName = undefined
  }
  if (!activeName) return []
  const plain = (n: string): string => n.replace(/^_@user_/, '')
  // A scheme saved in the settings folder, if it has its own colors (not just a font change).
  let scheme: ReturnType<typeof parseScheme> | null = null
  const userDir = join(jb, config, 'colors')
  if (existsSync(userDir))
    for (const f of readdirSync(userDir).filter((f) => f.endsWith('.icls'))) {
      const s = parseScheme(readFileSync(join(userDir, f), 'utf8'))
      if (plain(s.name) === plain(activeName) && s.attrs.size > 20) scheme = s
    }
  // Otherwise the one that ships with Rider.
  if (!scheme && app) {
    const jars = [join(app, 'Contents', 'plugins', 'rider-theme-pack', 'lib', 'rider-theme-pack.jar')].filter(existsSync)
    for (const jar of jars) {
      const entries = (await unzip(['-Z1', jar])).split('\n').filter((e) => /^colorSchemes\/.*\.xml$/.test(e))
      for (const entry of entries) {
        const s = parseScheme(await unzip(['-p', jar, entry]))
        if (plain(s.name) === plain(activeName)) {
          scheme = s
          break
        }
      }
      if (scheme) break
    }
  }
  if (!scheme) return []
  const [major, minor] = versionOf(config)
  return [riderPalette(scheme, `rider:${plain(activeName)}`, `Rider ${major}.${minor}`, true)]
}

// ---------- VS Code and Cursor ----------

/** JSON with comments and trailing commas, as VS Code writes it. */
function parseJsonc(text: string): unknown {
  let out = ''
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inString) {
      out += c
      if (c === '\\') out += text[++i] ?? ''
      else if (c === '"') inString = false
    } else if (c === '"') {
      inString = true
      out += c
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      out += '\n'
    } else if (c === '/' && text[i + 1] === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
      i++
    } else out += c
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'))
}

interface VsTheme {
  name?: string
  type?: string
  include?: string
  colors?: Record<string, string>
  tokenColors?: Array<{ scope?: string | string[]; settings?: { foreground?: string } }>
}

/** A VS Code theme file with the themes it includes folded in (the file's own rules win). */
function loadVsTheme(file: string, depth = 0): VsTheme {
  const t = parseJsonc(readFileSync(file, 'utf8')) as VsTheme
  if (!t.include || depth > 5) return t
  const base = loadVsTheme(resolve(dirname(file), t.include), depth + 1)
  return {
    ...base,
    ...t,
    colors: { ...base.colors, ...t.colors },
    tokenColors: [...(base.tokenColors ?? []), ...(t.tokenColors ?? [])]
  }
}

const VS_SLOTS: Record<SyntaxSlot, string[]> = {
  kw: ['keyword.control', 'keyword', 'storage.type', 'storage.modifier'],
  str: ['string.quoted.double', 'string'],
  com: ['comment.line', 'comment'],
  type: ['entity.name.type.class', 'entity.name.type', 'support.class', 'support.type'],
  num: ['constant.numeric', 'constant.language'],
  fn: ['entity.name.function', 'support.function'],
  prop: ['support.type.property-name.json', 'entity.name.tag.yaml', 'variable.other.property', 'entity.other.attribute-name'],
  tag: ['entity.name.tag']
}

/** The color a theme gives a scope: the rule whose selector matches it most specifically (later rules win ties). */
function colorForScope(theme: VsTheme, scope: string): { color: string; selector: string } | null {
  let best: { color: string; selector: string; depth: number } | null = null
  for (const rule of theme.tokenColors ?? []) {
    const fg = color(rule.settings?.foreground)
    if (!fg || !rule.scope) continue
    const selectors = (Array.isArray(rule.scope) ? rule.scope : rule.scope.split(',')).map((s) => s.trim())
    for (const sel of selectors) {
      if (sel.includes(' ')) continue // descendant selectors need context Spoon doesn't track
      if (scope === sel || scope.startsWith(`${sel}.`)) {
        const depth = sel.split('.').length
        if (!best || depth >= best.depth) best = { color: fg, selector: sel, depth }
      }
    }
  }
  return best
}

function vsPalette(theme: VsTheme, id: string, name: string, source: 'vscode' | 'cursor' | 'file', app: string, active: boolean): SyntaxPalette {
  const colors: SyntaxPalette['colors'] = {}
  const origin: SyntaxPalette['origin'] = {}
  for (const [slot, scopes] of Object.entries(VS_SLOTS) as [SyntaxSlot, string[]][]) {
    for (let i = 0; i < scopes.length; i++) {
      const hit = colorForScope(theme, scopes[i])
      if (hit) {
        colors[slot] = hit.color
        origin[slot] = { from: hit.selector, exact: i === 0 }
        break
      }
    }
  }
  const seen = new Set<string>()
  const choices: [string, string][] = []
  for (const rule of theme.tokenColors ?? []) {
    const fg = color(rule.settings?.foreground)
    if (!fg || seen.has(fg) || !rule.scope) continue
    seen.add(fg)
    choices.push([Array.isArray(rule.scope) ? rule.scope[0] : rule.scope.split(',')[0].trim(), fg])
  }
  const bg = color(theme.colors?.['editor.background'])
  return {
    id,
    name,
    source,
    app,
    active,
    dark: theme.type ? theme.type !== 'light' && theme.type !== 'hcLight' : bg ? luminance(bg) < 0.5 : true,
    bg,
    fg: color(theme.colors?.['editor.foreground']),
    colors,
    origin,
    choices
  }
}

function vsCodeLike(source: 'vscode' | 'cursor'): SyntaxPalette[] {
  const [folder, appPath, extDir, label] =
    source === 'vscode'
      ? ['Code', '/Applications/Visual Studio Code.app', join(HOME, '.vscode', 'extensions'), 'VS Code']
      : ['Cursor', '/Applications/Cursor.app', join(HOME, '.cursor', 'extensions'), 'Cursor']
  const settingsFile = join(SUPPORT, folder, 'User', 'settings.json')
  if (!existsSync(appPath) && !existsSync(extDir)) return []
  let themeName = source === 'vscode' ? 'Default Dark Modern' : 'Cursor Dark'
  try {
    const s = parseJsonc(readFileSync(settingsFile, 'utf8')) as Record<string, unknown>
    if (typeof s['workbench.colorTheme'] === 'string') themeName = s['workbench.colorTheme'] as string
  } catch {
    // No settings yet: the default theme.
  }
  const roots = [join(appPath, 'Contents', 'Resources', 'app', 'extensions'), extDir].filter(existsSync)
  for (const root of roots)
    for (const ext of readdirSync(root)) {
      try {
        const pkg = JSON.parse(readFileSync(join(root, ext, 'package.json'), 'utf8')) as {
          contributes?: { themes?: Array<{ id?: string; label?: string; path: string }> }
        }
        const hit = pkg.contributes?.themes?.find((t) => t.id === themeName || t.label === themeName)
        if (hit) {
          const theme = loadVsTheme(join(root, ext, hit.path))
          return [vsPalette(theme, `${source}:${themeName}`, themeName.replace(/^Default /, ''), source, label, true)]
        }
      } catch {
        // Not a theme extension (or an unreadable one).
      }
    }
  return []
}

// ---------- entry points ----------

/** The schemes the IDEs on this Mac are using right now. */
export async function detect(): Promise<SyntaxPalette[]> {
  if (process.platform !== 'darwin') return []
  const out: SyntaxPalette[] = []
  for (const find of [riderSchemes, async () => vsCodeLike('vscode'), async () => vsCodeLike('cursor')]) {
    try {
      out.push(...(await find()))
    } catch {
      // An IDE whose files can't be read is left out.
    }
  }
  return out
}

/** A scheme or theme file chosen by hand: Rider .icls/.xml or a VS Code theme .json. */
export function importFile(file: string): SyntaxPalette {
  const text = readFileSync(file, 'utf8')
  if (/^\s*<scheme\b/.test(text) || /<scheme name=/.test(text.slice(0, 400))) {
    const s = parseScheme(text)
    if (s.attrs.size < 5) throw new Error('This scheme only holds a few settings, not its colors. Export the full scheme from Rider (Settings → Editor → Color Scheme → ⚙ → Export).')
    return { ...riderPalette(s, `file:${file}`, `File ${basename(file)}`, false), source: 'file' }
  }
  const theme = loadVsTheme(file)
  if (!theme.tokenColors?.length) throw new Error('No token colors found in this file.')
  return vsPalette(theme, `file:${file}`, theme.name ?? basename(file).replace(/\.json$/, ''), 'file', `File ${basename(file)}`, false)
}
