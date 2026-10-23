import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } from 'electron'
import { join } from 'node:path'
import * as git from './git'
import { pathsExist, scanRepos } from './scan'
import * as gh from './github'
import { initStore } from './store'
import { homedir } from 'node:os'
import { basename } from 'node:path'
import type { DeviceCode, ReviewSubmission, CheckoutTarget, ConfirmOptions, DiffTarget, MenuCommand, MenuItem, PullOptions, PushOptions } from '../shared/types'

// Lets a test run keep its own settings and tabs instead of sharing yours.
if (process.env.SPOON_USER_DATA) app.setPath('userData', process.env.SPOON_USER_DATA)

let win: BrowserWindow | null = null

function send(command: MenuCommand): void {
  win?.webContents.send('menu', command)
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin'
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(isMac
        ? [
            {
              label: app.name,
              submenu: [
                { role: 'about' as const },
                { type: 'separator' as const },
                { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => send('settings') },
                { type: 'separator' as const },
                { role: 'services' as const },
                { type: 'separator' as const },
                { role: 'hide' as const },
                { role: 'hideOthers' as const },
                { role: 'unhide' as const },
                { type: 'separator' as const },
                { role: 'quit' as const }
              ]
            }
          ]
        : []),
      {
        label: 'File',
        submenu: [
          { label: 'Open Repository…', accelerator: 'CmdOrCtrl+O', click: () => send('open-repo') },
          { type: 'separator' },
          isMac ? { role: 'close' } : { role: 'quit' }
        ]
      },
      { role: 'editMenu' },
      {
        label: 'Repository',
        submenu: [
          { label: 'Commit', accelerator: 'CmdOrCtrl+Enter', click: () => send('commit') },
          { type: 'separator' },
          { label: 'Fetch', accelerator: 'CmdOrCtrl+Shift+F', click: () => send('fetch') },
          { label: 'Pull…', accelerator: 'CmdOrCtrl+Shift+L', click: () => send('pull') },
          { label: 'Push…', accelerator: 'CmdOrCtrl+Shift+P', click: () => send('push') }
        ]
      },
      {
        label: 'View',
        submenu: [
          { label: 'Refresh', accelerator: 'CmdOrCtrl+R', click: () => send('refresh') },
          { type: 'separator' },
          // UI scaling is done by the renderer (CSS), not Electron's page zoom, so layout
          // and row heights stay crisp and consistent at every size.
          { label: 'Bigger', accelerator: 'CmdOrCtrl+=', click: () => send('zoom-in') },
          { label: 'Bigger', accelerator: 'CmdOrCtrl+Plus', visible: false, click: () => send('zoom-in') },
          { label: 'Smaller', accelerator: 'CmdOrCtrl+-', click: () => send('zoom-out') },
          { label: 'Default Size', accelerator: 'CmdOrCtrl+0', click: () => send('zoom-reset') },
          { type: 'separator' },
          { role: 'toggleDevTools' },
          { role: 'togglefullscreen' }
        ]
      },
      { role: 'windowMenu' }
    ])
  )
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 560,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#16171b' : '#f7f7f8',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.webContents.setVisualZoomLevelLimits(1, 1)
  win.once('ready-to-show', () => win?.show())
  win.on('closed', () => (win = null))

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

function registerIpc(): void {
  ipcMain.handle('repo:pick', async () => {
    const res = await dialog.showOpenDialog(win!, {
      title: 'Open Repository',
      properties: ['openDirectory']
    })
    return res.canceled ? null : res.filePaths[0]
  })
  ipcMain.handle('ui:pickFolder', async (_e, title: string) => {
    const res = await dialog.showOpenDialog(win!, { title, properties: ['openDirectory', 'createDirectory'] })
    return res.canceled ? null : res.filePaths[0]
  })
  ipcMain.handle('fs:exists', (_e, paths: string[]) => pathsExist(paths))
  ipcMain.handle('fs:scanRepos', (_e, root: string, depth: number, nested: boolean) =>
    scanRepos(root, depth, nested)
  )
  ipcMain.handle('fs:home', () => homedir())
  ipcMain.handle('ui:missingProject', async (e, path: string) => {
    const owner = BrowserWindow.fromWebContents(e.sender)!
    const res = await dialog.showMessageBox(owner, {
      type: 'warning',
      message: `“${basename(path)}” can’t be found`,
      detail: `${path}\n\nIt may have been moved, renamed or deleted.`,
      buttons: ['Remove from Spoon', 'Locate…', 'Cancel'],
      defaultId: 0,
      cancelId: 2
    })
    return (['remove', 'locate', 'cancel'] as const)[res.response]
  })
  ipcMain.handle('repo:open', (_e, path: string) => git.openRepo(path))
  ipcMain.handle('repo:log', (_e, path: string, limit: number) => git.log(path, limit))
  ipcMain.handle('repo:commit', (_e, path: string, hash: string) => git.commitDetails(path, hash))
  ipcMain.handle('repo:status', (_e, path: string) => git.workingTree(path))
  ipcMain.handle('repo:diff', (_e, path: string, target: DiffTarget) => git.diff(path, target))
  ipcMain.handle('shell:reveal', (_e, path: string) => shell.showItemInFolder(path))
  ipcMain.handle('shell:openExternal', (_e, url: string) => {
    if (/^https:\/\//.test(url)) return shell.openExternal(url)
  })

  ipcMain.handle('gh:account', () => gh.getAccount())
  ipcMain.handle('gh:cliLogin', () => gh.cliLogin())
  ipcMain.handle('gh:connectCli', () => gh.connectCli())
  ipcMain.handle('gh:connectToken', (_e, token: string) => gh.connectToken(token))
  ipcMain.handle('gh:deviceStart', (_e, clientId: string) => gh.deviceStart(clientId))
  ipcMain.handle('gh:deviceWait', (_e, clientId: string, code: DeviceCode) => gh.deviceWait(clientId, code))
  ipcMain.handle('gh:deviceCancel', () => gh.deviceCancel())
  ipcMain.handle('gh:disconnect', () => gh.disconnect())
  ipcMain.handle('gh:repo', (_e, path: string) => gh.repoSlug(path))
  ipcMain.handle('gh:pulls', (_e, path: string) => gh.pulls(path))
  ipcMain.handle('gh:pull', (_e, path: string, n: number) => gh.pull(path, n))
  ipcMain.handle('gh:comment', (_e, path: string, n: number, body: string) => gh.comment(path, n, body))
  ipcMain.handle('gh:reply', (_e, path: string, n: number, id: number, body: string) => gh.reply(path, n, id, body))
  ipcMain.handle('gh:submitReview', (_e, path: string, n: number, review: ReviewSubmission) =>
    gh.submitReview(path, n, review)
  )
  ipcMain.handle('gh:setViewed', (_e, _path: string, nodeId: string, file: string, viewed: boolean) =>
    gh.setViewed(nodeId, file, viewed)
  )
  ipcMain.handle('gh:checkoutPull', (_e, path: string, n: number) => gh.checkoutPull(path, n))

  ipcMain.handle('repo:stage', (_e, path: string, files: string[]) => git.stage(path, files))
  ipcMain.handle('repo:unstage', (_e, path: string, files: string[]) => git.unstage(path, files))
  ipcMain.handle('repo:stageAll', (_e, path: string) => git.stageAll(path))
  ipcMain.handle('repo:unstageAll', (_e, path: string) => git.unstageAll(path))
  ipcMain.handle('repo:applyHunk', (_e, path: string, target: DiffTarget, index: number, header: string) =>
    git.applyHunk(path, target, index, header)
  )
  ipcMain.handle('repo:headMessage', (_e, path: string) => git.headMessage(path))
  ipcMain.handle('repo:doCommit', (_e, path: string, message: string, amend: boolean) =>
    git.commit(path, message, amend)
  )
  ipcMain.handle('repo:checkout', (_e, path: string, target: CheckoutTarget) => git.checkout(path, target))
  ipcMain.handle('repo:syncInfo', (_e, path: string) => git.syncInfo(path))
  ipcMain.handle('repo:updateSubmodule', (_e, path: string, sub: string) => git.updateSubmodule(path, sub))
  ipcMain.handle('repo:deleteBranches', (_e, path: string, names: string[], force: boolean) =>
    git.deleteBranches(path, names, force)
  )

  // Network operations stream git's progress lines back to the window that started them.
  const progress = (e: Electron.IpcMainInvokeEvent, path: string) => (line: string) =>
    e.sender.send('progress', path, line)
  ipcMain.handle('repo:fetch', (e, path: string, prune: boolean) => git.fetch(path, prune, progress(e, path)))
  ipcMain.handle('repo:pull', (e, path: string, opts: PullOptions) => git.pull(path, opts, progress(e, path)))
  ipcMain.handle('repo:push', (e, path: string, opts: PushOptions) => git.push(path, opts, progress(e, path)))

  ipcMain.handle('ui:contextMenu', (e, items: MenuItem[]) => {
    const owner = BrowserWindow.fromWebContents(e.sender) ?? undefined
    return new Promise<string | null>((resolve) => {
      let chosen: string | null = null
      Menu.buildFromTemplate(
        items.map((it) =>
          it.separator
            ? { type: 'separator' as const }
            : { label: it.label, enabled: it.enabled !== false, click: () => (chosen = it.id ?? null) }
        )
      ).popup({ window: owner, callback: () => setTimeout(() => resolve(chosen)) })
    })
  })
  ipcMain.handle('ui:confirm', async (e, opts: ConfirmOptions) => {
    const owner = BrowserWindow.fromWebContents(e.sender)!
    const res = await dialog.showMessageBox(owner, {
      type: 'question',
      message: opts.message,
      detail: opts.detail,
      buttons: [opts.confirmLabel, 'Cancel'],
      defaultId: 0,
      cancelId: 1
    })
    return res.response === 0
  })
}

app.whenReady().then(() => {
  initStore()
  buildMenu()
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
