// Thin wrapper over the git CLI. Every call shells out to `git` with machine-readable
// output, so LFS, hooks, credentials and config all behave exactly as in the terminal.
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { chmod, cp, lstat, mkdir, mkdtemp, readdir, readFile, readlink, realpath, rename, rm, rmdir, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type {
  FileHistory,
  CloneBranch,
  CloneResult,
  FileContent,
  Commit,
  CommitDetails,
  CompareMode,
  DiffResult,
  DiffTarget,
  FileChange,
  FileHistoryEntry,
  FileStatus,
  LinePick,
  Ref,
  RefCompare,
  RepoState,
  CarryResult,
  CheckoutTarget,
  PullOptions,
  PushOptions,
  NewTagOptions,
  Stash,
  TagTarget,
  Submodule,
  SyncInfo,
  DeleteResult,
  DiscardEntry,
  PullDraftInfo,
  MainLibState,
  MainLibVersion,
  RebaseAction,
  RebaseCommit,
  RebasePlan,
  MergePlan,
  UnityBuildInfo,
  CandidateInfo,
  CompareCandidate,
  CompareCandidates,
  MergeResult,
  MergeState,
  RebaseProgress,
  RebaseResult,
  RebaseStep,
  ShortCommit,
  SubmoduleUpdatePreview,
  WorkingTree
} from '../shared/types'
import * as history from './history'

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
const FS = '\x1f' // field separator
const RS = '\x1e' // record separator
const MAX_DIFF_BYTES = 4 * 1024 * 1024

// Apps launched from Finder get a minimal PATH; make Homebrew git and git-lfs findable.
export const toolPath =
  process.platform === 'darwin'
    ? ['/opt/homebrew/bin', '/usr/local/bin', process.env.PATH ?? '/usr/bin:/bin'].join(delimiter)
    : (process.env.PATH ?? '')
const env = {
  ...process.env,
  PATH: toolPath,
  GIT_TERMINAL_PROMPT: '0',
  GIT_OPTIONAL_LOCKS: '0', // read-only commands must not take index.lock
  GIT_EDITOR: 'true', // never block on an editor; merges/rebases keep their default messages
  GIT_LITERAL_PATHSPECS: '1', // file names like "foo[1].txt" mean that file, not a glob
  LC_ALL: 'C'
}

class GitError extends Error {
  readonly code: number | null
  readonly stderr: string
  constructor(message: string, code: number | null, stderr: string) {
    super(message)
    this.code = code
    this.stderr = stderr
  }
}

interface RunOptions {
  okCodes?: number[]
  input?: string | Buffer
  /** How stdout is decoded (utf8 unless said; latin1 keeps every byte as one character). */
  encoding?: BufferEncoding
  /** Receives git's progress lines ("Receiving objects:  42% ...") as they arrive. */
  onProgress?: (line: string) => void
  env?: Record<string, string>
  /** Stop reading (and end git) once stdout passes this many bytes; the output is then truncated. */
  maxBytes?: number
  /** Network commands: cancel(cwd) ends them; a path instead says whose Cancel (a submodule's fetch is the parent's). */
  cancellable?: boolean | string
}

const CANCELLED = 'Cancelled.'
const cancellable = new Map<string, Set<ChildProcess>>()
const repoKey = (cwd: string): string => resolve(cwd)

function exec(cwd: string, args: string[], opts: RunOptions = {}): Promise<{ out: string; truncated: boolean; err: string }> {
  const okCodes = opts.okCodes ?? [0]
  return new Promise((done, reject) => {
    // Cancellable commands get their own process group: `fetch --all`, `pull` and `submodule update`
    // run further git processes, and cancel() has to end those too.
    // Diffs must look the same whatever the user's git config says: they're parsed, and some are fed
    // back to `git apply` (hunk staging, partial discard).
    const child = spawn('git', ['-c', 'core.quotepath=off', '-c', 'color.ui=false', '-c', 'diff.noprefix=false', '-c', 'diff.mnemonicPrefix=false', '-c', 'diff.suppressBlankEmpty=false', ...args], {
      cwd,
      env: opts.env ? { ...env, ...opts.env } : env,
      detached: !!opts.cancellable && process.platform !== 'win32'
    })
    const finish = history.recordStart(cwd, args)
    const out: Buffer[] = []
    let size = 0
    let truncated = false
    let cancelled = false
    let err = ''
    const key = repoKey(typeof opts.cancellable === 'string' ? opts.cancellable : cwd)
    if (opts.cancellable) {
      if (!cancellable.has(key)) cancellable.set(key, new Set())
      cancellable.get(key)!.add(child)
      child.once('cancel', () => {
        cancelled = true
        // A grandchild that survives can keep the pipes open, and with them 'close' from firing.
        child.once('exit', (code) => setTimeout(() => settle(code), 500))
      })
    }
    const forget = (): void => void cancellable.get(key)?.delete(child)
    child.stdout.on('data', (b: Buffer) => {
      if (truncated) return
      out.push(b)
      size += b.length
      if (opts.maxBytes !== undefined && size > opts.maxBytes) {
        truncated = true
        child.kill()
      }
    })
    child.stderr.on('data', (b: Buffer) => {
      const s = b.toString('utf8')
      err += s
      if (opts.onProgress) {
        const lines = s.split(/[\r\n]+/).filter((l) => l.trim())
        if (lines.length) opts.onProgress(lines[lines.length - 1].trim())
      }
    })
    child.on('error', (e) => {
      forget()
      finish(null, e.message)
      reject(new GitError(`git ${args[0]}: ${e.message}`, null, ''))
    })
    let settled = false
    const settle = (code: number | null): void => {
      if (settled) return
      settled = true
      forget()
      const ok = !cancelled && (truncated || (code !== null && okCodes.includes(code)))
      finish(cancelled ? null : code, cancelled ? CANCELLED : ok ? undefined : err)
      if (cancelled) return reject(new GitError(CANCELLED, code, err))
      if (truncated || (code !== null && okCodes.includes(code))) {
        const buf = Buffer.concat(out)
        return done({ out: (truncated ? buf.subarray(0, opts.maxBytes) : buf).toString(opts.encoding ?? 'utf8'), truncated, err })
      }
      // Keep only the final state of each \r-updated progress line.
      const msg = err
        .split('\n')
        .map((l) => l.split('\r').filter(Boolean).pop() ?? '')
        .filter((l) => l.trim())
        .join('\n')
      reject(new GitError(msg || `git ${args[0]} failed (exit ${code})`, code, err))
    }
    child.on('close', settle)
    // git may exit before reading its input (an error); that's reported through 'close'.
    child.stdin.on('error', () => undefined)
    if (opts.input !== undefined) child.stdin.end(opts.input)
    else child.stdin.end()
  })
}

async function run(cwd: string, args: string[], opts: RunOptions = {}): Promise<string> {
  return (await exec(cwd, args, opts)).out
}

function git(cwd: string, args: string[], okCodes: number[] = [0]): Promise<string> {
  return run(cwd, args, { okCodes })
}

/** Ends the network commands (fetch, pull, push, submodule update) running in a repository. */
export function cancel(cwd: string): void {
  for (const child of cancellable.get(repoKey(cwd)) ?? []) {
    if (child.pid === undefined || child.exitCode !== null) continue
    child.emit('cancel')
    try {
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      else process.kill(-child.pid, 'SIGTERM') // the whole group: git and every git it started
    } catch {
      child.kill()
    }
  }
}

// One write at a time per repository, whichever tab or window asked: two writers would collide on
// index.lock (or worse, interleave a checkout with a commit).
const locks = new Map<string, Promise<unknown>>()

export function exclusive<T>(cwd: string, fn: () => Promise<T>): Promise<T> {
  const key = repoKey(cwd)
  const task = (locks.get(key) ?? Promise.resolve()).catch(() => undefined).then(fn)
  const tail = task.catch(() => undefined)
  locks.set(key, tail)
  tail.then(() => locks.get(key) === tail && locks.delete(key))
  return task
}

/**
 * A path part that is (or that Windows would treat as) a .git folder: any case, with trailing dots
 * or spaces (".git.", ".git "), or its short name (GIT~1).
 */
export function isGitPart(part: string): boolean {
  // Windows also reaches it as ".git::$INDEX_ALLOCATION" (a stream name) and by short names GIT~1, GIT~2…
  const p = part.toLowerCase().split(':')[0].replace(/[. ]+$/, '')
  return p === '.git' || /^git~\d+$/.test(p)
}

/** A path relative to a root that stays inside it (and out of any .git folder), or false. */
export function insideRel(rel: string): boolean {
  return !!rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel) && !rel.split(sep).some(isGitPart)
}

/** IPC from the renderer names a repository by its folder: it must be one (a work tree's top). */
export function assertRepoRoot(path: string): void {
  if (typeof path !== 'string' || !isAbsolute(path) || !existsSync(join(path, '.git'))) throw new Error(`Not a repository: ${path}`)
}

function assertHash(hash: string): void {
  if (!/^[0-9a-f]{4,64}$/i.test(hash)) throw new Error(`Invalid commit hash: ${hash}`)
}

/** Names that end up as git arguments must never be read as options ("--upload-pack=…"). */
function assertArg(value: string, what: string): void {
  if (typeof value !== 'string' || !value || value.startsWith('-') || /[\0\n\r]/.test(value))
    throw new Error(`Invalid ${what}: ${value}`)
}

async function assertBranchName(cwd: string, name: string, what = 'branch name'): Promise<void> {
  assertArg(name, what)
  try {
    await git(cwd, ['check-ref-format', `refs/heads/${name}`])
  } catch {
    throw new Error(`“${name}” isn’t a valid ${what}.`)
  }
}

async function assertRemote(cwd: string, remote: string): Promise<void> {
  assertArg(remote, 'remote')
  const remotes = (await git(cwd, ['remote'])).split('\n').filter(Boolean)
  if (!remotes.includes(remote)) throw new Error(`Unknown remote: ${remote}`)
}

export async function openRepo(path: string): Promise<RepoState> {
  // One rev-parse for all three; the superproject line is only there for a submodule.
  const [root, gitDir, superproject] = (
    await git(path, ['rev-parse', '--show-toplevel', '--absolute-git-dir', '--show-superproject-working-tree'])
  ).split('\n')

  const [branchOut, headOut, refs, stashes, remotesOut, submodules] = await Promise.all([
    git(root, ['symbolic-ref', '-q', '--short', 'HEAD'], [0, 1]),
    git(root, ['rev-parse', '-q', '--verify', 'HEAD'], [0, 1]),
    readRefs(root),
    readStashes(root),
    git(root, ['remote']),
    readSubmodules(root)
  ])

  return {
    path: root,
    name: basename(root),
    headBranch: branchOut.trim() || null,
    headHash: headOut.trim() || null,
    refs,
    stashes,
    remotes: remotesOut.split('\n').filter(Boolean),
    operation: detectOperation(gitDir),
    rebase: readRebaseProgress(gitDir),
    merge: readMergeState(gitDir),
    submodules,
    superproject: superproject || null,
    unity: existsSync(join(root, 'ProjectSettings', 'ProjectVersion.txt'))
  }
}

async function readSubmodules(root: string): Promise<Submodule[]> {
  if (!existsSync(join(root, '.gitmodules'))) return []
  // Not `git submodule status`: it costs a few hundred ms in a Unity project and still needs a
  // second look into each submodule for its branch and changes. Instead, one `status --branch`
  // per submodule, all at once, gives its commit, branch and changes in a single process.
  const config = await git(root, ['config', '-z', '-f', '.gitmodules', '--get-regexp', '^submodule\\..*\\.path$'], [0, 1])
  const paths = config
    .split('\0')
    .map((entry) => entry.slice(entry.indexOf('\n') + 1))
    .filter(Boolean)
  if (!paths.length) return []

  const looks = new Map(
    paths.map((p) => {
      const dir = join(root, p)
      const look = existsSync(join(dir, '.git'))
        ? git(dir, ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=no']).catch(() => null)
        : Promise.resolve(null)
      return [p, look] as const
    })
  )
  // Recorded commits from the index; stages 1-3 mean the pointer itself is in conflict.
  const index = await git(root, ['ls-files', '-s', '-z', '--', ...paths]).catch(() => '')
  const recorded = new Map<string, string>()
  const conflicted = new Set<string>()
  for (const entry of index.split('\0')) {
    const m = /^160000 ([0-9a-f]+) (\d)\t(.+)$/.exec(entry)
    if (!m) continue
    if (m[2] === '0') recorded.set(m[3], m[1])
    else {
      conflicted.add(m[3])
      if (m[2] === '2') recorded.set(m[3], m[1]) // ours
    }
  }

  const subs = await Promise.all(
    paths
      .filter((p) => recorded.has(p))
      .map(async (p): Promise<Submodule> => {
        const dir = join(root, p)
        const rec = recorded.get(p)!
        const sub: Submodule = { path: p, name: p.split('/').pop()!, hash: rec, branch: null, state: 'uninitialized', dirty: false, recorded: rec }
        const out = await looks.get(p)
        const oid = out && /(?:^|\0)# branch\.oid ([0-9a-f]+)/.exec(out)?.[1]
        if (!out || !oid) return sub // no checkout yet
        const head = /(?:^|\0)# branch\.head ([^\0]+)/.exec(out)?.[1]
        sub.hash = oid
        sub.branch = head && head !== '(detached)' ? head : null
        sub.dirty = out.split('\0').some((r) => r && !r.startsWith('#'))
        sub.state = conflicted.has(p) ? 'conflict' : oid === rec ? 'ok' : 'outdated'
        if (sub.state !== 'outdated') return sub
        // Ahead is the normal state while you're developing inside the submodule; behind means
        // someone moved the parent's pointer and Update would catch you up.
        const key = `${dir}|${rec}|${oid}`
        let counts = aheadBehindCache.get(key)
        if (counts === undefined) {
          counts = await git(dir, ['rev-list', '--left-right', '--count', `${rec}...${oid}`]).catch(() => '')
          if (aheadBehindCache.size > 500) aheadBehindCache.clear()
          if (counts) aheadBehindCache.set(key, counts)
        }
        const [behind, ahead] = counts.trim().split(/\s+/).map(Number)
        if (!Number.isNaN(ahead)) {
          sub.ahead = ahead
          sub.behind = behind
          sub.relation = behind === 0 ? 'ahead' : ahead === 0 ? 'behind' : 'diverged'
        }
        return sub
      })
  )
  return subs
}

/** rev-list counts per (submodule, recorded, checked out): commits never change, so neither do these. */
const aheadBehindCache = new Map<string, string>()

function detectOperation(gitDir: string): string | null {
  const has = (p: string): boolean => existsSync(join(gitDir, p))
  if (has('rebase-merge') || has('rebase-apply')) return 'REBASING'
  if (has('MERGE_HEAD')) return 'MERGING'
  if (has('CHERRY_PICK_HEAD')) return 'CHERRY-PICKING'
  if (has('REVERT_HEAD')) return 'REVERTING'
  return null
}

async function readRefs(cwd: string): Promise<Ref[]> {
  const format = ['%(refname)', '%(objectname)', '%(*objectname)', '%(upstream:short)', '%(upstream:track,nobracket)'].join(FS)
  const out = await git(cwd, ['for-each-ref', `--format=${format}`, 'refs/heads', 'refs/remotes', 'refs/tags'])
  const refs: Ref[] = []
  for (const line of out.split('\n')) {
    if (!line) continue
    const [fullName, objectName, peeled, upstream, track] = line.split(FS)
    if (fullName.startsWith('refs/remotes/') && fullName.endsWith('/HEAD')) continue
    const target = peeled || objectName
    if (fullName.startsWith('refs/heads/')) {
      const ref: Ref = { name: fullName.slice(11), fullName, kind: 'head', target }
      if (upstream) {
        ref.upstream = upstream
        ref.gone = track === 'gone'
        ref.ahead = Number(/ahead (\d+)/.exec(track)?.[1] ?? 0)
        ref.behind = Number(/behind (\d+)/.exec(track)?.[1] ?? 0)
      }
      refs.push(ref)
    } else if (fullName.startsWith('refs/remotes/')) {
      refs.push({ name: fullName.slice(13), fullName, kind: 'remote', target })
    } else {
      refs.push({ name: fullName.slice(10), fullName, kind: 'tag', target })
    }
  }
  return refs
}

async function readStashes(cwd: string): Promise<Stash[]> {
  const out = await stashList(cwd, `%gd${FS}%H${FS}%P${FS}%gs`)
  return out
    .split('\n')
    .filter(Boolean)
    .map((line, index) => {
      const [name, hash, parents, message] = line.split(FS)
      return { index, name, hash, base: parents.split(' ')[0], message }
    })
}

// History loads, refreshes and commit details all list the stashes; the answer is reused until the
// stash reflog changes (every stash, pop and drop rewrites it). It lives in the common git dir, which
// linked worktrees share.
const commonDirs = new Map<string, string>()
const stashCache = new Map<string, { stamp: string; out: string }>()

async function stashList(cwd: string, format: string): Promise<string> {
  const root = repoKey(cwd)
  let common = commonDirs.get(root)
  if (!common) {
    common = (await git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim()
    commonDirs.set(root, common)
  }
  const st = await stat(join(common, 'logs', 'refs', 'stash')).catch(() => null)
  const stamp = st ? `${st.mtimeMs}:${st.size}` : 'none'
  const key = `${root}\0${format}`
  const hit = stashCache.get(key)
  if (hit && hit.stamp === stamp) return hit.out
  const out = await git(cwd, ['stash', 'list', `--format=${format}`], [0, 1])
  stashCache.set(key, { stamp, out })
  return out
}

/** "On feature/x: tidy up" → "tidy up"; git's own "WIP on …" messages are kept as they are. */
export const stashTitle = (message: string): string => message.replace(/^[Oo]n [^:]+: /, '')

export async function log(cwd: string, limit: number): Promise<Commit[]> {
  const format = ['%H', '%P', '%an', '%ae', '%at', '%cn', '%ct', '%s'].join('%x1f') + '%x1e'
  const parse = (out: string): Commit[] =>
    out
      .split(RS)
      .map((rec) => rec.replace(/^\n/, ''))
      .filter(Boolean)
      .map((r) => {
        const [hash, parents, authorName, authorEmail, at, committerName, ct, subject] = r.split(FS)
        return {
          hash,
          parents: parents ? parents.split(' ') : [],
          authorName,
          authorEmail,
          authorTime: Number(at),
          committerName,
          commitTime: Number(ct),
          subject
        }
      })
  // Stashes show like Fork: one row each, hanging off the commit it was made on. Git stores a stash
  // as a merge of that commit with helper commits for the index (and untracked files); those stay
  // hidden, and the commit it was made on is listed even when no branch holds it any more.
  const stashes = parse(
    await stashList(cwd, format.replace('%s', '%gs'))
  ).map((s) => ({ ...s, parents: s.parents.slice(0, 1), subject: stashTitle(s.subject) }))
  // A brand-new repo (no refs at all) just prints nothing.
  const commits = parse(
    await git(cwd, [
      'log',
      '--exclude=refs/stash',
      '--all',
      ...new Set(stashes.map((s) => s.parents[0]).filter(Boolean)),
      '--date-order',
      `-n${limit}`,
      `--format=${format}`
    ])
  )
  for (const s of stashes) {
    // Above the commit it was made on, among the commits of its time.
    const byTime = commits.findIndex((c) => c.commitTime < s.commitTime)
    const base = commits.findIndex((c) => c.hash === s.parents[0])
    const at = [byTime, base].filter((i) => i >= 0)
    commits.splice(at.length ? Math.min(...at) : commits.length, 0, s)
  }
  return commits
}

const assertStash = (name: string): void => {
  if (!/^stash@\{\d+\}$/.test(name)) throw new Error(`Not a stash: ${name}`)
}

/**
 * The stash's name right now. Indexes shift as stashes come and go (an earlier drop still queued
 * behind a push renumbers the rest), so with its hash the stash is looked up again inside the lock.
 */
async function currentStash(cwd: string, name: string, hash?: string): Promise<string> {
  assertStash(name)
  if (!hash) return name
  assertHash(hash)
  const out = await git(cwd, ['stash', 'list', `--format=%gd${FS}%H`], [0, 1])
  const hit = out
    .split('\n')
    .map((l) => l.split(FS))
    .find(([, h]) => h === hash)
  if (!hit) throw new Error('That stash is gone: it was already applied or dropped.')
  return hit[0]
}

/** Applies a stash to the working tree; pop also deletes it (git keeps it if the apply conflicts). */
export function stashApply(cwd: string, name: string, pop: boolean, hash?: string): Promise<void> {
  assertStash(name)
  return exclusive(cwd, async () => void (await git(cwd, ['stash', pop ? 'pop' : 'apply', await currentStash(cwd, name, hash)])))
}

export function stashDrop(cwd: string, name: string, hash?: string): Promise<void> {
  assertStash(name)
  return exclusive(cwd, async () => void (await git(cwd, ['stash', 'drop', await currentStash(cwd, name, hash)])))
}

export async function commitDetails(cwd: string, hash: string): Promise<CommitDetails> {
  assertHash(hash)
  const format = ['%H', '%P', '%an', '%ae', '%at', '%cn', '%ce', '%ct', '%B'].join('%x1f')
  const out = await git(cwd, ['show', '-s', `--format=${format}`, hash])
  const [h, parents, an, ae, at, cn, ce, ct, ...rest] = out.split(FS)
  let parentList = parents ? parents.split(' ') : []
  // A stash: only the commit it was made on counts, not git's helper commits for the index.
  if (parentList.length > 1 && (await stashList(cwd, '%H')).split('\n').includes(h))
    parentList = parentList.slice(0, 1)
  const base = parentList[0] ?? EMPTY_TREE
  const files = parseNameStatus(
    await git(cwd, ['diff-tree', '-r', '-M', '--no-commit-id', '--name-status', '-z', base, h])
  )
  return {
    hash: h,
    parents: parentList,
    authorName: an,
    authorEmail: ae,
    authorTime: Number(at),
    committerName: cn,
    committerEmail: ce,
    commitTime: Number(ct),
    message: rest.join(FS).trimEnd(),
    files
  }
}

function parseNameStatus(out: string): FileChange[] {
  const tokens = out.split('\0')
  const files: FileChange[] = []
  for (let i = 0; i < tokens.length; ) {
    const code = tokens[i++]
    if (!code) continue
    const status = code[0] as FileStatus
    if (status === 'R' || status === 'C') {
      const oldPath = tokens[i++]
      files.push({ status, oldPath, path: tokens[i++] })
    } else {
      files.push({ status, path: tokens[i++] })
    }
  }
  return files
}

export async function workingTree(cwd: string): Promise<WorkingTree> {
  // Changes inside a submodule can't be staged from here (the submodule chip shows them), so git
  // needn't look through every submodule's files; a moved submodule pointer still shows up.
  const out = await git(cwd, ['status', '--porcelain=v2', '-z', '--untracked-files=all', '--ignore-submodules=dirty'])
  const tokens = out.split('\0')
  const staged: FileChange[] = []
  const unstaged: FileChange[] = []
  const toStatus = (c: string): FileStatus => (c === '.' ? 'M' : (c as FileStatus))

  for (let i = 0; i < tokens.length; ) {
    const rec = tokens[i++]
    if (!rec) continue
    const type = rec[0]
    if (type === '?') {
      unstaged.push({ status: '?', path: rec.slice(2) })
    } else if (type === '1') {
      const parts = rec.split(' ')
      const xy = parts[1]
      const path = parts.slice(8).join(' ')
      if (xy[0] !== '.') staged.push({ status: toStatus(xy[0]), path })
      if (xy[1] !== '.') unstaged.push({ status: toStatus(xy[1]), path })
    } else if (type === '2') {
      const parts = rec.split(' ')
      const xy = parts[1]
      const path = parts.slice(9).join(' ')
      const oldPath = tokens[i++]
      if (xy[0] !== '.') staged.push({ status: toStatus(xy[0]), path, oldPath })
      if (xy[1] !== '.') unstaged.push({ status: toStatus(xy[1]), path })
    } else if (type === 'u') {
      const parts = rec.split(' ')
      unstaged.push({ status: 'U', path: parts.slice(10).join(' ') })
    }
  }
  return { staged, unstaged }
}

/** With maxBytes, git is stopped once that much is read, so a huge diff never sits in memory whole. */
async function rawDiff(cwd: string, target: DiffTarget, maxBytes?: number, encoding?: BufferEncoding): Promise<{ out: string; truncated: boolean }> {
  const { file } = target
  const paths = file.oldPath ? [file.oldPath, file.path] : [file.path]
  // Local diffs can be staged in parts, which needs context lines whatever diff.context says.
  const local = target.kind === 'staged' || target.kind === 'unstaged'
  const common = ['--no-color', '--no-ext-diff', '--no-textconv', '-M', ...(local ? ['-U3'] : [])]
  const diffOf = (args: string[], okCodes = [0]): Promise<{ out: string; truncated: boolean }> =>
    exec(cwd, ['diff', ...common, ...args], { okCodes, maxBytes, encoding })

  if (target.kind === 'commit') {
    assertHash(target.hash)
    const parents = (await git(cwd, ['rev-list', '--parents', '-n1', target.hash])).trim().split(' ').slice(1)
    return diffOf([parents[0] ?? EMPTY_TREE, target.hash, '--', ...paths])
  }
  if (target.kind === 'files') {
    for (const p of [target.a, target.b]) if (!isAbsolute(p)) throw new Error(`Not a file path: ${p}`)
    return diffOf(['--no-index', '--', target.a, target.b], [0, 1])
  }
  if (target.kind === 'text') {
    // Each side goes to a temporary file for git, removed right after.
    const dir = await mkdtemp(join(tmpdir(), 'spoon-compare-'))
    try {
      const [a, b] = [join(dir, 'from'), join(dir, 'to')]
      await Promise.all([writeFile(a, target.left), writeFile(b, target.right)])
      return await diffOf(['--no-index', '--', a, b], [0, 1])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }
  if (target.kind === 'range') {
    assertHash(target.from)
    assertHash(target.to)
    return diffOf([target.from, target.to, '--', ...paths])
  }
  if (target.kind === 'staged') return diffOf(['--cached', '--', ...paths])
  if (file.status === '?') return diffOf(['--no-index', '--', '/dev/null', file.path], [0, 1])
  return diffOf(['--', ...paths])
}

/**
 * The whole file a diff is about, for context the diff itself doesn't carry (where in a Unity scene a
 * change is): the version its new line numbers count in, or the old one for a deleted file.
 */
export async function diffFile(cwd: string, target: DiffTarget): Promise<{ text: string; side: 'new' | 'old' } | null> {
  const { file } = target
  const deleted = file.status === 'D'
  const show = async (spec: string): Promise<string | null> => {
    const { out, truncated } = await exec(cwd, ['show', spec], { okCodes: [0, 128], maxBytes: MAX_FILE_BYTES })
    return truncated ? null : out
  }
  let text: string | null
  if (target.kind === 'text') return { text: target.right, side: 'new' }
  if (target.kind === 'files') {
    try {
      text = (await stat(target.b)).size > MAX_FILE_BYTES ? null : await readFile(target.b, 'utf8')
    } catch {
      text = null
    }
    return text === null ? null : { text, side: 'new' }
  }
  if (target.kind === 'commit') {
    assertHash(target.hash)
    text = deleted ? await show(`${target.hash}^:${file.oldPath ?? file.path}`) : await show(`${target.hash}:${file.path}`)
  } else if (target.kind === 'range') {
    assertHash(target.from)
    assertHash(target.to)
    text = deleted ? await show(`${target.from}:${file.oldPath ?? file.path}`) : await show(`${target.to}:${file.path}`)
  } else if (target.kind === 'staged') text = await show(deleted ? `HEAD:${file.path}` : `:${file.path}`)
  else if (deleted) text = await show(`:${file.path}`)
  else {
    const abs = resolve(cwd, file.path)
    if (!abs.startsWith(resolve(cwd) + sep)) return null
    // Async: a 40 MB scene read synchronously would hold up every other request to the main process.
    try {
      text = (await stat(abs)).size > MAX_FILE_BYTES ? null : await readFile(abs, 'utf8')
    } catch {
      text = null
    }
  }
  return text === null ? null : { text, side: deleted ? 'old' : 'new' }
}
const MAX_FILE_BYTES = 40 * 1024 * 1024

/**
 * Clones url into dest (a new folder, or an empty one), then its submodules on their own: a submodule
 * that can't be downloaded (no SSH access to it, say) leaves the clone itself in place. A clone that
 * fails or is cancelled leaves nothing behind.
 */
export async function clone(
  url: string,
  dest: string,
  submodules: boolean,
  branch: CloneBranch,
  onProgress?: (line: string) => void
): Promise<CloneResult> {
  assertArg(url, 'repository URL')
  if (typeof dest !== 'string' || !isAbsolute(dest)) throw new Error(`Not a folder path: ${dest}`)
  // A password or token in the URL would be saved in the clone's settings (and its command history).
  if (/^https?:\/\/[^/@]+@/i.test(url))
    throw new Error('Leave the user name, password or token out of the URL: git would save it in the repository’s settings. Use SSH, or sign in to git separately.')
  await mkdir(dirname(dest), { recursive: true })
  // The folder is claimed first (only this call made it, so only this call removes it).
  let made = false
  try {
    await mkdir(dest)
    made = true
  } catch {
    if ((await readdir(dest)).length) throw new Error(`${dest} already exists and isn't empty. Choose another name or folder.`)
  }
  inProgress.add(dest)
  let checkedOut: string | null, note: string | null
  try {
    // Nothing is checked out until the branch is chosen (the one with the latest commit is only
    // known once everything is in).
    await exec(dirname(dest), [...SAFE_PROTOCOLS, 'clone', '--progress', '--no-checkout', '--', url, dest], { onProgress, cancellable: dest })
    ;({ checkedOut, note } = await checkOutCloned(dest, branch))
  } catch (err) {
    // A clone whose branch couldn't be checked out (Git LFS failing, say) goes too: no half-made folder.
    if (made) await rm(dest, { recursive: true, force: true })
    else for (const entry of await readdir(dest).catch(() => [] as string[])) await rm(join(dest, entry), { recursive: true, force: true })
    throw err
  } finally {
    inProgress.delete(dest)
  }
  // Left out on purpose: Spoon doesn't download them later by itself either.
  if (!submodules) await git(dest, ['config', 'spoon.autoSubmodules', 'false']).catch(() => undefined)
  const submoduleError = submodules ? await cloneSubmodules(dest, onProgress) : null
  let root = resolve(dest)
  try {
    root = realpathSync(root)
  } catch {
    // keep the path as given
  }
  return { branch: checkedOut, note, submoduleError, root }
}

/**
 * Checks out the chosen branch of a fresh --no-checkout clone: the one with the latest commit, develop,
 * or one by name (the remote's default branch when the repository has no such branch). Only that
 * branch is made locally, as `git clone --branch` would.
 */
async function checkOutCloned(dest: string, branch: CloneBranch): Promise<{ checkedOut: string | null; note: string | null }> {
  const refs = (await git(dest, ['for-each-ref', '--sort=-committerdate', '--format=%(refname)', 'refs/remotes/origin/'])).split('\n').filter((r) => r && r !== 'refs/remotes/origin/HEAD')
  // A name git would read as an option is never checked out.
  const names = refs.map((r) => r.slice('refs/remotes/origin/'.length)).filter((n) => !n.startsWith('-'))
  // "Latest commit" means someone's work: not a bot's or the published website's branch.
  const bot = /^(gh-pages|dependabot\/|renovate\/|snyk-|greenkeeper\/|pre-commit-ci|github-actions\/|release-please)/i
  // What clone made: the remote's default branch (none for an empty repository).
  const made = (await git(dest, ['symbolic-ref', '--quiet', '--short', 'HEAD'], [0, 1])).trim()
  const asked = branch.kind === 'latest' ? (names.find((n) => !bot.test(n)) ?? names[0]) : branch.kind === 'develop' ? 'develop' : branch.name
  // An empty repository has nothing to check out, whatever was asked for.
  if (!names.length) return { checkedOut: made || null, note: null }
  let target = asked && names.includes(asked) ? asked : made
  let note: string | null = null
  if (asked && target !== asked) note = `There’s no ${asked} branch, so ${target || 'the default branch'} was checked out.`
  if (!target || !names.includes(target)) {
    // An empty repository, or a default branch that isn't there: nothing to check out.
    return { checkedOut: made || null, note }
  }
  if (target === made) await git(dest, ['checkout', '--force', '--quiet', made])
  else {
    await git(dest, ['checkout', '--force', '--quiet', '-b', target, '--track', `origin/${target}`])
    if (made) await git(dest, ['branch', '-D', '--quiet', made]).catch(() => undefined)
  }
  return { checkedOut: target, note }
}

let lsRemotes = 0
/** A repository's branches, from the URL before it's cloned (newest first isn't known yet: by name). */
export async function remoteBranches(url: string): Promise<string[]> {
  assertArg(url, 'repository URL')
  if (/^https?:\/\/[^/@]+@/i.test(url)) return []
  // Given up after 20 s (a host that never answers); its own key, so nothing else is cancelled with it.
  const key = join(tmpdir(), `spoon-ls-remote-${++lsRemotes}`)
  const timer = setTimeout(() => cancel(key), 20_000)
  try {
    const { out } = await exec(tmpdir(), [...SAFE_PROTOCOLS, 'ls-remote', '--heads', '--', url], { maxBytes: 20 * 1024 * 1024, cancellable: key })
    return out
      .split('\n')
      .flatMap((l) => /\trefs\/heads\/(.+)$/.exec(l)?.[1] ?? [])
      .filter((n) => !n.startsWith('-'))
      .sort((a, b) => a.localeCompare(b))
  } finally {
    clearTimeout(timer)
  }
}

/** Clones under way: what's left of them goes when Spoon quits mid-clone. */
const inProgress = new Set<string>()
export function abandonClones(): void {
  for (const dest of inProgress) {
    cancel(dest)
    rmSync(dest, { recursive: true, force: true })
  }
}
/** Network transports a cloned repository (or its .gitmodules) may not use, whatever the user's config allows. */
const SAFE_PROTOCOLS = ['-c', 'protocol.ext.allow=never', '-c', 'protocol.file.allow=user']
/**
 * Submodules download several at a time: one connection to a far-away server is slow however fast
 * the line is, and git otherwise brings them in one after another.
 */
const SUBMODULE_JOBS = '--jobs=4'

/** Downloads a repository's submodules (all of them, nested ones too); the error, if one failed. */
export async function cloneSubmodules(cwd: string, onProgress?: (line: string) => void): Promise<string | null> {
  if (!existsSync(join(cwd, '.gitmodules'))) return null
  // Never alongside the automatic download (a tab opened on it): one after the other, by real path.
  await downloadDone(cwd)
  const key = downloadsKey(cwd)
  const task = exec(cwd, [...SAFE_PROTOCOLS, 'submodule', 'update', '--init', '--recursive', '--progress', SUBMODULE_JOBS], { onProgress, cancellable: true }).then(() => [] as string[])
  submoduleDownloads.set(key, task)
  try {
    await task
    return null
  } catch (err) {
    return (err as Error).message
  } finally {
    if (submoduleDownloads.get(key) === task) submoduleDownloads.delete(key)
  }
}

/**
 * Submodules never downloaded on this computer: listed in .gitmodules and recorded by the parent, with
 * an empty folder and no saved copy in the git folder's modules/. One removed with `deinit` keeps its
 * saved copy, so it isn't brought back; neither is one set to `update = none`, nor any in a
 * repository cloned with its submodules left out on purpose (spoon.autoSubmodules false).
 */
export async function newSubmodules(cwd: string): Promise<string[]> {
  if (!existsSync(join(cwd, '.gitmodules'))) return []
  if ((await git(cwd, ['config', '--bool', 'spoon.autoSubmodules'], [0, 1])).trim() === 'false') return []
  const config = await git(cwd, ['config', '-z', '-f', '.gitmodules', '--get-regexp', '^submodule\\..*\\.(path|update)$'], [0, 1])
  const subs = new Map<string, { path?: string; skip?: boolean }>()
  for (const entry of config.split('\0').filter(Boolean)) {
    const nl = entry.indexOf('\n')
    const m = /^submodule\.(.+)\.(path|update)$/.exec(entry.slice(0, nl))
    if (!m) continue
    const sub = subs.get(m[1]) ?? {}
    if (m[2] === 'path') sub.path = entry.slice(nl + 1)
    else if (entry.slice(nl + 1).trim() === 'none') sub.skip = true
    subs.set(m[1], sub)
  }
  const named = [...subs].flatMap(([name, s]) => (s.path && !s.skip ? [{ name, path: s.path }] : []))
  if (!named.length) return []
  // Only submodules the parent records (stage 0: not one whose pointer is in conflict).
  const index = await git(cwd, ['ls-files', '-s', '-z', '--', ...named.map((s) => s.path)]).catch(() => '')
  const recorded = new Map(index.split('\0').flatMap((e) => {
    const m = /^160000 ([0-9a-f]+) 0\t(.+)$/.exec(e)
    return m ? [[m[2], m[1]] as const] : []
  }))
  const dirs = (await git(cwd, ['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir'])).trim().split('\n')
  // `submodule.active` pathspecs (git clone --recurse-submodules=<spec>): only matching ones are on,
  // unless a submodule's own active setting says otherwise.
  const specs = (await git(cwd, ['config', '--get-all', 'submodule.active'], [0, 1])).split('\n').filter(Boolean)
  const bySpec = specs.length
    ? // Pathspecs proper here (libs/*, :(glob)…, :(exclude)…), not the literal file names used everywhere else.
      new Set((await run(cwd, ['ls-files', '-z', '--', ...specs], { env: { GIT_LITERAL_PATHSPECS: '0' } }).catch(() => '')).split('\0').filter(Boolean))
    : null
  const setting = async (key: string, type?: 'bool'): Promise<string> =>
    (await git(cwd, ['config', ...(type ? ['--type=bool'] : []), '--get', key], [0, 1]).catch(() => '')).trim()
  // Only from the host the repository itself comes from (relative URLs included): an opened
  // repository's .gitmodules naming some other server waits for Initialize.
  const home = await remoteHost(cwd)
  const urls = await git(cwd, ['config', '-z', '-f', '.gitmodules', '--get-regexp', '^submodule\\..*\\.url$'], [0, 1]).catch(() => '')
  const urlOf = new Map(urls.split('\0').filter(Boolean).map((e) => {
    const nl = e.indexOf('\n')
    return [e.slice(0, nl).replace(/^submodule\./, '').replace(/\.url$/, ''), e.slice(nl + 1).trim()] as const
  }))
  const fresh: string[] = []
  for (const s of named) {
    const commit = recorded.get(s.path)
    if (!commit) continue
    const url = (await setting(`submodule.${s.name}.url`)) || urlOf.get(s.name) || ''
    if (home && !/^\.\.?\//.test(url) && (await hostOf(url)) !== home) continue
    // Turned off in this clone's own settings (false, no, off, 0 all count).
    const active = await setting(`submodule.${s.name}.active`, 'bool')
    if (active === 'false') continue
    if (!active && bySpec && !bySpec.has(s.path)) continue
    if ((await setting(`submodule.${s.name}.update`)) === 'none') continue
    // Tried before and couldn't be downloaded (no access, say): not again until the parent records
    // another commit for it.
    if ((await setting(`spoon-submodule.${s.name}.failed`)) === commit) continue
    if (dirs.some((d) => existsSync(join(d, 'modules', s.name)))) continue
    const dir = join(cwd, s.path)
    // git only downloads into an empty (or missing) folder.
    if (existsSync(dir) && (await readdir(dir).catch(() => ['?'])).length) continue
    fresh.push(s.path)
  }
  return fresh
}

/** The host a git URL reaches (an ssh alias resolved the way ssh would), lowercased; '' for a local path. */
async function hostOf(url: string): Promise<string> {
  let host = ''
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    try {
      host = new URL(url).hostname
    } catch {
      return ''
    }
  } else {
    // scp style: [user@]host:path (not a Windows drive letter).
    const m = /^(?:[^@/]+@)?([^:/]+):(?!\\)/.exec(url)
    if (!m || m[1].length === 1) return ''
    host = m[1]
  }
  host = host.toLowerCase()
  // Over ssh (ssh:// or scp style) the name may be an alias from ~/.ssh/config.
  if (/^ssh:\/\//i.test(url) || !/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) host = (await sshHostName(host)) ?? host
  return host === 'ssh.github.com' || host === 'www.github.com' ? 'github.com' : host
}
const sshNames = new Map<string, Promise<string | null>>()
/** What ssh's config makes of a host name (an alias like github-work → github.com). */
function sshHostName(alias: string): Promise<string | null> {
  // Never an option: the name comes from a repository's .gitmodules.
  if (!/^[\w.][\w.-]*$/.test(alias)) return Promise.resolve(null)
  if (!sshNames.has(alias))
    sshNames.set(alias, new Promise((done) =>
      execFile('ssh', ['-G', alias], { env, timeout: 5_000 }, (err, out) => done(err ? null : (/^hostname (\S+)$/m.exec(out)?.[1]?.toLowerCase() ?? null)))
    ))
  return sshNames.get(alias)!
}
/** The host of the repository's own remote (origin, else the first one); '' when it has none. */
async function remoteHost(cwd: string): Promise<string> {
  const remotes = (await git(cwd, ['remote'], [0, 1]).catch(() => '')).split('\n').filter(Boolean)
  const name = remotes.includes('origin') ? 'origin' : remotes[0]
  if (!name) return ''
  return hostOf((await git(cwd, ['remote', 'get-url', '--', name], [0, 2, 128]).catch(() => '')).trim())
}

/** git's ways of saying a repository can't be had (rather than couldn't be reached just now). */
const NO_ACCESS = /Permission denied \((publickey|keyboard-interactive|password)|Permission to \S+ denied|Authentication failed|Repository not found|repository '[^']*' not found|access denied|not authorized|HTTP 40[134]\b|returned error: 40[134]\b/i

/** Notes the submodules a download didn't bring (with the commit asked for), so they aren't tried again by themselves. */
async function noteFailedSubmodules(cwd: string, paths: string[]): Promise<void> {
  const still = new Set(await newSubmodules(cwd).catch(() => [] as string[]))
  const names = await git(cwd, ['config', '-z', '-f', '.gitmodules', '--get-regexp', '^submodule\\..*\\.path$'], [0, 1]).catch(() => '')
  for (const entry of names.split('\0').filter(Boolean)) {
    const nl = entry.indexOf('\n')
    const name = /^submodule\.(.+)\.path$/.exec(entry.slice(0, nl))?.[1]
    const path = entry.slice(nl + 1)
    if (!name || !paths.includes(path) || !still.has(path)) continue
    const commit = /^160000 ([0-9a-f]+) 0\t/.exec((await git(cwd, ['ls-files', '-s', '--', path]).catch(() => '')).trim())?.[1]
    if (commit) await git(cwd, ['config', `spoon-submodule.${name}.failed`, commit]).catch(() => undefined)
  }
}

/**
 * Downloads the submodules never downloaded here (and theirs); the paths it downloaded. It runs beside
 * the repository's other git work rather than queued with it (MainLib alone can take minutes): it only
 * fills empty submodule folders and their own git folders, which a fetch, pull or commit in the parent
 * doesn't touch. One download per repository at a time; its Cancel is its own.
 */
export function downloadNewSubmodules(cwd: string, onProgress?: (line: string) => void): Promise<string[]> {
  const key = downloadsKey(cwd)
  const running = submoduleDownloads.get(key)
  if (running) return running
  const task = (async () => {
    const paths = await newSubmodules(cwd)
    if (paths.length)
      try {
        await exec(cwd, [...SAFE_PROTOCOLS, 'submodule', 'update', '--init', '--recursive', '--progress', SUBMODULE_JOBS, '--', ...paths], {
          onProgress,
          cancellable: downloadKey(cwd)
        })
      } catch (err) {
        // Ones git couldn't get (no access, gone) wait for a new commit (or Initialize). Cancelled ones,
        // and ones that failed because the network or the server was down, are tried again next time.
        if (NO_ACCESS.test((err as Error).message)) await noteFailedSubmodules(cwd, paths)
        throw err
      }
    return paths
  })().finally(() => submoduleDownloads.delete(key))
  submoduleDownloads.set(key, task)
  return task
}
const submoduleDownloads = new Map<string, Promise<string[]>>()
/** What a submodule download is cancelled by (not the repository's own Cancel, which stops its fetch or pull). */
const downloadKey = (cwd: string): string => join(repoKey(cwd), '.git', 'spoon-submodule-download')
export const cancelSubmoduleDownload = (cwd: string): void => cancel(downloadKey(cwd))
/** Waits for a submodule download under way in the repository (Initialize after it, not alongside). */
const downloadDone = (cwd: string): Promise<unknown> => (submoduleDownloads.get(downloadsKey(cwd)) ?? Promise.resolve()).catch(() => undefined)
/** By real path, so a folder reached through a link is the same repository. */
const downloadsKey = (cwd: string): string => {
  try {
    return realpathSync(resolve(cwd))
  } catch {
    return repoKey(cwd)
  }
}

/**
 * owner/name (lowercase) for each repository whose remote is on GitHub; null for the rest. The URL is
 * read as git uses it (insteadOf rules), and ssh host aliases (git@github-work:…) count when ssh's
 * config points them at GitHub.
 */
export async function githubSlugs(paths: string[]): Promise<(string | null)[]> {
  return Promise.all(
    paths.map(async (path) => {
      if (typeof path !== 'string' || !isAbsolute(path) || !existsSync(join(path, '.git'))) return null
      const remotes = (await git(path, ['remote'], [0, 1]).catch(() => '')).split('\n').filter(Boolean)
      // origin first, then any other remote that's on GitHub.
      remotes.sort((a, b) => Number(a !== 'origin') - Number(b !== 'origin'))
      for (const name of remotes) {
        const url = (await git(path, ['ls-remote', '--get-url', '--', name], [0, 1, 128]).catch(() => '')).trim()
        if ((await hostOf(url)) !== 'github.com') continue
        const where = /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? (() => { try { return new URL(url).pathname } catch { return '' } })() : url.slice(url.indexOf(':') + 1)
        const m = /^\/*([^/\s]+\/[^/\s]+?)(?:\.git)?\/*$/.exec(where)
        if (m) return m[1].toLowerCase()
      }
      return null
    })
  )
}

/** Two branches (or any commits) compared: the commits between them and every file that differs. */
export async function compareRefs(cwd: string, base: string, compare: string, mode: CompareMode): Promise<RefCompare> {
  const tip = async (ref: string): Promise<string> => {
    assertArg(ref, 'branch')
    const hash = (await git(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], [0, 1])).trim()
    if (!hash) throw new Error(`Can't find ${ref}.`)
    return hash
  }
  const [a, b] = await Promise.all([tip(base), tip(compare)])
  let from = a
  if (mode === 'changes') {
    from = (await git(cwd, ['merge-base', a, b], [0, 1])).trim()
    if (!from) {
      const short = (r: string): string => r.replace(/^refs\/(heads|remotes|tags)\//, '')
      if ((await git(cwd, ['rev-parse', '--is-shallow-repository'])).trim() === 'true')
        throw new Error(`This clone only has recent history, so where ${short(compare)} split from ${short(base)} can't be found. Use “Every difference”, or fetch the full history.`)
      throw new Error(`${short(compare)} and ${short(base)} have no history in common.`)
    }
  }
  const common = ['--no-color', '--no-ext-diff', '--no-textconv', '-M', '-z', from, b]
  const [counts, names, stats] = await Promise.all([
    git(cwd, ['rev-list', '--left-right', '--count', `${a}...${b}`]),
    git(cwd, ['diff', '--name-status', ...common]),
    git(cwd, ['diff', '--numstat', ...common])
  ])
  const [behind, ahead] = counts.trim().split(/\s+/).map(Number)
  // --numstat -z: "added<TAB>removed<TAB>path", or for a rename "added<TAB>removed<TAB>" then both paths.
  const lines = new Map<string, [number | null, number | null]>()
  const tokens = stats.split('\0')
  for (let i = 0; i < tokens.length; ) {
    const m = /^(-|\d+)\t(-|\d+)\t([\s\S]*)$/.exec(tokens[i++])
    if (!m) continue
    const path = m[3] || (i++, tokens[i++])
    lines.set(path, [m[1] === '-' ? null : Number(m[1]), m[2] === '-' ? null : Number(m[2])])
  }
  const files = parseNameStatus(names).map((f) => {
    const [added, removed] = lines.get(f.path) ?? [0, 0]
    return { ...f, added, removed }
  })
  return { from, to: b, ahead: ahead || 0, behind: behind || 0, files }
}

export async function diff(cwd: string, target: DiffTarget): Promise<DiffResult> {
  const { out: text, truncated } = await rawDiff(cwd, target, MAX_DIFF_BYTES)
  const binary = /^Binary files .* differ$/m.test(text.slice(0, 4096)) && !/^@@/m.test(text)
  return { text, binary, truncated }
}

// ---------- writing: index ----------

async function hasHead(cwd: string): Promise<boolean> {
  return !!(await git(cwd, ['rev-parse', '-q', '--verify', 'HEAD'], [0, 1])).trim()
}

/** Paths go through stdin, so staging thousands of Unity files never hits the argv limit. */
function withPaths(cwd: string, args: string[], paths: string[]): Promise<string> {
  return run(cwd, [...args, '--pathspec-from-file=-', '--pathspec-file-nul'], { input: paths.join('\0') })
}

export async function stage(cwd: string, paths: string[]): Promise<void> {
  if (paths.length) await exclusive(cwd, () => withPaths(cwd, ['add', '-A'], paths))
}

/**
 * Throws away local changes, keeping a way back: the current version of every file it overwrites or
 * deletes is first put in one folder, which goes to the system Trash ("<repo> – discarded <time>").
 *
 * - Unstaged entries go back to what's staged; new (untracked) files are deleted.
 * - Staged entries undo only the staged part: the index goes back to HEAD and the staged changes are
 *   reversed in the file, so unstaged edits to it stay. When the two overlap and can't be separated,
 *   the file goes back to HEAD (its previous contents are in the Trash folder).
 * - Staged new files leave the index and are deleted; a staged rename goes back to the old name.
 * - Conflicted files are left alone.
 */
export async function discard(
  cwd: string,
  files: DiscardEntry[],
  trash: (absolutePath: string) => Promise<void>
): Promise<void> {
  if (!files.length) return
  await exclusive(cwd, async () => {
    const root = resolve(cwd)
    // Paths come from the renderer: only ones inside the work tree (and outside .git) are touched.
    const inside = (p: string): string => {
      const abs = resolve(root, p)
      const rel = relative(root, abs)
      // Case-insensitive, and Windows' other names for it: on macOS and Windows ".GIT" is the same folder.
      if (!insideRel(rel))
        throw new Error(`Refusing to discard a path outside the repository: ${p}`)
      return abs
    }
    const head = await hasHead(cwd)
    const remove: string[] = [] // deleted from disk (after being moved into the Trash folder)
    const fromIndex: string[] = [] // working tree back to the index
    const fromHead: string[] = [] // index and working tree back to HEAD
    const unindex: string[] = [] // dropped from the index
    for (const f of files) {
      inside(f.path)
      if (f.oldPath) inside(f.oldPath)
      if (f.status === 'U') continue
      if (!f.staged) {
        if (f.status === '?') remove.push(f.path)
        else fromIndex.push(f.path)
      } else if (f.status === 'A' || !head) {
        unindex.push(f.path)
        remove.push(f.path)
      } else if (f.status === 'R' || f.status === 'C') {
        if (f.oldPath && f.status === 'R') fromHead.push(f.oldPath)
        unindex.push(f.path)
        remove.push(f.path)
      } else {
        fromHead.push(f.path)
      }
    }

    // Staged files that also have unstaged edits: only their staged part is undone, if possible.
    const unstagedNow = new Set((await git(cwd, ['diff', '--name-only', '-z'])).split('\0').filter(Boolean))
    const partial = fromHead.filter((p) => unstagedNow.has(p))
    const whole = fromHead.filter((p) => !unstagedNow.has(p))

    // 1. Keep the current versions: copy what gets overwritten, move what gets deleted.
    const gitDir = await gitDirOf(cwd)
    const d = new Date()
    const two = (n: number): string => String(n).padStart(2, '0')
    const stamp = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}.${two(d.getMinutes())}.${two(d.getSeconds())}`
    let box = join(gitDir, 'spoon-discard', `${basename(root)} – discarded ${stamp}`)
    for (let n = 2; existsSync(box); n++) box = join(gitDir, 'spoon-discard', `${basename(root)} – discarded ${stamp} (${n})`)
    let kept = 0
    const keep = async (rel: string, move: boolean): Promise<void> => {
      const abs = inside(rel)
      const st = await lstat(abs).catch(() => null)
      if (!st || st.isDirectory()) return // nothing on disk, or a submodule's folder
      const dest = join(box, rel)
      await mkdir(dirname(dest), { recursive: true })
      if (move) {
        await rename(abs, dest).catch(async () => {
          await cp(abs, dest, { verbatimSymlinks: true })
          await rm(abs, { force: true })
        })
      } else {
        await cp(abs, dest, { verbatimSymlinks: true })
      }
      kept++
    }
    for (const p of new Set([...fromIndex, ...fromHead])) await keep(p, false)
    for (const p of new Set(remove)) await keep(p, true)

    // 2. Discard.
    if (fromIndex.length) await withPaths(cwd, ['restore', '--worktree'], fromIndex)
    if (whole.length) await withPaths(cwd, ['restore', '--source=HEAD', '--staged', '--worktree'], whole)
    for (const p of partial) {
      const staged = await run(cwd, ['diff', '--cached', '--binary', '--no-ext-diff', '--no-textconv', '--', p], { encoding: 'latin1' })
      const reversed = await run(cwd, ['apply', '-R', '--whitespace=nowarn', '-'], { input: Buffer.from(staged, 'latin1') }).then(
        () => true,
        () => false
      )
      if (reversed) await git(cwd, ['restore', '--source=HEAD', '--staged', '--', p])
      else await git(cwd, ['restore', '--source=HEAD', '--staged', '--worktree', '--', p])
    }
    if (unindex.length) await withPaths(cwd, ['rm', '--cached', '-r', '-q', '--ignore-unmatch'], unindex)

    // Folders the deleted files leave empty go too, as `git clean` would.
    for (const p of remove) {
      let dir = dirname(inside(p))
      while (dir !== root && dir.startsWith(root + sep)) {
        if ((await readdir(dir).catch(() => ['?'])).length) break
        await rmdir(dir).catch(() => undefined)
        dir = dirname(dir)
      }
    }

    // 3. The kept versions go to the Trash in one folder.
    if (kept === 0) return rmSync(box, { recursive: true, force: true })
    try {
      await trash(box)
    } catch {
      throw new Error(`The changes were discarded, but their copies couldn’t be moved to the Trash. They’re in ${box}`)
    }
    await rmdir(join(gitDir, 'spoon-discard')).catch(() => undefined) // only removed when left empty
  })
}

export async function unstage(cwd: string, paths: string[]): Promise<void> {
  if (!paths.length) return
  await exclusive(cwd, async () => {
    if (await hasHead(cwd)) await withPaths(cwd, ['restore', '--staged'], paths)
    else await withPaths(cwd, ['rm', '--cached', '-r', '-q'], paths)
  })
}

export async function stageAll(cwd: string): Promise<void> {
  await exclusive(cwd, () => git(cwd, ['add', '-A']))
}

export async function unstageAll(cwd: string): Promise<void> {
  await exclusive(cwd, async () => {
    if (await hasHead(cwd)) await git(cwd, ['reset', '-q'])
    else await git(cwd, ['rm', '--cached', '-r', '-q', '.'])
  })
}

// Hunk and line staging work on the diff's bytes as they are (decoded as latin1, one char per byte),
// so files in other encodings than UTF-8 are staged byte for byte.
const BYTES = 'latin1'
const fromBytes = (line: string): string => Buffer.from(line, BYTES).toString('utf8')
/** A line of the latin1-decoded diff as the renderer shows it (UTF-8, no sign, tabs as four spaces). */
const shownText = (line: string): string => fromBytes(line).slice(1).replace(/\t/g, '    ')

/**
 * The live diff of a local file, for staging part of it: its file header (made a plain change of the
 * file, so unstaging part of a rename doesn't undo the rename, and a mode change isn't staged along)
 * and its lines, with where each hunk starts.
 */
async function localPatch(cwd: string, target: DiffTarget): Promise<{ head: string[]; lines: string[]; starts: number[] }> {
  if (target.kind !== 'staged' && target.kind !== 'unstaged') throw new Error('Only local changes can be staged in parts.')
  const { file } = target
  // Paths come from the renderer: only changed files inside the work tree (not new, untracked ones).
  const root = resolve(cwd)
  for (const p of [file.path, file.oldPath].filter((x): x is string => x !== undefined)) {
    if (typeof p !== 'string' || isAbsolute(p) || !insideRel(relative(root, resolve(root, p))))
      throw new Error(`Not a file in this repository: ${p}`)
  }
  if (file.status === '?' || file.status === 'U') throw new Error('Only tracked files can be staged in parts.')
  const lines = (await rawDiff(cwd, target, undefined, BYTES)).out.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  const starts = lines.flatMap((l, i) => (l.startsWith('@@ ') ? [i] : []))
  if (!starts.length) throw new Error('The file changed since the diff was shown. Refresh and try again.')
  if (lines.slice(starts[0]).some((l) => l.startsWith('diff --git'))) throw new Error('The diff covers more than one file.')
  if (lines.some((l) => /^[ +-]Subproject commit /.test(l))) throw new Error('A submodule’s commit can’t be staged in parts.')
  let head = lines.slice(0, starts[0])
  // A rename or copy becomes a change of the new path; mode changes stay out.
  const plus = head.find((l) => l.startsWith('+++ '))
  if (plus && head.some((l) => /^(rename|copy) from /.test(l))) {
    const b = plus.slice(4)
    const a = b.replace(/^("?)b\//, '$1a/')
    head = [`diff --git ${a} ${b}`, `--- ${a}`, plus]
  } else head = head.filter((l) => !/^(old|new) mode /.test(l))
  return { head, lines, starts }
}

async function applyPatch(cwd: string, target: DiffTarget, patch: string[]): Promise<void> {
  const args = ['apply', '--cached', '--whitespace=nowarn']
  if (target.kind === 'staged') args.push('--reverse')
  await run(cwd, [...args, '-'], { input: Buffer.from(patch.join('\n') + '\n', BYTES) })
}

/**
 * Stages (unstaged target) or unstages (staged target) a single hunk by rebuilding a patch
 * from the current diff: file header + that hunk, applied to the index.
 */
export async function applyHunk(cwd: string, target: DiffTarget, hunkIndex: number, hunkHeader: string): Promise<void> {
  return exclusive(cwd, async () => {
    const { head, lines, starts } = await localPatch(cwd, target)
    const start = starts[hunkIndex]
    if (start === undefined || fromBytes(lines[start]) !== hunkHeader) throw new Error('The file changed since the diff was shown. Refresh and try again.')
    await applyPatch(cwd, target, [...head, ...lines.slice(start, starts[hunkIndex + 1] ?? lines.length)])
  })
}

/**
 * Stages (unstaged target) or unstages (staged target) single lines: for each hunk, the picked lines
 * (indexes into the lines after its header, with their text as shown, checked against the diff now)
 * go in and the rest are left as they are, like git add -p's line editing. Unpicked lines on the side
 * being changed become context; on the other side they go.
 */
export async function applyLines(cwd: string, target: DiffTarget, picks: LinePick[]): Promise<void> {
  return exclusive(cwd, async () => {
    const { head, lines, starts } = await localPatch(cwd, target)
    const reverse = target.kind === 'staged'
    // Part of a deletion leaves a shorter file (unstaging part of a new file, the same): a plain change.
    let header = head
    if (!reverse && target.file.status === 'D') header = head.filter((l) => !/^deleted file mode /.test(l)).map((l) => (l === '+++ /dev/null' ? l.replace('/dev/null', `b/${target.file.path}`) : l))
    if (reverse && target.file.status === 'A') header = head.filter((l) => !/^new file mode /.test(l)).map((l) => (l === '--- /dev/null' ? l.replace('/dev/null', `a/${target.file.path}`) : l))
    // Applied forwards the old side must match the index, so it stays whole: unpicked removals become
    // context and unpicked additions go. Reversed (unstaging), the same holds for the new side.
    const keepSign = reverse ? '+' : '-'
    // One pick per hunk (a repeated hunk is merged into it).
    const byHunk = new Map<number, LinePick>()
    for (const p of picks) {
      if (!Number.isInteger(p.hunk) || !Array.isArray(p.lines) || !Array.isArray(p.texts) || p.texts.length !== p.lines.length)
        throw new Error('Invalid line pick.')
      const had = byHunk.get(p.hunk)
      if (had && had.header !== p.header) throw new Error('Invalid line pick.')
      byHunk.set(p.hunk, had ? { ...had, lines: [...had.lines, ...p.lines], texts: [...had.texts, ...p.texts] } : p)
    }
    const out: string[] = [...header]
    let shift = 0
    for (const pick of [...byHunk.values()].sort((a, b) => a.hunk - b.hunk)) {
      const start = starts[pick.hunk]
      const stale = (): Error => new Error('The file changed since the diff was shown. Refresh and try again.')
      if (start === undefined || fromBytes(lines[start]) !== pick.header) throw stale()
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(lines[start])
      if (!m) throw new Error(`Unexpected hunk header: ${lines[start]}`)
      const hunk = lines.slice(start + 1, starts[pick.hunk + 1] ?? lines.length)
      // Every picked line must still be the one that was shown (an editor may have saved since).
      const chosen = new Set<number>()
      pick.lines.forEach((k, i) => {
        const l = hunk[k]
        if (l === undefined || (l[0] !== '+' && l[0] !== '-') || `${l[0]}${shownText(l)}` !== pick.texts[i]) throw stale()
        chosen.add(k)
      })
      // The last line, changed only by gaining (or losing) its newline: taking the new one takes the old
      // one with it, or the file would have it twice.
      // Only the other side's last line can be its twin (an earlier line with the same text is another line).
      const otherSign = reverse ? '-' : '+'
      let lastOther = -1
      hunk.forEach((o, j) => void ((o[0] === ' ' || o[0] === otherSign) && (lastOther = j)))
      hunk.forEach((l, k) => {
        if (chosen.has(k) || l[0] !== keepSign || !hunk[k + 1]?.startsWith('\\')) return
        const twin = hunk[lastOther]
        if (twin?.[0] === otherSign && chosen.has(lastOther) && twin.slice(1) === l.slice(1)) chosen.add(k)
      })
      const body: string[] = []
      let kept = true // whether the last line went in (a "\ No newline" note goes with it)
      let changes = 0
      hunk.forEach((l, k) => {
        if (l.startsWith('\\')) {
          if (kept) body.push(l)
          return
        }
        if (l[0] === '+' || l[0] === '-') {
          if (chosen.has(k)) {
            body.push(l)
            changes++
            kept = true
          } else if (l[0] === keepSign) {
            body.push(` ${l.slice(1)}`)
            kept = true
          } else kept = false
          return
        }
        body.push(l)
        kept = true
      })
      if (!changes) continue
      // A line that became context but has no newline (the file's last line) can't have lines after
      // it: on the side that grows, it gets its newline back (-y, +y) and the note stays with the end.
      const note = body.findIndex((l, i) => l.startsWith('\\') && body[i - 1]?.[0] === ' ')
      if (note > 0 && body.slice(note + 1).some((l) => l[0] === (reverse ? '-' : '+'))) {
        const [y, marker] = [body[note - 1].slice(1), body[note]]
        if (reverse) {
          body.splice(note - 1, 2, `-${y}`)
          body.push(`+${y}`, marker)
        } else body.splice(note - 1, 2, `-${y}`, marker, `+${y}`)
      }
      // The same for a changed line marked as its side's last when more of that side now follows it (a
      // last line restored or added before kept lines): it gets its newline back, the note goes.
      for (let i = body.length - 1; i > 0; i--) {
        const sign = body[i - 1][0]
        if (!body[i].startsWith('\\') || (sign !== '-' && sign !== '+')) continue
        if (body.slice(i + 1).some((l) => l[0] === ' ' || l[0] === sign)) body.splice(i, 1)
      }
      const oldCount = body.filter((l) => l[0] === ' ' || l[0] === '-').length
      const newCount = body.filter((l) => l[0] === ' ' || l[0] === '+').length
      // The side that stays whole keeps its start; the other follows the hunks before it. An empty side
      // starts on the line before.
      let [oldStart, newStart] = reverse ? [Number(m[2]) - shift, Number(m[2])] : [Number(m[1]), Number(m[1]) + shift]
      if (!oldCount) oldStart = Math.max(0, oldStart - (reverse ? 1 : 0))
      if (!newCount) newStart = Math.max(0, newStart - (reverse ? 0 : 1))
      if (oldCount && !oldStart) oldStart = 1
      if (newCount && !newStart) newStart = 1
      shift += newCount - oldCount
      out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@${m[3]}`, ...body)
    }
    if (out.length === header.length) return
    await applyPatch(cwd, target, out)
  })
}

// ---------- writing: commits ----------

export async function headMessage(cwd: string): Promise<string> {
  if (!(await hasHead(cwd))) return ''
  return (await git(cwd, ['log', '-1', '--format=%B'])).trimEnd()
}

/**
 * Unity assets moved outside git's sight (a deleted .meta and a new one with the same guid), as
 * [from, to] .meta pairs: the old .meta is read from HEAD, the new one from disk.
 */
export async function unityMoves(cwd: string, removed: string[], added: string[]): Promise<[string, string][]> {
  const root = resolve(cwd)
  const ok = (p: unknown): p is string =>
    typeof p === 'string' && p.endsWith('.meta') && !isAbsolute(p) && !p.includes('\n') && insideRel(relative(root, resolve(root, p)))
  const gone = removed.filter(ok).slice(0, 5000)
  const fresh = added.filter(ok).slice(0, 5000)
  if (!gone.length || !fresh.length) return []
  const guid = (text: string): string | undefined => /^guid:[ \t]*([0-9a-fA-F]+)[ \t]*\r?$/m.exec(text)?.[1]
  // One cat-file for all the old ones: "<id> blob <size>\n<content>\n" each, or "<name> missing\n".
  const out = await run(cwd, ['cat-file', '--batch'], { input: gone.map((p) => `HEAD:${p}`).join('\n') + '\n', encoding: 'latin1' })
  const byGuid = new Map<string, string>()
  let at = 0
  for (const p of gone) {
    const nl = out.indexOf('\n', at)
    if (nl < 0) break
    const head = out.slice(at, nl).split(' ')
    at = nl + 1
    if (head[1] !== 'blob') continue
    const size = Number(head[2])
    const g = guid(out.slice(at, at + Math.min(size, 4096)))
    at += size + 1
    if (g) byGuid.set(g, p)
  }
  const pairs: [string, string][] = []
  for (const p of fresh) {
    const text = await readFile(join(root, p), 'latin1').catch(() => '')
    const from = byGuid.get(guid(text.slice(0, 4096)) ?? '')
    if (from) pairs.push([from, p])
  }
  return pairs
}

/**
 * Commits exactly these paths as they are on disk (new, changed or deleted), whatever else is staged,
 * in one go under the lock: nothing staged meanwhile by another tool slips in (Simple Mode's save).
 */
export async function commitOnly(cwd: string, paths: string[], message: string): Promise<string> {
  if (!message.trim()) throw new Error('Commit message is empty.')
  if (!paths.length) throw new Error('Nothing to save.')
  return exclusive(cwd, async () => {
    await withPaths(cwd, ['add', '-A'], paths)
    await run(cwd, ['commit', '--only', '-m', message, '--pathspec-from-file=-', '--pathspec-file-nul'], { input: paths.join('\0') })
    return (await git(cwd, ['rev-parse', 'HEAD'])).trim()
  })
}

export async function commit(cwd: string, message: string, amend: boolean): Promise<string> {
  if (!message.trim()) throw new Error('Commit message is empty.')
  return exclusive(cwd, async () => {
    await run(cwd, ['commit', '-F', '-', ...(amend ? ['--amend'] : [])], { input: message })
    return (await git(cwd, ['rev-parse', 'HEAD'])).trim()
  })
}

// ---------- writing: branches ----------

export function checkout(cwd: string, target: CheckoutTarget): Promise<void> {
  return exclusive(cwd, () => checkoutNow(cwd, target))
}

async function checkoutNow(cwd: string, target: CheckoutTarget): Promise<void> {
  if (target.kind === 'branch') {
    assertArg(target.name, 'branch')
    await git(cwd, ['switch', target.name])
  } else if (target.kind === 'commit') {
    assertHash(target.hash)
    await git(cwd, ['switch', '--detach', target.hash])
  } else {
    // "origin/feature/x" -> local "feature/x", tracking the remote branch.
    const remotes = (await git(cwd, ['remote'])).split('\n').filter(Boolean)
    const remote = remotes
      .filter((r) => target.name.startsWith(`${r}/`))
      .sort((a, b) => b.length - a.length)[0]
    if (!remote) throw new Error(`Unknown remote for ${target.name}`)
    const local = target.name.slice(remote.length + 1)
    assertArg(local, 'branch')
    const exists = !!(await git(cwd, ['rev-parse', '-q', '--verify', `refs/heads/${local}`], [0, 1])).trim()
    if (exists) await git(cwd, ['switch', local])
    else await git(cwd, ['switch', '-c', local, '--track', target.name])
  }
}

/**
 * A checkout those files' local changes would block: they're stashed, the checkout runs, and they're
 * put back on top, all in one lock. A checkout that still fails puts them back where they were.
 * Changes that don't apply cleanly stay in the stash, with any conflicts marked in the files.
 */
export function checkoutCarrying(cwd: string, target: CheckoutTarget, files: string[], description: string): Promise<CarryResult> {
  return exclusive(cwd, async () => {
    const tip = async (): Promise<string> => (await git(cwd, ['rev-parse', '-q', '--verify', 'refs/stash'], [0, 1])).trim()
    const where = async (): Promise<string> =>
      `${(await git(cwd, ['symbolic-ref', '-q', 'HEAD'], [0, 1])).trim()} ${(await git(cwd, ['rev-parse', '-q', '--verify', 'HEAD'], [0, 1])).trim()}`
    // New files of yours that the branch has too can't come back over its own: say so before anything
    // moves (the rest would be stuck in the stash with them).
    const dest = target.kind === 'branch' ? `refs/heads/${target.name}` : target.kind === 'remote' ? `refs/remotes/${target.name}` : target.hash
    const mine = (await run(cwd, ['ls-files', '--others', '--exclude-standard', '-z', '--', ...files], { env: { GIT_LITERAL_PATHSPECS: '1' } }))
      .split('\0')
      .filter(Boolean)
    const clash = mine.length
      ? (await git(cwd, ['ls-tree', '-r', '--name-only', '-z', dest, '--', ...mine], [0, 128])).split('\0').filter(Boolean)
      : []
    if (clash.length) {
      const which = clash.length === 1 ? clash[0] : `${clash.slice(0, 3).join(', ')}${clash.length > 3 ? '…' : ''}`
      throw new Error(`${description} has its own ${which}, so yours can't be carried over. Move or rename your ${clash.length === 1 ? 'file' : 'files'} first, or discard ${clash.length === 1 ? 'it' : 'them'}.`)
    }
    const before = await tip()
    const head = await where()
    const stash = `Spoon: changes carried to ${description}`
    // Paths as they are: a file named with * or [ isn't a pattern.
    await run(cwd, ['stash', 'push', '--include-untracked', '-m', stash, '--', ...files], { env: { GIT_LITERAL_PATHSPECS: '1' } })
    const hash = await tip()
    // Only a stash made just now, here: on this commit, with this message (not one another tool made meanwhile).
    const ours =
      !!hash &&
      hash !== before &&
      (await git(cwd, ['rev-parse', '-q', '--verify', `${hash}^1`], [0, 1])).trim() === head.split(' ')[1] &&
      (await git(cwd, ['log', '-1', '--format=%s', hash])).includes(stash)
    if (!ours) {
      await checkoutNow(cwd, target) // nothing was stashed (the changes were already gone)
      return { status: 'applied' }
    }
    const pop = async (index: boolean): Promise<void> =>
      void (await git(cwd, ['stash', 'pop', ...(index ? ['--index'] : []), await currentStash(cwd, 'stash@{0}', hash)]))
    try {
      await checkoutNow(cwd, target)
    } catch (err) {
      // A hook that fails after the switch (post-checkout) doesn't undo it: carry on as switched.
      if ((await where()) === head) {
        // Nothing moved, so the changes go straight back, staged as they were.
        await pop(true).catch(() => {
          throw new Error(`${(err as Error).message}\n\nYour changes are kept in the stash “${stash}”.`)
        })
        throw err
      }
    }
    // Untracked files the branch has too: git would put back the rest and then stop on those, half
    // done, so nothing is put back (all of it is still in the stash).
    const untracked = (await git(cwd, ['rev-parse', '-q', '--verify', `${hash}^3`], [0, 1])).trim()
    if (untracked) {
      const there = (await git(cwd, ['ls-tree', '-r', '-z', '--name-only', untracked]))
        .split('\0')
        .filter((f) => f && existsSync(join(cwd, f)))
      if (there.length) {
        const which = there.length === 1 ? there[0] : `${there.length} of your new files (${there.slice(0, 3).join(', ')}${there.length > 3 ? '…' : ''})`
        return { status: 'kept', stash, reason: `${description} has its own ${which}, and git won't put yours over ${there.length === 1 ? 'it' : 'them'}.` }
      }
    }
    // Staged as they were if that still applies, else all as unstaged changes. A pop that conflicts
    // leaves the conflicts marked and keeps the stash; one that can't start changes nothing.
    let reason = ''
    for (const index of [true, false]) {
      try {
        await pop(index)
        return { status: 'applied' }
      } catch (err) {
        reason = (err as Error).message
        const conflicts = (await git(cwd, ['diff', '--name-only', '--diff-filter=U', '-z'])).split('\0').filter(Boolean)
        if (conflicts.length) return { status: 'conflicts', files: conflicts, stash }
      }
    }
    return { status: 'kept', stash, reason }
  })
}

/** A new branch at `base` (a local or remote branch), not tracking it: it gets its own upstream on first push. */
export async function createBranch(cwd: string, name: string, base: string): Promise<void> {
  await assertBranchName(cwd, name)
  assertArg(base, 'base branch')
  await exclusive(cwd, () => git(cwd, ['branch', '--no-track', name, base]))
}

// ---------- MainLib releases ----------

/** Where the MainLib repository keeps its version (a Unity resource the library reads at runtime). */
const MAINLIB_VERSION_FILE = 'Version/Resources/mainlib-version.txt'

/**
 * Branches checked out here, newest first and once each, from git's own record of HEAD (so checkouts
 * made outside Spoon count too): each switch's branch and the one it left, and the branch a rebase
 * returned to. The caller keeps the names that are branches (a detached checkout names a commit).
 */
export async function recentCheckouts(cwd: string): Promise<string[]> {
  const out = await git(cwd, ['reflog', 'show', '--format=%gs', '-n', '3000', 'HEAD', '--']).catch(() => '')
  const names: string[] = []
  const add = (n: string): void => void (!names.includes(n) && names.push(n))
  for (const line of out.split('\n')) {
    const m = /^checkout: moving from (.+) to (.+)$/.exec(line.trim())
    if (m) {
      add(m[2])
      add(m[1])
    }
    const r = /^rebase(?: -i)? \(finish\): returning to refs\/heads\/(.+)$/.exec(line.trim())
    if (r) add(r[1])
    if (names.length >= 40) break
  }
  return names
}

/** The version a MainLib version file's text says: its first line, without a BOM. */
const versionIn = (text: string): string => text.replace(/^\uFEFF/, '').split(/\r?\n/)[0].trim()

/**
 * The MainLib version in a repository that is MainLib (has its version file), or null: in the
 * working copy, or as `at` (a branch) has it.
 */
export async function mainlibVersion(cwd: string, at?: string): Promise<string | null> {
  if (at) {
    assertArg(at, 'branch')
    const text = await git(cwd, ['show', `${at}:${MAINLIB_VERSION_FILE}`]).catch(() => null)
    return text === null ? null : versionIn(text)
  }
  const text = await readFile(join(cwd, MAINLIB_VERSION_FILE), 'utf8').catch(() => null)
  return text === null ? null : versionIn(text)
}

/**
 * What kind of release repository this is, by the version file it keeps, and so what a new candidate
 * bumps: MainLibCore's package.json "version", MainLib's mainlib-version.txt or HGT's hgt-version.txt.
 * Read from `at` (a branch) when given, else from the checked-out commit. Null for any other repository.
 */
export async function candidateInfo(cwd: string, at?: string): Promise<CandidateInfo | null> {
  if (at) assertArg(at, 'branch')
  const rev = at ?? 'HEAD'
  const show = (file: string): Promise<string | null> => git(cwd, ['show', `${rev}:${file}`]).catch(() => null)
  const pkg = await show('package.json')
  if (pkg !== null) {
    const name = /"name"\s*:\s*"([^"]*)"/.exec(pkg)?.[1] ?? ''
    if (/mainlib\s*core/i.test(name.replace(/[.\-_]/g, ' ')) || /mainlibcore/i.test(name)) {
      const version = /"version"\s*:\s*"([^"]*)"/.exec(pkg)?.[1] ?? null
      return { kind: 'mainlibcore', label: 'MainLibCore', file: 'package.json', version, message: 'bumping version to {version}' }
    }
  }
  const ml = await show(MAINLIB_VERSION_FILE)
  if (ml !== null) return { kind: 'mainlib', label: 'MainLib', file: MAINLIB_VERSION_FILE, version: versionIn(ml), message: 'bumping version to {version}' }
  // HGT keeps it in Version/Resources too; found by name in case it moves.
  const files = await git(cwd, ['ls-tree', '-r', '-z', '--name-only', rev]).catch(() => '')
  const hgt = files.split('\0').find((f) => basename(f).toLowerCase() === 'hgt-version.txt')
  if (hgt) {
    const text = await show(hgt)
    return { kind: 'hgt', label: 'Home Game Toolkit', file: hgt, version: text === null ? null : versionIn(text), message: 'bump version' }
  }
  return null
}

/** The version file's text with its version set to `version` (formatting, BOM, line endings and anything else kept). */
function withVersion(kind: CandidateInfo['kind'], text: string, version: string): string {
  if (kind === 'mainlibcore') {
    if (!/"version"\s*:\s*"[^"]*"/.test(text)) throw new Error('package.json has no "version".')
    return text.replace(/("version"\s*:\s*")[^"]*(")/, `$1${version}$2`)
  }
  const bom = text.startsWith('\uFEFF') ? '\uFEFF' : ''
  const [first, ...rest] = text.slice(bom.length).split(/(?<=\n)/)
  const ending = /\r\n$/.test(first) ? '\r\n' : /\n$/.test(first) ? '\n' : ''
  return bom + version + ending + rest.join('')
}

/**
 * A new candidate with its version bumped, as one step under the repository's lock: the branch made
 * from `base` and switched to, the version file set to `version` and committed alone (MainLibCore and
 * MainLib: "bumping version to <version>"; HGT: "bump version"). If any of it fails, what was done is
 * undone (back on the branch you were on, the new branch gone).
 */
export async function createCandidate(cwd: string, name: string, base: string, version: string): Promise<void> {
  if (!/^\d+(\.\d+){1,3}([-.][0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`Not a version: ${version}`)
  await assertBranchName(cwd, name)
  assertArg(base, 'base branch')
  await exclusive(cwd, async () => {
    // Your changes would be carried onto the candidate (or be in the way): it starts clean.
    if ((await git(cwd, ['status', '--porcelain', '--untracked-files=no'])).trim())
      throw new Error('You have uncommitted changes. Commit or stash them first, or make the branch without bumping the version.')
    const info = await candidateInfo(cwd, base)
    const shown = base.replace(/^refs\/(heads|remotes|tags)\//, '')
    if (!info) throw new Error(`${shown} has no version file (package.json, mainlib-version.txt or hgt-version.txt) to bump.`)
    if (info.version === version) throw new Error(`${shown} is already at ${version}: there’s nothing to bump.`)
    const back = (await git(cwd, ['symbolic-ref', '-q', '--short', 'HEAD'], [0, 1])).trim() || (await git(cwd, ['rev-parse', 'HEAD'])).trim()
    await git(cwd, ['switch', '--no-track', '-c', name, base])
    try {
      // Written only as a plain file inside the repository (never through a link).
      const file = await realRepoFile(cwd, info.file)
      if (!(await lstat(file)).isFile()) throw new Error(`${info.file} isn’t a plain file.`)
      await writeFile(file, withVersion(info.kind, await readFile(file, 'utf8'), version))
      // --only: whatever else is staged stays out of this commit.
      await run(cwd, ['commit', '-F', '-', '--only', '--', info.file], { input: info.message.replace('{version}', version) })
    } catch (err) {
      await git(cwd, ['checkout', '-f', '--', info.file]).catch(() => undefined)
      await git(cwd, ['switch', ...(/^[0-9a-f]{40}$/.test(back) ? ['--detach'] : []), back]).catch(() => undefined)
      await git(cwd, ['branch', '-D', name]).catch(() => undefined)
      throw err
    }
  })
}

/** git's user.name for the repository (its own config, else the global one), or "". */
export async function userName(cwd: string): Promise<string> {
  return (await git(cwd, ['config', '--get', 'user.name'], [0, 1])).trim()
}

// ---------- network ----------

/** Current branch and where it pulls from / pushes to, for the Pull and Push dialogs. */
export async function syncInfo(cwd: string): Promise<SyncInfo> {
  const branch = (await git(cwd, ['symbolic-ref', '-q', '--short', 'HEAD'], [0, 1])).trim() || null
  const remotes = (await git(cwd, ['remote'])).split('\n').filter(Boolean)
  if (!branch) return { branch, remotes, upstreamRemote: null, upstreamBranch: null }
  const cfg = async (key: string): Promise<string | null> =>
    (await git(cwd, ['config', '--get', key], [0, 1])).trim() || null
  const upstreamRemote = await cfg(`branch.${branch}.remote`)
  const merge = await cfg(`branch.${branch}.merge`)
  return {
    branch,
    remotes,
    upstreamRemote,
    upstreamBranch: merge ? merge.replace(/^refs\/heads\//, '') : null
  }
}

/** The outermost repository this one is a submodule of (itself when it isn't one). */
async function topRepository(cwd: string): Promise<string> {
  let dir = resolve(cwd)
  for (let i = 0; i < 20; i++) {
    const up = (await git(dir, ['rev-parse', '--show-superproject-working-tree'], [0, 128]).catch(() => '')).trim()
    if (!up) return dir
    dir = up
  }
  return dir
}

/**
 * Fetches the whole project: from its outermost repository down through every submodule downloaded
 * here (nested ones too), whichever of them it's started from. git on its own fetches a submodule
 * only when the parent's new commits point it somewhere new.
 */
export async function fetch(cwd: string, prune: boolean, onProgress: (l: string) => void): Promise<void> {
  const top = await topRepository(cwd)
  // Every submodule too, unless fetch.recurseSubmodules says otherwise in your git config (then git's
  // own setting decides).
  const configured = (await git(top, ['config', '--get', 'fetch.recurseSubmodules'], [0, 1]).catch(() => '')).trim().toLowerCase()
  const recurse = !configured || configured === 'true' || configured === 'yes' ? ['--recurse-submodules=yes'] : []
  const args = ['fetch', '--all', '--progress', ...recurse, '--jobs=4', ...(prune ? ['--prune'] : [])]
  // The tab it was started from holds its own lock and Cancel; the outermost one's lock too.
  const now = (): Promise<void> =>
    run(top, args, { onProgress, cancellable: cwd }).then(
      () => undefined,
      async (err) => {
        throw await whichFailed(top, err)
      }
    )
  await exclusive(top, () => (repoKey(top) === repoKey(cwd) ? now() : exclusive(cwd, now)))
}

/** git couldn't reach (or wasn't let into) a repository: no access, unknown host, no network. */
// Network and sign-in failures only: a merge stopped by a locked file ("Permission denied", "unable to
// unlink") isn't a remote that couldn't be reached.
const UNREACHABLE =
  /Could not read from remote repository|Permission denied \((publickey|keyboard-interactive|password)|Permission to \S+ denied|Authentication failed|Repository not found|Could not resolve host|unable to access '[a-z][a-z0-9+.-]*:\/\/|Connection (refused|timed out|closed)|Host key verification failed/i

/**
 * Says which repository a fetch (or pull) couldn't reach: a submodule git was fetching when it
 * failed, or this repository's remote, with the address git used. git's own message names neither.
 */
/** A URL without the user name and password it may carry (https://token@host/…); scp-style git@host:… stays. */
export function withoutCredentials(url: string): string {
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return url
  try {
    const u = new URL(url)
    if (!u.username && !u.password) return url
    // ssh://git@host keeps its (non-secret) user name; a password never shows.
    if (/^ssh:$/i.test(u.protocol) && !u.password) return url
    u.username = ''
    u.password = ''
    return u.toString()
  } catch {
    return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, '$1')
  }
}

async function whichFailed(cwd: string, err: unknown, remote?: string): Promise<unknown> {
  if (!(err instanceof GitError) || !UNREACHABLE.test(err.message)) return err
  const lines = err.stderr.split(/[\r\n]+/)
  const failed = lines.findIndex((l) => UNREACHABLE.test(l))
  // git lists the submodules it couldn't fetch at the end ("Errors during submodule fetch:", then one
  // tab-indented path each). That holds with --jobs, where the "Fetching submodule" lines interleave.
  const listed = lines.findIndex((l) => /^Errors during submodule fetch:/.test(l))
  const failedSubs = listed < 0 ? [] : lines.slice(listed + 1).flatMap((l) => (/^\t/.test(l) && l.trim() ? [l.trim()] : []))
  // Without that list (older git): the last "Fetching submodule <path>" before the error.
  const sub =
    failedSubs[0] ??
    lines
      .slice(0, failed < 0 ? lines.length : failed)
      .flatMap((l) => /^Fetching submodule (.+)$/.exec(l.trim())?.[1] ?? [])
      .pop()
  // Without a user name or password a URL may carry (error dialogs get screenshotted).
  const urlOf = async (dir: string, name: string): Promise<string> =>
    withoutCredentials((await run(dir, ['remote', 'get-url', '--', name], { okCodes: [0, 2, 128] }).catch(() => '')).trim())
  let where: string
  if (sub) {
    const url = await urlOf(join(cwd, sub), 'origin')
    const others = failedSubs.length > 1 ? ` and ${failedSubs.length - 1} other submodule${failedSubs.length > 2 ? 's' : ''} (${failedSubs.slice(1).join(', ')})` : ''
    where = `the submodule ${sub}${url ? ` (${url})` : ''}${others}`
  } else {
    // With several remotes git says "Fetching <remote>" before each.
    const name =
      remote ??
      lines
        .slice(0, failed < 0 ? lines.length : failed)
        .flatMap((l) => /^Fetching (\S+)$/.exec(l.trim())?.[1] ?? [])
        .pop() ??
      (await git(cwd, ['remote']).catch(() => '')).split('\n').filter(Boolean)[0]
    const url = name ? await urlOf(cwd, name) : ''
    where = `${basename(cwd)}${name ? ` from ${name}` : ''}${url ? ` (${url})` : ''}`
  }
  // What came down before it failed isn't part of the problem.
  const said = err.message
    .split('\n')
    .filter((l) => !/^(remote: |From |Fetching submodule |\s+[0-9a-f]{7,}\.\.[0-9a-f]{7,}\s| [*+-] \[)/.test(l))
    .join('\n')
  // The project itself (and the other submodules) still fetched: only the listed ones didn't.
  const rest = failedSubs.length ? `\n\nEverything else was fetched.` : ''
  return new GitError(`Couldn’t reach ${where}:\n\n${said.replace(/\n?Errors during submodule fetch:(\n\t.*)*/, '').trim()}${rest}`, err.code, err.stderr)
}

/**
 * A background fetch (Simple Mode looking for the team's saves): skipped while git work is running
 * in the repository, and run without holding its lock, so a save or commit never waits for the
 * network. It only updates remote-tracking refs (no prune, no maintenance).
 */
export async function fetchQuietly(cwd: string): Promise<void> {
  if (locks.has(repoKey(cwd))) return
  // No FETCH_HEAD (a pull running meanwhile reads it), no pruning (whatever fetch.prune says), no
  // submodules: it only brings in what the remotes have.
  await run(cwd, [
    '-c', 'maintenance.auto=false', '-c', 'gc.auto=0',
    'fetch', '--all', '--quiet', '--no-write-fetch-head', '--no-prune', '--no-prune-tags', '--no-recurse-submodules'
  ])
}

export function pull(cwd: string, opts: PullOptions, onProgress: (l: string) => void): Promise<void> {
  return exclusive(cwd, () => pullNow(cwd, opts, onProgress))
}

async function pullNow(cwd: string, opts: PullOptions, onProgress: (l: string) => void): Promise<void> {
  const info = await syncInfo(cwd)
  if (!info.branch) throw new Error('HEAD is detached. Check out a branch to pull.')
  if (!info.upstreamRemote || !info.upstreamBranch)
    throw new Error(`Branch "${info.branch}" has no upstream. Push it first to create one.`)
  const args = ['pull', '--progress', opts.rebase ? '--rebase' : '--no-rebase']
  if (!opts.rebase) args.push('--no-edit')
  if (opts.autostash) args.push('--autostash')
  // Submodules whose commits the pull brings in are fetched with it: several at a time.
  await run(cwd, ['-c', 'submodule.fetchJobs=4', ...args, '--', info.upstreamRemote, info.upstreamBranch], { onProgress, cancellable: true }).catch(async (err) => {
    throw await whichFailed(cwd, err, info.upstreamRemote!)
  })
}

export function push(cwd: string, opts: PushOptions, onProgress: (l: string) => void): Promise<void> {
  return exclusive(cwd, () => pushNow(cwd, opts, onProgress))
}

async function pushNow(cwd: string, opts: PushOptions, onProgress: (l: string) => void): Promise<void> {
  const info = await syncInfo(cwd)
  const branch = opts.branch ?? info.branch
  if (!branch) throw new Error('HEAD is detached. Check out a branch to push.')
  if (opts.branch) await assertBranchName(cwd, opts.branch)
  await assertRemote(cwd, opts.remote)
  await assertBranchName(cwd, opts.remoteBranch, 'remote branch name')
  const args = ['push', '--progress']
  if (opts.setUpstream) args.push('-u')
  if (opts.tags) args.push('--tags')
  // The lease alone passes once a fetch has updated the remote-tracking branch; --force-if-includes
  // also refuses when the remote has commits that were never part of this branch.
  if (opts.force) args.push('--force-with-lease', '--force-if-includes')
  await run(cwd, [...args, opts.remote, `refs/heads/${branch}:refs/heads/${opts.remoteBranch}`], {
    onProgress,
    cancellable: true
  })
}

async function hasCommit(cwd: string, hash: string): Promise<boolean> {
  try {
    await git(cwd, ['cat-file', '-e', `${hash}^{commit}`])
    return true
  } catch {
    return false
  }
}

async function shortLog(cwd: string, args: string[], limit = 6): Promise<{ list: ShortCommit[]; count: number }> {
  const [out, count] = await Promise.all([
    git(cwd, ['log', `-${limit}`, `--format=%H${FS}%s`, ...args, '--']),
    git(cwd, ['rev-list', '--count', ...args, '--'])
  ])
  const list = out
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [hash, subject] = l.split(FS)
      return { hash, subject }
    })
  return { list, count: Number(count.trim()) || 0 }
}

/** Where the parent records a submodule: the index if the pointer is staged, else HEAD. */
async function recordedCommit(cwd: string, submodulePath: string): Promise<string> {
  const line = (await git(cwd, ['ls-files', '-s', '--', submodulePath])).trim()
  const [mode, hash] = line.split(/\s+/)
  if (mode !== '160000' || !hash || line.includes('\n')) throw new Error(`${submodulePath} isn’t a submodule of this repository.`)
  return hash
}

export async function submoduleUpdatePreview(cwd: string, submodulePath: string): Promise<SubmoduleUpdatePreview> {
  const dir = join(cwd, submodulePath)
  const recorded = await recordedCommit(cwd, submodulePath)
  const [head, headSubject, branchOut, status] = await Promise.all([
    git(dir, ['rev-parse', 'HEAD']).then((s) => s.trim()),
    git(dir, ['log', '-1', '--format=%s']).then((s) => s.trim()),
    git(dir, ['symbolic-ref', '-q', '--short', 'HEAD'], [0, 1]),
    git(dir, ['status', '--porcelain', '--untracked-files=no'])
  ])
  const branch = branchOut.trim() || null
  const dirtyFiles = status.split('\n').filter(Boolean).length
  const needsFetch = !(await hasCommit(dir, recorded))
  const none = { list: [] as ShortCommit[], count: 0 }
  const [ahead, behind, subject, landing, orphaned] = await Promise.all([
    needsFetch ? none : shortLog(dir, [head, '--not', recorded]),
    needsFetch ? none : shortLog(dir, [recorded, '--not', head]),
    needsFetch ? '' : git(dir, ['log', '-1', '--format=%s', recorded]),
    needsFetch ? '' : git(dir, ['for-each-ref', '--points-at', recorded, '--format=%(refname:short)', 'refs/heads']),
    branch ? none : shortLog(dir, [head, '--not', '--branches', '--remotes', '--tags'])
  ])
  const landingBranches = landing.split('\n').filter(Boolean)
  return {
    branch,
    head,
    headSubject,
    recorded,
    needsFetch,
    ahead: ahead.list,
    aheadCount: ahead.count,
    behind: behind.list,
    behindCount: behind.count,
    recordedSubject: subject.trim() || null,
    fastForward: !!branch && !needsFetch && ahead.count === 0 && behind.count > 0,
    landingBranch: landingBranches.includes(branch ?? '') ? null : (landingBranches[0] ?? null),
    orphaned: orphaned.list,
    dirtyFiles
  }
}

/**
 * Brings a submodule to the commit the parent records. A branch that's simply behind is
 * fast-forwarded (so it stays checked out), and a local branch already at that commit is switched
 * to; only otherwise does it fall back to `git submodule update`, which checks the commit out directly.
 */
export function updateSubmodule(cwd: string, submodulePath: string, backupBranch?: string): Promise<void> {
  return exclusive(cwd, async () => {
    await downloadDone(cwd)
    return updateSubmoduleNow(cwd, submodulePath, backupBranch)
  })
}

async function updateSubmoduleNow(cwd: string, submodulePath: string, backupBranch?: string): Promise<void> {
  // Also proves the path is a submodule of this repo before any git runs inside it.
  const recorded = await recordedCommit(cwd, submodulePath)
  const dir = join(cwd, submodulePath)
  const nested = (): Promise<string> =>
    run(cwd, ['submodule', 'update', '--init', '--recursive', '--progress', SUBMODULE_JOBS, '--', submodulePath], { cancellable: true })
  if (!existsSync(join(dir, '.git'))) {
    await nested()
    return
  }
  if (backupBranch) {
    await assertBranchName(dir, backupBranch)
    await git(dir, ['branch', '--', backupBranch, 'HEAD'])
  }
  if (!(await hasCommit(dir, recorded))) await run(dir, ['fetch', '--all', '--quiet'], { cancellable: cwd })
  if (await hasCommit(dir, recorded)) {
    const preview = await submoduleUpdatePreview(cwd, submodulePath)
    if (preview.fastForward) await git(dir, ['merge', '--ff-only', '--quiet', recorded])
    else if (preview.landingBranch) await git(dir, ['switch', '--quiet', preview.landingBranch])
  }
  // Checks out the recorded commit if the steps above didn't get there, and updates nested submodules.
  await nested()
}

// ---------- branch cleanup ----------

/**
 * Moves local branches that are only behind their upstream up to it, without checking them out, in
 * one transaction (all of them or none). Branches that can't move (no upstream, commits of their own,
 * checked out) are left alone and named in the error afterwards.
 */
export function fastForwardBranches(cwd: string, names: string[]): Promise<void> {
  return exclusive(cwd, async () => {
    names.forEach((n) => assertArg(n, 'branch'))
    const head = (await git(cwd, ['symbolic-ref', '-q', '--short', 'HEAD'], [0, 1])).trim()
    const updates: string[] = []
    const skipped: string[] = []
    for (const n of names) {
      const tip = (await git(cwd, ['rev-parse', '-q', '--verify', `refs/heads/${n}`], [0, 1])).trim()
      const up = (await git(cwd, ['rev-parse', '-q', '--verify', `${n}@{upstream}`], [0, 1, 128])).trim()
      if (n === head) skipped.push(`${n} (checked out)`)
      else if (!tip || !up) skipped.push(`${n} (no upstream)`)
      else if (tip === up) continue
      // Only behind: its tip is where the two meet.
      else if ((await git(cwd, ['merge-base', tip, up], [0, 1])).trim() !== tip) skipped.push(`${n} (has commits of its own)`)
      else updates.push(`update refs/heads/${n} ${up} ${tip}`)
    }
    if (updates.length) await run(cwd, ['update-ref', '--stdin'], { input: `start\n${updates.join('\n')}\nprepare\ncommit\n` })
    if (skipped.length) throw new Error(`Not fast-forwarded: ${skipped.join(', ')}.${updates.length ? ' The others were.' : ''}`)
  })
}

/**
 * Deletes local branches. Without force, a branch is only deleted when its tip is also reachable
 * from another branch, remote branch or tag, so no commits are lost; the rest are reported back
 * so the UI can ask before forcing.
 */
export function deleteBranches(cwd: string, names: string[], force: boolean): Promise<DeleteResult> {
  return exclusive(cwd, async () => {
    const deleted: string[] = []
    const unmerged: string[] = []
    for (const name of names) {
      try {
        assertArg(name, 'branch')
        const ref = `refs/heads/${name}`
        if (!force) {
          const containing = (
            await git(cwd, ['for-each-ref', '--format=%(refname)', `--contains=${ref}`, 'refs/heads', 'refs/remotes', 'refs/tags'])
          )
            .split('\n')
            .filter((r) => r && r !== ref && !r.endsWith('/HEAD'))
          if (containing.length === 0) {
            unmerged.push(name)
            continue
          }
        }
        await git(cwd, ['branch', '-D', '--', name])
        deleted.push(name)
      } catch (err) {
        // Say which ones are already gone, so a failure halfway doesn't hide them.
        const done = deleted.length ? `\n\nAlready deleted: ${deleted.join(', ')}` : ''
        throw new Error(`${name}: ${(err as Error).message}${done}`)
      }
    }
    return { deleted, unmerged }
  })
}

/** For each path: the parent repo when it's a submodule, else null. Used to label tabs. */
export async function superprojects(paths: string[]): Promise<(string | null)[]> {
  return Promise.all(
    paths.map(async (p) => {
      try {
        return (await git(p, ['rev-parse', '--show-superproject-working-tree'])).trim() || null
      } catch {
        return null // missing folder or not a repo
      }
    })
  )
}

// ---------- remotes ----------

export async function remoteUrls(cwd: string): Promise<Record<string, string>> {
  const out = await git(cwd, ['remote', '-v'])
  const urls: Record<string, string> = {}
  for (const line of out.split('\n')) {
    const m = /^(\S+)\s+(\S+)\s+\(fetch\)$/.exec(line)
    if (m) urls[m[1]] = m[2]
  }
  return urls
}

async function isAncestor(cwd: string, a: string, b: string): Promise<boolean> {
  try {
    await git(cwd, ['merge-base', '--is-ancestor', a, b])
    return true
  } catch {
    return false
  }
}

/**
 * Fetches `source` from `remote` and checks it out as the local branch `local`: created there if
 * it doesn't exist, fast-forwarded if it's only behind, and otherwise checked out as it is, so
 * commits of your own on it are never thrown away. With `tracking` ("origin/feature"), the fetch
 * updates that remote-tracking branch and a new local branch tracks it.
 */
export function fetchAndCheckout(cwd: string, remote: string, source: string, local: string, tracking?: string): Promise<void> {
  return exclusive(cwd, async () => {
    await assertRemote(cwd, remote)
    assertArg(source, 'ref')
    await assertBranchName(cwd, local)
    if (tracking) await assertBranchName(cwd, tracking, 'remote branch')
    await run(cwd, ['fetch', '--', remote, tracking ? `+${source}:refs/remotes/${tracking}` : source], { cancellable: true })
    const start = tracking ? `refs/remotes/${tracking}` : 'FETCH_HEAD'
    const target = (await git(cwd, ['rev-parse', '--verify', `${start}^{commit}`])).trim()
    const tip = (await git(cwd, ['rev-parse', '-q', '--verify', `refs/heads/${local}`], [0, 1])).trim()
    if (!tip) {
      await git(cwd, ['switch', '-c', local, ...(tracking ? ['--track', start] : [target])])
      return
    }
    const current = (await git(cwd, ['symbolic-ref', '-q', '--short', 'HEAD'], [0, 1])).trim()
    const behind = tip !== target && (await isAncestor(cwd, tip, target))
    if (behind && current === local) await git(cwd, ['merge', '--ff-only', '--quiet', target])
    else if (behind) await git(cwd, ['branch', '-f', '--', local, target])
    if (current !== local) await git(cwd, ['switch', local])
  })
}

/** Deletes a branch on a remote (git push <remote> --delete <branch>). */
// ---------- tags ----------

/**
 * The branches a commit is on, for checking where a new tag goes: nearest first, with how many
 * commits each branch's tip is past it (0 = the commit is the tip).
 */
export async function tagTarget(cwd: string, hash: string): Promise<TagTarget> {
  assertHash(hash)
  const refs = (await git(cwd, ['for-each-ref', '--format=%(refname)', `--contains=${hash}`, 'refs/heads', 'refs/remotes']))
    .split('\n')
    .filter((r) => r && !r.endsWith('/HEAD'))
  // Every local branch, but only the first remote branches: an old commit is on nearly all of them.
  const local = refs.filter((r) => r.startsWith('refs/heads/'))
  const checked = [...local, ...refs.filter((r) => r.startsWith('refs/remotes/')).slice(0, 30)]
  const branches = await mapLimit(checked, 8, async (ref) => ({
    name: ref.replace(/^refs\/(heads|remotes)\//, ''),
    remote: ref.startsWith('refs/remotes/'),
    ahead: Number((await git(cwd, ['rev-list', '--count', `${hash}..${ref}`])).trim())
  }))
  branches.sort((a, b) => a.ahead - b.ahead || Number(a.remote) - Number(b.remote))
  return { branches, total: refs.length }
}

/** Creates a tag on a commit (annotated when there's a message), and pushes it when a remote is given. */
export function createTag(cwd: string, opts: NewTagOptions): Promise<void> {
  return exclusive(cwd, async () => {
    assertHash(opts.hash)
    assertArg(opts.name, 'tag name')
    try {
      await git(cwd, ['check-ref-format', `refs/tags/${opts.name}`])
    } catch {
      throw new Error(`“${opts.name}” isn’t a valid tag name.`)
    }
    if (opts.remote) await assertRemote(cwd, opts.remote)
    const message = opts.message?.trim()
    await git(cwd, ['tag', ...(message ? ['-a', '-m', message] : []), opts.name, opts.hash])
    if (opts.remote) await run(cwd, ['push', opts.remote, `refs/tags/${opts.name}`], { cancellable: true })
  })
}

export function deleteRemoteBranch(cwd: string, remote: string, branch: string): Promise<void> {
  return exclusive(cwd, async () => {
    await assertRemote(cwd, remote)
    assertArg(branch, 'remote branch')
    await run(cwd, ['push', remote, '--delete', branch], { cancellable: true })
  })
}

// ---------- rebase ----------

function readRebaseProgress(gitDir: string): RebaseProgress | null {
  const dir = join(gitDir, 'rebase-merge')
  if (!existsSync(dir)) return null
  const read = (f: string): string => {
    try {
      return readFileSync(join(dir, f), 'utf8').trim()
    } catch {
      return ''
    }
  }
  // The last line of "done" is the step it stopped on: "edit <hash> <subject>", "pick ...", ...
  const last = read('done').split('\n').filter((l) => l && !l.startsWith('#')).pop() ?? ''
  // Newer git writes "pick <hash> # <subject>".
  const m = /^(\w+)\s+[0-9a-f]+\s*(?:#\s*)?(.*)$/.exec(last)
  return {
    branch: read('head-name').replace(/^refs\/heads\//, '') || null,
    onto: read('onto'),
    step: Number(read('msgnum')) || 0,
    total: Number(read('end')) || 0,
    stoppedAction: m?.[1] ?? null,
    stoppedSubject: m?.[2] || null
  }
}

async function gitDirOf(cwd: string): Promise<string> {
  return (await git(cwd, ['rev-parse', '--absolute-git-dir'])).trim()
}

/** Messages for reworded commits live in the git dir while the rebase runs (it can stop and resume). */
const scratchDir = (gitDir: string): string => join(gitDir, 'spoon-rebase')

async function rebaseOutcome(cwd: string, attempt: Promise<unknown>): Promise<RebaseResult> {
  const gitDir = await gitDirOf(cwd)
  const inProgress = (): boolean => existsSync(join(gitDir, 'rebase-merge')) || existsSync(join(gitDir, 'rebase-apply'))
  try {
    await attempt
  } catch (err) {
    // Stopping on a conflict is part of rebasing, not a failure.
    if (!inProgress()) throw err
  }
  const done = !inProgress()
  if (done) rmSync(scratchDir(gitDir), { recursive: true, force: true })
  return { done }
}

/** The commits a rebase of HEAD onto `onto` would replay (the same ones git would put in its todo). */
export async function rebasePlan(cwd: string, onto: string): Promise<RebasePlan> {
  assertArg(onto, 'branch')
  const range = `${onto}...HEAD`
  const out = await git(cwd, [
    'log',
    '--cherry-pick',
    '--right-only',
    '--no-merges',
    `--format=%H${FS}%s${FS}%b${FS}%an${FS}%at${RS}`,
    range,
    '--'
  ])
  const commits: RebaseCommit[] = out
    .split(RS)
    .map((r) => r.replace(/^\n/, ''))
    .filter(Boolean)
    .map((r) => {
      const [hash, subject, body, authorName, at] = r.split(FS)
      return { hash, subject, body: body.trim(), authorName, authorTime: Number(at) }
    })
  const merges = Number((await git(cwd, ['rev-list', '--count', '--merges', `${onto}..HEAD`, '--'])).trim()) || 0
  const oldest = commits[commits.length - 1]?.hash
  const pushed = oldest
    ? !!(await git(cwd, ['for-each-ref', '--count=1', '--contains', oldest, 'refs/remotes'])).trim()
    : false
  return { commits, merges, pushed }
}

export async function rebase(cwd: string, onto: string): Promise<RebaseResult> {
  assertArg(onto, 'branch')
  return exclusive(cwd, () => rebaseOutcome(cwd, git(cwd, ['rebase', '--autostash', onto])))
}

const ACTIONS: RebaseAction[] = ['pick', 'reword', 'edit', 'squash', 'fixup', 'drop']

/** Runs `git rebase -i` with our own todo list in place of the one git would open in an editor. */
export async function rebaseInteractive(cwd: string, onto: string, steps: RebaseStep[]): Promise<RebaseResult> {
  assertArg(onto, 'branch')
  return exclusive(cwd, () => rebaseInteractiveNow(cwd, onto, steps))
}

async function rebaseInteractiveNow(cwd: string, onto: string, steps: RebaseStep[]): Promise<RebaseResult> {
  for (const s of steps) {
    assertHash(s.hash)
    if (!ACTIONS.includes(s.action)) throw new Error(`Unknown rebase action: ${s.action}`)
  }
  const first = steps.find((s) => s.action !== 'drop')
  if (first && (first.action === 'squash' || first.action === 'fixup'))
    throw new Error('The oldest commit can’t be squashed: there’s nothing below it to squash into.')

  const gitDir = await gitDirOf(cwd)
  const dir = scratchDir(gitDir)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  // Forward slashes and single quotes keep the paths intact for git's shell on every platform.
  const shPath = (p: string): string => `'${p.replace(/\\/g, '/').replace(/'/g, `'\\''`)}'`

  const lines: string[] = []
  steps.forEach((s, i) => {
    if (s.action === 'reword' && s.message?.trim()) {
      const file = join(dir, `message-${i}.txt`)
      writeFileSync(file, s.message.trim() + '\n')
      lines.push(`pick ${s.hash}`, `exec git commit --amend --allow-empty --no-verify --cleanup=whitespace -F ${shPath(file)}`)
    } else {
      lines.push(`${s.action === 'reword' ? 'pick' : s.action} ${s.hash}`)
    }
  })
  const todo = join(dir, 'todo')
  writeFileSync(todo, lines.join('\n') + '\n')

  return rebaseOutcome(
    cwd,
    run(cwd, ['rebase', '-i', '--autostash', onto], {
      // git opens its todo with this "editor": copying ours over it is the whole edit.
      env: { GIT_SEQUENCE_EDITOR: `cp ${shPath(todo)}` }
    })
  )
}

export async function rebaseContinue(cwd: string, action: 'continue' | 'skip' | 'abort'): Promise<RebaseResult> {
  if (!['continue', 'skip', 'abort'].includes(action)) throw new Error(`Unknown rebase action: ${action}`)
  return exclusive(cwd, () => rebaseOutcome(cwd, git(cwd, ['rebase', `--${action}`])))
}

// ---------- merge ----------

/** What merging `from` into the checked-out branch would do. */
export async function mergePlan(cwd: string, from: string): Promise<MergePlan> {
  assertArg(from, 'branch')
  const count = async (range: string): Promise<number> =>
    Number((await git(cwd, ['rev-list', '--count', range, '--'])).trim()) || 0
  const commits = await count(`HEAD..${from}`)
  const ours = await count(`${from}..HEAD`)
  return { commits, fastForward: commits > 0 && ours === 0 }
}

/**
 * What a Unity project's build command needs, read from a branch (not the checked-out files, so a
 * branch that's only on the remote reports its own versions): the editor version, the app version and
 * each CoreConfiguration's GameShortCode (the active company's first, then iOS before Android).
 */
export async function unityBuildInfo(cwd: string, ref: string): Promise<UnityBuildInfo> {
  assertArg(ref, 'branch')
  const show = async (file: string): Promise<string> => {
    const { out, truncated } = await exec(cwd, ['show', `${ref}:${file}`, '--'], { okCodes: [0, 128], maxBytes: 4 * 1024 * 1024 })
    return truncated ? '' : out
  }
  const field = (text: string, name: string): string | null =>
    text.match(new RegExp(`^\\s*${name}:[ \\t]*(.*?)\\s*$`, 'm'))?.[1].replace(/^(['"])(.*)\1$/, '$2') || null
  const [version, settings, company, tree] = await Promise.all([
    show('ProjectSettings/ProjectVersion.txt'),
    show('ProjectSettings/ProjectSettings.asset'),
    show('Assets/Configurations/ActiveCompany.asset'),
    exec(cwd, ['ls-tree', '-r', '-z', '--name-only', ref, '--', 'Assets'], { okCodes: [0, 128], maxBytes: 64 * 1024 * 1024 })
  ])
  const active = field(company, 'companyName')
  const files = tree.out.split('\0').filter((f) => /(^|\/)CoreConfiguration\.asset$/.test(f))
  const found = await mapLimit(files.slice(0, 20), 4, async (path) => {
    const code = field(await show(path), 'GameShortCode')
    const platform = /(^|\/)iOS\//i.test(path) ? 'iOS' : /(^|\/)Android\//i.test(path) ? 'Android' : ''
    return code ? { code, platform, path } : null
  })
  const rank = (c: { platform: string; path: string }): number =>
    (active && c.path.split('/').includes(active) ? 0 : 4) + (c.platform === 'iOS' ? 0 : c.platform === 'Android' ? 1 : 2)
  const codes = found
    .filter((c) => !!c)
    .sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path))
    .filter((c, i, all) => all.findIndex((x) => x.code.toLowerCase() === c.code.toLowerCase()) === i)
  return { unityVersion: field(version, 'm_EditorVersion'), bundleVersion: field(settings, 'bundleVersion'), codes }
}

/** git's message when putting the autostashed changes back hit conflicts (they stay in the stash). */
function autostashNote(stderr: string): string | undefined {
  if (!/stash/i.test(stderr) || !/conflict/i.test(stderr)) return undefined
  const lines = stderr.split('\n').map((l) => l.trim())
  const from = lines.findIndex((l) => /autostash|local changes are stashed/i.test(l) && !/^Created autostash/i.test(l))
  return lines.slice(from < 0 ? 0 : from).filter(Boolean).join(' ')
}

/**
 * Runs a merge step. Stopping on conflicts is part of merging, so `merge` failing with unmerged paths
 * left behind isn't an error; anything else (a hook saying no, say) is, even with MERGE_HEAD still there.
 */
async function mergeOutcome(cwd: string, args: string[], stopsOnConflicts: boolean): Promise<MergeResult> {
  const gitDir = await gitDirOf(cwd)
  const inProgress = (): boolean => existsSync(join(gitDir, 'MERGE_HEAD'))
  let stderr = ''
  try {
    stderr = (await exec(cwd, args, { env: { GIT_MERGE_AUTOEDIT: 'no' } })).err
  } catch (err) {
    const unmerged = stopsOnConflicts && inProgress() && !!(await git(cwd, ['diff', '--name-only', '--diff-filter=U'])).trim()
    if (!unmerged) throw err
    stderr = err instanceof GitError ? err.stderr : ''
  }
  return { done: !inProgress(), stashNote: autostashNote(stderr) }
}

/**
 * How to name a branch to `git merge` so its message reads as usual ("Merge branch 'feat'"): by its
 * short name when that means the same ref, else by the full one (a tag called the same would win)
 * with git's usual message given.
 */
async function mergeName(cwd: string, from: string): Promise<string[]> {
  const m = /^refs\/(heads|remotes)\/(.+)$/.exec(from)
  if (!m) return [from]
  const short = m[2]
  const means = (await git(cwd, ['rev-parse', '--verify', '--quiet', '--symbolic-full-name', short], [0, 1]).catch(() => '')).trim()
  if (means === from) return [short]
  const head = (await git(cwd, ['symbolic-ref', '-q', '--short', 'HEAD'], [0, 1]).catch(() => '')).trim()
  // Like git's own message: " into <branch>" except into the main line.
  const into = head && !['main', 'master'].includes(head) ? ` into ${head}` : ''
  return ['-m', `Merge ${m[1] === 'heads' ? 'branch' : 'remote-tracking branch'} '${short}'${into}`, from]
}

/** Merges `from` into the checked-out branch; noFastForward always makes a merge commit. */
export async function merge(cwd: string, from: string, noFastForward: boolean): Promise<MergeResult> {
  assertArg(from, 'branch')
  return exclusive(cwd, async () => {
    const what = await mergeName(cwd, from)
    return mergeOutcome(cwd, ['merge', '--no-edit', '--autostash', ...(noFastForward ? ['--no-ff'] : []), ...what], true)
  })
}

/** Finishes a merge that stopped on conflicts (with git's own message), or puts everything back. */
export async function mergeContinue(cwd: string, action: 'continue' | 'abort'): Promise<MergeResult> {
  if (!['continue', 'abort'].includes(action)) throw new Error(`Unknown merge action: ${action}`)
  return exclusive(cwd, () =>
    mergeOutcome(cwd, action === 'abort' ? ['merge', '--abort'] : ['commit', '--no-edit', '--cleanup=strip'], false)
  )
}

/** While a merge is stopped: the first line of git's merge message ("Merge branch 'x' into y"), and
 *  whether uncommitted changes were set aside for it (they come back when it's committed or aborted). */
function readMergeState(gitDir: string): MergeState | null {
  if (!existsSync(join(gitDir, 'MERGE_HEAD'))) return null
  let subject = 'Merge'
  try {
    subject = readFileSync(join(gitDir, 'MERGE_MSG'), 'utf8').split('\n')[0].trim() || subject
  } catch {
    // keep the plain name
  }
  return { subject, autostash: existsSync(join(gitDir, 'MERGE_AUTOSTASH')) }
}

// ---------- pull requests ----------

const INTEGRATION = /^(main|master|develop|development|dev|trunk|staging|production)$|^(release|releases|candidate|candidates|hotfix|hotfixes|support|version|versions)\//i

const PR_TEMPLATES = [
  '.github/pull_request_template.md',
  '.github/PULL_REQUEST_TEMPLATE.md',
  'docs/pull_request_template.md',
  'pull_request_template.md',
  'PULL_REQUEST_TEMPLATE.md'
]

/**
 * Everything the Create Pull Request dialog pre-fills. The base is the branch this one started
 * from: git's own record of how it was created when there is one ("Created from origin/main"),
 * otherwise the remote branch it forked from most recently, otherwise the default branch.
 */
export async function pullDraftInfo(cwd: string, branch: string): Promise<PullDraftInfo> {
  await assertBranchName(cwd, branch)
  const cfg = async (key: string): Promise<string> => (await git(cwd, ['config', '--get', key], [0, 1])).trim()
  const remotes = (await git(cwd, ['remote'])).split('\n').filter(Boolean)
  const upstreamRemote = await cfg(`branch.${branch}.remote`)
  const remote = upstreamRemote || (remotes.includes('origin') ? 'origin' : remotes[0])
  if (!remote) throw new Error('This repository has no remotes.')
  // The PR's head is this branch under its own name. An upstream with a different name (a branch made
  // with `switch -c feature origin/main` tracks main) is where it came from, not where it goes.
  const merge = (await cfg(`branch.${branch}.merge`)).replace(/^refs\/heads\//, '')
  const headRef = branch
  const tracksItself = !!upstreamRemote && upstreamRemote === remote && merge === branch

  const refsOut = await git(cwd, [
    'for-each-ref',
    '--sort=-committerdate',
    '--format=%(refname:short)',
    `refs/remotes/${remote}`
  ])
  const all = refsOut
    .split('\n')
    .filter(Boolean)
    .map((r) => r.slice(remote.length + 1))
    .filter((r) => r && r !== 'HEAD' && r !== headRef && r !== branch)
  const defaultBranch =
    (await git(cwd, ['symbolic-ref', '-q', '--short', `refs/remotes/${remote}/HEAD`], [0, 1])).trim().slice(remote.length + 1) ||
    ['main', 'master', 'develop'].find((b) => all.includes(b)) ||
    all[0] ||
    'main'

  let base = ''
  let baseReason: PullDraftInfo['baseReason'] = 'default'
  // "branch: Created from origin/main" is the oldest reflog entry when it was made with checkout -b / switch -c.
  const created = (await git(cwd, ['reflog', 'show', '--format=%gs', `refs/heads/${branch}`, '--'], [0, 128]))
    .split('\n')
    .filter(Boolean)
    .pop()
  const from = /^branch: Created from (.+)$/.exec(created ?? '')?.[1]?.replace(/^refs\/(remotes|heads)\//, '')
  if (from && from !== 'HEAD') {
    const name = from.startsWith(`${remote}/`) ? from.slice(remote.length + 1) : from
    if (all.includes(name)) {
      base = name
      baseReason = 'created-from'
    }
  }
  if (!base) {
    // The integration branch (default, develop, release/…, candidates/…) whose merge-base with this
    // branch is the fewest commits back. Other feature branches are left out: one that forked from
    // the same place later would always look "nearer" than the branch both really came from.
    // `all` is newest first, so the cap keeps the recently active ones; at most 8 git processes at a
    // time (a Unity library repo can have hundreds of release/candidate branches).
    const integration = all.filter((b) => b === defaultBranch || INTEGRATION.test(b)).slice(0, 30)
    const candidates = [...new Set([defaultBranch, ...integration])].filter((c) => all.includes(c))
    const scored = await mapLimit(candidates, 8, async (c, order) => {
        const mb = (await git(cwd, ['merge-base', branch, `refs/remotes/${remote}/${c}`], [0, 1])).trim()
        if (!mb) return null
        const n = Number((await git(cwd, ['rev-list', '--count', `${mb}..${branch}`])).trim())
        return { c, n, order: c === defaultBranch ? -1 : order }
    })
    const best = scored
      .filter((x): x is { c: string; n: number; order: number } => !!x)
      .sort((a, b) => a.n - b.n || a.order - b.order)[0]
    if (best) {
      base = best.c
      baseReason = best.c === defaultBranch ? 'default' : 'nearest'
    }
  }
  if (!base) base = defaultBranch

  const [log, remoteHead] = await Promise.all([
    git(cwd, ['log', '-50', `--format=%H${FS}%s`, `refs/remotes/${remote}/${base}..${branch}`, '--'], [0, 128]),
    git(cwd, ['rev-parse', '-q', '--verify', `refs/remotes/${remote}/${headRef}`], [0, 1])
  ])
  const commits = log
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [hash, subject] = l.split(FS)
      return { hash, subject }
    })
  const needsPush =
    !remoteHead.trim() ||
    Number((await git(cwd, ['rev-list', '--count', `refs/remotes/${remote}/${headRef}..${branch}`])).trim()) > 0

  let template: string | null = null
  for (const p of PR_TEMPLATES) {
    const t = await git(cwd, ['show', `HEAD:${p}`], [0, 128]).catch(() => '')
    if (t.trim()) {
      template = t.trim()
      break
    }
  }

  const bases = [base, ...all.filter((b) => b !== base)]
  return { branch, remote, headRef, bases, base, baseReason, commits, needsPush, hasUpstream: tracksItself, template }
}

/** Like Promise.all over `items`, running at most `limit` at a time. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

// ---------- MainLib (a submodule with version branches) ----------

/** "4.2.0" and "3.8.0.2" as comparable number lists. */
const versionParts = (v: string): number[] => v.split(/[.\-_]/).map((x) => Number.parseInt(x, 10) || 0)
export function compareVersions(a: string, b: string): number {
  const x = versionParts(a)
  const y = versionParts(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0)
  return 0
}

export async function mainlibState(cwd: string, submodulePath: string, prefix: string): Promise<MainLibState> {
  const dir = join(cwd, submodulePath)
  if (!existsSync(join(dir, '.git'))) throw new Error(`${submodulePath} isn’t checked out. Initialize the submodule first.`)
  if (!/^[\w./-]+$/.test(prefix)) throw new Error(`Invalid branch prefix: ${prefix}`)
  // New version branches only show up after a fetch.
  await exclusive(dir, () => run(dir, ['fetch', '--prune', '--quiet', 'origin'], { cancellable: cwd }))
  const [describe, hash, branch, refs, status, orphanCount] = await Promise.all([
    git(dir, ['describe', '--tags', '--always'], [0, 128]).then((s) => s.trim()),
    git(dir, ['rev-parse', '--short', 'HEAD']).then((s) => s.trim()),
    git(dir, ['symbolic-ref', '-q', '--short', 'HEAD'], [0, 1]).then((s) => s.trim() || null),
    // All of origin's branches, filtered here: for-each-ref only matches whole path segments, so a
    // prefix without a trailing slash ("mainlib-") would match nothing.
    git(dir, ['for-each-ref', `--format=%(refname:short)${FS}%(committerdate:unix)${FS}%(objectname:short)`, 'refs/remotes/origin/']),
    git(dir, ['status', '--porcelain', '--untracked-files=no']),
    orphanedCommits(dir)
  ])
  const versions: MainLibVersion[] = refs
    .split('\n')
    .filter((line) => line.startsWith(`origin/${prefix}`))
    .map((line) => {
      const [ref, date, h] = line.split(FS)
      const name = ref.slice('origin/'.length)
      return { ref, branch: name, version: name.slice(prefix.length), date: Number(date), hash: h }
    })
    .filter((v) => /^\d/.test(v.version))
    .sort((a, b) => compareVersions(b.version, a.version))
  const dirtyFiles = status.split('\n').filter(Boolean).length
  return { path: submodulePath, describe: describe || hash, hash, branch, versions, dirtyFiles, orphaned: orphanCount }
}

/** Commits only a detached HEAD holds: no branch, remote branch or tag has them, so switching away loses them. */
async function orphanedCommits(dir: string): Promise<number> {
  if ((await git(dir, ['symbolic-ref', '-q', 'HEAD'], [0, 1])).trim()) return 0
  return Number((await git(dir, ['rev-list', '--count', 'HEAD', '--not', '--branches', '--remotes', '--tags'])).trim()) || 0
}

/**
 * Checks out a version branch in the submodule: an existing local branch is fast-forwarded to it.
 * Commits that only the current (detached) HEAD holds are kept on a backup branch first, whose name
 * is returned; uncommitted changes are carried over, or git refuses when they'd be overwritten.
 */
export function mainlibSwitch(cwd: string, submodulePath: string, ref: string): Promise<{ backup: string | null }> {
  const dir = join(cwd, submodulePath)
  return exclusive(dir, async () => {
    if (!ref.startsWith('origin/')) throw new Error(`Not a remote branch: ${ref}`)
    const local = ref.slice('origin/'.length)
    await assertBranchName(dir, local)
    let backup: string | null = null
    if ((await orphanedCommits(dir)) > 0) {
      const d = new Date()
      const two = (n: number): string => String(n).padStart(2, '0')
      const short = (await git(dir, ['rev-parse', '--short', 'HEAD'])).trim()
      backup = `spoon-backup/${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}-${short}`
      for (let n = 2; (await git(dir, ['rev-parse', '-q', '--verify', `refs/heads/${backup}`], [0, 1])).trim(); n++)
        backup = `spoon-backup/${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}-${short}-${n}`
      await git(dir, ['branch', '--', backup, 'HEAD'])
    }
    const exists = !!(await git(dir, ['rev-parse', '-q', '--verify', `refs/heads/${local}`], [0, 1])).trim()
    if (exists) {
      await git(dir, ['switch', '--quiet', local])
      await git(dir, ['merge', '--ff-only', '--quiet', `refs/remotes/${ref}`])
    } else {
      await git(dir, ['switch', '--quiet', '-c', local, '--track', `refs/remotes/${ref}`])
    }
    return { backup }
  })
}

// ---------- files (the quick file popup) ----------

const MAX_EDIT_BYTES = 5 * 1024 * 1024

/** A repository file's absolute path; only paths inside the work tree (and outside .git). */
export function repoFile(cwd: string, rel: string): string {
  const root = resolve(cwd)
  const abs = resolve(root, rel)
  if (!insideRel(relative(root, abs))) throw new Error(`Not a file in this repository: ${rel}`)
  return abs
}

/**
 * repoFile, and where it really is: a link (or a linked folder) must lead to a file inside the
 * repository and outside any .git folder, so the popup never reads or writes outside it. Unity
 * export links point into Assets, so they still work. Returns the path as given (writes go through
 * the link, which stays a link).
 */
export async function realRepoFile(cwd: string, rel: string): Promise<string> {
  const abs = repoFile(cwd, rel)
  const root = await realpath(resolve(cwd))
  // A file that doesn't exist (yet, or any more) is checked by its nearest folder that does.
  let real = await realpath(abs).catch(() => null)
  for (let dir = dirname(abs), rest = basename(abs); !real; rest = join(basename(dir), rest), dir = dirname(dir)) {
    const base = await realpath(dir).catch(() => null)
    if (base) real = join(base, rest)
    else if (dirname(dir) === dir) real = abs
  }
  if (!insideRel(relative(root, real)))
    throw new Error(`${rel} leads outside the repository (it’s a link to ${real}).`)
  return abs
}

const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

function contentOf(data: Buffer, size = data.length, mtime = 0): FileContent {
  const binary = data.subarray(0, 8000).includes(0)
  if (binary || size > MAX_EDIT_BYTES) return { text: null, binary, size, eol: 'lf', mtime }
  let text: string
  try {
    // Strict: a file in another encoding (Windows-1252, UTF-16…) would be damaged by saving it as UTF-8.
    text = utf8.decode(data)
  } catch {
    return { text: null, binary: false, notUtf8: true, size, eol: 'lf', mtime }
  }
  // The editor uses \n; saving puts back the ending most lines had. Mixed endings are flagged, since
  // saving makes them all the same.
  const crlf = (text.match(/\r\n/g) ?? []).length
  const lf = (text.match(/\n/g) ?? []).length - crlf
  const cr = (text.match(/\r(?!\n)/g) ?? []).length
  return { text, binary: false, size, eol: crlf > lf ? 'crlf' : 'lf', mixedEol: (crlf > 0 && lf > 0) || cr > 0, mtime }
}

/** The working copy of a file (null text when binary, not UTF-8 or too big to edit here). */
export async function readWorkingFile(cwd: string, rel: string): Promise<FileContent> {
  const abs = await realRepoFile(cwd, rel)
  const info = await stat(abs)
  if (!info.isFile()) throw new Error(`${rel} isn’t a file.`)
  return contentOf(info.size > MAX_EDIT_BYTES ? Buffer.alloc(0) : await readFile(abs), info.size, info.mtimeMs)
}

/**
 * Saves the working copy; `eol` puts back the file's own line endings (the editor uses \n). With
 * `expect` (the save time it was read at), a file changed on disk since isn't overwritten: it fails
 * with "CHANGED_ON_DISK". Resolves to the new save time.
 */
export async function writeWorkingFile(cwd: string, rel: string, text: string, eol: 'lf' | 'crlf', expect?: number): Promise<number> {
  const abs = await realRepoFile(cwd, rel)
  return exclusive(cwd, async () => {
    if (expect !== undefined && (await stat(abs)).mtimeMs !== expect) throw new Error('CHANGED_ON_DISK')
    // Written in place (not a new file renamed over it): a Unity export's link stays a link.
    await writeFile(abs, eol === 'crlf' ? text.replace(/\r?\n/g, '\r\n') : text)
    return (await stat(abs)).mtimeMs
  })
}

/**
 * A file's contents in a commit, as checkout would write them (Git LFS files come back as the file,
 * not the pointer), into `out` (a file path) or as bytes. Falls back to the raw blob when a filter
 * isn't available.
 */
function blobAt(cwd: string, hash: string, rel: string, out?: string): Promise<Buffer> {
  const read = (args: string[]): Promise<Buffer> =>
    new Promise<Buffer>((done, fail) => {
      const chunks: Buffer[] = []
      const child = spawn('git', args, { cwd, env })
      const sink = out ? createWriteStream(out) : null
      if (sink) child.stdout.pipe(sink)
      else child.stdout.on('data', (b: Buffer) => chunks.push(b))
      let err = ''
      child.stderr.on('data', (b: Buffer) => (err += b.toString()))
      child.on('error', fail)
      child.on('close', (code) => {
        const finish = (): void => (code === 0 ? done(Buffer.concat(chunks)) : fail(new Error(err.trim() || `${rel} isn’t in that commit.`)))
        if (sink) sink.end(finish)
        else finish()
      })
    })
  return read(['cat-file', '--filters', `${hash}:${rel}`]).catch(() => read(['cat-file', 'blob', `${hash}:${rel}`]))
}

/** A file as it was in a commit. */
export async function fileAtCommit(cwd: string, hash: string, rel: string): Promise<FileContent> {
  assertHash(hash)
  repoFile(cwd, rel)
  const size = Number((await git(cwd, ['cat-file', '-s', `${hash}:${rel}`])).trim())
  if (size > MAX_EDIT_BYTES) return { text: null, binary: false, size, eol: 'lf' }
  const data = await blobAt(cwd, hash, rel)
  return contentOf(data, data.length)
}

// Where commits' versions of files go for comparing: in Spoon's own data (set at startup), since
// macOS empties the system's temporary folder after a few days and a compare tab may still show one.
let compareRoot: string | null = null
export function setCompareRoot(dir: string): void {
  compareRoot = dir
}

/** A commit's version of a file in a folder of its own, for comparing it with files on disk (streamed, not held in memory). */
export async function fileAtCommitToTemp(cwd: string, hash: string, rel: string): Promise<string> {
  assertHash(hash)
  repoFile(cwd, rel)
  const root = compareRoot ?? tmpdir()
  await mkdir(root, { recursive: true })
  const dir = await mkdtemp(join(root, 'spoon-at-'))
  const out = join(dir, `${hash.slice(0, 7)}-${basename(rel)}`)
  try {
    await blobAt(cwd, hash, rel, out)
  } catch (err) {
    await rm(dir, { recursive: true, force: true })
    throw err
  }
  return out
}

/**
 * Removes Spoon's temporary folders (old versions of files opened or compared, backups on their way
 * to the Trash) left from earlier runs: anything over a day old, so files still open aren't pulled away.
 */
export async function cleanTempFolders(keep: string[] = []): Promise<void> {
  for (const dir of [...new Set([tmpdir(), ...(compareRoot ? [compareRoot] : [])])]) {
    for (const name of await readdir(dir).catch(() => [] as string[])) {
      if (!/^spoon-(at|backup)-/.test(name)) continue
      // A folder a compare tab still shows a file from stays.
      if (keep.some((k) => k.startsWith(join(dir, name) + sep))) continue
      const info = await stat(join(dir, name)).catch(() => null)
      if (info && Date.now() - info.mtimeMs > 86_400_000) await rm(join(dir, name), { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

/** Every file git tracks in a repository and its submodules, relative to it (for Compare's search). */
export async function projectFiles(cwd: string): Promise<string[]> {
  const { out } = await exec(cwd, ['ls-files', '-z', '--recurse-submodules'], { maxBytes: 128 * 1024 * 1024 })
  return out.split('\0').filter(Boolean)
}

/**
 * Files to compare a file with, from the open repository: those with the same name (its submodules'
 * too), the ones whose folders end like the file's first (…/Plugins/Android/AndroidManifest.xml), then
 * the shortest paths; and, for a file that's in a repository itself, its last committed version.
 * Contents aren't read.
 */
export async function compareCandidates(cwd: string, file: string): Promise<CompareCandidates> {
  const root = await realpath(cwd)
  const real = await realpath(file).catch(() => resolve(file))
  const inside = real.startsWith(root + sep) ? relative(root, real).split(sep).join('/') : null
  const name = basename(real).toLowerCase()
  const dirs = (p: string): string[] => p.toLowerCase().split(/[\\/]/).slice(0, -1)
  const myDirs = dirs(real)
  const shared = (rel: string): number => {
    const theirs = dirs(rel)
    let n = 0
    while (n < theirs.length && n < myDirs.length && theirs[theirs.length - 1 - n] === myDirs[myDirs.length - 1 - n]) n++
    return n
  }
  const files = (await projectFiles(root)).filter((rel) => basename(rel).toLowerCase() === name && rel !== inside)
  const candidates: CompareCandidate[] = files
    .map((rel) => ({ rel, shared: shared(rel) }))
    .sort((a, b) => b.shared - a.shared || a.rel.length - b.rel.length || a.rel.localeCompare(b.rel))
    .map(({ rel }) => ({ path: join(root, rel), shown: rel }))

  // A file in a repository (this one or a submodule): its last committed version comes first.
  if (inside) {
    const top = (await git(dirname(real), ['rev-parse', '--show-toplevel']).catch(() => '')).trim()
    const rel = top ? relative(await realpath(top), real).split(sep).join('/') : ''
    const hash = top ? (await git(top, ['rev-parse', '-q', '--verify', 'HEAD'], [0, 1]).catch(() => '')).trim() : ''
    const committed = hash && (await exec(top, ['cat-file', '-e', `${hash}:${rel}`], { okCodes: [0, 128] }).then((r) => !r.err, () => false))
    if (committed) candidates.unshift({ path: real, shown: inside, commit: { repo: top, hash, rel } })
  }
  return { inRepo: !!inside, total: files.length, candidates: candidates.slice(0, 12) }
}

/** For a Compare tab: the repository each file is in (its working tree), or null (a file elsewhere, or a commit's copy). */
export async function compareRepos(a: string, b: string): Promise<[string | null, string | null]> {
  const repoOf = async (file: string): Promise<string | null> => {
    const real = await realpath(file).catch(() => null)
    if (!real || (compareRoot && real.startsWith((await realpath(compareRoot).catch(() => compareRoot!)) + sep))) return null
    const top = (await git(dirname(real), ['rev-parse', '--show-toplevel']).catch(() => '')).trim()
    return top || null
  }
  return Promise.all([repoOf(a), repoOf(b)])
}

/** Compare's Apply: the file in a repository takes the other file's contents (git can still undo it). */
export async function applyCompare(from: string, to: string): Promise<void> {
  const [, repo] = await compareRepos(from, to)
  if (!repo) throw new Error('Only a file inside a repository can be replaced from Compare.')
  const [src, dst] = await Promise.all([stat(from), stat(to)])
  if (!src.isFile() || !dst.isFile()) throw new Error('Both sides have to be files.')
  await writeFile(to, await readFile(from))
}

/** The files git tracks in a repository, relative to it. */
export async function trackedFiles(cwd: string): Promise<Set<string>> {
  return new Set((await git(cwd, ['ls-files', '-z'])).split('\0').filter(Boolean))
}

/** The size of a file in a commit (of its blob: a Git LFS file's pointer). */
export async function sizeAtCommit(cwd: string, hash: string, rel: string): Promise<number> {
  assertHash(hash)
  return Number((await git(cwd, ['cat-file', '-s', `${hash}:${rel}`])).trim())
}

/**
 * Copies files (absolute paths, with the path to keep each under) into one folder called `label` and
 * moves that to the Trash: the way back for something Spoon is about to overwrite.
 */
export async function backupToTrash(files: { abs: string; rel: string }[], label: string, trash: (abs: string) => Promise<void>): Promise<void> {
  const present: { abs: string; rel: string }[] = []
  // A link is kept as the link itself (not what it points to).
  for (const f of files) {
    const st = await lstat(f.abs).catch(() => null)
    if (st?.isFile() || st?.isSymbolicLink()) present.push(f)
  }
  if (!present.length) return
  const dir = await mkdtemp(join(tmpdir(), 'spoon-backup-'))
  try {
    const box = join(dir, label)
    for (const f of present) {
      await mkdir(dirname(join(box, f.rel)), { recursive: true })
      await cp(f.abs, join(box, f.rel))
    }
    await trash(box)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

export const backupStamp = (): string => {
  const d = new Date()
  const two = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}.${two(d.getMinutes())}.${two(d.getSeconds())}`
}

/**
 * Puts a commit's version of a file in the working copy as an unstaged change (the index is left alone).
 * from: the file's name in that commit when it has been renamed since; it's written under rel.
 * The version comes through git's own filters for today's name (Git LFS, line endings), with its
 * mode (executable, or a link). Whatever is at rel now goes to the Trash first when it differs, ignored
 * and skip-worktree files included; a link there is replaced, never written through.
 */
export async function restoreFileFrom(
  cwd: string,
  hash: string,
  rel: string,
  trash: (abs: string) => Promise<void>,
  from?: string
): Promise<void> {
  assertHash(hash)
  const abs = await realRepoFile(cwd, rel)
  const src = from ?? rel
  if (src !== rel) await realRepoFile(cwd, src)
  return exclusive(cwd, async () => {
    const entry = (await git(cwd, ['ls-tree', '-z', hash, '--', src])).split('\0')[0]
    const m = /^(\d{6}) (\w+) ([0-9a-f]+)\t/.exec(entry)
    if (!m) throw new Error(`${src} isn’t in ${hash.slice(0, 7)}.`)
    const [, mode, type, oid] = m
    if (type !== 'blob') throw new Error(`${src} is a ${type === 'commit' ? 'submodule' : 'folder'} in ${hash.slice(0, 7)}; only files can be restored.`)
    const link = mode === '120000'
    const executable = mode === '100755'
    const { out } = await exec(cwd, link ? ['cat-file', 'blob', oid] : ['cat-file', '--filters', `--path=${rel}`, oid], { encoding: 'latin1' })
    const data = Buffer.from(out, 'latin1')

    const now = await lstat(abs).catch(() => null)
    if (now?.isDirectory()) throw new Error(`${rel} is a folder now; Spoon won’t replace it with a file.`)
    if (now) {
      const same = now.isSymbolicLink()
        ? link && (await readlink(abs)) === data.toString()
        : !link && now.isFile() && ((now.mode & 0o111) !== 0) === executable && (await readFile(abs)).equals(data)
      if (same) return
      await backupToTrash([{ abs, rel: basename(rel) }], `${basename(resolve(cwd))} – before restoring ${basename(rel)} ${backupStamp()}`, trash)
    }

    // Written next to it, then moved over it: a link at rel is replaced as an entry, not followed.
    await mkdir(dirname(abs), { recursive: true })
    const tmp = join(dirname(abs), `.${basename(abs)}.spoon-restore-${process.pid}-${Date.now()}`)
    try {
      if (link) await symlink(data.toString(), tmp)
      else {
        await writeFile(tmp, data, { flag: 'wx' })
        // Today's permissions (a private file stays private), with git's executable bit.
        const base = now?.isFile() ? now.mode & 0o666 : 0o644
        await chmod(tmp, executable ? base | ((base & 0o444) >> 2) : base)
      }
      await rename(tmp, abs)
    } catch (err) {
      await rm(tmp, { force: true })
      throw err
    }
  })
}

/**
 * The commits that changed a file, newest first, with what each did to it: its name then (following
 * renames when asked), how (added, changed, renamed, deleted) and the lines added and removed. Merges
 * show only where they changed the file themselves (a conflict resolved by hand). It reads `limit`
 * commits at a time (more: there may be older ones), walking from HEAD and from `at` when the file was
 * picked in a commit that isn't on it. renamedTo: the file's name today, when it has been renamed since.
 * A newer call with the same `request` key, or cancelFileHistory, stops this one.
 */
export async function fileHistory(
  cwd: string,
  rel: string,
  opts: { follow: boolean; limit?: number; at?: string; request?: string }
): Promise<FileHistory> {
  const root = resolve(cwd)
  if (typeof rel !== 'string' || !rel || isAbsolute(rel) || !insideRel(relative(root, resolve(root, rel)))) throw new Error(`Not a file in this repository: ${rel}`)
  const limit = Math.max(1, Math.min(5000, Math.floor(Number(opts.limit) || 300)))
  if (opts.at !== undefined) assertHash(opts.at)
  const key = historyKey(cwd, opts.request)
  if (opts.request) cancel(key)
  const head = (await git(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD'], [0, 1])).trim()
  const starts = [...new Set([head, opts.at].filter((r): r is string => !!r))]
  if (!starts.length) return { entries: [], more: false, renamedTo: null }
  const { out } = await exec(cwd, [
    'log',
    ...(opts.follow ? ['--follow'] : []),
    '-M',
    '--diff-merges=dense-combined',
    '-n',
    String(limit),
    '--format=%x1e%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%s',
    '--raw',
    '--numstat',
    '-z',
    ...starts,
    '--',
    rel
  ], { cancellable: opts.request ? key : undefined })
  const entries: FileHistoryEntry[] = []
  let seen = 0
  for (const record of out.split('\x1e')) {
    if (!record) continue
    const end = record.indexOf('\0')
    const [hash, parents, author, email, time, subject] = (end < 0 ? record : record.slice(0, end)).split('\x1f')
    if (!hash) continue
    seen++
    const tokens = (end < 0 ? '' : record.slice(end + 1)).replace(/^\n/, '').split('\0')
    let file: FileChange | null = null
    let added: number | null = 0
    let removed: number | null = 0
    let counted = false
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i].replace(/^\n/, '')
      if (t.startsWith(':')) {
        // ":<mode> <mode> <id> <id> <status>", then the path (old and new for a rename or copy); a
        // merge's combined line ("::…") has a status per parent and one path.
        const status = t.split(' ').pop()![0] as FileStatus
        file = !t.startsWith('::') && (status === 'R' || status === 'C') ? { status, oldPath: tokens[++i], path: tokens[++i] } : { status, path: tokens[++i] }
      } else {
        const m = /^(-|\d+)\t(-|\d+)\t([\s\S]*)$/.exec(t)
        if (!m) continue
        counted = true
        added = m[1] === '-' ? null : Number(m[1])
        removed = m[2] === '-' ? null : Number(m[2])
        if (!m[3]) i += 2 // a rename's numstat names both paths after it
      }
    }
    if (!file) continue // a merge that only took one side's version
    const parentList = parents ? parents.split(' ') : []
    // A merge's own change has no single count of lines.
    if (parentList.length > 1 && !counted) added = removed = null
    entries.push({ hash, parents: parentList, author, email, time: Number(time), subject, file, added, removed, merge: parentList.length > 1 })
  }
  // Looked up under an old name: what it's called now, when the newest commit here renamed it away.
  let renamedTo: string | null = null
  const newest = entries[0]
  if (newest?.file.status === 'D') {
    const raw = await git(cwd, ['diff-tree', '-z', '-r', '-M', '--name-status', '--no-commit-id', newest.hash], [0, 1]).catch(() => '')
    const t = raw.split('\0')
    for (let i = 0; i < t.length; i++) if (/^R\d*$/.test(t[i]) && t[i + 1] === newest.file.path) renamedTo = t[i + 2]
    if (renamedTo && !(await git(cwd, ['cat-file', '-e', `HEAD:${renamedTo}`], [0, 1, 128]).then(() => true, () => false))) renamedTo = null
  }
  return { entries, more: seen >= limit, renamedTo }
}
const historyKey = (cwd: string, request?: string): string => join(repoKey(cwd), '.git', `spoon-history-${request ?? ''}`)
/** Stops a File History lookup (its dialog closed, or asked for something else). */
export const cancelFileHistory = (cwd: string, request: string): void => cancel(historyKey(cwd, request))
