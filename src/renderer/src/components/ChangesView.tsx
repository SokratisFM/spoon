import { useEffect, useRef, useState } from 'react'
import type { DiffTarget, FileChange, WorkingTree } from '../../../shared/types'
import { usePersistentState } from '../hooks'
import type { Ops } from './RepoView'
import { Split } from './Split'
import { FileList } from './FileList'
import { DiffView, type HunkAction } from './DiffView'
import { keys, mod, revealLabel } from '../platform'

type Area = 'unstaged' | 'staged'

interface Selection {
  area: Area
  paths: Set<string>
  focused: string
}

interface Props {
  path: string
  tree: WorkingTree
  ops: Ops
  /** Set by ⌘Enter from the menu; cleared with onCommitHandled once acted on. */
  commitRequest: number
  onCommitHandled: () => void
}

/** Paths git needs for a set of entries: renames are staged/unstaged as old + new path. */
const pathsOf = (files: FileChange[]): string[] => files.flatMap((f) => (f.oldPath ? [f.oldPath, f.path] : [f.path]))

export function ChangesView({ path, tree, ops, commitRequest, onCommitHandled }: Props) {
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

  const stage = (files: FileChange[]): void => {
    ops.run('Staging…', () => window.spoon.stage(path, pathsOf(files)), 'Stage failed')
  }
  const unstage = (files: FileChange[]): void => {
    ops.run('Unstaging…', () => window.spoon.unstage(path, pathsOf(files)), 'Unstage failed')
  }
  const selectedIn = (area: Area): FileChange[] =>
    sel?.area === area ? tree[area].filter((f) => sel.paths.has(f.path)) : []

  const contextMenu = (area: Area) => async (files: FileChange[]) => {
    const n = files.length === 1 ? '' : ` ${files.length} files`
    const choice = await window.spoon.contextMenu([
      { id: 'toggle', label: area === 'unstaged' ? `Stage${n}` : `Unstage${n}` },
      { separator: true },
      { id: 'reveal', label: revealLabel, enabled: files.length === 1 },
      { id: 'copy', label: files.length === 1 ? 'Copy Path' : 'Copy Paths' }
    ])
    if (choice === 'toggle') (area === 'unstaged' ? stage : unstage)(files)
    else if (choice === 'reveal') window.spoon.revealInFinder(`${path}/${files[0].path}`)
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
          ops={ops}
          commitRequest={commitRequest}
          onCommitHandled={onCommitHandled}
        />
      </div>
      <DiffView path={path} target={target} nonce={tree} hunkAction={hunkAction} />
    </Split>
  )
}

interface CommitBoxProps {
  path: string
  stagedCount: number
  ops: Ops
  commitRequest: number
  onCommitHandled: () => void
}

function CommitBox({ path, stagedCount, ops, commitRequest, onCommitHandled }: CommitBoxProps) {
  // The draft survives restarts and tab switches, like Fork.
  const [draft, setDraft] = usePersistentState(`spoon.draft.${path}`, { subject: '', body: '' })
  const [amend, setAmend] = useState(false)
  const beforeAmend = useRef<{ subject: string; body: string } | null>(null)
  const subjectRef = useRef<HTMLInputElement>(null)

  const toggleAmend = async (on: boolean): Promise<void> => {
    setAmend(on)
    if (on) {
      beforeAmend.current = draft
      const msg = await window.spoon.headMessage(path)
      const [subject, ...rest] = msg.split('\n')
      setDraft({ subject, body: rest.join('\n').replace(/^\n+/, '') })
    } else if (beforeAmend.current) {
      setDraft(beforeAmend.current)
      beforeAmend.current = null
    }
  }

  const canCommit = !!draft.subject.trim() && (stagedCount > 0 || amend)

  const commit = async (): Promise<void> => {
    if (!canCommit) {
      subjectRef.current?.focus()
      return
    }
    const message = draft.body.trim() ? `${draft.subject.trim()}\n\n${draft.body.trim()}\n` : `${draft.subject.trim()}\n`
    const ok = await ops.run(amend ? 'Amending…' : 'Committing…', () => window.spoon.commit(path, message, amend), 'Commit failed')
    if (ok) {
      setDraft({ subject: '', body: '' })
      setAmend(false)
      beforeAmend.current = null
    }
  }

  const commitRef = useRef(commit)
  commitRef.current = commit
  useEffect(() => {
    if (!commitRequest) return
    onCommitHandled()
    commitRef.current()
  }, [commitRequest, onCommitHandled])

  const label = amend ? 'Amend Last Commit' : stagedCount ? `Commit ${stagedCount} File${stagedCount === 1 ? '' : 's'}` : 'Commit'

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
      <div className="commit-actions">
        <label className="check">
          <input type="checkbox" checked={amend} onChange={(e) => toggleAmend(e.target.checked)} />
          Amend
        </label>
        <span className={`char-count ${draft.subject.length > 72 ? 'warn' : ''}`}>{draft.subject.length}</span>
        <button className="btn primary" disabled={!canCommit} onClick={commit} title={keys('⌘↵')}>
          {label}
        </button>
      </div>
    </div>
  )
}
