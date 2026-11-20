// Live refresh: watches an open repository's folder and its git folder, and says when something that
// can show in Spoon changed: a file git doesn't ignore, or HEAD, a branch, the index or a merge in
// progress. Changes are gathered for a moment and checked together, so a burst of saves (or Unity
// rewriting its ignored Library folder) costs one check, and only a real change refreshes.
import { watch, type FSWatcher } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import * as git from './git'

/** What in a git folder can change what Spoon shows (not objects, logs or lock files). */
const GIT_STATE = new Set(['HEAD', 'index', 'packed-refs', 'refs', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'REBASE_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer', 'stash'])
const QUIET = 300 // ms without changes before checking
const MAX_WAIT = 1500 // ms at most between the first change and the check, while changes keep coming
const MAX_PATHS = 5000 // more than this at once: just refresh

interface Watch {
  count: number
  list: FSWatcher[]
  paths: Set<string>
  gitChanged: boolean
  timer?: ReturnType<typeof setTimeout>
  first: number
  checking: boolean
  closed: boolean
}

const watches = new Map<string, Watch>()

const gitStateChange = (rel: string): boolean => {
  const parts = rel.split(sep)
  return GIT_STATE.has(parts[0]) && !rel.endsWith('.lock')
}

/**
 * Starts (or, with `on` false, stops) watching a repository for a window (`owner`); one watch per
 * window and repository, however many tabs ask. `changed` is called after changes that matter.
 */
export async function watchRepo(owner: number, root: string, on: boolean, changed: () => void): Promise<void> {
  root = resolve(root)
  const key = `${owner}|${root}`
  const had = watches.get(key)
  if (!on) {
    if (had && --had.count <= 0) close(key, had)
    return
  }
  if (had) return void had.count++
  const w: Watch = { count: 1, list: [], paths: new Set(), gitChanged: false, first: 0, checking: false, closed: false }
  watches.set(key, w)

  const check = async (): Promise<void> => {
    w.timer = undefined
    if (w.closed) return
    // Spoon's own write is running: it refreshes when it's done, and sees what changed meanwhile too.
    if (git.busy(root)) {
      w.paths.clear()
      w.gitChanged = false
      return
    }
    const paths = [...w.paths]
    const gitChanged = w.gitChanged
    w.paths.clear()
    w.gitChanged = false
    w.checking = true
    try {
      let matters = gitChanged || paths.length > MAX_PATHS
      if (!matters && paths.length) {
        try {
          const ignored = await git.ignoredOf(root, paths)
          matters = paths.some((p) => !ignored.has(p))
        } catch {
          matters = true // git couldn't say (a path in a submodule): refresh to be sure
        }
      }
      if (matters && !w.closed) changed()
    } finally {
      w.checking = false
      // Changes that came in while checking.
      if ((w.paths.size || w.gitChanged) && !w.timer && !w.closed) schedule()
    }
  }
  const schedule = (): void => {
    const now = Date.now()
    if (!w.timer) w.first = now
    clearTimeout(w.timer)
    if (w.checking) return void (w.timer = undefined)
    w.timer = setTimeout(() => void check(), Math.max(0, Math.min(QUIET, w.first + MAX_WAIT - now)))
  }
  const start = (dir: string, inGitDir: boolean): void => {
    try {
      const fw = watch(dir, { recursive: true }, (_event, file) => {
        if (w.closed) return
        const rel = String(file ?? '')
        if (!rel) {
          w.gitChanged = true // the platform didn't say which file: refresh
        } else if (inGitDir) {
          if (!gitStateChange(rel)) return
          w.gitChanged = true
        } else {
          const parts = rel.split(sep)
          if (git.isGitPart(parts[0])) {
            if (!gitStateChange(parts.slice(1).join(sep))) return
            w.gitChanged = true
          } else if (w.paths.size <= MAX_PATHS) w.paths.add(parts.join('/'))
        }
        schedule()
      })
      // The folder went away (deleted or moved): nothing more to hear from it.
      fw.on('error', () => fw.close())
      w.list.push(fw)
    } catch {
      // Can't be watched: refreshing when the window comes back to the front still works.
    }
  }
  start(root, false)
  // A linked worktree or a submodule keeps its git folder elsewhere.
  try {
    const gitDir = await git.gitDirOf(root)
    const rel = relative(root, gitDir)
    if (!w.closed && (rel.startsWith('..') || isAbsolute(rel))) start(gitDir, true)
  } catch {
    // Not a repository any more: the work tree's own changes are still heard.
  }
}

function close(key: string, w: Watch): void {
  w.closed = true
  w.list.forEach((fw) => fw.close())
  clearTimeout(w.timer)
  watches.delete(key)
}

/** Stops every watch a window started (it closed). */
export function stopWatchingRepos(owner: number): void {
  for (const [key, w] of watches) if (key.startsWith(`${owner}|`)) close(key, w)
}
