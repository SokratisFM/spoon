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
  /** Squish branches (renderer only): on a fold row, the hidden commits it stands for. */
  squish?: SquishInfo
  /** Bead style: the hidden runs right under this commit, one per parent they hang from (a merge can have two). */
  beads?: (SquishInfo & { parent: number })[]
}

export interface SquishInfo {
  key: string
  count: number
  newest: number
  oldest: number
}

export type RefKind = 'head' | 'remote' | 'tag' | 'stash'

/** A file for the quick file popup: its text, or null when it's binary or too big to edit there. */
export interface FileContent {
  text: string | null
  binary: boolean
  /** Text, but not UTF-8 (Windows-1252, UTF-16…): shown read-only, since saving would damage it. */
  notUtf8?: boolean
  size: number
  eol: 'lf' | 'crlf'
  /** Lines end in different ways: saving makes them all `eol`. */
  mixedEol?: boolean
  /** When the working copy was last saved (to notice it changing on disk). */
  mtime?: number
}

export type ExportPlatform = 'android' | 'ios'

/** An exported Android or iOS project inside a Unity repository. */
export interface ExportCandidate {
  dir: string // relative to the repository, e.g. "Builds/Android"
  platform: ExportPlatform
  /** How many of its native files have a source under Assets/. */
  files: number
}

/** One exported native file and its Unity source (both relative to the repository). */
export interface ExportLink {
  platform: ExportPlatform
  export: string
  /** Relative to the repository, or absolute for a local package outside it. */
  source: string
  /** The source's absolute path, and the git repository it's in (this one, a submodule or a package's; '' for none). */
  sourcePath: string
  sourceRepo: string
  /** git tracks the source: an untracked, ignored or repository-less one is never overwritten by itself. */
  sourceTracked: boolean
  /** Content hashes of a copy and its source (not for links). */
  exportHash?: string
  sourceHash?: string
  /** The copy is as Unity's export run wrote it (not edited since, whatever the save times say). */
  inRun?: boolean
  /** linked: the export is a symlink to the source (dangling: to one that's gone); else a copy, the same or with one side edited. */
  state: 'linked' | 'dangling' | 'same' | 'export-newer' | 'source-newer'
  /** When the export's copy was last saved: an edit already brought back (or set aside) keeps its time. */
  exportMtime: number
  /** When the source was last saved: tells Spoon's own bring-back apart from your edits in Assets. */
  sourceMtime: number
}

/** A folder a new native file can go to: its id (like ExportLink.source), its repository and path there. */
export interface ExportFolder {
  id: string
  repo: string
  rel: string
}

/** A native file made in an export (in Android Studio or Xcode) that has no source yet. */
export interface ExportNew {
  platform: ExportPlatform
  export: string
  /** When the file was last saved: a failed automatic add is tried again once it's saved again. */
  saved: number
  /** Where it most likely belongs, most likely first; empty when Spoon can't tell. */
  folders: ExportFolder[]
  /** Only one folder fits and a .meta can be made there: it can be added without asking. */
  certain: boolean
}

export interface JiraIssue {
  summary: string
  /** "Bug", "Story", "Task"… */
  type: string
}

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
  /** Any two files on disk, inside a repository or not (absolute paths). */
  | { kind: 'files'; a: string; b: string; file: FileChange }
  /** Two pieces of text (pasted or typed); file.path only names the language. */
  | { kind: 'text'; left: string; right: string; file: FileChange }
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
  /** Files with uncommitted changes (switching carries them over, or fails if they'd be overwritten). */
  dirtyFiles: number
  /** Commits only the detached HEAD holds; switching keeps them on a backup branch. */
  orphaned: number
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
  /** The PR's head commit when it was written: lines refer to that version of the diff. */
  commitId?: string
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
  /** Asks for one file (absolute path), or null if cancelled. */
  pickFile(title: string): Promise<string | null>
  /** The path of a file dropped on the window. */
  pathForFile(file: File): string
  /** Last-modified times of files (null for a missing one), to notice changes. */
  fileStamps(paths: string[]): Promise<(number | null)[]>
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
  /** A new branch at `base`, not tracking it (and not checked out). */
  createBranch(path: string, name: string, base: string): Promise<void>
  /** git's user.name, or "". */
  userName(path: string): Promise<string>
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
  /** With the stash's hash, the stash is found again by it (its index may have shifted) or refused if gone. */
  stashApply(path: string, name: string, pop: boolean, hash?: string): Promise<void>
  stashDrop(path: string, name: string, hash?: string): Promise<void>
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
  /** `afterUnsaved`: closing after "Don't Save" on unsaved edits; a quit that was held up goes on. */
  closeWindow(afterUnsaved?: boolean): void
  /** A background fetch that never waits for (or holds up) other git work; skipped while some runs. */
  fetchQuietly(path: string): Promise<void>
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
  /** The GitHub repo and the local remote that points at it (where releases and their tags go). */
  ghRepoRemote(path: string): Promise<{ slug: string; remote: string } | null>
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
  /** Commands are only sent to a window while it watches (the history window, while open). */
  watchGitHistory(on: boolean): void
  claudeAvailability(): Promise<ClaudeAvailability>
  atlassianAccount(): Promise<AtlassianAccount | null>
  atlassianConnect(email: string, token: string, pageUrl: string): Promise<AtlassianAccount>
  atlassianDisconnect(): Promise<void>
  confluencePage(url: string): Promise<ConfluencePage>
  /** The quick file popup: working copies, versions at a commit, restoring one, the default app. */
  readWorkingFile(path: string, rel: string): Promise<FileContent>
  /** Resolves to the new save time; with `expect` (the save time it was read at) a file changed on disk since fails with CHANGED_ON_DISK. */
  writeWorkingFile(path: string, rel: string, text: string, eol: 'lf' | 'crlf', expect?: number): Promise<number>
  fileAtCommit(path: string, hash: string, rel: string): Promise<FileContent>
  fileAtCommitToTemp(path: string, hash: string, rel: string): Promise<string>
  restoreFileFrom(path: string, hash: string, rel: string): Promise<void>
  openWithDefaultApp(path: string, rel: string): Promise<string>
  /** A data URL preview of the working copy's file (or its version in a commit); null when there's none. */
  fileThumbnail(path: string, rel: string, hash: string | null, size: number): Promise<string | null>
  /** Opens a commit's version of a file in its default app; resolves to an error message, or "". */
  openAtCommit(path: string, hash: string, rel: string): Promise<string>
  /** Unity projects: exported Android/iOS projects and their native files' sources under Assets/. */
  isUnityProject(path: string): Promise<boolean>
  /** Forgets what Spoon noted about a repository's export runs (it was removed from Spoon). */
  forgetExportRuns(path: string): Promise<void>
  findExports(path: string): Promise<ExportCandidate[]>
  scanExports(path: string, dirs: string[]): Promise<ExportLink[]>
  /** Watches the linked exports (an empty list stops); onExportsChanged hears about edits in them. */
  watchExports(path: string, dirs: string[]): Promise<string[]>
  onExportsChanged(handler: (repo: string) => void): () => void
  /** Copies exports' edits over their sources (each checked unchanged since the scan, and copied to the Trash first); resolves to the sources' new save times. */
  exportBringBack(path: string, items: { exp: string; src: string; exportMtime: number; sourceMtime: number }[]): Promise<Record<string, number>>
  /** Replaces the export's copy with a link to the source; one that differs only with `force`. */
  exportRelink(path: string, exp: string, src: string, force?: boolean): Promise<void>
  /** Native files made in the exports that have no source yet. */
  exportNewFiles(path: string, dirs: string[]): Promise<ExportNew[]>
  /** Adds a new export file to a source folder (with a .meta), linking the export to it. */
  exportAdd(path: string, exp: string, folder: string): Promise<{ source: string; meta: boolean }>
  /** A ticket's title and type through the connected Atlassian account, or null. */
  jiraIssue(site: string, key: string): Promise<JiraIssue | null>
  readClipboard(): Promise<string>
  /** Fetches the submodule and lists its version branches (prefix like "candidates/"). */
  mainlibState(path: string, submodulePath: string, prefix: string): Promise<MainLibState>
  /** Checks out the version branch in the submodule (fast-forwarding an existing local branch). */
  /** Returns the backup branch made for commits only the detached HEAD held, if any. */
  mainlibSwitch(path: string, submodulePath: string, ref: string): Promise<{ backup: string | null }>
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
  | 'new-branch'
  | 'open-file'
  | 'whats-new'
  | 'compare-files'
