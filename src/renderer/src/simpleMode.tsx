// Simple Mode: a project shown as files, saves and the team instead of branches, graphs and diffs,
// for people who don't use git themselves (artists, designers). Set up per project in Settings →
// Simple Mode; the title bar's Simple/Full switch flips between it and the full view.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { readStored } from './hooks'
import * as storage from './storage'
import { Modal } from './components/Modal'

export interface SimpleConfig {
  /** Showing Simple Mode now (off: the full view, with the switch to come back). */
  on: boolean
  /** The branch to work on; '' = whichever is checked out. */
  branch: string
  /** Only files under this folder (relative to the repository) are shown and saved; '' = all. */
  folder: string
  /** Changed files as preview cards, or as a compact list. */
  view: 'previews' | 'list'
  /** The main button saves and shares (commit and push) in one go. */
  shareOnSave: boolean
  /** The title bar's Simple/Full switch is hidden (Settings can still turn Simple Mode off). */
  hideSwitch: boolean
  /** Turning Simple Mode off or changing these asks for it; '' = no PIN. */
  pin: string
  /** File types (TYPE_GROUPS ids) that are hidden, and so not saved; types not in the list always show. */
  hiddenTypes: string[]
}

/** The file types Simple Mode can hide, in the order the filter row shows them. */
export const TYPE_GROUPS: { id: string; label: string; exts: string[] }[] = [
  { id: 'images', label: 'Images', exts: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tga', 'tif', 'tiff', 'exr', 'hdr', 'heic', 'ico', 'icns'] },
  { id: 'photoshop', label: 'Photoshop', exts: ['psd', 'psb'] },
  { id: 'vector', label: 'Vector art', exts: ['svg', 'ai', 'eps'] },
  { id: 'models', label: '3D models', exts: ['fbx', 'obj', 'blend', 'max', 'ma', 'mb', 'dae', 'gltf', 'glb', '3ds', 'spp', 'sbsar'] },
  { id: 'audio', label: 'Sounds', exts: ['wav', 'mp3', 'ogg', 'aif', 'aiff', 'flac', 'm4a'] },
  { id: 'video', label: 'Videos', exts: ['mp4', 'mov', 'm4v', 'webm', 'avi'] },
  { id: 'fonts', label: 'Fonts', exts: ['ttf', 'otf', 'fnt', 'fontsettings'] },
  { id: 'scenes', label: 'Scenes', exts: ['unity'] },
  { id: 'prefabs', label: 'Prefabs', exts: ['prefab'] },
  { id: 'materials', label: 'Materials', exts: ['mat', 'physicmaterial', 'physicsmaterial2d', 'cubemap', 'rendertexture', 'flare'] },
  { id: 'animations', label: 'Animations', exts: ['anim', 'controller', 'overridecontroller', 'mask', 'playable', 'signal'] },
  { id: 'unity-assets', label: 'Other Unity assets', exts: ['asset', 'spriteatlas', 'spriteatlasv2', 'guiskin', 'mixer', 'terrainlayer', 'brush', 'lighting', 'giparams', 'preset'] },
  { id: 'meta', label: 'Unity .meta files', exts: ['meta'] },
  { id: 'shaders', label: 'Shaders', exts: ['shader', 'shadergraph', 'shadersubgraph', 'hlsl', 'cginc', 'compute', 'glsl', 'vfx'] },
  { id: 'code', label: 'Code', exts: ['cs', 'java', 'kt', 'swift', 'm', 'mm', 'h', 'c', 'cpp', 'js', 'ts', 'py', 'lua', 'sh', 'gradle', 'pro'] },
  { id: 'data', label: 'Settings & data', exts: ['json', 'xml', 'yaml', 'yml', 'asmdef', 'asmref', 'plist', 'csv', 'ini', 'cfg', 'inputactions', 'uss', 'uxml'] },
  { id: 'docs', label: 'Documents', exts: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'rtf', 'pages', 'key', 'numbers'] }
]
const GROUP_BY_EXT = new Map(TYPE_GROUPS.flatMap((g) => g.exts.map((e) => [e, g.id] as const)))
/** The TYPE_GROUPS id of a file, or null when its type isn't in the list (then it always shows). */
export const typeGroupOf = (file: string): string | null =>
  GROUP_BY_EXT.get(/\.([^./]+)$/.exec(file)?.[1]?.toLowerCase() ?? '') ?? null

export const SIMPLE_DEFAULTS: SimpleConfig = {
  on: true,
  branch: '',
  folder: '',
  view: 'previews',
  shareOnSave: true,
  hideSwitch: false,
  pin: '',
  // Unity writes .meta files by itself (they're saved along with their asset anyway), and code,
  // shaders and settings are a developer's.
  hiddenTypes: ['meta', 'shaders', 'code', 'data']
}

const KEY = 'spoon.simple'
const listeners = new Set<() => void>()
let configs = readStored<Record<string, SimpleConfig>>(KEY, {})

/** The project's Simple Mode setup, or null when it was never set up. */
export function simpleConfig(path: string | null): SimpleConfig | null {
  const c = path ? configs[path] : undefined
  return c ? { ...SIMPLE_DEFAULTS, ...c } : null
}

export function setSimpleConfig(path: string, patch: Partial<SimpleConfig> | null): void {
  const next = { ...configs }
  if (patch) next[path] = { ...SIMPLE_DEFAULTS, ...configs[path], ...patch }
  else delete next[path]
  configs = next
  try {
    storage.setItem(KEY, JSON.stringify(configs))
  } catch {
    // keep in memory
  }
  listeners.forEach((l) => l())
}

// A project removed from Spoon takes its Simple Mode setup (and what was being typed) with it.
window.addEventListener('spoon:project-forgotten', (e) => {
  const path = (e as CustomEvent<string>).detail
  if (configs[path]) setSimpleConfig(path, null)
  for (const k of ['tab', 'message']) storage.removeItem(`spoon.simple.${k}.${path}`)
})

export function useSimpleConfig(path: string | null): SimpleConfig | null {
  const all = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => configs
  )
  const c = path ? all[path] : undefined
  return c ? { ...SIMPLE_DEFAULTS, ...c } : null
}

// ---------- the PIN prompt ----------

interface PinRequest {
  pin: string
  reason: string
  resolve: (ok: boolean) => void
}
let pinRequest: PinRequest | null = null
const pinListeners = new Set<() => void>()

/** Asks for the project's PIN; true when it was entered (or there is none). */
export function askPin(config: SimpleConfig | null, reason: string): Promise<boolean> {
  if (!config?.pin) return Promise.resolve(true)
  return new Promise((resolve) => {
    pinRequest?.resolve(false)
    pinRequest = { pin: config.pin, reason, resolve }
    pinListeners.forEach((l) => l())
  })
}

/** Mounted once in App: shows askPin()'s requests. */
export function PinHost() {
  const req = useSyncExternalStore(
    (l) => {
      pinListeners.add(l)
      return () => pinListeners.delete(l)
    },
    () => pinRequest
  )
  return req ? <PinDialog key={req.reason} req={req} /> : null
}

function PinDialog({ req }: { req: PinRequest }) {
  const [value, setValue] = useState('')
  const [wrong, setWrong] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])
  const finish = (ok: boolean): void => {
    pinRequest = null
    pinListeners.forEach((l) => l())
    req.resolve(ok)
  }
  const submit = (): void => {
    if (value === req.pin) finish(true)
    else {
      setWrong(true)
      setValue('')
      input.current?.focus()
    }
  }
  return (
    <Modal
      title="Enter the PIN"
      onClose={() => finish(false)}
      onSubmit={submit}
      footer={
        <>
          <button className="btn" onClick={() => finish(false)}>
            Cancel
          </button>
          <button className="btn primary" disabled={!value} onClick={submit}>
            Unlock
          </button>
        </>
      }
    >
      <p className="muted">{req.reason}</p>
      <input
        ref={input}
        type="password"
        className="simple-pin-input"
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          setWrong(false)
        }}
        placeholder="PIN"
      />
      {wrong && <p className="error-text">That’s not the PIN.</p>}
    </Modal>
  )
}

/** File types the system can draw a preview of (images, Photoshop files, PDFs, videos). */
const PREVIEWABLE = /\.(png|jpe?g|gif|webp|bmp|tga|tiff?|psd|psb|exr|hdr|heic|svg|pdf|ai|mp4|mov|m4v|ico|icns)$/i
export const isPreviewable = (file: string): boolean => PREVIEWABLE.test(file)

/** What kind of file it is, in plain words, for its icon and label. */
export function fileKind(file: string): { kind: string; label: string } {
  const ext = /\.([^./]+)$/.exec(file)?.[1]?.toLowerCase() ?? ''
  if (/^(png|jpe?g|gif|webp|bmp|tga|tiff?|exr|hdr|heic|ico|icns)$/.test(ext)) return { kind: 'image', label: 'Image' }
  if (/^(psd|psb)$/.test(ext)) return { kind: 'image', label: 'Photoshop' }
  if (ext === 'svg' || ext === 'ai') return { kind: 'image', label: 'Vector' }
  if (/^(fbx|obj|blend|max|ma|mb|dae|gltf|glb|3ds)$/.test(ext)) return { kind: 'model', label: '3D model' }
  if (/^(wav|mp3|ogg|aif|aiff|flac|m4a)$/.test(ext)) return { kind: 'audio', label: 'Sound' }
  if (/^(mp4|mov|m4v|webm|avi)$/.test(ext)) return { kind: 'video', label: 'Video' }
  if (ext === 'unity') return { kind: 'scene', label: 'Scene' }
  if (ext === 'prefab') return { kind: 'prefab', label: 'Prefab' }
  if (/^(mat|anim|controller|asset|spriteatlas|shadergraph|overridecontroller|mask|physicmaterial)$/.test(ext))
    return { kind: 'asset', label: 'Unity asset' }
  if (ext === 'meta') return { kind: 'meta', label: 'Unity settings' }
  if (/^(ttf|otf|fnt)$/.test(ext)) return { kind: 'font', label: 'Font' }
  if (/^(pdf|docx?|xlsx?|pptx?|txt|md|rtf)$/.test(ext)) return { kind: 'doc', label: 'Document' }
  if (/^(cs|java|kt|swift|m|mm|h|c|cpp|js|ts|py|shader|hlsl|cginc|json|xml|yaml|yml|gradle)$/.test(ext))
    return { kind: 'code', label: 'Code' }
  return { kind: 'file', label: ext ? ext.toUpperCase() : 'File' }
}

/** "just now", "5 minutes ago", "2 hours ago", "yesterday", "3 days ago", then a date. */
export function timeAgo(unix: number): string {
  const s = Math.max(0, Date.now() / 1000 - unix)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} minute${s < 120 ? '' : 's'} ago`
  if (s < 86400) return `${Math.floor(s / 3600)} hour${s < 7200 ? '' : 's'} ago`
  if (s < 2 * 86400) return 'yesterday'
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} days ago`
  return new Date(unix * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}
