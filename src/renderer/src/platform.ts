// Platform differences in the UI: shortcut labels, the modifier key, file manager wording.
export const isMac = window.spoon.platform === 'darwin'

const NAMES: Record<string, string> = { '⌘': 'Ctrl', '⇧': 'Shift', '⌥': 'Alt', '↵': 'Enter', '⌫': 'Backspace' }
const KEYS: Record<string, string> = { '+': 'Plus', '−': 'Minus', '↵': 'Enter', '⌫': 'Backspace' }

/** Writes shortcuts the Mac way ("⇧⌘F"); on Windows/Linux this returns "Ctrl+Shift+F". */
export function keys(mac: string): string {
  if (isMac) return mac
  return mac
    .split(' ')
    .map((combo) => {
      const mods: string[] = []
      let i = 0
      while (i < combo.length - 1 && '⌘⇧⌥'.includes(combo[i])) mods.push(combo[i++])
      const key = combo.slice(i)
      const order = ['⌘', '⌥', '⇧'].filter((m) => mods.includes(m)).map((m) => NAMES[m])
      return [...order, KEYS[key] ?? NAMES[key] ?? key].join('+')
    })
    .join(' ')
}

/** The "command" modifier: ⌘ on macOS, Ctrl elsewhere. */
export function mod(e: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return isMac ? e.metaKey : e.ctrlKey
}

export const revealLabel = isMac ? 'Reveal in Finder' : 'Show in Explorer'

document.documentElement.classList.add(isMac ? 'platform-mac' : 'platform-win')
