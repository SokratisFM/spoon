import { contextBridge, ipcRenderer } from 'electron'
import type { MenuCommand, SpoonApi } from '../shared/types'

const api: SpoonApi = {
  pickRepo: () => ipcRenderer.invoke('repo:pick'),
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
  onMenu: (handler) => {
    const listener = (_e: unknown, command: MenuCommand): void => handler(command)
    ipcRenderer.on('menu', listener)
    return () => ipcRenderer.removeListener('menu', listener)
  }
}

contextBridge.exposeInMainWorld('spoon', api)
