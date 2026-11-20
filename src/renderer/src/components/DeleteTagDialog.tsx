// "Delete tag" dialog: deletes the tag here, and optionally (off by default) on the remotes too.
import { useState } from 'react'
import type { Ref, RepoState } from '../../../shared/types'
import { Modal } from './Modal'

interface Props {
  tag: Ref
  repo: RepoState
  onClose: () => void
  /** remotes: where to delete it too. */
  onDelete: (remotes: string[]) => void
}

export function DeleteTagDialog({ tag, repo, onClose, onDelete }: Props) {
  const [remotes, setRemotes] = useState<Set<string>>(new Set())
  const toggle = (r: string, on: boolean): void => {
    const next = new Set(remotes)
    if (on) next.add(r)
    else next.delete(r)
    setRemotes(next)
  }
  const submit = (): void => {
    onClose()
    onDelete(repo.remotes.filter((r) => remotes.has(r)))
  }
  return (
    <Modal
      title="Delete tag"
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn danger" onClick={submit} autoFocus>
            Delete
          </button>
        </>
      }
    >
      <>
        <p>
          Delete the tag <b className="mono">{tag.name}</b>?
        </p>
        {repo.remotes.map((r) => (
          <label key={r} className="check">
            <input type="checkbox" checked={remotes.has(r)} onChange={(e) => toggle(r, e.target.checked)} />
            Also delete it on {r}
          </label>
        ))}
        <p className="hint">
          No commits change: the tag only names commit <span className="mono">{tag.target.slice(0, 7)}</span>.
          {repo.remotes.length > 0 && ' Kept on a remote, it comes back here with the next fetch.'}
        </p>
      </>
    </Modal>
  )
}
