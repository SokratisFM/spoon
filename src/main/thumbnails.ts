// Thumbnails for Simple Mode's file cards: the system's own previews (Quick Look on macOS, the
// shell's on Windows), so PSDs, TGAs, PDFs and videos get one too, not just what a browser can show.
import { nativeImage, shell } from 'electron'
import { rm, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import * as git from './git'

// By absolute path, size and modification time: an unchanged file reuses its thumbnail.
const cache = new Map<string, string | null>()
const CACHE_MAX = 400

async function thumbnailOf(abs: string, size: number): Promise<string | null> {
  try {
    const img = await nativeImage.createThumbnailFromPath(abs, { width: size, height: size })
    return img.isEmpty() ? null : img.toDataURL()
  } catch {
    return null
  }
}

function remember(key: string, url: string | null): string | null {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string)
  cache.set(key, url)
  return url
}

/** A data URL of the working copy's file, or of its version in a commit; null when there's no preview. */
export async function thumbnail(cwd: string, rel: string, hash: string | null, size: number): Promise<string | null> {
  if (hash) {
    const key = `${cwd}|${hash}|${rel}|${size}`
    if (cache.has(key)) return cache.get(key) ?? null
    const tmp = await git.fileAtCommitToTemp(cwd, hash, rel).catch(() => null)
    if (!tmp) return remember(key, null)
    try {
      return remember(key, await thumbnailOf(tmp, size))
    } finally {
      await rm(dirname(tmp), { recursive: true, force: true }).catch(() => undefined)
    }
  }
  const abs = git.repoFile(cwd, rel)
  const st = await stat(abs).catch(() => null)
  if (!st?.isFile()) return null
  const key = `${abs}|${st.size}|${st.mtimeMs}|${size}`
  if (cache.has(key)) return cache.get(key) ?? null
  return remember(key, await thumbnailOf(abs, size))
}

/** Opens a commit's version of a file (a temporary copy) in its default app; "" when it opened. */
export async function openAtCommit(cwd: string, hash: string, rel: string): Promise<string> {
  return shell.openPath(await git.fileAtCommitToTemp(cwd, hash, rel))
}
