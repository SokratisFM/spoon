// The quick file popup: any repository file in an editor, from a right-click (Local Changes, a
// commit's files, Exports) or ⌘E. The working copy can be edited and saved; a commit's version is
// shown read-only, with Restore to put it back in the working copy.
import { useEffect, useRef, useState } from 'react'
import { Text } from '@codemirror/state'
import type { FileContent } from '../../../shared/types'
import { Modal } from './Modal'
import type { Ops } from './RepoView'
import { choose, confirm } from '../dialogs'
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

// The file with unsaved edits in the popup, if any: switching tabs, opening another project or
// closing the window asks first (they'd take the popup away).
let unsaved: string | null = null
export const unsavedEdits = (): string | null => unsaved

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
  // The working copy as saved (and its save time on disk), and as it is in the editor now: kept as
  // documents, compared without copying them out on every keystroke.
  const savedDoc = useRef<Text>(Text.empty)
  const draftDoc = useRef<Text>(Text.empty)
  const savedAt = useRef<number | undefined>(undefined)
  const [edited, setEdited] = useState(false)
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
  const dirty = side === 'working' && !!working && 'content' in working && edited
  useEffect(() => {
    unsaved = dirty ? name : null
    return () => {
      unsaved = null
    }
  }, [dirty, name])

  const loadWorking = async (): Promise<void> => {
    try {
      const content = await window.spoon.readWorkingFile(repo, file)
      setWorking({ content })
      const doc = Text.of((content.text ?? '').replace(/\r\n?/g, '\n').split('\n'))
      savedDoc.current = doc
      draftDoc.current = doc
      savedAt.current = content.mtime
      setEdited(false)
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
      onChange: (doc) => {
        if (sideRef.current !== 'working') return
        draftDoc.current = doc
        setEdited(!doc.eq(savedDoc.current))
      },
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
    ed.setText(side === 'working' ? draftDoc.current.toString() : shown.content.text.replace(/\r\n?/g, '\n'))
    ed.setReadOnly(side !== 'working')
    if (side === 'working') ed.view.focus()
    // Only when the side or what's loaded changes; typing updates `draft` from the editor itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side, shown])

  const save = async (overwrite = false): Promise<void> => {
    // ⌘S with nothing edited does nothing (it would write the file back as it was read).
    if (!editable || saving || !working || !('content' in working) || (!edited && !overwrite)) return
    const doc = editor.current?.view.state.doc ?? draftDoc.current
    setSaving(true)
    let changedOnDisk = false
    const ok = await ops.run(
      `Saving ${name}…`,
      async () => {
        try {
          savedAt.current = await window.spoon.writeWorkingFile(repo, file, doc.toString(), working.content.eol, overwrite ? undefined : savedAt.current)
        } catch (err) {
          if (!/CHANGED_ON_DISK/.test(String(err))) throw err
          changedOnDisk = true
        }
      },
      'Couldn’t save the file'
    )
    setSaving(false)
    if (changedOnDisk) {
      // Saved elsewhere since it was opened (another app, a pull): never overwritten without asking.
      const choice = await choose({
        title: `${name} changed on disk`,
        detail: 'It was saved by something else since you opened it here. Overwrite it with your version, or reload it (your edits here are thrown away)?',
        buttons: [
          { id: 'cancel', label: 'Cancel' },
          { id: 'reload', label: 'Reload' },
          { id: 'overwrite', label: 'Overwrite', kind: 'warn' }
        ],
        cancelId: 'cancel'
      })
      if (choice === 'overwrite') return save(true)
      if (choice === 'reload') {
        await loadWorking()
        editor.current?.setText(draftDoc.current.toString())
      }
      return
    }
    if (ok && !changedOnDisk) {
      savedDoc.current = doc
      setEdited(!draftDoc.current.eq(doc))
    }
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
        ? 'Your unsaved edits here are thrown away, and the file’s current contents are replaced. Uncommitted changes to it go to the Trash first, so you can get them back.'
        : 'The file’s current contents are replaced; it shows up in Local Changes. Uncommitted changes to it go to the Trash first, so you can get them back.',
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
        {shown.content.binary
          ? 'A binary file'
          : shown.content.notUtf8
            ? 'Text that isn’t UTF-8, so it isn’t edited here (saving would damage it)'
            : 'Too big to edit here'}{' '}
        ({sizeText(shown.content.size)}).{' '}
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
              {side === 'working' && shown && 'content' in shown && shown.content.mixedEol && (
                <span className="fe-dirty" title="Some lines end with CRLF and others with LF (or CR): saving gives them all the same ending.">
                  Mixed line endings: saving makes them {shown.content.eol === 'crlf' ? 'CRLF' : 'LF'} ·{' '}
                </span>
              )}
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
                  editor.current?.setText(savedDoc.current.toString())
                  draftDoc.current = savedDoc.current
                  setEdited(false)
                }}
              >
                Revert
              </button>
            )}
            {side === 'working' && (
              <button className="btn primary" disabled={!dirty || saving} onClick={() => save()}>
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
