// Opt-in toolbar scenes for a running Fetch / Pull / Push (Settings → Appearance → "Playful
// toolbar animations"): a dog fetching a ball, two people heaving on a rope, and someone slamming
// a big button that launches an arrow. Line art in the button's color; the motion is in styles.css.
import type { NetKind } from './NetButton'

const svgProps = {
  viewBox: '0 0 120 48',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  className: 'pl-scene'
}

function Fetch() {
  return (
    <svg {...svgProps}>
      <circle className="pl-ball" r="3.6" />
      <g className="pl-dog">
        <g className="pl-dog-face">
          <g className="pl-leg-a">
            <path d="M-6 35l-1 7M5 35l1 7" />
          </g>
          <g className="pl-leg-b">
            <path d="M-3 35l1 7M2 35l-1 7" />
          </g>
          <path className="pl-solid" d="M-10 29q0-4 4-4h10q5 0 5 5v1q0 4-4 4h-11q-4 0-4-6z" />
          <g className="pl-tail">
            <path d="M-10 29q-5-1-6-6" />
          </g>
          <circle className="pl-solid" cx="13" cy="24" r="5" />
          <path className="pl-solid" d="M10 20l-1-5 4 3" />
          <path d="M17 25h3" />
          <circle className="pl-mouth-ball" cx="20.5" cy="26" r="3" />
        </g>
      </g>
    </svg>
  )
}

function Puller({ x, cls }: { x: number; cls: string }) {
  return (
    <g className={`pl-puller ${cls}`}>
      <circle className="pl-solid" cx={x + 2} cy="13" r="4" />
      <path d={`M${x + 3} 17l-3 13M${x + 1} 22l9 5M${x} 30l-5 12M${x} 30l6 12`} />
    </g>
  )
}

function Pull() {
  return (
    <svg {...svgProps}>
      <g className="pl-rope">
        <path d="M20 27H112" strokeDasharray="3 2" />
      </g>
      <g className="pl-cargo">
        <rect className="pl-solid" x="96" y="20" width="16" height="14" rx="3" />
        <circle className="pl-dot" cx="104" cy="27" r="2.4" />
      </g>
      <Puller x={26} cls="pl-p1" />
      <Puller x={46} cls="pl-p2" />
      <path className="pl-sweat" d="M22 10l-3-2M42 10l-3-2" />
    </svg>
  )
}

// The presser stands right beside the button, so a two-part arm (upper arm and forearm, bent at
// the elbow) reaches it at normal proportions: shoulder (72.5,21) → elbow (78.5,25) → hand (84,29).
function Push() {
  return (
    // Shifted so the button and presser sit in the middle of the pill.
    <svg {...svgProps} viewBox="22 0 120 48">
      <rect className="pl-solid" x="78" y="33" width="18" height="10" rx="2" />
      <g className="pl-button">
        <path d="M80 33q7-8 14 0z" />
      </g>
      <g className="pl-rocket">
        <path d="M87 20V8M82 13l5-5 5 5" />
        <path className="pl-flame" d="M85.2 21.5q1.8 6.5 1.8 6.5q0 0 1.8-6.5z" />
      </g>
      <path className="pl-sparks" d="M79 18l-3-3M95 18l3-3M87 5V2" />
      <g className="pl-presser">
        <circle className="pl-solid" cx="72" cy="14" r="4" />
        <path d="M72.5 18l0.5 12M73 30l-4 12M73 30l4 12M72.5 21l-3 6" />
        <g className="pl-upper-arm">
          <path d="M72.5 21l6 4" />
          <g className="pl-forearm">
            <path d="M78.5 25l5.5 4" />
          </g>
        </g>
      </g>
    </svg>
  )
}

export function PlayfulScene({ kind }: { kind: NetKind }) {
  return kind === 'fetch' ? <Fetch /> : kind === 'pull' ? <Pull /> : <Push />
}
