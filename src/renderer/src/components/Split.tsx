// Two-pane resizable split. Sizes are stored in rem (for fixed side panels, so they grow
// with the UI scale) or as a fraction of the container (for proportional splits).
import { useRef, type ReactNode } from 'react'
import { pxToRem, usePersistentState } from '../hooks'

interface Props {
  id: string
  direction: 'row' | 'column'
  /** 'rem': first pane has a fixed size in rem. 'fraction': first pane takes a share of the space. */
  mode: 'rem' | 'fraction'
  initial: number
  min: number
  max: number
  children: [ReactNode, ReactNode]
}

export function Split({ id, direction, mode, initial, min, max, children }: Props) {
  const [size, setSize] = usePersistentState(`spoon.split.${id}`, initial)
  const container = useRef<HTMLDivElement>(null)
  const isRow = direction === 'row'

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    const handle = e.currentTarget
    handle.setPointerCapture(e.pointerId)
    const rect = container.current!.getBoundingClientRect()
    const start = isRow ? rect.left : rect.top
    const total = isRow ? rect.width : rect.height

    const move = (ev: PointerEvent): void => {
      const px = (isRow ? ev.clientX : ev.clientY) - start
      const next = mode === 'rem' ? pxToRem(px) : px / total
      setSize(Math.min(max, Math.max(min, next)))
    }
    const up = (): void => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      document.body.classList.remove('resizing')
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    document.body.classList.add('resizing')
  }

  const basis = mode === 'rem' ? `${size}rem` : `${size * 100}%`
  return (
    <div ref={container} className={`split split-${direction}`}>
      <div className="split-pane" style={{ flex: `0 0 ${basis}` }}>
        {children[0]}
      </div>
      <div
        className="split-handle"
        onPointerDown={onPointerDown}
        onDoubleClick={() => setSize(initial)}
        role="separator"
        aria-orientation={isRow ? 'vertical' : 'horizontal'}
      />
      <div className="split-pane split-rest">{children[1]}</div>
    </div>
  )
}
