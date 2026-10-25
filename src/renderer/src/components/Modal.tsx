import { useEffect, useRef, type ReactNode } from 'react'
import { mod } from '../platform'

// Open modals, oldest first: only the topmost answers Escape and Enter.
const stack: number[] = []
let nextId = 0

/** Something layered above the window content is open: a modal, an in-app dialog or a menu. */
export function overlayOpen(): boolean {
  return stack.length > 0 || !!document.querySelector('.ctx-layer')
}

interface Props {
  title: string
  children: ReactNode
  onClose: () => void
  /** Called on ⌘Enter / Enter outside text areas. */
  onSubmit?: () => void
  footer: ReactNode
  wide?: boolean
  /** Pin to the top of the window instead of centering, so the dialog doesn't jump as its content grows. */
  top?: boolean
  /** Leave Escape/Enter to the caller (the in-app dialogs handle their own keys). */
  ownKeys?: boolean
}

export function Modal({ title, children, onClose, onSubmit, footer, wide, top, ownKeys }: Props) {
  const id = useRef(0)
  useEffect(() => {
    id.current = ++nextId
    stack.push(id.current)
    return () => void stack.splice(stack.indexOf(id.current), 1)
  }, [])
  useEffect(() => {
    if (ownKeys) return
    const onKey = (e: KeyboardEvent): void => {
      // Only the topmost modal acts, and not while a menu is open over it.
      if (stack[stack.length - 1] !== id.current || document.querySelector('.ctx-layer')) return
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        onClose()
        return
      }
      if (e.key !== 'Enter' || !onSubmit) return
      const t = e.target as HTMLElement | null
      // Enter on a button, a select or a field that handles Enter itself does that thing, not "submit";
      // in a text area only ⌘Enter submits.
      if (!mod(e) && (t?.closest('button, select, [data-own-enter]') || t instanceof HTMLTextAreaElement)) return
      e.preventDefault()
      e.stopImmediatePropagation()
      onSubmit()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, onSubmit, ownKeys])

  return (
    <div className={`modal-backdrop ${top ? 'top' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-label={title}>
        <h3>{title}</h3>
        <div className="modal-body">{children}</div>
        <div className="modal-footer">{footer}</div>
      </div>
    </div>
  )
}

export function ErrorModal({ title, message, onClose }: { title: string; message: string; onClose: () => void }) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      onSubmit={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={() => navigator.clipboard.writeText(message)}>
            Copy
          </button>
          <button className="btn primary" onClick={onClose} autoFocus>
            OK
          </button>
        </>
      }
    >
      <pre className="git-output">{message}</pre>
    </Modal>
  )
}
