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

/** The id of a Text compare tab, or null for any other tab. */
export const compareTextId = (tab: string): string | null => (tab.startsWith(COMPARE_TEXT) ? tab.slice(COMPARE_TEXT.length) : null)
