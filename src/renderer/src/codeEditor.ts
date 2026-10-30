// The code editor in the quick file popup: CodeMirror with Spoon's syntax colors (the same --syn-*
// slots the diffs use, so an imported IDE scheme applies here too) and a language per file type,
// each loaded only when a file of that type is opened.
import { Compartment, EditorState, type Extension, type Text } from '@codemirror/state'
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { bracketMatching, HighlightStyle, indentOnInput, LanguageSupport, StreamLanguage, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

const spoonColors = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword, t.bool, t.null], color: 'var(--syn-kw)' },
  { tag: [t.string, t.special(t.string), t.regexp, t.character], color: 'var(--syn-str)' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--syn-com)', fontStyle: 'italic' },
  { tag: [t.typeName, t.className, t.namespace, t.standard(t.typeName)], color: 'var(--syn-type)' },
  { tag: [t.number, t.integer, t.float, t.atom], color: 'var(--syn-num)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: 'var(--syn-fn)' },
  { tag: [t.propertyName, t.attributeName, t.labelName], color: 'var(--syn-prop)' },
  { tag: [t.tagName, t.meta, t.annotation, t.processingInstruction], color: 'var(--syn-tag)' },
  { tag: t.heading, fontWeight: '600', color: 'var(--syn-kw)' },
  { tag: t.link, color: 'var(--syn-str)', textDecoration: 'underline' }
])

const legacy = async (load: () => Promise<Parameters<typeof StreamLanguage.define>[0]>): Promise<Extension> =>
  new LanguageSupport(StreamLanguage.define(await load()))

/** By detectLanguage()'s ids. */
const LOADERS: Record<string, () => Promise<Extension>> = {
  java: async () => (await import('@codemirror/lang-java')).java(),
  kotlin: () => legacy(async () => (await import('@codemirror/legacy-modes/mode/clike')).kotlin),
  csharp: () => legacy(async () => (await import('@codemirror/legacy-modes/mode/clike')).csharp),
  'objective-c': () => legacy(async () => (await import('@codemirror/legacy-modes/mode/clike')).objectiveCpp),
  swift: () => legacy(async () => (await import('@codemirror/legacy-modes/mode/swift')).swift),
  cpp: async () => (await import('@codemirror/lang-cpp')).cpp(),
  c: async () => (await import('@codemirror/lang-cpp')).cpp(),
  hlsl: async () => (await import('@codemirror/lang-cpp')).cpp(),
  shaderlab: async () => (await import('@codemirror/lang-cpp')).cpp(),
  javascript: async () => (await import('@codemirror/lang-javascript')).javascript(),
  typescript: async () => (await import('@codemirror/lang-javascript')).javascript({ typescript: true }),
  tsx: async () => (await import('@codemirror/lang-javascript')).javascript({ typescript: true, jsx: true }),
  json: async () => (await import('@codemirror/lang-json')).json(),
  xml: async () => (await import('@codemirror/lang-xml')).xml(),
  html: async () => (await import('@codemirror/lang-html')).html(),
  css: async () => (await import('@codemirror/lang-css')).css(),
  markdown: async () => (await import('@codemirror/lang-markdown')).markdown(),
  python: async () => (await import('@codemirror/lang-python')).python(),
  yaml: async () => (await import('@codemirror/lang-yaml')).yaml(),
  unity: async () => (await import('@codemirror/lang-yaml')).yaml(),
  shellscript: () => legacy(async () => (await import('@codemirror/legacy-modes/mode/shell')).shell),
  groovy: () => legacy(async () => (await import('@codemirror/legacy-modes/mode/groovy')).groovy),
  toml: () => legacy(async () => (await import('@codemirror/legacy-modes/mode/toml')).toml),
  ini: () => legacy(async () => (await import('@codemirror/legacy-modes/mode/properties')).properties),
  sql: () => legacy(async () => (await import('@codemirror/legacy-modes/mode/sql')).standardSQL)
}

export async function languageExtension(id: string | null): Promise<Extension> {
  const load = id ? LOADERS[id] : undefined
  return load ? load().catch(() => []) : []
}

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: 'var(--code-size)', backgroundColor: 'transparent', color: 'inherit' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6' },
  '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--text-faint)', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'var(--bg-hover)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--text-muted)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor': { borderLeftColor: 'var(--accent-fg)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--bg-selected) !important' },
  '.cm-selectionMatch': { backgroundColor: 'color-mix(in srgb, var(--accent) 16%, transparent)' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--warn) 30%, transparent)' },
  '.cm-searchMatch-selected': { backgroundColor: 'color-mix(in srgb, var(--warn) 55%, transparent)' },
  '.cm-panels': { backgroundColor: 'var(--bg-chrome)', color: 'var(--text)', borderColor: 'var(--border)' },
  '.cm-panel.cm-search input, .cm-panel.cm-search button': { fontSize: '0.85em' }
})

export interface CodeEditor {
  view: EditorView
  setText(text: string): void
  setReadOnly(on: boolean): void
  setLanguage(ext: Extension): void
}

/** An editor in `parent`; `onChange` hears about edits (the document itself: copying it out is up to the caller), `onCursor` about the caret's line and column. */
export function createEditor(
  parent: HTMLElement,
  opts: { onChange: (doc: Text) => void; onCursor: (line: number, col: number) => void; onSave: () => void }
): CodeEditor {
  const readOnly = new Compartment()
  const language = new Compartment()
  let ro = false
  let lang: Extension = []
  const stateFor = (doc: string): EditorState =>
    EditorState.create({
      doc,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        highlightSelectionMatches(),
        search({ top: true }),
        syntaxHighlighting(spoonColors),
        keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => (opts.onSave(), true) }, indentWithTab, ...searchKeymap, ...historyKeymap, ...defaultKeymap]),
        theme,
        readOnly.of(EditorState.readOnly.of(ro)),
        language.of(lang),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) opts.onChange(u.state.doc)
          if (u.docChanged || u.selectionSet) {
            const head = u.state.selection.main.head
            const line = u.state.doc.lineAt(head)
            opts.onCursor(line.number, head - line.from + 1)
          }
        })
      ]
    })
  const view = new EditorView({ parent, state: stateFor('') })
  return {
    view,
    // A new state: switching versions isn't an edit, so it isn't on the undo history either.
    setText: (text) => view.setState(stateFor(text)),
    setReadOnly: (on) => {
      ro = on
      view.dispatch({ effects: readOnly.reconfigure(EditorState.readOnly.of(on)) })
    },
    setLanguage: (ext) => {
      lang = ext
      view.dispatch({ effects: language.reconfigure(ext) })
    }
  }
}
