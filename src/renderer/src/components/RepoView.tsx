import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  CheckoutTarget,
  Commit,
  MenuCommand,
  PullSummary,
  RebasePlan,
  Ref,
  RepoState,
  Submodule,
  WorkingTree
} from '../../../shared/types'
import { useGitHubAccount } from '../github'
import { PullRequestView } from './PullRequestView'
import { useSettings } from '../settings'
import { cachedGraph, graphKeyOf, LOG_LIMIT, markLoaded, prStateOf, refsSignatureOf, snapshots } from '../repoCache'
import { jiraConfig, jiraUrl, ticketKeys } from '../jira'
import { cleanError, usePersistentState } from '../hooks'
import { confirm } from '../dialogs'
import { setKnownAuthors } from '../authors'
import { Split } from './Split'
import { Sidebar } from './Sidebar'
import { CommitList } from './CommitList'
import { CommitPanel } from './CommitPanel'
import { ChangesView } from './ChangesView'
import { ErrorModal, overlayOpen } from './Modal'
import { PullDialog, PushDialog } from './SyncDialogs'
import { ParentChip, SubmoduleChip, submoduleActions } from './Submodules'
import { NetButton, type NetKind, type NetState } from './NetButton'
import { DeleteBranchDialog } from './DeleteBranchDialog'
import { RebaseEditor } from './RebaseEditor'
import { RebaseBanner } from './RebaseBanner'
import { SubmoduleUpdateDialog } from './SubmoduleUpdateDialog'
import { MainLibDialog } from './MainLibDialog'
import { CreatePullDialog } from './CreatePullDialog'
import { ReviewDialog } from './ReviewDialog'
import { ClaudeIcon, CloseIcon, FetchIcon, JiraIcon, PullIcon, PullRequestIcon, PushIcon, RefreshIcon, SearchIcon } from './Icons'
import { keys } from '../platform'

const PullRequestIconLarge = () => <PullRequestIcon className="icon big-icon" />

export type View = 'history' | 'changes' | 'prs'

/** Repo-level actions handed to child views. */
export interface Ops {
  /** Runs after any operation already in flight, refreshes afterwards, shows git's error on failure. */
  run: (label: string, fn: () => Promise<unknown>, failTitle: string) => Promise<boolean>
  checkout: (target: CheckoutTarget, description: string) => void
  /** Rebase the current branch onto a branch; interactive opens the editable plan first. */
  rebase: (onto: string, interactive: boolean) => void
  /** Push the current branch to its upstream (or origin) without the Push dialog. */
  push: () => void
  /** Open the Create Pull Request dialog for a local branch (null when GitHub isn't set up here). */
  createPull: ((branch: string) => void) | null
  /** Open Review with Claude: local changes by default, or one commit (null when Claude is turned off). */
  review: ((commit?: { hash: string; subject: string }) => void) | null
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

/** Keeps the previous object when nothing changed, so memos and rows keyed on it don't recompute. */
function same<T>(prev: T | null, next: T): T {
  return prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next
}

export function RepoView({ path, command, onOpenRepo, onOpenSettings }: Props) {
  const snap = snapshots.get(path)
  const [repo, setRepo] = useState<RepoState | null>(snap?.repo ?? null)
  const repoRef = useRef<RepoState | null>(null)
  repoRef.current = repo
  const [commits, setCommits] = useState<Commit[]>(snap?.commits ?? [])
  const [tree, setTree] = useState<WorkingTree>(snap?.tree ?? { staged: [], unstaged: [] })
  // Counts completed refreshes: the open diff reloads on each, since a file can change without its status changing.
  const [refreshN, setRefreshN] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = usePersistentState<View>(`spoon.view.${path}`, 'history')
  const [selected, setSelected] = useState<string | null>(snap?.selected ?? null)
  const [scrollTo, setScrollTo] = useState<{ hash: string; n: number } | null>(null)
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState<Busy | null>(null)
  const [opError, setOpError] = useState<{ title: string; message: string } | null>(null)
  const [dialog, setDialog] = useState<'pull' | 'push' | null>(null)
  // ⌘↵ / ⌥⌘↵ from the menu: commit, optionally followed by a push.
  const [commitRequest, setCommitRequest] = useState<{ push: boolean; n: number } | null>(null)
  const clearCommitRequest = useCallback(() => setCommitRequest(null), [])
  const [discardRequest, setDiscardRequest] = useState(0)
  const clearDiscardRequest = useCallback(() => setDiscardRequest(0), [])
  const refsSignature = useRef(snap?.refsSignature ?? '')
  // The most recently loaded history, readable right after an operation (before React re-renders).
  const lastLog = useRef<Commit[]>(snap?.commits ?? [])
  const [net, setNet] = useState<NetState | null>(null)
  const [deleting, setDeleting] = useState<Ref | null>(null)
  const [subUpdate, setSubUpdate] = useState<Submodule | null>(null)
  const [prFor, setPrFor] = useState<string | null>(null)
  const [reviewing, setReviewing] = useState<{ commit?: { hash: string; subject: string } } | null>(null)
  // Interactive rebase being planned: the commit list turns into its editor.
  const [rebasing, setRebasing] = useState<{ onto: string; branch: string; plan: RebasePlan } | null>(null)
  // Commits that just arrived (fetch/pull); the list slides them in and flashes them once.
  const [fresh, setFresh] = useState<{ hashes: Set<string>; n: number } | null>(null)
  const account = useGitHubAccount()
  // Kept per repo outside the component, so switching tabs doesn't refetch them.
  const prState = prStateOf(path)
  const [ghSlug, setGhSlug] = useState<string | null | undefined>(prState.slug)
  const [prs, setPrs] = useState<PullSummary[] | null>(prState.prs)
  const [prError, setPrError] = useState<string | null>(prState.error)
  const [selectedPr, setSelectedPr] = usePersistentState<number | null>(`spoon.pr.selected.${path}`, null)
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const wasCancelled = useRef(false)
  const latestProgress = useRef('')
  const progressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const filterInput = useRef<HTMLInputElement>(null)
  // The refresh button spins for at least one turn, so a quick refresh still shows it happened.
  const [refreshing, setRefreshing] = useState(false)
  const manualRefresh = (): void => {
    setRefreshing(true)
    Promise.all([load(), new Promise((r) => setTimeout(r, 600))]).finally(() => setRefreshing(false))
  }

  const loadOnce = useCallback(async () => {
    try {
      const [r, t] = await Promise.all([window.spoon.openRepo(path), window.spoon.workingTree(path)])
      const nextRepo = same(repoRef.current, r)
      setRepo(nextRepo)
      setTree((prev) => same(prev, t))
      setError(null)
      // Only re-read history when a ref moved; status refreshes are cheap and frequent.
      const sig = refsSignatureOf(r)
      if (sig !== refsSignature.current) {
        const log = await window.spoon.log(path, LOG_LIMIT)
        // Only now: if reading the log failed, the next refresh tries again.
        refsSignature.current = sig
        lastLog.current = log
        setCommits(log)
        setKnownAuthors(log.map((c) => c.authorName))
        setSelected((s) => (s && log.some((c) => c.hash === s) ? s : r.headHash))
      }
      const prev = snapshots.get(path)
      const sameLog = prev?.commits === lastLog.current
      snapshots.set(path, {
        repo: nextRepo,
        tree: t,
        commits: lastLog.current,
        refsSignature: refsSignature.current,
        selected: prev?.selected ?? null,
        graph: sameLog ? prev?.graph : undefined,
        graphKey: sameLog ? prev?.graphKey : undefined
      })
      setRefreshN((n) => n + 1)
      markLoaded(path)
    } catch (err) {
      setError(cleanError(err))
    }
  }, [path])

  // One refresh at a time: a request made while one runs queues a single follow-up, so a slow
  // earlier read can never overwrite a newer one, and bursts of focus events collapse into one.
  const inFlight = useRef<Promise<void> | null>(null)
  const again = useRef(false)
  const lastLoadAt = useRef(0)
  const load = useCallback((): Promise<void> => {
    if (inFlight.current) {
      again.current = true
      return inFlight.current
    }
    const p = (async () => {
      try {
        do {
          again.current = false
          await loadOnce()
        } while (again.current)
      } finally {
        inFlight.current = null
        lastLoadAt.current = Date.now()
      }
    })()
    inFlight.current = p
    return p
  }, [loadOnce])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    // Refocusing right after a refresh (e.g. closing a dialog) doesn't need another one.
    const onFocus = (): void => {
      if (Date.now() - lastLoadAt.current > 1500) load()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [load])

  useEffect(() => {
    const s = snapshots.get(path)
    if (s) s.selected = selected
  }, [path, selected])

  useEffect(() => {
    if (prStateOf(path).slug !== undefined) return
    window.spoon.ghRepo(path).then((slug) => {
      prStateOf(path).slug = slug
      setGhSlug(slug)
    })
  }, [path])

  // Pull requests: loaded when the account and a GitHub remote are there, refreshed at most once a minute.
  const loadPrs = useCallback(
    async (force = false) => {
      if (!account || !ghSlug) return
      const st = prStateOf(path)
      if (!force && st.prs && Date.now() - st.loadedAt < 60_000) return
      st.loadedAt = Date.now()
      try {
        st.prs = await window.spoon.ghPulls(path)
        st.error = null
      } catch (err) {
        st.error = cleanError(err)
      }
      setPrs(st.prs)
      setPrError(st.error)
    },
    [account, ghSlug, path]
  )
  useEffect(() => {
    loadPrs()
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
        // git prints progress many times a second; show it at most ~10 times a second, and only touch
        // the ring when the percentage actually moves, so the toolbar animation stays smooth.
        latestProgress.current = line
        if (!progressTimer.current)
          progressTimer.current = setTimeout(() => {
            progressTimer.current = null
            const l = latestProgress.current
            setBusy((b) => (b && b.progress !== l ? { ...b, progress: l } : b))
          }, 100)
        // Follow the transfer itself; counting/compressing phases keep the ring indeterminate.
        const pct = /(?:Receiving|Writing) objects:\s+(\d{1,3})%/.exec(line)?.[1]
        if (pct) setNet((n) => (n?.phase === 'working' && n.pct !== Number(pct) ? { ...n, pct: Number(pct) } : n))
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
          const message = cleanError(err)
          // Stopped with the Cancel button: that's not a failure to report.
          wasCancelled.current = message === 'Cancelled.'
          if (!wasCancelled.current) setOpError({ title: failTitle, message })
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
        const ok = await confirm({
          message: `Check out ${description}?`,
          detail:
            'This puts the repository in detached HEAD state. New commits won’t belong to any branch until you create one.',
          confirmLabel: 'Checkout'
        })
        if (!ok) return
      }
      run(`Checking out ${description}…`, () => window.spoon.checkout(path, target), 'Checkout failed')
    },
    [path, run]
  )

  const rebase = useCallback<Ops['rebase']>(
    async (onto, interactive) => {
      const branch = repoRef.current?.headBranch
      if (!branch) return
      let plan: RebasePlan
      try {
        plan = await window.spoon.rebasePlan(path, onto)
      } catch (err) {
        setOpError({ title: 'Rebase failed', message: cleanError(err) })
        return
      }
      if (interactive) {
        if (!plan.commits.length) {
          setOpError({
            title: 'Nothing to rebase',
            message: `${branch} has no commits that aren’t already on ${onto}.`
          })
          return
        }
        setView('history')
        setFilter('')
        setRebasing({ onto, branch, plan })
        return
      }
      const n = plan.commits.length
      const ok = await confirm({
        message: `Rebase ${branch} onto ${onto}?`,
        detail: [
          n
            ? `${n} ${n === 1 ? 'commit' : 'commits'} will be replayed on top of ${onto}.`
            : `${branch} has no commits of its own; it moves to ${onto}.`,
          plan.pushed ? 'Some of them are already pushed, so you’ll need to force push afterwards.' : '',
          plan.merges ? `${plan.merges} merge ${plan.merges === 1 ? 'commit' : 'commits'} will be flattened.` : ''
        ]
          .filter(Boolean)
          .join(' '),
        confirmLabel: 'Rebase'
      })
      if (ok) run(`Rebasing onto ${onto}…`, () => window.spoon.rebase(path, onto), 'Rebase failed')
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [path, run]
  )

  // Defined further down (it uses the Push button's animation); read through a ref so ops stays stable.
  const quickPushRef = useRef<() => void>(() => undefined)
  const canCreatePull = !!account && !!ghSlug
  const claudeEnabled = useSettings().claudeEnabled
  const ops = useMemo<Ops>(
    () => ({
      run,
      checkout,
      rebase,
      push: () => quickPushRef.current(),
      createPull: canCreatePull ? setPrFor : null,
      review: claudeEnabled ? (commit) => setReviewing({ commit }) : null
    }),
    [run, checkout, rebase, canCreatePull, claudeEnabled]
  )
  const [mainlibFor, setMainlibFor] = useState<Submodule | null>(null)
  const mainlibName = useSettings().mainlibName
  const subActions = useMemo(
    () => submoduleActions(path, ops, onOpenRepo, setSubUpdate, mainlibName, setMainlibFor),
    [path, ops, onOpenRepo, mainlibName]
  )

  // Fetch/pull/push with their button animation: working (ring follows git's %), then done
  // (check, "+N" new commits, which also slide into the list) or failed (shake).
  const netOp = async (kind: NetKind, label: string, fn: () => Promise<unknown>, failTitle: string): Promise<void> => {
    const before = new Set(lastLog.current.map((c) => c.hash))
    setNet({ kind, phase: 'working' })
    const ok = await run(label, fn, failTitle)
    if (!ok && wasCancelled.current) return setNet(null)
    const arrived = lastLog.current.filter((c) => !before.has(c.hash)).map((c) => c.hash)
    setNet({ kind, phase: ok ? 'done' : 'failed', gained: kind === 'push' ? 0 : arrived.length })
    if (ok && arrived.length && before.size) {
      const n = Date.now()
      setFresh({ hashes: new Set(arrived), n })
      // Once the flash has played, forget them, so a row scrolled back into view doesn't flash again.
      setTimeout(() => setFresh((f) => (f?.n === n ? null : f)), 2200)
    }
    setTimeout(() => setNet((n) => (n?.kind === kind && n.phase !== 'working' ? null : n)), ok ? 1800 : 1400)
  }

  // Commit and Push: push where the Push dialog would by default, without asking.
  quickPushRef.current = async () => {
    const info = await window.spoon.syncInfo(path).catch(() => null)
    if (!info?.branch) {
      setOpError({ title: 'Push failed', message: 'HEAD is detached. Check out a branch to push.' })
      return
    }
    const remote = info.upstreamRemote ?? (info.remotes.includes('origin') ? 'origin' : info.remotes[0])
    if (!remote) {
      setOpError({ title: 'Push failed', message: 'This repository has no remotes.' })
      return
    }
    // Only push without asking when it goes to the same-named branch. A branch tracking a different
    // one (made with `switch -c feature origin/main`) would otherwise land straight on main.
    if (info.upstreamBranch && info.upstreamBranch !== info.branch) {
      setDialog('push')
      return
    }
    const remoteBranch = info.branch
    netOp(
      'push',
      'Pushing…',
      () => window.spoon.push(path, { remote, remoteBranch, setUpstream: !info.upstreamRemote, tags: false }),
      'Push failed'
    )
  }

  const fetchAll = (): void => {
    // Prune, so branches whose remote was deleted show up as stale.
    netOp('fetch', 'Fetching…', () => window.spoon.fetch(path, true), 'Fetch failed')
  }

  // A menu command is for the tab that's showing when it's given: never replay one from before this
  // view mounted (switching tabs remounts it), and ignore them while a dialog or menu is open.
  const mountedAt = useRef(Date.now())
  useEffect(() => {
    if (!command || command.n < mountedAt.current) return
    if (overlayOpen() && command.name !== 'refresh') return
    if (command.name === 'filter-commits') {
      setView('history')
      filterInput.current?.focus()
      filterInput.current?.select()
    } else if (command.name === 'refresh') manualRefresh()
    else if (command.name === 'fetch') fetchAll()
    else if (command.name === 'pull') setDialog('pull')
    else if (command.name === 'push') setDialog('push')
    else if (command.name === 'discard') {
      // Acts on the files selected in Local Changes, like Fork's ⇧⌘D.
      if (view === 'changes') setDiscardRequest(Date.now())
    } else if (command.name === 'review') {
      if (settings.claudeEnabled) setReviewing({})
    } else if (command.name === 'commit' || command.name === 'commit-push') {
      setView('changes')
      setCommitRequest({ push: command.name === 'commit-push', n: Date.now() })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command])

  const settings = useSettings()
  // Keyed on what the graph depends on, not the repo object: status-only refreshes and tab
  // switches reuse the built graph instead of laying out 5000 rows again.
  const graphKey = graphKeyOf(repo, settings)
  const graph = useMemo(
    () => cachedGraph(path, commits, repoRef.current, settings),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [path, commits, graphKey]
  )

  /** Commits on a remote branch that HEAD doesn't contain, newest first (from the loaded history). */
  const remoteOnly = (remoteBranch: string): Commit[] => {
    const target = repo?.refs.find((r) => r.kind === 'remote' && r.name === remoteBranch)?.target
    if (!target) return []
    const byHash = new Map(commits.map((c) => [c.hash, c]))
    const reach = (start: string | null | undefined, stop: Set<string>): Set<string> => {
      const seen = new Set<string>()
      const todo = start ? [start] : []
      while (todo.length) {
        const h = todo.pop()!
        if (seen.has(h) || stop.has(h)) continue
        seen.add(h)
        for (const p of byHash.get(h)?.parents ?? []) todo.push(p)
      }
      return seen
    }
    const mine = reach(repo?.headHash, new Set())
    const theirs = reach(target, mine)
    return commits.filter((c) => theirs.has(c.hash))
  }

  const jumpTo = useCallback(
    (hash: string): void => {
      setView('history')
      setFilter('')
      setSelected(hash)
      setScrollTo({ hash, n: Date.now() })
    },
    [setView]
  )

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
            {repo.headBranch ?? repo.rebase?.branch ?? `detached at ${repo.headHash?.slice(0, 7) ?? '—'}`}
          </button>
          {(() => {
            const jira = jiraConfig(settings)
            const key = ticketKeys(repo.headBranch ?? '', jira)[0]
            return key && jira ? (
              <button
                className="jira-chip"
                title={`Open ${key} in Jira`}
                onClick={() => window.spoon.openExternal(jiraUrl(jira, key))}
              >
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
          {settings.claudeEnabled && (
            <button
              className="tool-btn claude-tool"
              onClick={() => setReviewing({})}
              title={`Review with Claude (${keys('⇧⌘R')})`}
            >
              <ClaudeIcon />
              <span>Claude</span>
              <kbd className="tool-key">{keys('⇧⌘R')}</kbd>
            </button>
          )}
        </div>

        <div className="toolbar-right">
          {busy && (
            <div className="activity" title={busy.progress}>
              <span className="spinner" />
              <span className="activity-text">
                {busy.label}
                {busy.progress && <span className="muted"> {busy.progress}</span>}
              </span>
              {(busy.network || /^(Updating|Initializing|Deleting) /.test(busy.label)) && (
                <button className="mini-btn" onClick={() => window.spoon.cancel(path)} title="Stop this git command">
                  Cancel
                </button>
              )}
            </div>
          )}
          <div className="search">
            <SearchIcon />
            <input
              ref={filterInput}
              placeholder="Filter commits"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value)
                setView('history')
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Escape') return
                if (filter) setFilter('')
                else e.currentTarget.blur()
              }}
            />
            {filter ? (
              <button className="icon-btn" onClick={() => setFilter('')} aria-label="Clear filter">
                <CloseIcon />
              </button>
            ) : (
              <kbd className="search-key">{keys('⌘F')}</kbd>
            )}
          </div>
          <button
            className={`icon-btn refresh-btn ${refreshing ? 'spinning' : ''}`}
            onClick={manualRefresh}
            title={`Re-read the repository from disk (${keys('⌘R')})`}
          >
            <RefreshIcon />
          </button>
        </div>
      </div>

      {error && <div className="banner error">{error}</div>}
      {repo.rebase && (
        <RebaseBanner
          progress={repo.rebase}
          conflicts={tree.unstaged.filter((f) => f.status === 'U').length}
          busy={!!busy}
          onShowChanges={() => setView('changes')}
          onAction={(action) =>
            run(
              action === 'abort' ? 'Aborting rebase…' : action === 'skip' ? 'Skipping commit…' : 'Continuing rebase…',
              () => window.spoon.rebaseContinue(path, action),
              'Rebase failed'
            )
          }
        />
      )}

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
            refreshN={refreshN}
            pushedTo={head?.upstream && !head.gone && (head.ahead ?? 0) === 0 ? head.upstream : null}
            ops={ops}
            commitRequest={commitRequest}
            onCommitHandled={clearCommitRequest}
            discardRequest={discardRequest}
            onDiscardHandled={clearDiscardRequest}
          />
        ) : (
          <Split id="history" direction="column" mode="fraction" initial={0.55} min={0.15} max={0.85}>
            {rebasing ? (
              <RebaseEditor
                plan={rebasing.plan}
                branch={rebasing.branch}
                onto={rebasing.onto}
                selected={selected}
                onSelect={setSelected}
                onCancel={() => setRebasing(null)}
                onApply={(steps) => {
                  const { onto } = rebasing
                  setRebasing(null)
                  run(
                    `Rebasing onto ${onto}…`,
                    () => window.spoon.rebaseInteractive(path, onto, steps),
                    'Rebase failed'
                  )
                }}
              />
            ) : (
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
            )}
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
          remoteOnly={remoteOnly}
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
                  const force = await confirm({
                    risky: true,
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
      {reviewing && repo && (
        <ReviewDialog
          path={path}
          repo={repo}
          stagedCount={tree.staged.length}
          changeCount={changeCount}
          commit={reviewing.commit}
          onClose={() => setReviewing(null)}
          onError={(message) => setOpError({ title: 'Couldn’t start the review', message })}
        />
      )}
      {prFor && account && (
        <CreatePullDialog
          path={path}
          branch={prFor}
          me={account.login}
          ops={ops}
          onClose={() => setPrFor(null)}
          onCreated={(pr) => {
            loadPrs(true)
            setSelectedPr(pr.number)
            setView('prs')
            if (pr.warnings.length)
              setOpError({ title: `Pull request #${pr.number} created, with problems`, message: pr.warnings.join('\n') })
          }}
        />
      )}
      {mainlibFor && repo && (
        <MainLibDialog path={path} repoName={repo.name} sub={mainlibFor} onClose={() => setMainlibFor(null)} onDone={load} />
      )}
      {subUpdate && (
        <SubmoduleUpdateDialog
          repoPath={path}
          sub={subUpdate}
          onClose={() => setSubUpdate(null)}
          onConfirm={(backup) =>
            run(
              `Updating ${subUpdate.name}…`,
              () => window.spoon.updateSubmodule(path, subUpdate.path, backup),
              'Submodule update failed'
            )
          }
          onRecordCurrent={async () => {
            if (await run(`Staging ${subUpdate.name}…`, () => window.spoon.stage(path, [subUpdate.path]), 'Stage failed'))
              setView('changes')
          }}
        />
      )}
      {opError && <ErrorModal title={opError.title} message={opError.message} onClose={() => setOpError(null)} />}
    </div>
  )
}
