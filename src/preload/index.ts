import { contextBridge, ipcRenderer } from 'electron'
import type { MenuCommand, SpoonApi } from '../shared/types'

const api: SpoonApi = {
  storeSnapshot: ipcRenderer.sendSync('store:snapshot'),
  storeSet: (key, value) => ipcRenderer.send('store:set', key, value),
  pickRepo: () => ipcRenderer.invoke('repo:pick'),
  pickFolder: (title) => ipcRenderer.invoke('ui:pickFolder', title),
  pathsExist: (paths) => ipcRenderer.invoke('fs:exists', paths),
  scanRepos: (root, depth, nested) => ipcRenderer.invoke('fs:scanRepos', root, depth, nested),
  homeDir: () => ipcRenderer.invoke('fs:home'),
  missingProject: (path) => ipcRenderer.invoke('ui:missingProject', path),
  openRepo: (path) => ipcRenderer.invoke('repo:open', path),
  log: (path, limit) => ipcRenderer.invoke('repo:log', path, limit),
  commitDetails: (path, hash) => ipcRenderer.invoke('repo:commit', path, hash),
  workingTree: (path) => ipcRenderer.invoke('repo:status', path),
  diff: (path, target) => ipcRenderer.invoke('repo:diff', path, target),
  stage: (path, files) => ipcRenderer.invoke('repo:stage', path, files),
  unstage: (path, files) => ipcRenderer.invoke('repo:unstage', path, files),
  stageAll: (path) => ipcRenderer.invoke('repo:stageAll', path),
  unstageAll: (path) => ipcRenderer.invoke('repo:unstageAll', path),
  applyHunk: (path, target, index, header) => ipcRenderer.invoke('repo:applyHunk', path, target, index, header),
  headMessage: (path) => ipcRenderer.invoke('repo:headMessage', path),
  commit: (path, message, amend) => ipcRenderer.invoke('repo:doCommit', path, message, amend),
  checkout: (path, target) => ipcRenderer.invoke('repo:checkout', path, target),
  syncInfo: (path) => ipcRenderer.invoke('repo:syncInfo', path),
  fetch: (path, prune) => ipcRenderer.invoke('repo:fetch', path, prune),
  updateSubmodule: (path, sub) => ipcRenderer.invoke('repo:updateSubmodule', path, sub),
  deleteBranches: (path, names, force) => ipcRenderer.invoke('repo:deleteBranches', path, names, force),
  pull: (path, opts) => ipcRenderer.invoke('repo:pull', path, opts),
  push: (path, opts) => ipcRenderer.invoke('repo:push', path, opts),
  onProgress: (handler) => {
    const listener = (_e: unknown, repo: string, line: string): void => handler(repo, line)
    ipcRenderer.on('progress', listener)
    return () => ipcRenderer.removeListener('progress', listener)
  },
  contextMenu: (items) => ipcRenderer.invoke('ui:contextMenu', items),
  confirm: (opts) => ipcRenderer.invoke('ui:confirm', opts),
  revealInFinder: (path) => ipcRenderer.invoke('shell:reveal', path),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  ghAccount: () => ipcRenderer.invoke('gh:account'),
  ghCliLogin: () => ipcRenderer.invoke('gh:cliLogin'),
  ghConnectCli: () => ipcRenderer.invoke('gh:connectCli'),
  ghConnectToken: (token) => ipcRenderer.invoke('gh:connectToken', token),
  ghDeviceStart: (clientId) => ipcRenderer.invoke('gh:deviceStart', clientId),
  ghDeviceWait: (clientId, code) => ipcRenderer.invoke('gh:deviceWait', clientId, code),
  ghDeviceCancel: () => ipcRenderer.invoke('gh:deviceCancel'),
  ghDisconnect: () => ipcRenderer.invoke('gh:disconnect'),
  ghRepo: (path) => ipcRenderer.invoke('gh:repo', path),
  ghPulls: (path) => ipcRenderer.invoke('gh:pulls', path),
  ghPull: (path, n) => ipcRenderer.invoke('gh:pull', path, n),
  ghComment: (path, n, body) => ipcRenderer.invoke('gh:comment', path, n, body),
  ghReply: (path, n, id, body) => ipcRenderer.invoke('gh:reply', path, n, id, body),
  ghSubmitReview: (path, n, review) => ipcRenderer.invoke('gh:submitReview', path, n, review),
  ghSetViewed: (path, nodeId, file, viewed) => ipcRenderer.invoke('gh:setViewed', path, nodeId, file, viewed),
  ghCheckoutPull: (path, n) => ipcRenderer.invoke('gh:checkoutPull', path, n),
  onMenu: (handler) => {
    const listener = (_e: unknown, command: MenuCommand): void => handler(command)
    ipcRenderer.on('menu', listener)
    return () => ipcRenderer.removeListener('menu', listener)
  }
}

contextBridge.exposeInMainWorld('spoon', api)
