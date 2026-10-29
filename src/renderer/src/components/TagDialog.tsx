// New Tag: puts a tag on a commit. A strip of the graph shows the commit between its neighbours with
// the tag already on it (as typed), and the branch it's on, so it's clear where the tag lands before
// it's created (and, optionally, pushed). With a GitHub remote, the same press can also publish a
// GitHub release for the tag, with notes GitHub writes from what was merged since the last release.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { choose } from '../dialogs'
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
  /** Signed in to GitHub, and the repository is on GitHub: releases can be published. */
  github: boolean
  onClose: () => void
}

export function TagDialog({ path, repo, commit, commits, ops, github, onClose }: Props) {
  const { data: target, error } = useAsync(() => window.spoon.tagTarget(path, commit.hash), [path, commit.hash])
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  const remote = repo.remotes.includes('origin') ? 'origin' : repo.remotes[0]
  const [push, setPush] = usePersistentState('spoon.tag.push', true)

  const trimmed = name.trim()
  const taken = repo.refs.some((r) => r.kind === 'tag' && r.name === trimmed)
  // git check-ref-format's rules: no spaces, control characters or ~ ^ : ? * [ \, no "..", "//" or
  // "@{", no part that starts with "." or ends in ".lock", not just "@", and no "/" or "." at the ends.
  const invalid =
    /[\s\x00-\x1f\x7f]|\.\.|\/\/|[~^:?*[\\]|^[-/.]|[/.]$|@\{/.test(trimmed) ||
    trimmed === '@' ||
    trimmed.split('/').some((part) => part.startsWith('.') || part.endsWith('.lock'))
  const problem = taken ? `${trimmed} already exists.` : trimmed && invalid ? 'Tag names can’t have spaces or ~ ^ : ? * [ \\.' : null
  const canCreate = !!trimmed && !problem

  // The GitHub release: on or off is remembered per repository.
  const [releaseOn, setReleaseOn] = usePersistentState(`spoon.tag.release.${path}`, false)
  // The release goes to the GitHub repository; the tag has to be pushed to the remote that points there.
  const { data: ghRemote } = useAsync(
    () => (github ? window.spoon.ghRepoRemote(path).catch(() => null) : Promise.resolve(null)),
    [path, github]
  )
  const release = github && !!ghRemote && releaseOn
  const pushRemote = release ? ghRemote!.remote : remote
  const [title, setTitle] = useState<string | null>(null) // null: follows the tag's name
  const [notes, setNotes] = useState<string | null>(null) // null: not generated or written yet
  const [notesEdited, setNotesEdited] = useState(false)
  const [notesState, setNotesState] = useState<'idle' | 'loading' | string>('idle')
  const preTag = /-(rc|beta|alpha|preview|pre)\b/i.test(trimmed)
  const [prerelease, setPrerelease] = useState<boolean | null>(null)
  const [latest, setLatest] = useState<boolean | null>(null)
  const [draft, setDraft] = useState(false)
  const [creating, setCreating] = useState(false)
  const isPre = prerelease ?? preTag
  const isLatest = latest ?? !isPre
  const { data: previous } = useAsync(
    () => (release ? window.spoon.ghLatestRelease(path).catch(() => null) : Promise.resolve(null)),
    [path, release]
  )
  // Only the newest request's reply counts, and none that comes back after the notes were edited.
  const request = useRef(0)
  const edits = useRef(0)
  const generate = (): void => {
    if (!trimmed || problem) return
    const id = ++request.current
    const editsBefore = edits.current
    setNotesState('loading')
    const current = (): boolean => id === request.current && editsBefore === edits.current
    window.spoon.ghReleaseNotes(path, trimmed, commit.hash).then(
      (n) => {
        if (!current()) return
        setNotes(n.body)
        setNotesEdited(false)
        setNotesState('idle')
      },
      (err: Error) => current() && setNotesState(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    )
  }
  // Notes follow the name (once typing pauses) until they're edited by hand.
  useEffect(() => {
    if (!release || notesEdited || !trimmed || problem) return
    const t = setTimeout(generate, 500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [release, trimmed, !!problem])

  const notesLoading = release && notesState === 'loading'
  const create = (): void => {
    if (!canCreate || notesLoading || creating) return
    // The dialog stays until it worked, so a failure doesn't lose the name, message or notes.
    setCreating(true)
    // A release needs the tag on GitHub, so it's always pushed then.
    const pushTo = (push || release) && pushRemote ? pushRemote : undefined
    let url = ''
    ops
      .run(
        release ? `Creating ${trimmed} and publishing its release…` : pushTo ? `Creating ${trimmed} and pushing it to ${pushTo}…` : `Creating ${trimmed}…`,
        async () => {
          await window.spoon.createTag(path, { name: trimmed, hash: commit.hash, message, remote: pushTo })
          if (release)
            url = await window.spoon.ghCreateRelease(path, {
              tag: trimmed,
              target: commit.hash,
              name: (title ?? trimmed).trim() || trimmed,
              body: notes ?? '',
              draft,
              prerelease: isPre,
              latest: isLatest && !draft
            })
        },
        release ? 'Couldn’t create the tag or its release' : 'Couldn’t create the tag'
      )
      .then(async (ok) => {
        setCreating(false)
        if (!ok) return
        onClose()
        if (!url) return
        const choice = await choose({
          title: draft ? `Release ${trimmed} saved as a draft` : `Release ${trimmed} published`,
          detail: url,
          cancelId: 'done',
          buttons: [
            { id: 'done', label: 'Done' },
            { id: 'open', label: 'Open on GitHub', kind: 'primary' }
          ]
        })
        if (choice === 'open') window.spoon.openExternal(url)
      })
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
          {pushRemote && (
            <label className="check" style={{ marginRight: 'auto' }} title={release ? 'A release needs the tag on GitHub' : undefined}>
              <input type="checkbox" checked={push || release} disabled={release} onChange={(e) => setPush(e.target.checked)} />
              Push to {pushRemote}
            </label>
          )}
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={create} disabled={!canCreate || notesLoading || creating} title={notesLoading ? 'Waiting for the release notes' : undefined}>
            {trimmed && !problem ? (release ? `Create ${trimmed} and release` : `Create ${trimmed}`) : 'Create tag'}
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
        {target && pushRemote && (push || release) && !target.branches.some((b) => b.remote) && (
          <span className="hint warn-text tag-warn">
            This commit is only on your machine: pushing the tag uploads it (and the commits before it) to {pushRemote}.
          </span>
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

        {github && ghRemote && (
          <div className="check">
            <input id="tag-release" type="checkbox" checked={releaseOn} onChange={(e) => setReleaseOn(e.target.checked)} />
            <label htmlFor="tag-release">Publish a GitHub release for it</label>
          </div>
        )}
        {release && (
          <div className="tag-release">
            <label className="field">
              <span className="field-label">Title</span>
              <input value={title ?? trimmed} onChange={(e) => setTitle(e.target.value)} placeholder={trimmed || 'v2.3.1'} />
            </label>
            <div className="field">
              <span className="field-label tag-notes-label">
                Notes
                <button className="link-btn" onClick={generate} disabled={!trimmed || !!problem || notesState === 'loading'}>
                  {notesState === 'loading' ? 'Generating…' : `↻ Generate from changes since ${previous ?? 'the last release'}`}
                </button>
              </span>
              <textarea
                className="tag-notes"
                rows={7}
                value={notes ?? ''}
                placeholder={trimmed ? 'GitHub writes these from what was merged since the last release.' : 'Name the tag first.'}
                onChange={(e) => {
                  edits.current++
                  request.current++ // a reply still on its way no longer applies
                  setNotes(e.target.value)
                  setNotesEdited(true)
                  if (notesState === 'loading') setNotesState('idle')
                }}
                onKeyDown={(e) => e.stopPropagation()}
              />
              {notesState !== 'idle' && notesState !== 'loading' && <span className="error-text hint">{notesState}</span>}
            </div>
            <div className="tag-flags">
              <label className="check">
                <input type="checkbox" checked={isLatest && !draft} disabled={draft || isPre} onChange={(e) => setLatest(e.target.checked)} />
                Set as latest
              </label>
              <label className="check">
                <input type="checkbox" checked={isPre} onChange={(e) => setPrerelease(e.target.checked)} />
                Pre-release
              </label>
              <label className="check">
                <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} />
                Save as draft
              </label>
            </div>
          </div>
        )}
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
