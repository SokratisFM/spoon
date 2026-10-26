// Hover previews for Settings: hovering an option shows a small card beside the Settings window
// that animates the part of Spoon it affects, from the current value to the hovered one and back.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import type { ColorKey } from '../themes'
import {
  rowHeight,
  useSettings,
  type Density,
  type DiffLayout,
  type HeadHighlight,
  type LaneSpotlight,
  type SquishStyle,
  type DialogPosition,
  type DiffSyntax,
  type Settings,
  type SidebarSection,
  type SubmoduleTabs,
  type TagDisplay
} from '../settings'
import { hueFor, initials } from '../format'
import { BoxIcon, BranchIcon, BroomIcon, ChildIcon, CloudIcon, PinIcon, StashIcon, TagIcon } from './Icons'
import { MovingGlyph, type NetKind } from './NetButton'
import { PlayfulScene } from './PlayfulNet'
import { CodeText } from './DiffView'
import { paletteVars, type Token } from '../syntax'

export interface SectionState {
  id: SidebarSection
  label: string
  visible: boolean
}

export type PreviewSpec =
  | { kind: 'size'; from: number; to: number }
  | { kind: 'code'; from: number; to: number }
  | { kind: 'density'; from: Density; to: Density }
  | { kind: 'layout'; from: DiffLayout; to: DiffLayout }
  | { kind: 'tags'; from: TagDisplay; to: TagDisplay }
  | { kind: 'laneLabels'; from: boolean; to: boolean }
  | { kind: 'remoteName'; from: boolean; to: boolean }
  | { kind: 'playful'; from: boolean; to: boolean }
  | { kind: 'spotlight'; from: LaneSpotlight; to: LaneSpotlight }
  | { kind: 'spotFade'; from: boolean; to: boolean }
  | { kind: 'squish'; from: SquishStyle | 'off'; to: SquishStyle | 'off' }
  | { kind: 'dialogs'; from: DialogPosition; to: DialogPosition }
  | { kind: 'syntax'; from: DiffSyntax; to: DiffSyntax; words: boolean; wordsFrom?: boolean }
  | { kind: 'head'; from: HeadHighlight; to: HeadHighlight }
  | { kind: 'subtabs'; from: SubmoduleTabs; to: SubmoduleTabs }
  /** Lane indexes for the branch's label and graph line, before and after. */
  | { kind: 'branch'; prefix: string; from: { label: number; line: number }; to: { label: number; line: number } }
  | { kind: 'sidebar'; from: SectionState[]; to: SectionState[] }
  | { kind: 'color'; key: ColorKey }
  /** Up to three authors and their row color before and after (null: the normal look). */
  | { kind: 'authors'; authors: { name: string; from: string | null; to: string | null }[] }

/** One choice in an all-options card: its name, whether it's the current one, and how it looks. */
export interface PreviewOption {
  label: string
  current: boolean
  spec: PreviewSpec
}

export interface Preview {
  title: string
  /** Every choice side by side (the eye next to a setting); spec is then unused. */
  options?: PreviewOption[]
  /** The two ends of the animation, named for the header; a color preview has neither. */
  from?: string
  to?: string
  spec: PreviewSpec
}

// ---------- which preview is showing ----------

type Showing = { preview: Preview; anchor: HTMLElement } | null
let shown: Showing = null
const listeners = new Set<() => void>()
let showTimer: ReturnType<typeof setTimeout> | undefined
let hideTimer: ReturnType<typeof setTimeout> | undefined
let pending: Showing = null

function set(next: Showing): void {
  shown = next
  listeners.forEach((l) => l())
}

export function hidePreview(): void {
  clearTimeout(showTimer)
  clearTimeout(hideTimer)
  pending = null
  if (shown) set(null)
}

function hideSoon(): void {
  clearTimeout(showTimer)
  pending = null
  clearTimeout(hideTimer)
  hideTimer = setTimeout(hidePreview, 140)
}

const sameAs = (a: Showing, preview: Preview, anchor: HTMLElement): boolean =>
  !!a && a.anchor === anchor && JSON.stringify(a.preview) === JSON.stringify(preview)

function offer(preview: Preview | null, anchor: HTMLElement): void {
  clearTimeout(hideTimer)
  if (!preview) return hideSoon()
  // A slider sends one of these per mouse move; nothing happens until the value under it changes.
  if (sameAs(shown, preview, anchor) || sameAs(pending, preview, anchor)) return
  // Moving between options of an open preview swaps it at once; a fresh hover waits a moment,
  // so passing over the window doesn't flash cards.
  if (shown) return set({ preview, anchor })
  pending = { preview, anchor }
  clearTimeout(showTimer)
  showTimer = setTimeout(() => pending && set(pending), 220)
}

/** Handlers for an option: hovering it previews `make()`; clicking it applies it, so the card goes. */
export function hoverPreview(make: () => Preview | null) {
  return {
    onMouseEnter: (e: MouseEvent<HTMLElement>) => offer(make(), e.currentTarget),
    onMouseLeave: hideSoon,
    onMouseDown: hidePreview
  }
}

/**
 * The eye next to a setting: hovering it shows every option side by side, in the setting's order,
 * with the current one outlined, so they can be compared without hovering (or picking) any of them.
 */
export function PreviewEye({ make, label }: { make: () => Preview; label: string }) {
  return (
    <span
      className="pv-eye"
      role="img"
      aria-label={`Preview ${label}`}
      onMouseEnter={(e) => offer(make(), e.currentTarget)}
      onMouseLeave={hideSoon}
      // Inside a checkbox's label: a press here must not press (or toggle) the checkbox.
      onMouseDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      <svg viewBox="0 0 24 24" width="1.05em" height="1.05em" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    </span>
  )
}


// ---------- the card ----------

const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Mounted once inside the Settings window. */
export function PreviewCard() {
  const current = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => void listeners.delete(l)
    },
    () => shown
  )
  useEffect(() => hidePreview, [])
  const card = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; width: number; edge: 'top' | 'bottom' } | null>(null)
  const [phase, setPhase] = useState(false)
  const specKey = current ? JSON.stringify(current.preview.spec) : ''

  // From, then to, then back, for as long as the option is hovered.
  useEffect(() => {
    if (!specKey) return
    if (reducedMotion()) return setPhase(true)
    setPhase(false)
    let interval: ReturnType<typeof setInterval> | undefined
    const start = setTimeout(() => {
      setPhase(true)
      interval = setInterval(() => setPhase((p) => !p), 1800)
    }, 450)
    return () => {
      clearTimeout(start)
      clearInterval(interval)
    }
  }, [specKey])

  // A drawer inside the Settings window, as wide as it: rising from the bottom for settings in the
  // upper half, dropping from the top for the lower half, so it never covers what's being previewed.
  // It stays inside the window, so it works on any screen size.
  useLayoutEffect(() => {
    if (!current || !card.current) return setPos(null)
    const a = current.anchor.getBoundingClientRect()
    const m = (current.anchor.closest('.modal') ?? current.anchor).getBoundingClientRect()
    const h = card.current.getBoundingClientRect().height
    const edge = a.top + a.height / 2 < m.top + m.height / 2 ? 'bottom' : 'top'
    const next = { left: m.left, width: m.width, top: edge === 'bottom' ? m.bottom - h : m.top, edge } as const
    setPos((p) => (p && p.left === next.left && p.top === next.top && p.width === next.width && p.edge === edge ? p : next))
  }, [current, specKey])

  if (!current) return null
  const { preview } = current
  return (
    <div
      ref={card}
      className={`pv-card drawer ${pos ? `from-${pos.edge}` : ''}`}
      style={pos ? { left: pos.left, top: pos.top, width: pos.width } : { visibility: 'hidden' }}
      aria-hidden="true"
    >
      <div className="pv-head">
        <span className="pv-title">{preview.title}</span>
        {!preview.options && preview.from !== undefined && preview.to !== undefined && (
          <span className="pv-ends">
            <span className={`pv-end ${phase ? '' : 'on'}`}>{preview.from}</span>
            <span className="pv-arrow">→</span>
            <span className={`pv-end ${phase ? 'on' : ''}`}>{preview.to}</span>
          </span>
        )}
      </div>
      {preview.options ? (
        // Each option as it looks; a spec whose "from" and "to" are the same value shows just that value.
        // Every option in a row (four as 2 × 2), each tile as large as the drawer allows.
        <div className={`pv-options cols-${preview.options.length === 4 ? 2 : Math.min(3, preview.options.length)}`}>
          {preview.options.map((o) => (
            <div key={o.label} className={`pv-option ${o.current ? 'current' : ''}`}>
              <div className="pv-option-head">
                <span className="pv-option-name">{o.label}</span>
                {o.current && <span className="pv-now">current</span>}
              </div>
              <div className="pv-stage mini">
                <div className="pv-mini-inner">
                  <Stage spec={o.spec} phase />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="pv-stage">
          <Stage spec={preview.spec} phase={phase} />
        </div>
      )}
    </div>
  )
}

// ---------- the scenes ----------

const lane = (i: number): CSSProperties => ({ '--lane': `var(--lane-${i % 8})` }) as CSSProperties
const laneColor = (i: number): string => `var(--lane-${i % 8})`

function Stage({ spec, phase }: { spec: PreviewSpec; phase: boolean }) {
  const s = useSettings()
  switch (spec.kind) {
    case 'size': {
      const v = phase ? spec.to : spec.from
      return (
        <div className="pv-zoom" style={{ transform: `scale(${v / s.uiScale})` }}>
          <MiniRows s={s} n={6} />
        </div>
      )
    }
    case 'code': {
      const v = (phase ? spec.to : spec.from) * s.uiScale
      const lines: [string, string][] = [
        ['hunk', '@@ -12,4 +12,5 @@'],
        ['ctx', '  const lane = lanes[i]'],
        ['del', '- draw(lane, row)'],
        ['add', '+ draw(lane, row, color)'],
        ['add', '+ glow(row)']
      ]
      return (
        <div className="pv-code mono">
          {lines.map(([k, t], i) => (
            <div key={i} className={`pv-code-line ${k}`} style={{ fontSize: v, lineHeight: `${v * 1.6}px` }}>
              {t}
            </div>
          ))}
        </div>
      )
    }
    case 'density':
      return <MiniRows s={{ ...s, density: phase ? spec.to : spec.from }} n={8} />
    case 'syntax': {
      const mode = phase ? spec.to : spec.from
      const words = phase ? spec.words : (spec.wordsFrom ?? spec.words)
      const t = (text: string, kind: Token['kind'] = null): Token => ({ text, kind })
      const rows: Array<{ kind: 'ctx' | 'del' | 'add'; tokens: Token[]; words?: Array<[number, number]> }> = [
        { kind: 'ctx', tokens: [t('// no frame spent on a wait', 'com')] },
        {
          kind: 'del',
          tokens: [t('yield return new', 'kw'), t(' '), t('WaitForSeconds', 'type'), t('('), t('0.25f', 'num'), t(');')],
          words: [[32, 37]]
        },
        {
          kind: 'add',
          tokens: [t('yield return new', 'kw'), t(' '), t('WaitForSeconds', 'type'), t('(frameDelay);')],
          words: [[32, 42]]
        },
        { kind: 'ctx', tokens: [t('Debug', 'type'), t('.'), t('Log', 'fn'), t('('), t('"replay done"', 'str'), t(');')] }
      ]
      return (
        <div className="pv-center">
          <div className={`diff-lines syntax-${mode} pv-syn`} style={paletteVars(s.syntaxPalette, s.syntaxIdeBackground)}>
            {rows.map((r, i) => {
              const text = r.tokens.map((x) => x.text).join('')
              return (
                <div key={i} className={`diff-line ${r.kind} pv-syn-line`}>
                  <span className="sign">{r.kind === 'add' ? '+' : r.kind === 'del' ? '−' : ''}</span>
                  <span className="code">
                    <CodeText text={text} tokens={mode === 'off' ? undefined : r.tokens} words={words ? r.words : undefined} />
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )
    }
    case 'layout': {
      const split = (phase ? spec.to : spec.from) === 'split'
      return (
        <div className="pv-diff mono">
          <div className="pv-block del" style={{ width: split ? 'calc(50% - 0.9rem)' : 'calc(100% - 1.2rem)' }}>
            <div>- old line one</div>
            <div>- old line two</div>
          </div>
          <div
            className="pv-block add"
            style={{
              left: split ? 'calc(50% + 0.3rem)' : '0.6rem',
              top: split ? '0.6rem' : '3.4rem',
              width: split ? 'calc(50% - 0.9rem)' : 'calc(100% - 1.2rem)'
            }}
          >
            <div>+ new line one</div>
            <div>+ new line two</div>
            <div>+ new line three</div>
          </div>
        </div>
      )
    }
    case 'tags': {
      const v = phase ? spec.to : spec.from
      const onDot = v === 'diamond' || v === 'badge'
      return (
        <div className="pv-center">
          <div className="pv-tagrow">
            <span className="pv-node">
              <span
                className="pv-node-dot"
                style={{
                  background: v === 'diamond' ? 'var(--warn)' : laneColor(0),
                  borderRadius: v === 'diamond' ? '0.15rem' : '50%',
                  transform: v === 'diamond' ? 'rotate(45deg) scale(0.9)' : 'none'
                }}
              />
              <span className="pv-node-count" style={{ opacity: v === 'badge' ? 1 : 0, transform: `scale(${v === 'badge' ? 1 : 0.3})` }}>
                2
              </span>
            </span>
            <span className="pv-reveal" style={{ maxWidth: v === 'chip' ? '4rem' : 0, opacity: v === 'chip' ? 1 : 0 }}>
              <span className="ref-badge tag">
                <TagIcon /> 2
              </span>
            </span>
            <span className="pv-reveal" style={{ maxWidth: v === 'all' ? '12rem' : 0, opacity: v === 'all' ? 1 : 0 }}>
              <span className="ref-badge tag">
                <TagIcon /> v2.1.0
              </span>{' '}
              <span className="ref-badge tag">
                <TagIcon /> release
              </span>
            </span>
            <span className="pv-subject">Release 2.1.0</span>
          </div>
          <span className="pv-caption">{onDot ? 'on the graph dot' : 'next to the message'}</span>
        </div>
      )
    }
    case 'laneLabels': {
      const on = phase ? spec.to : spec.from
      return (
        <div className="pv-list">
          {['main', 'feature/replay', 'release/2.1'].map((b, i) => (
            <div key={b} className="pv-line">
              <span className="pv-dot" style={{ background: laneColor(i) }} />
              <span className={`ref-badge head ${on ? 'laned' : ''}`} style={lane(i)}>
                {b}
              </span>
              <span className="pv-bar" style={{ width: `${6 - i}rem` }} />
            </div>
          ))}
        </div>
      )
    }
    case 'remoteName': {
      const on = phase ? spec.to : spec.from
      const cloud = (
        <span className="ref-remote">
          <CloudIcon />
          <span className="pv-reveal" style={{ maxWidth: on ? '4rem' : 0 }}>
            origin
          </span>
        </span>
      )
      return (
        <div className="pv-list">
          <div className="pv-line">
            <span className="ref-badge head">
              {cloud}feature/replay
            </span>
            <span className="pv-caption">local and on origin</span>
          </div>
          <div className="pv-line">
            <span className="ref-badge remote">
              {cloud}hotfix/crash
            </span>
            <span className="pv-caption">only on origin</span>
          </div>
        </div>
      )
    }
    case 'head': {
      const v = phase ? spec.to : spec.from
      return (
        <div className="pv-rows">
          {[0, 1, 2, 3, 4].map((i) => {
            const isHead = i === 2
            return (
              <div
                key={i}
                className={`pv-row ${isHead && v === 'band' ? 'pv-band' : ''}`}
                style={{ height: rowHeight(s) }}
              >
                <span className="pv-node">
                  <span
                    className="pv-node-dot"
                    style={{
                      background: isHead && v === 'ring' ? 'var(--add)' : isHead ? 'var(--bg-list)' : laneColor(0),
                      boxShadow: isHead
                        ? v === 'ring'
                          ? '0 0 0 0.3rem color-mix(in srgb, var(--add) 35%, transparent)'
                          : `inset 0 0 0 0.12rem ${laneColor(0)}`
                        : 'none'
                    }}
                  />
                </span>
                <span className="pv-bar" style={{ width: `${8 - ((i * 3) % 4)}rem`, opacity: isHead ? 0.9 : 0.45 }} />
                {isHead && (
                  <span className="head-pill pv-pop" style={{ opacity: v === 'pill' ? 1 : 0, transform: v === 'pill' ? 'none' : 'translateY(-0.4rem)' }}>
                    <PinIcon /> HEAD
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )
    }
    case 'subtabs': {
      const grouped = (phase ? spec.to : spec.from) === 'grouped'
      return (
        <div className="pv-center">
          <div className="pv-tabs">
            <span className="pv-tabgroup" style={{ borderColor: grouped ? 'var(--border-strong)' : 'transparent', gap: grouped ? '0.15rem' : '0.5rem' }}>
              <span className="pv-tab">maze-rush</span>
              <span className="pv-tab">
                {grouped ? <ChildIcon className="icon tab-sub-icon" /> : <BoxIcon className="icon tab-sub-icon" />}
                <span className="tab-two">
                  <span>MainLib</span>
                  <small className="pv-reveal-y" style={{ maxHeight: grouped ? 0 : '1rem' }}>
                    in maze-rush
                  </small>
                </span>
              </span>
            </span>
            <span className="pv-tab">canasta</span>
          </div>
        </div>
      )
    }
    case 'branch': {
      const v = phase ? spec.to : spec.from
      return (
        <div className="pv-branch">
          <span className="pv-lane-line" style={{ background: laneColor(v.line) }} />
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="pv-line pv-branch-row">
              <span className="pv-dot" style={{ background: laneColor(v.line) }} />
              {i === 0 ? (
                <span className="ref-badge head laned" style={lane(v.label)}>
                  {spec.prefix}2.1
                </span>
              ) : (
                <span className="pv-bar" style={{ width: `${5 + i}rem` }} />
              )}
            </div>
          ))}
        </div>
      )
    }
    case 'sidebar': {
      const state = phase ? spec.to : spec.from
      let shownBefore = 0
      const top = new Map<string, number>()
      for (const x of state) {
        top.set(x.id, shownBefore)
        if (x.visible) shownBefore++
      }
      return (
        <div className="pv-sidebar">
          {state.map((x) => (
            <div
              key={x.id}
              className="pv-section"
              style={{
                top: `${0.5 + top.get(x.id)! * 1.75}rem`,
                opacity: x.visible ? 1 : 0,
                transform: x.visible ? 'none' : 'scaleY(0.3)'
              }}
            >
              <SectionIcon id={x.id} />
              {x.label}
            </div>
          ))}
        </div>
      )
    }
    case 'spotlight': {
      // Three branch lines; the orange one lights up the way the mode would.
      const mode = phase ? spec.to : spec.from
      const lit = mode !== 'off'
      const op = (lane: number): number => (!lit || lane === 1 ? 1 : 0.22)
      return (
        <div className="pv-list">
          <svg viewBox="0 0 240 120" style={{ width: '100%', height: '9rem' }}>
            <path d="M20 10V112" stroke={laneColor(0)} strokeWidth="2" opacity={op(0)} />
            <path d="M20 26q0 12 22 16V112" stroke={laneColor(1)} strokeWidth={lit ? 2.8 : 2} fill="none" opacity={op(1)} />
            <path d="M20 56q0 12 44 16V112" stroke={laneColor(2)} strokeWidth="2" fill="none" opacity={op(2)} />
            {[10, 26, 56].map((y) => (
              <circle key={y} cx="20" cy={y} r="4" fill={laneColor(0)} opacity={op(0)} />
            ))}
            {[50, 78, 100].map((y) => (
              <circle key={y} cx="42" cy={y} r="4" fill={laneColor(1)} opacity={op(1)} />
            ))}
            {[88].map((y) => (
              <circle key={y} cx="64" cy={y} r="4" fill={laneColor(2)} opacity={op(2)} />
            ))}
            <rect x="54" y="42" width="78" height="16" rx="8" fill={laneColor(1)} opacity={0.18} />
            <text x="61" y="54" fontSize="10" fontWeight="600" fill={laneColor(1)}>feature/ads</text>
            <text x="140" y="54" fontSize="9.5" fill="var(--text-muted)">
              {mode === 'selected' ? '← selected commit' : mode === 'hover' ? '← pointer on label' : ''}
            </text>
          </svg>
        </div>
      )
    }
    case 'dialogs': {
      // A small window with a dialog in it, sitting where dialogs open.
      const top = (phase ? spec.to : spec.from) === 'top'
      return (
        <div className="pv-center">
          <div className="pv-win">
            <MiniRows s={s} n={7} />
            <div className="pv-win-dim" />
            <div className="pv-dialog" style={{ top: top ? '12%' : '50%', transform: top ? 'translate(-50%, 0)' : 'translate(-50%, -50%)' }}>
              <span className="pv-bar" style={{ width: '4rem', opacity: 0.8 }} />
              <span className="pv-bar faint" style={{ width: '7rem' }} />
              <span className="pv-bar faint" style={{ width: '6rem' }} />
              <span className="pv-dialog-btn" />
            </div>
          </div>
        </div>
      )
    }
    case 'squish': {
      // A branch of five commits; squished, only its latest and first stay, with a fold row or a bead.
      const v = phase ? spec.to : spec.from
      const row = (key: string, show: boolean, body: ReactNode, cls = ''): ReactNode => (
        <div key={key} className={`pv-sq-row ${cls}`} style={{ maxHeight: show ? '1.3rem' : 0, opacity: show ? 1 : 0 }}>
          {body}
        </div>
      )
      const commit = (width: string, label?: string, bead?: boolean): ReactNode => (
        <>
          <span className="pv-node">
            <span className="pv-node-dot" style={{ background: laneColor(1) }} />
            {bead !== undefined && (
              <span className="pv-sq-bead" style={{ opacity: bead ? 1 : 0, transform: `translate(-50%, -50%) scale(${bead ? 1 : 0.4})` }}>
                +3
              </span>
            )}
          </span>
          {label && (
            <span className="ref-badge head laned" style={lane(1)}>
              {label}
            </span>
          )}
          <span className="pv-bar" style={{ width }} />
        </>
      )
      return (
        <div className="pv-center">
          <div className="pv-sq">
            <span className="pv-sq-line" style={{ background: laneColor(1) }} />
            {row('tip', true, commit('6rem', 'feature/replay'))}
            {[0, 1, 2].map((i) => row(`m${i}`, v === 'off', commit(`${7 - ((i * 3) % 4)}rem`)))}
            {row(
              'fold',
              v === 'fold',
              <>
                <span className="pv-node" />
                <span className="pv-caption">3 commits squished</span>
              </>,
              'fold'
            )}
            {row('first', true, commit('5rem', undefined, v === 'bead'))}
          </div>
          <span className="pv-caption">
            {v === 'off' ? 'every commit' : v === 'fold' ? 'a fold row stands in for them' : 'a bead on the line stands in for them'}
          </span>
        </div>
      )
    }
    case 'spotFade': {
      // Commits on three branches with the orange one lit; with fading on, the others' rows fade too.
      const on = phase ? spec.to : spec.from
      const lanes = [0, 1, 0, 1, 2, 1, 0]
      return (
        <div className="pv-center">
          <div className="pv-sq" style={{ width: '18rem' }}>
            {lanes.map((l, i) => (
              <div key={i} className="pv-sq-row" style={{ maxHeight: '1.3rem', opacity: 1 }}>
                <span className="pv-node" style={{ marginLeft: `${l * 0.9}rem` }}>
                  <span className="pv-node-dot" style={{ background: laneColor(l), opacity: l === 1 ? 1 : 0.3 }} />
                </span>
                <span className="pv-bar" style={{ width: `${6 - ((i * 5) % 4)}rem`, opacity: l === 1 || !on ? 0.55 : 0.15, transition: 'opacity 0.3s' }} />
              </div>
            ))}
          </div>
          <span className="pv-caption">{on ? 'other branches’ commits fade' : 'only the lines dim'}</span>
        </div>
      )
    }
    case 'playful': {
      // Both versions stay mounted (the scenes run longer than one swap), and the one the card is
      // showing lights up.
      const on = phase ? spec.to : spec.from
      const row = (playful: boolean) => (
        <div className={`pv-net-row ${on === playful ? 'on' : ''}`}>
          <span className="pv-caption">{playful ? 'Playful' : 'Standard'}</span>
          {(['fetch', 'pull', 'push'] as NetKind[]).map((k) => (
            <span key={k} className="tool-btn net net-working pv-net">
              <span className={`net-icon ${playful ? 'scene' : ''}`}>
                {playful ? <PlayfulScene kind={k} /> : <MovingGlyph kind={k} />}
              </span>
              <span>{k[0].toUpperCase() + k.slice(1)}</span>
            </span>
          ))}
        </div>
      )
      return (
        <div className="pv-list pv-net-list">
          {row(false)}
          {row(true)}
        </div>
      )
    }
    case 'color':
      return <MiniApp hit={spec.key} />
    case 'authors':
      return (
        <div className="pv-rows">
          {[0, 1, 0, 2, 1, 0, 2].map((a, i) => {
            const who = spec.authors[a % spec.authors.length]
            const c = phase ? who.to : who.from
            return (
              <div
                key={i}
                className="pv-row"
                style={{
                  height: rowHeight(s),
                  background: c ? `color-mix(in srgb, ${c} 9%, transparent)` : 'transparent',
                  boxShadow: `inset ${c ? '0.22rem' : '0'} 0 0 ${c ?? 'transparent'}`
                }}
              >
                <span className="pv-node">
                  <span className="pv-node-dot" style={{ background: c ?? laneColor(0) }} />
                </span>
                <span className="pv-bar" style={{ width: `${5 + ((i * 37) % 5)}rem` }} />
                <span className="pv-spacer" />
                <span
                  className="avatar pv-avatar"
                  style={
                    {
                      '--hue': hueFor(who.name),
                      ...(c ? { background: c, color: `color-mix(in srgb, ${c} 25%, #000)` } : {})
                    } as CSSProperties
                  }
                >
                  {initials(who.name)}
                </span>
                <span className="pv-author" style={{ color: c ?? 'var(--text-muted)' }}>
                  {who.name}
                </span>
              </div>
            )
          })}
        </div>
      )
  }
}

function SectionIcon({ id }: { id: SidebarSection }): ReactNode {
  if (id === 'branches') return <BranchIcon />
  if (id === 'remotes') return <CloudIcon />
  if (id === 'tags') return <TagIcon />
  if (id === 'stashes') return <StashIcon />
  if (id === 'stale') return <BroomIcon />
  return <BoxIcon />
}

function MiniRows({ s, n }: { s: Settings; n: number }) {
  const h = rowHeight(s)
  return (
    <div className="pv-rows">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="pv-row" style={{ height: h }}>
          <span className="pv-node">
            <span className="pv-node-dot" style={{ background: laneColor(i % 3) }} />
          </span>
          {i === 1 && (
            <span className="ref-badge head laned" style={lane(1)}>
              main
            </span>
          )}
          <span className="pv-bar" style={{ width: `${5 + ((i * 37) % 6)}rem` }} />
          <span className="pv-spacer" />
          <span className="pv-bar faint" style={{ width: '2.2rem' }} />
        </div>
      ))}
    </div>
  )
}

/** A tiny Spoon window; parts drawn in the hovered color pulse. */
function MiniApp({ hit }: { hit: ColorKey }) {
  const k = (...keys: ColorKey[]): string => (keys.includes(hit) ? 'pv-hit' : '')
  return (
    <div className={`pv-app ${k('bg', 'border')}`}>
      <div className={`pv-app-side ${k('bg-chrome')}`}>
        <span className={`pv-app-nav on ${k('accent')}`}>History</span>
        <span className={`pv-app-nav ${k('text-muted')}`}>Branches</span>
        <span className={`pv-app-nav faint ${k('text-faint')}`}>Stashes</span>
      </div>
      <div className="pv-app-main">
        <div className={`pv-app-list ${k('bg-list')}`}>
          {[0, 1, 2].map((i) => (
            <div key={i} className={`pv-app-row ${i === 1 ? `sel ${k('accent')}` : ''}`}>
              <span className={`pv-dot ${k(`lane-${i}` as ColorKey)}`} style={{ background: laneColor(i) }} />
              {i === 0 && <span className={`pv-app-tag ${k('warn')}`}>v2.1</span>}
              <span className={`pv-app-text ${k('text')}`}>{['Release 2.1', 'Fix replay', 'HGT update'][i]}</span>
              <span className={`pv-app-hash ${k('text-faint')}`}>a1c{i}</span>
            </div>
          ))}
          <div className="pv-app-lanes">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <span key={i} className={`pv-dot ${k(`lane-${i}` as ColorKey)}`} style={{ background: laneColor(i) }} />
            ))}
          </div>
        </div>
        <div className={`pv-app-panel ${k('bg-panel')}`}>
          <span className={`pv-app-diff del ${k('del')}`}>- draw(row)</span>
          <span className={`pv-app-diff add ${k('add')}`}>+ draw(row, color)</span>
          <span className="pv-app-files">
            <span className={`pv-app-status ${k('rename')}`}>R</span>
            <span className={`pv-app-err ${k('danger')}`}>conflict</span>
            <span className="pv-spacer" />
            <span className={`pv-app-btn ${k('bg-elev')}`}>Stash</span>
            <span className={`pv-app-btn primary ${k('accent', 'accent-text')}`}>Commit</span>
          </span>
        </div>
      </div>
    </div>
  )
}

