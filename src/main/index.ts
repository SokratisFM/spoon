import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, shell } from 'electron'
import { join } from 'node:path'
import { appendFileSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import * as git from './git'
import { pathsExist, scanRepos, toSlash } from './scan'
import config from '../../spoon.config.json'
import { initUpdater } from './updater'
import * as gh from './github'
import * as claude from './claude'
import * as history from './history'
import * as atlassian from './atlassian'
import * as ide from './ide'
import * as unityExports from './exports'
import * as thumbnails from './thumbnails'
import { initStore } from './store'
import { loadWindowState, trackWindowState } from './window-state'
import { homedir } from 'node:os'
import type { ClaudeLaunch, NewPull, NewRelease, NewTagOptions, DiscardEntry, DeviceCode, ReviewSubmission, CheckoutTarget, DiffTarget, MenuCommand, PullOptions, PushOptions, RebaseStep } from '../shared/types'

// Lets a test run keep its own settings and tabs instead of sharing yours.
if (process.env.SPOON_USER_DATA) app.setPath('userData', process.env.SPOON_USER_DATA)

// One Spoon per data folder: a second copy would overwrite the first one's state, and its updater
// would delete an update the first one has staged. Opening it again brings the running one forward.
const primary = app.requestSingleInstanceLock()
if (!primary) app.quit()
app.on('second-instance', () => {
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.focus()
})

// Unexpected errors in the background go to spoon.log in the data folder instead of a blocking
// "JavaScript error in the main process" dialog.
function logError(kind: string, err: unknown): void {
  const line = `${new Date().toISOString()} ${kind}: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`
  try {
    appendFileSync(join(app.getPath('userData'), 'spoon.log'), line)
  } catch {
    // nowhere to write; ignore
  }
  console.error(line)
}
process.on('uncaughtException', (err) => logError('uncaught exception', err))
process.on('unhandledRejection', (err) => logError('unhandled rejection', err))

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
                { label: 'What’s New…', click: () => send('whats-new') },
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
          // ⌘T and ⌘O both open the project switcher (Tab does too); ⇧⌘O browses for any folder.
          { label: 'New Tab…', accelerator: 'CmdOrCtrl+T', click: () => send('find-project') },
          { label: 'Open Repository…', accelerator: 'CmdOrCtrl+O', click: () => send('find-project') },
          { label: 'Open Folder…', accelerator: 'CmdOrCtrl+Shift+O', click: () => send('open-repo') },
          { label: 'Compare…', accelerator: 'CmdOrCtrl+Alt+D', click: () => send('compare-files') },
          { type: 'separator' },
          // ⌘W / Ctrl+W closes the current repository tab; the renderer closes the window when
          // there's no tab left to close (so the window's usual close behavior applies).
          { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => send('close-tab') },
          { role: 'close', label: 'Close Window', accelerator: 'CmdOrCtrl+Shift+W' },
          ...(isMac ? [] : [{ type: 'separator' as const }, { role: 'quit' as const }])
        ]
      },
      { role: 'editMenu' },
      {
        label: 'Repository',
        submenu: [
          { label: 'Commit', accelerator: 'CmdOrCtrl+Enter', click: () => send('commit') },
          { label: 'Commit and Push', accelerator: 'CmdOrCtrl+Alt+Enter', click: () => send('commit-push') },
          { label: 'Discard Selected Changes…', accelerator: 'CmdOrCtrl+Shift+D', click: () => send('discard') },
          { label: 'New Branch from Ticket…', accelerator: 'CmdOrCtrl+N', click: () => send('new-branch') },
          { label: 'Open File in Spoon…', accelerator: 'CmdOrCtrl+E', click: () => send('open-file') },
          { label: 'New Tag…', accelerator: 'CmdOrCtrl+Shift+G', click: () => send('new-tag') },
          { id: 'review', label: 'Review with Claude…', accelerator: 'CmdOrCtrl+Shift+R', click: () => send('review') },
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
          { label: 'Git Command History', accelerator: 'CmdOrCtrl+Shift+H', click: () => send('git-history') },
          { label: 'Filter Commits', accelerator: 'CmdOrCtrl+F', click: () => send('filter-commits') },
          { label: 'Squish Branches', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('squish') },
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
      {
        role: 'window',
        submenu: [
          { role: 'minimize' },
          { role: 'zoom' },
          ...(isMac ? [{ type: 'separator' as const }, { role: 'front' as const }] : [])
        ]
      }
    ])
  )
}

function createWindow(): void {
  const saved = loadWindowState()
  win = new BrowserWindow({
    width: saved?.bounds.width ?? 1440,
    height: saved?.bounds.height ?? 900,
    ...(saved?.bounds.x !== undefined ? { x: saved.bounds.x, y: saved.bounds.y } : {}),
    minWidth: 900,
    minHeight: 560,
    show: false,
    // macOS: inset traffic lights over our own title bar. Windows/Linux: native caption buttons
    // drawn over it (titleBarOverlay), recolored to match the theme from the renderer.
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 18 } }
      : { titleBarStyle: 'hidden' as const, titleBarOverlay: { color: '#18191e', symbolColor: '#e7e8ec', height: 40 } }),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#16171b' : '#f7f7f8',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.webContents.setVisualZoomLevelLimits(1, 1).catch(() => undefined)
  trackWindowState(win)
  win.once('ready-to-show', () => {
    if (saved?.maximized) win?.maximize()
    win?.show()
    if (saved?.fullScreen) win?.setFullScreen(true)
  })
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
    return res.canceled ? null : toSlash(res.filePaths[0])
  })
  ipcMain.handle('ui:pickFile', async (_e, title: string) => {
    const res = await dialog.showOpenDialog(win!, { title, properties: ['openFile'] })
    return res.canceled ? null : toSlash(res.filePaths[0])
  })
  ipcMain.handle('fs:stamps', (_e, paths: string[]) =>
    Promise.all(paths.map((p) => stat(p).then((s) => s.mtimeMs, () => null)))
  )
  ipcMain.handle('ui:pickFolder', async (_e, title: string) => {
    const res = await dialog.showOpenDialog(win!, { title, properties: ['openDirectory', 'createDirectory'] })
    return res.canceled ? null : toSlash(res.filePaths[0])
  })
  ipcMain.handle('fs:exists', (_e, paths: string[]) => pathsExist(paths))
  ipcMain.handle('fs:scanRepos', (_e, root: string, depth: number, nested: boolean) =>
    scanRepos(root, depth, nested)
  )
  ipcMain.handle('fs:home', () => toSlash(homedir()))
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    githubClientId: config.githubClientId,
    updateRepo: config.updateRepo
  }))
  ipcMain.on('ui:titleBarColors', (e, color: string, symbolColor: string, height: number) => {
    if (process.platform !== 'darwin')
      BrowserWindow.fromWebContents(e.sender)?.setTitleBarOverlay({ color, symbolColor, height: Math.round(height) })
  })
  ipcMain.handle('repo:open', (_e, path: string) => git.openRepo(path))
  ipcMain.handle('repo:parents', (_e, paths: string[]) => git.superprojects(paths))
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
  ipcMain.handle('gh:repoRemote', (_e, path: string) => gh.repoRemote(path))
  ipcMain.handle('gh:pulls', (_e, path: string) => gh.pulls(path))
  ipcMain.handle('repo:pullDraftInfo', (_e, path: string, branch: string) => git.pullDraftInfo(path, branch))
  ipcMain.handle('gh:assignable', (_e, path: string) => gh.assignable(path))
  ipcMain.handle('gh:createPull', (_e, path: string, pull: NewPull) => gh.createPull(path, pull))
  ipcMain.handle('gh:latestRelease', (_e, path: string) => gh.latestRelease(path))
  ipcMain.handle('gh:releaseNotes', (_e, path: string, tag: string, target: string) => gh.releaseNotes(path, tag, target))
  ipcMain.handle('gh:createRelease', (_e, path: string, release: NewRelease) => gh.createRelease(path, release))
  ipcMain.handle('claude:availability', () => claude.availability())
  ipcMain.handle('atlassian:account', () => atlassian.account())
  ipcMain.handle('atlassian:connect', (_e, email: string, token: string, pageUrl: string) =>
    atlassian.connect(email, token, pageUrl)
  )
  ipcMain.handle('atlassian:disconnect', () => atlassian.disconnect())
  ipcMain.handle('atlassian:page', (_e, url: string) => atlassian.page(url))
  // Calls about files in a repository name it by its folder: that has to be a repository (the top of
  // a work tree), not any folder on disk.
  const handleRepo = <A extends unknown[]>(
    channel: string,
    fn: (e: Electron.IpcMainInvokeEvent, path: string, ...args: A) => unknown
  ): void =>
    ipcMain.handle(channel, (e, path: string, ...args: A) => {
      git.assertRepoRoot(path)
      return fn(e, path, ...args)
    })
  handleRepo('file:read', (_e, path: string, rel: string) => git.readWorkingFile(path, rel))
  handleRepo('file:write', (_e, path: string, rel: string, text: string, eol: 'lf' | 'crlf', expect?: number) =>
    git.writeWorkingFile(path, rel, text, eol, expect)
  )
  handleRepo('file:atCommit', (_e, path: string, hash: string, rel: string) => git.fileAtCommit(path, hash, rel))
  handleRepo('file:atCommitToTemp', (_e, path: string, hash: string, rel: string) => git.fileAtCommitToTemp(path, hash, rel))
  handleRepo('file:restore', (_e, path: string, hash: string, rel: string) =>
    git.restoreFileFrom(path, hash, rel, (p) => shell.trashItem(p))
  )
  // Resolves to an error message, or "" when it opened.
  handleRepo('file:openDefault', async (_e, path: string, rel: string) => shell.openPath(await git.realRepoFile(path, rel)))
  handleRepo('file:thumbnail', (_e, path: string, rel: string, hash: string | null, size: number) => thumbnails.thumbnail(path, rel, hash, size))
  handleRepo('file:openAtCommit', (_e, path: string, hash: string, rel: string) => thumbnails.openAtCommit(path, hash, rel))
  ipcMain.handle('unity:forget', (_e, path: string) => unityExports.forgetRuns(path))
  ipcMain.handle('unity:isProject', (_e, path: string) => unityExports.isUnityProject(path))
  handleRepo('unity:findExports', (_e, path: string) => unityExports.findExports(path))
  handleRepo('unity:scanExports', (_e, path: string, dirs: string[]) => unityExports.scanExports(path, dirs))
  const exportOwners = new Set<number>()
  handleRepo('unity:watchExports', (e, path: string, dirs: string[]) => {
    const owner = e.sender.id
    if (!exportOwners.has(owner)) {
      exportOwners.add(owner)
      e.sender.once('destroyed', () => {
        exportOwners.delete(owner)
        unityExports.stopWatching(owner)
      })
    }
    return unityExports.watchExports(owner, path, dirs, () => {
      if (!e.sender.isDestroyed()) e.sender.send('unity:exportsChanged', path)
    })
  })
  handleRepo('unity:bringBack', (_e, path: string, items: unityExports.BringBackItem[]) => unityExports.bringBack(path, items))
  handleRepo('unity:newFiles', (_e, path: string, dirs: string[]) => unityExports.newExportFiles(path, dirs))
  handleRepo('unity:add', (_e, path: string, exp: string, folder: string) => unityExports.addToSource(path, exp, folder))
  handleRepo('unity:relink', (_e, path: string, exp: string, src: string, force: boolean) =>
    unityExports.relink(path, exp, src, force)
  )
  ipcMain.handle('atlassian:jiraIssue', (_e, site: string, key: string) => atlassian.jiraIssue(site, key))
  ipcMain.handle('clipboard:readText', () => clipboard.readText())
  ipcMain.handle('mainlib:state', (_e, path: string, sub: string, prefix: string) => git.mainlibState(path, sub, prefix))
  ipcMain.handle('mainlib:switch', (_e, path: string, sub: string, ref: string) => git.mainlibSwitch(path, sub, ref))
  ipcMain.handle('git:history', () => history.list())
  ipcMain.handle('git:clearHistory', () => history.clear())
  // Only windows showing the history get each command (two messages per git command otherwise).
  const watching = new Set<Electron.WebContents>()
  ipcMain.on('git:watchHistory', (e, on: boolean) => {
    if (!on) return void watching.delete(e.sender)
    watching.add(e.sender)
    e.sender.once('destroyed', () => watching.delete(e.sender))
  })
  history.onCommand((entry) => {
    for (const wc of watching) if (!wc.isDestroyed()) wc.send('git:command', entry)
  })
  ipcMain.handle('claude:launch', (_e, launch: ClaudeLaunch) => claude.launch(launch))
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
  ipcMain.handle('repo:discard', (_e, path: string, files: DiscardEntry[]) =>
    git.discard(path, files, (p) => shell.trashItem(p))
  )
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
  ipcMain.handle('repo:createBranch', (_e, path: string, name: string, base: string) => git.createBranch(path, name, base))
  ipcMain.handle('repo:userName', (_e, path: string) => git.userName(path))
  ipcMain.handle('repo:syncInfo', (_e, path: string) => git.syncInfo(path))
  ipcMain.handle('repo:updateSubmodule', (_e, path: string, sub: string, backup?: string) =>
    git.updateSubmodule(path, sub, backup)
  )
  ipcMain.handle('repo:submoduleUpdatePreview', (_e, path: string, sub: string) => git.submoduleUpdatePreview(path, sub))
  ipcMain.handle('repo:deleteRemoteBranch', (_e, path: string, remote: string, branch: string) =>
    git.deleteRemoteBranch(path, remote, branch)
  )
  ipcMain.handle('repo:rebasePlan', (_e, path: string, onto: string) => git.rebasePlan(path, onto))
  ipcMain.handle('repo:rebase', (_e, path: string, onto: string) => git.rebase(path, onto))
  ipcMain.handle('repo:rebaseInteractive', (_e, path: string, onto: string, steps: RebaseStep[]) =>
    git.rebaseInteractive(path, onto, steps)
  )
  ipcMain.handle('repo:cancel', (_e, path: string) => git.cancel(path))
  ipcMain.handle('repo:rebaseContinue', (_e, path: string, action: 'continue' | 'skip' | 'abort') =>
    git.rebaseContinue(path, action)
  )
  ipcMain.handle('ide:schemes', () => ide.detect())
  ipcMain.handle('ide:import', async () => {
    const res = await dialog.showOpenDialog(win!, {
      title: 'Import syntax colors',
      properties: ['openFile'],
      filters: [{ name: 'Rider scheme or VS Code theme', extensions: ['icls', 'xml', 'json', 'jsonc'] }]
    })
    return res.canceled || !res.filePaths[0] ? null : ide.importFile(res.filePaths[0])
  })
  ipcMain.handle('repo:diffFile', (_e, path: string, target: DiffTarget) => git.diffFile(path, target))
  ipcMain.handle('repo:tagTarget', (_e, path: string, hash: string) => git.tagTarget(path, hash))
  ipcMain.handle('repo:createTag', (_e, path: string, opts: NewTagOptions) => git.createTag(path, opts))
  ipcMain.handle('repo:stashApply', (_e, path: string, name: string, pop: boolean, hash?: string) =>
    git.stashApply(path, name, pop, hash)
  )
  ipcMain.handle('repo:stashDrop', (_e, path: string, name: string, hash?: string) => git.stashDrop(path, name, hash))
  ipcMain.handle('repo:fastForwardBranches', (_e, path: string, names: string[]) => git.fastForwardBranches(path, names))
  ipcMain.handle('repo:deleteBranches', (_e, path: string, names: string[], force: boolean) =>
    git.deleteBranches(path, names, force)
  )

  // Network operations stream git's progress lines back to the window that started them.
  const progress = (e: Electron.IpcMainInvokeEvent, path: string) => (line: string) =>
    void (!e.sender.isDestroyed() && e.sender.send('progress', path, line))
  ipcMain.handle('repo:fetch', (e, path: string, prune: boolean) => git.fetch(path, prune, progress(e, path)))
  ipcMain.handle('repo:fetchQuietly', (_e, path: string) => git.fetchQuietly(path))
  ipcMain.handle('repo:pull', (e, path: string, opts: PullOptions) => git.pull(path, opts, progress(e, path)))
  ipcMain.handle('repo:push', (e, path: string, opts: PushOptions) => git.push(path, opts, progress(e, path)))

  // Menu items the renderer can hide (e.g. Review with Claude when Claude is turned off in Settings).
  ipcMain.on('ui:menuItemVisible', (_e, id: string, visible: boolean) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(id)
    if (item) item.visible = visible
  })
  // A quit that a window held up (unsaved edits in the file popup) goes on once that window closes.
  let quitAskedAt = 0
  app.on('before-quit', () => (quitAskedAt = Date.now()))
  ipcMain.on('ui:closeWindow', (e, afterUnsaved?: boolean) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return
    const resumeQuit = !!afterUnsaved && Date.now() - quitAskedAt < 120_000
    if (resumeQuit) win.once('closed', () => app.quit())
    win.close()
  })
}

// Spoon's windows only ever show the app itself. A link (middle-click, ⌘-click, drag and drop,
// window.open) must never load another page into a window that has the preload API, so https
// links go to the browser and every other navigation is refused.
app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  contents.on('will-navigate', (e) => e.preventDefault())
  contents.on('will-attach-webview', (e) => e.preventDefault())
})

app.whenReady().then(() => {
  if (!primary) return
  initStore()
  buildMenu()
  initUpdater()
  registerIpc()
  createWindow()
  void git.cleanTempFolders()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
