// Create Pull Request: title, description, target branch, assignee and reviewers, pre-filled from
// the branch (Jira key on the description's first line, you as assignee, the branch it started from
// as target). Pushes the branch first when the remote doesn't have it yet.
import { useEffect, useMemo, useState } from 'react'
import type { CreatedPull, GhUser, PullDraftInfo } from '../../../shared/types'
import { useAsync, usePersistentState } from '../hooks'
import { jiraConfig, jiraUrl, ticketKeys } from '../jira'
import { useSettings } from '../settings'
import { Modal } from './Modal'
import { CloseIcon } from './Icons'
import type { Ops } from './RepoView'

interface Props {
  path: string
  branch: string
  me: string
  ops: Ops
  onClose: () => void
  onCreated: (pull: CreatedPull) => void
}

/** "feature/MAINLIB-2580-fix-banner" → "MAINLIB-2580: Fix banner". */
function titleFromBranch(branch: string, key: string | undefined): string {
  let rest = branch.split('/').pop() ?? branch
  if (key) rest = rest.replace(key, '')
  rest = rest.replace(/[-_]+/g, ' ').trim()
  rest = rest ? rest[0].toUpperCase() + rest.slice(1) : ''
  return key ? (rest ? `${key}: ${rest}` : key) : rest
}

const BASE_REASON: Record<PullDraftInfo['baseReason'], string> = {
  'created-from': 'the branch was created from it',
  nearest: 'the branch forked from it most recently',
  default: 'the default branch'
}

export function CreatePullDialog({ path, branch, me, ops, onClose, onCreated }: Props) {
  const settings = useSettings()
  const { data: info, error } = useAsync(() => window.spoon.pullDraftInfo(path, branch), [path, branch])
  const { data: users } = useAsync(() => window.spoon.ghAssignable(path).catch(() => [] as GhUser[]), [path])
  const [lastReviewers, setLastReviewers] = usePersistentState<string[]>(`spoon.pr.reviewers.${path}`, [])

  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [base, setBase] = useState('')
  const [assignee, setAssignee] = useState(me)
  const [reviewers, setReviewers] = useState<string[]>([])
  const [draft, setDraft] = useState(false)
  const [query, setQuery] = useState('')

  // Fill everything in once Spoon has looked at the branch.
  useEffect(() => {
    if (!info) return
    const jira = jiraConfig(settings)
    const key = ticketKeys(branch, jira)[0] ?? /\b([A-Z][A-Z0-9]{1,9}-\d{1,7})\b/.exec(branch)?.[1]
    setTitle(info.commits.length === 1 ? info.commits[0].subject : titleFromBranch(branch, key))
    const first = key ? (jira ? `[${key}](${jiraUrl(jira, key)})` : key) : ''
    const rest = info.template ?? (info.commits.length > 1 ? info.commits.map((c) => `- ${c.subject}`).join('\n') : '')
    setBody([first, rest].filter(Boolean).join('\n\n'))
    setBase(info.base)
    setReviewers(lastReviewers.filter((r) => r !== me))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info])

  const candidates = useMemo(
    () =>
      (users ?? [])
        .filter((u) => u.login !== me && !reviewers.includes(u.login))
        .filter((u) => !query || u.login.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 8),
    [users, me, reviewers, query]
  )
  const avatar = (login: string): string | undefined => users?.find((u) => u.login === login)?.avatarUrl

  const canCreate = !!info && !!title.trim() && !!base
  const create = (): void => {
    if (!info || !canCreate) return
    onClose()
    setLastReviewers(reviewers)
    let created: CreatedPull | null = null
    ops
      .run(
        info.needsPush ? `Pushing ${branch} and opening a pull request…` : 'Opening pull request…',
        async () => {
          if (info.needsPush)
            await window.spoon.push(path, {
              remote: info.remote,
              remoteBranch: info.headRef,
              setUpstream: !info.hasUpstream,
              tags: false,
              branch
            })
          created = await window.spoon.ghCreatePull(path, {
            branch,
            headRef: info.headRef,
            base,
            title: title.trim(),
            body,
            draft,
            assignees: assignee ? [assignee] : [],
            reviewers
          })
        },
        'Couldn’t create the pull request'
      )
      .then((ok) => ok && created && onCreated(created))
  }

  return (
    <Modal
      title="Create pull request"
      onClose={onClose}
      onSubmit={create}
      wide
      footer={
        <>
          <label className="check" style={{ marginRight: 'auto' }}>
            <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} />
            Draft
          </label>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={create} disabled={!canCreate}>
            {draft ? 'Create draft' : 'Create pull request'}
          </button>
        </>
      }
    >
      {error && <p className="error-text">{error}</p>}
      {!info && !error && <p className="muted">Looking at {branch}…</p>}
      {info && (
        <div className="pr-form">
          <div className="pr-route">
            <span className="ref-badge head">{branch}</span>
            <span className="muted">into</span>
            <select value={base} onChange={(e) => setBase(e.target.value)} title={`${info.remote}/${base}`}>
              {info.bases.map((b) => (
                <option key={b} value={b}>
                  {b}
                  {b === info.base ? ' (started from here)' : ''}
                </option>
              ))}
            </select>
          </div>
          {base === info.base && <span className="hint">Picked because {BASE_REASON[info.baseReason]}.</span>}

          <label className="field">
            <span className="field-label">Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} spellCheck autoFocus />
          </label>
          <label className="field">
            <span className="field-label">Description</span>
            <textarea className="pr-body" value={body} onChange={(e) => setBody(e.target.value)} rows={7} />
          </label>

          <div className="pr-people">
            <label className="field">
              <span className="field-label">Assignee</span>
              <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                <option value="">No one</option>
                {[me, ...(users ?? []).map((u) => u.login).filter((l) => l !== me)].map((l) => (
                  <option key={l} value={l}>
                    {l}
                    {l === me ? ' (you)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <div className="field">
              <span className="field-label">Reviewers</span>
              <div className="pr-reviewers">
                {reviewers.map((r) => (
                  <span key={r} className="pr-chip">
                    {avatar(r) && <img src={avatar(r)} alt="" />}
                    {r}
                    <button
                      className="icon-btn"
                      aria-label={`Remove ${r}`}
                      onClick={() => setReviewers(reviewers.filter((x) => x !== r))}
                    >
                      <CloseIcon />
                    </button>
                  </span>
                ))}
                <input
                  data-own-enter
                  placeholder={users ? 'Add a reviewer' : 'Loading people…'}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter here only ever adds a reviewer, never submits the dialog.
                    if (e.key !== 'Enter') return
                    e.preventDefault()
                    if (candidates[0]) {
                      setReviewers([...reviewers, candidates[0].login])
                      setQuery('')
                    }
                  }}
                />
              </div>
              {query && candidates.length > 0 && (
                <div className="pr-suggest">
                  {candidates.map((u) => (
                    <button
                      key={u.login}
                      onClick={() => {
                        setReviewers([...reviewers, u.login])
                        setQuery('')
                      }}
                    >
                      {u.avatarUrl && <img src={u.avatarUrl} alt="" />}
                      {u.login}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <span className="hint">
            {base === info.base ? `${info.commits.length} commit${info.commits.length === 1 ? '' : 's'} into ${base}` : `Into ${base}`}
            {info.needsPush ? ` · ${branch} is pushed to ${info.remote}/${info.headRef} first` : ''}
            {!info.needsPush && info.headRef !== branch ? ` · from ${info.remote}/${info.headRef}` : ''}
          </span>
        </div>
      )}
    </Modal>
  )
}
