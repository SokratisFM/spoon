import { useEffect, type ReactNode } from 'react'
import { mod } from '../platform'

interface Props {
  title: string
  children: ReactNode
  onClose: () => void
  /** Called on ⌘Enter / Enter outside text areas. */
  onSubmit?: () => void
  footer: ReactNode
  wide?: boolean
}

export function Modal({ title, children, onClose, onSubmit, footer, wide }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'Enter' && onSubmit && (mod(e) || !(e.target instanceof HTMLTextAreaElement))) {
        e.preventDefault()
        onSubmit()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onSubmit])

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
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
