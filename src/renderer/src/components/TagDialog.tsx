// New Tag: puts a tag on a commit. A strip of the graph shows the commit between its neighbours with
// the tag already on it (as typed), and the branch it's on, so it's clear where the tag lands before
// it's created (and, optionally, pushed).
import { useEffect, useState, type ReactNode } from 'react'
import type { Commit, RepoState } from '../../../shared/types'
import { useAsync, usePersistentState } from '../hooks'
import { Modal } from './Modal'
import { BranchIcon, CloudIcon, TagIcon } from './Icons'
import type { Ops } from './RepoView'

interface Props {
  path: string
  repo: RepoState
  commit: Commit
  /** The loaded history, for the commits around this one. */
  commits: Commit[]
  ops: Ops
  onClose: () => void
}

export function TagDialog({ path, repo, commit, commits, ops, onClose }: Props) {
  const { data: target, error } = useAsync(() => window.spoon.tagTarget(path, commit.hash), [path, commit.hash])
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  const remote = repo.remotes.includes('origin') ? 'origin' : repo.remotes[0]
  const [push, setPush] = usePersistentState('spoon.tag.push', true)

  const trimmed = name.trim()
  const taken = repo.refs.some((r) => r.kind === 'tag' && r.name === trimmed)
  const invalid = /\s|\.\.|[~^:?*[\\]|^[-/.]|[/.]$|\.lock$|@\{/.test(trimmed)
  const problem = taken ? `${trimmed} already exists.` : trimmed && invalid ? 'Tag names can’t have spaces or ~ ^ : ? * [ \\.' : null
  const canCreate = !!trimmed && !problem

  const create = (): void => {
    if (!canCreate) return
    onClose()
    const pushTo = push && remote ? remote : undefined
    ops.run(
      pushTo ? `Creating ${trimmed} and pushing it to ${pushTo}…` : `Creating ${trimmed}…`,
      () => window.spoon.createTag(path, { name: trimmed, hash: commit.hash, message, remote: pushTo }),
      'Couldn’t create the tag'
    )
  }

  // The branch named first: one whose tip this commit is (local before remote), else the nearest
  // local branch, else a remote one. Among equally near branches, the checked-out one comes first.
  const near = (target?.branches ?? [])
    .slice()
    .sort(
      (x, y) =>
        x.ahead - y.ahead ||
        Number(x.remote) - Number(y.remote) ||
        Number(y.name === repo.headBranch) - Number(x.name === repo.headBranch)
    )
  const local = near.filter((b) => !b.remote)
  const main = near.find((b) => b.ahead === 0) ?? local[0] ?? near[0]
  // The checked-out branch is the one worth naming next.
  const others = near
    .filter((b) => b !== main)
    .sort((x, y) => Number(y.name === repo.headBranch) - Number(x.name === repo.headBranch))
  const onHead = !!repo.headBranch && local.some((b) => b.name === repo.headBranch)

  // A commit at the tip of a versioned branch ("candidates/4.1.1") gets that version as its name
  // ("v4.1.1"), unless something was typed already.
  const version = main && main.ahead === 0 ? /(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?!.*\d+\.\d+\.\d+)/.exec(main.name)?.[1] : undefined
  useEffect(() => {
    if (version) setName((n) => n || `v${version}`)
  }, [version])

  // The graph strip: the commit with the one above and below it, as drawn in the history.
  const above = commits.find((c) => c.parents[0] === commit.hash)
  const below = commits.find((c) => c.hash === commit.parents[0])
  // Up to two labels per row, local branches first; a remote branch matching a local one is left out.
  const labels = (hash: string): ReactNode =>
    repo.refs
      .filter((r) => r.target === hash)
      .filter((r, _, all) => r.kind !== 'remote' || !all.some((x) => x.kind === 'head' && r.name.endsWith(`/${x.name}`)))
      .sort((a, b) => Number(a.kind !== 'head') - Number(b.kind !== 'head'))
      .slice(0, 2)
      .map((r) => (
        <span key={r.fullName} className={`ref-badge ${r.kind}`}>
          {r.kind === 'tag' && <TagIcon />}
          {r.name}
        </span>
      ))

  return (
    <Modal
      title="New tag"
      onClose={onClose}
      onSubmit={create}
      wide
      footer={
        <>
          {remote && (
            <label className="check" style={{ marginRight: 'auto' }}>
              <input type="checkbox" checked={push} onChange={(e) => setPush(e.target.checked)} />
              Push to {remote}
            </label>
          )}
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={create} disabled={!canCreate}>
            {trimmed && !problem ? `Create ${trimmed}` : 'Create tag'}
          </button>
        </>
      }
    >
      <div className="tag-form">
        <div className="tag-strip">
          {above && (
            <div className="tag-strip-row">
              <StripNode line="down" />
              {labels(above.hash)}
              <span className="tag-strip-subject muted">{above.subject}</span>
            </div>
          )}
          <div className="tag-strip-row target">
            <StripNode line={above ? (below ? 'both' : 'up') : below ? 'down' : 'none'} target />
            <span className={`ref-badge tag ghost ${trimmed ? '' : 'empty'}`}>
              <TagIcon />
              {trimmed || 'new tag'}
            </span>
            {labels(commit.hash)}
            <span className="tag-strip-subject">{commit.subject}</span>
            <span className="mono tag-hash">{commit.hash.slice(0, 9)}</span>
          </div>
          {below && (
            <div className="tag-strip-row">
              <StripNode line="up" />
              {labels(below.hash)}
              <span className="tag-strip-subject muted">{below.subject}</span>
            </div>
          )}
        </div>

        <div className={`tag-branch ${target && !main ? 'none' : ''}`}>
          {error ? (
            <span className="error-text">{error}</span>
          ) : !target ? (
            <span className="muted">Looking at its branches…</span>
          ) : !main ? (
            <span>Not on any branch: only this tag will keep the commit.</span>
          ) : (
            <>
              {main.remote ? <CloudIcon /> : <BranchIcon />}
              <span>
                {main.ahead === 0 ? 'Tip of ' : 'On '}
                <b>{main.name}</b>
                {main.ahead > 0 && `, ${main.ahead} below its tip`}
                {main.name === repo.headBranch && <span className="muted"> (checked out)</span>}
                {others.length > 0 && (
                  <span
                    className="muted tag-also"
                    title={near
                      .filter((b) => b !== main)
                      .map((b) => b.name)
                      .join('\n')}
                  >
                    {' '}
                    · also on {others[0].name}
                    {others[0].name === repo.headBranch ? ' (checked out)' : ''}
                    {target.total > 2 ? ` and ${target.total - 2} more` : ''}
                  </span>
                )}
              </span>
            </>
          )}
        </div>
        {target && repo.headBranch && !onHead && (
          <span className="hint warn-text tag-warn">Not on the checked-out branch, {repo.headBranch}.</span>
        )}

        <label className="field">
          <span className="field-label">Name</span>
          <span className="tag-name">
            <TagIcon />
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="v2.3.1" spellCheck={false} autoFocus />
          </span>
          {problem && <span className="error-text hint">{problem}</span>}
        </label>
        <label className="field">
          <span className="field-label">
            Message (optional: makes it an annotated tag)
          </span>
          <textarea rows={2} value={message} onChange={(e) => setMessage(e.target.value)} />
        </label>
      </div>
    </Modal>
  )
}

/** One dot of the graph strip, with the line running up, down or both ways out of it. */
function StripNode({ line, target }: { line: 'up' | 'down' | 'both' | 'none'; target?: boolean }) {
  return (
    <svg className="tag-strip-node" width="22" height="30" viewBox="0 0 22 30" aria-hidden="true">
      {(line === 'up' || line === 'both') && <path d="M11 0V15" />}
      {(line === 'down' || line === 'both') && <path d="M11 15V30" />}
      {target ? <circle cx="11" cy="15" r="5.5" className="ring" /> : <circle cx="11" cy="15" r="4" className="dot" />}
    </svg>
  )
}
