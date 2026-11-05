// Renders the Windows installer's pictures (build/installer/*.svg) with Electron's own Chromium, then
// turns them into the 24-bit BMPs NSIS wants (ImageMagick: `magick`). Run with: npm run installer-art
const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync } = require('node:fs')
const { execFileSync } = require('node:child_process')
const { join } = require('node:path')

app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.dock?.hide()

// name: [width, height] the installer shows it at; drawn at 4× and scaled down for smooth edges.
const ART = { sidebar: [164, 314], header: [150, 57] }

app.whenReady().then(async () => {
  const dir = join(__dirname, '..', 'build', 'installer')
  // One window for all of them (a second offscreen window fails to load here).
  const win = new BrowserWindow({ width: 800, height: 1300, show: false, frame: false, useContentSize: true, webPreferences: { offscreen: true } })
  for (const [name, [w, h]] of Object.entries(ART)) {
    const svg = readFileSync(join(dir, `${name}.svg`), 'utf8')
    // Through a file (a data: URL this size can fail to load).
    const page = join(require('node:os').tmpdir(), `spoon-installer-${name}.html`)
    writeFileSync(page, `<html><body style="margin:0">${svg}</body></html>`)
    await win.loadFile(page)
    await new Promise((r) => setTimeout(r, 300))
    const png = join(dir, `${name}.png`)
    writeFileSync(png, (await win.webContents.capturePage({ x: 0, y: 0, width: w * 4, height: h * 4 })).toPNG())
    execFileSync('magick', [png, '-resize', `${w}x${h}!`, '-alpha', 'off', '-type', 'TrueColor', `BMP3:${join(dir, `${name}.bmp`)}`])
    console.log(`wrote build/installer/${name}.bmp (${w}×${h})`)
  }
  app.quit()
})
