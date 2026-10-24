// Remembers the window's size, position, maximized and full-screen state between launches
// (window-state.json in the app's data folder).
import { app, screen, type BrowserWindow, type Rectangle } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

interface WindowState {
  bounds: Rectangle
  maximized: boolean
  fullScreen: boolean
}

const file = (): string => join(app.getPath('userData'), 'window-state.json')

export function loadWindowState(): WindowState | null {
  try {
    if (!existsSync(file())) return null
    const state = JSON.parse(readFileSync(file(), 'utf8')) as WindowState
    // Only reuse the position if it's still on a connected display (a monitor may be gone).
    const area = screen.getDisplayMatching(state.bounds).workArea
    const visible =
      state.bounds.x < area.x + area.width &&
      state.bounds.x + state.bounds.width > area.x &&
      state.bounds.y < area.y + area.height &&
      state.bounds.y + state.bounds.height > area.y
    if (!visible) {
      const { width, height } = state.bounds
      state.bounds = { width, height } as Rectangle // size only; the OS picks the position
    }
    return state
  } catch {
    return null
  }
}

/** Saves on every move/resize/state change (debounced), using the normal (un-maximized) bounds. */
export function trackWindowState(win: BrowserWindow): void {
  let timer: NodeJS.Timeout | null = null
  const save = (): void => {
    if (win.isDestroyed()) return
    const state: WindowState = {
      bounds: win.getNormalBounds(),
      maximized: win.isMaximized(),
      fullScreen: win.isFullScreen()
    }
    try {
      writeFileSync(file(), JSON.stringify(state))
    } catch {
      // best effort
    }
  }
  const later = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(save, 400)
  }
  for (const ev of ['resize', 'move', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'] as const)
    win.on(ev as 'resize', later)
  win.on('close', save)
}
