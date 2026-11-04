// Clone Repository: pick one of the GitHub account's repositories (or paste any git URL), choose
// where it goes, and clone it with its submodules. A submodule that can't be downloaded (MainLib
// without SSH access, say) doesn't undo the clone: it opens anyway, and SSH setup and a retry are
// offered for the rest.
import { useEffect, useMemo, useState } from 'react'
import type { CloneableRepo } from '../../../shared/types'
import { cleanError, useAsync, usePersistentState } from '../hooks'
import { tildify } from '../projects'
import { requestSshSetup, sshTrouble } from '../sshHelp'
import { Modal } from './Modal'
import { LockIcon } from './Icons'

interface Props {
  home: string
  /** Open projects, most recent first: a new clone goes next to the last one by default. */
  recents: string[]
  onCloned: (path: string) => void
  onClose: () => void
}

type Phase =
  | { kind: 'form'; error?: string }
  | { kind: 'cloning'; dest: string; step: string; line: string }
  | { kind: 'submodules'; dest: string; error: string; retrying: boolean }

/** owner/name when the URL is a GitHub repository. */
const githubSlug = (url: string): string | null => /github\.com[:/]+([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/.exec(url.trim())?.[1] ?? null
/** The folder a URL clones into, as git would name it. */
const nameOf = (url: string): string => /([^/:\s]+?)(?:\.git)?\/*$/.exec(url.trim())?.[1] ?? ''
/** A long folder path as its last two folders. */
const short = (path: string): string => {
  const sep = path.includes('\\') && !path.includes('/') ? '\\' : '/'
  const parts = path.split(/[\\/]/)
  return parts.length > 4 ? `…${sep}${parts.slice(-2).join(sep)}` : path
}
const sepOf = (path: string): string => (path.includes('\\') && !path.includes('/') ? '\\' : '/')
const parentOf = (path: string): string => path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')))
const ago = (iso: string | null): string => {
  if (!iso) return ''
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)
  return days < 1 ? 'today' : days === 1 ? 'yesterday' : days < 30 ? `${days} days ago` : new Date(iso).toLocaleDateString()
}

export function CloneDialog({ home, recents, onCloned, onClose }: Props) {
  const account = useAsync(() => window.spoon.ghAccount(), [])
  const [mode, setMode] = usePersistentState<'github' | 'url'>('spoon.clone.mode', 'github')
  const fromGitHub = mode === 'github' && !!account.data
  const repos = useAsync(() => (fromGitHub ? window.spoon.ghCloneableRepos() : Promise.resolve(null)), [fromGitHub])
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<CloneableRepo | null>(null)
  const [url, setUrl] = useState('')
  const [protocol, setProtocol] = usePersistentState<'ssh' | 'https'>('spoon.clone.protocol', 'ssh')
  const [submodules, setSubmodules] = usePersistentState('spoon.clone.submodules', true)
  // By default, next to the last project: the folder holding it, or, for a submodule (MainLib inside a
  // game), the folder holding the repository it's part of.
  const outside = useAsync(async () => {
    let top = recents[0]
    if (!top) return home
    for (let i = 0; i < 5; i++) {
      const [up] = await window.spoon.repoParents([top]).catch(() => [null])
      if (!up) break
      top = up
    }
    return parentOf(top) || home
  }, [])
  const [parent, setParent] = usePersistentState<string>('spoon.clone.parent', '')
  const folder = parent || outside.data || home
  const [name, setName] = useState('')
  const [phase, setPhase] = useState<Phase>({ kind: 'form' })
  // Looked at again after SSH setup closes.
  const [sshTick, setSshTick] = useState(0)
  useEffect(() => {
    const on = (): void => setSshTick((t) => t + 1)
    window.addEventListener('spoon:sshChanged', on)
    return () => window.removeEventListener('spoon:sshChanged', on)
  }, [])

  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    return (repos.data?.repos ?? []).filter((r) => words.every((w) => r.fullName.toLowerCase().includes(w)))
  }, [repos.data, query])
  const source = fromGitHub ? (picked ? (protocol === 'ssh' ? picked.sshUrl : picked.httpsUrl) : '') : url.trim()
  // The folder name follows the repository until it's typed over.
  const [nameTyped, setNameTyped] = useState(false)
  useEffect(() => {
    if (!nameTyped) setName(nameOf(source))
  }, [source, nameTyped])
  const dest = name.trim() ? `${folder}${sepOf(folder)}${name.trim()}` : ''
  const exists = useAsync(() => (dest ? window.spoon.pathsExist([dest]).then(([e]) => e) : Promise.resolve(false)), [dest])
  const overSsh = /^(git@|ssh:\/\/)/.test(source)
  // Only asked when it matters: a GitHub repository over SSH.
  const sshMatters = overSsh && !!githubSlug(source)
  const ssh = useAsync(() => (sshMatters ? window.spoon.sshStatus() : Promise.resolve(null)), [sshTick, sshMatters])
  const noSsh = sshMatters && !!ssh.data && ssh.data.auth.state !== 'ok'
  const ready = !!source && !!dest && /^[^/\\]+$/.test(name.trim())

  // Progress lines for this clone (they come named by its folder).
  useEffect(() => {
    if (phase.kind !== 'cloning') return
    return window.spoon.onProgress((repo, line) => {
      if (repo === phase.dest) setPhase((p) => (p.kind === 'cloning' ? { ...p, line } : p))
    })
  }, [phase.kind === 'cloning' ? phase.dest : null]) // eslint-disable-line react-hooks/exhaustive-deps

  const clone = async (): Promise<void> => {
    if (!ready || phase.kind !== 'form') return
    const label = githubSlug(source) ?? name.trim()
    setPhase({ kind: 'cloning', dest, step: `Cloning ${label}…`, line: '' })
    try {
      const { submoduleError } = await window.spoon.clone(source, dest, submodules)
      onCloned(dest)
      if (submoduleError) setPhase({ kind: 'submodules', dest, error: submoduleError, retrying: false })
      else onClose()
    } catch (err) {
      const message = cleanError(err)
      setPhase({ kind: 'form', error: message === 'Cancelled.' ? undefined : message })
    }
  }
  // A double-clicked repository clones once it's the picked one.
  const [go, setGo] = useState(false)
  useEffect(() => {
    if (!go) return
    setGo(false)
    void clone()
  }, [go]) // eslint-disable-line react-hooks/exhaustive-deps
  const retry = async (): Promise<void> => {
    if (phase.kind !== 'submodules') return
    setPhase({ ...phase, retrying: true })
    const error = await window.spoon.cloneSubmodules(phase.dest).catch((e) => cleanError(e))
    if (!error) onClose()
    else setPhase({ ...phase, error, retrying: false })
  }

  if (phase.kind === 'submodules') {
    const sshProblem = sshTrouble(phase.error)
    return (
      <Modal
        title="Couldn’t Download the Submodules"
        onClose={onClose}
        wide
        footer={
          <>
            <button className="btn" style={{ marginRight: 'auto' }} onClick={onClose}>
              Later
            </button>
            {sshProblem && (
              <button className="btn" onClick={requestSshSetup}>
                Set Up SSH Key…
              </button>
            )}
            <button className="btn primary" onClick={retry} disabled={phase.retrying}>
              {phase.retrying ? 'Downloading…' : 'Try Again'}
            </button>
          </>
        }
      >
        <p>
          <span className="clone-ok">✓</span> {phase.dest.split(/[\\/]/).pop()} was cloned and opened.
        </p>
        <p>
          {phase.error === 'Cancelled.'
            ? 'Downloading its submodules (like MainLib) was cancelled.'
            : sshProblem
              ? 'Its submodules (like MainLib) need SSH access to GitHub, which this computer doesn’t have yet. Set up an SSH key, then try again.'
              : 'Its submodules couldn’t be downloaded:'}
        </p>
        {!sshProblem && phase.error !== 'Cancelled.' && <pre className="git-output">{phase.error}</pre>}
        <p className="hint">You can also download them later: open the repository and update its submodules.</p>
      </Modal>
    )
  }

  if (phase.kind === 'cloning')
    return (
      <Modal
        title={phase.step}
        onClose={() => window.spoon.cancel(phase.dest)}
        wide
        footer={
          <button className="btn" onClick={() => window.spoon.cancel(phase.dest)}>
            Cancel
          </button>
        }
      >
        <div className="clone-progress">
          <span className="spinner" />
          <span className="muted clone-line">{phase.line || 'Connecting…'}</span>
        </div>
        <p className="hint">Big repositories take a while. Spoon opens it when it’s done.</p>
      </Modal>
    )

  return (
    <Modal
      title="Clone Repository"
      onClose={onClose}
      onSubmit={clone}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={clone} disabled={!ready}>
            Clone
          </button>
        </>
      }
    >
      <div className="segmented compare-mode">
        <button className={fromGitHub ? 'on' : ''} onClick={() => setMode('github')} disabled={!account.data && !account.loading}>
          From GitHub
        </button>
        <button className={fromGitHub ? '' : 'on'} onClick={() => setMode('url')}>
          From URL
        </button>
      </div>

      {fromGitHub ? (
        <div className="clone-github">
          <input
            placeholder={`Search ${account.data!.login}’s repositories`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            autoFocus
          />
          <div className="clone-list">
            {repos.error && <p className="error-text">{repos.error}</p>}
            {repos.loading && !repos.data && <p className="muted">Loading repositories…</p>}
            {repos.data && !shown.length && <p className="muted">No repositories match.</p>}
            {repos.data?.more && (
              <p className="muted clone-more">Showing the {repos.data.repos.length.toLocaleString()} most recently updated. For another one, paste its URL.</p>
            )}
            {shown.slice(0, 200).map((r) => (
              <button
                key={r.fullName}
                className={`clone-repo ${picked?.fullName === r.fullName ? 'on' : ''}`}
                onClick={() => setPicked(r)}
                onDoubleClick={() => setGo(true)}
                title={r.description ?? r.fullName}
              >
                {r.private ? <LockIcon className="icon" /> : <span className="icon" />}
                <span className="clone-repo-name">{r.fullName}</span>
                <span className="muted clone-repo-when">{ago(r.pushedAt)}</span>
              </button>
            ))}
          </div>
          <span className="clone-protocol">
            <span className="muted">Download over</span>
            <span className="layout-toggle">
              <button className={protocol === 'ssh' ? 'on' : ''} onClick={() => setProtocol('ssh')} title="Uses this computer's SSH key">
                SSH
              </button>
              <button className={protocol === 'https' ? 'on' : ''} onClick={() => setProtocol('https')} title="Uses the GitHub sign-in git has saved">
                HTTPS
              </button>
            </span>
          </span>
        </div>
      ) : (
        <label className="field">
          <span className="field-label">Repository URL</span>
          <input
            placeholder="git@github.com:owner/name.git or https://…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            spellCheck={false}
            autoFocus
          />
          {githubSlug(url) && (
            <span className="hint">
              {githubSlug(url)} on GitHub, over {overSsh ? 'SSH' : 'HTTPS'}
            </span>
          )}
          {!account.data && !account.loading && (
            <span className="hint">Connect GitHub in Settings → Accounts to pick from your repositories instead.</span>
          )}
        </label>
      )}

      {noSsh && (
        <p className="ssh-hint">
          This computer can’t reach GitHub over SSH yet.{' '}
          <button className="btn" onClick={requestSshSetup}>
            Set Up SSH Key…
          </button>
        </p>
      )}

      <label className="field">
        <span className="field-label">Save as</span>
        <span className="clone-dest">
          <button className="btn clone-parent" title={folder} onClick={async () => {
            const chosen = await window.spoon.pickFolder('Clone into…')
            if (chosen) setParent(chosen)
          }}>
            {short(tildify(folder, home))}
            {sepOf(folder)}
          </button>
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setNameTyped(true)
            }}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="Folder name"
            spellCheck={false}
          />
        </span>
        {exists.data && <span className="hint warn">There’s already a {name.trim()} folder there; it has to be empty.</span>}
      </label>
      <label className="check">
        <input type="checkbox" checked={submodules} onChange={(e) => setSubmodules(e.target.checked)} />
        Also download submodules <span className="muted">(like MainLib)</span>
      </label>

      {phase.error && (
        <>
          <pre className="git-output clone-error">{phase.error}</pre>
          {sshTrouble(phase.error) && (
            <p className="ssh-hint">
              This looks like missing SSH access to GitHub.{' '}
              <button className="btn" onClick={requestSshSetup}>
                Set Up SSH Key…
              </button>
            </p>
          )}
        </>
      )}
    </Modal>
  )
}
