// "Delete branch" dialog, like Fork's: deletes the local branch, and optionally (off by default)
// the branch it tracks on the remote.
import { useState } from 'react'
import type { Ref, RepoState } from '../../../shared/types'
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
  onDelete: (alsoRemote: { remote: string; branch: string } | null) => void
}

export function DeleteBranchDialog({ branch, repo, onClose, onDelete }: Props) {
  const [alsoRemote, setAlsoRemote] = useState(false)
  const isCurrent = branch.name === repo.headBranch
  const upstream = branch.upstream && !branch.gone ? splitUpstream(branch.upstream, repo.remotes) : null
  const submit = (): void => {
    if (isCurrent) return
    onClose()
    onDelete(alsoRemote ? upstream : null)
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
          <button className="btn danger" onClick={submit} disabled={isCurrent} autoFocus>
            Delete
          </button>
        </>
      }
    >
      {isCurrent ? (
        <p>
          <b>{branch.name}</b> is checked out. Check out another branch first, then delete it.
        </p>
      ) : (
        <>
          <p>
            Delete the local branch <b className="mono">{branch.name}</b>?
          </p>
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
      )}
    </Modal>
  )
}
