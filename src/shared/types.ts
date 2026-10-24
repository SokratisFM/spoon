// Types shared by the main process (which runs git) and the renderer (which draws it).

export interface Commit {
  hash: string
  parents: string[]
  authorName: string
  authorEmail: string
  authorTime: number // unix seconds
  committerName: string
  commitTime: number
  subject: string
}

export type RefKind = 'head' | 'remote' | 'tag' | 'stash'

export interface Ref {
  name: string // short name, e.g. "main", "origin/main", "v1.0"
  fullName: string // e.g. "refs/heads/main"
  kind: RefKind
  target: string // commit hash (peeled for annotated tags)
  upstream?: string
  ahead?: number
  behind?: number
  gone?: boolean
}

export interface Stash {
  index: number
  name: string // stash@{0}
  hash: string
  message: string
}

export interface RepoState {
  path: string
  name: string
  headBranch: string | null // null when detached
  headHash: string | null // null in an empty repo
  refs: Ref[]
  stashes: Stash[]
  remotes: string[]
  operation: string | null // "MERGING", "REBASING", ...
  /** While a rebase is stopped: where it is and why it stopped. */
  rebase: RebaseProgress | null
  submodules: Submodule[]
  /** When this repo is itself a submodule: the parent repo's path. */
  superproject: string | null
}

export interface ShortCommit {
  hash: string
  subject: string
}

/** What updating a submodule to the parent's recorded commit would do, for the confirmation dialog. */
export interface SubmoduleUpdatePreview {
  branch: string | null
  head: string
  headSubject: string
  recorded: string
  /** The recorded commit isn't in the submodule yet; it gets fetched first. */
  needsFetch: boolean
  /** Commits you have that the recorded one doesn't (newest first, capped), and how many in total. */
  ahead: ShortCommit[]
  aheadCount: number
  /** Commits the recorded one has that you don't. */
  behind: ShortCommit[]
  behindCount: number
  /** Subject of the recorded commit. */
  recordedSubject: string | null
  /** On a branch that can simply fast-forward to the recorded commit, so the branch is kept. */
  fastForward: boolean
  /** A local branch already at the recorded commit; the update switches to it. */
  landingBranch: string | null
  /** Commits reachable only from the current (detached) HEAD: they'd end up on no branch. */
  orphaned: ShortCommit[]
  /** Files with uncommitted changes. */
  dirtyFiles: number
}

export interface RebaseProgress {
  branch: string | null // the branch being rebased
  onto: string // commit hash it's being replayed onto
  step: number
  total: number
  /** The step it stopped on: "edit" stops on purpose, anything else stopped on a conflict. */
  stoppedAction: string | null
  stoppedSubject: string | null
}

export type RebaseAction = 'pick' | 'reword' | 'edit' | 'squash' | 'fixup' | 'drop'

export interface RebaseCommit {
  hash: string
  subject: string
  body: string
  authorName: string
  authorTime: number
}

export interface RebasePlan {
  /** Commits that would be replayed, newest first. */
  commits: RebaseCommit[]
  /** Merge commits in the range; a rebase flattens them. */
  merges: number
  /** Some of these commits are already on a remote, so the result needs a force push. */
  pushed: boolean
}

export interface RebaseStep {
  hash: string
  action: RebaseAction
  /** New message for "reword". */
  message?: string
}

/** done: the rebase finished. Otherwise it stopped (conflict or "edit") and is still in progress. */
export interface RebaseResult {
  done: boolean
}

export interface Submodule {
  path: string // relative to the parent repo
  name: string // last path segment
  hash: string // checked-out commit
  branch: string | null // null when detached (the usual state for submodules)
  /** uninitialized: not cloned yet; outdated: checked-out commit differs from the one the parent records */
  state: 'ok' | 'uninitialized' | 'outdated' | 'conflict'
  dirty: boolean // uncommitted changes inside the submodule
  /** The commit the parent repo records for it (differs from hash when outdated). */
  recorded: string
  /** For outdated submodules: how the checked-out commit relates to the recorded one. */
  relation?: 'ahead' | 'behind' | 'diverged'
  ahead?: number
  behind?: number
}

export interface DeleteResult {
  deleted: string[]
  /** Branches git refused to delete with -d because their commits exist nowhere else. */
  unmerged: string[]
}

export type FileStatus = 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U' | '?'

export interface FileChange {
  path: string
  oldPath?: string
  status: FileStatus
}

export interface CommitDetails {
  hash: string
  parents: string[]
  authorName: string
  authorEmail: string
  authorTime: number
  committerName: string
  committerEmail: string
  commitTime: number
  message: string
  files: FileChange[]
}

export interface WorkingTree {
  staged: FileChange[]
  unstaged: FileChange[]
}

/** What a diff request refers to. */
export type DiffTarget =
  | { kind: 'commit'; hash: string; file: FileChange }
  | { kind: 'staged'; file: FileChange }
  | { kind: 'unstaged'; file: FileChange }

export interface DiffResult {
  text: string
  binary: boolean
  truncated: boolean
}

export type CheckoutTarget =
  | { kind: 'branch'; name: string }
  | { kind: 'remote'; name: string } // e.g. "origin/feature/x"; creates or switches to a tracking branch
  | { kind: 'commit'; hash: string } // detached HEAD

export interface SyncInfo {
  branch: string | null
  remotes: string[]
  upstreamRemote: string | null
  upstreamBranch: string | null
}

export interface PullOptions {
  rebase: boolean
  autostash: boolean
}

export interface PushOptions {
  remote: string
  remoteBranch: string
  setUpstream: boolean
  tags: boolean
  /** --force-with-lease: needed after rewriting commits that were already pushed. */
  force?: boolean
}

export interface MenuItem {
  id?: string
  label?: string
  enabled?: boolean
  separator?: boolean
  /** Shown as a checkbox (or radio dot) in its current state. */
  kind?: 'checkbox' | 'radio'
  checked?: boolean
}

// ---------- GitHub ----------

export type GitHubSource = 'gh' | 'token' | 'browser'

export interface GitHubAccount {
  login: string
  name: string | null
  avatarUrl: string
  scopes: string[]
  source: GitHubSource
}

export interface DeviceCode {
  userCode: string
  verificationUri: string
  deviceCode: string
  interval: number
  expiresIn: number
}

export interface GhUser {
  login: string
  avatarUrl: string
}

export interface PullSummary {
  number: number
  title: string
  author: GhUser
  draft: boolean
  headRef: string
  baseRef: string
  updatedAt: string
  url: string
  /** You are a requested reviewer. */
  reviewRequested: boolean
  mine: boolean
}

export interface PullFile {
  path: string
  previousPath?: string
  status: string // added, removed, modified, renamed, ...
  additions: number
  deletions: number
  patch?: string // missing for binary or very large files
  viewed: boolean
}

export type TimelineItem =
  | { kind: 'comment'; id: number; author: GhUser; body: string; createdAt: string }
  | { kind: 'review'; id: number; author: GhUser; state: string; body: string; createdAt: string }

export interface ReviewComment {
  id: number
  path: string
  line: number | null // null when the comment no longer applies to the current diff
  startLine: number | null
  side: 'LEFT' | 'RIGHT'
  body: string
  author: GhUser
  createdAt: string
  inReplyTo?: number
  diffHunk: string
}

export interface PullDetail {
  number: number
  nodeId: string
  title: string
  body: string
  state: 'open' | 'closed' | 'merged'
  draft: boolean
  author: GhUser
  headRef: string
  headSha: string
  headRepo: string | null // owner/name; differs from the base repo for forks
  baseRef: string
  baseRepo: string
  url: string
  createdAt: string
  additions: number
  deletions: number
  checks: { total: number; passed: number; failed: number; pending: number }
  commits: { sha: string; message: string; author: string; avatarUrl?: string; date: string }[]
  files: PullFile[]
  timeline: TimelineItem[]
  reviewComments: ReviewComment[]
  viewer: string
}

export interface PendingComment {
  id: string
  path: string
  line: number
  side: 'LEFT' | 'RIGHT'
  startLine?: number
  startSide?: 'LEFT' | 'RIGHT'
  body: string
}

export type ReviewEvent = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'

export interface ReviewSubmission {
  event: ReviewEvent
  body: string
  commitId: string
  comments: PendingComment[]
}

export interface UpdateState {
  /** disabled: no update source configured (or unsupported platform) */
  status: 'disabled' | 'idle' | 'checking' | 'current' | 'downloading' | 'ready' | 'error'
  current: string
  version?: string // the newer version, once found
  notes?: string
  progress?: number // 0–1 while downloading
  error?: string
  lastCheck?: number
}

export interface AppInfo {
  version: string
  platform: string
  githubClientId: string
  updateRepo: string
}

export interface SpoonApi {
  /** Everything saved in spoon-state.json, read once at startup. */
  storeSnapshot: Record<string, string>
  storeSet(key: string, value: string | null): void
  pickRepo(): Promise<string | null>
  pickFolder(title: string): Promise<string | null>
  pathsExist(paths: string[]): Promise<boolean[]>
  /** Git repositories under `root` (may start with ~), at most `depth` folders deep. */
  scanRepos(root: string, depth: number, nested: boolean): Promise<string[]>
  homeDir(): Promise<string>
  /** Asks what to do about a project folder that no longer exists. */
  openRepo(path: string): Promise<RepoState>
  /** Parent repo of each path when it's a submodule, else null. */
  repoParents(paths: string[]): Promise<(string | null)[]>
  log(path: string, limit: number): Promise<Commit[]>
  commitDetails(path: string, hash: string): Promise<CommitDetails>
  workingTree(path: string): Promise<WorkingTree>
  diff(path: string, target: DiffTarget): Promise<DiffResult>

  stage(path: string, files: string[]): Promise<void>
  unstage(path: string, files: string[]): Promise<void>
  stageAll(path: string): Promise<void>
  unstageAll(path: string): Promise<void>
  applyHunk(path: string, target: DiffTarget, hunkIndex: number, hunkHeader: string): Promise<void>
  headMessage(path: string): Promise<string>
  commit(path: string, message: string, amend: boolean): Promise<string>
  checkout(path: string, target: CheckoutTarget): Promise<void>
  syncInfo(path: string): Promise<SyncInfo>
  fetch(path: string, prune: boolean): Promise<void>
  updateSubmodule(path: string, submodulePath: string, backupBranch?: string): Promise<void>
  submoduleUpdatePreview(path: string, submodulePath: string): Promise<SubmoduleUpdatePreview>
  deleteBranches(path: string, names: string[], force: boolean): Promise<DeleteResult>
  deleteRemoteBranch(path: string, remote: string, branch: string): Promise<void>
  pull(path: string, opts: PullOptions): Promise<void>
  push(path: string, opts: PushOptions): Promise<void>
  rebasePlan(path: string, onto: string): Promise<RebasePlan>
  /** Plain rebase of the current branch onto a ref. */
  rebase(path: string, onto: string): Promise<RebaseResult>
  /** Steps are oldest first, like git's todo list. */
  rebaseInteractive(path: string, onto: string, steps: RebaseStep[]): Promise<RebaseResult>
  rebaseContinue(path: string, action: 'continue' | 'skip' | 'abort'): Promise<RebaseResult>
  /** Ends the running fetch/pull/push/submodule update in this repo; it then fails with "Cancelled.". */
  cancel(path: string): Promise<void>
  /** Progress lines from the running fetch/pull/push of a repo. */
  onProgress(handler: (repo: string, line: string) => void): () => void

  contextMenu(items: MenuItem[]): Promise<string | null>
  /** Closes the window the way its close button would. */
  closeWindow(): void
  revealInFinder(path: string): Promise<void>
  openExternal(url: string): Promise<void>
  appInfo(): Promise<AppInfo>
  platform: string
  /** Windows: recolor the native caption buttons to match the theme. */
  setTitleBarColors(color: string, symbolColor: string, height: number): void
  updateState(): Promise<UpdateState>
  checkForUpdates(): Promise<UpdateState>
  installUpdate(): Promise<void>
  onUpdateState(handler: (s: UpdateState) => void): () => void

  ghAccount(): Promise<GitHubAccount | null>
  /** Login of the account the GitHub CLI is signed in with, or null. */
  ghCliLogin(): Promise<string | null>
  ghConnectCli(): Promise<GitHubAccount>
  ghConnectToken(token: string): Promise<GitHubAccount>
  ghDeviceStart(clientId: string): Promise<DeviceCode>
  /** Resolves once the code is approved in the browser (or rejects when it expires/is denied). */
  ghDeviceWait(clientId: string, code: DeviceCode): Promise<GitHubAccount>
  ghDeviceCancel(): Promise<void>
  ghDisconnect(): Promise<void>
  /** owner/name of the repo's GitHub remote, or null. */
  ghRepo(path: string): Promise<string | null>
  ghPulls(path: string): Promise<PullSummary[]>
  ghPull(path: string, number: number): Promise<PullDetail>
  ghComment(path: string, number: number, body: string): Promise<void>
  ghReply(path: string, number: number, commentId: number, body: string): Promise<void>
  ghSubmitReview(path: string, number: number, review: ReviewSubmission): Promise<void>
  ghSetViewed(path: string, pullNodeId: string, file: string, viewed: boolean): Promise<void>
  /** Fetches the PR head into a local branch and checks it out. */
  ghCheckoutPull(path: string, number: number): Promise<void>
  onMenu(handler: (command: MenuCommand) => void): () => void
}

export type MenuCommand =
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-reset'
  | 'open-repo'
  | 'refresh'
  | 'fetch'
  | 'pull'
  | 'push'
  | 'commit'
  | 'settings'
  | 'close-tab'
  | 'find-project'
  | 'filter-commits'
