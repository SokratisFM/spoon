// Send Build: a branch's build, through Slack or straight to Jenkins. For Slack it makes the build
// bot's command ("jisfi 0.0.1 temp/x/y 6000.0.76f1"), copies it and opens the channel, where it's pasted
// and sent as you. For Jenkins it starts the game's job (found by its code, e.g. JISFI-…-ios) with the
// job's own parameters, and the build is followed until it ends. The game code (one per platform, from
// each CoreConfiguration) and the Unity version are read from the branch as the remote has it, since
// that's what the build checks out; every value can still be edited.
import { useEffect, useState } from 'react'
import type { JenkinsJob, JenkinsParam, Ref, RepoState } from '../../../shared/types'
import type { SettingsTab } from './SettingsWindow'
import { cleanError, useAsync, usePersistentState } from '../hooks'
import { keys } from '../platform'
import { useSettings } from '../settings'
import { BUILD_CHANNEL, BUILD_OPTIONS, fillCommand, slackOpenUrl } from '../buildCommand'
import { trackBuild } from '../jenkinsBuilds'
import { Modal } from './Modal'

interface Props {
  path: string
  repo: RepoState
  branch: Ref
  via: 'slack' | 'jenkins'
  /** Switch between Slack and Jenkins (Jenkins unreachable: "Send through Slack instead"). */
  onVia: (via: 'slack' | 'jenkins') => void
  onOpenSettings: (tab: SettingsTab) => void
  onClose: () => void
}

/** The Jenkins parameters the dialog's own fields fill in. */
const FIELDS = { VERSION: 'version', BRANCH: 'branch', UNITY_VERSION: 'unity' } as const
/** Short names for the job's on/off parameters (others are named after the parameter). */
const CHIP_NAMES: Record<string, string> = {
  BUILD_ADDRESSABLES: 'addressables',
  WIPE: 'wipe',
  SKIP_SYMBOLS_UPLOAD: 'skip symbols',
  SKIP_DECLINATION_CHECK: 'skip declination',
  FULL_HISTORY: 'full history',
  KEEP_EXPORTED_PROJECT: 'keep export',
  REMOVE_POD_TRUNK: 'remove pod trunk'
}
const chipName = (p: JenkinsParam): string => CHIP_NAMES[p.name] ?? p.name.toLowerCase().replace(/_/g, ' ')
/** On/off parameters that belong with the stage choice (under More), not with the options. */
const STAGE_FLAGS = new Set(['RUN_ONLY'])

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

export function BuildDialog({ path, repo, branch, via, onVia, onOpenSettings, onClose }: Props) {
  const s = useSettings()
  const jenkins = via === 'jenkins'
  const goal = target(repo, branch)
  const { data: info, error } = useAsync(() => window.spoon.unityBuildInfo(path, goal.read), [path, goal.read])
  // The code and version picked last time in this repository come back next time.
  const [savedCode, setSavedCode] = usePersistentState(`spoon.build.code.${path}`, '')
  const [savedVersion, setSavedVersion] = usePersistentState(`spoon.build.version.${path}`, '')
  const [code, setCode] = useState(savedCode)
  const [version, setVersion] = useState(savedVersion)
  const [versionEdited, setVersionEdited] = useState(false)
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
  const toggle = (id: string): void => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  const missing = [!code.trim() && 'game code', !version.trim() && 'version', !name.trim() && 'branch', !unity.trim() && 'Unity version'].filter(Boolean)

  // Jenkins: the account, the game's job(s) and the chosen job's parameters.
  const account = useAsync(() => (jenkins ? window.spoon.jenkinsAccount() : Promise.resolve(null)), [jenkins])
  const [tries, setTries] = useState(0)
  const [jobs, setJobs] = useState<{ code: string; names: string[] } | null>(null)
  const [jobName, setJobName] = useState('')
  const [job, setJob] = useState<JenkinsJob | null>(null)
  const [jkError, setJkError] = useState<string | null>(null)
  const [extras, setExtras] = useState<Record<string, string | boolean>>({})
  const [sending, setSending] = useState(false)
  const signedIn = jenkins && !!account.data
  const trimmedCode = code.trim().toLowerCase()
  useEffect(() => {
    if (!signedIn || !trimmedCode) return
    let live = true
    const timer = setTimeout(() => {
      setJkError(null)
      window.spoon.jenkinsJobsFor(trimmedCode).then(
        (names) => {
          if (!live) return
          setJobs({ code: trimmedCode, names })
          setJobName((j) => (names.includes(j) ? j : (names[0] ?? '')))
        },
        (err) => live && setJkError(cleanError(err))
      )
    }, 350)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [signedIn, trimmedCode, tries])
  useEffect(() => {
    setJob(null)
    if (!signedIn || !jobName) return
    let live = true
    window.spoon.jenkinsJob(jobName).then(
      (j) => {
        if (!live) return
        setJob(j)
        // The version follows the job's last build (what was used before), unless you've typed one.
        const last = j.last?.values.VERSION
        if (typeof last === 'string' && last && !versionEdited) setVersion(last)
        setPicked(j.params.filter((p) => p.type === 'boolean' && p.default === true && !STAGE_FLAGS.has(p.name)).map((p) => p.name))
        setExtras({})
      },
      (err) => live && setJkError(cleanError(err))
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, jobName, tries])

  // Slack: the command and the channel.
  const platform = info?.codes.find((c) => c.code.toLowerCase() === trimmedCode)?.platform
  const shown = BUILD_OPTIONS.filter((o) => !o.iosOnly || platform !== 'Android')
  const command = fillCommand(
    s.buildCommand || '{code} {version} {branch} {unity}',
    { code, version, branch: name, unity },
    shown.filter((o) => picked.includes(o.id)).map((o) => o.id)
  )
  const open = slackOpenUrl(s.buildChannel || BUILD_CHANNEL)

  const chips = jenkins ? (job?.params ?? []).filter((p) => p.type === 'boolean' && !STAGE_FLAGS.has(p.name)) : []
  const more = (job?.params ?? []).filter((p) => !(p.name in FIELDS) && (p.type !== 'boolean' || STAGE_FLAGS.has(p.name)) && p.type !== 'other')
  const ready = missing.length === 0 && (!jenkins || (!!job && !sending))

  const remember = (): void => {
    setSavedCode(code.trim())
    setSavedVersion(version.trim())
  }
  const send = async (): Promise<void> => {
    if (!ready) return
    if (!jenkins) {
      void navigator.clipboard.writeText(command)
      remember()
      if (open) window.spoon.openExternal(open)
      return onClose()
    }
    const values: Record<string, string | boolean> = {}
    const mine: Record<string, string> = { version: version.trim(), branch: name.trim(), unity: unity.trim() }
    // Only what Spoon fills in: anything else is left out, so Jenkins uses the job's own default.
    for (const p of job!.params) {
      if (p.name in FIELDS) values[p.name] = mine[FIELDS[p.name as keyof typeof FIELDS]]
      else if (p.type === 'boolean' && !STAGE_FLAGS.has(p.name)) values[p.name] = picked.includes(p.name)
      else if (p.name in extras) values[p.name] = extras[p.name]
    }
    setSending(true)
    setJkError(null)
    try {
      const { queueId } = await window.spoon.jenkinsBuild(job!.name, values)
      remember()
      trackBuild({ job: job!.name, queueId, label: code.trim().toUpperCase(), branch: name.trim() })
      onClose()
    } catch (err) {
      setJkError(cleanError(err))
      setSending(false)
    }
  }

  const unreachable = !!jkError && /VPN/.test(jkError)
  return (
    <Modal
      title={jenkins ? 'Start Jenkins Build' : 'Send Build to Slack'}
      onClose={onClose}
      onSubmit={() => void send()}
      pending={!info && !error}
      footer={
        <>
          {jenkins && account.data && (
            <span className="muted build-who">
              As {account.data.user} · {account.data.server.replace(/^https?:\/\//, '')}
            </span>
          )}
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => void send()} disabled={!ready} autoFocus>
            {jenkins ? (sending ? 'Starting…' : 'Start Build') : open ? 'Copy & Open Slack' : 'Copy Command'}
          </button>
        </>
      }
    >
      {error && <p className="error-text">Couldn’t read the project from {goal.read.replace(/^refs\/(heads|remotes)\//, '')}: {String(error)}</p>}
      {jenkins && account.data === null && !account.loading && (
        <div className="build-banner">
          <span>Add your Jenkins username and API token first.</span>
          <button className="link-btn" onClick={() => (onClose(), onOpenSettings('accounts'))}>
            Open Settings → Accounts
          </button>
          <button className="link-btn" onClick={() => onVia('slack')}>
            Send through Slack instead
          </button>
        </div>
      )}
      {jenkins && jkError && (
        <div className="build-banner">
          <span>{jkError}</span>
          <button className="link-btn" onClick={() => (setJkError(null), setTries((t) => t + 1))}>
            Try again
          </button>
          {unreachable && (
            <button className="link-btn" onClick={() => onVia('slack')}>
              Send through Slack instead
            </button>
          )}
        </div>
      )}
      <div className="build-grid">
        <span className="field-label">Game</span>
        <div className="form-row">
          {!!info?.codes.length && (
            <span className="segmented">
              {info.codes.map((c) => (
                <button
                  key={c.path}
                  className={c.code.toLowerCase() === trimmedCode ? 'on' : ''}
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
        {signedIn && (
          <>
            <span className="field-label">Job</span>
            <div className="build-job mono">
              {jobs && jobs.code === trimmedCode && !jobs.names.length ? (
                <span className="warn-text">No Jenkins job starts with {trimmedCode.toUpperCase()}-</span>
              ) : jobs && jobs.names.length > 1 ? (
                <select value={jobName} onChange={(e) => setJobName(e.target.value)}>
                  {jobs.names.map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              ) : (
                <span className={job ? '' : 'muted'}>{jobName || 'Looking for the job…'}</span>
              )}
              {job?.last && <span className="muted"> · last build #{job.last.number}</span>}
            </div>
          </>
        )}
        <span className="field-label">Version</span>
        <input
          value={version}
          onChange={(e) => (setVersion(e.target.value), setVersionEdited(true))}
          spellCheck={false}
          className="mono"
          placeholder="0.0.1"
          title={jenkins && job?.last ? `From build #${job.last.number}` : 'What you used last time'}
        />
        <span className="field-label">Branch</span>
        <input value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} className="mono" />
        <span className="field-label">Unity</span>
        <input value={unity} onChange={(e) => setUnity(e.target.value)} spellCheck={false} className="mono" placeholder="6000.0.76f1" />
      </div>
      <div className="build-options">
        {jenkins
          ? chips.map((p) => (
              <button
                key={p.name}
                className={`build-chip ${picked.includes(p.name) ? 'on' : ''} ${p.name === 'WIPE' ? 'risky' : ''}`}
                aria-pressed={picked.includes(p.name)}
                onClick={() => toggle(p.name)}
                title={p.description || p.name}
              >
                {chipName(p)}
              </button>
            ))
          : shown.map((o) => (
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
      {jenkins && more.length > 0 && (
        <details className="build-more">
          <summary>More: {more.map((p) => p.name.toLowerCase().replace(/_/g, ' ')).join(', ')}</summary>
          <div className="build-grid">
            {more.map((p) => {
              const value = extras[p.name] ?? p.default
              const set = (v: string | boolean): void => setExtras((x) => ({ ...x, [p.name]: v }))
              return (
                <Extra key={p.name} param={p} value={value} onChange={set} />
              )
            })}
          </div>
        </details>
      )}
      {goal.note && <p className="warn-text">{goal.note}</p>}
      {!jenkins && (
        <>
          <pre className="build-command mono">{command || ' '}</pre>
          {!open && <p className="warn-text">The Slack channel link in Settings → Accounts isn’t a channel link, so Spoon only copies the command.</p>}
        </>
      )}
      <p className="hint">
        {missing.length
          ? `Missing: ${missing.join(', ')}.`
          : jenkins
            ? 'Jenkins starts the build right away, and a card at the bottom right follows it until it ends.'
            : open
              ? `Spoon copies the command and opens the channel: paste it (${keys('⌘V')}) and press Enter.`
              : 'Spoon copies the command for you to paste in the channel.'}
      </p>
    </Modal>
  )
}

/** A Jenkins parameter the dialog has no field of its own for: a choice, text or on/off. */
function Extra({ param: p, value, onChange }: { param: JenkinsParam; value: string | boolean; onChange: (v: string | boolean) => void }) {
  const label = p.name.toLowerCase().replace(/_/g, ' ')
  return (
    <>
      <span className="field-label" title={p.description}>
        {label.charAt(0).toUpperCase() + label.slice(1)}
      </span>
      {p.type === 'boolean' ? (
        <label className="check" title={p.description}>
          <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
          <span className="muted">{p.description || label}</span>
        </label>
      ) : p.type === 'choice' ? (
        <select value={String(value)} onChange={(e) => onChange(e.target.value)} title={p.description}>
          {(p.choices ?? []).map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      ) : p.type === 'text' ? (
        <textarea rows={3} value={String(value)} onChange={(e) => onChange(e.target.value)} placeholder={p.description} onKeyDown={(e) => e.stopPropagation()} />
      ) : (
        <input value={String(value)} onChange={(e) => onChange(e.target.value)} spellCheck={false} className="mono" placeholder={p.description} />
      )}
    </>
  )
}
