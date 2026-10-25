// In-app right-click menus, replacing the native ones. contextMenu(items) opens at the pointer and
// resolves with the chosen item's id (null when dismissed); <MenuHost /> (mounted once, in App)
// draws it. Same items as before: separators, disabled rows, checkbox/radio marks, shortcuts.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MenuItem } from '../../shared/types'
import { keys } from './platform'

interface Open {
  items: MenuItem[]
  x: number
  y: number
  n: number
  resolve: (id: string | null) => void
}

let current: Open | null = null
let counter = 0
const listeners = new Set<() => void>()
const notify = (): void => listeners.forEach((l) => l())

// Where the pointer was at the last right-click (or click), so menus open under it.
let pointer = { x: 0, y: 0 }
for (const type of ['contextmenu', 'mousedown'] as const)
  window.addEventListener(type, (e) => (pointer = { x: e.clientX, y: e.clientY }), true)

function close(id: string | null): void {
  const was = current
  current = null
  notify()
  was?.resolve(id)
}

export function contextMenu(items: MenuItem[]): Promise<string | null> {
  if (current) close(null) // a new menu replaces an open one
  return new Promise((resolve) => {
    current = { items, ...pointer, n: ++counter, resolve }
    notify()
  })
}

/** "CmdOrCtrl+Shift+D" → "⇧⌘D" (or "Ctrl+Shift+D" on Windows). */
function shortcut(accelerator: string): string {
  const parts = accelerator.split('+')
  const key = parts.pop() ?? ''
  const glyph: Record<string, string> = { Shift: '⇧', Alt: '⌥', Option: '⌥', CmdOrCtrl: '⌘', Cmd: '⌘', Command: '⌘', Ctrl: '⌃' }
  const order = ['⌃', '⌥', '⇧', '⌘']
  const mods = parts.map((p) => glyph[p] ?? p).sort((a, b) => order.indexOf(a) - order.indexOf(b))
  const k = key === 'Enter' ? '↵' : key === 'Backspace' ? '⌫' : key.toUpperCase()
  return keys(mods.join('') + k)
}

export function MenuHost() {
  const [, rerender] = useState(0)
  useEffect(() => {
    const l = (): void => rerender((n) => n + 1)
    listeners.add(l)
    return () => void listeners.delete(l)
  }, [])
  const open = current
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; origin: string } | null>(null)
  const [active, setActive] = useState(-1)

  // Open where the pointer is, flipped left/up when it would run off the window.
  useLayoutEffect(() => {
    if (!open || !ref.current) return setPos(null)
    const { width: w, height: h } = ref.current.getBoundingClientRect()
    const flipX = open.x + w > window.innerWidth - 6
    const flipY = open.y + h > window.innerHeight - 6
    setPos({
      left: Math.max(6, flipX ? open.x - w : open.x),
      top: Math.max(6, flipY ? Math.max(6, open.y - h) : open.y),
      origin: `${flipY ? 'bottom' : 'top'} ${flipX ? 'right' : 'left'}`
    })
    setActive(-1)
  }, [open?.n])

  // Keyboard: arrows move, Enter picks, Escape closes. Captured, so nothing behind reacts.
  useEffect(() => {
    if (!open) return
    const usable = open.items.map((it, i) => (!it.separator && it.enabled !== false && it.id ? i : -1)).filter((i) => i >= 0)
    const onKey = (e: KeyboardEvent): void => {
      e.stopPropagation()
      if (e.key === 'Escape') {
        e.preventDefault()
        close(null)
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setActive((a) => {
          const at = usable.indexOf(a)
          const next = e.key === 'ArrowDown' ? at + 1 : at < 0 ? usable.length - 1 : at - 1
          return usable[(next + usable.length) % usable.length] ?? -1
        })
      } else if (e.key === 'Enter') {
        e.preventDefault()
        setActive((a) => {
          if (a >= 0) close(open.items[a].id ?? null)
          return a
        })
      }
    }
    const dismiss = (): void => close(null)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', dismiss)
    window.addEventListener('resize', dismiss)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', dismiss)
      window.removeEventListener('resize', dismiss)
    }
  }, [open?.n])

  if (!open) return null
  return (
    <div
      className="ctx-layer"
      onMouseDown={(e) => {
        if (ref.current?.contains(e.target as Node)) return
        e.preventDefault()
        close(null)
      }}
      onWheel={() => close(null)}
      onContextMenu={(e) => {
        e.preventDefault()
        if (ref.current?.contains(e.target as Node)) return
        // Right-clicking elsewhere closes this menu and opens the one under the pointer.
        close(null)
        const { clientX, clientY } = e
        requestAnimationFrame(() =>
          document
            .elementFromPoint(clientX, clientY)
            ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX, clientY }))
        )
      }}
    >
      <div
        ref={ref}
        key={open.n}
        className="ctx-menu"
        role="menu"
        style={pos ? { left: pos.left, top: pos.top, transformOrigin: pos.origin } : { visibility: 'hidden', left: 0, top: 0 }}
      >
        {open.items.map((it, i) =>
          it.separator ? (
            <div key={i} className="ctx-sep" role="separator" />
          ) : !it.id && it.enabled === false ? (
            <div key={i} className="ctx-heading">
              {it.label}
            </div>
          ) : (
            <button
              key={i}
              role={it.kind === 'checkbox' ? 'menuitemcheckbox' : it.kind === 'radio' ? 'menuitemradio' : 'menuitem'}
              aria-checked={it.kind ? !!it.checked : undefined}
              className={`ctx-item ${active === i ? 'active' : ''}`}
              disabled={it.enabled === false}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(-1)}
              onClick={() => close(it.id ?? null)}
            >
              <span className="ctx-mark">{it.kind && it.checked ? (it.kind === 'radio' ? '•' : '✓') : ''}</span>
              <span className="ctx-label">{it.label}</span>
              {it.accelerator && <kbd className="ctx-key">{shortcut(it.accelerator)}</kbd>}
            </button>
          )
        )}
      </div>
    </div>
  )
}
