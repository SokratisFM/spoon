// Shown when a checkout stops because it would overwrite local changes: lists those files and lets
// the user discard some of them, or all of them and check out.
import { useRef, useState } from 'react'
import type { DiscardEntry, FileChange, WorkingTree } from '../../../shared/types'
import { Modal } from './Modal'
import { statusSymbol } from './FileList'

/** The files git names in "…would be overwritten by checkout:" (tracked or untracked), or null. */
export function overwrittenFiles(message: string): string[] | null {
  const files: string[] = []
  let listing = false
  for (const line of message.split('\n')) {
    if (/would be overwritten by (checkout|switch)/.test(line)) listing = true
    else if (listing && /^\s/.test(line) && line.trim()) files.push(line.trim())
    else listing = false
  }
  return files.length ? [...new Set(files)] : null
}

interface Props {
  /** What's being checked out, for the title ("feature/x", "tag v1.2"). */
  description: string
  files: string[]
  /** The repository's changes when the checkout failed: says how each file is changed. */
  tree: WorkingTree
  onClose: () => void
  /** Discards the entries; resolves to whether that worked. */
  discard: (entries: DiscardEntry[]) => Promise<boolean>
  onCheckout: () => void
}

export function CheckoutBlockedDialog({ description, files, tree, onClose, discard, onCheckout }: Props) {
  const [done, setDone] = useState<Set<string>>(new Set())
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const allBtn = useRef<HTMLButtonElement>(null)

  // A file can be changed both staged and unstaged: discarding it undoes both. One that isn't in
  // the status (an ignored file git still won't overwrite) is removed like an untracked one.
  const entriesFor = (p: string): DiscardEntry[] => {
    const hit = (f: FileChange): boolean => f.path === p || f.oldPath === p
    const entries = [
      ...tree.unstaged.filter(hit).map((f) => ({ ...f, staged: false })),
      ...tree.staged.filter(hit).map((f) => ({ ...f, staged: true }))
    ]
    return entries.length ? entries : [{ path: p, status: '?', staged: false }]
  }
  const left = files.filter((p) => !done.has(p))
  const statusOf = (p: string): FileChange['status'] => {
    const e = entriesFor(p)
    return (e.find((x) => !x.staged) ?? e[0]).status
  }

  const go = async (paths: string[]): Promise<void> => {
    setBusy(true)
    const ok = await discard(paths.flatMap(entriesFor))
    setBusy(false)
    if (!ok) return
    const nowDone = new Set([...done, ...paths])
    setDone(nowDone)
    setChecked(new Set())
    setTimeout(() => allBtn.current?.focus()) // Enter goes on to the rest
    // Nothing left in the way: carry on with what the user was doing.
    if (files.every((p) => nowDone.has(p))) {
      onClose()
      onCheckout()
    }
  }
  const toggle = (p: string): void =>
    setChecked((c) => {
      const n = new Set(c)
      if (n.has(p)) n.delete(p)
      else n.add(p)
      return n
    })
  const selected = left.filter((p) => checked.has(p))

  return (
    <Modal
      title={`Can't check out ${description}`}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn" disabled={busy || !selected.length} onClick={() => go(selected)}>
            Discard Selected{selected.length ? ` (${selected.length})` : ''}
          </button>
          <button ref={allBtn} className="btn primary warn" disabled={busy} onClick={() => go(left)} autoFocus>
            Discard All &amp; Check Out
          </button>
        </>
      }
    >
      <p className="dialog-detail">
        Your local changes to {left.length === 1 ? 'this file' : `these ${left.length} files`} would be overwritten.
        Discard them, or commit or stash them first.
      </p>
      <div className="blocked-files">
        {left.map((p) => {
          const status = statusOf(p)
          return (
            <label key={p} className="check blocked-file" title={p}>
              <input type="checkbox" checked={checked.has(p)} onChange={() => toggle(p)} />
              <span className={`status status-${status === '?' ? 'A' : status}`}>{statusSymbol(status)}</span>
              <span className="mono">{p}</span>
            </label>
          )
        })}
      </div>
      <p className="hint">
        Discarded versions go to the Trash, so you can get them back. Once none are left, the checkout goes ahead.
      </p>
    </Modal>
  )
}
