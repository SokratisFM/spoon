// Pull and Push dialogs, modelled on Fork's: show where the branch syncs to and the few options that matter.
import { useState } from 'react'
import type { PullOptions, PushOptions } from '../../../shared/types'
import { useAsync, usePersistentState } from '../hooks'
import { Modal } from './Modal'

interface PullProps {
  path: string
  onClose: () => void
  onPull: (opts: PullOptions) => void
}

export function PullDialog({ path, onClose, onPull }: PullProps) {
  const { data: info, error } = useAsync(() => window.spoon.syncInfo(path), [path])
  const [rebase, setRebase] = usePersistentState('spoon.pull.rebase', false)
  const [autostash, setAutostash] = usePersistentState('spoon.pull.autostash', true)
  const canPull = !!info?.branch && !!info.upstreamRemote

  const submit = (): void => {
    if (!canPull) return
    onClose()
    onPull({ rebase, autostash })
  }

  return (
    <Modal
      title="Pull"
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={submit} disabled={!canPull}>
            Pull
          </button>
        </>
      }
    >
      {error && <p className="error-text">{error}</p>}
      {info && !info.branch && <p className="muted">HEAD is detached. Check out a branch to pull.</p>}
      {info?.branch && !info.upstreamRemote && (
        <p className="muted">
          <b>{info.branch}</b> has no upstream branch yet. Push it first.
        </p>
      )}
      {canPull && (
        <div className="sync-route">
          <span className="ref-badge remote">
            {info!.upstreamRemote}/{info!.upstreamBranch}
          </span>
          <span className="muted">into</span>
          <span className="ref-badge head current">{info!.branch}</span>
        </div>
      )}
      <label className="check">
        <input type="checkbox" checked={rebase} onChange={(e) => setRebase(e.target.checked)} />
        Rebase instead of merge
      </label>
      <label className="check">
        <input type="checkbox" checked={autostash} onChange={(e) => setAutostash(e.target.checked)} />
        Stash and reapply local changes
      </label>
    </Modal>
  )
}

interface PushProps {
  path: string
  onClose: () => void
  onPush: (opts: PushOptions) => void
}

export function PushDialog({ path, onClose, onPush }: PushProps) {
  const { data: info, error } = useAsync(() => window.spoon.syncInfo(path), [path])
  const [remote, setRemote] = useState<string | null>(null)
  const [remoteBranch, setRemoteBranch] = useState<string | null>(null)
  const [tags, setTags] = useState(false)

  // Defaults: the branch's upstream if it has one, otherwise origin (or the first remote) with the same name.
  const effRemote = remote ?? info?.upstreamRemote ?? (info?.remotes.includes('origin') ? 'origin' : info?.remotes[0]) ?? ''
  const effBranch = remoteBranch ?? (info?.upstreamRemote === effRemote ? info?.upstreamBranch : null) ?? info?.branch ?? ''
  const hasUpstream = !!info?.upstreamRemote
  const [setUpstream, setSetUpstream] = useState<boolean | null>(null)
  const effSetUpstream = setUpstream ?? !hasUpstream

  const canPush = !!info?.branch && !!effRemote && !!effBranch.trim()
  const submit = (): void => {
    if (!canPush) return
    onClose()
    onPush({ remote: effRemote, remoteBranch: effBranch.trim(), setUpstream: effSetUpstream, tags })
  }

  return (
    <Modal
      title="Push"
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={submit} disabled={!canPush}>
            Push
          </button>
        </>
      }
    >
      {error && <p className="error-text">{error}</p>}
      {info && !info.branch && <p className="muted">HEAD is detached. Check out a branch to push.</p>}
      {info && info.remotes.length === 0 && <p className="muted">This repository has no remotes.</p>}
      {info?.branch && info.remotes.length > 0 && (
        <>
          <div className="sync-route">
            <span className="ref-badge head current">{info.branch}</span>
            <span className="muted">to</span>
          </div>
          <div className="form-row">
            <select value={effRemote} onChange={(e) => setRemote(e.target.value)}>
              {info.remotes.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
            <span className="muted">/</span>
            <input value={effBranch} onChange={(e) => setRemoteBranch(e.target.value)} spellCheck={false} />
          </div>
          <label className="check">
            <input type="checkbox" checked={effSetUpstream} onChange={(e) => setSetUpstream(e.target.checked)} />
            Track this remote branch (set upstream)
          </label>
          <label className="check">
            <input type="checkbox" checked={tags} onChange={(e) => setTags(e.target.checked)} />
            Push all tags
          </label>
        </>
      )}
    </Modal>
  )
}
