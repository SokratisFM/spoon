// Settings, tabs, projects and drafts, saved as JSON in the app's data folder
// (~/Library/Application Support/Spoon), outside the app bundle, so rebuilds and updates keep them.
// Every change is written within a moment (atomically), not only on a clean quit.
import { app, ipcMain } from 'electron'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

type Data = Record<string, string>

let file = ''
let data: Data = {}
let timer: NodeJS.Timeout | null = null
// Once quitting, the window's last changes (sent as it unloads, after before-quit) are written at once.
let quitting = false

function save(): void {
  if (timer) clearTimeout(timer)
  timer = null
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2))
  renameSync(tmp, file)
}

export function initStore(): void {
  file = join(app.getPath('userData'), 'spoon-state.json')
  try {
    data = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Data) : {}
  } catch {
    data = {} // unreadable file: start fresh rather than refuse to launch
  }
  // The renderer reads everything once, synchronously, before its first render.
  ipcMain.on('store:snapshot', (e) => {
    e.returnValue = data
  })
  ipcMain.on('store:set', (_e, key: string, value: string | null) => {
    if (value === null) delete data[key]
    else data[key] = value
    if (quitting) save()
    else if (!timer) timer = setTimeout(save, 150)
  })
  app.on('before-quit', () => {
    quitting = true
    if (timer) save()
  })
  app.on('will-quit', () => timer && save())
}
