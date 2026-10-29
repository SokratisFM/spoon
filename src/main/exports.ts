// Unity exports: a Unity project exported for Android (a Gradle project with unityLibrary/) or iOS
// (an Xcode project) gets copies of the project's native plug-in files. Edits made to those copies
// in Android Studio or Xcode never reach the repository, so Spoon pairs each copy with its source
// under Assets/, lists the ones that differ, and can bring an edit back or replace the copy with a
// link to the source (what Unity's "Symlink Sources" build setting does at export time).
import { existsSync, watch, type FSWatcher } from 'node:fs'
import { lstat, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { ExportCandidate, ExportLink, ExportPlatform } from '../shared/types'

// Only code is paired. Manifests, Gradle files, properties and resources are rewritten while Unity
// exports (its own steps and plug-ins' build scripts fill in app ids, package lists…), so their
// copies differ from Assets without anyone having edited them.
const NATIVE = new Set(['.java', '.kt', '.m', '.mm', '.h', '.hpp', '.c', '.cc', '.cpp', '.swift', '.xib'])
// Never searched for exports: Unity's own folders and build caches.
const SKIP = new Set(['Assets', 'Library', 'Temp', 'Logs', 'Packages', 'ProjectSettings', 'UserSettings', 'obj', 'node_modules', '.git', '.gradle', 'build', 'Pods', 'DerivedData', 'Il2CppOutputProject', 'Data'])
const MAX_FILES = 50_000

const toSlash = (p: string): string => p.split(sep).join('/')

/** A path inside the repository (and outside .git), or an error. */
function inside(root: string, rel: string): string {
  const abs = resolve(root, rel)
  const r = relative(root, abs)
  // Case-insensitive: on macOS and Windows ".GIT" is the same folder.
  if (!r || r.startsWith('..') || isAbsolute(r) || r.split(sep)[0].toLowerCase() === '.git') throw new Error(`Not inside the repository: ${rel}`)
  return abs
}

export function isUnityProject(root: string): boolean {
  return existsSync(join(root, 'Assets')) && existsSync(join(root, 'ProjectSettings', 'ProjectVersion.txt'))
}

/** Every file under `dir` (relative to it), skipping build caches; `keep` picks which. */
async function walk(dir: string, keep: (rel: string) => boolean, skip = SKIP): Promise<string[]> {
  const out: string[] = []
  const go = async (d: string, rel: string): Promise<void> => {
    if (out.length >= MAX_FILES) return
    const entries = await readdir(d, { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        if (!skip.has(e.name)) await go(join(d, e.name), r)
      } else if ((e.isFile() || e.isSymbolicLink()) && keep(r)) out.push(r)
    }
  }
  await go(dir, '')
  return out
}

const platformOf = async (dir: string): Promise<ExportPlatform | null> => {
  const names = await readdir(dir).catch(() => [] as string[])
  if (names.includes('unityLibrary')) return 'android'
  if (names.some((n) => n.endsWith('.xcodeproj'))) return 'ios'
  return null
}

/** Native code files under Assets/ (inside .androidlib folders too), relative to the repo. */
async function sourceIndex(root: string): Promise<string[]> {
  return (
    await walk(
      join(root, 'Assets'),
      (r) => NATIVE.has(extname(r).toLowerCase()),
      new Set(['build', '.gradle'])
    )
  ).map((r) => `Assets/${r}`)
}

const packageOf = async (abs: string): Promise<string | null> =>
  /^\s*package\s+([\w.]+)/m.exec(await readFile(abs, 'utf8').catch(() => ''))?.[1] ?? null

/** Pairs an export's native files with their sources under Assets/. */
async function pairs(root: string, dir: string, platform: ExportPlatform, index: string[]): Promise<{ exp: string; src: string }[]> {
  const sources = new Set(index)
  const found: { exp: string; src: string }[] = []
  const abs = join(root, dir)
  if (platform === 'ios') {
    // Assets/Plugins/iOS/Foo.mm is exported as Libraries/Plugins/iOS/Foo.mm.
    for (const r of await walk(join(abs, 'Libraries'), (x) => NATIVE.has(extname(x).toLowerCase()))) {
      const src = `Assets/${r}`
      if (sources.has(src)) found.push({ exp: `${dir}/Libraries/${r}`, src })
    }
    return found
  }
  // Java and Kotlin end up under src/main/java/<package path>/: matched by file name and package.
  const byName = new Map<string, string[]>()
  for (const s of index) if (/\.(java|kt)$/.test(s) && !/\.androidlib\//.test(s)) byName.set(basename(s), [...(byName.get(basename(s)) ?? []), s])
  for (const base of ['java', 'kotlin']) {
    const srcDir = `${dir}/unityLibrary/src/main/${base}`
    for (const r of await walk(join(root, srcDir), (x) => /\.(java|kt)$/.test(x))) {
      const candidates = byName.get(basename(r)) ?? []
      // Always by package too: Unity's own UnityPlayerActivity.java must never pair with a file of
      // the same name in another package.
      const pkg = dirname(r) === '.' ? '' : dirname(r).split('/').join('.')
      for (const c of candidates) {
        if (((await packageOf(join(root, c))) ?? '') === pkg) {
          found.push({ exp: `${srcDir}/${r}`, src: c })
          break
        }
      }
    }
  }
  // Android Library plug-ins: Assets/…/Foo.androidlib/… is exported as a folder of the same name.
  const libs = new Map<string, string>() // "Foo.androidlib" → "Assets/Plugins/Android/Foo.androidlib"
  for (const s of index) {
    const m = /^(.*\/([^/]+\.androidlib))\//.exec(s)
    if (m) libs.set(m[2], m[1])
  }
  if (libs.size) {
    for (const parent of [dir, `${dir}/unityLibrary`]) {
      for (const name of await readdir(join(root, parent)).catch(() => [] as string[])) {
        const lib = libs.get(name)
        if (!lib) continue
        for (const r of await walk(join(root, parent, name), (x) => NATIVE.has(extname(x).toLowerCase()))) {
          const src = `${lib}/${r}`
          if (sources.has(src)) found.push({ exp: `${parent}/${name}/${r}`, src })
        }
      }
    }
  }
  return found
}

/** Exported Android and iOS projects inside the repository (outside Unity's own folders). */
export async function findExports(root: string): Promise<ExportCandidate[]> {
  const dirs: { dir: string; platform: ExportPlatform }[] = []
  const go = async (d: string, rel: string, depth: number): Promise<void> => {
    const platform = rel ? await platformOf(d) : null
    if (platform) return void dirs.push({ dir: rel, platform })
    if (depth === 4) return
    for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
      if (e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith('.')) await go(join(d, e.name), rel ? `${rel}/${e.name}` : e.name, depth + 1)
    }
  }
  await go(root, '', 0)
  const index = await sourceIndex(root)
  return Promise.all(dirs.map(async (x) => ({ ...x, files: (await pairs(root, x.dir, x.platform, index)).length })))
}

/** How each linked export's native files compare with their sources. */
export async function scanExports(root: string, dirs: string[]): Promise<ExportLink[]> {
  const index = await sourceIndex(root)
  const links: ExportLink[] = []
  for (const dir of dirs) {
    inside(root, dir)
    const platform = await platformOf(join(root, dir))
    if (!platform) continue
    for (const { exp, src } of await pairs(root, dir, platform, index)) {
      const e = join(root, exp)
      const s = join(root, src)
      try {
        const info = await lstat(e)
        if (info.isSymbolicLink()) {
          links.push({ platform, export: exp, source: src, state: 'linked', exportMtime: 0, sourceMtime: 0 })
          continue
        }
        const [a, b, sInfo] = await Promise.all([readFile(e), readFile(s), stat(s)])
        if (a.equals(b)) links.push({ platform, export: exp, source: src, state: 'same', exportMtime: info.mtimeMs, sourceMtime: sInfo.mtimeMs })
        else {
          // Whichever was saved last is the one that changed (an export is written all at once).
          const newer = info.mtimeMs > sInfo.mtimeMs ? 'export-newer' : 'source-newer'
          links.push({ platform, export: exp, source: src, state: newer, exportMtime: info.mtimeMs, sourceMtime: sInfo.mtimeMs })
        }
      } catch {
        // gone while scanning (an export being rewritten): left out until the next scan
      }
    }
  }
  return links
}

// Exports are usually ignored by git, so editing one doesn't refresh the repository: they're watched,
// per window (`owner`) and repository, so two windows on one repository don't replace each other's.
const watchers = new Map<string, { list: FSWatcher[]; timer?: ReturnType<typeof setTimeout> }>()

/** Calls `changed` (at most every half second) when a native file in the linked exports changes. */
export function watchExports(owner: number, root: string, dirs: string[], changed: () => void): void {
  const key = `${owner}|${resolve(root)}`
  const old = watchers.get(key)
  old?.list.forEach((w) => w.close())
  if (old?.timer) clearTimeout(old.timer)
  watchers.delete(key)
  if (!dirs.length) return
  const entry: { list: FSWatcher[]; timer?: ReturnType<typeof setTimeout> } = { list: [] }
  for (const dir of dirs) {
    try {
      const w = watch(inside(root, dir), { recursive: true }, (_event, file) => {
        const f = String(file ?? '')
        if (f && !NATIVE.has(extname(f).toLowerCase())) return
        clearTimeout(entry.timer)
        entry.timer = setTimeout(changed, 500)
      })
      w.on('error', () => w.close())
      entry.list.push(w)
    } catch {
      // the export folder is gone (deleted, or not exported yet)
    }
  }
  watchers.set(key, entry)
}

/** Stops every watcher a window started (it closed). */
export function stopWatching(owner: number): void {
  for (const [key, entry] of watchers) {
    if (!key.startsWith(`${owner}|`)) continue
    entry.list.forEach((w) => w.close())
    if (entry.timer) clearTimeout(entry.timer)
    watchers.delete(key)
  }
}

/** Copies an export's version of a file over its source under Assets/; returns the source's new save time. */
export async function bringBack(root: string, exp: string, src: string): Promise<number> {
  const e = inside(root, exp)
  const s = inside(root, src)
  if (!toSlash(relative(root, s)).startsWith('Assets/')) throw new Error(`Not a Unity source: ${src}`)
  if (!(await lstat(e)).isSymbolicLink()) await writeFile(s, await readFile(e)) // a link is the source itself
  return (await stat(s)).mtimeMs
}

/**
 * Replaces an export's copy with a link to its source, so later edits go straight to Assets/. A copy
 * that differs is only replaced with `force` (its edit is lost).
 */
export async function relink(root: string, exp: string, src: string, force = false): Promise<void> {
  const e = inside(root, exp)
  const s = inside(root, src)
  if (!toSlash(relative(root, s)).startsWith('Assets/')) throw new Error(`Not a Unity source: ${src}`)
  if ((await lstat(e)).isSymbolicLink()) return
  if (!force && !(await readFile(e)).equals(await readFile(s)))
    throw new Error(`${basename(exp)} differs from its source. Bring it back (or discard the export's edit) first.`)
  await rm(e)
  try {
    await symlink(relative(dirname(e), s), e, 'file')
  } catch (err) {
    await writeFile(e, await readFile(s)) // put the copy back
    throw process.platform === 'win32'
      ? new Error('Windows only lets apps create links with Developer Mode on (Settings → System → For developers).')
      : err
  }
}
