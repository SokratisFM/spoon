import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { DiffTarget, FileChange, WorkingTree } from '../../../shared/types'
import { usePersistentState } from '../hooks'
import { confirm } from '../dialogs'
import type { Ops } from './RepoView'
import { Split } from './Split'
import { FileList } from './FileList'
import { requestCompare } from '../compare'
import { ListViewIcon, TreeViewIcon } from './Icons'
import { updateSettings, useSettings } from '../settings'
import { DiffView, type HunkAction } from './DiffView'
import { keys, mod, revealLabel } from '../platform'
import { contextMenu as showMenu } from '../menus'

type Area = 'unstaged' | 'staged'

interface Selection {
  area: Area
  paths: Set<string>
  focused: string
}

interface Props {
  path: string
  tree: WorkingTree
  /** Bumped by every refresh; the open diff reloads, since a file can change without its status changing. */
  refreshN: number
  /** The remote branch the last commit is already on, if any (amending it then needs a force push). */
  pushedTo: string | null
  ops: Ops
  /** Set by ⌘Enter from the menu; cleared with onCommitHandled once acted on. */
  commitRequest: { push: boolean; n: number } | null
  onCommitHandled: () => void
  /** Set by ⇧⌘D from the menu; discards the selected files once confirmed. */
  discardRequest: number
  onDiscardHandled: () => void
}

/** Paths git needs for a set of entries: renames are staged/unstaged as old + new path. */
const pathsOf = (files: FileChange[]): string[] => files.flatMap((f) => (f.oldPath ? [f.oldPath, f.path] : [f.path]))

export function ChangesView({
  path,
  tree,
  refreshN,
  pushedTo,
  ops,
  commitRequest,
  onCommitHandled,
  discardRequest,
  onDiscardHandled
}: Props) {
  const settings = useSettings()
  const [sel, setSel] = useState<Selection | null>(null)

  // After a refresh, keep what still exists; if the focused file moved away, focus the
  // file now at its old position so you can keep staging with Enter.
  const lastIndex = useRef(0)
  useEffect(() => {
    if (!sel) return
    const files = tree[sel.area]
    const paths = new Set([...sel.paths].filter((p) => files.some((f) => f.path === p)))
    if (files.some((f) => f.path === sel.focused)) {
      if (paths.size !== sel.paths.size) setSel({ ...sel, paths })
      return
    }
    const next = files[Math.min(lastIndex.current, files.length - 1)]
    setSel(next ? { area: sel.area, paths: new Set([next.path]), focused: next.path } : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree])

  const select = (area: Area) => (paths: Set<string>, f: FileChange) => {
    lastIndex.current = tree[area].findIndex((x) => x.path === f.path)
    setSel({ area, paths, focused: f.path })
  }

  // Staged/unstaged files glide from their old row to their new one in the other list.
  const glide = useRef<{ to: Area; rects: Map<string, DOMRect> } | null>(null)
  const remember = (files: FileChange[], from: Area): void => {
    const rects = new Map<string, DOMRect>()
    for (const f of files.slice(0, 30)) {
      const el = document.querySelector(`.file-list[data-area="${from}"] [data-path="${CSS.escape(f.path)}"]`)
      if (el) rects.set(f.path, el.getBoundingClientRect())
    }
    glide.current = { to: from === 'unstaged' ? 'staged' : 'unstaged', rects }
  }
  useLayoutEffect(() => {
    const g = glide.current
    if (!g || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    glide.current = null
    // The target list is virtualized and may draw its rows a frame or two later, so keep looking briefly.
    const pending = new Map(g.rects)
    const attempt = (framesLeft: number): void => {
      for (const [p, old] of pending) {
        const el = document.querySelector(`.file-list[data-area="${g.to}"] [data-path="${CSS.escape(p)}"]`) as HTMLElement | null
        if (!el) continue
        pending.delete(p)
        const now = el.getBoundingClientRect()
        el.animate([{ translate: `${old.left - now.left}px ${old.top - now.top}px`, opacity: 0.6 }, { translate: '0 0', opacity: 1 }], {
          duration: 360,
          easing: 'cubic-bezier(.2,.9,.3,1.08)'
        })
      }
      if (pending.size && framesLeft > 0) requestAnimationFrame(() => attempt(framesLeft - 1))
    }
    attempt(6)
  }, [tree])

  const stage = async (files: FileChange[]): Promise<void> => {
    // Staging a conflicted file marks it resolved; check it doesn't still hold conflict markers.
    const conflicted = files.filter((f) => f.status === 'U')
    const marked: string[] = []
    for (const f of conflicted.slice(0, 20)) {
      const d = await window.spoon.diff(path, { kind: 'unstaged', file: f }).catch(() => null)
      if (d && /^[ +-]{0,2}(<{7}|>{7})( |$)/m.test(d.text)) marked.push(f.path)
    }
    if (marked.length) {
      const ok = await confirm({
        message:
          marked.length === 1
            ? `${marked[0]} still has conflict markers`
            : `${marked.length} files still have conflict markers`,
        detail:
          'Staging marks a conflict as resolved, and the <<<<<<< and >>>>>>> lines would be committed as they are.' +
          (marked.length > 1 ? `\n\n${marked.join('\n')}` : ''),
        confirmLabel: 'Stage Anyway'
      })
      if (!ok) return
    }
    remember(files, 'unstaged')
    ops.run('Staging…', () => window.spoon.stage(path, pathsOf(files)), 'Stage failed')
  }
  const unstage = (files: FileChange[]): void => {
    remember(files, 'staged')
    ops.run('Unstaging…', () => window.spoon.unstage(path, pathsOf(files)), 'Unstage failed')
  }
  const selectedIn = (area: Area): FileChange[] =>
    sel?.area === area ? tree[area].filter((f) => sel.paths.has(f.path)) : []

  const discard = async (files: FileChange[], area: Area): Promise<void> => {
    const usable = files.filter((f) => f.status !== 'U')
    if (!usable.length) return
    const name = usable.length === 1 ? usable[0].path : `${usable.length} files`
    const repoName = path.split('/').pop() ?? 'repo'
    const ok = await confirm({
      message: `Discard changes to ${name}?`,
      detail: [
        area === 'staged'
          ? 'The staged changes are undone. Unstaged edits to the same files stay, unless they overlap.'
          : 'Unstaged changes are thrown away; anything already staged stays. New files are deleted.',
        `Your current versions go to the Trash (in a “${repoName} – discarded …” folder), so you can get them back.`,
        usable.length < files.length ? 'Files with conflicts are left alone.' : ''
      ]
        .filter(Boolean)
        .join('\n\n'),
      confirmLabel: 'Discard',
      risky: true,
      enterConfirms: true
    })
    if (!ok) return
    ops.run(
      'Discarding…',
      () => window.spoon.discard(path, usable.map((f) => ({ path: f.path, oldPath: f.oldPath, status: f.status, staged: area === 'staged' }))),
      'Discard failed'
    )
  }

  const discardRef = useRef(discard)
  discardRef.current = discard
  useEffect(() => {
    if (!discardRequest) return
    onDiscardHandled()
    if (sel) discardRef.current(tree[sel.area].filter((f) => sel.paths.has(f.path)), sel.area)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discardRequest, onDiscardHandled])

  const contextMenu = (area: Area) => async (files: FileChange[]) => {
    const n = files.length === 1 ? '' : ` ${files.length} files`
    const choice = await showMenu([
      { id: 'toggle', label: area === 'unstaged' ? `Stage${n}` : `Unstage${n}` },
      {
        id: 'discard',
        label: `Discard Changes${n ? ` to${n}` : ''}…`,
        accelerator: 'CmdOrCtrl+Shift+D',
        enabled: files.some((f) => f.status !== 'U')
      },
      { separator: true },
      { id: 'compare', label: 'Compare with…', enabled: files.length === 1 && files[0].status !== 'D' },
      { id: 'reveal', label: revealLabel, enabled: files.length === 1 },
      { id: 'copy', label: files.length === 1 ? 'Copy Path' : 'Copy Paths' }
    ])
    if (choice === 'toggle') (area === 'unstaged' ? stage : unstage)(files)
    else if (choice === 'discard') discard(files, area)
    else if (choice === 'compare') {
      const other = await window.spoon.pickFile(`Compare ${files[0].path} with…`)
      if (other) requestCompare(other, `${path}/${files[0].path}`)
    } else if (choice === 'reveal') window.spoon.revealInFinder(`${path}/${files[0].path}`)
    else if (choice === 'copy') navigator.clipboard.writeText(files.map((f) => f.path).join('\n'))
  }

  const focusedFile = sel ? tree[sel.area].find((f) => f.path === sel.focused) : undefined
  const target: DiffTarget | null = focusedFile && sel ? { kind: sel.area, file: focusedFile } : null
  const hunkAction: HunkAction | undefined =
    target && focusedFile && focusedFile.status !== '?' && focusedFile.status !== 'U'
      ? {
          label: target.kind === 'unstaged' ? 'Stage hunk' : 'Unstage hunk',
          run: (index, header) =>
            ops.run(
              target.kind === 'unstaged' ? 'Staging hunk…' : 'Unstaging hunk…',
              () => window.spoon.applyHunk(path, target, index, header),
              'Could not apply hunk'
            )
        }
      : undefined

  const header = (area: Area, title: string) => {
    const selected = selectedIn(area)
    const files = tree[area]
    const isUnstaged = area === 'unstaged'
    return (
      <div className="section-title with-actions">
        {title} <span className="count">{files.length}</span>
        <span className="spacer" />
        <span className="view-toggle" role="group" aria-label="Show files as">
          <button className={settings.fileTree ? '' : 'on'} title="As a list" onClick={() => updateSettings({ fileTree: false })}>
            <ListViewIcon />
          </button>
          <button className={settings.fileTree ? 'on' : ''} title="As folders" onClick={() => updateSettings({ fileTree: true })}>
            <TreeViewIcon />
          </button>
        </span>
        <button
          className="mini-btn"
          disabled={!selected.length}
          onClick={() => (isUnstaged ? stage : unstage)(selected)}
        >
          {isUnstaged ? 'Stage' : 'Unstage'}
        </button>
        <button
          className="mini-btn"
          disabled={!files.length}
          onClick={() =>
            ops.run(
              isUnstaged ? 'Staging all…' : 'Unstaging all…',
              () => (isUnstaged ? window.spoon.stageAll(path) : window.spoon.unstageAll(path)),
              isUnstaged ? 'Stage failed' : 'Unstage failed'
            )
          }
        >
          {isUnstaged ? 'Stage All' : 'Unstage All'}
        </button>
      </div>
    )
  }

  const list = (area: Area, emptyText: string) => (
    <FileList
      files={tree[area]}
      selected={sel?.area === area ? sel.paths : new Set()}
      focused={sel?.area === area ? sel.focused : null}
      onSelect={select(area)}
      onActivate={area === 'unstaged' ? stage : unstage}
      onContextMenu={contextMenu(area)}
      emptyText={emptyText}
      area={area}
      tree={settings.fileTree}
    />
  )

  return (
    <Split id="changes" direction="row" mode="fraction" initial={0.36} min={0.18} max={0.7}>
      <div className="panel changes-left">
        <Split id="changes-lists" direction="column" mode="fraction" initial={0.55} min={0.15} max={0.85}>
          <div className="panel">
            {header('unstaged', 'Unstaged')}
            {list('unstaged', 'No unstaged changes.')}
          </div>
          <div className="panel">
            {header('staged', 'Staged')}
            {list('staged', 'Nothing staged.')}
          </div>
        </Split>
        <CommitBox
          path={path}
          stagedCount={tree.staged.length}
          pushedTo={pushedTo}
          ops={ops}
          commitRequest={commitRequest}
          onCommitHandled={onCommitHandled}
        />
      </div>
      <DiffView path={path} target={target} nonce={refreshN} hunkAction={hunkAction} />
    </Split>
  )
}

interface CommitBoxProps {
  path: string
  stagedCount: number
  pushedTo: string | null
  ops: Ops
  commitRequest: { push: boolean; n: number } | null
  onCommitHandled: () => void
}

function CommitBox({ path, stagedCount, pushedTo, ops, commitRequest, onCommitHandled }: CommitBoxProps) {
  // The draft survives restarts and tab switches, like Fork.
  const [draft, setDraft] = usePersistentState(`spoon.draft.${path}`, { subject: '', body: '' })
  // While Amend is on: the draft from before it (put back when it's turned off). Kept with the draft,
  // so switching views or tabs doesn't turn Amend off and lose that draft.
  const [beforeAmend, setBeforeAmend] = usePersistentState<{ subject: string; body: string } | null>(`spoon.amend.${path}`, null)
  const amend = beforeAmend !== null
  const subjectRef = useRef<HTMLInputElement>(null)
  // Holding ⌥ turns the button into Commit and Push, like Fork.
  const [alt, setAlt] = useState(false)
  useEffect(() => {
    const track = (e: KeyboardEvent): void => setAlt(e.altKey)
    const reset = (): void => setAlt(false)
    window.addEventListener('keydown', track)
    window.addEventListener('keyup', track)
    window.addEventListener('blur', reset)
    return () => {
      window.removeEventListener('keydown', track)
      window.removeEventListener('keyup', track)
      window.removeEventListener('blur', reset)
    }
  }, [])
  // An amended commit that's already pushed needs a force push, which stays a deliberate step.
  const canPush = !amend || !pushedTo

  // Bumped on every toggle, so a slow headMessage() from an earlier "on" can't land after "off".
  const amendSeq = useRef(0)
  const toggleAmend = async (on: boolean): Promise<void> => {
    const seq = ++amendSeq.current
    if (on) {
      setBeforeAmend(draft)
      const msg = await window.spoon.headMessage(path)
      if (seq !== amendSeq.current) return
      const [subject, ...rest] = msg.split('\n')
      setDraft({ subject, body: rest.join('\n').replace(/^\n+/, '') })
    } else if (beforeAmend) {
      setDraft(beforeAmend)
      setBeforeAmend(null)
    }
  }

  const canCommit = !!draft.subject.trim() && (stagedCount > 0 || amend)

  // One commit at a time: a double-click or a held ⌘↵ must not commit (or amend, or push) twice.
  const [committing, setCommitting] = useState(false)
  const committingRef = useRef(false)
  const commit = async (push = false): Promise<void> => {
    if (committingRef.current) return
    if (!canCommit) {
      subjectRef.current?.focus()
      return
    }
    committingRef.current = true
    setCommitting(true)
    const message = draft.body.trim() ? `${draft.subject.trim()}\n\n${draft.body.trim()}\n` : `${draft.subject.trim()}\n`
    const ok = await ops
      .run(amend ? 'Amending…' : 'Committing…', () => window.spoon.commit(path, message, amend), 'Commit failed')
      .finally(() => {
        committingRef.current = false
        setCommitting(false)
      })
    if (ok) {
      setDraft({ subject: '', body: '' })
      setBeforeAmend(null)
      if (push && canPush) ops.push()
    }
  }

  const commitRef = useRef(commit)
  commitRef.current = commit
  useEffect(() => {
    if (!commitRequest) return
    onCommitHandled()
    commitRef.current(commitRequest.push)
  }, [commitRequest, onCommitHandled])

  const pushing = alt && canPush
  const label = pushing
    ? amend
      ? 'Amend and Push'
      : 'Commit and Push'
    : amend
      ? 'Amend Last Commit'
      : stagedCount
        ? `Commit ${stagedCount} File${stagedCount === 1 ? '' : 's'}`
        : 'Commit'

  return (
    <div className="commit-box">
      <input
        ref={subjectRef}
        className="commit-subject-input"
        placeholder="Summary"
        value={draft.subject}
        onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !mod(e)) e.preventDefault()
        }}
      />
      <textarea
        placeholder="Description"
        value={draft.body}
        onChange={(e) => setDraft({ ...draft, body: e.target.value })}
      />
      {amend && pushedTo && (
        <span className="amend-warning">
          This commit is already on {pushedTo}. After amending, pushing needs a force push.
        </span>
      )}
      <div className="commit-actions">
        {ops.review && (
          <button className="btn review-btn" onClick={() => ops.review?.()} title={`Review with Claude (${keys('⇧⌘R')})`}>
            ✦ Review
          </button>
        )}
        <label className="check">
          <input type="checkbox" checked={amend} onChange={(e) => toggleAmend(e.target.checked)} />
          Amend
        </label>
        <span className={`char-count ${draft.subject.length > 72 ? 'warn' : ''}`}>{draft.subject.length}</span>
        <button
          className={`btn primary ${pushing ? 'commit-push' : ''}`}
          disabled={!canCommit || committing}
          onClick={(e) => commit(e.altKey && canPush)}
          onMouseMove={(e) => e.altKey !== alt && setAlt(e.altKey)}
          title={`${keys('⌘↵')} to commit · hold ⌥ (or ${keys('⌥⌘↵')}) to commit and push`}
        >
          {label}
        </button>
      </div>
    </div>
  )
}
