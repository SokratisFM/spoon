// Finds git repositories under a folder, for the project palette's "not opened yet" list.
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

// Folders that never hold repos worth listing but can be huge (Unity's Library, node_modules, ...).
const SKIP = new Set([
  'node_modules',
  'Library',
  'Temp',
  'Logs',
  'obj',
  'Obj',
  'Build',
  'Builds',
  'DerivedData',
  'Pods',
  'dist',
  'out',
  'Applications',
  'Movies',
  'Music',
  'Pictures',
  'Public'
])
const MAX_RESULTS = 2000
const CONCURRENCY = 32

export function expandHome(path: string): string {
  return path === '~' ? homedir() : path.startsWith('~/') ? join(homedir(), path.slice(2)) : path
}

/** With nested=false, folders inside a repo (its submodules, vendored repos) aren't searched. */
export async function scanRepos(root: string, maxDepth: number, nested: boolean): Promise<string[]> {
  const start = expandHome(root)
  if (!existsSync(start)) return []
  const found: string[] = []
  // Breadth-first with a small worker pool, so deep trees never exhaust file descriptors.
  let level = [start]
  for (let depth = 0; level.length && depth <= maxDepth && found.length < MAX_RESULTS; depth++) {
    const next: string[] = []
    let i = 0
    const worker = async (): Promise<void> => {
      while (i < level.length) {
        const dir = level[i++]
        let entries
        try {
          entries = await readdir(dir, { withFileTypes: true })
        } catch {
          continue // no permission, vanished, ...
        }
        const isRepo = entries.some((e) => e.name === '.git')
        if (isRepo) found.push(dir)
        if (depth === maxDepth || (isRepo && !nested)) continue
        for (const e of entries) {
          if (e.isDirectory() && !e.name.startsWith('.') && !SKIP.has(e.name)) next.push(join(dir, e.name))
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker))
    level = next
  }
  return found.slice(0, MAX_RESULTS).sort((a, b) => a.localeCompare(b))
}

export function pathsExist(paths: string[]): boolean[] {
  return paths.map((p) => existsSync(p))
}
