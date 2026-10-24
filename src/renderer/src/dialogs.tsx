// In-app replacements for native message boxes. Call confirm() or choose() from anywhere and await
// the answer; <DialogHost /> (mounted once, last in App) shows the requests one at a time.
import { useEffect, useRef, useState } from 'react'
import { Modal } from './components/Modal'

export interface DialogButton {
  id: string
  label: string
  /** primary: the default (Enter); warn: the default, for something that can't easily be undone. */
  kind?: 'primary' | 'warn'
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
      { id: 'ok', label: opts.confirmLabel, kind: opts.risky ? 'warn' : 'primary' }
    ]
  })
  return answer === 'ok'
}

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
      e.stopPropagation()
      if (e.key === 'Escape') {
        e.preventDefault()
        answer(req.cancelId)
        return
      }
      // Enter on a focused button presses that button; otherwise it means the default one.
      if ((document.activeElement as HTMLElement | null)?.closest('.app-dialog button')) return
      e.preventDefault()
      const def = req.buttons.find((b) => b.kind) ?? req.buttons[req.buttons.length - 1]
      answer(def.id)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req?.n])

  if (!req) return null
  return (
    <div className="app-dialog" key={req.n}>
      <Modal
        title={req.title}
        onClose={() => answer(req.cancelId)}
        footer={req.buttons.map((b) => (
          <button
            key={b.id}
            className={`btn ${b.kind === 'warn' ? 'primary warn' : b.kind === 'primary' ? 'primary' : ''}`}
            autoFocus={!!b.kind}
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
