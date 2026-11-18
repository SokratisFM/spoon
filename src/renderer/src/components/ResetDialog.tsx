// Reset the checked-out branch to a commit, the three ways git can: soft (changes kept, staged), mixed
// (kept, unstaged) or hard (the files become that commit; uncommitted changes go to a stash first).
import { useEffect, useState } from 'react'
import type { Commit, ResetPlan } from '../../../shared/types'
import { Modal } from './Modal'
import { cleanError } from '../hooks'

type Mode = 'soft' | 'mixed' | 'hard'

const MODES: { id: Mode; name: string; line: string }[] = [
  { id: 'soft', name: 'Soft', line: 'Keep every change, staged' },
  { id: 'mixed', name: 'Mixed', line: 'Keep every change, unstaged' },
  { id: 'hard', name: 'Hard', line: 'Discard changes: files match the commit' }
]

interface Props {
  path: string
  commit: Commit
  /** The checked-out branch (null: a detached HEAD). */
  branch: string | null
  onClose: () => void
  onReset: (mode: Mode, plan: ResetPlan) => void
}

export function ResetDialog({ path, commit, branch, onClose, onReset }: Props) {
  const [mode, setMode] = useState<Mode>('mixed')
  const [plan, setPlan] = useState<ResetPlan | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    window.spoon.resetPlan(path, commit.hash).then(setPlan, (err) => setError(cleanError(err)))
  }, [path, commit.hash])
  const name = branch ?? 'HEAD'
  const n = (k: number): string => `${k} ${k === 1 ? 'commit' : 'commits'}`

  const effect: string[] = []
  if (plan) {
    if (plan.leaves) effect.push(`${n(plan.leaves)} after it ${plan.leaves === 1 ? 'leaves' : 'leave'} ${name}${mode === 'hard' ? ', and their changes go too' : '; their changes stay in your files'}.`)
    if (plan.gains) effect.push(`${name} gains ${n(plan.gains)} it didn’t have.`)
    if (!plan.leaves && !plan.gains) effect.push(`${name} is already at this commit.`)
    if (mode === 'hard' && plan.dirty) effect.push('Your uncommitted changes are saved in a stash first (Stashes in the sidebar), then discarded.')
    if (mode === 'hard' && plan.overwrites)
      effect.push(`${plan.overwrites} untracked or ignored ${plan.overwrites === 1 ? 'file is' : 'files are'} replaced by the commit’s version; copied to the Trash first.`)
    if (mode === 'hard' && !plan.dirty && !plan.overwrites && !plan.leaves) effect.push('There are no uncommitted changes to lose.')
    if (plan.leaves && branch) effect.push('If the branch was pushed, pushing it again needs Force Push.')
    if (plan.leaves) effect.push('Spoon offers to undo it afterwards, and shows the commit it was on.')
  }

  return (
    <Modal
      title={`Reset ${name} to ${commit.hash.slice(0, 7)}`}
      onClose={onClose}
      onSubmit={plan ? () => onReset(mode, plan) : undefined}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className={`btn primary ${mode === 'hard' ? 'warn' : ''}`} disabled={!plan} onClick={() => plan && onReset(mode, plan)}>
            {mode === 'hard' ? 'Reset Hard' : `Reset ${MODES.find((m) => m.id === mode)!.name}`}
          </button>
        </>
      }
    >
      <p className="dialog-detail reset-subject">
        Move <b>{name}</b> to <span className="mono">{commit.hash.slice(0, 7)}</span> “{commit.subject}”.
      </p>
      <div className="nb-modes reset-modes" role="radiogroup">
        {MODES.map((m) => (
          <button key={m.id} role="radio" aria-checked={mode === m.id} className={`${mode === m.id ? 'on' : ''} ${m.id}`} onClick={() => setMode(m.id)}>
            <span className="nb-mode-text">
              <b>{m.name}</b>
              <span>{m.line}</span>
            </span>
          </button>
        ))}
      </div>
      {error ? (
        <p className="error-text">{error}</p>
      ) : (
        <ul className={`reset-effect ${mode === 'hard' && plan && (plan.leaves || plan.dirty) ? 'hard' : ''}`}>
          {plan ? effect.map((e) => <li key={e}>{e}</li>) : <li className="muted">Looking…</li>}
        </ul>
      )}
    </Modal>
  )
}
