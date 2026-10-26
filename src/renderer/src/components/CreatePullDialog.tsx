// Create Pull Request, in three steps. Details: title, description, target branch, assignee and
// reviewers, pre-filled from the branch (Jira key on the description's first line, you as assignee,
// the branch it started from as target). Review: hand the branch to Claude for a review first (or
// skip it). Create: push the branch if needed and open the pull request.
import { useEffect, useMemo, useState } from 'react'
import type { CreatedPull, GhUser, PullDraftInfo } from '../../../shared/types'
import { useAsync, usePersistentState } from '../hooks'
import { jiraConfig, jiraUrl, ticketKeys } from '../jira'
import { useSettings } from '../settings'
import { Modal } from './Modal'
import { CheckIcon, CloseIcon } from './Icons'
import { DEFAULT_PREFS, EFFORTS, FOCUS, MODELS, type Prefs } from './ReviewDialog'
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

type Step = 'details' | 'review' | 'create'

// Branches already sent for review this session (repo|branch → when), so reopening the dialog says so.
const reviewedAt = new Map<string, number>()

const BASE_REASON: Record<PullDraftInfo['baseReason'], string> = {
  'created-from': 'the branch was created from it',
  nearest: 'the branch forked from it most recently',
  default: 'the default branch'
}

export function CreatePullDialog({ path, branch, me, ops, onClose, onCreated }: Props) {
  const settings = useSettings()
  const { data: firstInfo, error } = useAsync(() => window.spoon.pullDraftInfo(path, branch), [path, branch])
  // Re-read when reaching the last step: fixes committed after the review belong in the PR too.
  const [latestInfo, setLatestInfo] = useState<PullDraftInfo | null>(null)
  const info = latestInfo ?? firstInfo
  const withReview = settings.claudeEnabled
  const [step, setStep] = useState<Step>('details')
  const [prefs, setPrefs] = usePersistentState<Prefs>('spoon.review.prefs', DEFAULT_PREFS)
  const p = { ...DEFAULT_PREFS, ...prefs }
  const { data: avail } = useAsync(() => window.spoon.claudeAvailability(), [])
  const [sentAt, setSentAt] = useState<number | null>(reviewedAt.get(`${path}|${branch}`) ?? null)
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const { data: users } = useAsync(() => window.spoon.ghAssignable(path).catch(() => [] as GhUser[]), [path])
  const [lastReviewers, setLastReviewers] = usePersistentState<string[]>(`spoon.pr.reviewers.${path}`, [])

  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [base, setBase] = useState('')
  const [assignee, setAssignee] = useState(me)
  const [reviewers, setReviewers] = useState<string[]>([])
  const [draft, setDraft] = useState(false)
  const [query, setQuery] = useState('')

  // Fill everything in once Spoon has looked at the branch (only the first time: the re-read on the
  // last step mustn't undo edits).
  useEffect(() => {
    const info = firstInfo
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
  }, [firstInfo])

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
  const goCreate = (): void => {
    setStep('create')
    window.spoon.pullDraftInfo(path, branch).then(setLatestInfo, () => undefined)
  }

  const reviewPrompt = (): string => {
    const focus = FOCUS.filter(([id]) => p.focus.includes(id)).map(([, , text]) => text)
    return [
      `Review the changes on the branch ${branch} since it left ${info?.remote ?? 'origin'}/${base}, before I open a pull request for it, and report what you find.`,
      focus.length ? `Look for: ${focus.join('; ')}.` : ''
    ]
      .filter(Boolean)
      .join('\n')
  }
  const setPref = (patch: Partial<Prefs>): void => setPrefs({ ...p, ...patch })
  const claudeOk = !!avail && (p.where === 'desktop' ? avail.desktop : !!avail.cli)
  const sendReview = (): void => {
    if (!claudeOk || sending) return
    setSending(true)
    setReviewError(null)
    window.spoon
      .claudeLaunch({
        where: p.where,
        cwd: path,
        model: p.model,
        effort: p.effort,
        name: `Review: ${branch} (PR into ${base})`,
        prompt: reviewPrompt()
      })
      .then(
        () => {
          const now = Date.now()
          reviewedAt.set(`${path}|${branch}`, now)
          setSentAt(now)
        },
        (err: Error) => setReviewError(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      )
      .finally(() => setSending(false))
  }

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

  const steps: [Step, string][] = [
    ['details', 'Details'],
    ['review', 'Claude review'],
    ['create', 'Create']
  ]
  const at = steps.findIndex(([id]) => id === step)
  const draftToggle = (
    <label className="check" style={{ marginRight: 'auto' }}>
      <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} />
      Draft
    </label>
  )
  const createButton = (
    <button className="btn primary" onClick={create} disabled={!canCreate}>
      {draft ? 'Create draft' : 'Create pull request'}
    </button>
  )
  const submit = !withReview
    ? create
    : step === 'details'
      ? () => canCreate && setStep('review')
      : step === 'review'
        ? () => (sentAt ? goCreate() : sendReview())
        : create

  return (
    <Modal
      title="Create pull request"
      onClose={onClose}
      onSubmit={submit}
      wide
      pending={!info && !error}
      footer={
        !withReview ? (
          <>
            {draftToggle}
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            {createButton}
          </>
        ) : step === 'details' ? (
          <>
            <button className="btn" style={{ marginLeft: 'auto' }} onClick={onClose}>
              Cancel
            </button>
            <button className="btn primary" onClick={() => setStep('review')} disabled={!canCreate}>
              Continue
            </button>
          </>
        ) : step === 'review' ? (
          <>
            <button className="btn" style={{ marginRight: 'auto' }} onClick={() => setStep('details')}>
              Back
            </button>
            {sentAt ? (
              <>
                <button className="btn" onClick={sendReview} disabled={!claudeOk || sending}>
                  Send again
                </button>
                <button className="btn primary" onClick={goCreate}>
                  Continue
                </button>
              </>
            ) : (
              <>
                <button className="btn" onClick={goCreate}>
                  Skip review
                </button>
                <button className="btn primary claude" onClick={sendReview} disabled={!claudeOk || sending}>
                  {sending ? 'Sending…' : 'Send for review'}
                </button>
              </>
            )}
          </>
        ) : (
          <>
            {draftToggle}
            <button className="btn" onClick={() => setStep('review')}>
              Back
            </button>
            {createButton}
          </>
        )
      }
    >
      {withReview && info && (
        <div className="ml-steps pr-steps">
          {steps.map(([id, label], i) => (
            <span key={id} className={`ml-step ${i === at ? 'on' : ''} ${i < at ? 'done' : ''}`}>
              <i>{i >= at ? i + 1 : id === 'review' && !sentAt ? '–' : <CheckIcon />}</i>
              {label}
              {id === 'review' && i < at && !sentAt && <span className="pr-step-note">skipped</span>}
            </span>
          ))}
        </div>
      )}
      {error && <p className="error-text">{error}</p>}
      {!info && !error && <p className="muted">Looking at {branch}…</p>}
      {info && (!withReview || step === 'details') && (
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

      {info && withReview && step === 'review' && (
        <div className="review-form pr-review">
          <p className="muted pr-review-lead">
            Have Claude look over <b>{branch}</b> before the pull request goes up. Spoon opens the session; read what it finds,
            fix and commit, then come back and continue.
          </p>
          {sentAt ? (
            <div className="pr-sent">
              <CheckIcon />
              <div>
                <b>
                  Sent to Claude at {new Date(sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </b>
                <span>Address what it finds and commit, then continue. New commits are included in the pull request.</span>
              </div>
            </div>
          ) : (
            <>
              <div className="field">
                <span className="field-label">Where</span>
                <div className="review-dest">
                  <button className={p.where === 'desktop' ? 'on' : ''} disabled={!avail?.desktop} onClick={() => setPref({ where: 'desktop' })}>
                    <b>Claude desktop</b>
                    <span>
                      {avail && !avail.desktop
                        ? 'The Claude app isn’t installed.'
                        : 'Opens a new Code session in this repo with the prompt filled in.'}
                    </span>
                  </button>
                  <button className={p.where === 'terminal' ? 'on' : ''} disabled={!avail?.cli} onClick={() => setPref({ where: 'terminal' })}>
                    <b>Terminal</b>
                    <span>
                      {avail && !avail.cli ? 'Claude Code isn’t installed.' : 'Opens Terminal in this repo with an interactive Claude Code session.'}
                    </span>
                  </button>
                </div>
              </div>
              {p.where === 'terminal' ? (
                <div className="review-model">
                  <div className="field">
                    <span className="field-label">Model</span>
                    <div className="segmented">
                      {MODELS.map(([id, label]) => (
                        <button key={id} className={p.model === id ? 'on' : ''} onClick={() => setPref({ model: id })}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="field">
                    <span className="field-label">Effort</span>
                    <div className="segmented">
                      {EFFORTS.map((e) => (
                        <button key={e} className={p.effort === e ? 'on' : ''} onClick={() => setPref({ effort: e })}>
                          {e}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <span className="hint">Model and effort are chosen in the Claude app.</span>
              )}
              <div className="field">
                <span className="field-label">Look for</span>
                <div className="review-chips">
                  {FOCUS.map(([id, label]) => (
                    <button
                      key={id}
                      className={p.focus.includes(id) ? 'on' : ''}
                      onClick={() => setPref({ focus: p.focus.includes(id) ? p.focus.filter((f) => f !== id) : [...p.focus, id] })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
          {reviewError && <p className="error-text">{reviewError}</p>}
        </div>
      )}

      {info && withReview && step === 'create' && (
        <div className="pr-summary">
          <div className="pr-summary-title">{title.trim()}</div>
          <div className="pr-route">
            <span className="ref-badge head">{branch}</span>
            <span className="muted">into</span>
            <span className="ref-badge remote">{base}</span>
          </div>
          <dl>
            <dt>Commits</dt>
            <dd>
              {base === info.base
                ? `${info.commits.length} commit${info.commits.length === 1 ? '' : 's'}`
                : `Everything since it left ${base}`}
              {latestInfo && firstInfo && latestInfo.commits.length > firstInfo.commits.length && (
                <span className="pr-new"> · {latestInfo.commits.length - firstInfo.commits.length} new since the review</span>
              )}
            </dd>
            <dt>Claude review</dt>
            <dd>{sentAt ? `Sent at ${new Date(sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Skipped'}</dd>
            <dt>Assignee</dt>
            <dd>{assignee || 'No one'}</dd>
            <dt>Reviewers</dt>
            <dd>{reviewers.length ? reviewers.join(', ') : 'None'}</dd>
            {info.needsPush && (
              <>
                <dt>Push</dt>
                <dd>
                  {branch} is pushed to {info.remote}/{info.headRef} first
                </dd>
              </>
            )}
          </dl>
        </div>
      )}
    </Modal>
  )
}
