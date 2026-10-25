// Every git command Spoon runs while it's open, for the Git Command History window. Kept in memory
// only (the newest 1000); each start and finish is also pushed to the windows as it happens.
import type { GitCommandEntry } from '../shared/types'

const MAX = 1000
const entries: GitCommandEntry[] = []
const listeners = new Set<(e: GitCommandEntry) => void>()
let nextId = 0

export function onCommand(listener: (e: GitCommandEntry) => void): () => void {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

const emit = (e: GitCommandEntry): void => listeners.forEach((l) => l({ ...e }))

/** Records a command as it starts; call the returned function when it ends. */
export function recordStart(cwd: string, args: string[]): (code: number | null, error?: string) => void {
  const entry: GitCommandEntry = { id: ++nextId, cwd, args, startedAt: Date.now(), running: true }
  entries.push(entry)
  if (entries.length > MAX) entries.splice(0, entries.length - MAX)
  emit(entry)
  return (code, error) => {
    if (!entry.running) return
    entry.running = false
    entry.ms = Date.now() - entry.startedAt
    entry.code = code
    if (error) entry.error = error.split('\n').find((l) => l.trim())?.slice(0, 300)
    emit(entry)
  }
}

export function list(): GitCommandEntry[] {
  return entries.map((e) => ({ ...e }))
}

export function clear(): void {
  entries.length = 0
}
