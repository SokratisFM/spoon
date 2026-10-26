import { memo, Fragment, useMemo, useState, type ReactNode } from 'react'
import { SIDEBAR_SECTIONS, updateSettings, useSettings, type SidebarSection } from '../settings'
import { jiraConfig, jiraUrl, ticketKeys } from '../jira'
import { confirm } from '../dialogs'
import type { PullSummary, Ref, RepoState } from '../../../shared/types'
import { submoduleStatus, type SubmoduleActions } from './Submodules'
import { usePersistentState } from '../hooks'
import type { Ops, View } from './RepoView'

// One shared collator: localeCompare with options builds a new one for every comparison.
const byName = new Intl.Collator(undefined, { numeric: true })
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
  PullIcon,
  TagIcon
} from './Icons'
import { contextMenu } from '../menus'
import { stashMenu, stashTitle } from './stashMenu'

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
  /** Asks to delete a local branch (Backspace on a selected branch, or its menu). */
  onDeleteBranch: (ref: Ref) => void
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
      .sort((a, b) => Number(!!a.ref) - Number(!!b.ref) || byName.compare(a.name, b.name))
      .map((n) => ({ ...n, children: sort(n.children) }))
  return sort(root.children)
}

// Memoized: RepoView re-renders on every status refresh and progress tick.
export const Sidebar = memo(function Sidebar(props: Props) {
  const { repo, changeCount, view, onView, onJump, ops, subActions, prs, prError, selectedPr, onSelectPr, onDeleteBranch } = props
  // The ref picked in the sidebar (click), so Backspace/Delete know what to act on.
  const [picked, setPicked] = useState<string | null>(null)
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
    const canRebase = !!repo.headBranch && ref.kind !== 'tag' && !isCurrent && ref.target !== repo.headHash
    setPicked(ref.fullName)
    const choice = await contextMenu([
      { id: 'checkout', label: checkoutLabel, enabled: !isCurrent },
      ...(canRebase
        ? [
            { separator: true },
            { id: 'rebase', label: `Rebase ${repo.headBranch} onto ${ref.name}` },
            { id: 'irebase', label: `Interactive Rebase ${repo.headBranch} onto ${ref.name}…` }
          ]
        : []),
      ...(ref.kind === 'head' && ops.createPull ? [{ separator: true }, { id: 'pr', label: `Create Pull Request for ${ref.name}…` }] : []),
      { separator: true },
      { id: 'show', label: 'Show in History' },
      { id: 'copy', label: 'Copy Name' },
      ...ticketKeys(ref.name, jiraConfig(settings)).map((k) => ({ id: `jira:${k}`, label: `Open ${k} in Jira` })),
      ...(ref.kind === 'head' ? [{ separator: true }, { id: 'delete', label: `Delete ${ref.name}…`, enabled: !isCurrent }] : [])
    ])
    const jira = jiraConfig(settings)
    if (choice?.startsWith('jira:') && jira) window.spoon.openExternal(jiraUrl(jira, choice.slice(5)))
    else if (choice === 'delete') onDeleteBranch(ref)
    else if (choice === 'checkout') checkoutRef(ref)
    else if (choice === 'pr') ops.createPull?.(ref.name)
    else if (choice === 'rebase' || choice === 'irebase') ops.rebase(ref.name, choice === 'irebase')
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
      .sort((a, b) => byName.compare(b.name, a.name))
    return { branches: buildTree(heads), remotes: byRemote, tags: tagRefs }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, q])

  // Stale, as git means it: local branches whose remote branch was deleted. Behind: local branches
  // that are behind their remote branch and have no commits of their own, so they can be
  // fast-forwarded or dropped. The checked-out branch is in neither.
  const others = repo.refs.filter((r) => r.kind === 'head' && r.name !== repo.headBranch && !!r.upstream && match(r))
  const stale = others.filter((r) => r.gone === true)
  const behind = others.filter((r) => !r.gone && !!r.behind && !r.ahead)

  const stashes = repo.stashes.filter((s) => !q || s.message.toLowerCase().includes(q))

  const renderTree = (nodes: TreeNode[], depth: number, scope: string): ReactNode =>
    nodes.map((n) => {
      if (n.ref) {
        const ref = n.ref
        const isHead = ref.kind === 'head' && ref.name === repo.headBranch
        return (
          <div
            key={ref.fullName}
            className={`side-item ${isHead ? 'current' : ''} ${picked === ref.fullName ? 'picked' : ''}`}
            style={{ paddingLeft: `${0.75 + depth * 1.1}rem` }}
            onClick={() => {
              setPicked(ref.fullName)
              onJump(ref.target)
            }}
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

  // Right-click menus for the view options that live in Settings → Appearance.
  const prGroupsMenu = async (e: React.MouseEvent): Promise<void> => {
    e.preventDefault()
    const g = settings.prGroups
    const choice = await contextMenu([
      { label: 'Show in Pull Requests', enabled: false },
      { id: 'awaiting', label: 'Awaiting your review', kind: 'checkbox', checked: true, enabled: false },
      { id: 'yours', label: 'Yours', kind: 'checkbox', checked: g.yours },
      { id: 'others', label: 'Others', kind: 'checkbox', checked: g.others }
    ])
    if (choice === 'yours' || choice === 'others') updateSettings({ prGroups: { ...g, [choice]: !g[choice] } })
  }
  const sectionsMenu = async (e: React.MouseEvent): Promise<void> => {
    if (e.defaultPrevented) return // an item showed its own menu
    e.preventDefault()
    // Only the headers and the empty space between sections; an item without a menu has none.
    if ((e.target as HTMLElement).closest('.side-item, .side-empty, .stale-actions')) return
    const list = settings.sidebarSections
    const choice = await contextMenu([
      { label: 'Show in sidebar', enabled: false },
      ...list.map((x) => ({
        id: x.id,
        label: SIDEBAR_SECTIONS.find((d) => d.id === x.id)?.label,
        kind: 'checkbox' as const,
        checked: x.visible
      })),
      { separator: true },
      { id: 'reset', label: 'Reset Order and Visibility' }
    ])
    if (choice === 'reset') updateSettings({ sidebarSections: SIDEBAR_SECTIONS.map((d) => ({ id: d.id, visible: true })) })
    else if (choice)
      updateSettings({ sidebarSections: list.map((x) => (x.id === choice ? { ...x, visible: !x.visible } : x)) })
  }

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
              onClick={() => onJump(s.hash)}
              onContextMenu={(e) => {
                e.preventDefault()
                stashMenu(s, repo.path, ops, () => onJump(s.hash))
              }}
            >
              <StashIcon />
              <span className="side-label">{stashTitle(s)}</span>
            </div>
          ))
        ),

    stale: section(
          'stale',
          'Stale',
          stale.length,
          <BranchCleanup
            branches={stale}
            path={repo.path}
            ops={ops}
            onJump={onJump}
            onMenu={refMenu}
            empty="No stale branches. Fetch to check for deleted remotes."
          />
        ),

    behind: section(
          'behind',
          'Behind',
          behind.length,
          <BranchCleanup
            branches={behind}
            path={repo.path}
            ops={ops}
            onJump={onJump}
            onMenu={refMenu}
            empty="No branches behind their remote."
            canFastForward
          />
        ),
  }

  return (
    <nav
      className="sidebar"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key !== 'Backspace' && e.key !== 'Delete') return
        if ((e.target as HTMLElement).closest('input, textarea')) return
        const ref = repo.refs.find((r) => r.fullName === picked && r.kind === 'head')
        if (!ref) return
        e.preventDefault()
        onDeleteBranch(ref)
      }}
    >
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
          <div
            className={`side-item nav ${view === 'prs' ? 'selected' : ''}`}
            onClick={() => onView('prs')}
            onContextMenu={prGroupsMenu}
          >
            <PullRequestIcon />
            <span className="side-label">Pull Requests</span>
            {!!prs?.filter((p) => p.reviewRequested).length && (
              <span className="badge warn" title="Waiting for your review">
                {prs.filter((p) => p.reviewRequested).length}
              </span>
            )}
          </div>
        )}
        {view === 'prs' && (
          <div onContextMenu={prGroupsMenu}>
            <PullList prs={prs ?? null} error={prError} selected={selectedPr} onSelect={onSelectPr} />
          </div>
        )}
      </div>

      <div className="side-filter">
        <SearchIcon />
        <input placeholder="Filter" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      <div className="side-scroll" onContextMenu={sectionsMenu}>
        {settings.sidebarSections
          .filter((x) => x.visible)
          .map((x) => (
            <Fragment key={x.id}>{blocks[x.id]}</Fragment>
          ))}
      </div>
    </nav>
  )
})


/** A checklist of local branches to clean up: delete them, or (when only behind) fast-forward them. */
function BranchCleanup({
  branches,
  path,
  ops,
  onJump,
  onMenu,
  empty,
  canFastForward
}: {
  branches: Ref[]
  path: string
  ops: Ops
  onJump: (h: string) => void
  onMenu: (e: React.MouseEvent, ref: Ref) => void
  empty: string
  canFastForward?: boolean
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const names = branches.map((r) => r.name)
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
    const ok = await confirm({
      message: `Delete ${selected.length} local branch${selected.length === 1 ? '' : 'es'}?`,
      detail: `${list}\n\nOnly the local branches are deleted; nothing on the remote changes.`,
      confirmLabel: 'Delete',
      risky: true
    })
    if (!ok) return
    await ops.run(
      'Deleting branches…',
      async () => {
        const res = await window.spoon.deleteBranches(path, selected, false)
        if (res.unmerged.length === 0) return
        const force = await confirm({
          risky: true,
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

  const fastForward = async (): Promise<void> => {
    await ops.run(
      `Fast-forwarding ${selected.length === 1 ? selected[0] : `${selected.length} branches`}…`,
      () => window.spoon.fastForwardBranches(path, selected),
      'Fast-forward failed'
    )
    setPicked(new Set())
  }

  if (branches.length === 0) return <div className="side-empty">{empty}</div>

  return (
    <div className="stale">
      <label className="side-item stale-all" style={{ paddingLeft: '1.85rem' }}>
        <input type="checkbox" checked={all} onChange={() => setPicked(all ? new Set() : new Set(names))} />
        <span className="side-label muted">Select all</span>
      </label>
      {branches.map((r) => (
        <label
          key={r.fullName}
          className="side-item"
          style={{ paddingLeft: '1.85rem' }}
          title={`${r.name} → ${r.upstream}`}
          onDoubleClick={() => onJump(r.target)}
          onContextMenu={(e) => onMenu(e, r)}
        >
          <input type="checkbox" checked={picked.has(r.name)} onChange={() => toggle(r.name)} />
          <span className="side-label">{r.name}</span>
          {r.gone ? (
            <span className="badge danger" title={`${r.upstream} was deleted on the remote`}>
              gone
            </span>
          ) : (
            <span className="badge" title={`${r.behind} commit${r.behind === 1 ? '' : 's'} behind ${r.upstream}, none of its own`}>
              ↓{r.behind}
            </span>
          )}
        </label>
      ))}
      <div className="stale-actions">
        {canFastForward && (
          <button className="btn" disabled={selected.length === 0} onClick={fastForward} title="Move them up to their remote branch">
            <PullIcon /> Fast-forward {selected.length || ''}
          </button>
        )}
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
