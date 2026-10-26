// Syntax colors for diffs. Shiki (TextMate grammars, the ones VS Code uses) splits each line into
// tokens; a theme of placeholder colors sorts them into a few kinds (keyword, string, type…), and
// CSS paints each kind from the current Spoon theme, so the colors follow whatever theme is on.
import { createHighlighterCore, type HighlighterCore, type ThemeRegistration } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import type { CSSProperties } from 'react'
import type { SyntaxPalette, SyntaxSlot } from '../../shared/types'

export type TokenKind = 'kw' | 'str' | 'com' | 'type' | 'num' | 'fn' | 'prop' | 'tag'
export interface Token {
  text: string
  kind: TokenKind | null
}

/** Languages Spoon can color, as [id, label]; "unity" is YAML read the Unity way. */
export const LANGUAGES: [string, string][] = [
  ['csharp', 'C#'],
  ['shaderlab', 'ShaderLab'],
  ['hlsl', 'HLSL'],
  ['unity', 'Unity YAML'],
  ['yaml', 'YAML'],
  ['json', 'JSON'],
  ['xml', 'XML'],
  ['markdown', 'Markdown'],
  ['typescript', 'TypeScript'],
  ['tsx', 'TSX'],
  ['javascript', 'JavaScript'],
  ['python', 'Python'],
  ['shellscript', 'Shell'],
  ['java', 'Java'],
  ['kotlin', 'Kotlin'],
  ['groovy', 'Groovy (Gradle)'],
  ['swift', 'Swift'],
  ['objective-c', 'Objective-C'],
  ['cpp', 'C++'],
  ['c', 'C'],
  ['css', 'CSS'],
  ['html', 'HTML'],
  ['sql', 'SQL'],
  ['toml', 'TOML'],
  ['ini', 'INI']
]

const GRAMMARS: Record<string, () => Promise<{ default: unknown }>> = {
  csharp: () => import('shiki/langs/csharp.mjs'),
  shaderlab: () => import('shiki/langs/shaderlab.mjs'),
  hlsl: () => import('shiki/langs/hlsl.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  xml: () => import('shiki/langs/xml.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  shellscript: () => import('shiki/langs/shellscript.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  kotlin: () => import('shiki/langs/kotlin.mjs'),
  groovy: () => import('shiki/langs/groovy.mjs'),
  swift: () => import('shiki/langs/swift.mjs'),
  'objective-c': () => import('shiki/langs/objective-c.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  c: () => import('shiki/langs/c.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  ini: () => import('shiki/langs/ini.mjs')
}

const UNITY_EXT = new Set([
  'prefab', 'unity', 'asset', 'mat', 'anim', 'controller', 'overridecontroller', 'physicmaterial', 'physicsmaterial2d',
  'playable', 'mixer', 'lighting', 'spriteatlas', 'spriteatlasv2', 'preset', 'signal', 'mask', 'flare', 'guiskin',
  'fontsettings', 'renderTexture', 'cubemap', 'terrainlayer', 'brush', 'shadervariants', 'giparams', 'meta'
].map((e) => e.toLowerCase()))

const BY_EXT: Record<string, string> = {
  cs: 'csharp', shader: 'shaderlab', hlsl: 'hlsl', cginc: 'hlsl', hlslinc: 'hlsl', compute: 'hlsl', fx: 'hlsl',
  yaml: 'yaml', yml: 'yaml', json: 'json', asmdef: 'json', asmref: 'json', inputactions: 'json', jsonc: 'json',
  xml: 'xml', csproj: 'xml', props: 'xml', targets: 'xml', uxml: 'xml', plist: 'xml', xib: 'xml', storyboard: 'xml', svg: 'xml',
  md: 'markdown', markdown: 'markdown', ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'tsx',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'tsx', py: 'python', sh: 'shellscript', bash: 'shellscript',
  zsh: 'shellscript', command: 'shellscript', java: 'java', kt: 'kotlin', kts: 'kotlin', gradle: 'groovy', groovy: 'groovy',
  swift: 'swift', m: 'objective-c', mm: 'objective-c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', h: 'cpp', c: 'c',
  css: 'css', uss: 'css', html: 'html', htm: 'html', sql: 'sql', toml: 'toml', ini: 'ini', cfg: 'ini', editorconfig: 'ini'
}

/** What a file's extension says it is: the key for remembering a chosen language. */
export function extensionOf(path: string): string {
  const name = path.split('/').pop() ?? path
  const dot = name.lastIndexOf('.')
  return (dot > 0 ? name.slice(dot + 1) : name).toLowerCase()
}

/** The language for a file, from its extension (or a Unity YAML header in the diff's first lines). */
export function detectLanguage(path: string, sample = ''): string | null {
  const ext = extensionOf(path)
  if (UNITY_EXT.has(ext) || /^%TAG !u! tag:unity3d\.com/m.test(sample)) return 'unity'
  return BY_EXT[ext] ?? null
}

// Placeholder colors that say which kind a token is; CSS supplies the real colors.
const KIND_COLORS: Record<TokenKind, string> = {
  kw: '#000001', str: '#000002', com: '#000003', type: '#000004', num: '#000005', fn: '#000006', prop: '#000007', tag: '#000008'
}
const KIND_BY_COLOR = new Map(Object.entries(KIND_COLORS).map(([k, c]) => [c, k as TokenKind]))
const THEME: ThemeRegistration = {
  name: 'spoon-kinds',
  type: 'dark',
  fg: '#000000',
  bg: '#ffffff',
  settings: [
    { settings: { foreground: '#000000' } },
    { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: KIND_COLORS.com } },
    { scope: ['string', 'punctuation.definition.string', 'string.quoted', 'markup.inline.raw'], settings: { foreground: KIND_COLORS.str } },
    {
      scope: ['keyword', 'storage', 'storage.type', 'storage.modifier', 'keyword.control', 'keyword.operator.new',
        'keyword.preprocessor', 'meta.preprocessor', 'variable.language', 'markup.heading'],
      settings: { foreground: KIND_COLORS.kw }
    },
    {
      scope: ['entity.name.type', 'entity.name.class', 'entity.name.struct', 'entity.name.interface', 'entity.name.enum',
        'support.type', 'support.class', 'entity.other.inherited-class', 'storage.type.primitive'],
      settings: { foreground: KIND_COLORS.type }
    },
    { scope: ['constant.numeric', 'constant.language', 'constant.character', 'constant.other', 'support.constant'], settings: { foreground: KIND_COLORS.num } },
    { scope: ['entity.name.function', 'support.function', 'meta.function-call entity.name.function'], settings: { foreground: KIND_COLORS.fn } },
    { scope: ['support.type.property-name', 'entity.other.attribute-name', 'entity.name.tag.yaml', 'variable.other.property'], settings: { foreground: KIND_COLORS.prop } },
    { scope: ['entity.name.tag', 'markup.underline.link'], settings: { foreground: KIND_COLORS.tag } }
  ]
}

let highlighter: Promise<HighlighterCore> | null = null
const loaded = new Map<string, Promise<void>>()

async function ready(lang: string): Promise<HighlighterCore> {
  highlighter ??= createHighlighterCore({ themes: [THEME], langs: [], engine: createJavaScriptRegexEngine({ forgiving: true }) })
  const h = await highlighter
  const grammar = lang === 'unity' ? 'yaml' : lang
  if (!loaded.has(grammar)) loaded.set(grammar, GRAMMARS[grammar]().then((m) => h.loadLanguage(m.default as never)))
  await loaded.get(grammar)
  return h
}

/** Splits lines of code into colored tokens; lines too long to be worth it come back uncolored. */
export async function tokenize(lines: string[], lang: string): Promise<Token[][]> {
  if (!GRAMMARS[lang === 'unity' ? 'yaml' : lang]) return lines.map((text) => [{ text, kind: null }])
  const h = await ready(lang)
  const grammar = lang === 'unity' ? 'yaml' : lang
  const rows = h.codeToTokensBase(lines.map((l) => (l.length > 2000 ? '' : l)).join('\n'), { lang: grammar, theme: 'spoon-kinds' })
  return lines.map((text, i) =>
    text.length > 2000 || !rows[i]
      ? [{ text, kind: null }]
      : rows[i].map((t) => ({ text: t.content, kind: KIND_BY_COLOR.get((t.color ?? '').toLowerCase()) ?? null }))
  )
}

/**
 * CSS variables that color diffs from an IDE scheme (none: the Spoon theme's colors), and with
 * `background`, the scheme's background and text color as well.
 */
export function paletteVars(palette: SyntaxPalette | null | undefined, background: boolean): CSSProperties {
  if (!palette) return {}
  const vars: Record<string, string> = {}
  for (const [slot, c] of Object.entries(palette.colors)) if (c) vars[`--ide-${slot}`] = c
  if (background && palette.bg) vars['--ide-bg'] = palette.bg
  if (background && palette.fg) vars['--ide-fg'] = palette.fg
  return vars as CSSProperties
}

/** Names of the slots, for showing how an IDE scheme was translated. */
export const SLOT_LABELS: Record<SyntaxSlot, string> = {
  kw: 'Keywords',
  str: 'Strings',
  com: 'Comments',
  type: 'Types',
  num: 'Numbers',
  fn: 'Functions',
  prop: 'Keys and properties',
  tag: 'Tags'
}

/** A few lines of C# in every color, for samples. */
export const SAMPLE: Token[][] = [
  [{ text: 'yield return', kind: 'kw' }, { text: ' ', kind: null }, { text: 'Wait', kind: 'type' }, { text: '(', kind: null }, { text: '0.25f', kind: 'num' }, { text: ');', kind: null }],
  [{ text: '// replay done', kind: 'com' }],
  [{ text: 'Debug', kind: 'type' }, { text: '.', kind: null }, { text: 'Log', kind: 'fn' }, { text: '(', kind: null }, { text: '"done"', kind: 'str' }, { text: ');', kind: null }]
]

// Detected IDE schemes, kept for a minute (reading Rider's scheme means unpacking it from the app).
let schemes: { at: number; list: Promise<SyntaxPalette[]> } | null = null
export function ideSchemes(fresh = false): Promise<SyntaxPalette[]> {
  if (fresh || !schemes || Date.now() - schemes.at > 60_000) schemes = { at: Date.now(), list: window.spoon.ideSchemes().catch(() => []) }
  return schemes.list
}

// ---------- changed words ----------

/** Where two versions of a line differ, as [start, end) ranges in each: words, not characters. */
export function changedWords(a: string, b: string): [Array<[number, number]>, Array<[number, number]>] {
  const split = (s: string): string[] => s.match(/\w+|\s+|[^\w\s]/g) ?? []
  const x = split(a)
  const y = split(b)
  if (x.length * y.length > 250_000) return [[], []]
  // Longest common subsequence of the words; whatever isn't in it changed.
  const dp = Array.from({ length: x.length + 1 }, () => new Uint16Array(y.length + 1))
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const ra: Array<[number, number]> = []
  const rb: Array<[number, number]> = []
  const mark = (list: Array<[number, number]>, from: number, len: number): void => {
    const last = list[list.length - 1]
    if (last && last[1] === from) last[1] = from + len
    else list.push([from, from + len])
  }
  let i = 0
  let j = 0
  let pa = 0
  let pb = 0
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) {
      pa += x[i++].length
      pb += y[j++].length
    } else if (j < y.length && (i >= x.length || dp[i][j + 1] >= dp[i + 1][j])) {
      mark(rb, pb, y[j].length)
      pb += y[j++].length
    } else {
      mark(ra, pa, x[i].length)
      pa += x[i++].length
    }
  }
  // Nothing in common at all: the whole line changed, which the line color already says.
  const same = dp[0][0]
  return same === 0 ? [[], []] : [ra, rb]
}

// ---------- Unity YAML ----------

/** Object references and GUIDs, which matter to Unity but not to the reader: shown faded. */
export function unityIds(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (const m of text.matchAll(/\{fileID: -?\d+(?:, guid: [0-9a-f]{32}(?:, type: \d+)?)?\}|\bguid: [0-9a-f]{32}|&-?\d{3,}|--- !u!\d+/g))
    out.push([m.index!, m.index! + m[0].length])
  return out
}

/** Unity class names of the documents a scene or prefab is made of, by class id. */
const UNITY_CLASSES: Record<string, string> = { '1': 'GameObject', '4': 'Transform', '224': 'RectTransform', '1001': 'PrefabInstance', '114': 'MonoBehaviour' }

/**
 * Names where in a scene or prefab a line is: the GameObject that owns the component the line is in,
 * and the component ("GameObject “ReplayPanel” › RectTransform"). lineNo is 1-based.
 */
export function unityPlace(file: string[], lineNo: number): string | null {
  let start = -1
  for (let i = Math.min(lineNo - 1, file.length - 1); i >= 0; i--)
    if (file[i].startsWith('--- !u!')) {
      start = i
      break
    }
  if (start < 0) return null
  const head = /^--- !u!(\d+) &(-?\d+)/.exec(file[start])
  const type = (file[start + 1] ?? '').replace(/:\s*$/, '') || (head ? UNITY_CLASSES[head[1]] : '') || 'Object'
  const docEnd = (from: number): number => {
    let i = from + 1
    while (i < file.length && !file[i].startsWith('--- !u!')) i++
    return i
  }
  const field = (from: number, name: string): string | undefined => {
    const end = docEnd(from)
    for (let i = from + 1; i < end; i++) {
      const m = new RegExp(`^\\s+${name}: (.*)$`).exec(file[i])
      if (m) return m[1]
    }
    return undefined
  }
  if (type === 'GameObject') {
    const name = field(start, 'm_Name')
    return name ? `GameObject “${name}”` : 'GameObject'
  }
  const owner = /fileID: (-?\d+)/.exec(field(start, 'm_GameObject') ?? '')?.[1]
  if (owner && owner !== '0') {
    const at = file.findIndex((l) => l.startsWith('--- !u!1 ') && l.endsWith(`&${owner}`))
    const name = at >= 0 ? field(at, 'm_Name') : undefined
    if (name) return `GameObject “${name}” › ${type}`
  }
  const own = field(start, 'm_Name')
  return own ? `${type} “${own}”` : type
}
