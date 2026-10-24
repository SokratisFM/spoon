// A GitHub pull request inside Spoon: Conversation, Commits and Files changed, with inline review
// comments that collect into a pending review and get submitted to GitHub in one go.
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type {
  PendingComment,
  PullDetail,
  PullFile,
  ReviewComment,
  ReviewEvent,
  TimelineItem
} from '../../../shared/types'
import { cleanError, useAsync, usePersistentState, useSlidingIndicator } from '../hooks'
import { splitPath } from '../format'
import type { Ops } from './RepoView'
import { Split } from './Split'
import { Markdown } from './Markdown'
import { DiffLayoutToggle, pairLines, parseDiff, type Line } from './DiffView'
import { useSettings } from '../settings'
import { CloseIcon, PlusIcon, PullRequestIcon } from './Icons'
import { keys, mod } from '../platform'

type Tab = 'conversation' | 'commits' | 'files'
const MAX_PATCH_LINES = 5000

interface Props {
  path: string
  number: number
  ops: Ops
  onJump: (hash: string) => void
}

export function PullRequestView({ path, number, ops, onJump }: Props) {
  const [reload, setReload] = useState(0)
  const { data: pr, error, loading } = useAsync(() => window.spoon.ghPull(path, number), [path, number, reload])
  const [tab, setTab] = usePersistentState<Tab>('spoon.pr.tab', 'files')
  const [pending, setPending] = usePersistentState<PendingComment[]>(`spoon.review.${path}#${number}`, [])
  const [file, setFile] = useState<string | null>(null)
  const [viewed, setViewed] = useState<Record<string, boolean>>({})
  const [showReview, setShowReview] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const tabsRef = useSlidingIndicator<HTMLDivElement>()

  useEffect(() => {
    if (!pr) return
    setViewed(Object.fromEntries(pr.files.map((f) => [f.path, f.viewed])))
    setFile((f) => (f && pr.files.some((x) => x.path === f) ? f : (pr.files[0]?.path ?? null)))
  }, [pr])

  if (error) return <div className="empty-state error-text">{error}</div>
  if (!pr) return <div className="empty-state muted">{loading ? 'Loading pull request…' : ''}</div>

  const refresh = (): void => setReload((n) => n + 1)
  const act = async (fn: () => Promise<unknown>): Promise<boolean> => {
    setActionError(null)
    try {
      await fn()
      refresh()
      return true
    } catch (err) {
      setActionError(cleanError(err))
      return false
    }
  }

  const toggleViewed = async (f: PullFile): Promise<void> => {
    const next = !viewed[f.path]
    setViewed((v) => ({ ...v, [f.path]: next }))
    try {
      await window.spoon.ghSetViewed(path, pr.nodeId, f.path, next)
    } catch (err) {
      setViewed((v) => ({ ...v, [f.path]: !next }))
      setActionError(cleanError(err))
    }
  }

  const viewedCount = pr.files.filter((f) => viewed[f.path]).length
  const stateLabel = pr.state === 'merged' ? 'Merged' : pr.state === 'closed' ? 'Closed' : pr.draft ? 'Draft' : 'Open'

  return (
    <div className="pr-view">
      <div className="pr-header">
        <div className="pr-title-row">
          <h2>
            {pr.title} <span className="muted">#{pr.number}</span>
          </h2>
          <button className="btn" onClick={() => window.spoon.openExternal(pr.url)}>
            Open on GitHub
          </button>
        </div>
        <div className="pr-meta">
          <span className={`pr-state ${pr.state} ${pr.draft ? 'draft' : ''}`}>
            <PullRequestIcon /> {stateLabel}
          </span>
          <img className="gh-avatar" src={pr.author.avatarUrl} alt="" />
          <span>
            <b>{pr.author.login}</b> wants to merge {pr.commits.length} commit{pr.commits.length === 1 ? '' : 's'} into
          </span>
          <span className="pr-branch">{pr.baseRef}</span>
          <span>from</span>
          <span className="pr-branch" title={pr.headRepo ?? ''}>
            {pr.headRepo && pr.headRepo !== pr.baseRepo ? `${pr.headRepo.split('/')[0]}:` : ''}
            {pr.headRef}
          </span>
          <Checks checks={pr.checks} />
          <span className="pr-stat plus">+{pr.additions}</span>
          <span className="pr-stat minus">−{pr.deletions}</span>
        </div>
      </div>

      <div className="pr-tabs" ref={tabsRef}>
        {(
          [
            ['conversation', 'Conversation', pr.timeline.length + 1],
            ['commits', 'Commits', pr.commits.length],
            ['files', 'Files changed', pr.files.length]
          ] as const
        ).map(([id, label, count]) => (
          <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            {label} <span className="count">{count}</span>
          </button>
        ))}
        <span className="spacer" />
        {tab === 'files' && (
          <span className="muted viewed-count">
            {viewedCount}/{pr.files.length} viewed
          </span>
        )}
        <button
          className="btn"
          onClick={() =>
            ops.run(`Checking out #${pr.number}…`, () => window.spoon.ghCheckoutPull(path, pr.number), 'Checkout failed')
          }
        >
          Check out branch
        </button>
        <div className="review-anchor">
          <button className={`btn ${pending.length ? 'primary' : ''}`} onClick={() => setShowReview((s) => !s)}>
            Review changes{pending.length ? ` · ${pending.length}` : ''}
          </button>
          {showReview && (
            <ReviewPanel
              pr={pr}
              pending={pending}
              onClose={() => setShowReview(false)}
              onSubmit={async (event, body) => {
                const ok = await ops.run(
                  'Submitting review…',
                  () =>
                    window.spoon.ghSubmitReview(path, pr.number, { event, body, commitId: pr.headSha, comments: pending }),
                  'Review failed'
                )
                if (ok) {
                  setPending([])
                  setShowReview(false)
                  refresh()
                }
              }}
            />
          )}
        </div>
      </div>

      {actionError && (
        <div className="banner error" onClick={() => setActionError(null)}>
          {actionError}
        </div>
      )}

      {tab === 'conversation' && (
        <Conversation
          pr={pr}
          onComment={(body) => act(() => window.spoon.ghComment(path, pr.number, body))}
          onReply={(id, body) => act(() => window.spoon.ghReply(path, pr.number, id, body))}
          onOpenFile={(p) => {
            setFile(p)
            setTab('files')
          }}
        />
      )}

      {tab === 'commits' && (
        <div className="pr-scroll">
          <div className="pr-commits">
            {pr.commits.map((c) => (
              <div key={c.sha} className="pr-commit" onClick={() => onJump(c.sha)} title="Show in history">
                {c.avatarUrl ? <img className="gh-avatar" src={c.avatarUrl} alt="" /> : <span className="gh-avatar" />}
                <span className="pr-commit-msg">{c.message.split('\n')[0]}</span>
                <span className="muted">{c.author}</span>
                <span className="muted">{ago(c.date)}</span>
                <span className="mono muted">{c.sha.slice(0, 7)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'files' && (
        <Split id="pr-files" direction="row" mode="rem" initial={18} min={10} max={40}>
          <div className="panel pr-file-list">
            {pr.files.map((f) => {
              const { dir, name } = splitPath(f.path)
              const comments = pr.reviewComments.filter((c) => c.path === f.path).length
              const mine = pending.filter((c) => c.path === f.path).length
              return (
                <div
                  key={f.path}
                  className={`pr-file ${file === f.path ? 'selected' : ''} ${viewed[f.path] ? 'viewed' : ''}`}
                  onClick={() => setFile(f.path)}
                  title={f.path}
                >
                  <input
                    type="checkbox"
                    checked={!!viewed[f.path]}
                    title="Viewed"
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => toggleViewed(f)}
                  />
                  <span className={`status status-${f.status[0].toUpperCase() === 'R' ? 'R' : f.status === 'added' ? 'A' : f.status === 'removed' ? 'D' : 'M'}`}>
                    {f.status === 'added' ? 'A' : f.status === 'removed' ? 'D' : f.status === 'renamed' ? 'R' : 'M'}
                  </span>
                  <span className="pr-file-text">
                    <span className="file-name">{name}</span>
                    <span className="file-dir">{dir.replace(/\/$/, '')}</span>
                  </span>
                  {comments + mine > 0 && <span className="badge">{comments + mine}</span>}
                </div>
              )
            })}
          </div>
          {(() => {
            const f = pr.files.find((x) => x.path === file)
            if (!f) return <div className="empty-state muted">No files changed.</div>
            return (
              <PatchView
                key={f.path}
                file={f}
                comments={pr.reviewComments.filter((c) => c.path === f.path)}
                pending={pending.filter((c) => c.path === f.path)}
                viewed={!!viewed[f.path]}
                onToggleViewed={() => toggleViewed(f)}
                onAddPending={(c) => setPending((p) => [...p, c])}
                onRemovePending={(id) => setPending((p) => p.filter((c) => c.id !== id))}
                onReply={(id, body) => act(() => window.spoon.ghReply(path, pr.number, id, body))}
                prUrl={pr.url}
              />
            )
          })()}
        </Split>
      )}
    </div>
  )
}

// ---------- pieces ----------

function Checks({ checks }: { checks: PullDetail['checks'] }) {
  if (!checks.total) return null
  const tone = checks.failed ? 'danger' : checks.pending ? 'warn' : 'ok'
  const label = checks.failed
    ? `${checks.failed} failing`
    : checks.pending
      ? `${checks.pending} pending`
      : `${checks.passed}/${checks.total} checks`
  return (
    <span className={`pr-checks ${tone}`} title={`${checks.passed} passed · ${checks.failed} failed · ${checks.pending} pending`}>
      <span className={`tone-dot ${tone}`} /> {label}
    </span>
  )
}

function Avatar({ src }: { src: string }) {
  return src ? <img className="gh-avatar" src={src} alt="" /> : <span className="gh-avatar" />
}

function ago(iso: string): string {
  const s = (Date.now() - Date.parse(iso)) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

const REVIEW_STATE: Record<string, { label: string; tone: string }> = {
  APPROVED: { label: 'approved these changes', tone: 'ok' },
  CHANGES_REQUESTED: { label: 'requested changes', tone: 'danger' },
  COMMENTED: { label: 'reviewed', tone: 'off' },
  DISMISSED: { label: 'review was dismissed', tone: 'off' }
}

/** Groups review comments into threads: a root comment plus its replies. */
function threadsOf(comments: ReviewComment[]): { root: ReviewComment; replies: ReviewComment[] }[] {
  const roots = comments.filter((c) => !c.inReplyTo)
  return roots.map((root) => ({
    root,
    replies: comments.filter((c) => c.inReplyTo === root.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }))
}

function Composer({
  placeholder,
  submitLabel,
  onSubmit,
  onCancel,
  autoFocus
}: {
  placeholder: string
  submitLabel: string
  onSubmit: (text: string) => Promise<unknown> | void
  onCancel?: () => void
  autoFocus?: boolean
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (): Promise<void> => {
    if (!text.trim() || busy) return
    setBusy(true)
    try {
      const ok = await onSubmit(text.trim())
      if (ok !== false) setText('')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="composer">
      <textarea
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && mod(e)) {
            e.preventDefault()
            e.stopPropagation()
            submit()
          } else if (e.key === 'Escape' && onCancel) onCancel()
        }}
      />
      <div className="composer-actions">
        <span className="hint">Markdown supported · {keys('⌘↵')}</span>
        <span className="spacer" />
        {onCancel && (
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button className="btn primary" disabled={!text.trim() || busy} onClick={submit}>
          {busy ? 'Sending…' : submitLabel}
        </button>
      </div>
    </div>
  )
}

function Thread({
  root,
  replies,
  onReply
}: {
  root: ReviewComment
  replies: ReviewComment[]
  onReply: (id: number, body: string) => Promise<boolean>
}) {
  const [replying, setReplying] = useState(false)
  return (
    <div className="thread">
      {[root, ...replies].map((c) => (
        <div key={c.id} className="thread-comment">
          <div className="thread-head">
            <Avatar src={c.author.avatarUrl} />
            <b>{c.author.login}</b>
            <span className="muted">{ago(c.createdAt)}</span>
          </div>
          <Markdown text={c.body} />
        </div>
      ))}
      {replying ? (
        <Composer
          autoFocus
          placeholder="Reply…"
          submitLabel="Reply"
          onCancel={() => setReplying(false)}
          onSubmit={async (t) => {
            const ok = await onReply(root.id, t)
            if (ok) setReplying(false)
            return ok
          }}
        />
      ) : (
        <button className="thread-reply" onClick={() => setReplying(true)}>
          Reply…
        </button>
      )}
    </div>
  )
}

function Conversation({
  pr,
  onComment,
  onReply,
  onOpenFile
}: {
  pr: PullDetail
  onComment: (body: string) => Promise<boolean>
  onReply: (id: number, body: string) => Promise<boolean>
  onOpenFile: (path: string) => void
}) {
  const threads = threadsOf(pr.reviewComments)
  // Interleave review-comment threads with comments and reviews by time, like GitHub's timeline.
  const entries: ({ at: string; item: TimelineItem } | { at: string; thread: (typeof threads)[number] })[] = [
    ...pr.timeline.map((item) => ({ at: item.createdAt, item })),
    ...threads.map((thread) => ({ at: thread.root.createdAt, thread }))
  ].sort((a, b) => a.at.localeCompare(b.at))

  return (
    <div className="pr-scroll">
      <div className="conversation">
        <div className="timeline-card">
          <div className="thread-head">
            <Avatar src={pr.author.avatarUrl} />
            <b>{pr.author.login}</b>
            <span className="muted">opened this {ago(pr.createdAt)}</span>
          </div>
          <Markdown text={pr.body} />
        </div>

        {entries.map((e, i) =>
          'item' in e ? (
            e.item.kind === 'comment' ? (
              <div key={`c${e.item.id}`} className="timeline-card">
                <div className="thread-head">
                  <Avatar src={e.item.author.avatarUrl} />
                  <b>{e.item.author.login}</b>
                  <span className="muted">commented {ago(e.item.createdAt)}</span>
                </div>
                <Markdown text={e.item.body} />
              </div>
            ) : (
              <div key={`r${e.item.id}`} className="timeline-event">
                <span className={`tone-dot ${REVIEW_STATE[e.item.state]?.tone ?? 'off'}`} />
                <Avatar src={e.item.author.avatarUrl} />
                <span>
                  <b>{e.item.author.login}</b> {REVIEW_STATE[e.item.state]?.label ?? e.item.state.toLowerCase()}{' '}
                  <span className="muted">{ago(e.item.createdAt)}</span>
                </span>
                {e.item.body && <Markdown className="timeline-event-body" text={e.item.body} />}
              </div>
            )
          ) : (
            <div key={`t${e.thread.root.id}-${i}`} className="timeline-card thread-card">
              <button className="thread-file" onClick={() => onOpenFile(e.thread.root.path)}>
                {e.thread.root.path}
                {e.thread.root.line ? `:${e.thread.root.line}` : ' · outdated'}
              </button>
              <pre className="hunk-snippet">{e.thread.root.diffHunk.split('\n').slice(-4).join('\n')}</pre>
              <Thread root={e.thread.root} replies={e.thread.replies} onReply={onReply} />
            </div>
          )
        )}

        <div className="timeline-card">
          <Composer placeholder="Leave a comment" submitLabel="Comment" onSubmit={onComment} />
        </div>
      </div>
    </div>
  )
}

// ---------- files changed ----------

interface Draft {
  from: number // index into the patch lines
  to: number
}

const anchorOf = (l: Line): { side: 'LEFT' | 'RIGHT'; line: number } | null =>
  l.kind === 'del' ? { side: 'LEFT', line: l.oldNo! } : l.kind === 'add' || l.kind === 'ctx' ? { side: 'RIGHT', line: l.newNo! } : null

function PatchView({
  file,
  comments,
  pending,
  viewed,
  onToggleViewed,
  onAddPending,
  onRemovePending,
  onReply,
  prUrl
}: {
  file: PullFile
  comments: ReviewComment[]
  pending: PendingComment[]
  viewed: boolean
  onToggleViewed: () => void
  onAddPending: (c: PendingComment) => void
  onRemovePending: (id: string) => void
  onReply: (id: number, body: string) => Promise<boolean>
  prUrl: string
}) {
  const parsed = useMemo(() => (file.patch ? parseDiff(file.patch) : null), [file.patch])
  const lines = parsed?.lines ?? []
  const split = useSettings().diffLayout === 'split'
  const [draft, setDraft] = useState<Draft | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const threads = threadsOf(comments)
  const byAnchor = new Map<string, typeof threads>()
  const outdated: typeof threads = []
  for (const t of threads) {
    if (t.root.line === null) outdated.push(t)
    else {
      const key = `${t.root.side}:${t.root.line}`
      byAnchor.set(key, [...(byAnchor.get(key) ?? []), t])
    }
  }
  const pendingByAnchor = new Map<string, PendingComment[]>()
  for (const p of pending) {
    const key = `${p.side}:${p.line}`
    pendingByAnchor.set(key, [...(pendingByAnchor.get(key) ?? []), p])
  }

  const startComment = (i: number, shift: boolean): void => {
    if (shift && draft) setDraft({ from: Math.min(draft.from, i), to: Math.max(draft.from, i) })
    else setDraft({ from: i, to: i })
  }

  const addDraft = (body: string): void => {
    if (!draft) return
    const end = anchorOf(lines[draft.to])!
    const start = anchorOf(lines[draft.from])!
    onAddPending({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      path: file.path,
      line: end.line,
      side: end.side,
      ...(draft.from !== draft.to ? { startLine: start.line, startSide: start.side } : {}),
      body
    })
    setDraft(null)
  }

  const shown = lines.slice(0, MAX_PATCH_LINES)
  const units = split ? pairLines(shown) : shown.map((_, i) => ({ full: i }))

  return (
    <div className="diff">
      <div className="diff-header">
        <span className="diff-path" title={file.path}>
          {file.previousPath && <span className="muted">{file.previousPath} → </span>}
          {file.path}
        </span>
        <span className="diff-stats">
          <span className="plus">+{file.additions}</span>
          <span className="minus">−{file.deletions}</span>
        </span>
        <DiffLayoutToggle />
        <label className="check viewed-toggle">
          <input type="checkbox" checked={viewed} onChange={onToggleViewed} /> Viewed
        </label>
      </div>
      <div className="diff-scroll" ref={scrollRef}>
        {outdated.length > 0 && (
          <div className="outdated">
            <div className="section-title">Outdated comments</div>
            {outdated.map((t) => (
              <Thread key={t.root.id} root={t.root} replies={t.replies} onReply={onReply} />
            ))}
          </div>
        )}
        {!file.patch ? (
          <div className="empty-state small muted">
            No diff to show (binary or too large).{' '}
            <a href="#" onClick={(e) => (e.preventDefault(), window.spoon.openExternal(`${prUrl}/files`))}>
              View on GitHub
            </a>
          </div>
        ) : (
          <div className={`patch ${split ? 'side-by-side' : ''}`}>
            {units.map((unit, u) => {
              // The lines this row shows; comments for any of them go right under the row.
              const idxs = 'full' in unit ? [unit.full] : [...new Set([unit.left, unit.right].filter((x) => x !== undefined))]
              const keys = [...new Set(idxs.map((i) => anchorOf(lines[i])).filter(Boolean).map((a) => `${a!.side}:${a!.line}`))]
              const inDraft = draft && idxs.some((i) => i >= draft.from && i <= draft.to)
              const plus = (i: number) =>
                anchorOf(lines[i]) ? (
                  <button
                    className="add-comment"
                    title="Comment on this line (⇧-click another line for a range)"
                    onClick={(e) => startComment(i, e.shiftKey)}
                  >
                    <PlusIcon />
                  </button>
                ) : null
              let row
              if ('full' in unit || !split) {
                const i = 'full' in unit ? unit.full : unit.left!
                const l = lines[i]
                row = (
                  <div className={`diff-line ${l.kind} ${inDraft ? 'in-draft' : ''}`}>
                    <span className="ln">{l.oldNo ?? ''}</span>
                    <span className="ln">{l.newNo ?? ''}</span>
                    <span className="sign">
                      {plus(i)}
                      <span className="sign-char">{l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ''}</span>
                    </span>
                    <span className="code">{l.text}</span>
                  </div>
                )
              } else {
                const half = (i: number | undefined, side: 'left' | 'right') => {
                  if (i === undefined) return <span className="half empty" />
                  const l = lines[i]
                  return (
                    <span className={`half ${l.kind}`}>
                      <span className="ln">{(side === 'left' ? l.oldNo : l.newNo) ?? ''}</span>
                      <span className="sign">
                        {plus(i)}
                        <span className="sign-char">{l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ''}</span>
                      </span>
                      <span className="code">{l.text}</span>
                    </span>
                  )
                }
                row = (
                  <div className={`diff-line split-row ${inDraft ? 'in-draft' : ''}`}>
                    {half(unit.left, 'left')}
                    {half(unit.right, 'right')}
                  </div>
                )
              }
              return (
                <Fragment key={u}>
                  {row}
                  {keys.flatMap((key) =>
                    (byAnchor.get(key) ?? []).map((t) => (
                      <div key={t.root.id} className="inline-block">
                        <Thread root={t.root} replies={t.replies} onReply={onReply} />
                      </div>
                    ))
                  )}
                  {keys.flatMap((key) =>
                    (pendingByAnchor.get(key) ?? []).map((p) => (
                      <div key={p.id} className="inline-block">
                        <div className="thread pending">
                          <div className="thread-head">
                            <span className="badge warn">Pending</span>
                            {p.startLine !== undefined && (
                              <span className="muted">
                                lines {p.startLine}–{p.line}
                              </span>
                            )}
                            <span className="spacer" />
                            <button className="icon-btn" title="Delete pending comment" onClick={() => onRemovePending(p.id)}>
                              <CloseIcon />
                            </button>
                          </div>
                          <Markdown text={p.body} />
                        </div>
                      </div>
                    ))
                  )}
                  {draft && idxs.includes(draft.to) && (
                    <div className="inline-block">
                      <div className="thread">
                        {draft.from !== draft.to && (
                          <div className="muted draft-range">
                            Commenting on lines {anchorOf(lines[draft.from])!.line}–{anchorOf(lines[draft.to])!.line}
                          </div>
                        )}
                        <Composer
                          autoFocus
                          placeholder="Leave a comment"
                          submitLabel="Add to review"
                          onCancel={() => setDraft(null)}
                          onSubmit={addDraft}
                        />
                      </div>
                    </div>
                  )}
                </Fragment>
              )
            })}
            {lines.length > MAX_PATCH_LINES && (
              <div className="list-footnote">
                Showing the first {MAX_PATCH_LINES.toLocaleString()} lines.{' '}
                <a href="#" onClick={(e) => (e.preventDefault(), window.spoon.openExternal(`${prUrl}/files`))}>
                  View the rest on GitHub
                </a>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------- review ----------

function ReviewPanel({
  pr,
  pending,
  onClose,
  onSubmit
}: {
  pr: PullDetail
  pending: PendingComment[]
  onClose: () => void
  onSubmit: (event: ReviewEvent, body: string) => Promise<void>
}) {
  const [body, setBody] = useState('')
  const [event, setEvent] = useState<ReviewEvent>('COMMENT')
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const own = pr.author.login === pr.viewer

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Element
      if (!ref.current?.contains(t) && !t.closest('.review-anchor')) onClose()
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [onClose])

  const needsText = event === 'REQUEST_CHANGES' || (event === 'COMMENT' && pending.length === 0)
  const canSubmit = !busy && (!needsText || body.trim().length > 0)

  const options: [ReviewEvent, string, string][] = [
    ['COMMENT', 'Comment', 'General feedback without explicit approval'],
    ['APPROVE', 'Approve', 'Give your approval to merge these changes'],
    ['REQUEST_CHANGES', 'Request changes', 'Feedback that must be addressed before merging']
  ]

  return (
    <div className="review-panel" ref={ref}>
      <h3>Finish your review</h3>
      <textarea
        autoFocus
        placeholder="Leave a comment"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      />
      {options.map(([id, label, hint]) => {
        const disabled = own && id !== 'COMMENT'
        return (
          <label key={id} className={`review-option ${disabled ? 'disabled' : ''}`} title={disabled ? 'You can’t approve or request changes on your own pull request' : ''}>
            <input type="radio" name="review-event" checked={event === id} disabled={disabled} onChange={() => setEvent(id)} />
            <span>
              <b>{label}</b>
              <span className="hint">{hint}</span>
            </span>
          </label>
        )
      })}
      <div className="review-footer">
        <span className="muted">
          {pending.length} pending comment{pending.length === 1 ? '' : 's'}
        </span>
        <span className="spacer" />
        <button
          className="btn primary"
          disabled={!canSubmit}
          onClick={async () => {
            setBusy(true)
            try {
              await onSubmit(event, body.trim())
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? 'Submitting…' : 'Submit review'}
        </button>
      </div>
      {needsText && !body.trim() && (
        <span className="hint">
          {event === 'REQUEST_CHANGES' ? 'Say what needs to change.' : 'Add a comment or some inline comments first.'}
        </span>
      )}
    </div>
  )
}

