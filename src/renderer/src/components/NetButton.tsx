// Fetch / Pull / Push toolbar button that shows the operation happening: the arrow bobs in its
// direction, a ring fills with git's own progress, then a check (with "+N" new commits) or a
// shake on failure.
import type { ComponentType, SVGProps } from 'react'
import { AlertIcon, CheckIcon } from './Icons'

export type NetKind = 'fetch' | 'pull' | 'push'

export interface NetState {
  kind: NetKind
  phase: 'working' | 'done' | 'failed'
  /** 0–100 once git reports a percentage. */
  pct?: number
  /** Commits that appeared in history because of this operation. */
  gained?: number
}

const RING = 2 * Math.PI * 15

interface Props {
  kind: NetKind
  label: string
  shortcut: string
  title: string
  Icon: ComponentType<SVGProps<SVGSVGElement>>
  net: NetState | null
  /** Waiting commits (behind/ahead) shown as the usual badge. */
  badge?: number
  disabled: boolean
  onClick: () => void
}

export function NetButton({ kind, label, shortcut, title, Icon, net, badge, disabled, onClick }: Props) {
  const mine = net?.kind === kind ? net : null
  const dir = kind === 'push' ? 'up' : 'down'
  return (
    <button
      className={`tool-btn net ${mine ? `net-${mine.phase}` : ''} net-${dir}`}
      disabled={disabled && !mine}
      onClick={onClick}
      title={title}
      aria-busy={mine?.phase === 'working'}
    >
      <span className="net-icon">
        {mine?.phase === 'working' && (
          <svg className={`net-ring ${mine.pct === undefined ? 'indeterminate' : ''}`} viewBox="0 0 36 36" aria-hidden="true">
            <circle className="net-track" cx="18" cy="18" r="15" />
            <circle
              className="net-arc"
              cx="18"
              cy="18"
              r="15"
              strokeDasharray={RING}
              strokeDashoffset={mine.pct === undefined ? RING * 0.72 : RING * (1 - mine.pct / 100)}
            />
          </svg>
        )}
        {mine?.phase === 'done' ? <CheckIcon /> : mine?.phase === 'failed' ? <AlertIcon /> : <Icon className="icon net-glyph" />}
      </span>
      <span>{label}</span>
      <kbd className="tool-key">{shortcut}</kbd>
      {mine?.phase === 'done' && !!mine.gained && <span className="net-gain">+{mine.gained}</span>}
      {!mine && !!badge && <span className="tool-count">{badge}</span>}
    </button>
  )
}
