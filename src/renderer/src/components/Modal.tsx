import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { mod } from '../platform'
import { updateSettings, useSettings } from '../settings'
import { contextMenu } from '../menus'

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
  /** Still loading what it shows: stays centred until it's in, then keeps that top edge. */
  pending?: boolean
  /** Leave Escape/Enter to the caller (the in-app dialogs handle their own keys). */
  ownKeys?: boolean
}

export function Modal({ title, children, onClose, onSubmit, footer, wide, pending, ownKeys }: Props) {
  const id = useRef(0)
  // Every dialog opens in the same place, chosen in Settings: near the top, or centred.
  const top = useSettings().dialogPosition === 'top'
  // Opens centred, then keeps that top edge: content that appears later (an error, a list, another
  // option) makes the dialog grow downward instead of jumping up and down around its middle. It only
  // moves up when it would otherwise run off the bottom of the window, and then only as far as needed.
  const box = useRef<HTMLDivElement>(null)
  const [pinnedTop, setPinnedTop] = useState<number | null>(null)
  useLayoutEffect(() => {
    if (!top && !pending && box.current) setPinnedTop((t) => t ?? Math.max(16, box.current!.getBoundingClientRect().top))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending])
  const fit = (): void => {
    const el = box.current
    const body = el?.querySelector<HTMLElement>(':scope > .modal-body')
    if (!el || !body) return
    const need = el.offsetHeight + body.scrollHeight - body.clientHeight
    setPinnedTop((t) => (t === null ? t : Math.max(16, Math.min(t, window.innerHeight - 16 - need))))
  }
  // Re-fit when the dialog or anything in its body changes size: ResizeObservers on the box and on
  // each of the body's children (re-attached when children come and go), not on every render.
  useEffect(() => {
    const el = box.current
    const body = el?.querySelector<HTMLElement>(':scope > .modal-body')
    if (top || !el || !body) return
    fit()
    const sizes = new ResizeObserver(fit)
    const observeAll = (): void => {
      sizes.disconnect()
      sizes.observe(el)
      for (const child of Array.from(body.children)) sizes.observe(child)
    }
    observeAll()
    const children = new MutationObserver(observeAll)
    children.observe(body, { childList: true })
    window.addEventListener('resize', fit)
    return () => {
      sizes.disconnect()
      children.disconnect()
      window.removeEventListener('resize', fit)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [top])
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
    <div
      className={`modal-backdrop ${top ? 'top' : pinnedTop !== null ? 'pinned' : ''}`}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={box}
        className={`modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-label={title}
        style={!top && pinnedTop !== null ? { marginTop: pinnedTop, maxHeight: `calc(100vh - ${pinnedTop}px - 1rem)` } : undefined}
      >
        <h3
          onContextMenu={async (e) => {
            e.preventDefault()
            const choice = await contextMenu([
              { label: 'Popups open', enabled: false },
              { id: 'center', label: 'In the middle', kind: 'checkbox', checked: !top },
              { id: 'top', label: 'Near the top', kind: 'checkbox', checked: top }
            ])
            if (choice === 'center' || choice === 'top') updateSettings({ dialogPosition: choice })
          }}
        >
          {title}
        </h3>
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
