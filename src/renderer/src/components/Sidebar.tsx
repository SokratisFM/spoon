import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { useSettings, type SidebarSection } from '../settings'
import type { PullSummary, Ref, RepoState } from '../../../shared/types'
import { submoduleStatus, type SubmoduleActions } from './Submodules'
import { usePersistentState } from '../hooks'
import type { Ops, View } from './RepoView'
import {
  BoxIcon,
  BroomIcon,
  BranchIcon,
  ChangesIcon,
  CheckIcon,
  ChevronIcon,
  CloudIcon,
  FolderIcon,
  HistoryIcon,
  PullRequestIcon,
  SearchIcon,
  StashIcon,
  TagIcon
} from './Icons'

interface Props {
  repo: RepoState
  changeCount: number
  view: View
  onView: (v: View) => void
  onJump: (hash: string) => void
  ops: Ops
  subActions: SubmoduleActions
  /** null until loaded; undefined when the repo has no GitHub remote. */
  prs: PullSummary[] | null | undefined
  prError: string | null
  selectedPr: number | null
  onSelectPr: (n: number) => void
}

interface TreeNode {
  name: string
  path: string
  ref?: Ref
  children: TreeNode[]
}

/** Turns "feature/ui/tabs" style names into folders, like Fork does. */
function buildTree(refs: Ref[], strip = 0): TreeNode[] {
  const root: TreeNode = { name: '', path: '', children: [] }
  for (const ref of refs) {
    const parts = ref.name.split('/').slice(strip)
    let node = root
    parts.forEach((part, i) => {
      const leaf = i === parts.length - 1
      const p = node.path ? `${node.path}/${part}` : part
      let child = leaf ? undefined : node.children.find((c) => c.name === part && !c.ref)
      if (!child) {
        child = { name: part, path: p, children: [], ref: leaf ? ref : undefined }
        node.children.push(child)
      }
      node = child
    })
  }
  const sort = (nodes: TreeNode[]): TreeNode[] =>
    nodes
      .sort((a, b) => Number(!!a.ref) - Number(!!b.ref) || a.name.localeCompare(b.name, undefined, { numeric: true }))
      .map((n) => ({ ...n, children: sort(n.children) }))
  return sort(root.children)
}

export function Sidebar(props: Props) {
  const { repo, changeCount, view, onView, onJump, ops, subActions, prs, prError, selectedPr, onSelectPr } = props
  const settings = useSettings()
  const checkoutRef = (ref: Ref): void => {
    if (ref.kind === 'head') {
      if (ref.name !== repo.headBranch) ops.checkout({ kind: 'branch', name: ref.name }, ref.name)
    } else if (ref.kind === 'remote') ops.checkout({ kind: 'remote', name: ref.name }, ref.name)
    else ops.checkout({ kind: 'commit', hash: ref.target }, `tag ${ref.name}`)
  }

  const refMenu = async (e: React.MouseEvent, ref: Ref): Promise<void> => {
    e.preventDefault()
    const isCurrent = ref.kind === 'head' && ref.name === repo.headBranch
    const checkoutLabel =
      ref.kind === 'head'
        ? `Checkout ${ref.name}`
        : ref.kind === 'remote'
          ? `Checkout ${ref.name} as Local Branch`
          : `Checkout Tag ${ref.name}…`
    const choice = await window.spoon.contextMenu([
      { id: 'checkout', label: checkoutLabel, enabled: !isCurrent },
      { separator: true },
      { id: 'show', label: 'Show in History' },
      { id: 'copy', label: 'Copy Name' }
    ])
    if (choice === 'checkout') checkoutRef(ref)
    else if (choice === 'show') onJump(ref.target)
    else if (choice === 'copy') navigator.clipboard.writeText(ref.name)
  }

  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = usePersistentState<Record<string, boolean>>('spoon.sidebar.collapsed', {
    tags: true
  })
  const toggle = (key: string): void => setCollapsed((c) => ({ ...c, [key]: !c[key] }))
  const isOpen = (key: string): boolean => !!query || !collapsed[key]

  const q = query.toLowerCase()
  const match = (r: { name: string }): boolean => !q || r.name.toLowerCase().includes(q)

  const { branches, remotes, tags } = useMemo(() => {
    const heads = repo.refs.filter((r) => r.kind === 'head' && match(r))
    const byRemote = new Map<string, Ref[]>()
    for (const r of repo.refs) {
      if (r.kind !== 'remote' || !match(r)) continue
      const remote = r.name.split('/')[0]
      byRemote.set(remote, [...(byRemote.get(remote) ?? []), r])
    }
    const tagRefs = repo.refs
      .filter((r) => r.kind === 'tag' && match(r))
      .sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }))
    return { branches: buildTree(heads), remotes: byRemote, tags: tagRefs }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, q])

  // Stale = local branches that are safe to drop locally: their origin branch was deleted,
  // or they match it exactly. The checked-out branch is never stale.
  const stale = repo.refs.filter(
    (r): r is Ref =>
      r.kind === 'head' &&
      r.name !== repo.headBranch &&
      !!r.upstream &&
      (r.gone === true || (!r.ahead && !r.behind)) &&
      match(r)
  )

  const stashes = repo.stashes.filter((s) => !q || s.message.toLowerCase().includes(q))

  const renderTree = (nodes: TreeNode[], depth: number, scope: string): ReactNode =>
    nodes.map((n) => {
      if (n.ref) {
        const ref = n.ref
        const isHead = ref.kind === 'head' && ref.name === repo.headBranch
        return (
          <div
            key={ref.fullName}
            className={`side-item ${isHead ? 'current' : ''}`}
            style={{ paddingLeft: `${0.75 + depth * 1.1}rem` }}
            onClick={() => onJump(ref.target)}
            onDoubleClick={() => checkoutRef(ref)}
            onContextMenu={(e) => refMenu(e, ref)}
            title={`${ref.upstream ? `${ref.name} → ${ref.upstream}` : ref.name}\nDouble-click to check out`}
          >
            {isHead ? <CheckIcon className="icon current-mark" /> : <BranchIcon />}
            <span className="side-label">{n.name}</span>
            {ref.gone && <span className="badge warn">gone</span>}
            {!!ref.ahead && <span className="badge">↑{ref.ahead}</span>}
            {!!ref.behind && <span className="badge">↓{ref.behind}</span>}
          </div>
        )
      }
      const key = `${scope}:${n.path}`
      return (
        <div key={key}>
          <div
            className="side-item folder"
            style={{ paddingLeft: `${0.75 + depth * 1.1}rem` }}
            onClick={() => toggle(key)}
          >
            <ChevronIcon className={`icon chevron ${isOpen(key) ? 'open' : ''}`} />
            <FolderIcon />
            <span className="side-label">{n.name}</span>
          </div>
          {isOpen(key) && renderTree(n.children, depth + 1, scope)}
        </div>
      )
    })

  const section = (key: string, title: string, count: number, body: ReactNode): ReactNode => (
    <div className="side-section">
      <div className="side-header" onClick={() => toggle(key)}>
        <ChevronIcon className={`icon chevron ${isOpen(key) ? 'open' : ''}`} />
        <span>{title}</span>
        <span className="count">{count}</span>
      </div>
      {isOpen(key) && body}
    </div>
  )

  const blocks: Record<SidebarSection, ReactNode> = {
    submodules:
      repo.submodules.length > 0 &&
          section(
            'submodules',
            'Submodules',
            repo.submodules.length,
            repo.submodules
              .filter((sm) => !q || sm.path.toLowerCase().includes(q))
              .map((sm) => {
                const st = submoduleStatus(sm)
                return (
                  <div
                    key={sm.path}
                    className="side-item"
                    style={{ paddingLeft: '1.85rem' }}
                    title={`${sm.path} · ${sm.branch ?? sm.hash.slice(0, 7)} · ${st.label}\nDouble-click to open in a new tab`}
                    onDoubleClick={() => sm.state !== 'uninitialized' && subActions.open(sm)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      subActions.menu(sm)
                    }}
                  >
                    <BoxIcon />
                    <span className="side-label">{sm.name}</span>
                    <span className={`tone-dot ${st.tone}`} title={st.label} />
                  </div>
                )
              })
          ),

    branches: section(
          'branches',
          'Branches',
          repo.refs.filter((r) => r.kind === 'head').length,
          renderTree(branches, 1, 'b')
        ),

    remotes: section(
          'remotes',
          'Remotes',
          repo.remotes.length,
          [...remotes.entries()].map(([remote, refs]) => {
            const key = `remote:${remote}`
            return (
              <div key={remote}>
                <div className="side-item folder" style={{ paddingLeft: '1.85rem' }} onClick={() => toggle(key)}>
                  <ChevronIcon className={`icon chevron ${isOpen(key) ? 'open' : ''}`} />
                  <CloudIcon />
                  <span className="side-label">{remote}</span>
                </div>
                {isOpen(key) && renderTree(buildTree(refs, 1), 2, key)}
              </div>
            )
          })
        ),

    tags: section(
          'tags',
          'Tags',
          repo.refs.filter((r) => r.kind === 'tag').length,
          tags.map((t) => (
            <div
              key={t.fullName}
              className="side-item"
              style={{ paddingLeft: '1.85rem' }}
              onClick={() => onJump(t.target)}
              onDoubleClick={() => checkoutRef(t)}
              onContextMenu={(e) => refMenu(e, t)}
            >
              <TagIcon />
              <span className="side-label">{t.name}</span>
            </div>
          ))
        ),

    stashes: section(
          'stashes',
          'Stashes',
          repo.stashes.length,
          stashes.map((s) => (
            <div
              key={s.name}
              className="side-item"
              style={{ paddingLeft: '1.85rem' }}
              title={s.message}
            >
              <StashIcon />
              <span className="side-label">{s.message.replace(/^(WIP )?[Oo]n [^:]+: /, '')}</span>
            </div>
          ))
        ),

    stale: section(
          'stale',
          'Stale',
          stale.length,
          <StaleBranches stale={stale} path={repo.path} ops={ops} onJump={onJump} />
        ),
  }

  return (
    <nav className="sidebar">
      <div className="side-nav">
        <div className={`side-item nav ${view === 'changes' ? 'selected' : ''}`} onClick={() => onView('changes')}>
          <ChangesIcon />
          <span className="side-label">Local Changes</span>
          {changeCount > 0 && <span className="badge accent">{changeCount}</span>}
        </div>
        <div className={`side-item nav ${view === 'history' ? 'selected' : ''}`} onClick={() => onView('history')}>
          <HistoryIcon />
          <span className="side-label">All Commits</span>
        </div>
        {prs !== undefined && (
          <div className={`side-item nav ${view === 'prs' ? 'selected' : ''}`} onClick={() => onView('prs')}>
            <PullRequestIcon />
            <span className="side-label">Pull Requests</span>
            {!!prs?.filter((p) => p.reviewRequested).length && (
              <span className="badge warn" title="Waiting for your review">
                {prs.filter((p) => p.reviewRequested).length}
              </span>
            )}
          </div>
        )}
        {view === 'prs' && <PullList prs={prs ?? null} error={prError} selected={selectedPr} onSelect={onSelectPr} />}
      </div>

      <div className="side-filter">
        <SearchIcon />
        <input placeholder="Filter" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      <div className="side-scroll">
        {settings.sidebarSections
          .filter((x) => x.visible)
          .map((x) => (
            <Fragment key={x.id}>{blocks[x.id]}</Fragment>
          ))}
      </div>
    </nav>
  )
}

function StaleBranches({ stale, path, ops, onJump }: { stale: Ref[]; path: string; ops: Ops; onJump: (h: string) => void }) {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const names = stale.map((r) => r.name)
  const selected = names.filter((n) => picked.has(n))
  const all = selected.length === names.length && names.length > 0

  const toggle = (name: string): void =>
    setPicked((p) => {
      const next = new Set(p)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })

  const remove = async (): Promise<void> => {
    const list = selected.length > 12 ? `${selected.slice(0, 12).join('\n')}\n…and ${selected.length - 12} more` : selected.join('\n')
    const ok = await window.spoon.confirm({
      message: `Delete ${selected.length} local branch${selected.length === 1 ? '' : 'es'}?`,
      detail: `${list}\n\nOnly the local branches are deleted; nothing on the remote changes.`,
      confirmLabel: 'Delete'
    })
    if (!ok) return
    await ops.run(
      'Deleting branches…',
      async () => {
        const res = await window.spoon.deleteBranches(path, selected, false)
        if (res.unmerged.length === 0) return
        const force = await window.spoon.confirm({
          message: `${res.unmerged.length} branch${res.unmerged.length === 1 ? ' has' : 'es have'} commits that aren’t on any other branch`,
          detail: `${res.unmerged.join('\n')}\n\nDeleting will drop those commits (git keeps them in the reflog for a while).`,
          confirmLabel: 'Delete anyway'
        })
        if (force) await window.spoon.deleteBranches(path, res.unmerged, true)
      },
      'Delete failed'
    )
    setPicked(new Set())
  }

  if (stale.length === 0)
    return <div className="side-empty">No stale branches. Fetch to check for deleted remotes.</div>

  return (
    <div className="stale">
      <label className="side-item stale-all" style={{ paddingLeft: '1.85rem' }}>
        <input type="checkbox" checked={all} onChange={() => setPicked(all ? new Set() : new Set(names))} />
        <span className="side-label muted">Select all</span>
      </label>
      {stale.map((r) => (
        <label
          key={r.fullName}
          className="side-item"
          style={{ paddingLeft: '1.85rem' }}
          title={`${r.name} → ${r.upstream}`}
          onDoubleClick={() => onJump(r.target)}
        >
          <input type="checkbox" checked={picked.has(r.name)} onChange={() => toggle(r.name)} />
          <span className="side-label">{r.name}</span>
          {r.gone ? (
            <span className="badge danger" title="The origin branch was deleted">
              gone
            </span>
          ) : (
            <span className="badge" title="Identical to its origin branch">
              synced
            </span>
          )}
        </label>
      ))}
      <div className="stale-actions">
        <button className="btn danger" disabled={selected.length === 0} onClick={remove}>
          <BroomIcon /> Delete {selected.length || ''}
        </button>
      </div>
    </div>
  )
}

function PullList({
  prs,
  error,
  selected,
  onSelect
}: {
  prs: PullSummary[] | null
  error: string | null
  selected: number | null
  onSelect: (n: number) => void
}) {
  const { prGroups } = useSettings()
  if (error) return <div className="side-empty error-text">{error}</div>
  if (!prs) return <div className="side-empty">Loading pull requests…</div>
  const groups: { id: string; title: string; list: PullSummary[]; shown: boolean }[] = [
    { id: 'awaiting', title: 'Awaiting your review', list: prs.filter((p) => p.reviewRequested), shown: true },
    { id: 'yours', title: 'Yours', list: prs.filter((p) => p.mine && !p.reviewRequested), shown: prGroups.yours },
    { id: 'others', title: 'Others', list: prs.filter((p) => !p.mine && !p.reviewRequested), shown: prGroups.others }
  ]
  return (
    <div className="pr-list">
      {groups
        .filter((g) => g.shown)
        .map((g) => (
          <div key={g.id} className={`pr-group-block ${g.id}`}>
            <div className="pr-group">
              <span>{g.title}</span>
              <span className="pr-group-count">{g.list.length}</span>
            </div>
            {g.list.length === 0 && (
              <div className="side-empty">{g.id === 'awaiting' ? 'Nothing waiting for you.' : 'None open.'}</div>
            )}
            {g.list.map((p) => (
              <div
                key={p.number}
                className={`pr-item ${selected === p.number ? 'selected' : ''}`}
                onClick={() => onSelect(p.number)}
                title={`${p.title}\n${p.headRef} → ${p.baseRef}`}
              >
                <span className={`pr-num ${p.draft ? 'draft' : ''}`}>#{p.number}</span>
                <span className="side-label">{p.title}</span>
                <img className="gh-avatar" src={p.author.avatarUrl} alt={p.author.login} title={p.author.login} />
              </div>
            ))}
          </div>
        ))}
    </div>
  )
}
