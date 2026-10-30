// Unity exports: a Unity project exported for Android (a Gradle project with unityLibrary/) or iOS
// (an Xcode project) gets copies of the project's native plug-in files. Edits made to those copies
// in Android Studio or Xcode never reach the repository, so Spoon pairs each copy with its source
// (under Assets/, or in a local package: Packages/<name>/ or a "file:" package in the manifest),
// lists the ones that differ, and can bring an edit back or replace the copy with a link to the
// source (what Unity's "Symlink Sources" build setting does at export time).
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
async function walk(dir: string, keep: (rel: string) => boolean, skip: Set<string> | ((name: string) => boolean) = SKIP): Promise<string[]> {
  const skipped = typeof skip === 'function' ? skip : (name: string): boolean => skip.has(name)
  const out: string[] = []
  const go = async (d: string, rel: string): Promise<void> => {
    if (out.length >= MAX_FILES) return
    const entries = await readdir(d, { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        if (!skipped(e.name)) await go(join(d, e.name), r)
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

/** Inside an export only Gradle's own output is skipped: plug-in folders can be called anything (Data…). */
const EXPORT_SKIP = new Set<string>()
const LIB_SKIP = new Set(['build', '.gradle'])
// In Assets and packages: Gradle output, and what Unity itself ignores (hidden folders, "Samples~").
const SOURCE_SKIP = (name: string): boolean => LIB_SKIP.has(name) || name.startsWith('.') || name.endsWith('~') || name === 'node_modules'

/** Where native plug-in sources live: Assets/, and local packages (embedded or "file:" in the manifest). */
interface SourceRoot {
  abs: string
  /** What the export calls this root under iOS's Libraries/: '' for Assets, the package name for a package. */
  ios: string
}
async function sourceRoots(root: string): Promise<SourceRoot[]> {
  const roots: SourceRoot[] = [{ abs: join(root, 'Assets'), ios: '' }]
  const seen = new Set<string>()
  const add = async (abs: string, fallbackName: string): Promise<void> => {
    if (seen.has(abs)) return
    const pkg = await readFile(join(abs, 'package.json'), 'utf8').then((t) => JSON.parse(t) as { name?: string }, () => null)
    if (!pkg) return
    seen.add(abs)
    roots.push({ abs, ios: pkg.name || fallbackName })
  }
  const packages = join(root, 'Packages')
  for (const e of await readdir(packages, { withFileTypes: true }).catch(() => [])) if (e.isDirectory()) await add(join(packages, e.name), e.name)
  const manifest = await readFile(join(packages, 'manifest.json'), 'utf8').then((t) => JSON.parse(t) as { dependencies?: Record<string, string> }, () => null)
  for (const [name, ref] of Object.entries(manifest?.dependencies ?? {}))
    if (typeof ref === 'string' && ref.startsWith('file:')) await add(resolve(packages, ref.slice('file:'.length)), name)
  return roots
}

/** A native source file: its id (relative to the repository when inside it, else absolute), path and iOS name. */
interface Source {
  id: string
  abs: string
  /** Its path under the iOS export's Libraries/. */
  ios: string
}

/** Native code files in Assets/ and local packages (inside .androidlib folders too). */
async function sourceIndex(root: string): Promise<Source[]> {
  const out: Source[] = []
  for (const r of await sourceRoots(root)) {
    for (const rel of await walk(r.abs, (x) => NATIVE.has(extname(x).toLowerCase()), SOURCE_SKIP)) {
      const abs = join(r.abs, rel)
      const inRepo = toSlash(relative(root, abs))
      out.push({
        id: inRepo.startsWith('..') || isAbsolute(inRepo) ? toSlash(abs) : inRepo,
        abs,
        ios: r.ios ? `${r.ios}/${rel}` : rel
      })
    }
  }
  return out
}

/** The source a pair names, checked to be one (in Assets/ or a local package), as an absolute path. */
async function sourcePath(root: string, src: string): Promise<string> {
  const abs = isAbsolute(src) ? resolve(src) : inside(root, src)
  if (!(await sourceRoots(root)).some((r) => abs.startsWith(r.abs + sep))) throw new Error(`Not a Unity source: ${src}`)
  return abs
}

// The git repository each source is in (this one, a submodule, or a package's own), by folder.
const repoOfDir = new Map<string, string>()
function repoOf(abs: string): string {
  const dir = dirname(abs)
  let found = repoOfDir.get(dir)
  if (found === undefined) {
    found = ''
    for (let d = dir; ; d = dirname(d)) {
      if (existsSync(join(d, '.git'))) {
        found = d
        break
      }
      if (dirname(d) === d) break
    }
    repoOfDir.set(dir, found)
  }
  return found
}

const packageOf = async (abs: string): Promise<string | null> =>
  /^\s*package\s+([\w.]+)/m.exec(await readFile(abs, 'utf8').catch(() => ''))?.[1] ?? null

/** Pairs an export's native files with their sources under Assets/. */
async function pairs(root: string, dir: string, platform: ExportPlatform, index: Source[]): Promise<{ exp: string; src: Source }[]> {
  const byId = new Map(index.map((s) => [s.id, s]))
  const found: { exp: string; src: Source }[] = []
  const abs = join(root, dir)
  if (platform === 'ios') {
    // Assets/Plugins/iOS/Foo.mm is exported as Libraries/Plugins/iOS/Foo.mm, and a package's
    // Runtime/Plugins/iOS/Foo.mm as Libraries/<package name>/Runtime/Plugins/iOS/Foo.mm.
    const byIos = new Map(index.map((s) => [s.ios, s]))
    for (const r of await walk(join(abs, 'Libraries'), (x) => NATIVE.has(extname(x).toLowerCase()), EXPORT_SKIP)) {
      const src = byIos.get(r)
      if (src) found.push({ exp: `${dir}/Libraries/${r}`, src })
    }
    return found
  }
  // Java and Kotlin end up under src/main/java/<package path>/: matched by file name and package.
  const byName = new Map<string, Source[]>()
  for (const s of index) if (/\.(java|kt)$/.test(s.id) && !/\.androidlib\//.test(s.id)) byName.set(basename(s.id), [...(byName.get(basename(s.id)) ?? []), s])
  for (const base of ['java', 'kotlin']) {
    const srcDir = `${dir}/unityLibrary/src/main/${base}`
    for (const r of await walk(join(root, srcDir), (x) => /\.(java|kt)$/.test(x), EXPORT_SKIP)) {
      const candidates = byName.get(basename(r)) ?? []
      // Always by package too: Unity's own UnityPlayerActivity.java must never pair with a file of
      // the same name in another package.
      const pkg = dirname(r) === '.' ? '' : dirname(r).split('/').join('.')
      for (const c of candidates) {
        if (((await packageOf(c.abs)) ?? '') === pkg) {
          found.push({ exp: `${srcDir}/${r}`, src: c })
          break
        }
      }
    }
  }
  // Android Library plug-ins: Assets/…/Foo.androidlib/… is exported as a folder of the same name.
  const libs = new Map<string, string>() // "Foo.androidlib" → "Assets/Plugins/Android/Foo.androidlib"
  for (const s of index) {
    const m = /^(.*\/([^/]+\.androidlib))\//.exec(s.id)
    if (m) libs.set(m[2], m[1])
  }
  if (libs.size) {
    for (const parent of [dir, `${dir}/unityLibrary`]) {
      for (const name of await readdir(join(root, parent)).catch(() => [] as string[])) {
        const lib = libs.get(name)
        if (!lib) continue
        for (const r of await walk(join(root, parent, name), (x) => NATIVE.has(extname(x).toLowerCase()), LIB_SKIP)) {
          const src = byId.get(`${lib}/${r}`)
          if (src) found.push({ exp: `${parent}/${name}/${r}`, src })
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
      const s = src.abs
      const where = { platform, export: exp, source: src.id, sourcePath: toSlash(s), sourceRepo: toSlash(repoOf(s) || root) }
      try {
        const info = await lstat(e)
        if (info.isSymbolicLink()) {
          links.push({ ...where, state: 'linked', exportMtime: 0, sourceMtime: 0 })
          continue
        }
        const [a, b, sInfo] = await Promise.all([readFile(e), readFile(s), stat(s)])
        if (a.equals(b)) links.push({ ...where, state: 'same', exportMtime: info.mtimeMs, sourceMtime: sInfo.mtimeMs })
        else {
          // Whichever was saved last is the one that changed (an export is written all at once).
          const newer = info.mtimeMs > sInfo.mtimeMs ? 'export-newer' : 'source-newer'
          links.push({ ...where, state: newer, exportMtime: info.mtimeMs, sourceMtime: sInfo.mtimeMs })
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

/** Copies an export's version of a file over its source; returns the source's new save time. */
export async function bringBack(root: string, exp: string, src: string): Promise<number> {
  const e = inside(root, exp)
  const s = await sourcePath(root, src)
  if (!(await lstat(e)).isSymbolicLink()) await writeFile(s, await readFile(e)) // a link is the source itself
  return (await stat(s)).mtimeMs
}

/**
 * Replaces an export's copy with a link to its source, so later edits go straight to Assets/. A copy
 * that differs is only replaced with `force` (its edit is lost).
 */
export async function relink(root: string, exp: string, src: string, force = false): Promise<void> {
  const e = inside(root, exp)
  const s = await sourcePath(root, src)
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
