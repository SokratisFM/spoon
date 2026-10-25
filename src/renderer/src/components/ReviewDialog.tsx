// Review with Claude: pick what to review and how, then hand it to Claude Code in Terminal or to
// the Claude desktop app. Claude reads the diff itself; Spoon writes the prompt.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { RepoState } from '../../../shared/types'
import { useAsync, usePersistentState } from '../hooks'
import { Modal } from './Modal'
import { ChevronIcon } from './Icons'

type Scope = 'staged' | 'local' | 'commit' | 'branch'
type Where = 'terminal' | 'desktop'
type Focus = 'bugs' | 'performance' | 'unity' | 'security' | 'style'

const MODELS: [string, string][] = [
  ['haiku', 'Haiku'],
  ['sonnet', 'Sonnet'],
  ['opus', 'Opus'],
  ['claude-fable-5-1', 'Fable']
]
const EFFORTS = ['medium', 'high', 'xhigh']
const FOCUS: [Focus, string, string][] = [
  ['bugs', 'Bugs', 'bugs and logic errors'],
  ['performance', 'Performance', 'performance problems'],
  ['unity', 'Unity pitfalls', 'Unity pitfalls (work on the main thread, allocations in Update or other hot paths, serialization and .meta issues)'],
  ['security', 'Security', 'security issues'],
  ['style', 'Naming and style', 'unclear naming and style inconsistencies']
]

interface Prefs {
  where: Where
  model: string
  effort: string
  focus: Focus[]
  skill: boolean
}
const DEFAULT_PREFS: Prefs = { where: 'desktop', model: 'sonnet', effort: 'high', focus: ['bugs', 'performance'], skill: false }

interface Props {
  path: string
  repo: RepoState
  stagedCount: number
  changeCount: number
  /** Reviewing one commit (from the commit list) instead of local changes. */
  commit?: { hash: string; subject: string }
  onClose: () => void
  onError: (message: string) => void
}

export function ReviewDialog({ path, repo, stagedCount, changeCount, commit, onClose, onError }: Props) {
  const [saved, setSaved] = usePersistentState<Prefs>('spoon.review.prefs', DEFAULT_PREFS)
  const [remember, setRemember] = useState(true)
  const [prefs, setPrefs] = useState<Prefs>({ ...DEFAULT_PREFS, ...saved })
  const set = (patch: Partial<Prefs>): void => setPrefs((p) => ({ ...p, ...patch }))
  const [scope, setScope] = useState<Scope>(commit ? 'commit' : stagedCount ? 'staged' : changeCount ? 'local' : 'commit')
  const [extra, setExtra] = useState('')
  const { data: avail } = useAsync(() => window.spoon.claudeAvailability(), [])
  const branch = repo.headBranch
  const { data: draft } = useAsync(
    () => (branch ? window.spoon.pullDraftInfo(path, branch).catch(() => null) : Promise.resolve(null)),
    [path, branch]
  )
  const [base, setBase] = useState('')
  useEffect(() => {
    if (draft) setBase(draft.base)
  }, [draft])

  // Fall back to whichever destination is installed.
  useEffect(() => {
    if (!avail) return
    if (prefs.where === 'terminal' && !avail.cli && avail.desktop) set({ where: 'desktop' })
    if (prefs.where === 'desktop' && !avail.desktop && avail.cli) set({ where: 'terminal' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avail])

  const target = commit ?? null
  const scopes: [Scope, string, boolean][] = [
    ['staged', `Staged (${stagedCount} file${stagedCount === 1 ? '' : 's'})`, stagedCount > 0],
    ['local', 'All local changes', changeCount > 0],
    ['commit', target ? `This commit (${target.hash.slice(0, 7)})` : 'Last commit', !!repo.headHash],
    ['branch', 'This branch', !!branch && !!draft]
  ]

  // The prompt follows the options until you edit it yourself; Reset goes back to following them.
  const [edited, setEdited] = useState<string | null>(null)
  const generated = useMemo(() => {
    const remote = draft?.remote ?? 'origin'
    const what: Record<Scope, string> = {
      staged: 'the staged changes',
      local: 'all uncommitted changes (staged, unstaged and new files)',
      commit: target ? `commit ${target.hash.slice(0, 7)} (“${target.subject}”)` : 'the last commit',
      branch: `the changes on ${branch} since it left ${remote}/${base}`
    }
    const scopeText = what[scope]
    const focus = FOCUS.filter(([id]) => prefs.focus.includes(id)).map(([, , text]) => text)
    const lines = [
      `Review ${scopeText} in this repository and report what you find.`,
      focus.length ? `Look for: ${focus.join('; ')}.` : '',
      extra.trim() ? `Also: ${extra.trim()}` : ''
    ].filter((l) => l !== '')
    return prefs.skill ? `/code-review ${prefs.effort === 'medium' ? 'medium' : 'high'} ${lines.join(' ')}` : lines.join('\n')
  }, [scope, prefs, extra, draft, base, target, branch, path])

  const prompt = edited ?? generated

  const canSend =
    !!avail && (prefs.where === 'terminal' ? !!avail.cli : avail.desktop) && scopes.find(([s]) => s === scope)?.[2]

  const sending = useRef(false)
  const send = (): void => {
    if (!canSend || sending.current) return
    sending.current = true
    if (remember) setSaved(prefs)
    const scopeShort = { staged: 'staged', local: 'local changes', commit: target ? target.hash.slice(0, 7) : 'last commit', branch: `vs ${base}` }[scope]
    window.spoon
      .claudeLaunch({
        where: prefs.where,
        cwd: path,
        model: prefs.model,
        effort: prefs.effort,
        name: `Review: ${branch ?? repo.name} (${scopeShort})`,
        prompt
      })
      .then(onClose, (err: Error) => {
        sending.current = false
        onError(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      })
  }

  return (
    <Modal
      title="Review with Claude"
      onClose={onClose}
      onSubmit={send}
      wide
      top
      footer={
        <>
          <label className="check" style={{ marginRight: 'auto' }}>
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Remember these choices
          </label>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary claude" onClick={send} disabled={!canSend}>
            Send for review
          </button>
        </>
      }
    >
      <div className="review-form">
        <div className="field">
          <span className="field-label">What to review</span>
          <div className="segmented">
            {scopes.map(([s, label, ok]) => (
              <button key={s} className={scope === s ? 'on' : ''} disabled={!ok} onClick={() => setScope(s)}>
                {label}
              </button>
            ))}
          </div>
          {scope === 'branch' && draft && (
            <div className="review-base">
              Compared with
              <select value={base} onChange={(e) => setBase(e.target.value)}>
                {draft.bases.map((b) => (
                  <option key={b} value={b}>
                    {b}
                    {b === draft.base ? ' (started from here)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="field">
          <span className="field-label">Where</span>
          <div className="review-dest">
            <button
              className={prefs.where === 'desktop' ? 'on' : ''}
              disabled={!avail?.desktop}
              onClick={() => set({ where: 'desktop' })}
            >
              <b>Claude desktop</b>
              <span>
                {avail && !avail.desktop
                  ? 'The Claude app isn’t installed.'
                  : 'Opens a new Code session in this repo with the prompt filled in. Model, effort and permissions are picked in the app.'}
              </span>
            </button>
            <button
              className={prefs.where === 'terminal' ? 'on' : ''}
              disabled={!avail?.cli}
              onClick={() => set({ where: 'terminal' })}
            >
              <b>Terminal</b>
              <span>
                {avail && !avail.cli
                  ? 'Claude Code isn’t installed.'
                  : 'Opens Terminal in this repo with an interactive Claude Code session.'}
              </span>
            </button>
          </div>
        </div>

        <div className={`review-model ${prefs.where === 'desktop' ? 'dim' : ''}`}>
          <div className="field">
            <span className="field-label">Model</span>
            <div className="segmented">
              {MODELS.map(([id, label]) => (
                <button key={id} className={prefs.model === id ? 'on' : ''} onClick={() => set({ model: id })}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span className="field-label">Effort</span>
            <div className="segmented">
              {EFFORTS.map((e) => (
                <button key={e} className={prefs.effort === e ? 'on' : ''} onClick={() => set({ effort: e })}>
                  {e}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="field">
          <span className="field-label">Look for</span>
          <div className="review-chips">
            {FOCUS.map(([id, label]) => (
              <button
                key={id}
                className={prefs.focus.includes(id) ? 'on' : ''}
                onClick={() =>
                  set({ focus: prefs.focus.includes(id) ? prefs.focus.filter((f) => f !== id) : [...prefs.focus, id] })
                }
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <label className="field">
          <span className="field-label">Also tell Claude</span>
          <textarea
            rows={2}
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            placeholder="The banner must never block the main thread on Android."
          />
        </label>

        <label className="check">
          <input type="checkbox" checked={prefs.skill} onChange={(e) => set({ skill: e.target.checked })} />
          Use the /code-review skill
        </label>

        <details className="review-prompt" open={edited !== null || undefined}>
          <summary>
            <ChevronIcon className="icon chevron" /> Prompt Claude will get
            {edited !== null && <span className="review-edited">edited</span>}
          </summary>
          <textarea
            value={prompt}
            onChange={(e) => setEdited(e.target.value)}
            rows={6}
            spellCheck
            onKeyDown={(e) => e.stopPropagation()}
          />
          <div className="review-prompt-foot">
            <span className="hint">
              {edited !== null
                ? 'Your text is sent as is; the options above no longer change it.'
                : 'Edit freely; the options above fill it in until you do.'}
            </span>
            {edited !== null && (
              <button className="link-btn" onClick={() => setEdited(null)}>
                Reset to generated
              </button>
            )}
          </div>
        </details>
      </div>
    </Modal>
  )
}
