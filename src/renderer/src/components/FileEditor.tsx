// The quick file popup: any repository file in an editor, from a right-click (Local Changes, a
// commit's files, Exports) or ⌘E. The working copy can be edited and saved; a commit's version is
// shown read-only, with Restore to put it back in the working copy.
import { useEffect, useRef, useState } from 'react'
import type { FileContent } from '../../../shared/types'
import { Modal } from './Modal'
import type { Ops } from './RepoView'
import { confirm } from '../dialogs'
import { cleanError } from '../hooks'
import { useSettings } from '../settings'
import { detectLanguage, LANGUAGES, paletteVars } from '../syntax'
import { createEditor, languageExtension, type CodeEditor } from '../codeEditor'
import { revealLabel } from '../platform'

export interface FileEditRequest {
  repo: string
  /** Relative to the repository. */
  file: string
  /** A commit whose version can be shown (and restored). */
  at?: { hash: string; label: string }
  /** Which one shows first. */
  show?: 'working' | 'commit'
}

/** Opens the popup from anywhere; the repository's view shows it. */
export function openFileEditor(req: FileEditRequest): void {
  window.dispatchEvent(new CustomEvent<FileEditRequest>('spoon:edit-file', { detail: req }))
}

/** Asks the visible view to open its selected file (⌘E); it answers with openFileEditor. */
export const OPEN_SELECTED_FILE = 'spoon:open-selected-file'

type Side = 'working' | 'commit'
type Loaded = { content: FileContent } | { missing: true } | { error: string }

/** In RepoView: shows the popup for requests about this repository. */
export function FileEditorHost({ path, ops }: { path: string; ops: Ops }) {
  const [req, setReq] = useState<FileEditRequest | null>(null)
  useEffect(() => {
    const on = (e: Event): void => {
      const d = (e as CustomEvent<FileEditRequest>).detail
      if (d.repo === path) setReq(d)
    }
    window.addEventListener('spoon:edit-file', on)
    return () => window.removeEventListener('spoon:edit-file', on)
  }, [path])
  return req ? <FileEditor key={`${req.file}|${req.at?.hash}`} req={req} ops={ops} onClose={() => setReq(null)} /> : null
}

const sizeText = (n: number): string => (n < 1024 ? `${n} bytes` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`)

function FileEditor({ req, ops, onClose }: { req: FileEditRequest; ops: Ops; onClose: () => void }) {
  const { repo, file, at } = req
  const settings = useSettings()
  const [side, setSide] = useState<Side>(req.show === 'commit' && at ? 'commit' : 'working')
  const [working, setWorking] = useState<Loaded | null>(null)
  const [commit, setCommit] = useState<Loaded | null>(null)
  // The working copy as saved, and as it is in the editor now.
  const [saved, setSaved] = useState('')
  const [draft, setDraft] = useState('')
  const [cursor, setCursor] = useState({ line: 1, col: 1 })
  const [saving, setSaving] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const editor = useRef<CodeEditor | null>(null)
  const sideRef = useRef(side)
  sideRef.current = side

  const name = file.split('/').pop() ?? file
  const dir = file.slice(0, file.length - name.length).replace(/\/$/, '')
  const langId = detectLanguage(file)
  const langLabel = LANGUAGES.find(([id]) => id === langId)?.[1] ?? null
  const dirty = side === 'working' && working && 'content' in working && draft !== saved

  const loadWorking = async (): Promise<void> => {
    try {
      const content = await window.spoon.readWorkingFile(repo, file)
      setWorking({ content })
      const text = (content.text ?? '').replace(/\r\n/g, '\n')
      setSaved(text)
      setDraft(text)
    } catch (err) {
      const msg = cleanError(err)
      setWorking(/ENOENT|no such file/i.test(msg) ? { missing: true } : { error: msg })
    }
  }
  useEffect(() => {
    loadWorking()
    if (at)
      window.spoon.fileAtCommit(repo, at.hash, file).then(
        (content) => setCommit({ content }),
        (err) => setCommit({ error: cleanError(err) })
      )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The editor: made once, then given whichever version is showing.
  useEffect(() => {
    if (!box.current) return
    const ed = createEditor(box.current, {
      onChange: (text) => sideRef.current === 'working' && setDraft(text),
      onCursor: (line, col) => setCursor({ line, col }),
      onSave: () => void saveRef.current()
    })
    editor.current = ed
    languageExtension(langId).then((ext) => ed.setLanguage(ext))
    return () => ed.view.destroy()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const shown = side === 'working' ? working : commit
  const editable = side === 'working' && !!shown && 'content' in shown && shown.content.text !== null
  useEffect(() => {
    const ed = editor.current
    if (!ed || !shown || !('content' in shown) || shown.content.text === null) return
    ed.setText(side === 'working' ? draft : shown.content.text.replace(/\r\n/g, '\n'))
    ed.setReadOnly(side !== 'working')
    if (side === 'working') ed.view.focus()
    // Only when the side or what's loaded changes; typing updates `draft` from the editor itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side, shown])

  const save = async (): Promise<void> => {
    if (!editable || saving || !working || !('content' in working)) return
    const text = editor.current?.view.state.doc.toString() ?? draft
    setSaving(true)
    const ok = await ops.run(`Saving ${name}…`, () => window.spoon.writeWorkingFile(repo, file, text, working.content.eol), 'Couldn’t save the file')
    setSaving(false)
    if (ok) setSaved(text)
  }
  const saveRef = useRef(save)
  saveRef.current = save

  const close = async (): Promise<void> => {
    if (dirty) {
      const ok = await confirm({
        message: `Close ${name} without saving?`,
        detail: 'Your edits to it are thrown away.',
        confirmLabel: 'Don’t Save',
        risky: true
      })
      if (!ok) return
    }
    onClose()
  }
  const closeRef = useRef(close)
  closeRef.current = close
  // Escape closes, unless the editor's search bar is open (Escape closes that first).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || document.querySelector('.app-dialog, .ctx-layer')) return
      if (box.current?.querySelector('.cm-search')) return
      e.preventDefault()
      void closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const restore = async (): Promise<void> => {
    if (!at) return
    const ok = await confirm({
      message: `Put the ${at.label} version of ${name} in your working copy?`,
      detail: dirty
        ? 'Your unsaved edits are thrown away, and the file’s current contents are replaced (an unstaged change you can discard).'
        : 'The file’s current contents are replaced: it shows up in Local Changes as an unstaged change you can discard.',
      confirmLabel: 'Restore',
      risky: true
    })
    if (!ok) return
    if (await ops.run(`Restoring ${name}…`, () => window.spoon.restoreFileFrom(repo, at.hash, file), 'Couldn’t restore the file')) {
      await loadWorking()
      setSide('working')
    }
  }

  const openDefault = async (): Promise<void> => {
    const err = await window.spoon.openWithDefaultApp(repo, file)
    if (err) await confirm({ message: `Couldn’t open ${name}`, detail: err, confirmLabel: 'OK' })
  }

  const workingExists = !!working && 'content' in working
  const info =
    !shown ? null : 'missing' in shown ? (
      <div className="fe-info muted">{name} isn’t in your working copy (it was deleted or moved).</div>
    ) : 'error' in shown ? (
      <div className="fe-info error-text">{shown.error}</div>
    ) : shown.content.text === null ? (
      <div className="fe-info muted">
        {shown.content.binary ? 'A binary file' : 'Too big to edit here'} ({sizeText(shown.content.size)}).{' '}
        {side === 'working' && (
          <button className="link-btn" onClick={openDefault}>
            Open with Default App
          </button>
        )}
      </div>
    ) : null

  return (
    <div className="file-editor-modal">
      <Modal
        title={name}
        ownKeys
        onClose={() => void close()}
        wide
        titleExtra={
          <span className="fe-title-extra">
            {langLabel && <span className="badge">{langLabel}</span>}
            {at && (
              <span className="segmented fe-sides">
                <button className={side === 'working' ? 'on' : ''} onClick={() => setSide('working')}>
                  Working copy
                </button>
                <button className={side === 'commit' ? 'on' : ''} onClick={() => setSide('commit')} title={at.hash}>
                  At {at.label}
                </button>
              </span>
            )}
          </span>
        }
        footer={
          <>
            <span className="fe-status muted">
              {dirty && <span className="fe-dirty">● Edited · </span>}
              {editable || (side === 'commit' && shown && 'content' in shown && shown.content.text !== null)
                ? `Line ${cursor.line}, column ${cursor.col}${shown && 'content' in shown ? ` · ${shown.content.eol === 'crlf' ? 'CRLF' : 'LF'}` : ''}${side === 'commit' ? ' · read-only' : ''}`
                : ''}
            </span>
            {workingExists && (
              <button className="btn" onClick={() => window.spoon.revealInFinder(`${repo}/${file}`)}>
                {revealLabel}
              </button>
            )}
            {workingExists && (
              <button className="btn" onClick={openDefault}>
                Open with Default App
              </button>
            )}
            {side === 'commit' && at && commit && 'content' in commit && (
              <button className="btn" onClick={restore}>
                Restore This Version…
              </button>
            )}
            {side === 'working' && dirty && (
              <button
                className="btn"
                onClick={() => {
                  editor.current?.setText(saved)
                  setDraft(saved)
                }}
              >
                Revert
              </button>
            )}
            {side === 'working' && (
              <button className="btn primary" disabled={!dirty || saving} onClick={save}>
                Save <kbd className="keyed-key">⌘S</kbd>
              </button>
            )}
            {side === 'commit' && (
              <button className="btn primary" onClick={() => void close()}>
                Done
              </button>
            )}
          </>
        }
      >
        {dir && (
          <div className="fe-path muted mono" title={file}>
            {dir}
          </div>
        )}
        {info}
        <div
          className={`fe-editor diff-lines ${info ? 'hidden' : ''}`}
          ref={box}
          style={paletteVars(settings.syntaxPalette, settings.syntaxIdeBackground)}
        />
      </Modal>
    </div>
  )
}
