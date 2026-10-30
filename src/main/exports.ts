// Unity exports: a Unity project exported for Android (a Gradle project with unityLibrary/) or iOS
// (an Xcode project) gets copies of the project's native plug-in files. Edits made to those copies
// in Android Studio or Xcode never reach the repository, so Spoon pairs each copy with its source
// (under Assets/, or in a local package: Packages/<name>/ or a "file:" package in the manifest),
// lists the ones that differ, and can bring an edit back or replace the copy with a link to the
// source (what Unity's "Symlink Sources" build setting does at export time).
import { existsSync, readFileSync, watch, writeFileSync, type FSWatcher } from 'node:fs'
import { constants as fsConstants } from 'node:fs'
import { chmod, copyFile, lstat, readdir, readFile, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { createHash, randomBytes } from 'node:crypto'
import { app, shell } from 'electron'
import * as git from './git'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { ExportCandidate, ExportFolder, ExportLink, ExportNew, ExportPlatform } from '../shared/types'

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
  // Never into a .git folder, nested ones and Windows' other names for it included.
  if (!git.insideRel(relative(root, abs))) throw new Error(`Not inside the repository: ${rel}`)
  return abs
}

/** The export folder (relative to the repository) a file in an export is in, and its platform. */
async function exportOf(root: string, exp: string): Promise<{ dir: string; platform: ExportPlatform }> {
  inside(root, exp)
  const parts = toSlash(exp).split('/')
  for (let n = parts.length - 1; n > 0; n--) {
    const dir = parts.slice(0, n).join('/')
    const platform = await platformOf(join(root, dir))
    if (platform) return { dir, platform }
  }
  throw new Error(`${exp} isn’t in an exported project.`)
}

/**
 * The pair a request names, worked out again here (not taken from the window's word): the export
 * file must be in an exported project and pair with exactly that source.
 */
async function verifiedPairs(root: string, wanted: { exp: string; src: string }[]): Promise<Map<string, Source>> {
  const index = await sourceIndex(root)
  const byDir = new Map<string, Map<string, Source>>()
  const out = new Map<string, Source>()
  for (const w of wanted) {
    const { dir, platform } = await exportOf(root, w.exp)
    if (!byDir.has(dir)) byDir.set(dir, new Map((await pairs(root, dir, platform, index)).map((p) => [p.exp, p.src])))
    const src = byDir.get(dir)!.get(toSlash(w.exp))
    if (!src || src.id !== w.src) throw new Error(`${basename(w.exp)} doesn’t pair with ${w.src}.`)
    out.set(w.exp, src)
  }
  return out
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
    // A path two sources would both export to is ambiguous: neither is paired.
    const byIos = new Map<string, Source | null>()
    for (const s of index) byIos.set(s.ios, byIos.has(s.ios) ? null : s)
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
      // Exactly one source with that name and package (two would be ambiguous: neither is paired).
      const matching: Source[] = []
      for (const c of candidates) if (((await packageOf(c.abs)) ?? '') === pkg) matching.push(c)
      if (matching.length === 1) found.push({ exp: `${srcDir}/${r}`, src: matching[0] })
    }
  }
  // Android Library plug-ins: Assets/…/Foo.androidlib/… is exported as a folder of the same name.
  const libs = new Map<string, string | null>() // "Foo.androidlib" → "Assets/Plugins/Android/Foo.androidlib" (null: two of that name)
  for (const s of index) {
    const m = /^(.*\/([^/]+\.androidlib))\//.exec(s.id)
    if (m) libs.set(m[2], libs.has(m[2]) && libs.get(m[2]) !== m[1] ? null : m[1])
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

/**
 * When Unity last wrote an export, from its files' save times: it gives every file it writes the
 * same one, so it's the most common (to the minute; the end of that run). Null with no files.
 */
function runTime(saves: number[]): number | null {
  if (!saves.length) return null
  const minutes = new Map<number, number>()
  for (const t of saves) minutes.set(Math.floor(t / 60_000), (minutes.get(Math.floor(t / 60_000)) ?? 0) + 1)
  const mode = [...minutes].sort((a, b) => b[1] - a[1])[0][0] * 60_000
  return Math.max(...saves.filter((t) => Math.abs(t - mode) < 300_000))
}
/** Saved by Unity's export run (not edited since): within a couple of minutes of it. */
const RUN_SLACK = 120_000

const hashOf = (data: Buffer): string => createHash('sha1').update(data).digest('hex')

/** How each linked export's native files compare with their sources. */
export async function scanExports(root: string, dirs: string[]): Promise<ExportLink[]> {
  const index = await sourceIndex(root)
  const links: ExportLink[] = []
  // Which sources git tracks, per repository: an untracked or ignored source has no history to fall
  // back on, so it's never overwritten by itself.
  const tracked = new Map<string, Set<string> | null>()
  const isTracked = async (repo: string, abs: string): Promise<boolean> => {
    if (!repo) return false
    if (!tracked.has(repo)) tracked.set(repo, await git.trackedFiles(repo).catch(() => null))
    return tracked.get(repo)?.has(toSlash(relative(repo, abs))) ?? false
  }
  for (const dir of dirs) {
    inside(root, dir)
    const platform = await platformOf(join(root, dir))
    if (!platform) continue
    const found: ExportLink[] = []
    for (const { exp, src } of await pairs(root, dir, platform, index)) {
      const e = join(root, exp)
      const s = src.abs
      const repo = repoOf(s)
      const where = { platform, export: exp, source: src.id, sourcePath: toSlash(s), sourceRepo: toSlash(repo), sourceTracked: await isTracked(repo, s) }
      try {
        const info = await lstat(e)
        if (info.isSymbolicLink()) {
          // A link whose source is gone (moved, deleted, another branch) is broken, not linked.
          const ok = await stat(e).then(() => true, () => false)
          found.push({ ...where, state: ok ? 'linked' : 'dangling', exportMtime: 0, sourceMtime: 0 })
          continue
        }
        const [a, b, sInfo] = await Promise.all([readFile(e), readFile(s), stat(s)])
        const hashes = { exportHash: hashOf(a), sourceHash: hashOf(b) }
        if (a.equals(b)) found.push({ ...where, ...hashes, state: 'same', exportMtime: info.mtimeMs, sourceMtime: sInfo.mtimeMs })
        else {
          // Whichever was saved last is the one that changed (an export is written all at once).
          const newer = info.mtimeMs > sInfo.mtimeMs ? 'export-newer' : 'source-newer'
          found.push({ ...where, ...hashes, state: newer, exportMtime: info.mtimeMs, sourceMtime: sInfo.mtimeMs })
        }
      } catch {
        // gone while scanning (an export being rewritten): left out until the next scan
      }
    }
    // Copies still as Unity's export run wrote them weren't edited, whatever their save time says.
    const copies = found.filter((l) => l.state !== 'linked' && l.state !== 'dangling')
    const run = runTime(copies.map((l) => l.exportMtime))
    for (const l of copies) if (run !== null) l.inRun = l.exportMtime <= run + RUN_SLACK
    links.push(...found)
  }
  return links
}

// Exports are usually ignored by git, so editing one doesn't refresh the repository: they're watched,
// per window (`owner`) and repository, so two windows on one repository don't replace each other's.
const watchers = new Map<string, { list: FSWatcher[]; timer?: ReturnType<typeof setTimeout> }>()

/**
 * Calls `changed` (at most every half second) when a native file in the linked exports changes.
 * Resolves to the folders that can't be watched (missing); a watcher that fails is started again.
 */
export function watchExports(owner: number, root: string, dirs: string[], changed: () => void): string[] {
  const key = `${owner}|${resolve(root)}`
  const old = watchers.get(key)
  old?.list.forEach((w) => w.close())
  if (old?.timer) clearTimeout(old.timer)
  watchers.delete(key)
  if (!dirs.length) return []
  const entry: { list: FSWatcher[]; timer?: ReturnType<typeof setTimeout> } = { list: [] }
  const missing: string[] = []
  const start = (dir: string): boolean => {
    try {
      const w = watch(inside(root, dir), { recursive: true }, (_event, file) => {
        const f = String(file ?? '')
        if (f && !NATIVE.has(extname(f).toLowerCase())) return
        clearTimeout(entry.timer)
        entry.timer = setTimeout(changed, 500)
      })
      // Lost (the folder was replaced by a new export, say): watch it again once it's back, and rescan.
      w.on('error', () => {
        w.close()
        entry.list = entry.list.filter((x) => x !== w)
        const retry = (): void => {
          if (watchers.get(key) !== entry) return
          if (start(dir)) changed()
          else setTimeout(retry, 5000)
        }
        setTimeout(retry, 2000)
      })
      entry.list.push(w)
      return true
    } catch {
      return false
    }
  }
  for (const dir of dirs) if (!start(dir)) missing.push(dir)
  watchers.set(key, entry)
  return missing
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

export interface BringBackItem {
  exp: string
  src: string
  /** The save times the scan saw: if either file changed since, it's left alone. */
  exportMtime: number
  sourceMtime: number
}

/**
 * Copies exports' versions of files over their sources; resolves to each source's new save time.
 * Each source is checked first (still there, unchanged since the scan) and copied to the Trash, so
 * it can be got back; the write waits for any git command in the source's repository.
 */
export async function bringBack(root: string, items: BringBackItem[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  const checked: { e: string; s: string; item: BringBackItem }[] = []
  const verified = await verifiedPairs(root, items)
  for (const item of items) {
    const e = inside(root, item.exp)
    const s = verified.get(item.exp)!.abs
    const [eInfo, sInfo] = await Promise.all([lstat(e), stat(s).catch(() => null)])
    if (!sInfo) throw new Error(`${item.src} isn’t there any more.`)
    if (eInfo.isSymbolicLink()) continue // a link is the source itself
    if (eInfo.mtimeMs !== item.exportMtime || sInfo.mtimeMs !== item.sourceMtime)
      throw new Error(`${basename(item.src)} or its export copy changed since Spoon looked. Look again and retry.`)
    checked.push({ e, s, item })
  }
  if (!checked.length) return out
  await git.backupToTrash(
    checked.map((c) => ({ abs: c.s, rel: c.item.src.startsWith('/') ? basename(c.s) : c.item.src })),
    `${basename(root)} – before bringing back from the export ${git.backupStamp()}`,
    (p) => shell.trashItem(p)
  )
  for (const c of checked) {
    out[c.item.src] = await git.exclusive(repoOf(c.s) || root, async () => {
      // Once more right before writing: a checkout or pull queued ahead of this may have changed it.
      if ((await stat(c.s)).mtimeMs !== c.item.sourceMtime) throw new Error(`${basename(c.item.src)} changed while waiting. Look again and retry.`)
      await replaceContents(c.s, await readFile(c.e))
      return (await stat(c.s)).mtimeMs
    })
  }
  return out
}

/**
 * Writes a source's new contents all at once (a new file renamed over it, keeping its permissions),
 * so a failure halfway never leaves it half-written. A source that's itself a link is written in
 * place, so it stays a link.
 */
async function replaceContents(file: string, data: Buffer): Promise<void> {
  const info = await lstat(file)
  if (info.isSymbolicLink()) return writeFile(file, data)
  const tmp = join(dirname(file), `.${basename(file)}.spoon-${randomBytes(4).toString('hex')}`)
  try {
    await writeFile(tmp, data)
    await chmod(tmp, info.mode & 0o7777)
    await rename(tmp, file)
  } catch (err) {
    await rm(tmp, { force: true })
    throw err
  }
}

/**
 * Replaces an export's copy with a link to its source, so later edits go straight to Assets/. A copy
 * that differs is only replaced with `force` (its edit is lost).
 */
export async function relink(root: string, exp: string, src: string, force = false): Promise<void> {
  const e = inside(root, exp)
  const s = (await verifiedPairs(root, [{ exp, src }])).get(exp)!.abs
  if ((await lstat(e)).isSymbolicLink()) return
  const copy = await readFile(e)
  if (!force && !copy.equals(await readFile(s)))
    throw new Error(`${basename(exp)} differs from its source. Bring it back (or discard the export's edit) first.`)
  await rm(e)
  try {
    await symlink(relative(dirname(e), s), e, 'file')
  } catch (err) {
    await writeFile(e, copy) // put the export's own copy back
    throw process.platform === 'win32'
      ? new Error('Windows only lets apps create links with Developer Mode on (Settings → System → For developers).')
      : err
  }
}

// ---------- files made in Android Studio or Xcode ----------

const isDir = (abs: string): Promise<boolean> => stat(abs).then((st) => st.isDirectory(), () => false)

/** A folder new files can go to, named like a source (relative to the repository, or absolute). */
function folderOf(root: string, abs: string): ExportFolder {
  const inRepo = toSlash(relative(root, abs))
  const repo = repoOf(join(abs, '_')) || root
  return {
    id: inRepo.startsWith('..') || isAbsolute(inRepo) ? toSlash(abs) : inRepo,
    repo: toSlash(repo),
    rel: toSlash(relative(repo, abs))
  }
}

// The files each export run left, by export folder (in Spoon's own data, not in the export).
interface RunSnapshot {
  run: number
  files: string[]
  /** Taken before anything in the export was edited: what's not in it is surely new. */
  trusted: boolean
}
const runsFile = (): string => join(app.getPath('userData'), 'export-runs.json')
let runs: Record<string, RunSnapshot> | null = null

function loadRuns(): Record<string, RunSnapshot> {
  if (!runs) {
    try {
      runs = JSON.parse(readFileSync(runsFile(), 'utf8')) as Record<string, RunSnapshot>
    } catch {
      runs = {}
    }
  }
  return runs
}

function snapshotOf(absDir: string, run: number, files: { exp: string; saved: number }[]): RunSnapshot {
  const runs = loadRuns()
  const known = runs[absDir]
  if (known && run <= known.run + RUN_SLACK) return known
  // A run Spoon hasn't seen: what's there now that the run (or an earlier one) wrote.
  const snap = {
    run,
    files: files.filter((f) => f.saved <= run + RUN_SLACK).map((f) => f.exp),
    trusted: !files.some((f) => f.saved > run + RUN_SLACK)
  }
  runs[absDir] = snap
  try {
    writeFileSync(runsFile(), JSON.stringify(runs))
  } catch {
    // kept for this session
  }
  return snap
}

/** Forgets the export runs seen in a repository (it was removed from Spoon). */
export function forgetRuns(root: string): void {
  const runs = loadRuns()
  const prefix = resolve(root) + sep
  for (const k of Object.keys(runs)) if (k.startsWith(prefix)) delete runs[k]
  try {
    writeFileSync(runsFile(), JSON.stringify(runs))
  } catch {
    // kept for this session
  }
}

/** The .androidlib plug-in folders in an Android export. */
async function androidLibs(root: string, dir: string): Promise<string[]> {
  const out: string[] = []
  for (const parent of [dir, `${dir}/unityLibrary`])
    for (const name of await readdir(join(root, parent)).catch(() => [] as string[])) if (name.endsWith('.androidlib')) out.push(`${parent}/${name}`)
  return out
}

/**
 * Native files made in an export after Unity wrote it (a new class in Android Studio, a new file in
 * Xcode), with no source of their own yet. Each comes with the folders it most likely belongs in:
 * where the files next to it come from, and for iOS the folder its path names (Libraries/<path> is
 * <path> in Assets or a package). Unity's own files were written with the export, so they're left out.
 */
export async function newExportFiles(root: string, dirs: string[]): Promise<ExportNew[]> {
  const index = await sourceIndex(root)
  const roots = await sourceRoots(root)
  const out: ExportNew[] = []
  for (const dir of dirs) {
    inside(root, dir)
    const platform = await platformOf(join(root, dir))
    if (!platform) continue
    const paired = await pairs(root, dir, platform, index)
    const pairedSet = new Set(paired.map((p) => p.exp))
    // Export folder → the source folders its paired files come from, and how many from each.
    const near = new Map<string, Map<string, number>>()
    for (const p of paired) {
      const m = near.get(dirname(p.exp)) ?? new Map<string, number>()
      m.set(dirname(p.src.abs), (m.get(dirname(p.src.abs)) ?? 0) + 1)
      near.set(dirname(p.exp), m)
    }
    const subtrees =
      platform === 'ios'
        ? [`${dir}/Libraries`]
        : [`${dir}/unityLibrary/src/main/java`, `${dir}/unityLibrary/src/main/kotlin`, ...(await androidLibs(root, dir))]
    const files: { exp: string; born: number; saved: number }[] = []
    for (const sub of subtrees) {
      for (const r of await walk(join(root, sub), (x) => NATIVE.has(extname(x).toLowerCase()), sub.endsWith('.androidlib') ? LIB_SKIP : EXPORT_SKIP)) {
        const info = await lstat(join(root, sub, r)).catch(() => null)
        if (info?.isFile()) files.push({ exp: `${sub}/${r}`, born: info.birthtimeMs || info.ctimeMs, saved: info.mtimeMs })
      }
    }
    if (!files.length) continue
    // When Unity last wrote the export (counted on the copies it made of sources; on Unity's own
    // files when every source is linked), and which files that run left: those aren't new, even
    // once edited (Android Studio and Xcode save by replacing the file, so its creation time is no
    // help). The list is taken when Spoon first sees a run; if files were already edited by then,
    // it can't tell edited from new, so nothing is added without asking.
    const copies = files.filter((f) => pairedSet.has(f.exp))
    const exported = runTime((copies.length ? copies : files).map((f) => f.saved))!
    const snap = snapshotOf(join(root, dir), exported, files)
    const before = new Set(snap.files)
    for (const f of files) {
      if (pairedSet.has(f.exp) || before.has(f.exp) || f.saved < snap.run + RUN_SLACK) continue
      if (!snap.trusted && f.born < snap.run + RUN_SLACK) continue // probably one of Unity's, edited
      const folders = new Map<string, number>(near.get(dirname(f.exp)) ?? [])
      if (platform === 'ios') {
        const r = f.exp.slice(`${dir}/Libraries/`.length)
        for (const sr of roots) {
          const rest = !sr.ios ? r : r.startsWith(`${sr.ios}/`) ? r.slice(sr.ios.length + 1) : null
          const d = rest === null ? null : join(sr.abs, dirname(rest))
          if (d && !folders.has(d) && (await isDir(d))) folders.set(d, 0)
        }
      } else {
        // In an .androidlib, the same path inside the plug-in's folder in Assets.
        const m = /^(.*\/([^/]+\.androidlib))\/(.*)$/.exec(f.exp)
        const lib = m && index.find((s) => s.id.includes(`/${m[2]}/`))
        if (m && lib) {
          const base = lib.abs.slice(0, lib.abs.indexOf(`${sep}${m[2]}${sep}`) + m[2].length + 1)
          const d = join(base, dirname(m[3]))
          if (!folders.has(d) && (await isDir(d))) folders.set(d, 0)
        }
      }
      const list = [...folders].sort((a, b) => b[1] - a[1]).map(([abs]) => folderOf(root, abs))
      // Certain: one folder, and a .meta to copy there (so nothing needs a person's eye).
      const only = folders.size === 1 ? [...folders.keys()][0] : null
      out.push({ platform, export: f.exp, saved: f.saved, folders: list, certain: snap.trusted && !!only && !!(await metaToCopy(only, f.exp)) })
    }
  }
  return out
}

/**
 * Writes a .meta for a new native file, copied from one next to it (same type first) so it gets the
 * same plug-in settings (which platforms), with a GUID of its own. False when there's none to copy:
 * then Unity makes one the next time it opens the project.
 */
async function writeMeta(folder: string, file: string): Promise<boolean> {
  if (existsSync(`${file}.meta`)) return true
  const text = await metaToCopy(folder, file)
  if (!text) return false
  await writeFile(`${file}.meta`, text.replace(/^guid: [0-9a-f]{32}/m, `guid: ${randomBytes(16).toString('hex')}`))
  return true
}

/** The .meta of a native file in `folder` to base a new one on (the same type first), or null. */
async function metaToCopy(folder: string, file: string): Promise<string | null> {
  const metas = (await readdir(folder).catch(() => [] as string[])).filter(
    (n) => n.endsWith('.meta') && NATIVE.has(extname(n.slice(0, -'.meta'.length)).toLowerCase())
  )
  const ext = extname(file).toLowerCase()
  for (const pick of [...metas.filter((n) => extname(n.slice(0, -'.meta'.length)).toLowerCase() === ext), ...metas]) {
    const text = await readFile(join(folder, pick), 'utf8').catch(() => '')
    if (/^guid: [0-9a-f]{32}\s*$/m.test(text)) return text
  }
  return null
}

/**
 * Adds a file made in an export to a source folder (in Assets or a local package), with a .meta, and
 * makes the export's copy a link to it, so later edits go straight into the repository.
 */
export async function addToSource(root: string, exp: string, folder: string): Promise<{ source: string; meta: boolean }> {
  const e = inside(root, exp)
  await exportOf(root, exp) // a file in an exported project…
  if (!NATIVE.has(extname(e).toLowerCase())) throw new Error(`${basename(exp)} isn’t a native code file.`) // …that's native code…
  if (!(await lstat(e)).isFile()) throw new Error(`${basename(exp)} isn’t a file of its own in the export.`) // …and not a link
  const dest = isAbsolute(folder) ? resolve(folder) : inside(root, folder)
  if (dest.split(sep).some(git.isGitPart)) throw new Error('Pick a folder in Assets or in a local package.')
  // Where the folder really is (links followed) must be inside Assets or a package too.
  const real = await realpath(dest).catch(() => null)
  const roots = await Promise.all((await sourceRoots(root)).map((r) => realpath(r.abs).catch(() => r.abs)))
  if (!real || !roots.some((r) => real === r || real.startsWith(r + sep))) throw new Error('Pick a folder in Assets or in a local package.')
  if (!(await isDir(real))) throw new Error(`${folder} isn’t a folder.`)
  const file = join(dest, basename(e))
  // Fails rather than overwrite a file of that name, even one made a moment ago.
  await copyFile(e, file, fsConstants.COPYFILE_EXCL).catch((err: NodeJS.ErrnoException) => {
    throw err.code === 'EEXIST' ? new Error(`There’s already a ${basename(e)} in that folder.`) : err
  })
  const meta = await writeMeta(dest, file)
  await rm(e)
  try {
    await symlink(relative(dirname(e), file), e, 'file')
  } catch {
    await copyFile(file, e) // links need Developer Mode on Windows: the export keeps a copy then
  }
  return { source: folderOf(root, dest).id + '/' + basename(e), meta }
}
