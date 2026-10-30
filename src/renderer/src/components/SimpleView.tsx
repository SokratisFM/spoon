// Simple Mode's screens (see simpleMode.tsx): "My changes" shows what isn't saved yet as files with
// previews and walks through check → describe → save & share; "History" is the branch's saves as a
// timeline, any file of which can be opened or put back. Git's words stay out of sight: a commit is
// a save, a push is sharing, a pull is getting the team's saves.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Commit, CommitDetails, DiscardEntry, FileChange, FileStatus, RepoState, WorkingTree } from '../../../shared/types'
import type { OpBusy } from '../repoCache'
import type { Ops } from './RepoView'
import { fileKind, isPreviewable, setSimpleConfig, timeAgo, typeGroupOf, TYPE_GROUPS, type SimpleConfig } from '../simpleMode'
import { usePersistentState } from '../hooks'
import { confirm } from '../dialogs'
import { fullDate, hueFor, initials, splitPath } from '../format'
import { openFileEditor } from './FileEditor'
import { Segmented } from './SettingsWindow'
import { keys, revealLabel } from '../platform'
import {
  AlertIcon,
  AudioIcon,
  BoxIcon,
  CheckIcon,
  CloudOffIcon,
  CodeIcon,
  CogIcon,
  FileIcon,
  GridIcon,
  ImageIcon,
  ListViewIcon,
  LockIcon,
  ModelIcon,
  PullIcon,
  PushIcon,
  RefreshIcon,
  SceneIcon,
  VideoIcon
} from './Icons'

type Tab = 'changes' | 'history'
type Kind = 'new' | 'changed' | 'removed' | 'renamed' | 'conflict'

/** A changed file as Simple Mode shows it: staged and unstaged halves together. */
interface SimpleFile {
  path: string
  oldPath?: string
  kind: Kind
  entries: DiscardEntry[]
  /** The file's changed Unity .meta, which goes along with it (saved and undone together). */
  meta?: SimpleFile
}

/**
 * Unity .meta files folded into their asset's card: a .meta whose asset changed too is part of
 * that card, and a folder's .meta is saved along with any file inside the folder. A .meta that
 * changed on its own (import settings) stays a file of its own.
 */
function foldMetas(files: SimpleFile[]): { files: SimpleFile[]; folderMetas: SimpleFile[] } {
  const byPath = new Map(files.map((f) => [f.path, { ...f }]))
  // Every folder that has a changed file (not a .meta) somewhere in it.
  const folders = new Set<string>()
  for (const f of files)
    if (!f.path.endsWith('.meta')) for (let i = f.path.lastIndexOf('/'); i > 0; i = f.path.lastIndexOf('/', i - 1)) folders.add(f.path.slice(0, i))
  const folderMetas: SimpleFile[] = []
  const out: SimpleFile[] = []
  for (const f of byPath.values()) {
    if (f.path.endsWith('.meta')) {
      const owner = f.path.slice(0, -'.meta'.length)
      const asset = byPath.get(owner)
      if (asset && !owner.endsWith('.meta')) {
        asset.meta = f
        continue
      }
      if (folders.has(owner)) {
        folderMetas.push(f)
        continue
      }
    }
    out.push(f)
  }
  return { files: out, folderMetas }
}

/** A file's paths and its .meta's, for staging. */
const pathsOf = (f: SimpleFile): string[] => [f.path, ...(f.oldPath ? [f.oldPath] : []), ...(f.meta ? pathsOf(f.meta) : [])]
const entriesOf = (f: SimpleFile): DiscardEntry[] => [...f.entries, ...(f.meta?.entries ?? [])]

const CARDS = 150

const KIND_LABEL: Record<Kind, string> = { new: 'New', changed: 'Changed', removed: 'Removed', renamed: 'Renamed', conflict: 'Needs help' }

function kindOf(statuses: FileStatus[]): Kind {
  if (statuses.includes('U')) return 'conflict'
  if (statuses.every((s) => s === 'D')) return 'removed'
  if (statuses.some((s) => s === 'A' || s === '?') && !statuses.includes('D')) return 'new'
  if (statuses.includes('R')) return 'renamed'
  return 'changed'
}

function simpleFiles(tree: WorkingTree): SimpleFile[] {
  const byPath = new Map<string, { oldPath?: string; statuses: FileStatus[]; entries: DiscardEntry[] }>()
  const add = (f: FileChange, staged: boolean): void => {
    const e = byPath.get(f.path) ?? { statuses: [], entries: [] }
    e.oldPath ??= f.oldPath
    e.statuses.push(f.status)
    e.entries.push({ path: f.path, oldPath: f.oldPath, status: f.status, staged })
    byPath.set(f.path, e)
  }
  tree.staged.forEach((f) => add(f, true))
  tree.unstaged.forEach((f) => add(f, false))
  return [...byPath]
    .map(([path, e]) => ({ path, oldPath: e.oldPath, kind: kindOf(e.statuses), entries: e.entries }))
    .sort((a, b) => a.path.localeCompare(b.path))
}

const inFolder = (folder: string) => (p: string): boolean => !folder || p === folder || p.startsWith(folder.replace(/\/$/, '') + '/')

/** Busy labels in Simple Mode's words. */
function plain(label: string): string {
  if (/^Push/.test(label)) return 'Sharing your saves…'
  if (/^Pull/.test(label)) return 'Getting the team’s saves…'
  if (/^Fetch/.test(label)) return 'Checking for new saves…'
  if (/^Discard/.test(label)) return 'Undoing…'
  return label
}

// ---------- previews ----------

// What was drawn last, so a card that remounts (or refreshes) shows it straight away; the most
// recently used few hundred only (they're data URLs).
const thumbs = new Map<string, string | null>()
const THUMBS_MAX = 300
const remember = (key: string, url: string | null): void => {
  thumbs.delete(key)
  thumbs.set(key, url)
  if (thumbs.size > THUMBS_MAX) thumbs.delete(thumbs.keys().next().value as string)
}

// A few previews made at a time: a folder of hundreds of changed images doesn't start hundreds at once.
const THUMB_JOBS = 4
let running = 0
const waiting: (() => void)[] = []
function oneAtATime<T>(job: () => Promise<T>): Promise<T> {
  return new Promise<T>((done, fail) => {
    const go = (): void => {
      running++
      job()
        .then(done, fail)
        .finally(() => {
          running--
          waiting.shift()?.()
        })
    }
    if (running < THUMB_JOBS) go()
    else waiting.push(go)
  })
}

function useThumbnail(repo: string, file: string, hash: string | null, refreshN: number, size: number): string | null {
  const key = `${repo}|${hash ?? 'wt'}|${file}|${size}`
  const [url, setUrl] = useState<string | null>(thumbs.get(key) ?? null)
  const want = isPreviewable(file)
  useEffect(() => {
    if (!want) return
    let live = true
    // A card scrolled away (or gone) before its turn doesn't ask at all.
    oneAtATime(() => (live ? window.spoon.fileThumbnail(repo, file, hash, size) : Promise.resolve(thumbs.get(key) ?? null))).then(
      (u) => {
        remember(key, u)
        if (live) setUrl(u)
      },
      () => undefined
    )
    return () => {
      live = false
    }
    // The working copy can change without its path changing: ask again on each refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, want, hash ? 0 : refreshN])
  return want ? url : null
}

function KindIcon({ file }: { file: string }) {
  const k = fileKind(file).kind
  const I =
    k === 'image' ? ImageIcon
    : k === 'model' ? ModelIcon
    : k === 'audio' ? AudioIcon
    : k === 'video' ? VideoIcon
    : k === 'scene' ? SceneIcon
    : k === 'prefab' || k === 'asset' ? BoxIcon
    : k === 'code' ? CodeIcon
    : FileIcon
  return <I className="icon simple-kind-icon" />
}

function Preview({ repo, file, hash, refreshN, size }: { repo: string; file: string; hash: string | null; refreshN: number; size: number }) {
  const url = useThumbnail(repo, file, hash, refreshN, size)
  return <div className="simple-thumb">{url ? <img src={url} alt="" draggable={false} /> : <KindIcon file={file} />}</div>
}

// ---------- the view ----------

interface Props {
  path: string
  repo: RepoState
  tree: WorkingTree
  commits: Commit[]
  config: SimpleConfig
  ops: Ops
  busy: OpBusy | null
  refreshN: number
  commitRequest: { push: boolean; n: number } | null
  onCommitHandled: () => void
  onGetLatest: () => void
  onRefresh: () => void
  onFetchQuietly: () => void
  onOpenSettings: () => void
  onFullView: () => void
}

export function SimpleView(p: Props) {
  const { path, repo, tree, config, ops, busy } = p
  const [tab, setTab] = usePersistentState<Tab>(`spoon.simple.tab.${path}`, 'changes')
  const head = repo.refs.find((r) => r.kind === 'head' && r.name === repo.headBranch)
  const branch = config.branch || repo.headBranch
  const conflicts = tree.unstaged.some((f) => f.status === 'U')
  const stuck = repo.operation || repo.rebase || conflicts
  const wrongBranch = !!config.branch && repo.headBranch !== config.branch
  const behind = head?.behind ?? 0
  const ahead = head?.ahead ?? 0
  const unpublished = !!head && !head.upstream && repo.remotes.length > 0
  // Who "you" are, so your own saves read as yours.
  const [me, setMe] = useState('')
  useEffect(() => {
    window.spoon.userName(path).then(setMe, () => undefined)
  }, [path])

  // The team's new saves show up without anyone pressing Fetch: on opening, every minute, and on
  // coming back to the window (at most every half minute).
  const fetchQuietly = useRef(p.onFetchQuietly)
  fetchQuietly.current = p.onFetchQuietly
  useEffect(() => {
    let last = 0
    const tick = (): void => {
      if (document.hidden || Date.now() - last < 30_000) return
      last = Date.now()
      fetchQuietly.current()
    }
    tick()
    const timer = setInterval(tick, 60_000)
    window.addEventListener('focus', tick)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', tick)
    }
  }, [path])

  // ⌘↵ on History shows My changes instead of saving: it's never kept for later.
  useEffect(() => {
    if (!p.commitRequest || tab === 'changes') return
    p.onCommitHandled()
    setTab('changes')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.commitRequest])

  const switchToWork = (): void => {
    const name = config.branch
    if (repo.refs.some((r) => r.kind === 'head' && r.name === name)) ops.checkout({ kind: 'branch', name }, name)
    else {
      const remote = repo.refs.find((r) => r.kind === 'remote' && r.name.endsWith(`/${name}`))
      if (remote) ops.checkout({ kind: 'remote', name: remote.name }, name)
    }
  }
  const workExists = repo.refs.some((r) => (r.kind === 'head' && r.name === config.branch) || (r.kind === 'remote' && r.name.endsWith(`/${config.branch}`)))

  return (
    <div className="simple">
      <div className="simple-bar">
        <span className="simple-branch" title={config.branch ? 'Simple Mode works on this branch only' : 'The branch you’re working on'}>
          {config.branch && <LockIcon />}
          <span className="muted">Your work:</span> <b>{branch ?? 'none'}</b>
        </span>
        <Segmented
          // The badge changes the History label's width: start the sliding highlight afresh.
          key={behind > 0 ? 'news' : 'quiet'}
          value={tab}
          options={[
            ['changes', 'My changes'],
            [
              'history',
              <>
                History
                {behind > 0 && (
                  <span className="simple-tab-badge" title={`${behind} new ${behind === 1 ? 'save' : 'saves'} from the team`}>
                    {behind}
                  </span>
                )}
              </>
            ]
          ]}
          onChange={setTab}
        />
        <span className="spacer" />
        {busy && (
          <div className="activity">
            <span className="spinner" />
            <span className="activity-text">{plain(busy.label)}</span>
          </div>
        )}
        {tab === 'changes' && (
          <div className="segmented simple-view-switch" role="group" aria-label="Show files as">
            <button className={config.view !== 'list' ? 'on' : ''} title="Previews" onClick={() => setSimpleConfig(path, { view: 'previews' })}>
              <GridIcon />
            </button>
            <button className={config.view === 'list' ? 'on' : ''} title="List" onClick={() => setSimpleConfig(path, { view: 'list' })}>
              <ListViewIcon />
            </button>
          </div>
        )}
        <button className={`btn simple-get ${behind > 0 ? 'primary has-news' : ''}`} disabled={!!busy || !repo.remotes.length || !!stuck} onClick={p.onGetLatest} title="Get the saves your team has shared">
          <PullIcon /> Get latest
          {behind > 0 && <span className="badge accent">{behind}</span>}
        </button>
        <button className="icon-btn" onClick={p.onRefresh} title={`Look for changes again (${keys('⌘R')})`}>
          <RefreshIcon />
        </button>
        <button className="icon-btn" onClick={p.onOpenSettings} title="Simple Mode settings">
          <CogIcon />
        </button>
      </div>

      {stuck ? (
        <div className="simple-banner danger">
          <AlertIcon />
          <span>
            <b>This project needs a developer’s help.</b>{' '}
            {conflicts ? 'You and a teammate changed the same files, and they need to be combined by hand.' : 'Something was left half-way (a merge or rebase).'}
          </span>
          <button className="btn" onClick={p.onFullView}>
            Show the full view
          </button>
        </div>
      ) : wrongBranch ? (
        <div className="simple-banner warn">
          <AlertIcon />
          <span>
            You’re on <b>{repo.headBranch ?? 'no branch'}</b>, not your work (<b>{config.branch}</b>).
          </span>
          {workExists ? (
            <button className="btn primary" disabled={!!busy} onClick={switchToWork}>
              Switch to {config.branch}
            </button>
          ) : (
            <span className="muted">That branch doesn’t exist: ask a developer.</span>
          )}
        </div>
      ) : behind > 0 && tab === 'changes' ? (
        <div className="simple-banner accent">
          <PullIcon />
          <span>
            <b>
              {behind} new {behind === 1 ? 'save' : 'saves'} from the team.
            </b>{' '}
            Get them before you start on something new.
          </span>
          <button className="btn primary" disabled={!!busy} onClick={p.onGetLatest}>
            Get {behind === 1 ? 'it' : 'them'}
          </button>
        </div>
      ) : ahead > 0 || unpublished ? (
        <div className="simple-banner accent">
          <CloudOffIcon />
          <span>
            <b>{unpublished ? 'Your work isn’t shared yet.' : `${ahead} of your saves ${ahead === 1 ? 'is' : 'are'} only on this computer.`}</b>{' '}
            Share {ahead === 1 ? 'it' : 'them'} so the team gets {ahead === 1 ? 'it' : 'them'}.
          </span>
          <button className="btn primary" disabled={!!busy} onClick={ops.push}>
            Share
          </button>
        </div>
      ) : null}

      {tab === 'changes' ? (
        <SimpleChanges {...p} blocked={!!stuck || wrongBranch || !repo.headBranch} />
      ) : (
        <SimpleHistory path={path} repo={repo} commits={p.commits} config={config} ops={ops} me={me} busy={!!busy || !!stuck} onGetLatest={p.onGetLatest} />
      )}
    </div>
  )
}

// ---------- My changes ----------

function SimpleChanges(p: Props & { blocked: boolean }) {
  const { path, repo, tree, config, ops, busy, refreshN } = p
  const { files: all, folderMetas } = useMemo(() => foldMetas(simpleFiles(tree)), [tree])
  const shownTest = inFolder(config.folder)
  const inScope = all.filter((f) => shownTest(f.path) || (!!f.oldPath && shownTest(f.oldPath)))
  const hiddenTypes = new Set(config.hiddenTypes)
  const files = inScope.filter((f) => !hiddenTypes.has(typeGroupOf(f.path) ?? ''))
  const hidden = all.length - inScope.length
  const hiddenByType = inScope.length - files.length
  // The filter row: how many of the changed files are of each listed type.
  const typeCounts = new Map<string, number>()
  for (const f of inScope) {
    const g = typeGroupOf(f.path)
    if (g) typeCounts.set(g, (typeCounts.get(g) ?? 0) + 1)
  }
  const toggleType = (id: string): void =>
    setSimpleConfig(path, { hiddenTypes: hiddenTypes.has(id) ? config.hiddenTypes.filter((t) => t !== id) : [...config.hiddenTypes, id] })
  // Cards are shown a page at a time: a change to thousands of files stays quick.
  const [limit, setLimit] = useState(CARDS)
  // Files left out of the next save (unticked); new files are in by default.
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [message, setMessage] = usePersistentState(`spoon.simple.message.${path}`, '')
  const chosen = files.filter((f) => !excluded.has(f.path) && f.kind !== 'conflict')
  const headCommit = p.commits.find((c) => c.hash === repo.headHash)

  const save = async (share: boolean): Promise<void> => {
    if (p.blocked || busy || !chosen.length || !message.trim()) return
    const keep = new Set(chosen.flatMap(pathsOf))
    // A new folder's .meta goes with the files saved in it.
    for (const m of folderMetas) if (chosen.some((f) => f.path.startsWith(m.path.slice(0, -'.meta'.length) + '/'))) keep.add(m.path)
    // Only what's ticked goes in: anything else already staged (in the full view) is taken out first.
    const out = tree.staged.flatMap((f) => (keep.has(f.path) ? [] : f.oldPath ? [f.path, f.oldPath] : [f.path]))
    const ok = await ops.run(
      'Saving…',
      async () => {
        if (out.length) await window.spoon.unstage(path, out)
        await window.spoon.stage(path, [...keep])
        await window.spoon.commit(path, message.trim(), false)
      },
      'Couldn’t save'
    )
    if (!ok) return
    setMessage('')
    setExcluded(new Set())
    if (share) ops.push()
  }
  const saveRef = useRef(save)
  saveRef.current = save
  // ⌘↵ does the main button's job, ⌥⌘↵ always saves and shares; only a request made while this shows.
  const mountedAt = useRef(Date.now())
  useEffect(() => {
    if (!p.commitRequest) return
    p.onCommitHandled()
    if (p.commitRequest.n < mountedAt.current) return
    void saveRef.current(p.commitRequest.push || config.shareOnSave)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.commitRequest])

  const undo = async (list: SimpleFile[]): Promise<void> => {
    const usable = list.filter((f) => f.kind !== 'conflict')
    if (!usable.length) return
    const name = usable.length === 1 ? splitPath(usable[0].path).name : `${usable.length} files`
    const repoName = path.split('/').pop() ?? 'project'
    const ok = await confirm({
      message: `Undo your changes to ${name}?`,
      detail: `${usable.length === 1 ? 'It goes' : 'They go'} back to how ${usable.length === 1 ? 'it was' : 'they were'} at your last save; new files are removed.\n\nYour current versions go to the Trash (in a “${repoName} – discarded …” folder), so you can still get them back.`,
      confirmLabel: 'Undo Changes',
      risky: true
    })
    if (!ok) return
    const entries = usable.flatMap(entriesOf)
    // Folders whose files are all being undone lose their new .meta too.
    const undone = new Set(usable.map((f) => f.path))
    for (const m of folderMetas) {
      const inside = all.filter((f) => f.path.startsWith(m.path.slice(0, -'.meta'.length) + '/'))
      if (inside.every((f) => undone.has(f.path))) entries.push(...m.entries)
    }
    ops.run('Discarding…', () => window.spoon.discard(path, entries), 'Couldn’t undo the changes')
  }

  const open = (f: SimpleFile): void => {
    if (f.kind === 'removed') {
      if (!repo.headHash) return
      if (isPreviewable(f.path)) void window.spoon.openAtCommit(path, repo.headHash, f.path)
      else openFileEditor({ repo: path, file: f.path, at: { hash: repo.headHash, label: 'last save' }, show: 'commit' })
    } else if (isPreviewable(f.path)) void window.spoon.openWithDefaultApp(path, f.path)
    else openFileEditor({ repo: path, file: f.path })
  }
  const toggle = (f: SimpleFile): void =>
    setExcluded((s) => {
      const next = new Set(s)
      if (next.has(f.path)) next.delete(f.path)
      else next.add(f.path)
      return next
    })
  const allTicked = files.every((f) => !excluded.has(f.path))

  const typesRow = (
    <div className="simple-types" role="group" aria-label="File types">
      <span className="muted">Show</span>
      {TYPE_GROUPS.map((g) => {
        const n = typeCounts.get(g.id) ?? 0
        const on = !hiddenTypes.has(g.id)
        return (
          <button
            key={g.id}
            className={`simple-type ${on ? 'on' : ''} ${n ? '' : 'none'}`}
            aria-pressed={on}
            title={`${on ? 'Hide' : 'Show'} ${g.label.toLowerCase()} (${g.exts.map((e) => '.' + e).join(' ')})`}
            onClick={() => toggleType(g.id)}
          >
            {on && <CheckIcon />}
            {g.label}
            {n > 0 && <span className="simple-type-n">{n}</span>}
          </button>
        )
      })}
    </div>
  )

  if (!files.length)
    return (
      <div className="simple-body">
        {hiddenByType > 0 && typesRow}
        <div className="simple-done">
          <div className="simple-done-mark">
            <CheckIcon />
          </div>
          <h2>Everything is saved</h2>
          <p className="muted">
            {headCommit ? (
              <>
                Your last save: “{headCommit.subject}”, <span title={fullDate(headCommit.authorTime)}>{timeAgo(headCommit.authorTime)}</span>.
              </>
            ) : (
              'Nothing has been saved here yet.'
            )}
          </p>
          <p className="muted">Change a file in {config.folder ? <b>{config.folder}</b> : 'the project'} and it shows up here.</p>
          {hidden > 0 && <p className="faint">{hidden} changed {hidden === 1 ? 'file is' : 'files are'} outside {config.folder} and not shown.</p>}
          {hiddenByType > 0 && (
            <p className="faint">
              {hiddenByType} changed {hiddenByType === 1 ? 'file is' : 'files are'} of a hidden type.{' '}
              <button className="link-btn" onClick={() => setSimpleConfig(path, { hiddenTypes: [] })}>
                Show all types
              </button>
            </p>
          )}
        </div>
      </div>
    )

  const step = !chosen.length ? 1 : !message.trim() ? 2 : 3
  const primaryShares = config.shareOnSave
  return (
    <div className="simple-body">
      <ol className="simple-steps">
        {['Check your changes', 'Describe them', primaryShares ? 'Save & share' : 'Save'].map((label, i) => (
          <li key={label} className={i + 1 < step ? 'done' : i + 1 === step ? 'now' : ''}>
            <span className="simple-step-n">{i + 1 < step ? <CheckIcon /> : i + 1}</span>
            {label}
          </li>
        ))}
      </ol>

      {typesRow}

      <div className="simple-summary">
        <span>
          You changed <b>{files.length}</b> {files.length === 1 ? 'file' : 'files'} that {files.length === 1 ? 'isn’t' : 'aren’t'} saved yet.
          {chosen.length < files.length && <span className="muted"> {chosen.length} will be saved.</span>}
        </span>
        <span className="spacer" />
        <button className="link-btn" onClick={() => setExcluded(allTicked ? new Set(files.map((f) => f.path)) : new Set())}>
          {allTicked ? 'Untick all' : 'Tick all'}
        </button>
        <button className="btn" disabled={!!busy} onClick={() => undo(files)}>
          Undo all my changes…
        </button>
      </div>

      <div className={config.view === 'list' ? 'simple-list' : 'simple-cards'}>
        {files.slice(0, limit).map((f) => {
          const { dir, name } = splitPath(f.path)
          const on = !excluded.has(f.path) && f.kind !== 'conflict'
          return (
            <div
              key={f.path}
              className={`simple-card ${on ? '' : 'off'} kind-${f.kind}`}
              onDoubleClick={() => open(f)}
              title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}
            >
              {config.view === 'list' && <Include on={on} conflict={f.kind === 'conflict'} onToggle={() => toggle(f)} />}
              <button className="simple-card-open" onClick={() => open(f)} title={f.kind === 'removed' ? 'Open the last saved version' : 'Open'}>
                <Preview repo={path} file={f.path} hash={f.kind === 'removed' ? repo.headHash : null} refreshN={refreshN} size={config.view === 'list' ? 64 : 320} />
              </button>
              <div className="simple-card-text">
                <span className="simple-card-name">{name}</span>
                <span className="simple-card-dir">{dir.replace(/\/$/, '') || '(top folder)'}</span>
              </div>
              <span className={`simple-kind ${f.kind}`}>{KIND_LABEL[f.kind]}</span>
              <span className="simple-card-actions">
                {f.kind !== 'removed' && (
                  <button className="link-btn" onClick={() => window.spoon.revealInFinder(`${path}/${f.path}`)}>
                    {revealLabel}
                  </button>
                )}
                {f.kind !== 'conflict' && (
                  <button className="link-btn" disabled={!!busy} onClick={() => undo([f])}>
                    Undo…
                  </button>
                )}
              </span>
              {config.view !== 'list' && <Include on={on} conflict={f.kind === 'conflict'} onToggle={() => toggle(f)} />}
            </div>
          )
        })}
      </div>
      {files.length > limit && (
        <button className="btn simple-more" onClick={() => setLimit((l) => l + CARDS)}>
          Show {Math.min(CARDS, files.length - limit)} more of {files.length - limit}
        </button>
      )}
      {(hidden > 0 || hiddenByType > 0) && (
        <p className="faint simple-hidden">
          {[
            hidden > 0 && `${hidden} more changed ${hidden === 1 ? 'file is' : 'files are'} outside ${config.folder}`,
            hiddenByType > 0 && `${hiddenByType} ${hiddenByType === 1 ? 'is' : 'are'} of a hidden type`
          ]
            .filter(Boolean)
            .join('; ')}
          : not shown, and not saved.
        </p>
      )}

      <div className="simple-save">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="What did you change? For example: “New idle animation for the hero”"
          rows={2}
          spellCheck
        />
        <div className="simple-save-row">
          <span className="muted">
            {headCommit && (
              <>
                Last saved <span title={fullDate(headCommit.authorTime)}>{timeAgo(headCommit.authorTime)}</span>
              </>
            )}
          </span>
          <span className="spacer" />
          {p.blocked && <span className="muted">Saving is paused: see the note at the top.</span>}
          {primaryShares ? (
            <button className="btn" disabled={p.blocked || !!busy || !chosen.length || !message.trim()} onClick={() => save(false)}>
              Save only
            </button>
          ) : (
            <button className="btn" disabled={p.blocked || !!busy || !chosen.length || !message.trim()} onClick={() => save(true)}>
              Save & share
            </button>
          )}
          <button className="btn primary" disabled={p.blocked || !!busy || !chosen.length || !message.trim()} onClick={() => save(primaryShares)}>
            {primaryShares && <PushIcon />} {primaryShares ? 'Save & share' : 'Save'} {chosen.length > 0 && chosen.length < files.length ? `${chosen.length} ${chosen.length === 1 ? 'file' : 'files'}` : ''}{' '}
            <kbd className="keyed-key">{keys('⌘↵')}</kbd>
          </button>
        </div>
      </div>
    </div>
  )
}

/** Whether a file goes into the next save: a row of its own at the bottom of a card, a box in the list. */
function Include({ on, conflict, onToggle }: { on: boolean; conflict: boolean; onToggle: () => void }) {
  return (
    <button
      className={`simple-include ${on ? 'on' : ''}`}
      role="checkbox"
      aria-checked={on}
      disabled={conflict}
      onClick={onToggle}
      title={conflict ? 'A developer needs to sort this file out first' : on ? 'Leave this file out of the save' : 'Put this file in the save'}
    >
      <span className="simple-box">{on && <CheckIcon />}</span>
      <span className="simple-include-label">{conflict ? 'Needs a developer' : on ? 'In this save' : 'Left out'}</span>
    </button>
  )
}

// ---------- History ----------

const details = new Map<string, Promise<CommitDetails>>()
function detailsOf(path: string, hash: string): Promise<CommitDetails> {
  const key = `${path}|${hash}`
  let d = details.get(key)
  if (!d) {
    d = window.spoon.commitDetails(path, hash)
    d.catch(() => details.delete(key))
    details.set(key, d)
  }
  return d
}

const PAGE = 40

function dayLabel(unix: number): string {
  const d = new Date(unix * 1000)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (d.getTime() >= today) return 'Today'
  if (d.getTime() >= today - 86400000) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' })
}

function SimpleHistory(p: {
  path: string
  repo: RepoState
  commits: Commit[]
  config: SimpleConfig
  ops: Ops
  me: string
  busy: boolean
  onGetLatest: () => void
}) {
  const { repo, commits } = p
  const byHash = useMemo(() => new Map(commits.map((c) => [c.hash, c])), [commits])
  // The branch's own line of saves: first parents from the checked-out commit.
  const chain = useMemo(() => {
    const out: Commit[] = []
    for (let c = repo.headHash ? byHash.get(repo.headHash) : undefined; c; c = byHash.get(c.parents[0])) out.push(c)
    return out
  }, [byHash, repo.headHash])
  const head = repo.refs.find((r) => r.kind === 'head' && r.name === repo.headBranch)
  // The team's saves that are on the server but not here yet: the upstream's line down to where it
  // meets yours. They show above "You are here", as what's coming.
  const incoming = useMemo(() => {
    const up = head?.upstream ? repo.refs.find((r) => r.kind === 'remote' && r.name === head.upstream)?.target : undefined
    if (!up || !repo.headHash) return []
    const mine = new Set<string>()
    const todo = [repo.headHash]
    while (todo.length) {
      const h = todo.pop()!
      if (mine.has(h)) continue
      mine.add(h)
      for (const parent of byHash.get(h)?.parents ?? []) todo.push(parent)
    }
    const out: Commit[] = []
    for (let c = byHash.get(up); c && !mine.has(c.hash); c = byHash.get(c.parents[0])) out.push(c)
    return out
  }, [byHash, head?.upstream, repo.refs, repo.headHash])
  const [limit, setLimit] = useState(PAGE)
  const [open, setOpen] = useState<string | null>(null)
  // Without an upstream there's no telling which saves the team already has (they can be on other branches).
  const unshared = head?.upstream ? (head.ahead ?? 0) : 0
  const toggle = (hash: string) => () => setOpen((o) => (o === hash ? null : hash))

  if (!chain.length) return <div className="simple-body empty-state muted">Nothing has been saved here yet.</div>

  const shown = chain.slice(0, limit)
  let lastDay = ''
  return (
    <div className="simple-body">
      <div className="simple-timeline">
        {incoming.length > 0 && (
          <div className="simple-coming">
            <div className="simple-coming-head">
              <span>
                <b>
                  {incoming.length} new {incoming.length === 1 ? 'save' : 'saves'} from the team
                </b>{' '}
                <span className="muted">not on your computer yet</span>
              </span>
              <button className="btn primary has-news" disabled={p.busy} onClick={p.onGetLatest}>
                <PullIcon /> Get latest
              </button>
            </div>
            {incoming.map((c) => (
              <SaveRow key={c.hash} {...p} commit={c} future open={open === c.hash} onToggle={toggle(c.hash)} />
            ))}
          </div>
        )}
        <div className="simple-here">
          <span className="simple-here-dot" />
          You are here
          {head?.upstream && !incoming.length && <span className="muted"> · up to date with the team</span>}
        </div>
        {shown.map((c, i) => {
          const day = dayLabel(c.authorTime)
          const header = day !== lastDay ? <h4 className="simple-day">{day}</h4> : null
          lastDay = day
          return (
            <div key={c.hash}>
              {header}
              <SaveRow {...p} commit={c} local={i < unshared} open={open === c.hash} onToggle={toggle(c.hash)} />
            </div>
          )
        })}
        {chain.length > limit && (
          <button className="btn simple-more" onClick={() => setLimit((l) => l + PAGE)}>
            Show older saves
          </button>
        )}
      </div>
    </div>
  )
}

function SaveRow(p: {
  path: string
  commit: Commit
  config: SimpleConfig
  ops: Ops
  me: string
  /** On the server, not here yet. */
  future?: boolean
  /** Here, not on the server yet. */
  local?: boolean
  open: boolean
  onToggle: () => void
}) {
  const { path, commit: c, config } = p
  const [d, setD] = useState<CommitDetails | null>(null)
  useEffect(() => {
    let live = true
    detailsOf(path, c.hash).then((x) => live && setD(x), () => undefined)
    return () => {
      live = false
    }
  }, [path, c.hash])
  // The same files My changes would show: in the folder, and of a type that isn't hidden.
  const test = inFolder(config.folder)
  const files = d?.files.filter((f) => test(f.path) && !config.hiddenTypes.includes(typeGroupOf(f.path) ?? '')) ?? []
  const elsewhere = (d?.files.length ?? 0) - files.length
  const merge = c.parents.length > 1
  const mine = !!p.me && c.authorName === p.me
  const who = mine ? 'You' : (c.authorName.split(/\s+/)[0] ?? c.authorName)
  const n = files.length
  const headline = merge
    ? `${who} combined ${mine ? 'your' : 'their'} work with the team’s`
    : !d
      ? `${who} saved`
      : n === 0 && elsewhere
        ? `${who} saved ${elsewhere} other ${elsewhere === 1 ? 'file' : 'files'}`
        : `${who} saved ${n} ${n === 1 ? 'file' : 'files'}`
  // Up to three previews on the row; the rest as a count.
  const peek = files.filter((f) => f.status !== 'D').slice(0, 3)
  const more = files.length - peek.length

  const restore = useCallback(
    async (f: FileChange): Promise<void> => {
      const name = splitPath(f.path).name
      // A file this save removed comes back as it was just before.
      const from = f.status === 'D' ? c.parents[0] : c.hash
      if (!from) return
      const ok = await confirm({
        message: f.status === 'D' ? `Bring back ${name}?` : `Put back ${name} as it was in this save?`,
        detail: `Your current ${name} is replaced (if you changed it since your last save, that version goes to the Trash first). It then shows up under My changes, where you can save it.`,
        confirmLabel: f.status === 'D' ? 'Bring Back' : 'Put Back',
        risky: true
      })
      if (ok)
        p.ops.run(
          `Restoring ${name}…`,
          async () => {
            await window.spoon.restoreFileFrom(path, from, f.path)
            // Its Unity .meta too, so it keeps its GUID and whatever uses it still finds it.
            if (!f.path.endsWith('.meta')) await window.spoon.restoreFileFrom(path, from, `${f.path}.meta`).catch(() => undefined)
          },
          'Couldn’t put the file back'
        )
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [path, c.hash]
  )
  const openVersion = (f: FileChange): void => {
    const at = f.status === 'D' ? c.parents[0] : c.hash
    if (!at) return
    if (isPreviewable(f.path)) void window.spoon.openAtCommit(path, at, f.path)
    else openFileEditor({ repo: path, file: f.path, at: { hash: at, label: 'this save' }, show: 'commit' })
  }

  return (
    <div className={`simple-save-row-h ${p.open ? 'open' : ''} ${p.future ? 'future' : ''} ${mine ? 'mine' : ''}`}>
      <button className="simple-save-head" onClick={p.onToggle}>
        <span className="simple-avatar" style={{ '--hue': hueFor(c.authorName) } as React.CSSProperties} title={c.authorName}>
          {initials(c.authorName)}
        </span>
        <span className="simple-save-text">
          <span className="simple-save-who" title={c.authorName}>
            {headline}
          </span>
          <span className="muted simple-save-msg">
            {!merge && <>“{c.subject}” · </>}
            <span title={fullDate(c.authorTime)}>{timeAgo(c.authorTime)}</span>
          </span>
        </span>
        {p.local && <span className="badge warn" title="This save hasn’t been shared with the team yet">Only on this computer</span>}
        {p.future && <span className="badge accent-soft">Coming</span>}
        {!p.open && peek.length > 0 && (
          <span className="simple-peek">
            {peek.map((f) => (
              <Preview key={f.path} repo={path} file={f.path} hash={c.hash} refreshN={0} size={96} />
            ))}
            {more > 0 && <span className="simple-peek-more">+{more}</span>}
          </span>
        )}
      </button>
      {p.open && (
        <div className="simple-save-files">
          {!d ? (
            <span className="muted">Loading…</span>
          ) : !files.length ? (
            <span className="muted">{elsewhere ? `Only files of hidden types${config.folder ? ` or outside ${config.folder}` : ''}.` : 'No files changed.'}</span>
          ) : (
            files.map((f) => {
              const { dir, name } = splitPath(f.path)
              const kind: Kind = f.status === 'A' ? 'new' : f.status === 'D' ? 'removed' : f.status === 'R' ? 'renamed' : 'changed'
              return (
                <div key={f.path} className="simple-hfile" title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}>
                  <button className="simple-card-open" onClick={() => openVersion(f)} title="Open this version">
                    <Preview repo={path} file={f.path} hash={f.status === 'D' ? (c.parents[0] ?? null) : c.hash} refreshN={0} size={128} />
                  </button>
                  <div className="simple-card-text">
                    <span className="simple-card-name">{name}</span>
                    <span className="simple-card-dir">{dir.replace(/\/$/, '') || '(top folder)'}</span>
                  </div>
                  <span className={`simple-kind ${kind}`}>{KIND_LABEL[kind]}</span>
                  <button className="link-btn" onClick={() => openVersion(f)}>
                    Open
                  </button>
                  {/* A save that isn't here yet gets put in place by Get latest, not file by file. */}
                  {!merge && !p.future && (
                    <button className="link-btn" onClick={() => restore(f)}>
                      {f.status === 'D' ? 'Bring back…' : 'Put back this version…'}
                    </button>
                  )}
                </div>
              )
            })
          )}
          {elsewhere > 0 && files.length > 0 && (
            <span className="faint">
              +{elsewhere} other {elsewhere === 1 ? 'file' : 'files'} (of hidden types{config.folder ? ` or outside ${config.folder}` : ''})
            </span>
          )}
        </div>
      )}
    </div>
  )
}
