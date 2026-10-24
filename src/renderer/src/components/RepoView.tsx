import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CheckoutTarget, Commit, MenuCommand, PullSummary, Ref, RepoState, WorkingTree } from '../../../shared/types'
import { useGitHubAccount } from '../github'
import { PullRequestView } from './PullRequestView'
import { buildGraph, type ColorRules } from '../graph'
import { reservedPrefixes, useSettings } from '../settings'
import { jiraConfig, jiraUrl, ticketKeys } from '../jira'
import { cleanError, usePersistentState } from '../hooks'
import { setKnownAuthors } from '../authors'
import { Split } from './Split'
import { Sidebar } from './Sidebar'
import { CommitList } from './CommitList'
import { CommitPanel } from './CommitPanel'
import { ChangesView } from './ChangesView'
import { ErrorModal } from './Modal'
import { PullDialog, PushDialog } from './SyncDialogs'
import { ParentChip, SubmoduleChip, submoduleActions } from './Submodules'
import { NetButton, type NetKind, type NetState } from './NetButton'
import { DeleteBranchDialog } from './DeleteBranchDialog'
import { FetchIcon, JiraIcon, PullIcon, PullRequestIcon, PushIcon, RefreshIcon, SearchIcon, CloseIcon } from './Icons'
import { keys } from '../platform'

const PullRequestIconLarge = () => <PullRequestIcon className="icon big-icon" />

const LOG_LIMIT = 5000

export type View = 'history' | 'changes' | 'prs'

/** Repo-level actions handed to child views. */
export interface Ops {
  /** Runs after any operation already in flight, refreshes afterwards, shows git's error on failure. */
  run: (label: string, fn: () => Promise<unknown>, failTitle: string) => Promise<boolean>
  checkout: (target: CheckoutTarget, description: string) => void
}

interface Busy {
  label: string
  network: boolean
  progress?: string
}

interface Props {
  path: string
  command: { name: MenuCommand; n: number } | null
  onOpenRepo: (path: string) => void
  onOpenSettings: (tab: 'accounts') => void
}

export function RepoView({ path, command, onOpenRepo, onOpenSettings }: Props) {
  const [repo, setRepo] = useState<RepoState | null>(null)
  const [commits, setCommits] = useState<Commit[]>([])
  const [tree, setTree] = useState<WorkingTree>({ staged: [], unstaged: [] })
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = usePersistentState<View>(`spoon.view.${path}`, 'history')
  const [selected, setSelected] = useState<string | null>(null)
  const [scrollTo, setScrollTo] = useState<{ hash: string; n: number } | null>(null)
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState<Busy | null>(null)
  const [opError, setOpError] = useState<{ title: string; message: string } | null>(null)
  const [dialog, setDialog] = useState<'pull' | 'push' | null>(null)
  const [commitRequest, setCommitRequest] = useState(0)
  const clearCommitRequest = useCallback(() => setCommitRequest(0), [])
  const refsSignature = useRef('')
  // The most recently loaded history, readable right after an operation (before React re-renders).
  const lastLog = useRef<Commit[]>([])
  const [net, setNet] = useState<NetState | null>(null)
  const [deleting, setDeleting] = useState<Ref | null>(null)
  // Commits that just arrived (fetch/pull); the list slides them in and flashes them once.
  const [fresh, setFresh] = useState<{ hashes: Set<string>; n: number } | null>(null)
  const account = useGitHubAccount()
  const [ghSlug, setGhSlug] = useState<string | null | undefined>(undefined)
  const [prs, setPrs] = useState<PullSummary[] | null>(null)
  const [prError, setPrError] = useState<string | null>(null)
  const [selectedPr, setSelectedPr] = usePersistentState<number | null>(`spoon.pr.selected.${path}`, null)
  const prsLoadedAt = useRef(0)
  const queue = useRef<Promise<unknown>>(Promise.resolve())

  const load = useCallback(async () => {
    try {
      const [r, t] = await Promise.all([window.spoon.openRepo(path), window.spoon.workingTree(path)])
      setRepo(r)
      setTree(t)
      setError(null)
      // Only re-read history when a ref moved; status refreshes are cheap and frequent.
      const sig = `${r.headHash}|${r.refs.map((x) => x.fullName + x.target).join(',')}`
      if (sig !== refsSignature.current) {
        refsSignature.current = sig
        const log = await window.spoon.log(path, LOG_LIMIT)
        lastLog.current = log
        setCommits(log)
        setKnownAuthors(log.map((c) => c.authorName))
        setSelected((s) => (s && log.some((c) => c.hash === s) ? s : r.headHash))
      }
    } catch (err) {
      setError(cleanError(err))
    }
  }, [path])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    window.addEventListener('focus', load)
    return () => window.removeEventListener('focus', load)
  }, [load])

  useEffect(() => {
    window.spoon.ghRepo(path).then(setGhSlug)
  }, [path])

  // Pull requests: loaded when the account and a GitHub remote are there, refreshed at most once a minute.
  const loadPrs = useCallback(
    async (force = false) => {
      if (!account || !ghSlug) return
      if (!force && Date.now() - prsLoadedAt.current < 60_000) return
      prsLoadedAt.current = Date.now()
      try {
        setPrs(await window.spoon.ghPulls(path))
        setPrError(null)
      } catch (err) {
        setPrError(cleanError(err))
      }
    },
    [account, ghSlug, path]
  )
  useEffect(() => {
    loadPrs(true)
  }, [loadPrs])
  useEffect(() => {
    const onFocus = (): void => void loadPrs()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [loadPrs])

  useEffect(
    () =>
      window.spoon.onProgress((repoPath, line) => {
        if (repoPath !== path) return
        setBusy((b) => (b ? { ...b, progress: line } : b))
        // Follow the transfer itself; counting/compressing phases keep the ring indeterminate.
        const pct = /(?:Receiving|Writing) objects:\s+(\d{1,3})%/.exec(line)?.[1]
        if (pct) setNet((n) => (n?.phase === 'working' ? { ...n, pct: Number(pct) } : n))
      }),
    [path]
  )

  const run = useCallback<Ops['run']>(
    (label, fn, failTitle) => {
      const network = /^(Fetch|Pull|Push)/.test(label)
      // Serialize git writes so quick clicks never collide on index.lock.
      const task = queue.current.then(async () => {
        setBusy({ label, network })
        try {
          await fn()
          return true
        } catch (err) {
          setOpError({ title: failTitle, message: cleanError(err) })
          return false
        } finally {
          setBusy(null)
          await load()
        }
      })
      queue.current = task
      return task
    },
    [load]
  )

  const checkout = useCallback<Ops['checkout']>(
    async (target, description) => {
      if (target.kind === 'commit') {
        const ok = await window.spoon.confirm({
          message: `Check out ${description}?`,
          detail: 'This puts the repository in detached HEAD state. New commits won’t belong to any branch until you create one.',
          confirmLabel: 'Checkout'
        })
        if (!ok) return
      }
      run(`Checking out ${description}…`, () => window.spoon.checkout(path, target), 'Checkout failed')
    },
    [path, run]
  )

  const ops = useMemo<Ops>(() => ({ run, checkout }), [run, checkout])
  const subActions = useMemo(() => submoduleActions(path, ops, onOpenRepo), [path, ops, onOpenRepo])

  // Fetch/pull/push with their button animation: working (ring follows git's %), then done
  // (check, "+N" new commits, which also slide into the list) or failed (shake).
  const netOp = async (kind: NetKind, label: string, fn: () => Promise<unknown>, failTitle: string): Promise<void> => {
    const before = new Set(lastLog.current.map((c) => c.hash))
    setNet({ kind, phase: 'working' })
    const ok = await run(label, fn, failTitle)
    const arrived = lastLog.current.filter((c) => !before.has(c.hash)).map((c) => c.hash)
    setNet({ kind, phase: ok ? 'done' : 'failed', gained: kind === 'push' ? 0 : arrived.length })
    if (ok && arrived.length && before.size) setFresh({ hashes: new Set(arrived), n: Date.now() })
    setTimeout(() => setNet((n) => (n?.kind === kind && n.phase !== 'working' ? null : n)), ok ? 1800 : 1400)
  }

  const fetchAll = (): void => {
    // Prune, so branches whose remote was deleted show up as stale.
    netOp('fetch', 'Fetching…', () => window.spoon.fetch(path, true), 'Fetch failed')
  }

  useEffect(() => {
    if (!command) return
    if (command.name === 'refresh') load()
    else if (command.name === 'fetch') fetchAll()
    else if (command.name === 'pull') setDialog('pull')
    else if (command.name === 'push') setDialog('push')
    else if (command.name === 'commit') {
      setView('changes')
      setCommitRequest(Date.now())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command])

  const settings = useSettings()
  const graph = useMemo(() => {
    const prefixes = reservedPrefixes(settings)
    if (!settings.reservedColorsGraph || !prefixes.length || !repo) return buildGraph(commits)
    // Branch names per commit (remote ones without "origin/"), to match against reserved prefixes.
    const names = new Map<string, string[]>()
    for (const r of repo.refs) {
      if (r.kind !== 'head' && r.kind !== 'remote') continue
      const remote = r.kind === 'remote' ? repo.remotes.find((x) => r.name.startsWith(`${x}/`)) : undefined
      const name = remote ? r.name.slice(remote.length + 1) : r.name
      names.set(r.target, [...(names.get(r.target) ?? []), name])
    }
    const reservedIdx = new Set(prefixes.map(([, i]) => i))
    const free = [0, 1, 2, 3, 4, 5, 6, 7].filter((i) => !reservedIdx.has(i))
    const rules: ColorRules = {
      free: free.length ? free : [0, 1, 2, 3, 4, 5, 6, 7],
      colorAt: (hash) => {
        for (const n of names.get(hash) ?? []) for (const [p, i] of prefixes) if (n.startsWith(p)) return i
        return null
      }
    }
    return buildGraph(commits, rules)
  }, [commits, repo, settings])

  const jumpTo = (hash: string): void => {
    setView('history')
    setFilter('')
    setSelected(hash)
    setScrollTo({ hash, n: Date.now() })
  }

  if (error && !repo) {
    return (
      <div className="empty-state">
        <p>Couldn’t open this repository.</p>
        <pre>{error}</pre>
        <button className="btn" onClick={load}>
          Try again
        </button>
      </div>
    )
  }
  if (!repo) return <div className="empty-state muted">Loading…</div>

  const changeCount = new Set([...tree.staged, ...tree.unstaged].map((f) => f.path)).size
  const head = repo.refs.find((r) => r.kind === 'head' && r.name === repo.headBranch)
  const networkBusy = !!busy?.network

  return (
    <div className="repo">
      <div className="toolbar">
        <div className="toolbar-repo">
          <button
            className="branch-chip"
            title="Show the checked-out commit"
            disabled={!repo.headHash}
            onClick={() => repo.headHash && jumpTo(repo.headHash)}
          >
            {repo.headBranch ?? `detached at ${repo.headHash?.slice(0, 7) ?? '—'}`}
          </button>
          {(() => {
            const jira = jiraConfig(settings)
            const key = ticketKeys(repo.headBranch ?? '', jira)[0]
            return key && jira ? (
              <button className="jira-chip" title={`Open ${key} in Jira`} onClick={() => window.spoon.openExternal(jiraUrl(jira, key))}>
                <JiraIcon /> {key}
              </button>
            ) : null
          })()}
          {repo.operation && <span className="op-chip">{repo.operation}</span>}
          {repo.superproject && <ParentChip parent={repo.superproject} onOpen={onOpenRepo} />}
          <SubmoduleChip submodules={repo.submodules} actions={subActions} />
        </div>

        <div className="toolbar-actions">
          <NetButton
            kind="fetch"
            label="Fetch"
            shortcut={keys('⇧⌘F')}
            title={`Fetch all remotes (${keys('⇧⌘F')})`}
            Icon={FetchIcon}
            net={net}
            disabled={networkBusy}
            onClick={fetchAll}
          />
          <NetButton
            kind="pull"
            label="Pull"
            shortcut={keys('⇧⌘L')}
            title={`Pull (${keys('⇧⌘L')})`}
            Icon={PullIcon}
            net={net}
            badge={head?.behind}
            disabled={networkBusy}
            onClick={() => setDialog('pull')}
          />
          <NetButton
            kind="push"
            label="Push"
            shortcut={keys('⇧⌘P')}
            title={`Push (${keys('⇧⌘P')})`}
            Icon={PushIcon}
            net={net}
            badge={head?.ahead}
            disabled={networkBusy}
            onClick={() => setDialog('push')}
          />
        </div>

        <div className="toolbar-right">
          {busy && (
            <div className="activity" title={busy.progress}>
              <span className="spinner" />
              <span className="activity-text">
                {busy.label}
                {busy.progress && <span className="muted"> {busy.progress}</span>}
              </span>
            </div>
          )}
          <div className="search">
            <SearchIcon />
            <input
              placeholder="Filter commits"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value)
                setView('history')
              }}
              onKeyDown={(e) => e.key === 'Escape' && setFilter('')}
            />
            {filter && (
              <button className="icon-btn" onClick={() => setFilter('')} aria-label="Clear filter">
                <CloseIcon />
              </button>
            )}
          </div>
          <button className="icon-btn" onClick={load} title={`Refresh (${keys('⌘R')})`}>
            <RefreshIcon />
          </button>
        </div>
      </div>

      {error && <div className="banner error">{error}</div>}

      <Split id="sidebar" direction="row" mode="rem" initial={17} min={11} max={36}>
        <Sidebar
          repo={repo}
          changeCount={changeCount}
          view={view}
          onView={setView}
          onJump={jumpTo}
          ops={ops}
          subActions={subActions}
          prs={ghSlug ? (account ? prs : []) : undefined}
          prError={!account && ghSlug ? 'Connect GitHub in Settings → Accounts.' : prError}
          selectedPr={selectedPr}
          onSelectPr={setSelectedPr}
          onDeleteBranch={setDeleting}
        />
        {view === 'prs' ? (
          !account ? (
            <div className="empty-state">
              <PullRequestIconLarge />
              <p>Connect GitHub to see and review this repository’s pull requests.</p>
              <button className="btn primary" onClick={() => onOpenSettings('accounts')}>
                Connect GitHub…
              </button>
            </div>
          ) : selectedPr ? (
            <PullRequestView key={selectedPr} path={path} number={selectedPr} ops={ops} onJump={jumpTo} />
          ) : (
            <div className="empty-state muted">Select a pull request.</div>
          )
        ) : view === 'changes' ? (
          <ChangesView
            path={path}
            tree={tree}
            ops={ops}
            commitRequest={commitRequest}
            onCommitHandled={clearCommitRequest}
          />
        ) : (
          <Split id="history" direction="column" mode="fraction" initial={0.55} min={0.15} max={0.85}>
            <CommitList
              commits={commits}
              graph={graph}
              repo={repo}
              selected={selected}
              onSelect={setSelected}
              scrollTo={scrollTo}
              filter={filter}
              truncated={commits.length >= LOG_LIMIT}
              fresh={fresh}
              onDeleteBranch={setDeleting}
              ops={ops}
            />
            <CommitPanel path={path} hash={selected} onJump={jumpTo} />
          </Split>
        )}
      </Split>

      {dialog === 'pull' && (
        <PullDialog
          path={path}
          onClose={() => setDialog(null)}
          onPull={(opts) => netOp('pull', 'Pulling…', () => window.spoon.pull(path, opts), 'Pull failed')}
        />
      )}
      {dialog === 'push' && (
        <PushDialog
          path={path}
          onClose={() => setDialog(null)}
          onPush={(opts) => netOp('push', 'Pushing…', () => window.spoon.push(path, opts), 'Push failed')}
        />
      )}
      {deleting && repo && (
        <DeleteBranchDialog
          branch={deleting}
          repo={repo}
          onClose={() => setDeleting(null)}
          onDelete={(remote) => {
            const name = deleting.name
            run(
              `Deleting ${name}…`,
              async () => {
                const res = await window.spoon.deleteBranches(path, [name], false)
                if (res.unmerged.length) {
                  const force = await window.spoon.confirm({
                    message: `${name} has commits that aren’t on any other branch`,
                    detail: 'Deleting it drops those commits (git keeps them in the reflog for a while).',
                    confirmLabel: 'Delete anyway'
                  })
                  if (!force) return
                  await window.spoon.deleteBranches(path, [name], true)
                }
                if (remote) await window.spoon.deleteRemoteBranch(path, remote.remote, remote.branch)
              },
              'Delete failed'
            )
          }}
        />
      )}
      {opError && <ErrorModal title={opError.title} message={opError.message} onClose={() => setOpError(null)} />}
    </div>
  )
}
