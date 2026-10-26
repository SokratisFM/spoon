// Update MainLib: pick a newer version branch of the MainLib submodule, see its tickets from the
// changelog, then switch the submodule, stage the pointer and hand the follow-up work to Claude
// (which reads the team's agent instructions page itself).
import { useEffect, useMemo, useState } from 'react'
import type { ClaudeAvailability, MainLibState, MainLibVersion, Submodule } from '../../../shared/types'
import { cleanError, usePersistentState } from '../hooks'
import { parseChangelog, type ChangelogEntry } from '../changelog'
import { useSettings } from '../settings'
import { Modal } from './Modal'
import { CheckIcon } from './Icons'

type Step = 'version' | 'changes' | 'apply' | 'progress'
const STEPS: [Step, string][] = [
  ['version', 'Version'],
  ['changes', 'What changes'],
  ['apply', 'Apply'],
  ['progress', 'Progress']
]

/** "v3.7.2-2-g02a447a" → { version: "3.7.2", ahead: 2 }. */
function parseDescribe(d: string): { version: string | null; ahead: number } {
  const m = /^v?(\d+(?:\.\d+)+)(?:-(\d+)-g[0-9a-f]+)?$/.exec(d)
  return m ? { version: m[1], ahead: Number(m[2] ?? 0) } : { version: null, ahead: 0 }
}
const parts = (v: string): number[] => v.split('.').map((x) => Number.parseInt(x, 10) || 0)
function compare(a: string, b: string): number {
  const x = parts(a)
  const y = parts(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0)
  return 0
}

interface Prefs {
  where: 'desktop' | 'terminal'
  model: string
  effort: string
}
const MODELS: [string, string][] = [
  ['sonnet', 'Sonnet'],
  ['opus', 'Opus'],
  ['claude-fable-5-1', 'Fable']
]

type Task = { label: string; state: 'todo' | 'working' | 'done' | 'failed' | 'skipped'; error?: string }

export function MainLibDialog({
  path,
  repoName,
  sub,
  onClose,
  onDone
}: {
  path: string
  repoName: string
  sub: Submodule
  onClose: () => void
  /** Refresh the repo after the submodule moved. */
  onDone: () => void
}) {
  const s = useSettings()
  const [step, setStep] = useState<Step>('version')
  const [state, setState] = useState<MainLibState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [changelog, setChangelog] = useState<Map<string, ChangelogEntry> | null>(null)
  const [changelogError, setChangelogError] = useState<string | null>(null)
  const [target, setTarget] = useState<MainLibVersion | null>(null)
  const [doSwitch, setDoSwitch] = useState(true)
  const [doStage, setDoStage] = useState(true)
  const [doClaude, setDoClaude] = useState(s.claudeEnabled)
  const [prefs, setPrefs] = usePersistentState<Prefs>('spoon.mainlib.prefs', { where: 'desktop', model: 'opus', effort: 'xhigh' })
  const [avail, setAvail] = useState<ClaudeAvailability | null>(null)
  const [edited, setEdited] = useState<string | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])

  // Fetch the submodule (new version branches) and read the changelog, side by side.
  useEffect(() => {
    window.spoon.mainlibState(path, sub.path, s.mainlibPrefix).then(
      (st) => {
        setState(st)
        const current = parseDescribe(st.describe).version
        const newer = st.versions.filter((v) => !current || compare(v.version, current) > 0)
        setTarget(newer[0] ?? null)
      },
      (err) => setLoadError(cleanError(err))
    )
    window.spoon.confluencePage(s.mainlibChangelogUrl).then(
      (p) => setChangelog(parseChangelog(p.html)),
      (err) => setChangelogError(cleanError(err))
    )
    window.spoon.claudeAvailability().then(setAvail)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const current = state ? parseDescribe(state.describe) : null
  const newer = useMemo(
    () => (state ? state.versions.filter((v) => !current?.version || compare(v.version, current.version) > 0) : []),
    [state, current?.version]
  )
  // Versions after the current one, up to and including the target.
  const between = target ? newer.filter((v) => compare(v.version, target.version) <= 0) : []
  const ticketCount = (v: string): number | null => changelog?.get(v)?.tickets.length ?? null

  const generated = target
    ? [
        `MainLib (${sub.path}) in this Unity project was updated from ${current?.version ?? state?.describe} to ${target.version} (${target.branch}).`,
        '',
        'Follow the upgrade instructions at',
        s.mainlibInstructionsUrl,
        "for every step between those two versions, applying them to this game's own code and settings.",
        '',
        'When done, summarise what you changed and anything I need to do by hand (for example in the Unity editor).'
      ].join('\n')
    : ''
  const prompt = edited ?? generated
  const claudeOk = !!avail && (prefs.where === 'desktop' ? avail.desktop : !!avail.cli)

  const run = async (): Promise<void> => {
    if (!target) return
    const list: Task[] = [
      { label: `Switch ${sub.name} to ${target.branch}`, state: doSwitch ? 'todo' : 'skipped' },
      { label: `Stage the new ${sub.name} pointer in ${repoName}`, state: doStage ? 'todo' : 'skipped' },
      {
        label: prefs.where === 'desktop' ? 'Hand the follow-up to Claude (Claude app)' : 'Hand the follow-up to Claude (Terminal)',
        state: doClaude && claudeOk ? 'todo' : 'skipped'
      }
    ]
    setTasks(list)
    setStep('progress')
    const work: (() => Promise<unknown>)[] = [
      () => window.spoon.mainlibSwitch(path, sub.path, target.ref),
      () => window.spoon.stage(path, [sub.path]),
      () =>
        window.spoon.claudeLaunch({
          where: prefs.where,
          cwd: path,
          model: prefs.model,
          effort: prefs.effort,
          name: `MainLib ${target.version} in ${repoName}`,
          prompt
        })
    ]
    for (let i = 0; i < list.length; i++) {
      if (list[i].state === 'skipped') continue
      setTasks((t) => t.map((x, k) => (k === i ? { ...x, state: 'working' } : x)))
      try {
        await work[i]()
        setTasks((t) => t.map((x, k) => (k === i ? { ...x, state: 'done' } : x)))
      } catch (err) {
        setTasks((t) => t.map((x, k) => (k === i ? { ...x, state: 'failed', error: cleanError(err) } : x)))
        break
      } finally {
        if (i < 2) onDone()
      }
    }
  }

  const pill = (v: string) => {
    const e = changelog?.get(v)
    if (!e?.status) return null
    return e.status === 'rc' ? (
      <span className="ml-pill rc">Release Candidate</span>
    ) : (
      <span className="ml-pill shipped">Shipped{e.game ? ` · ${e.game}` : ''}</span>
    )
  }

  const footer = (() => {
    if (step === 'version')
      return (
        <>
          <span className="muted ml-foot">{state ? `${newer.length} newer version${newer.length === 1 ? '' : 's'} on origin` : ''}</span>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!target} onClick={() => setStep('changes')}>
            Continue
          </button>
        </>
      )
    if (step === 'changes')
      return (
        <>
          <button className="btn" onClick={() => setStep('version')}>
            Back
          </button>
          <span className="spacer" />
          <button className="btn primary" onClick={() => setStep('apply')}>
            Continue
          </button>
        </>
      )
    if (step === 'apply')
      return (
        <>
          <button className="btn" onClick={() => setStep('changes')}>
            Back
          </button>
          <span className="spacer" />
          <button className="btn primary claude" disabled={!doSwitch && !doStage && !(doClaude && claudeOk)} onClick={run}>
            Update {sub.name}
          </button>
        </>
      )
    const finished = tasks.every((t) => t.state !== 'todo' && t.state !== 'working')
    return (
      <button className="btn primary" disabled={!finished} onClick={onClose}>
        Done
      </button>
    )
  })()

  return (
    <Modal title={`Update ${sub.name}`} onClose={step === 'progress' ? () => undefined : onClose} wide footer={footer}>
      <div className="ml">
        <div className="ml-sub muted">
          {repoName} · {sub.path}
          {state &&
            (current?.version ? (
              <>
                {' '}
                · now at <b>{current.version}</b>
                {current.ahead ? ` + ${current.ahead} commit${current.ahead === 1 ? '' : 's'}` : ''} <span className="mono">({state.hash})</span>
              </>
            ) : (
              <>
                {' '}
                · now at <span className="mono">{state.describe}</span>
              </>
            ))}
        </div>
        <div className="ml-steps">
          {STEPS.map(([id, label], i) => {
            const at = STEPS.findIndex(([x]) => x === step)
            return (
              <span key={id} className={`ml-step ${id === step ? 'on' : ''} ${i < at ? 'done' : ''}`}>
                <i>{i < at ? <CheckIcon /> : i + 1}</i>
                {label}
              </span>
            )
          })}
        </div>

        {step === 'version' && (
          <div className="ml-body">
            {loadError && <p className="error-text">{loadError}</p>}
            {!state && !loadError && <p className="muted">Fetching {sub.name} to look for new versions…</p>}
            {state && newer.length === 0 && <p className="muted">{sub.name} is already on the newest version.</p>}
            {newer.map((v, i) => (
              <button key={v.ref} className={`ml-version ${target?.ref === v.ref ? 'on' : ''}`} onClick={() => setTarget(v)}>
                <span className="ml-radio" />
                <span className="ml-vmain">
                  <span>
                    <b>{v.version}</b> {i === 0 && !pill(v.version) && <span className="ml-pill latest">latest</span>}
                    {pill(v.version)}
                  </span>
                  <span className="mono muted">
                    {v.branch} · {new Date(v.date * 1000).toLocaleDateString()} · {v.hash}
                  </span>
                </span>
                <span className="muted ml-count">
                  {ticketCount(v.version) !== null ? `${ticketCount(v.version)} ticket${ticketCount(v.version) === 1 ? '' : 's'}` : ''}
                </span>
              </button>
            ))}
            {state && (
              <div className="ml-version current">
                <span className="ml-radio" />
                <span className="ml-vmain">
                  <span>
                    <b>{current?.version ?? state.describe}</b> <span className="ml-pill current">current</span>
                  </span>
                  <span className="mono muted">
                    {current?.ahead ? `+ ${current.ahead} commits · ` : ''}
                    {state.hash}
                  </span>
                </span>
              </div>
            )}
            {changelogError && <p className="hint">Changelog unavailable: {changelogError}</p>}
          </div>
        )}

        {step === 'changes' && target && (
          <div className="ml-body">
            {changelogError && <p className="error-text">{changelogError}</p>}
            {!changelog && !changelogError && <p className="muted">Reading the changelog…</p>}
            {changelog && (
              <p className="mono muted ml-total">
                {between.reduce((n, v) => n + (changelog.get(v.version)?.tickets.length ?? 0), 0)} tickets from {current?.version ?? 'now'} to{' '}
                {target.version}
              </p>
            )}
            {changelog &&
              between.map((v) => {
                const e = changelog.get(v.version)
                return (
                  <div key={v.ref} className="ml-card">
                    <div className="ml-card-head">
                      <b>{v.version}</b>
                      {pill(v.version)}
                    </div>
                    {e?.tickets.length ? (
                      e.tickets.map((t, k) => (
                        <div key={k} className="ml-ticket">
                          {t.key ? (
                            <a
                              href="#"
                              className="ml-key mono"
                              onClick={(ev) => {
                                ev.preventDefault()
                                if (t.url) window.spoon.openExternal(t.url)
                              }}
                            >
                              {t.key}
                            </a>
                          ) : (
                            <span className="ml-key" />
                          )}
                          <span>{t.key ? t.title.replace(t.key, '').trim() : t.title}</span>
                        </div>
                      ))
                    ) : (
                      <div className="ml-ticket muted">Not in the changelog.</div>
                    )}
                  </div>
                )
              })}
          </div>
        )}

        {step === 'apply' && target && (
          <div className="ml-body">
            <label className="ml-task">
              <input type="checkbox" checked={doSwitch} onChange={(e) => setDoSwitch(e.target.checked)} />
              <span>
                <b>Switch {sub.name} to {target.branch}</b>
                <span className="mono muted">checks out the branch in {sub.path}</span>
              </span>
            </label>
            <label className="ml-task">
              <input type="checkbox" checked={doStage} onChange={(e) => setDoStage(e.target.checked)} />
              <span>
                <b>
                  Stage the new {sub.name} pointer in {repoName}
                </b>
                <span className="mono muted">ready to commit as “Update {sub.name} to {target.version}”</span>
              </span>
            </label>
            {s.claudeEnabled && (
              <div className="ml-task">
                <input id="ml-claude" type="checkbox" checked={doClaude} onChange={(e) => setDoClaude(e.target.checked)} />
                <span className="ml-claude">
                  <label htmlFor="ml-claude">
                    <b>Ask Claude to apply what the update needs</b>
                  </label>
                  <span className="ml-src">
                    <span className="muted">Instructions</span>
                    <a
                      href="#"
                      className="mono"
                      title={s.mainlibInstructionsUrl}
                      onClick={(e) => {
                        e.preventDefault()
                        window.spoon.openExternal(s.mainlibInstructionsUrl)
                      }}
                    >
                      {s.mainlibInstructionsUrl}
                    </a>
                    <span className="muted">from Settings</span>
                  </span>
                  <span className="ml-claude-opts">
                    <select value={prefs.where} onChange={(e) => setPrefs({ ...prefs, where: e.target.value as Prefs['where'] })}>
                      <option value="desktop" disabled={!avail?.desktop}>
                        Claude desktop
                      </option>
                      <option value="terminal" disabled={!avail?.cli}>
                        Terminal (Claude Code)
                      </option>
                    </select>
                    {prefs.where === 'desktop' ? (
                      // The Claude app's link takes the prompt and folder only; model and effort are picked there.
                      <span className="hint ml-desktop-note">Model and effort are chosen in the Claude app.</span>
                    ) : (
                      <>
                        <select value={prefs.model} onChange={(e) => setPrefs({ ...prefs, model: e.target.value })}>
                          {MODELS.map(([id, label]) => (
                            <option key={id} value={id}>
                              {label}
                            </option>
                          ))}
                        </select>
                        <select value={prefs.effort} onChange={(e) => setPrefs({ ...prefs, effort: e.target.value })}>
                          {['medium', 'high', 'xhigh'].map((x) => (
                            <option key={x}>{x}</option>
                          ))}
                        </select>
                      </>
                    )}
                  </span>
                  <textarea rows={7} value={prompt} onChange={(e) => setEdited(e.target.value)} spellCheck onKeyDown={(e) => e.stopPropagation()} />
                  <span className="hint">
                    {edited !== null ? (
                      <>
                        Edited.{' '}
                        <button className="link-btn" onClick={() => setEdited(null)}>
                          Reset to generated
                        </button>
                      </>
                    ) : (
                      'Editable before sending.'
                    )}
                  </span>
                </span>
              </div>
            )}
          </div>
        )}

        {step === 'progress' && (
          <div className="ml-body">
            {tasks.map((t, i) => (
              <div key={i} className={`ml-progress ${t.state}`}>
                <span className="ml-state">
                  {t.state === 'done' ? <CheckIcon /> : t.state === 'working' ? <span className="spinner" /> : t.state === 'failed' ? '!' : ''}
                </span>
                <span>
                  {t.label}
                  {t.state === 'skipped' && <span className="muted"> · skipped</span>}
                  {t.error && <span className="error-text ml-error">{t.error}</span>}
                </span>
              </div>
            ))}
            {tasks.every((t) => t.state !== 'todo' && t.state !== 'working') && !tasks.some((t) => t.state === 'failed') && (
              <p className="hint">Review the changes in Local Changes, then commit them together with the new pointer.</p>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
