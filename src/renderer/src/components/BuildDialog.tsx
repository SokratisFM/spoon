// Send Build: makes the build bot's Slack command for a branch ("jisfi 0.0.1 temp/x/y 6000.0.76f1"),
// copies it and opens the channel, where it's pasted and sent as you. The game code (one per platform,
// from each CoreConfiguration), the version and the Unity version are read from the branch as the
// remote has it, since that's what the build checks out; every value can still be edited.
import { useEffect, useState } from 'react'
import type { Ref, RepoState } from '../../../shared/types'
import { useAsync, usePersistentState } from '../hooks'
import { keys } from '../platform'
import { useSettings } from '../settings'
import { BUILD_CHANNEL, BUILD_OPTIONS, fillCommand, slackOpenUrl } from '../buildCommand'
import { Modal } from './Modal'

interface Props {
  path: string
  repo: RepoState
  branch: Ref
  onClose: () => void
}

/** The branch name the build checks out, the remote copy to read from, and anything to know first. */
function target(repo: RepoState, ref: Ref): { name: string; read: string; note: string | null } {
  const remoteOf = (name: string): string | undefined =>
    repo.remotes.filter((r) => name.startsWith(`${r}/`)).sort((a, b) => b.length - a.length)[0]
  const strip = (name: string): string => {
    const r = remoteOf(name)
    return r ? name.slice(r.length + 1) : name
  }
  if (ref.kind === 'remote') return { name: strip(ref.name), read: ref.fullName, note: null }
  const plural = (n: number): string => `${n} commit${n === 1 ? '' : 's'}`
  if (ref.upstream && !ref.gone)
    return {
      name: strip(ref.upstream),
      read: `refs/remotes/${ref.upstream}`,
      note: ref.ahead ? `${plural(ref.ahead)} on ${ref.name} aren’t pushed yet, so the build won’t have them.` : null
    }
  const copy = repo.refs.find((r) => r.kind === 'remote' && !!remoteOf(r.name) && strip(r.name) === ref.name)
  if (copy)
    return {
      name: ref.name,
      read: copy.fullName,
      note: copy.target === ref.target ? null : `${ref.name} and ${copy.name} differ; the build uses ${copy.name}.`
    }
  return { name: ref.name, read: ref.fullName, note: `${ref.name} isn’t on the remote yet. Push it first, or the build can’t find it.` }
}

export function BuildDialog({ path, repo, branch, onClose }: Props) {
  const s = useSettings()
  const goal = target(repo, branch)
  const { data: info, error } = useAsync(() => window.spoon.unityBuildInfo(path, goal.read), [path, goal.read])
  // The code and version picked last time in this repository come back next time.
  const [savedCode, setSavedCode] = usePersistentState(`spoon.build.code.${path}`, '')
  const [savedVersion, setSavedVersion] = usePersistentState(`spoon.build.version.${path}`, '')
  const [code, setCode] = useState(savedCode)
  const [version, setVersion] = useState(savedVersion)
  const [name, setName] = useState(goal.name)
  const [unity, setUnity] = useState('')
  // Options start off every time, so last build's wipe or full history isn't sent again by accident.
  const [picked, setPicked] = useState<string[]>([])
  useEffect(() => {
    if (!info) return
    setCode((c) => c || (info.codes[0]?.code.toLowerCase() ?? ''))
    setVersion((v) => v || info.bundleVersion || '')
    setUnity((u) => u || info.unityVersion || '')
  }, [info])

  // iOS-only options show unless the game code is one of the project's Android ones.
  const platform = info?.codes.find((c) => c.code.toLowerCase() === code.trim().toLowerCase())?.platform
  const shown = BUILD_OPTIONS.filter((o) => !o.iosOnly || platform !== 'Android')
  const options = shown.filter((o) => picked.includes(o.id)).map((o) => o.id)
  const toggle = (id: string): void => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  const command = fillCommand(s.buildCommand || '{code} {version} {branch} {unity}', { code, version, branch: name, unity }, options)
  const missing = [!code.trim() && 'game code', !version.trim() && 'version', !name.trim() && 'branch', !unity.trim() && 'Unity version'].filter(Boolean)
  const open = slackOpenUrl(s.buildChannel || BUILD_CHANNEL)
  const ready = missing.length === 0

  const send = (): void => {
    if (!ready) return
    void navigator.clipboard.writeText(command)
    setSavedCode(code.trim())
    setSavedVersion(version.trim())
    if (open) window.spoon.openExternal(open)
    onClose()
  }

  return (
    <Modal
      title="Send Build to Slack"
      onClose={onClose}
      onSubmit={send}
      pending={!info && !error}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={send} disabled={!ready} autoFocus>
            {open ? 'Copy & Open Slack' : 'Copy Command'}
          </button>
        </>
      }
    >
      {error && <p className="error-text">Couldn’t read the project from {goal.read.replace(/^refs\/(heads|remotes)\//, '')}: {String(error)}</p>}
      <div className="build-grid">
        <span className="field-label">Game</span>
        <div className="form-row">
          {!!info?.codes.length && (
            <span className="segmented">
              {info.codes.map((c) => (
                <button
                  key={c.path}
                  className={c.code.toLowerCase() === code.trim().toLowerCase() ? 'on' : ''}
                  onClick={() => setCode(c.code.toLowerCase())}
                  title={c.path}
                >
                  {c.platform || c.code}
                </button>
              ))}
            </span>
          )}
          <input value={code} onChange={(e) => setCode(e.target.value)} spellCheck={false} className="mono" placeholder="jisfi" />
        </div>
        <span className="field-label">Version</span>
        <input value={version} onChange={(e) => setVersion(e.target.value)} spellCheck={false} className="mono" placeholder="0.0.1" />
        <span className="field-label">Branch</span>
        <input value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} className="mono" />
        <span className="field-label">Unity</span>
        <input value={unity} onChange={(e) => setUnity(e.target.value)} spellCheck={false} className="mono" placeholder="6000.0.76f1" />
      </div>
      <div className="build-options">
        {shown.map((o) => (
          <button
            key={o.id}
            className={`build-chip ${picked.includes(o.id) ? 'on' : ''} ${o.risky ? 'risky' : ''}`}
            aria-pressed={picked.includes(o.id)}
            onClick={() => toggle(o.id)}
            title={o.about}
          >
            {o.label}
          </button>
        ))}
      </div>
      {goal.note && <p className="warn-text">{goal.note}</p>}
      <pre className="build-command mono">{command || ' '}</pre>
      {!open && <p className="warn-text">The Slack channel link in Settings → Accounts isn’t a channel link, so Spoon only copies the command.</p>}
      <p className="hint">
        {ready
          ? open
            ? `Spoon copies the command and opens the channel: paste it (${keys('⌘V')}) and press Enter.`
            : 'Spoon copies the command for you to paste in the channel.'
          : `Missing: ${missing.join(', ')}.`}
      </p>
    </Modal>
  )
}
