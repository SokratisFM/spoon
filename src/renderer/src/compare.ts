// Comparing any two files: a Compare tab is named by both paths, so it sits in the tab list like a
// repository does and survives a restart.
export const COMPARE = 'compare:'

export const compareTab = (a: string, b: string): string => COMPARE + JSON.stringify([a, b])

/** The two files of a Compare tab, or null for a repository tab. */
export function compareFiles(tab: string): [string, string] | null {
  if (!tab.startsWith(COMPARE)) return null
  try {
    const [a, b] = JSON.parse(tab.slice(COMPARE.length)) as string[]
    return typeof a === 'string' && typeof b === 'string' ? [a, b] : null
  } catch {
    return null
  }
}

export const fileName = (p: string): string => p.split(/[\\/]/).pop() ?? p

/** Opens a Compare tab from anywhere in the window (the App listens). */
export function requestCompare(a: string, b: string): void {
  window.dispatchEvent(new CustomEvent('spoon:compare', { detail: [a, b] }))
}

// Text compare tabs: named by an id; what was typed or pasted on each side is kept under it.
export const COMPARE_TEXT = 'compare-text:'
export const textKey = (id: string): string => `spoon.compareText.${id}`
export interface TextSides {
  from: string
  to: string
}

// Closed Text compare tabs: what was in them is deleted, and their view (unmounting right after) must
// not save it again.
const closedTexts = new Set<string>()
export const textClosed = (id: string): boolean => closedTexts.has(id)
export function forgetText(id: string, remove: (key: string) => void): void {
  closedTexts.add(id)
  remove(textKey(id))
}
/** A closed Text compare tab reopened (⌘Z): it saves again, and its text (if it had any) is put back. */
export function unforgetText(id: string, text: string | null, save: (key: string, value: string) => void): void {
  closedTexts.delete(id)
  if (text !== null) save(textKey(id), text)
}

// What each open Text compare tab holds right now (it's saved a moment after typing pauses): closing
// a tab keeps what was typed last, for ⌘Z.
const live = new Map<string, string>()
export const liveText = (id: string): string | null => live.get(id) ?? null
export const setLiveText = (id: string, text: string | null): void => void (text === null ? live.delete(id) : live.set(id, text))

/** The id of a Text compare tab, or null for any other tab. */
export const compareTextId = (tab: string): string | null => (tab.startsWith(COMPARE_TEXT) ? tab.slice(COMPARE_TEXT.length) : null)
