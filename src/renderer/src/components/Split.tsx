// Two-pane resizable split. Sizes are stored in rem (for fixed side panels, so they grow
// with the UI scale) or as a fraction of the container (for proportional splits).
import { useRef, type ReactNode } from 'react'
import { ChevronIcon } from './Icons'
import { pxToRem, usePersistentState } from '../hooks'

interface Props {
  id: string
  direction: 'row' | 'column'
  /** 'rem': first pane has a fixed size in rem. 'fraction': first pane takes a share of the space. */
  mode: 'rem' | 'fraction'
  initial: number
  min: number
  max: number
  /**
   * Name of the first pane. When it's dragged (almost) shut, it shrinks to a labelled bar you can
   * click (or drag) to bring it back, so the hidden pane is never lost.
   */
  collapsedLabel?: string
  children: [ReactNode, ReactNode]
}

export function Split({ id, direction, mode, initial, min, max, collapsedLabel, children }: Props) {
  const [size, setSize] = usePersistentState(`spoon.split.${id}`, initial)
  const container = useRef<HTMLDivElement>(null)
  const isRow = direction === 'row'

  // Set while a drag that began on the collapsed bar is in progress, so its trailing click doesn't reset.
  const dragged = useRef(false)

  /** Resize while the pointer moves. Listens on the window, so it survives the bar unmounting mid-drag. */
  const startDrag = (): void => {
    const rect = container.current!.getBoundingClientRect()
    const start = isRow ? rect.left : rect.top
    const total = isRow ? rect.width : rect.height

    const move = (ev: PointerEvent): void => {
      const px = (isRow ? ev.clientX : ev.clientY) - start
      const next = mode === 'rem' ? pxToRem(px) : px / total
      setSize(Math.min(max, Math.max(min, next)))
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.classList.remove('resizing')
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    document.body.classList.add('resizing')
  }
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    startDrag()
  }

  const basis = mode === 'rem' ? `${size}rem` : `${size * 100}%`
  const collapsed = !!collapsedLabel && mode === 'fraction' && size <= 0.04
  return (
    <div ref={container} className={`split split-${direction}`}>
      {collapsed ? (
        <button
          className={`split-collapsed split-collapsed-${direction}`}
          onClick={() => {
            if (!dragged.current) setSize(initial)
            dragged.current = false
          }}
          onPointerDown={(e) => {
            // Dragging the bar works like dragging the divider; a plain click restores.
            if (e.button !== 0) return
            const { clientX: x0, clientY: y0 } = e
            dragged.current = false
            const moved = (ev: PointerEvent): void => {
              if (Math.abs(ev.clientY - y0) + Math.abs(ev.clientX - x0) < 4) return
              done()
              dragged.current = true
              startDrag()
            }
            const done = (): void => {
              window.removeEventListener('pointermove', moved)
              window.removeEventListener('pointerup', done)
            }
            window.addEventListener('pointermove', moved)
            window.addEventListener('pointerup', done)
          }}
          title={`Show ${collapsedLabel.toLowerCase()} (click or drag)`}
        >
          <ChevronIcon className="icon chevron" />
          {collapsedLabel}
        </button>
      ) : (
        <div className="split-pane" style={{ flex: `0 0 ${basis}` }}>
          {children[0]}
        </div>
      )}
      <div
        className={`split-handle ${collapsed ? 'hidden' : ''}`}
        onPointerDown={onPointerDown}
        onDoubleClick={() => setSize(initial)}
        role="separator"
        aria-orientation={isRow ? 'vertical' : 'horizontal'}
      />
      <div className="split-pane split-rest">{children[1]}</div>
    </div>
  )
}
