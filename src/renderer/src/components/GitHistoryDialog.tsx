// Git Command History: every git command Spoon has run since it opened, newest first, updating live.
// Click a command to copy it (ready to paste into a terminal).
import { useEffect, useMemo, useState } from 'react'
import type { GitCommandEntry } from '../../../shared/types'
import { Modal } from './Modal'
import { CheckIcon } from './Icons'

const SHOWN = 500

/** Shell-style quoting, with git's invisible separators shown as \x1f etc. */
function shellArg(a: string): string {
  const visible = a.replace(/[\x00-\x1f]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
  return visible === '' || /[\s'"$`\\|&;<>()*?!#~{}[\]]/.test(visible) ? `'${visible.replace(/'/g, `'\\''`)}'` : visible
}
export const commandLine = (e: GitCommandEntry): string => `git ${e.args.map(shellArg).join(' ')}`

const time = (t: number): string => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const duration = (ms: number): string => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`)
const repoName = (cwd: string): string => cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd

export function GitHistoryDialog({ current, onClose }: { current: string | null; onClose: () => void }) {
  const [entries, setEntries] = useState<GitCommandEntry[]>([])
  const [query, setQuery] = useState('')
  const [onlyHere, setOnlyHere] = useState(false)
  const [copied, setCopied] = useState<number | null>(null)

  // The list so far, then each start and finish as it happens.
  useEffect(() => {
    let live = true
    const pending: GitCommandEntry[] = []
    const upsert = (list: GitCommandEntry[], e: GitCommandEntry): GitCommandEntry[] => {
      const i = list.findIndex((x) => x.id === e.id)
      if (i < 0) return [...list, e]
      const next = list.slice()
      next[i] = e
      return next
    }
    const off = window.spoon.onGitCommand((e) => {
      if (live) setEntries((list) => upsert(list, e))
      else pending.push(e)
    })
    live = false
    window.spoon.gitHistory().then((list) => {
      live = true
      setEntries(pending.reduce(upsert, list))
    })
    return off
  }, [])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const out: GitCommandEntry[] = []
    for (let i = entries.length - 1; i >= 0 && out.length < SHOWN; i--) {
      const e = entries[i]
      if (onlyHere && current && e.cwd !== current) continue
      if (q && !commandLine(e).toLowerCase().includes(q) && !repoName(e.cwd).toLowerCase().includes(q)) continue
      out.push(e)
    }
    return out
  }, [entries, query, onlyHere, current])

  const running = entries.filter((e) => e.running).length
  const failed = entries.filter((e) => !e.running && e.code !== 0).length

  const copy = (e: GitCommandEntry): void => {
    navigator.clipboard.writeText(`cd ${shellArg(e.cwd)} && ${commandLine(e)}`)
    setCopied(e.id)
    setTimeout(() => setCopied((c) => (c === e.id ? null : c)), 1200)
  }

  return (
    <Modal
      title="Git command history"
      onClose={onClose}
      wide
      top
      footer={
        <>
          <span className="muted history-stats">
            {entries.length} command{entries.length === 1 ? '' : 's'} since Spoon opened
            {running ? ` · ${running} running` : ''}
            {failed ? ` · ${failed} failed` : ''}
          </span>
          <button
            className="btn"
            onClick={() => window.spoon.clearGitHistory().then(() => setEntries([]))}
            disabled={!entries.length}
          >
            Clear
          </button>
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <div className="history-tools">
        <input placeholder="Filter commands" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus spellCheck={false} />
        <label className="check">
          <input type="checkbox" checked={onlyHere} disabled={!current} onChange={(e) => setOnlyHere(e.target.checked)} />
          This repository only
        </label>
      </div>
      <div className="history-list" role="list">
        {shown.length === 0 && <div className="muted history-empty">{entries.length ? 'No commands match.' : 'No git commands yet.'}</div>}
        {shown.map((e) => {
          const status = e.running ? 'running' : e.code === 0 ? 'ok' : 'failed'
          return (
            <button
              key={e.id}
              role="listitem"
              className={`history-row ${status}`}
              onClick={() => copy(e)}
              title={`${e.cwd}\n${commandLine(e)}${e.error ? `\n\n${e.error}` : ''}\n\nClick to copy`}
            >
              <span className="history-time mono">{time(e.startedAt)}</span>
              <span className="history-repo">{repoName(e.cwd)}</span>
              <span className="history-cmd mono">
                {copied === e.id ? (
                  <span className="history-copied">
                    <CheckIcon /> Copied
                  </span>
                ) : (
                  commandLine(e)
                )}
                {e.error && <span className="history-error">{e.error}</span>}
              </span>
              <span className="history-ms mono">{e.ms !== undefined ? duration(e.ms) : ''}</span>
              <span className={`history-status ${status}`} aria-label={status}>
                {status === 'running' ? <span className="spinner" /> : status === 'ok' ? '✓' : e.code === null ? '–' : e.code}
              </span>
            </button>
          )
        })}
      </div>
    </Modal>
  )
}
