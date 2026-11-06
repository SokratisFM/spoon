// Shown while a merge is stopped on conflicts: resolve them, then commit the merge or abort it.
import { AlertIcon } from './Icons'

interface Props {
  subject: string
  /** Uncommitted changes were set aside for the merge. */
  autostash: boolean
  conflicts: number
  busy: boolean
  onShowChanges: () => void
  onAction: (action: 'continue' | 'abort') => void
}

export function MergeBanner({ subject, autostash, conflicts, busy, onShowChanges, onAction }: Props) {
  const text = conflicts
    ? `Conflicts in ${conflicts} ${conflicts === 1 ? 'file' : 'files'}. Resolve them and stage the files, then commit the merge.`
    : 'Every conflict is resolved. Commit the merge to finish it.'
  return (
    <div className={`banner rebase-banner ${conflicts ? 'conflict' : ''}`}>
      <AlertIcon />
      <span className="rebase-banner-text">
        <b>{subject}</b> {text}
        {autostash && ' Your uncommitted changes were set aside for the merge; they come back when you commit or abort it.'}
      </span>
      <button className="btn" onClick={onShowChanges}>
        Local Changes
      </button>
      <button className="btn" disabled={busy} onClick={() => onAction('abort')} title="Put everything back as it was before the merge">
        Abort
      </button>
      <button className="btn primary" disabled={busy || conflicts > 0} onClick={() => onAction('continue')}>
        Commit Merge
      </button>
    </div>
  )
}
