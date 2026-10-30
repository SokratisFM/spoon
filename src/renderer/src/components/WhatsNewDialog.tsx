// What's New: the changelog, newest first. After an update it opens by itself showing only the
// versions since the one you had ("See all versions" shows the rest).
import { useRef, useState } from 'react'
import { Modal } from './Modal'
import { changelog, newerVersion, type ChangeVersion } from '../whatsNew'
import { useAppInfo } from '../appinfo'

const TAG_LABEL = { new: 'New', improved: 'Improved', fixed: 'Fixed' } as const

function niceDate(date: string | null): string {
  if (!date) return ''
  const d = new Date(`${date}T12:00:00`)
  return isNaN(d.getTime()) ? date : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

function Notes({ v }: { v: ChangeVersion }) {
  return (
    <ul className="wn-items">
      {v.items.map((item, i) => (
        <li key={i}>
          {item.tag && <span className={`wn-tag ${item.tag}`}>{TAG_LABEL[item.tag]}</span>}
          <span className="wn-text" dangerouslySetInnerHTML={{ __html: item.html }} />
        </li>
      ))}
    </ul>
  )
}

interface Props {
  /** The version Spoon runs. */
  current: string
  /** After an update: the version it came from (the newer ones get a dot until they're looked at). */
  since?: string | null
  onClose: () => void
}

/** Two panes: the versions on the left (newest first), the chosen one's notes on the right. */
export function WhatsNewDialog({ current, since, onClose }: Props) {
  const all = changelog()
  const isNew = (v: ChangeVersion): boolean => !!since && !!v.version && newerVersion(v.version, since) && !newerVersion(v.version, current)
  const [picked, setPicked] = useState(() => Math.max(0, all.findIndex((v) => v.version === current)))
  const [looked, setLooked] = useState<Set<number>>(() => new Set([picked]))
  const repo = useAppInfo()?.updateRepo
  const pick = (i: number): void => {
    const n = Math.min(Math.max(i, 0), all.length - 1)
    setPicked(n)
    setLooked((l) => new Set(l).add(n))
    listRef.current?.querySelector<HTMLElement>(`[data-i="${n}"]`)?.scrollIntoView({ block: 'nearest' })
  }
  const listRef = useRef<HTMLDivElement>(null)
  const v = all[picked]

  return (
    <div className="whats-new">
      <Modal
        title={since ? `Spoon updated to ${current}` : 'What’s new in Spoon'}
        titleExtra={since ? <span>from {since}</span> : undefined}
        onClose={onClose}
        onSubmit={onClose}
        wide
        footer={
          <>
            {repo && (
              <button className="btn" onClick={() => window.spoon.openExternal(`https://github.com/${repo}/releases`)}>
                All releases on GitHub ↗
              </button>
            )}
            <button className="btn primary" onClick={onClose} autoFocus>
              {since ? 'Got it' : 'Done'}
            </button>
          </>
        }
      >
        <div
          className="wn-panes"
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              pick(picked + (e.key === 'ArrowDown' ? 1 : -1))
            }
          }}
        >
          <div className="wn-versions" ref={listRef}>
            {all.map((x, i) => (
              <button key={x.title} data-i={i} className={`wn-version-item ${i === picked ? 'on' : ''}`} onClick={() => pick(i)}>
                <span>{x.version ?? x.title}</span>
                {isNew(x) && !looked.has(i) && <span className="wn-dot" title="New since your last version" />}
                {x.version === current && <span className="wn-here-mini" title="The version you're running">●</span>}
              </button>
            ))}
          </div>
          <div
            className="wn-notes"
            onClick={(e) => {
              const a = (e.target as HTMLElement).closest('a')
              if (!a) return
              e.preventDefault()
              if (a.href.startsWith('https://')) window.spoon.openExternal(a.href)
            }}
          >
            {v && (
              <>
                <div className="wn-head">
                  <b>{v.version ?? v.title}</b>
                  {v.date && <span className="muted">{niceDate(v.date)}</span>}
                  {v.version === current && <span className="wn-here">You’re here</span>}
                </div>
                <Notes v={v} />
              </>
            )}
          </div>
        </div>
      </Modal>
    </div>
  )
}
