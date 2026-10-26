// Syntax colors for diffs. Shiki (TextMate grammars, the ones VS Code uses) splits each line into
// tokens; a theme of placeholder colors sorts them into a few kinds (keyword, string, type…), and
// CSS paints each kind from the current Spoon theme, so the colors follow whatever theme is on.
import { createHighlighterCore, type GrammarState, type HighlighterCore, type ThemeRegistration } from 'shiki/core'
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

const CHUNK = 250
const MAX_LINE = 1000
const pause = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

/**
 * Colors runs of lines (each hunk's old or new side), each run on its own so an unclosed comment or
 * string in one hunk can't color the next. A run goes a couple of hundred lines at a time, carrying
 * the grammar's state across, with a pause in between, so even a huge diff never holds up the
 * window. onRun gets each run's tokens as soon as it's done.
 */
export async function colorRuns(
  runs: string[][],
  lang: string,
  onRun: (run: number, tokens: Token[][]) => void,
  cancelled: () => boolean
): Promise<void> {
  const grammar = lang === 'unity' ? 'yaml' : lang
  if (!GRAMMARS[grammar]) return
  const h = await ready(lang)
  for (let r = 0; r < runs.length; r++) {
    const lines = runs[r]
    const out: Token[][] = []
    let state: GrammarState | undefined
    for (let i = 0; i < lines.length; i += CHUNK) {
      if (cancelled()) return
      const part = lines.slice(i, i + CHUNK)
      const rows = h.codeToTokensBase(part.map((l) => (l.length > MAX_LINE ? '' : l)).join('\n'), {
        lang: grammar,
        theme: 'spoon-kinds',
        grammarState: state,
        tokenizeMaxLineLength: MAX_LINE,
        tokenizeTimeLimit: 50
      })
      state = h.getLastGrammarState(rows)
      part.forEach((text, k) =>
        out.push(
          text.length > MAX_LINE || !rows[k]
            ? [{ text, kind: null }]
            : rows[k].map((t) => ({ text: t.content, kind: KIND_BY_COLOR.get((t.color ?? '').toLowerCase()) ?? null }))
        )
      )
      if (lines.length > CHUNK || r % 8 === 7) await pause()
    }
    onRun(r, out)
  }
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
  if (x.length * y.length > 40_000) return [[], []]
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
 * Reads a scene or prefab once and answers where a line is: the GameObject that owns the component
 * the line is in, and the component ("GameObject “ReplayPanel” › RectTransform"). lineNo is 1-based.
 */
export function unityPlaces(text: string): (lineNo: number) => string | null {
  interface Doc {
    start: number
    type: string
    name?: string
    owner?: string
  }
  const docs: Doc[] = []
  const names = new Map<string, string>() // GameObject file id → its name
  const ids: string[] = []
  let at = 0
  let line = 0
  let doc: Doc | null = null
  let id = ''
  while (at <= text.length) {
    const end = text.indexOf('\n', at)
    const l = text.slice(at, end < 0 ? text.length : end)
    if (l.startsWith('--- !u!')) {
      const head = /^--- !u!(\d+) &(-?\d+)/.exec(l)
      id = head?.[2] ?? ''
      doc = { start: line, type: head ? (UNITY_CLASSES[head[1]] ?? '') : '' }
      docs.push(doc)
      ids.push(id)
    } else if (doc) {
      if (line === doc.start + 1 && /^\w/.test(l)) doc.type = l.replace(/:\s*$/, '')
      else if (doc.name === undefined && l.startsWith('  m_Name: ')) {
        doc.name = l.slice(10)
        if (doc.type === 'GameObject') names.set(id, doc.name)
      } else if (doc.owner === undefined && l.startsWith('  m_GameObject: ')) doc.owner = /fileID: (-?\d+)/.exec(l)?.[1]
    }
    if (end < 0) break
    at = end + 1
    line++
  }
  return (lineNo) => {
    // The last document starting at or before the line.
    let lo = 0
    let hi = docs.length - 1
    let found = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (docs[mid].start <= lineNo - 1) {
        found = mid
        lo = mid + 1
      } else hi = mid - 1
    }
    if (found < 0) return null
    const d = docs[found]
    const type = d.type || 'Object'
    if (type === 'GameObject') return d.name ? `GameObject “${d.name}”` : 'GameObject'
    const owner = d.owner && d.owner !== '0' ? names.get(d.owner) : undefined
    if (owner) return `GameObject “${owner}” › ${type}`
    return d.name ? `${type} “${d.name}”` : type
  }
}
