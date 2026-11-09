// In-app right-click menus, replacing the native ones. contextMenu(items) opens at the pointer and
// resolves with the chosen item's id (null when dismissed); <MenuHost /> (mounted once, in App)
// draws it. Same items as before: separators, disabled rows, checkbox/radio marks, shortcuts.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MenuItem } from '../../shared/types'
import { keys } from './platform'
import { ClaudeIcon, GitHubLogoIcon, JiraLogoIcon, SlackLogoIcon } from './components/Icons'

const ICONS = { jira: JiraLogoIcon, github: GitHubLogoIcon, claude: ClaudeIcon, slack: SlackLogoIcon }

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

/** Closes an open menu without a choice (tab switch, window closing…). */
export function closeMenu(): boolean {
  if (!current) return false
  close(null)
  return true
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
  // In a row of swatches, which one the arrow keys are on.
  const [swatch, setSwatch] = useState(0)

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
    // Take focus, so Space or Enter can't press whatever was focused behind the menu; give it back after.
    const before = document.activeElement as HTMLElement | null
    ref.current.focus({ preventScroll: true })
    return () => before?.focus?.({ preventScroll: true })
  }, [open?.n])

  const activeRef = useRef(active)
  activeRef.current = active
  const swatchRef = useRef(swatch)
  swatchRef.current = swatch

  // Keyboard moves keep the highlighted item in view in long, scrolling menus.
  useEffect(() => {
    ref.current?.querySelector('.ctx-item.active')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  // Keyboard: arrows move, Enter picks, Escape closes. Captured, so nothing behind reacts.
  useEffect(() => {
    if (!open) return
    const usable = open.items.map((it, i) => (!it.separator && it.enabled !== false && (it.id || it.swatches) ? i : -1)).filter((i) => i >= 0)
    const onKey = (e: KeyboardEvent): void => {
      // The menu is the top layer: no key reaches the dialog or the view behind it.
      e.stopImmediatePropagation()
      if (e.key === 'Escape') {
        e.preventDefault()
        close(null)
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setActive((a) => {
          const at = usable.indexOf(a)
          const next = e.key === 'ArrowDown' ? at + 1 : at < 0 ? usable.length - 1 : at - 1
          const to = usable[(next + usable.length) % usable.length] ?? -1
          // Onto a row of swatches: the one that's picked now, else the first.
          const sw = open.items[to]?.swatches
          if (sw) setSwatch(Math.max(0, sw.findIndex((x) => x.checked)))
          return to
        })
      } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && activeRef.current >= 0 && open.items[activeRef.current].swatches) {
        e.preventDefault()
        const n = open.items[activeRef.current].swatches!.length
        setSwatch((k) => (k + (e.key === 'ArrowRight' ? 1 : -1) + n) % n)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const a = activeRef.current
        if (a >= 0) close(open.items[a].swatches?.[swatchRef.current]?.id ?? open.items[a].id ?? null)
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
      onWheel={(e) => {
        // Scrolling a long menu scrolls it; scrolling anywhere else closes it.
        if (!ref.current?.contains(e.target as Node)) close(null)
      }}
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
        tabIndex={-1}
        style={pos ? { left: pos.left, top: pos.top, transformOrigin: pos.origin } : { visibility: 'hidden', left: 0, top: 0 }}
      >
        {open.items.map((it, i) =>
          it.separator ? (
            <div key={i} className="ctx-sep" role="separator" />
          ) : it.swatches ? (
            <div key={i} className="ctx-swatches" onMouseLeave={() => setActive(-1)}>
              {it.swatches.map((sw, k) => (
                <button
                  key={sw.id}
                  className={`ctx-swatch ${sw.color ? '' : 'none'} ${sw.checked ? 'on' : ''} ${active === i && swatch === k ? 'focus' : ''}`}
                  onMouseEnter={() => (setActive(i), setSwatch(k))}
                  style={sw.color ? ({ '--swatch': sw.color } as React.CSSProperties) : undefined}
                  title={sw.label}
                  aria-label={sw.label}
                  onClick={() => close(sw.id)}
                />
              ))}
            </div>
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
              <span className={`ctx-mark ${it.icon ? `ctx-icon ${it.icon}` : ''}`}>
                {it.kind && it.checked ? (it.kind === 'radio' ? '•' : '✓') : it.icon ? (() => {
                  const I = ICONS[it.icon]
                  return <I />
                })() : ''}
              </span>
              <span className="ctx-label">{it.label}</span>
              {it.accelerator && <kbd className="ctx-key">{shortcut(it.accelerator)}</kbd>}
            </button>
          )
        )}
      </div>
    </div>
  )
}
