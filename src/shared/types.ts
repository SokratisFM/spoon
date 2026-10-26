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
  /**
   * Squish branches (renderer only): on a fold row, the hidden commits it stands for; on a kept
   * commit (bead style), the hidden commits right under it.
   */
  squish?: { key: string; count: number; newest: number; oldest: number }
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

/** Spoon's syntax color slots (see the renderer's syntax.ts). */
export type SyntaxSlot = 'kw' | 'str' | 'com' | 'type' | 'num' | 'fn' | 'prop' | 'tag'

/** Syntax colors taken from an IDE scheme (or a scheme file), in Spoon's slots. */
export interface SyntaxPalette {
  id: string
  name: string
  source: 'rider' | 'vscode' | 'cursor' | 'file'
  /** Where it came from, e.g. "Rider 2025.3". */
  app: string
  /** The scheme that IDE is using right now. */
  active: boolean
  dark: boolean
  bg?: string
  fg?: string
  colors: Partial<Record<SyntaxSlot, string>>
  /** Which IDE color each slot took; exact when it's the IDE's own color for that kind of token. */
  origin: Partial<Record<SyntaxSlot, { from: string; exact: boolean; picked?: boolean }>>
  /** The scheme's distinct colors, [name, color], for picking another for a slot. */
  choices: [string, string][]
}

/** Where a new tag would go: the branches its commit is on, nearest first. */
export interface TagTarget {
  /** ahead: commits between it and the branch's tip (0 = it is the tip). */
  branches: { name: string; remote: boolean; ahead: number }[]
  /** Every branch holding the commit, including ones not listed. */
  total: number
}

export interface NewRelease {
  tag: string
  /** The commit the tag is on. */
  target: string
  name: string
  body: string
  draft: boolean
  prerelease: boolean
  latest: boolean
}

export interface NewTagOptions {
  name: string
  hash: string
  /** Makes it an annotated tag. */
  message?: string
  /** Push the tag there right away. */
  remote?: string
}

export interface Stash {
  index: number
  name: string // stash@{0}
  hash: string
  /** The commit it was made on. */
  base: string
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

/** A file whose local changes get thrown away; staged ones go back to HEAD, unstaged ones to the index. */
export interface DiscardEntry {
  path: string
  oldPath?: string
  status: FileStatus
  staged: boolean
}

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
  /** Local branch to push; the checked-out one when omitted. */
  branch?: string
}

/** What Spoon works out before opening the Create Pull Request dialog. */
export interface PullDraftInfo {
  branch: string
  /** The remote the branch lives on (or will be pushed to), and its name there. */
  remote: string
  headRef: string
  /** Branches on that remote it could merge into, the detected base first. */
  bases: string[]
  base: string
  /** How the base was found: the branch's creation record, the nearest branch it forked from, or the default branch. */
  baseReason: 'created-from' | 'nearest' | 'default'
  /** Commits that would be in the PR, newest first. */
  commits: ShortCommit[]
  /** The branch isn't on the remote yet, or has commits that aren't. */
  needsPush: boolean
  hasUpstream: boolean
  /** The repo's pull request template, if it has one. */
  template: string | null
}

export interface AtlassianAccount {
  email: string
}

export interface ConfluencePage {
  title: string
  /** The page body in Confluence's storage format (XHTML). */
  html: string
}

/** A version branch of the MainLib submodule ("origin/candidates/4.2.0"). */
export interface MainLibVersion {
  /** Remote-tracking ref, e.g. "origin/candidates/4.2.0". */
  ref: string
  /** Branch name without the remote, e.g. "candidates/4.2.0". */
  branch: string
  /** The version part, e.g. "4.2.0". */
  version: string
  date: number
  hash: string
}

export interface MainLibState {
  /** Where the submodule is checked out, relative to the parent repo. */
  path: string
  /** `git describe --tags` of its HEAD ("v3.7.2-2-g02a447a"), or the short hash. */
  describe: string
  hash: string
  branch: string | null
  /** Newest first. */
  versions: MainLibVersion[]
}

/** One git command Spoon ran, for the Git Command History window. */
export interface GitCommandEntry {
  id: number
  cwd: string
  args: string[]
  startedAt: number
  running: boolean
  ms?: number
  /** Exit code; null when it was cancelled or couldn't start. */
  code?: number | null
  /** First line of git's error output when it failed. */
  error?: string
}

export interface ClaudeAvailability {
  /** Path of the `claude` command (Claude Code), or null when it isn't installed. */
  cli: string | null
  /** The Claude desktop app is installed. */
  desktop: boolean
}

export interface ClaudeLaunch {
  where: 'terminal' | 'desktop'
  cwd: string
  model: string
  effort: string
  /** Session name shown in Claude Code. */
  name: string
  prompt: string
}

export interface NewPull {
  branch: string
  headRef: string
  base: string
  title: string
  body: string
  draft: boolean
  assignees: string[]
  reviewers: string[]
}

export interface CreatedPull {
  number: number
  url: string
  /** Things that didn't stick (e.g. a reviewer GitHub refused); the PR itself was created. */
  warnings: string[]
}

export interface MenuItem {
  id?: string
  label?: string
  enabled?: boolean
  separator?: boolean
  /** Shown as a checkbox (or radio dot) in its current state. */
  kind?: 'checkbox' | 'radio'
  checked?: boolean
  /** Shortcut shown beside the item (display only; the app menu owns the real shortcut). */
  accelerator?: string
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
  discard(path: string, files: DiscardEntry[]): Promise<void>
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
  /** The whole file a diff is about (new version, or old for a deleted file); null when too big. */
  diffFile(path: string, target: DiffTarget): Promise<{ text: string; side: 'new' | 'old' } | null>
  tagTarget(path: string, hash: string): Promise<TagTarget>
  /** The syntax color schemes the IDEs on this Mac are using. */
  ideSchemes(): Promise<SyntaxPalette[]>
  /** Asks for a Rider scheme or VS Code theme file and reads its syntax colors (null if cancelled). */
  importSyntaxColors(): Promise<SyntaxPalette | null>
  createTag(path: string, opts: NewTagOptions): Promise<void>
  /** Applies a stash ("stash@{0}"); pop also deletes it. */
  stashApply(path: string, name: string, pop: boolean): Promise<void>
  stashDrop(path: string, name: string): Promise<void>
  /** Moves branches that are only behind their upstream up to it. */
  fastForwardBranches(path: string, names: string[]): Promise<void>
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
  pullDraftInfo(path: string, branch: string): Promise<PullDraftInfo>
  /** People who can be assigned or asked to review in this repository. */
  ghAssignable(path: string): Promise<GhUser[]>
  ghCreatePull(path: string, pull: NewPull): Promise<CreatedPull>
  /** The newest published release's tag (null when there's none). */
  ghLatestRelease(path: string): Promise<string | null>
  /** GitHub's release notes for a tag on a commit: what was merged since the previous release. */
  ghReleaseNotes(path: string, tag: string, target: string): Promise<{ name: string; body: string }>
  /** Publishes a release for a tag that's on GitHub already; returns its page. */
  ghCreateRelease(path: string, release: NewRelease): Promise<string>
  gitHistory(): Promise<GitCommandEntry[]>
  clearGitHistory(): Promise<void>
  /** Called as each git command starts and again when it ends. */
  onGitCommand(handler: (entry: GitCommandEntry) => void): () => void
  claudeAvailability(): Promise<ClaudeAvailability>
  atlassianAccount(): Promise<AtlassianAccount | null>
  atlassianConnect(email: string, token: string, pageUrl: string): Promise<AtlassianAccount>
  atlassianDisconnect(): Promise<void>
  confluencePage(url: string): Promise<ConfluencePage>
  /** Fetches the submodule and lists its version branches (prefix like "candidates/"). */
  mainlibState(path: string, submodulePath: string, prefix: string): Promise<MainLibState>
  /** Checks out the version branch in the submodule (fast-forwarding an existing local branch). */
  mainlibSwitch(path: string, submodulePath: string, ref: string): Promise<void>
  claudeLaunch(launch: ClaudeLaunch): Promise<void>
  /** Shows or hides an item of the app's menu bar by id. */
  setMenuItemVisible(id: string, visible: boolean): void
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
  | 'discard'
  | 'commit-push'
  | 'review'
  | 'git-history'
  | 'squish'
  | 'new-tag'
