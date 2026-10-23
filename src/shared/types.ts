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
}

export interface MenuItem {
  id?: string
  label?: string
  enabled?: boolean
  separator?: boolean
}

export interface ConfirmOptions {
  message: string
  detail?: string
  confirmLabel: string
}

export interface SpoonApi {
  pickRepo(): Promise<string | null>
  openRepo(path: string): Promise<RepoState>
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
  pull(path: string, opts: PullOptions): Promise<void>
  push(path: string, opts: PushOptions): Promise<void>
  /** Progress lines from the running fetch/pull/push of a repo. */
  onProgress(handler: (repo: string, line: string) => void): () => void

  contextMenu(items: MenuItem[]): Promise<string | null>
  confirm(opts: ConfirmOptions): Promise<boolean>
  revealInFinder(path: string): Promise<void>
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
