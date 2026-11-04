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

/** Opens Compare Branches for a repository from anywhere in the window (the App listens). */
export interface BranchDiffRequest {
  path: string
  base: string
  compare: string
}
export function requestBranchDiff(req: BranchDiffRequest): void {
  window.dispatchEvent(new CustomEvent('spoon:branchDiff', { detail: req }))
}

const MAIN_LINES = ['main', 'master', 'develop', 'origin/main', 'origin/master', 'origin/develop']

/** A ref as people name it: refs/heads/main → main, refs/remotes/origin/main → origin/main, refs/tags/v1 → v1. */
export const shortRef = (ref: string): string => ref.replace(/^refs\/(heads|remotes|tags)\//, '')

/**
 * What a branch is usually compared against: the main line (main, master, develop…) other than it.
 * Branches are full ref names (refs/heads/…), so a tag with a branch's name is never taken for it.
 */
export function mainLine(branches: string[], not?: string | null): string | undefined {
  const others = branches.filter((b) => b !== not)
  for (const m of MAIN_LINES) {
    const hit = others.find((b) => shortRef(b) === m && b.startsWith(m.includes('/') ? 'refs/remotes/' : 'refs/heads/'))
    if (hit) return hit
  }
  return others[0]
}

/**
 * The branches Compare offers first: the checked-out branch against the main line, or, when the
 * main line is what's checked out, the branch checked out before it against the main line.
 * head and recent are branch names; the result is full ref names.
 */
export function defaultPair(branches: string[], head: string | null, recent: string[]): { base: string; compare: string } | null {
  const full = (name: string): string => `refs/heads/${name}`
  if (head && MAIN_LINES.includes(head)) {
    const compare =
      recent.map(full).find((b) => b !== full(head) && branches.includes(b)) ??
      branches.find((b) => b !== full(head) && !MAIN_LINES.includes(shortRef(b)))
    return compare ? { base: full(head), compare } : null
  }
  const compare = head ? full(head) : branches[0]
  const base = mainLine(branches, compare)
  return compare && base ? { base, compare } : null
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
// Kept as the sides themselves (turned into text only when a tab closes, not on every key).
const live = new Map<string, TextSides>()
export const liveText = (id: string): string | null => {
  const sides = live.get(id)
  return sides ? JSON.stringify(sides) : null
}
export const setLiveText = (id: string, sides: TextSides | null): void => void (sides === null ? live.delete(id) : live.set(id, sides))

/** The id of a Text compare tab, or null for any other tab. */
export const compareTextId = (tab: string): string | null => (tab.startsWith(COMPARE_TEXT) ? tab.slice(COMPARE_TEXT.length) : null)
