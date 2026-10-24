// Shown while a rebase is stopped (a conflict, or an "edit" step): what happened and how to go on.
import type { RebaseProgress } from '../../../shared/types'
import { AlertIcon } from './Icons'

interface Props {
  progress: RebaseProgress
  conflicts: number
  busy: boolean
  onShowChanges: () => void
  onAction: (action: 'continue' | 'skip' | 'abort') => void
}

export function RebaseBanner({ progress: p, conflicts, busy, onShowChanges, onAction }: Props) {
  const step = p.total ? ` (${p.step}/${p.total})` : ''
  const subject = p.stoppedSubject ? `“${p.stoppedSubject}”` : 'this commit'
  const text = conflicts
    ? `Applying ${subject} hit conflicts in ${conflicts} ${conflicts === 1 ? 'file' : 'files'}. Resolve them, stage the files, then continue.`
    : p.stoppedAction === 'edit'
      ? `Stopped to edit ${subject}. Change files and amend the commit in Local Changes, then continue.`
      : `Stopped at ${subject}. Stage the resolved files, then continue.`
  return (
    <div className={`banner rebase-banner ${conflicts ? 'conflict' : ''}`}>
      <AlertIcon />
      <span className="rebase-banner-text">
        <b>
          Rebasing{p.branch ? ` ${p.branch}` : ''}
          {step}
        </b>{' '}
        {text}
      </span>
      <button className="btn" onClick={onShowChanges}>
        Local Changes
      </button>
      <button className="btn" disabled={busy} onClick={() => onAction('abort')} title="Put everything back as it was">
        Abort
      </button>
      <button className="btn" disabled={busy} onClick={() => onAction('skip')} title="Leave this commit out">
        Skip
      </button>
      <button className="btn primary" disabled={busy || conflicts > 0} onClick={() => onAction('continue')}>
        Continue
      </button>
    </div>
  )
}
