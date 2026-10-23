import { useMemo, useState, type ReactNode } from 'react'
import type { Ref, RepoState } from '../../../shared/types'
import { usePersistentState } from '../hooks'
import type { Ops, View } from './RepoView'
import {
  BranchIcon,
  ChangesIcon,
  CheckIcon,
  ChevronIcon,
  CloudIcon,
  FolderIcon,
  HistoryIcon,
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

export function Sidebar({ repo, changeCount, view, onView, onJump, ops }: Props) {
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
      </div>

      <div className="side-filter">
        <SearchIcon />
        <input placeholder="Filter" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      <div className="side-scroll">
        {section(
          'branches',
          'Branches',
          repo.refs.filter((r) => r.kind === 'head').length,
          renderTree(branches, 1, 'b')
        )}

        {section(
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
        )}

        {section(
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
        )}

        {section(
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
        )}
      </div>
    </nav>
  )
}
