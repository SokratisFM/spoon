// Every project Spoon has opened, kept until you remove it (like Fork's repository list).
import { useSyncExternalStore } from 'react'
import { readStored } from './hooks'
import * as storage from './storage'

export interface Project {
  path: string
  lastOpened: number
}

const KEY = 'spoon.projects'
const listeners = new Set<() => void>()

function initial(): Project[] {
  const saved = readStored<Project[] | null>(KEY, null)
  if (saved) return saved
  // First run with a project list: seed it from the old recents and open tabs.
  const seed = [...readStored<string[]>('spoon.recents', []), ...readStored<string[]>('spoon.tabs', [])]
  const now = Date.now()
  return [...new Set(seed)].map((path, i) => ({ path, lastOpened: now - i }))
}

let projects = initial()

function save(next: Project[]): void {
  projects = next.sort((a, b) => b.lastOpened - a.lastOpened)
  try {
    storage.setItem(KEY, JSON.stringify(projects))
  } catch {
    // keep in memory
  }
  listeners.forEach((l) => l())
}
save(projects)

export function rememberProject(path: string): void {
  save([{ path, lastOpened: Date.now() }, ...projects.filter((p) => p.path !== path)])
}

// A removed project's other settings (Simple Mode, Unity exports) are dropped by their own modules.
const forgotten = (paths: string[]): void =>
  paths.forEach((path) => window.dispatchEvent(new CustomEvent<string>('spoon:project-forgotten', { detail: path })))

export function forgetProject(path: string): void {
  save(projects.filter((p) => p.path !== path))
  forgotten([path])
}

export function forgetProjects(paths: string[]): void {
  const drop = new Set(paths)
  save(projects.filter((p) => !drop.has(p.path)))
  forgotten(paths)
}

export function useProjects(): Project[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => projects
  )
}

export function projectName(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path
}

/** "/Users/me/code/x" -> "~/code/x" for display. */
export function tildify(path: string, home: string): string {
  return home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path
}

/**
 * Fuzzy match: every query character must appear in order. Higher scores for matches in the
 * name, at word starts and in runs; null when it doesn't match at all.
 */
export function fuzzyScore(query: string, name: string, path: string): number | null {
  const q = query.toLowerCase().replace(/\s+/g, '')
  if (!q) return 0
  const inName = subsequence(q, name.toLowerCase())
  if (inName !== null) return 1000 + inName
  const inPath = subsequence(q, path.toLowerCase())
  return inPath === null ? null : inPath
}

function subsequence(q: string, text: string): number | null {
  let score = 0
  let ti = 0
  let run = 0
  for (const ch of q) {
    const found = text.indexOf(ch, ti)
    if (found === -1) return null
    run = found === ti ? run + 1 : 0
    const wordStart = found === 0 || /[\s/_\-.]/.test(text[found - 1])
    score += 1 + run * 3 + (wordStart ? 5 : 0) - Math.min(found - ti, 10) * 0.2
    ti = found + 1
  }
  return score - text.length * 0.01
}
