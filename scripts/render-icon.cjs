// Renders build/icon.svg to build/icon.png (1024×1024) using Electron's own Chromium,
// so no extra image tools are needed. electron-builder turns the PNG into icon.icns.
// Run with: npm run icon
const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.dock?.hide()

app.whenReady().then(async () => {
  const dir = join(__dirname, '..', 'build')
  const svg = readFileSync(join(dir, 'icon.svg'), 'utf8')
  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    frame: false,
    transparent: true,
    useContentSize: true,
    webPreferences: { offscreen: true }
  })
  const html = `<html><body style="margin:0;background:transparent">${svg}</body></html>`
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  await new Promise((r) => setTimeout(r, 300))
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 })
  writeFileSync(join(dir, 'icon.png'), image.toPNG())
  console.log('wrote build/icon.png', image.getSize())
  app.quit()
})
