// Thin wrapper over the git CLI. Every call shells out to `git` with machine-readable
// output, so LFS, hooks, credentials and config all behave exactly as in the terminal.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, delimiter, join } from 'node:path'
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
}

function run(cwd: string, args: string[], opts: RunOptions = {}): Promise<string> {
  const okCodes = opts.okCodes ?? [0]
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-c', 'core.quotepath=off', '-c', 'color.ui=false', ...args], { cwd, env: opts.env ? { ...env, ...opts.env } : env })
    const out: Buffer[] = []
    let err = ''
    child.stdout.on('data', (b: Buffer) => out.push(b))
    child.stderr.on('data', (b: Buffer) => {
      const s = b.toString('utf8')
      err += s
      if (opts.onProgress) {
        const lines = s.split(/[\r\n]+/).filter((l) => l.trim())
        if (lines.length) opts.onProgress(lines[lines.length - 1].trim())
      }
    })
    child.on('error', (e) => reject(new GitError(`git ${args[0]}: ${e.message}`, null, '')))
    child.on('close', (code) => {
      if (code !== null && okCodes.includes(code)) return resolve(Buffer.concat(out).toString('utf8'))
      // Keep only the final state of each \r-updated progress line.
      const msg = err
        .split('\n')
        .map((l) => l.split('\r').filter(Boolean).pop() ?? '')
        .filter((l) => l.trim())
        .join('\n')
      reject(new GitError(msg || `git ${args[0]} failed (exit ${code})`, code, err))
    })
    if (opts.input !== undefined) child.stdin.end(opts.input)
    else child.stdin.end()
  })
}

function git(cwd: string, args: string[], okCodes: number[] = [0]): Promise<string> {
  return run(cwd, args, { okCodes })
}

function assertHash(hash: string): void {
  if (!/^[0-9a-f]{4,64}$/i.test(hash)) throw new Error(`Invalid commit hash: ${hash}`)
}

export async function openRepo(path: string): Promise<RepoState> {
  const root = (await git(path, ['rev-parse', '--show-toplevel'])).trim()
  const gitDir = (await git(root, ['rev-parse', '--absolute-git-dir'])).trim()

  const [branchOut, headOut, refs, stashes, remotesOut, submodules, superOut] = await Promise.all([
    git(root, ['symbolic-ref', '-q', '--short', 'HEAD'], [0, 1]),
    git(root, ['rev-parse', '-q', '--verify', 'HEAD'], [0, 1]),
    readRefs(root),
    readStashes(root),
    git(root, ['remote']),
    readSubmodules(root),
    git(root, ['rev-parse', '--show-superproject-working-tree'], [0, 1]).catch(() => '')
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
    superproject: superOut.trim() || null
  }
}

async function readSubmodules(root: string): Promise<Submodule[]> {
  if (!existsSync(join(root, '.gitmodules'))) return []
  // Lines look like " <sha> path (describe)"; the first char is ' ' ok, '-' not initialized,
  // '+' checked-out commit differs from the recorded one, 'U' merge conflict.
  const out = await git(root, ['submodule', 'status'], [0, 1])
  const subs = out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const m = /^([ \-+U])([0-9a-f]+) (.+?)(?: \(.*\))?$/.exec(line)
      if (!m) return null
      const state = m[1] === '-' ? 'uninitialized' : m[1] === '+' ? 'outdated' : m[1] === 'U' ? 'conflict' : 'ok'
      return { path: m[3], name: m[3].split('/').pop()!, hash: m[2], branch: null, state, dirty: false, recorded: m[2] } as Submodule
    })
    .filter((s): s is Submodule => s !== null)

  await Promise.all(
    subs
      .filter((s) => s.state !== 'uninitialized')
      .map(async (s) => {
        const dir = join(root, s.path)
        const [branch, status] = await Promise.all([
          git(dir, ['symbolic-ref', '-q', '--short', 'HEAD'], [0, 1]).catch(() => ''),
          git(dir, ['status', '--porcelain', '--untracked-files=no']).catch(() => '')
        ])
        s.branch = branch.trim() || null
        s.dirty = status.trim().length > 0
        if (s.state === 'outdated') {
          // Ahead is the normal state while you're developing inside the submodule; behind means
          // someone moved the parent's pointer and Update would catch you up.
          s.recorded = (await git(root, ['rev-parse', `HEAD:${s.path}`]).catch(() => s.hash)).trim()
          const counts = await git(dir, ['rev-list', '--left-right', '--count', `${s.recorded}...${s.hash}`]).catch(() => '')
          const [behind, ahead] = counts.trim().split(/\s+/).map(Number)
          if (!Number.isNaN(ahead)) {
            s.ahead = ahead
            s.behind = behind
            s.relation = behind === 0 ? 'ahead' : ahead === 0 ? 'behind' : 'diverged'
          }
        }
      })
  )
  return subs
}

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
  const head = await git(cwd, ['rev-parse', '-q', '--verify', 'HEAD'], [0, 1])
  const anyRefs = await git(cwd, ['for-each-ref', '--count=1', 'refs/heads', 'refs/remotes', 'refs/tags'])
  if (!head.trim() && !anyRefs.trim()) return [] // brand-new repo, nothing to show

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
  const out = await git(cwd, ['status', '--porcelain=v2', '-z', '--untracked-files=all'])
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

async function rawDiff(cwd: string, target: DiffTarget): Promise<string> {
  const { file } = target
  const paths = file.oldPath ? [file.oldPath, file.path] : [file.path]
  const common = ['--no-color', '--no-ext-diff', '-M']

  if (target.kind === 'commit') {
    assertHash(target.hash)
    const parents = (await git(cwd, ['rev-list', '--parents', '-n1', target.hash])).trim().split(' ').slice(1)
    return git(cwd, ['diff', ...common, parents[0] ?? EMPTY_TREE, target.hash, '--', ...paths])
  }
  if (target.kind === 'staged') return git(cwd, ['diff', ...common, '--cached', '--', ...paths])
  if (file.status === '?') return git(cwd, ['diff', ...common, '--no-index', '--', '/dev/null', file.path], [0, 1])
  return git(cwd, ['diff', ...common, '--', ...paths])
}

export async function diff(cwd: string, target: DiffTarget): Promise<DiffResult> {
  const out = await rawDiff(cwd, target)
  const truncated = out.length > MAX_DIFF_BYTES
  const text = truncated ? out.slice(0, MAX_DIFF_BYTES) : out
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
  if (paths.length) await withPaths(cwd, ['add', '-A'], paths)
}

export async function unstage(cwd: string, paths: string[]): Promise<void> {
  if (!paths.length) return
  if (await hasHead(cwd)) await withPaths(cwd, ['restore', '--staged'], paths)
  else await withPaths(cwd, ['rm', '--cached', '-r', '-q'], paths)
}

export async function stageAll(cwd: string): Promise<void> {
  await git(cwd, ['add', '-A'])
}

export async function unstageAll(cwd: string): Promise<void> {
  if (await hasHead(cwd)) await git(cwd, ['reset', '-q'])
  else await git(cwd, ['rm', '--cached', '-r', '-q', '.'])
}

/**
 * Stages (unstaged target) or unstages (staged target) a single hunk by rebuilding a patch
 * from the current diff: file header + that hunk, applied to the index.
 */
export async function applyHunk(cwd: string, target: DiffTarget, hunkIndex: number, hunkHeader: string): Promise<void> {
  if (target.kind === 'commit') throw new Error('Cannot stage a hunk from a commit')
  const lines = (await rawDiff(cwd, target)).split('\n')
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
  await run(cwd, ['commit', '-F', '-', ...(amend ? ['--amend'] : [])], { input: message })
  return (await git(cwd, ['rev-parse', 'HEAD'])).trim()
}

// ---------- writing: branches ----------

export async function checkout(cwd: string, target: CheckoutTarget): Promise<void> {
  if (target.kind === 'branch') {
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
  await run(cwd, ['fetch', '--all', '--progress', ...(prune ? ['--prune'] : [])], { onProgress })
}

export async function pull(cwd: string, opts: PullOptions, onProgress: (l: string) => void): Promise<void> {
  const info = await syncInfo(cwd)
  if (!info.branch) throw new Error('HEAD is detached. Check out a branch to pull.')
  if (!info.upstreamRemote || !info.upstreamBranch)
    throw new Error(`Branch "${info.branch}" has no upstream. Push it first to create one.`)
  const args = ['pull', '--progress', opts.rebase ? '--rebase' : '--no-rebase']
  if (!opts.rebase) args.push('--no-edit')
  if (opts.autostash) args.push('--autostash')
  await run(cwd, [...args, info.upstreamRemote, info.upstreamBranch], { onProgress })
}

export async function push(cwd: string, opts: PushOptions, onProgress: (l: string) => void): Promise<void> {
  const info = await syncInfo(cwd)
  if (!info.branch) throw new Error('HEAD is detached. Check out a branch to push.')
  const args = ['push', '--progress']
  if (opts.setUpstream) args.push('-u')
  if (opts.tags) args.push('--tags')
  if (opts.force) args.push('--force-with-lease')
  await run(cwd, [...args, opts.remote, `refs/heads/${info.branch}:refs/heads/${opts.remoteBranch}`], { onProgress })
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
  const hash = line.split(/\s+/)[1]
  if (!hash) throw new Error(`${submodulePath} isn’t a submodule of this repository.`)
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
export async function updateSubmodule(cwd: string, submodulePath: string, backupBranch?: string): Promise<void> {
  const dir = join(cwd, submodulePath)
  const nested = (): Promise<string> =>
    run(cwd, ['submodule', 'update', '--init', '--recursive', '--progress', '--', submodulePath])
  if (!existsSync(join(dir, '.git'))) {
    await nested()
    return
  }
  if (backupBranch) await git(dir, ['branch', '--', backupBranch, 'HEAD'])
  const recorded = await recordedCommit(cwd, submodulePath)
  if (!(await hasCommit(dir, recorded))) await git(dir, ['fetch', '--all', '--quiet'])
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
export async function deleteBranches(cwd: string, names: string[], force: boolean): Promise<DeleteResult> {
  const deleted: string[] = []
  const unmerged: string[] = []
  for (const name of names) {
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
  }
  return { deleted, unmerged }
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

export async function fetchRef(cwd: string, remote: string, refspec: string): Promise<void> {
  await run(cwd, ['fetch', remote, refspec])
}

/** Deletes a branch on a remote (git push <remote> --delete <branch>). */
export async function deleteRemoteBranch(cwd: string, remote: string, branch: string): Promise<void> {
  await run(cwd, ['push', remote, '--delete', branch])
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
  return rebaseOutcome(cwd, git(cwd, ['rebase', '--autostash', onto]))
}

const ACTIONS: RebaseAction[] = ['pick', 'reword', 'edit', 'squash', 'fixup', 'drop']

/** Runs `git rebase -i` with our own todo list in place of the one git would open in an editor. */
export async function rebaseInteractive(cwd: string, onto: string, steps: RebaseStep[]): Promise<RebaseResult> {
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
  return rebaseOutcome(cwd, git(cwd, ['rebase', `--${action}`]))
}
