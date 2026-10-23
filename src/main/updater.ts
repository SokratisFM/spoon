// Self-updater that works without an Apple Developer ID or Windows code-signing certificate.
//
// Releases publish latest.json: a payload (version, notes, per-platform files with SHA-256) plus an
// ed25519 signature made with the private key from scripts/keygen.mjs. Spoon verifies the signature
// with the public key it ships with, downloads the file itself (so macOS doesn't mark it as
// "downloaded from the internet" and Windows adds no Mark of the Web), checks the hash, and swaps
// the new version in when you restart.
import { app, BrowserWindow, ipcMain, net } from 'electron'
import { spawn } from 'node:child_process'
import { createHash, verify } from 'node:crypto'
import { accessSync, constants, existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import config from '../../spoon.config.json'
import { UPDATE_PUBLIC_KEY } from './update-key'
import type { UpdateState } from '../shared/types'

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000

interface Asset {
  file: string
  sha256: string
  size: number
}

interface Release {
  version: string
  date: string
  notes: string
  assets: Partial<Record<'darwin-arm64' | 'darwin-x64' | 'win32-x64', Asset>>
}

let state: UpdateState = { status: 'idle', current: app.getVersion() }
let staged: { version: string; path: string } | null = null
let busy = false

/** latest.json URL: SPOON_UPDATE_URL (for testing) or the configured repo's latest GitHub release. */
function feedUrl(): string | null {
  if (process.env.SPOON_UPDATE_URL) return process.env.SPOON_UPDATE_URL
  return config.updateRepo ? `https://github.com/${config.updateRepo}/releases/latest/download/latest.json` : null
}

function platformKey(): keyof Release['assets'] | null {
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
    const res = await net.fetch(feed, { cache: 'no-store' })
    if (res.status === 404) return set({ status: 'current', lastCheck: Date.now() }), state // no release yet
    if (!res.ok) throw new Error(`Update check failed (${res.status}).`)
    const release = verifyManifest(await res.text())
    const asset = release.assets[key]
    if (!asset || !newer(release.version, app.getVersion())) {
      set({ status: 'current', lastCheck: Date.now() })
      return state
    }
    set({ status: 'downloading', version: release.version, notes: release.notes, progress: 0, lastCheck: Date.now() })
    const file = await download(new URL(asset.file, feed).toString(), asset)
    staged = { version: release.version, path: await stage(file, release.version) }
    set({ status: 'ready', progress: 1 })
  } catch (err) {
    set({ status: 'error', error: (err as Error).message })
  } finally {
    busy = false
  }
  return state
}

async function download(url: string, asset: Asset): Promise<string> {
  mkdirSync(updatesDir(), { recursive: true })
  const dest = join(updatesDir(), asset.file)
  const part = `${dest}.part`
  // Electron's network stack (Chromium's): follows GitHub's redirects, honors system proxies, and
  // avoids an undici bug that crashed the main process when a server closed a paused download.
  const res = await net.fetch(url)
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}).`)
  const hash = createHash('sha256')
  let received = 0
  let lastReport = 0
  const out = await open(part, 'w')
  try {
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      hash.update(value)
      await out.write(value)
      received += value.length
      if (Date.now() - lastReport > 250) {
        lastReport = Date.now()
        set({ progress: asset.size ? received / asset.size : 0 })
      }
    }
  } finally {
    await out.close()
  }
  if (hash.digest('hex') !== asset.sha256) {
    rmSync(part, { force: true })
    throw new Error('Downloaded update doesn’t match its checksum. It was discarded.')
  }
  renameSync(part, dest)
  return dest
}

/** macOS: unzip next to the other updates. Windows: the installer itself is the staged file. */
async function stage(file: string, version: string): Promise<string> {
  if (process.platform !== 'darwin') return file
  const dir = join(updatesDir(), version)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  await new Promise<void>((ok, fail) =>
    spawn('ditto', ['-x', '-k', file, dir]).on('exit', (code) => (code === 0 ? ok() : fail(new Error('Could not unpack the update.'))))
  )
  rmSync(file, { force: true })
  const appDir = readdirSync(dir).find((n) => n.endsWith('.app'))
  if (!appDir) throw new Error('The update doesn’t contain an app.')
  return join(dir, appDir)
}

/** Path of the running Spoon.app bundle (…/Spoon.app/Contents/MacOS/Spoon → …/Spoon.app). */
function bundlePath(): string {
  return resolve(process.execPath, '..', '..', '..')
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
    writeFileSync(
      script,
      `#!/bin/sh
while kill -0 ${process.pid} 2>/dev/null; do sleep 0.2; done
OLD="${target}.old-$$"
if mv "${target}" "$OLD" && mv "${staged.path}" "${target}"; then
  rm -rf "$OLD"
else
  [ -d "$OLD" ] && [ ! -d "${target}" ] && mv "$OLD" "${target}"
fi
open "${target}"
rm -f "$0"
`,
      { mode: 0o755 }
    )
    spawn('/bin/sh', [script], { detached: true, stdio: 'ignore' }).unref()
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
  if (existsSync(updatesDir())) rmSync(updatesDir(), { recursive: true, force: true })
  setTimeout(() => void checkForUpdates(), 10_000)
  setInterval(() => void checkForUpdates(), CHECK_EVERY_MS)
}
