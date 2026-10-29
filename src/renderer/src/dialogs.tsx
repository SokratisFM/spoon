// In-app replacements for native message boxes. Call confirm() or choose() from anywhere and await
// the answer; <DialogHost /> (mounted once, last in App) shows the requests one at a time.
import { useEffect, useRef, useState } from 'react'
import { Modal } from './components/Modal'

export interface DialogButton {
  id: string
  label: string
  /** primary: the default (Enter); warn: the default, for something that can't easily be undone. */
  kind?: 'primary' | 'warn'
  /** Enter presses it and it starts focused, even when it's a warn button. */
  default?: boolean
}

export interface ChoiceOptions {
  title: string
  detail?: string
  buttons: DialogButton[]
  /** What Escape, the backdrop and ⌘W answer. */
  cancelId: string
}

export interface ConfirmOptions {
  message: string
  detail?: string
  confirmLabel: string
  /** Deletes or discards something: the confirm button turns amber. */
  risky?: boolean
  /** Enter confirms, even when it's risky (the user asked for it, e.g. Discard). */
  enterConfirms?: boolean
}

interface Request extends ChoiceOptions {
  n: number
  resolve: (id: string) => void
}

const queue: Request[] = []
const listeners = new Set<() => void>()
let counter = 0
const notify = (): void => listeners.forEach((l) => l())

export function choose(opts: ChoiceOptions): Promise<string> {
  return new Promise((resolve) => {
    queue.push({ ...opts, n: ++counter, resolve })
    notify()
  })
}

export async function confirm(opts: ConfirmOptions): Promise<boolean> {
  const answer = await choose({
    title: opts.message,
    detail: opts.detail,
    cancelId: 'cancel',
    buttons: [
      { id: 'cancel', label: 'Cancel' },
      { id: 'ok', label: opts.confirmLabel, kind: opts.risky ? 'warn' : 'primary', default: opts.enterConfirms }
    ]
  })
  return answer === 'ok'
}

const defaultOf = (req: ChoiceOptions): DialogButton | undefined =>
  req.buttons.find((b) => b.default) ?? req.buttons.find((b) => b.kind === 'primary')

export function DialogHost() {
  const [, rerender] = useState(0)
  useEffect(() => {
    const l = (): void => rerender((n) => n + 1)
    listeners.add(l)
    return () => void listeners.delete(l)
  }, [])

  const req = queue[0]
  const reqRef = useRef(req)
  reqRef.current = req
  const answer = (id: string): void => {
    const r = reqRef.current
    if (!r) return
    queue.shift()
    r.resolve(id)
    notify()
  }

  // Captured before anything else sees the key, so a dialog opened over another one (or over a
  // view with its own shortcuts) is the only thing Escape and Enter act on.
  useEffect(() => {
    if (!req) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' && e.key !== 'Enter') return
      if (document.querySelector('.ctx-layer')) return // a menu is open on top
      e.stopImmediatePropagation()
      if (e.key === 'Escape') {
        e.preventDefault()
        answer(req.cancelId)
        return
      }
      // Enter on a focused button presses that button. Otherwise it means the default button; a risky
      // one (delete, discard) is pressed by Enter only when the dialog says so.
      if ((document.activeElement as HTMLElement | null)?.closest('.app-dialog button')) return
      e.preventDefault()
      const def = defaultOf(req)
      if (def) answer(def.id)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req?.n])

  if (!req) return null
  const def = defaultOf(req)
  return (
    <div className="app-dialog" key={req.n}>
      <Modal
        title={req.title}
        ownKeys
        onClose={() => answer(req.cancelId)}
        footer={req.buttons.map((b) => (
          <button
            key={b.id}
            className={`btn ${b.kind === 'warn' ? 'primary warn' : b.kind === 'primary' ? 'primary' : ''}`}
            autoFocus={def ? b === def : b.id === req.cancelId}
            onClick={() => answer(b.id)}
          >
            {b.label}
          </button>
        ))}
      >
        {req.detail && <p className="dialog-detail">{req.detail}</p>}
      </Modal>
    </div>
  )
}
