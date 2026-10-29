// Self-updater that works without an Apple Developer ID or Windows code-signing certificate.
//
// Releases publish latest.json: a payload (version, notes, per-platform files with SHA-256) plus an
// ed25519 signature made with the private key from scripts/keygen.mjs. Spoon verifies the signature
// with the public key it ships with, downloads the file itself (so macOS doesn't mark it as
// "downloaded from the internet" and Windows adds no Mark of the Web), checks the hash, and swaps
// the new version in when you restart.
//
// While the release runs the same Electron as this copy, only Spoon's code is downloaded (a few MB:
// Resources + Info.plist on macOS, resources\ on Windows) and swapped into the installed app; the
// full installer is only needed across an Electron upgrade.
import { app, BrowserWindow, ipcMain, net } from 'electron'
import { spawn } from 'node:child_process'
import { createHash, verify } from 'node:crypto'
import { accessSync, constants, existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import config from '../../spoon.config.json'
import { UPDATE_PUBLIC_KEY } from './update-key'
import type { UpdateState } from '../shared/types'

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000
// A check or download that stops making progress fails, so `busy` never sticks for the session.
const STALL_MS = 60_000

interface Asset {
  file: string
  /** Where to download it; without one, `file` is next to latest.json. */
  url?: string
  /** The version it installs (full installers can come from an earlier release). */
  version?: string
  sha256: string
  size: number
}

type PlatformKey = 'darwin-arm64' | 'darwin-x64' | 'win32-x64'

interface Release {
  version: string
  date: string
  notes: string
  /** The Electron version the release runs on (from 0.32.0 on). */
  electron?: string
  /** What 0.31.0 and older read: full installers in the same release (only in full releases). */
  assets: Partial<Record<PlatformKey, Asset>>
  /** Full installers, possibly in an earlier release (with links). */
  full?: Partial<Record<PlatformKey, Asset>>
  /** Spoon's code alone, for copies already on `electron`. */
  code?: Partial<Record<PlatformKey, Asset>>
}

let state: UpdateState = { status: 'idle', current: app.getVersion() }
let staged: { version: string; path: string; code: boolean } | null = null
let busy = false

/** latest.json URL: SPOON_UPDATE_URL (for testing) or the configured repo's latest GitHub release. */
function feedUrl(): string | null {
  if (process.env.SPOON_UPDATE_URL) return process.env.SPOON_UPDATE_URL
  return config.updateRepo ? `https://github.com/${config.updateRepo}/releases/latest/download/latest.json` : null
}

function platformKey(): PlatformKey | null {
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64'
  if (process.platform === 'win32' && process.arch === 'x64') return 'win32-x64'
  return null
}

function set(next: Partial<UpdateState>): void {
  state = { ...state, ...next }
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('update:state', state)
}

export function newer(a: string, b: string): boolean {
  const pa = a.split(/[.-]/).map((n) => parseInt(n, 10) || 0)
  const pb = b.split(/[.-]/).map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  }
  return false
}

/** Parses latest.json and checks its signature; throws on anything that doesn't verify. */
export function verifyManifest(text: string, publicKey = UPDATE_PUBLIC_KEY): Release {
  const { payload, signature } = JSON.parse(text) as { payload: string; signature: string }
  if (typeof payload !== 'string' || typeof signature !== 'string') throw new Error('Update manifest is malformed.')
  const ok = verify(null, Buffer.from(payload), publicKey, Buffer.from(signature, 'base64'))
  if (!ok) throw new Error('Update manifest signature is invalid. The update was ignored.')
  return JSON.parse(payload) as Release
}

const updatesDir = (): string => join(app.getPath('userData'), 'updates')

export async function checkForUpdates(): Promise<UpdateState> {
  const feed = feedUrl()
  const key = platformKey()
  if (!feed || !key) {
    set({ status: 'disabled' })
    return state
  }
  if (busy || state.status === 'ready') return state
  busy = true
  set({ status: 'checking', error: undefined })
  try {
    const res = await net.fetch(feed, { cache: 'no-store', signal: AbortSignal.timeout(STALL_MS) })
    if (res.status === 404) return set({ status: 'current', lastCheck: Date.now() }), state // no release yet
    if (!res.ok) throw new Error(`Update check failed (${res.status}).`)
    const release = verifyManifest(await res.text())
    const { asset, code } = pickAsset(release, key, process.versions.electron)
    if (!asset || !newer(release.version, app.getVersion())) {
      set({ status: 'current', lastCheck: Date.now() })
      return state
    }
    set({ status: 'downloading', version: release.version, notes: release.notes, progress: 0, lastCheck: Date.now() })
    const file = await download(asset.url ?? new URL(asset.file, feed).toString(), asset)
    staged = { version: release.version, path: await stage(file, release.version, code), code }
    set({ status: 'ready', progress: 1 })
  } catch (err) {
    set({ status: 'error', error: (err as Error).message })
  } finally {
    busy = false
  }
  return state
}

/** Spoon's code alone when the release runs this Electron, else the full installer. */
export function pickAsset(release: Release, key: PlatformKey, electron: string): { asset?: Asset; code: boolean } {
  const code = release.code?.[key]
  if (code && release.electron === electron) return { asset: code, code: true }
  const full = release.full?.[key] ?? release.assets[key]
  // A full installer carried over from an earlier release that isn't newer than this copy would only
  // install an older Spoon (and be offered again and again).
  if (full?.version && !newer(full.version, app.getVersion())) return { code: false }
  return { asset: full, code: false }
}

async function download(url: string, asset: Asset): Promise<string> {
  mkdirSync(updatesDir(), { recursive: true })
  const dest = join(updatesDir(), basename(asset.file))
  const part = `${dest}.part`
  // Electron's network stack (Chromium's): follows GitHub's redirects, honors system proxies, and
  // avoids an undici bug that crashed the main process when a server closed a paused download.
  const abort = new AbortController()
  let stall = setTimeout(() => abort.abort(), STALL_MS)
  const res = await net.fetch(url, { signal: abort.signal })
  if (!res.ok || !res.body) {
    clearTimeout(stall)
    throw new Error(`Download failed (${res.status}).`)
  }
  const hash = createHash('sha256')
  let received = 0
  let lastReport = 0
  const out = await open(part, 'w')
  try {
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      clearTimeout(stall)
      if (done) break
      stall = setTimeout(() => abort.abort(), STALL_MS)
      hash.update(value)
      await out.write(value)
      received += value.length
      if (Date.now() - lastReport > 250) {
        lastReport = Date.now()
        set({ progress: asset.size ? received / asset.size : 0 })
      }
    }
  } catch (err) {
    rmSync(part, { force: true })
    throw abort.signal.aborted ? new Error('The update download stalled. It will be tried again later.') : err
  } finally {
    clearTimeout(stall)
    await out.close()
  }
  if (hash.digest('hex') !== asset.sha256) {
    rmSync(part, { force: true })
    throw new Error('Downloaded update doesn’t match its checksum. It was discarded.')
  }
  renameSync(part, dest)
  return dest
}

/**
 * Code: unzipped into a folder (macOS: Resources + Info.plist; Windows: resources). Full: macOS
 * unzips the app next to the other updates; on Windows the installer itself is the staged file.
 */
async function stage(file: string, version: string, code: boolean): Promise<string> {
  if (process.platform !== 'darwin' && !code) return file
  const dir = join(updatesDir(), version)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  // ditto on macOS; Windows 10 and later have bsdtar, which reads zips.
  const [cmd, args] = process.platform === 'darwin' ? ['ditto', ['-x', '-k', file, dir]] : ['tar', ['-xf', file, '-C', dir]]
  await new Promise<void>((ok, fail) =>
    spawn(cmd, args)
      .on('error', () => fail(new Error('Could not unpack the update.')))
      .on('exit', (c) => (c === 0 ? ok() : fail(new Error('Could not unpack the update.'))))
  )
  rmSync(file, { force: true })
  if (code) {
    const expect = process.platform === 'darwin' ? join(dir, 'Resources', 'app.asar') : join(dir, 'resources', 'app.asar')
    if (!existsSync(expect)) throw new Error('The update doesn’t contain Spoon’s code.')
    return dir
  }
  const appDir = readdirSync(dir).find((n) => n.endsWith('.app'))
  if (!appDir) throw new Error('The update doesn’t contain an app.')
  return join(dir, appDir)
}

/** Path of the running Spoon.app bundle (…/Spoon.app/Contents/MacOS/Spoon → …/Spoon.app). */
function bundlePath(): string {
  return resolve(process.execPath, '..', '..', '..')
}

const sq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`

/**
 * The shell script that installs a staged update once Spoon has quit, then opens it again.
 *
 * macOS checks an app it hasn't seen before on its first launch (~2.5 s for an Electron app), so
 * when the Electron framework is unchanged (any update that isn't an Electron upgrade) only
 * Spoon's own files (Resources and Info.plist) are swapped inside the installed app and its
 * signature renewed; the already-checked framework and helpers stay. A clone of the app is kept
 * until that verifies, and anything unexpected falls back to replacing the whole bundle (keeping
 * the old one until the new one is in place).
 */
export function updateScript(pid: number, target: string, staged: string): string {
  return `#!/bin/sh
TARGET=${sq(target)}
NEW=${sq(staged)}
while kill -0 ${pid} 2>/dev/null; do sleep 0.2; done
FW="Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework"
swap() {
  [ -d "$TARGET" ] || { mv "$NEW" "$TARGET"; return; }
  OLD="$TARGET.old-$$"
  if mv "$TARGET" "$OLD" && mv "$NEW" "$TARGET"; then
    rm -rf "$OLD"
  else
    [ -d "$OLD" ] && [ ! -d "$TARGET" ] && mv "$OLD" "$TARGET"
  fi
}
if [ -d "$TARGET" ] && cmp -s "$NEW/$FW" "$TARGET/$FW"; then
  BACKUP="$TARGET.backup-$$"
  if { cp -cR "$TARGET" "$BACKUP" 2>/dev/null || ditto "$TARGET" "$BACKUP"; } &&
    rsync -a --checksum --delete "$NEW/Contents/Resources/" "$TARGET/Contents/Resources/" &&
    cp "$NEW/Contents/Info.plist" "$TARGET/Contents/Info.plist" &&
    codesign --force --sign - "$TARGET" 2>/dev/null &&
    codesign --verify --deep --strict "$TARGET" 2>/dev/null; then
    rm -rf "$BACKUP" "$NEW"
  else
    [ -d "$BACKUP" ] && rm -rf "$TARGET" && mv "$BACKUP" "$TARGET"
    swap
  fi
else
  swap
fi
# A test copy (own SPOON_USER_DATA) isn't reopened: open would start it with your real data.
[ -n "$SPOON_USER_DATA" ] || open "$TARGET"
rm -f "$0"
`
}

/**
 * macOS, code only: swaps Resources and Info.plist inside the installed app once Spoon has quit,
 * renews its ad-hoc signature, and opens it again. A clone of the app is kept until the result
 * verifies, and put back if it doesn't.
 */
export function codeUpdateScript(pid: number, target: string, staged: string): string {
  return `#!/bin/sh
TARGET=${sq(target)}
NEW=${sq(staged)}
while kill -0 ${pid} 2>/dev/null; do sleep 0.2; done
BACKUP="$TARGET.backup-$$"
if { cp -cR "$TARGET" "$BACKUP" 2>/dev/null || ditto "$TARGET" "$BACKUP"; } &&
  rsync -a --checksum --delete "$NEW/Resources/" "$TARGET/Contents/Resources/" &&
  cp "$NEW/Info.plist" "$TARGET/Contents/Info.plist" &&
  codesign --force --sign - "$TARGET" 2>/dev/null &&
  codesign --verify --deep --strict "$TARGET" 2>/dev/null; then
  rm -rf "$BACKUP"
elif [ -d "$BACKUP" ]; then
  rm -rf "$TARGET" && mv "$BACKUP" "$TARGET"
fi
rm -rf "$NEW"
# A test copy (own SPOON_USER_DATA) isn't reopened: open would start it with your real data.
[ -n "$SPOON_USER_DATA" ] || open "$TARGET"
rm -f "$0"
`
}

/** Windows, code only: the same with resources\ next to Spoon.exe, from PowerShell. */
export function windowsCodeUpdateScript(pid: number, exe: string, staged: string): string {
  const q = (s: string): string => `'${s.replace(/'/g, "''")}'`
  return `$ErrorActionPreference = 'Stop'
Wait-Process -Id ${pid} -ErrorAction SilentlyContinue
$res = Join-Path (Split-Path ${q(exe)}) 'resources'
$backup = "$res.backup"
try {
  if (Test-Path $backup) { Remove-Item $backup -Recurse -Force }
  Copy-Item $res $backup -Recurse
  robocopy (Join-Path ${q(staged)} 'resources') $res /MIR /R:3 /W:1 /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw 'copy failed' }
  Remove-Item $backup -Recurse -Force
} catch {
  if (Test-Path $backup) { Remove-Item $res -Recurse -Force -ErrorAction SilentlyContinue; Move-Item $backup $res }
}
Remove-Item ${q(staged)} -Recurse -Force -ErrorAction SilentlyContinue
Start-Process ${q(exe)}
Remove-Item $MyInvocation.MyCommand.Path -Force
`
}

export function installUpdate(): void {
  if (!staged) return
  if (!app.isPackaged) {
    set({ status: 'error', error: 'Updates can only be installed from a packaged build.' })
    return
  }
  if (process.platform === 'darwin') {
    const target = bundlePath()
    try {
      accessSync(dirname(target), constants.W_OK)
    } catch {
      set({ status: 'error', error: `Spoon can’t replace itself in ${dirname(target)}. Download the new version manually.` })
      return
    }
    // A tiny script outlives Spoon: waits for it to quit, swaps the bundles (keeping the old one
    // until the new one is in place), then opens the new version.
    const script = join(tmpdir(), `spoon-update-${process.pid}.sh`)
    const text = staged.code ? codeUpdateScript(process.pid, target, staged.path) : updateScript(process.pid, target, staged.path)
    writeFileSync(script, text, { mode: 0o755 })
    spawn('/bin/sh', [script], { detached: true, stdio: 'ignore' }).unref()
  } else if (staged.code) {
    const script = join(tmpdir(), `spoon-update-${process.pid}.ps1`)
    writeFileSync(script, windowsCodeUpdateScript(process.pid, process.execPath, staged.path))
    spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script], {
      detached: true,
      stdio: 'ignore'
    }).unref()
  } else {
    // electron-builder's NSIS installer: /S installs silently over the current version,
    // --force-run starts Spoon again afterwards.
    spawn(staged.path, ['/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref()
  }
  app.quit()
}

export function initUpdater(): void {
  ipcMain.handle('update:state', () => state)
  ipcMain.handle('update:check', () => checkForUpdates())
  ipcMain.handle('update:install', () => installUpdate())
  if (!feedUrl() || !platformKey()) {
    state = { ...state, status: 'disabled' }
    return
  }
  // Leftovers from an update that's already installed.
  try {
    if (existsSync(updatesDir())) rmSync(updatesDir(), { recursive: true, force: true })
  } catch {
    // still in use (Windows, right after an update): cleared next time
  }
  setTimeout(() => void checkForUpdates(), 10_000)
  setInterval(() => void checkForUpdates(), CHECK_EVERY_MS)
}
