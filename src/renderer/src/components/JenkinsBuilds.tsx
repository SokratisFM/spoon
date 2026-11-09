// The cards for Jenkins builds started from Spoon (bottom right): stages so far, then the result.
import { dismissBuild, minutes, useTrackedBuilds } from '../jenkinsBuilds'
import { CloseIcon, JenkinsLogoIcon } from './Icons'

const STATE: Record<string, string> = {
  SUCCESS: 'ok',
  IN_PROGRESS: 'run',
  PAUSED_PENDING_INPUT: 'run',
  FAILED: 'bad',
  ABORTED: 'bad',
  UNSTABLE: 'warn'
}

export function JenkinsBuilds() {
  const builds = useTrackedBuilds()
  if (!builds.length) return null
  return (
    <div className="jk-cards">
      {builds.map((b) => {
        const run = b.run
        const status = run?.status ?? 'QUEUED'
        const done = run?.state === 'done'
        return (
          <div key={b.id} className={`jk-card ${done ? STATE[status] ?? 'bad' : ''}`}>
            <div className="jk-head">
              <JenkinsLogoIcon className="icon jk-logo" />
              <b>
                {b.label}
                {run?.number ? ` #${run.number}` : ''}
              </b>
              <span className="jk-status">
                {!run || run.state === 'queued'
                  ? 'Waiting in the queue'
                  : done
                    ? status === 'SUCCESS'
                      ? `Finished · ${minutes(run.durationMillis)}`
                      : status === 'CANCELLED'
                        ? 'Cancelled'
                        : `${status.charAt(0)}${status.slice(1).toLowerCase()}`
                    : `Running · ${minutes(Date.now() - b.startedAt)}`}
              </span>
              <span className="spacer" />
              {run?.url && (
                <button className="link-btn" onClick={() => void window.spoon.jenkinsOpen(run.url!).catch(() => undefined)}>
                  Open
                </button>
              )}
              <button className="icon-btn jk-close" onClick={() => dismissBuild(b.id)} title={done ? 'Dismiss' : 'Stop following (the build keeps going)'}>
                <CloseIcon />
              </button>
            </div>
            <div className="jk-branch mono">{b.branch}</div>
            {!!run?.stages.length && (
              <div className="jk-stages">
                {run.stages.map((s) => (
                  <span key={s.name} className={`jk-stage ${STATE[s.status] ?? ''}`} title={`${s.name}: ${s.status.toLowerCase().replace(/_/g, ' ')}`}>
                    {s.name}
                    {s.status === 'SUCCESS' ? ' ✓' : s.status === 'IN_PROGRESS' ? ' …' : s.status === 'FAILED' ? ' ✕' : ''}
                  </span>
                ))}
              </div>
            )}
            {run?.why && !done && <div className="jk-why">{run.why}</div>}
            {b.error && <div className="jk-why warn-text">{b.error}</div>}
          </div>
        )
      })}
    </div>
  )
}
