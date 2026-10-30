import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { GitCommandEntry, MenuCommand, SpoonApi, UpdateState } from '../shared/types'

const api: SpoonApi = {
  storeSnapshot: ipcRenderer.sendSync('store:snapshot'),
  storeSet: (key, value) => ipcRenderer.send('store:set', key, value),
  pickRepo: () => ipcRenderer.invoke('repo:pick'),
  pickFolder: (title) => ipcRenderer.invoke('ui:pickFolder', title),
  pickFile: (title) => ipcRenderer.invoke('ui:pickFile', title),
  pathForFile: (file) => webUtils.getPathForFile(file),
  fileStamps: (paths) => ipcRenderer.invoke('fs:stamps', paths),
  pathsExist: (paths) => ipcRenderer.invoke('fs:exists', paths),
  scanRepos: (root, depth, nested) => ipcRenderer.invoke('fs:scanRepos', root, depth, nested),
  homeDir: () => ipcRenderer.invoke('fs:home'),
  openRepo: (path) => ipcRenderer.invoke('repo:open', path),
  repoParents: (paths) => ipcRenderer.invoke('repo:parents', paths),
  log: (path, limit) => ipcRenderer.invoke('repo:log', path, limit),
  commitDetails: (path, hash) => ipcRenderer.invoke('repo:commit', path, hash),
  workingTree: (path) => ipcRenderer.invoke('repo:status', path),
  diff: (path, target) => ipcRenderer.invoke('repo:diff', path, target),
  stage: (path, files) => ipcRenderer.invoke('repo:stage', path, files),
  unstage: (path, files) => ipcRenderer.invoke('repo:unstage', path, files),
  discard: (path, files) => ipcRenderer.invoke('repo:discard', path, files),
  stageAll: (path) => ipcRenderer.invoke('repo:stageAll', path),
  unstageAll: (path) => ipcRenderer.invoke('repo:unstageAll', path),
  applyHunk: (path, target, index, header) => ipcRenderer.invoke('repo:applyHunk', path, target, index, header),
  headMessage: (path) => ipcRenderer.invoke('repo:headMessage', path),
  commit: (path, message, amend) => ipcRenderer.invoke('repo:doCommit', path, message, amend),
  checkout: (path, target) => ipcRenderer.invoke('repo:checkout', path, target),
  createBranch: (path, name, base) => ipcRenderer.invoke('repo:createBranch', path, name, base),
  userName: (path) => ipcRenderer.invoke('repo:userName', path),
  syncInfo: (path) => ipcRenderer.invoke('repo:syncInfo', path),
  fetch: (path, prune) => ipcRenderer.invoke('repo:fetch', path, prune),
  updateSubmodule: (path, sub, backup) => ipcRenderer.invoke('repo:updateSubmodule', path, sub, backup),
  submoduleUpdatePreview: (path, sub) => ipcRenderer.invoke('repo:submoduleUpdatePreview', path, sub),
  deleteRemoteBranch: (path, remote, branch) => ipcRenderer.invoke('repo:deleteRemoteBranch', path, remote, branch),
  deleteBranches: (path, names, force) => ipcRenderer.invoke('repo:deleteBranches', path, names, force),
  diffFile: (path, target) => ipcRenderer.invoke('repo:diffFile', path, target),
  ideSchemes: () => ipcRenderer.invoke('ide:schemes'),
  importSyntaxColors: () => ipcRenderer.invoke('ide:import'),
  tagTarget: (path, hash) => ipcRenderer.invoke('repo:tagTarget', path, hash),
  createTag: (path, opts) => ipcRenderer.invoke('repo:createTag', path, opts),
  stashApply: (path, name, pop, hash) => ipcRenderer.invoke('repo:stashApply', path, name, pop, hash),
  stashDrop: (path, name, hash) => ipcRenderer.invoke('repo:stashDrop', path, name, hash),
  fastForwardBranches: (path, names) => ipcRenderer.invoke('repo:fastForwardBranches', path, names),
  pull: (path, opts) => ipcRenderer.invoke('repo:pull', path, opts),
  push: (path, opts) => ipcRenderer.invoke('repo:push', path, opts),
  rebasePlan: (path, onto) => ipcRenderer.invoke('repo:rebasePlan', path, onto),
  rebase: (path, onto) => ipcRenderer.invoke('repo:rebase', path, onto),
  rebaseInteractive: (path, onto, steps) => ipcRenderer.invoke('repo:rebaseInteractive', path, onto, steps),
  rebaseContinue: (path, action) => ipcRenderer.invoke('repo:rebaseContinue', path, action),
  cancel: (path) => ipcRenderer.invoke('repo:cancel', path),
  onProgress: (handler) => {
    const listener = (_e: unknown, repo: string, line: string): void => handler(repo, line)
    ipcRenderer.on('progress', listener)
    return () => ipcRenderer.removeListener('progress', listener)
  },
  closeWindow: () => ipcRenderer.send('ui:closeWindow'),
  revealInFinder: (path) => ipcRenderer.invoke('shell:reveal', path),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  appInfo: () => ipcRenderer.invoke('app:info'),
  platform: process.platform,
  setTitleBarColors: (color, symbolColor, height) => ipcRenderer.send('ui:titleBarColors', color, symbolColor, height),
  updateState: () => ipcRenderer.invoke('update:state'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateState: (handler) => {
    const listener = (_e: unknown, s: UpdateState): void => handler(s)
    ipcRenderer.on('update:state', listener)
    return () => ipcRenderer.removeListener('update:state', listener)
  },
  ghAccount: () => ipcRenderer.invoke('gh:account'),
  ghCliLogin: () => ipcRenderer.invoke('gh:cliLogin'),
  ghConnectCli: () => ipcRenderer.invoke('gh:connectCli'),
  ghConnectToken: (token) => ipcRenderer.invoke('gh:connectToken', token),
  ghDeviceStart: (clientId) => ipcRenderer.invoke('gh:deviceStart', clientId),
  ghDeviceWait: (clientId, code) => ipcRenderer.invoke('gh:deviceWait', clientId, code),
  ghDeviceCancel: () => ipcRenderer.invoke('gh:deviceCancel'),
  ghDisconnect: () => ipcRenderer.invoke('gh:disconnect'),
  ghRepo: (path) => ipcRenderer.invoke('gh:repo', path),
  ghRepoRemote: (path) => ipcRenderer.invoke('gh:repoRemote', path),
  ghPulls: (path) => ipcRenderer.invoke('gh:pulls', path),
  pullDraftInfo: (path, branch) => ipcRenderer.invoke('repo:pullDraftInfo', path, branch),
  ghAssignable: (path) => ipcRenderer.invoke('gh:assignable', path),
  ghCreatePull: (path, pull) => ipcRenderer.invoke('gh:createPull', path, pull),
  ghLatestRelease: (path) => ipcRenderer.invoke('gh:latestRelease', path),
  ghReleaseNotes: (path, tag, target) => ipcRenderer.invoke('gh:releaseNotes', path, tag, target),
  ghCreateRelease: (path, release) => ipcRenderer.invoke('gh:createRelease', path, release),
  gitHistory: () => ipcRenderer.invoke('git:history'),
  watchGitHistory: (on) => ipcRenderer.send('git:watchHistory', on),
  clearGitHistory: () => ipcRenderer.invoke('git:clearHistory'),
  onGitCommand: (handler) => {
    const listener = (_e: unknown, entry: GitCommandEntry): void => handler(entry)
    ipcRenderer.on('git:command', listener)
    return () => ipcRenderer.removeListener('git:command', listener)
  },
  claudeAvailability: () => ipcRenderer.invoke('claude:availability'),
  atlassianAccount: () => ipcRenderer.invoke('atlassian:account'),
  atlassianConnect: (email, token, pageUrl) => ipcRenderer.invoke('atlassian:connect', email, token, pageUrl),
  atlassianDisconnect: () => ipcRenderer.invoke('atlassian:disconnect'),
  confluencePage: (url) => ipcRenderer.invoke('atlassian:page', url),
  readWorkingFile: (path, rel) => ipcRenderer.invoke('file:read', path, rel),
  writeWorkingFile: (path, rel, text, eol) => ipcRenderer.invoke('file:write', path, rel, text, eol),
  fileAtCommit: (path, hash, rel) => ipcRenderer.invoke('file:atCommit', path, hash, rel),
  fileAtCommitToTemp: (path, hash, rel) => ipcRenderer.invoke('file:atCommitToTemp', path, hash, rel),
  restoreFileFrom: (path, hash, rel) => ipcRenderer.invoke('file:restore', path, hash, rel),
  openWithDefaultApp: (path, rel) => ipcRenderer.invoke('file:openDefault', path, rel),
  isUnityProject: (path) => ipcRenderer.invoke('unity:isProject', path),
  findExports: (path) => ipcRenderer.invoke('unity:findExports', path),
  scanExports: (path, dirs) => ipcRenderer.invoke('unity:scanExports', path, dirs),
  watchExports: (path, dirs) => ipcRenderer.invoke('unity:watchExports', path, dirs),
  onExportsChanged: (handler) => {
    const listener = (_e: unknown, repo: string): void => handler(repo)
    ipcRenderer.on('unity:exportsChanged', listener)
    return () => ipcRenderer.removeListener('unity:exportsChanged', listener)
  },
  exportBringBack: (path, exp, src) => ipcRenderer.invoke('unity:bringBack', path, exp, src),
  exportRelink: (path, exp, src, force) => ipcRenderer.invoke('unity:relink', path, exp, src, force),
  jiraIssue: (site, key) => ipcRenderer.invoke('atlassian:jiraIssue', site, key),
  readClipboard: () => ipcRenderer.invoke('clipboard:readText'),
  mainlibState: (path, sub, prefix) => ipcRenderer.invoke('mainlib:state', path, sub, prefix),
  mainlibSwitch: (path, sub, ref) => ipcRenderer.invoke('mainlib:switch', path, sub, ref),
  claudeLaunch: (launch) => ipcRenderer.invoke('claude:launch', launch),
  setMenuItemVisible: (id, visible) => ipcRenderer.send('ui:menuItemVisible', id, visible),
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
