// "Delete branch" dialog, like Fork's: deletes the local branch, and optionally (off by default)
// the branch it tracks on the remote.
import { useState } from 'react'
import type { CheckoutTarget, Ref, RepoState } from '../../../shared/types'
import { Modal } from './Modal'

/** "origin/feature/x" -> { remote: "origin", branch: "feature/x" }, using the repo's remote names. */
export function splitUpstream(upstream: string, remotes: string[]): { remote: string; branch: string } | null {
  const remote = remotes.filter((r) => upstream.startsWith(`${r}/`)).sort((a, b) => b.length - a.length)[0]
  return remote ? { remote, branch: upstream.slice(remote.length + 1) } : null
}

interface Props {
  branch: Ref
  repo: RepoState
  onClose: () => void
  /** switchTo: the checked-out branch is being deleted; switch here first (same commit: files stay). */
  onDelete: (alsoRemote: { remote: string; branch: string } | null, switchTo?: CheckoutTarget) => void
}

export function DeleteBranchDialog({ branch, repo, onClose, onDelete }: Props) {
  const [alsoRemote, setAlsoRemote] = useState(false)
  const isCurrent = branch.name === repo.headBranch
  const upstream = branch.upstream && !branch.gone ? splitUpstream(branch.upstream, repo.remotes) : null
  // The checked-out branch can't be deleted while it's checked out: Spoon switches first, to another
  // branch on the same commit or to that commit itself, so the files don't change.
  const others = repo.refs.filter((r) => r.kind === 'head' && r.target === branch.target && r.name !== branch.name)
  const [moveTo, setMoveTo] = useState<string>(others[0]?.name ?? '')
  const submit = (): void => {
    onClose()
    onDelete(alsoRemote ? upstream : null, isCurrent ? (moveTo ? { kind: 'branch', name: moveTo } : { kind: 'commit', hash: branch.target }) : undefined)
  }
  return (
    <Modal
      title="Delete branch"
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn danger" onClick={submit} autoFocus>
            {isCurrent ? 'Switch and Delete' : 'Delete'}
          </button>
        </>
      }
    >
      <>
          <p>
            Delete the local branch <b className="mono">{branch.name}</b>?
          </p>
          {isCurrent && (
            <div className="delete-switch">
              <p className="hint">It’s checked out, so Spoon switches away first. Same commit, so your files and uncommitted changes stay as they are.</p>
              {others.map((r) => (
                <label key={r.name} className="check">
                  <input type="radio" name="move-to" checked={moveTo === r.name} onChange={() => setMoveTo(r.name)} />
                  Switch to <span className="mono">{r.name}</span>
                </label>
              ))}
              <label className="check">
                <input type="radio" name="move-to" checked={moveTo === ''} onChange={() => setMoveTo('')} />
                No branch (stay on commit <span className="mono">{branch.target.slice(0, 7)}</span>)
              </label>
            </div>
          )}
          {upstream && (
            <label className="check">
              <input type="checkbox" checked={alsoRemote} onChange={(e) => setAlsoRemote(e.target.checked)} />
              Also delete <span className="mono">{branch.upstream}</span> on {upstream.remote}
            </label>
          )}
          <p className="hint">
            {branch.ahead
              ? `It has ${branch.ahead} commit${branch.ahead === 1 ? '' : 's'} not on ${branch.upstream}; you'll be asked before they're dropped.`
              : 'Commits that exist nowhere else are protected: you’ll be asked before anything is lost.'}
          </p>
      </>
    </Modal>
  )
}
