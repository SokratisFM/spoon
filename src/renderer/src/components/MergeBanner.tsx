// Shown while a merge or a cherry-pick is stopped on conflicts: resolve them, then commit it or abort it.
import { AlertIcon, CherryIcon } from './Icons'

interface Props {
  kind?: 'merge' | 'cherry-pick'
  subject: string
  /** Uncommitted changes were set aside for the merge. */
  autostash: boolean
  conflicts: number
  busy: boolean
  onShowChanges: () => void
  onAction: (action: 'continue' | 'abort') => void
}

export function MergeBanner({ kind = 'merge', subject, autostash, conflicts, busy, onShowChanges, onAction }: Props) {
  const pick = kind === 'cherry-pick'
  const what = pick ? 'cherry-pick' : 'merge'
  const text = conflicts
    ? `Conflicts in ${conflicts} ${conflicts === 1 ? 'file' : 'files'}. Resolve them and stage the files, then commit the ${what}.`
    : `Every conflict is resolved. Commit the ${what} to finish it.`
  return (
    <div className={`banner rebase-banner ${conflicts ? 'conflict' : ''}`}>
      {pick ? <CherryIcon /> : <AlertIcon />}
      <span className="rebase-banner-text">
        {pick && 'Cherry-picking '}
        <b>{subject}</b> {text}
        {autostash && ' Your uncommitted changes were set aside for the merge; they come back when you commit or abort it.'}
      </span>
      <button className="btn" onClick={onShowChanges}>
        Local Changes
      </button>
      <button className="btn" disabled={busy} onClick={() => onAction('abort')} title={`Put everything back as it was before the ${what}`}>
        Abort
      </button>
      <button className="btn primary" disabled={busy || conflicts > 0} onClick={() => onAction('continue')}>
        {pick ? 'Commit Cherry-pick' : 'Commit Merge'}
      </button>
    </div>
  )
}
