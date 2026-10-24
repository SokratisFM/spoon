// Finds git repositories under a folder, for the project palette's "not opened yet" list.
import { existsSync } from 'node:fs'
import { statSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

// Folders that never hold repos worth listing but can be huge (Unity's Library, node_modules, ...).
const SKIP = new Set(['node_modules', 'Library', 'Temp', 'Logs', 'obj', 'Obj', 'Build', 'Builds', 'DerivedData', 'Pods', 'dist', 'out'])

// Home folders macOS guards with a permission prompt ("Spoon would like to access files in your
// Documents folder"). The scan never walks into them on its own; set the scan folder to one of
// them (Settings → Projects) to search it deliberately.
const PROTECTED_IN_HOME = new Set(['Desktop', 'Documents', 'Downloads', 'Movies', 'Music', 'Pictures', 'Public', 'Applications'])
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
  const home = homedir()
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
          if (!e.isDirectory() || e.name.startsWith('.') || SKIP.has(e.name)) continue
          if (dir === home && PROTECTED_IN_HOME.has(e.name)) continue
          next.push(join(dir, e.name))
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker))
    level = next
  }
  return found
    .slice(0, MAX_RESULTS)
    .map(toSlash)
    .sort((a, b) => a.localeCompare(b))
}

/** Git reports Windows paths with forward slashes; use the same everywhere in the UI. */
export function toSlash(p: string): string {
  return process.platform === 'win32' ? p.replace(/\\/g, '/') : p
}

/**
 * Whether each path exists. A folder macOS won't let Spoon look into (no permission yet) still
 * counts as existing: only "not found" makes a project missing, so a permission prompt you
 * declined never turns into "can't be found, remove it?".
 */
export function pathsExist(paths: string[]): boolean[] {
  return paths.map((p) => {
    try {
      statSync(p)
      return true
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      return code !== 'ENOENT' && code !== 'ENOTDIR'
    }
  })
}
