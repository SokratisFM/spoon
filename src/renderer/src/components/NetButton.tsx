// Fetch / Pull / Push toolbar button that shows the operation happening: the arrow glides out
// through the edge as the next one glides in, a ring fills with git's own progress, then a check
// (with "+N" new commits) or a shake on failure.
import { useId, type ComponentType, type SVGProps } from 'react'
import { AlertIcon, CheckIcon } from './Icons'
import { useSettings } from '../settings'
import { PlayfulScene } from './PlayfulNet'

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

// The arrow of each icon (same geometry as Icons.tsx), its fixed tray/bar, the band the arrow may
// travel in, and its direction.
const GLYPHS: Record<NetKind, { arrow: string; base?: string; band: [number, number]; dir: 1 | -1 }> = {
  fetch: { arrow: 'M12 4v11M7 10l5 5 5-5', base: 'M5 20h14', band: [0.5, 17.6], dir: 1 },
  pull: { arrow: 'M12 3v13M6 10l6 6 6-6', band: [0, 21], dir: 1 },
  push: { arrow: 'M12 21V8M6 14l6-6 6 6', base: 'M5 4h14', band: [6.4, 24], dir: -1 }
}
const TRAVEL = 17

/** The working-state icon: arrows pass through a band that fades out at both ends. */
export function MovingGlyph({ kind }: { kind: NetKind }) {
  const id = useId()
  const { arrow, base, band, dir } = GLYPHS[kind]
  const [a, b] = band
  const fade = 1.6 / (b - a)
  const d = TRAVEL * dir
  return (
    <svg
      viewBox="0 0 24 24"
      width="1.15em"
      height="1.15em"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="icon net-glyph"
      overflow="visible"
    >
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1={a} x2="0" y2={b} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#000" />
          <stop offset={fade} stopColor="#fff" />
          <stop offset={1 - fade} stopColor="#fff" />
          <stop offset="1" stopColor="#000" />
        </linearGradient>
        <mask id={`${id}m`} maskUnits="userSpaceOnUse" x="0" y={a} width="24" height={b - a}>
          <rect x="0" y={a} width="24" height={b - a} fill={`url(#${id}g)`} />
        </mask>
      </defs>
      {base && <path d={base} />}
      <g mask={`url(#${id}m)`}>
        <g className="net-pass" style={{ ['--travel' as string]: `${d}px` }}>
          <path d={arrow} />
          <path d={arrow} transform={`translate(0 ${-d})`} />
        </g>
      </g>
    </svg>
  )
}

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
  const scene = useSettings().playfulNet && mine?.phase === 'working'
  return (
    <button
      className={`tool-btn net ${mine ? `net-${mine.phase}` : ''} net-${dir}`}
      disabled={disabled && !mine}
      onClick={onClick}
      title={title}
      aria-busy={mine?.phase === 'working'}
    >
      <span className={`net-icon ${scene ? 'scene' : ''}`}>
        {scene && (
          <>
            <PlayfulScene kind={kind} />
            <span className={`net-scene-bar ${mine.pct === undefined ? 'indeterminate' : ''}`}>
              <span style={mine.pct === undefined ? undefined : { width: `${mine.pct}%` }} />
            </span>
          </>
        )}
        {mine?.phase === 'working' && !scene && (
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
        {mine?.phase === 'done' ? (
          <CheckIcon />
        ) : mine?.phase === 'failed' ? (
          <AlertIcon />
        ) : scene ? null : mine?.phase === 'working' ? (
          <MovingGlyph kind={kind} />
        ) : (
          <Icon className="icon net-glyph" />
        )}
      </span>
      <span>{label}</span>
      <kbd className="tool-key">{shortcut}</kbd>
      {mine?.phase === 'done' && !!mine.gained && <span className="net-gain">+{mine.gained}</span>}
      {!mine && !!badge && <span className="tool-count">{badge}</span>}
    </button>
  )
}
