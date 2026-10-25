// Thin wrapper over the git CLI. Every call shells out to `git` with machine-readable
// output, so LFS, hooks, credentials and config all behave exactly as in the terminal.
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { cp, lstat, mkdir, readdir, rename, rm, rmdir } from 'node:fs/promises'
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type {
  Commit,
  CommitDetails,
  DiffResult,
  DiffTarget,
  FileChange,
  FileStatus,
  Ref,
  RepoState,
  CheckoutTarget,
  PullOptions,
  PushOptions,
  Stash,
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
  input?: string
  /** Receives git's progress lines ("Receiving objects:  42% ...") as they arrive. */
  onProgress?: (line: string) => void
  env?: Record<string, string>
  /** Stop reading (and end git) once stdout passes this many bytes; the output is then truncated. */
  maxBytes?: number
  /** Network commands: cancel(cwd) ends them. */
  cancellable?: boolean
}

const CANCELLED = 'Cancelled.'
const cancellable = new Map<string, Set<ChildProcess>>()
const repoKey = (cwd: string): string => resolve(cwd)

function exec(cwd: string, args: string[], opts: RunOptions = {}): Promise<{ out: string; truncated: boolean }> {
  const okCodes = opts.okCodes ?? [0]
  return new Promise((done, reject) => {
    // Cancellable commands get their own process group: `fetch --all`, `pull` and `submodule update`
    // run further git processes, and cancel() has to end those too.
    const child = spawn('git', ['-c', 'core.quotepath=off', '-c', 'color.ui=false', ...args], {
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
    const key = repoKey(cwd)
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
        return done({ out: (truncated ? buf.subarray(0, opts.maxBytes) : buf).toString('utf8'), truncated })
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

function exclusive<T>(cwd: string, fn: () => Promise<T>): Promise<T> {
  const key = repoKey(cwd)
  const task = (locks.get(key) ?? Promise.resolve()).catch(() => undefined).then(fn)
  const tail = task.catch(() => undefined)
  locks.set(key, tail)
  tail.then(() => locks.get(key) === tail && locks.delete(key))
  return task
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
    submodules,
    superproject: superproject || null
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
  const out = await git(cwd, ['stash', 'list', `--format=%gd${FS}%H${FS}%gs`], [0, 1])
  return out
    .split('\n')
    .filter(Boolean)
    .map((line, index) => {
      const [name, hash, message] = line.split(FS)
      return { index, name, hash, message }
    })
}

export async function log(cwd: string, limit: number): Promise<Commit[]> {
  // A brand-new repo (no refs at all) just prints nothing.
  const format = ['%H', '%P', '%an', '%ae', '%at', '%cn', '%ct', '%s'].join('%x1f') + '%x1e'
  const out = await git(cwd, [
    'log',
    '--exclude=refs/stash',
    '--all',
    '--date-order',
    `-n${limit}`,
    `--format=${format}`
  ])
  const commits: Commit[] = []
  for (const rec of out.split(RS)) {
    const r = rec.replace(/^\n/, '')
    if (!r) continue
    const [hash, parents, authorName, authorEmail, at, committerName, ct, subject] = r.split(FS)
    commits.push({
      hash,
      parents: parents ? parents.split(' ') : [],
      authorName,
      authorEmail,
      authorTime: Number(at),
      committerName,
      commitTime: Number(ct),
      subject
    })
  }
  return commits
}

export async function commitDetails(cwd: string, hash: string): Promise<CommitDetails> {
  assertHash(hash)
  const format = ['%H', '%P', '%an', '%ae', '%at', '%cn', '%ce', '%ct', '%B'].join('%x1f')
  const out = await git(cwd, ['show', '-s', `--format=${format}`, hash])
  const [h, parents, an, ae, at, cn, ce, ct, ...rest] = out.split(FS)
  const parentList = parents ? parents.split(' ') : []
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
async function rawDiff(cwd: string, target: DiffTarget, maxBytes?: number): Promise<{ out: string; truncated: boolean }> {
  const { file } = target
  const paths = file.oldPath ? [file.oldPath, file.path] : [file.path]
  const common = ['--no-color', '--no-ext-diff', '-M']
  const diffOf = (args: string[], okCodes = [0]): Promise<{ out: string; truncated: boolean }> =>
    exec(cwd, ['diff', ...common, ...args], { okCodes, maxBytes })

  if (target.kind === 'commit') {
    assertHash(target.hash)
    const parents = (await git(cwd, ['rev-list', '--parents', '-n1', target.hash])).trim().split(' ').slice(1)
    return diffOf([parents[0] ?? EMPTY_TREE, target.hash, '--', ...paths])
  }
  if (target.kind === 'staged') return diffOf(['--cached', '--', ...paths])
  if (file.status === '?') return diffOf(['--no-index', '--', '/dev/null', file.path], [0, 1])
  return diffOf(['--', ...paths])
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
      if (!rel || rel.startsWith('..') || isAbsolute(rel) || rel.split(sep)[0] === '.git')
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
      const staged = await run(cwd, ['diff', '--cached', '--binary', '--', p])
      const reversed = await run(cwd, ['apply', '-R', '--whitespace=nowarn', '-'], { input: staged }).then(
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

/**
 * Stages (unstaged target) or unstages (staged target) a single hunk by rebuilding a patch
 * from the current diff: file header + that hunk, applied to the index.
 */
export async function applyHunk(cwd: string, target: DiffTarget, hunkIndex: number, hunkHeader: string): Promise<void> {
  if (target.kind === 'commit') throw new Error('Cannot stage a hunk from a commit')
  return exclusive(cwd, () => applyHunkNow(cwd, target, hunkIndex, hunkHeader))
}

async function applyHunkNow(cwd: string, target: DiffTarget, hunkIndex: number, hunkHeader: string): Promise<void> {
  const lines = (await rawDiff(cwd, target)).out.split('\n')
  const starts = lines.flatMap((l, i) => (l.startsWith('@@ ') ? [i] : []))
  const start = starts[hunkIndex]
  if (start === undefined || lines[start] !== hunkHeader)
    throw new Error('The file changed since the diff was shown. Refresh and try again.')
  const end = starts[hunkIndex + 1] ?? (lines[lines.length - 1] === '' ? lines.length - 1 : lines.length)
  const patch = [...lines.slice(0, starts[0]), ...lines.slice(start, end)].join('\n') + '\n'
  const args = ['apply', '--cached', '--whitespace=nowarn']
  if (target.kind === 'staged') args.push('--reverse')
  await run(cwd, [...args, '-'], { input: patch })
}

// ---------- writing: commits ----------

export async function headMessage(cwd: string): Promise<string> {
  if (!(await hasHead(cwd))) return ''
  return (await git(cwd, ['log', '-1', '--format=%B'])).trimEnd()
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

export async function fetch(cwd: string, prune: boolean, onProgress: (l: string) => void): Promise<void> {
  await exclusive(cwd, () =>
    run(cwd, ['fetch', '--all', '--progress', ...(prune ? ['--prune'] : [])], { onProgress, cancellable: true })
  )
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
  await run(cwd, [...args, '--', info.upstreamRemote, info.upstreamBranch], { onProgress, cancellable: true })
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
  return exclusive(cwd, () => updateSubmoduleNow(cwd, submodulePath, backupBranch))
}

async function updateSubmoduleNow(cwd: string, submodulePath: string, backupBranch?: string): Promise<void> {
  // Also proves the path is a submodule of this repo before any git runs inside it.
  const recorded = await recordedCommit(cwd, submodulePath)
  const dir = join(cwd, submodulePath)
  const nested = (): Promise<string> =>
    run(cwd, ['submodule', 'update', '--init', '--recursive', '--progress', '--', submodulePath], { cancellable: true })
  if (!existsSync(join(dir, '.git'))) {
    await nested()
    return
  }
  if (backupBranch) {
    await assertBranchName(dir, backupBranch)
    await git(dir, ['branch', '--', backupBranch, 'HEAD'])
  }
  if (!(await hasCommit(dir, recorded))) await run(dir, ['fetch', '--all', '--quiet'], { cancellable: true })
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
      lines.push(`pick ${s.hash}`, `exec git commit --amend --allow-empty --no-verify --cleanup=strip -F ${shPath(file)}`)
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
  await exclusive(dir, () => run(dir, ['fetch', '--prune', '--quiet', 'origin'], { cancellable: true }))
  const [describe, hash, branch, refs] = await Promise.all([
    git(dir, ['describe', '--tags', '--always'], [0, 128]).then((s) => s.trim()),
    git(dir, ['rev-parse', '--short', 'HEAD']).then((s) => s.trim()),
    git(dir, ['symbolic-ref', '-q', '--short', 'HEAD'], [0, 1]).then((s) => s.trim() || null),
    git(dir, ['for-each-ref', `--format=%(refname:short)${FS}%(committerdate:unix)${FS}%(objectname:short)`, `refs/remotes/origin/${prefix}`])
  ])
  const versions: MainLibVersion[] = refs
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [ref, date, h] = line.split(FS)
      const name = ref.slice('origin/'.length)
      return { ref, branch: name, version: name.slice(prefix.length), date: Number(date), hash: h }
    })
    .filter((v) => /^\d/.test(v.version))
    .sort((a, b) => compareVersions(b.version, a.version))
  return { path: submodulePath, describe: describe || hash, hash, branch, versions }
}

/** Checks out a version branch in the submodule: an existing local branch is fast-forwarded to it. */
export function mainlibSwitch(cwd: string, submodulePath: string, ref: string): Promise<void> {
  const dir = join(cwd, submodulePath)
  return exclusive(dir, async () => {
    if (!ref.startsWith('origin/')) throw new Error(`Not a remote branch: ${ref}`)
    const local = ref.slice('origin/'.length)
    await assertBranchName(dir, local)
    const exists = !!(await git(dir, ['rev-parse', '-q', '--verify', `refs/heads/${local}`], [0, 1])).trim()
    if (exists) {
      await git(dir, ['switch', '--quiet', local])
      await git(dir, ['merge', '--ff-only', '--quiet', `refs/remotes/${ref}`])
    } else {
      await git(dir, ['switch', '--quiet', '-c', local, '--track', `refs/remotes/${ref}`])
    }
  })
}
