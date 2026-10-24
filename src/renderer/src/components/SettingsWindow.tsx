import { useEffect, useState } from 'react'
import { refreshGitHubAccount, setGitHubAccount, useGitHubAccount } from '../github'
import { useAppInfo, useMinuteTick, useUpdateState } from '../appinfo'
import appIcon from '../../../../build/icon.png'
import { cleanError, useSlidingIndicator } from '../hooks'
import { hoverPreview, PreviewCard, sliderPreview, type Preview, type PreviewSpec, type SectionState } from './SettingsPreview'
import type { DeviceCode } from '../../../shared/types'
import { forgetProject, forgetProjects, projectName, tildify, useProjects } from '../projects'
import { knownAuthors } from '../authors'
import {
  SIDEBAR_SECTIONS,
  activeTheme,
  SCALE_MAX,
  SCALE_MIN,
  SCALE_STEP,
  updateSettings,
  useSettings,
  type Density,
  type DiffLayout,
  type SubmoduleTabs,
  type TagDisplay,
  type HeadHighlight
} from '../settings'
import {
  AUTHOR_PALETTE,
  COLOR_ELEMENTS,
  resolveTheme,
  THEME_CHOICES,
  type BaseThemeChoice,
  type ColorKey,
  type ThemeChoice
} from '../themes'
import { Modal } from './Modal'
import { CloseIcon, PlusIcon } from './Icons'
import { keys } from '../platform'

export type SettingsTab = 'appearance' | 'authors' | 'projects' | 'accounts' | 'about'
type Tab = SettingsTab

export function SettingsWindow({ onClose, initialTab = 'appearance' }: { onClose: () => void; initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab)
  const tabsRef = useSlidingIndicator<HTMLDivElement>()
  return (
    <Modal
      title="Settings"
      onClose={onClose}
      wide
      top
      footer={
        <button className="btn primary" onClick={onClose}>
          Done
        </button>
      }
    >
      <div className="settings-tabs slider" ref={tabsRef}>
        {(
          [
            ['appearance', 'Appearance'],
            ['authors', 'Author colors'],
            ['projects', 'Projects'],
            ['accounts', 'Accounts'],
            ['about', 'About']
          ] as const
        ).map(([id, label]) => (
          <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="settings-page">
        {tab === 'appearance' && <AppearanceTab />}
        {tab === 'authors' && <AuthorsTab />}
        {tab === 'projects' && <ProjectsTab />}
        {tab === 'accounts' && <AccountsTab />}
        {tab === 'about' && <AboutTab />}
      </div>
      <PreviewCard />
    </Modal>
  )
}

// ---------- appearance ----------

const pct = (v: number): string => `${Math.round(v * 100)}%`

export function SizeControls() {
  const s = useSettings()
  const sizePreview = (to: number): Preview | null => {
    const v = Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.round(to * 100) / 100))
    return Math.abs(v - s.uiScale) < 0.001 ? null : { title: 'Interface size', from: pct(s.uiScale), to: pct(v), spec: { kind: 'size', from: s.uiScale, to: v } }
  }
  const codePreview = (v: number): Preview | null =>
    v === s.codeSize ? null : { title: 'Diff font size', from: `${s.codeSize}px`, to: `${v}px`, spec: { kind: 'code', from: s.codeSize, to: v } }
  return (
    <>
      <label className="field">
        <span className="field-label">
          Interface size <b>{Math.round(s.uiScale * 100)}%</b>
        </span>
        <div className="stepper">
          <button
            onClick={() => updateSettings({ uiScale: s.uiScale - SCALE_STEP })}
            aria-label="Smaller"
            {...hoverPreview(() => sizePreview(s.uiScale - SCALE_STEP))}
          >
            A
          </button>
          <input
            type="range"
            min={SCALE_MIN}
            max={SCALE_MAX}
            step={SCALE_STEP}
            value={s.uiScale}
            onChange={(e) => updateSettings({ uiScale: Number(e.target.value) })}
            {...sliderPreview(SCALE_MIN, SCALE_MAX, SCALE_STEP, sizePreview)}
          />
          <button
            className="big"
            onClick={() => updateSettings({ uiScale: s.uiScale + SCALE_STEP })}
            aria-label="Bigger"
            {...hoverPreview(() => sizePreview(s.uiScale + SCALE_STEP))}
          >
            A
          </button>
        </div>
        <span className="hint">Scales every element and font. Shortcut: {keys('⌘+ ⌘− ⌘0')}</span>
      </label>
      <label className="field">
        <span className="field-label">
          Diff font size <b>{s.codeSize}px</b>
        </span>
        <input
          type="range"
          min={9}
          max={24}
          step={0.5}
          value={s.codeSize}
          onChange={(e) => updateSettings({ codeSize: Number(e.target.value) })}
          {...sliderPreview(9, 24, 0.5, codePreview)}
        />
      </label>
    </>
  )
}

function AppearanceTab() {
  const s = useSettings()
  return (
    <>
      <SizeControls />
      <div className="field">
        <span className="field-label">Row spacing</span>
        <Segmented<Density>
          value={s.density}
          options={[
            ['compact', 'Compact'],
            ['comfortable', 'Comfortable'],
            ['spacious', 'Spacious']
          ]}
          onChange={(density) => updateSettings({ density })}
          preview={{ title: 'Row spacing', spec: (from, to) => ({ kind: 'density', from, to }) }}
        />
      </div>
      <div className="field">
        <span className="field-label">Diff layout</span>
        <Segmented<DiffLayout>
          value={s.diffLayout}
          options={[
            ['unified', 'Unified'],
            ['split', 'Side by side']
          ]}
          onChange={(diffLayout) => updateSettings({ diffLayout })}
          preview={{ title: 'Diff layout', spec: (from, to) => ({ kind: 'layout', from, to }) }}
        />
        <span className="hint">Also switchable from any diff’s header.</span>
      </div>
      <div className="field">
        <span className="field-label">Tags in the commit list</span>
        <Segmented<TagDisplay>
          value={s.tagDisplay}
          options={[
            ['diamond', 'Diamond dot'],
            ['badge', 'Count on dot'],
            ['chip', 'Tag chip'],
            ['all', 'Show all']
          ]}
          onChange={(tagDisplay) => updateSettings({ tagDisplay })}
          preview={{ title: 'Tags in the commit list', spec: (from, to) => ({ kind: 'tags', from, to }) }}
        />
        <span className="hint">Collapsed tags open in a list when you click the dot or chip.</span>
      </div>
      <label className="check" {...toggle('Branch labels in lane colors', s.laneColoredBranches, (from, to) => ({ kind: 'laneLabels', from, to }))}>
        <input
          type="checkbox"
          checked={s.laneColoredBranches}
          onChange={(e) => updateSettings({ laneColoredBranches: e.target.checked })}
        />
        Color branch labels like their graph line
      </label>
      <label className="check" {...toggle('Remote name on branch labels', s.showRemoteName, (from, to) => ({ kind: 'remoteName', from, to }))}>
        <input
          type="checkbox"
          checked={s.showRemoteName}
          onChange={(e) => updateSettings({ showRemoteName: e.target.checked })}
        />
        Show the remote’s name next to the cloud on branch labels (☁ origin), including remote-only branches
      </label>
      <div className="field">
        <span className="field-label">Checked-out commit</span>
        <Segmented<HeadHighlight>
          value={s.headHighlight}
          options={[
            ['band', 'Highlighted row'],
            ['pill', 'HEAD label'],
            ['ring', 'Glowing dot']
          ]}
          onChange={(headHighlight) => updateSettings({ headHighlight })}
          preview={{ title: 'Checked-out commit', spec: (from, to) => ({ kind: 'head', from, to }) }}
        />
      </div>
      <div className="field">
        <span className="field-label">Submodule tabs</span>
        <Segmented<SubmoduleTabs>
          value={s.submoduleTabs}
          options={[
            ['grouped', 'Grouped with parent'],
            ['labelled', 'Labelled “in parent”']
          ]}
          onChange={(submoduleTabs) => updateSettings({ submoduleTabs })}
          preview={{ title: 'Submodule tabs', spec: (from, to) => ({ kind: 'subtabs', from, to }) }}
        />
      </div>
      <BranchColorsField />
      <SidebarSectionsField />
      <PullGroupsField />
      <div className="field">
        <span className="field-label">Theme</span>
        <div className="theme-grid">
          {THEME_CHOICES.map((t) => (
            <ThemeCard key={t.id} id={t.id} name={t.name} hint={t.hint} />
          ))}
        </div>
        {s.theme === 'custom' && <CustomColors />}
      </div>
    </>
  )
}

/** Hover handlers for an on/off setting: previews flipping it. */
function toggle(title: string, on: boolean, spec: (from: boolean, to: boolean) => PreviewSpec) {
  return hoverPreview(() => ({ title, from: on ? 'On' : 'Off', to: on ? 'Off' : 'On', spec: spec(on, !on) }))
}

function SidebarSectionsField() {
  const s = useSettings()
  const list = s.sidebarSections
  const move = (i: number, d: -1 | 1): void => {
    const next = [...list]
    ;[next[i], next[i + d]] = [next[i + d], next[i]]
    updateSettings({ sidebarSections: next })
  }
  const states = (l: typeof list): SectionState[] =>
    l.map((x) => ({ id: x.id, visible: x.visible, label: SIDEBAR_SECTIONS.find((d) => d.id === x.id)?.label ?? x.id }))
  const preview = (next: typeof list, change: string) =>
    hoverPreview(() => ({ title: 'Sidebar sections', from: 'Now', to: change, spec: { kind: 'sidebar', from: states(list), to: states(next) } }))
  const moved = (i: number, d: -1 | 1): typeof list => {
    const next = [...list]
    ;[next[i], next[i + d]] = [next[i + d], next[i]]
    return next
  }
  return (
    <div className="field">
      <span className="field-label">Sidebar sections</span>
      <div className="section-order">
        {list.map((x, i) => (
          <div key={x.id} className={`section-order-row ${x.visible ? '' : 'hidden'}`}>
            <label
              className="check"
              {...preview(
                list.map((y) => (y.id === x.id ? { ...y, visible: !y.visible } : y)),
                x.visible ? 'Hidden' : 'Shown'
              )}
            >
              <input
                type="checkbox"
                checked={x.visible}
                onChange={(e) =>
                  updateSettings({ sidebarSections: list.map((y) => (y.id === x.id ? { ...y, visible: e.target.checked } : y)) })
                }
              />
              {SIDEBAR_SECTIONS.find((d) => d.id === x.id)?.label}
            </label>
            <span className="spacer" />
            <button
              className="icon-btn"
              disabled={i === 0}
              onClick={() => move(i, -1)}
              aria-label="Move up"
              {...(i > 0 ? preview(moved(i, -1), 'Moved up') : {})}
            >
              ↑
            </button>
            <button
              className="icon-btn"
              disabled={i === list.length - 1}
              onClick={() => move(i, 1)}
              aria-label="Move down"
              {...(i < list.length - 1 ? preview(moved(i, 1), 'Moved down') : {})}
            >
              ↓
            </button>
          </div>
        ))}
      </div>
      <span className="hint">Untick to hide a section; arrows change the order.</span>
    </div>
  )
}

const COLOR_NAMES = ['Color 1', 'Color 2', 'Color 3', 'Color 4', 'Color 5', 'Color 6', 'Color 7', 'Color 8']

/** Reserve any of the 8 branch colors for one or more branch-name prefixes. */
function BranchColorsField() {
  const s = useSettings()
  const colors = activeTheme(s).colors
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const reserved = s.reservedColors

  const add = (i: number): void => {
    let v = (drafts[i] ?? '').trim()
    if (!v) return
    if (!v.endsWith('/')) v += '/'
    // A prefix lives in one color: adding it here moves it from wherever it was.
    const next: Record<number, string[]> = {}
    for (const [k, list] of Object.entries(reserved)) next[Number(k)] = list.filter((p) => p !== v)
    next[i] = [...(next[i] ?? []), v]
    updateSettings({ reservedColors: next })
    setDrafts((d) => ({ ...d, [i]: '' }))
  }
  const remove = (i: number, p: string): void =>
    updateSettings({ reservedColors: { ...reserved, [i]: (reserved[i] ?? []).filter((x) => x !== p) } })

  // Previews: a branch with the slot's prefix goes from an automatic color to the reserved one.
  const reservedSlots = Object.entries(reserved).filter(([, l]) => l.length).map(([k]) => Number(k))
  const autoLane = (not: number): number => [0, 1, 2, 3, 4, 5, 6, 7].find((x) => x !== not && !reservedSlots.includes(x)) ?? (not + 1) % 8
  const slotPreview = (i: number) =>
    hoverPreview(() => {
      const auto = autoLane(i)
      return {
        title: `${COLOR_NAMES[i]} for ${reserved[i]?.[0] ?? 'release/'} branches`,
        from: 'Automatic',
        to: COLOR_NAMES[i],
        spec: { kind: 'branch', prefix: reserved[i]?.[0] ?? 'release/', from: { label: auto, line: auto }, to: { label: i, line: s.reservedColorsGraph ? i : auto } }
      }
    })
  const graphPreview = hoverPreview(() => {
    const slot = reservedSlots[0] ?? 2
    const auto = autoLane(slot)
    const on = s.reservedColorsGraph
    return {
      title: 'Reserved color on the graph line',
      from: on ? 'On' : 'Off',
      to: on ? 'Off' : 'On',
      spec: { kind: 'branch', prefix: reserved[slot]?.[0] ?? 'release/', from: { label: slot, line: on ? slot : auto }, to: { label: slot, line: on ? auto : slot } }
    }
  })

  return (
    <div className="field">
      <span className="field-label">Branch colors</span>
      <span className="hint">
        Reserve a color for branch prefixes (type one and press Enter). Reserved colors are only used for those
        branches; other branches share the rest.
      </span>
      <div className="color-slots">
        {COLOR_NAMES.map((name, i) => {
          const c = colors[`lane-${i}` as ColorKey]
          const list = reserved[i] ?? []
          return (
            <div
              key={i}
              className={`color-slot ${list.length ? 'reserved' : ''}`}
              style={{ '--slot': c } as React.CSSProperties}
              {...slotPreview(i)}
            >
              <div className="slot-top">
                <span className="slot-swatch" />
                <span>{name}</span>
                <span className="spacer" />
                <span className="hint">{list.length ? 'reserved' : 'auto'}</span>
              </div>
              <div className="slot-chips">
                {list.map((p) => (
                  <span key={p} className="slot-chip mono">
                    {p}
                    <button aria-label={`Remove ${p}`} onClick={() => remove(i, p)}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <input
                className="slot-input mono"
                placeholder="+ prefix/"
                value={drafts[i] ?? ''}
                onChange={(e) => setDrafts((d) => ({ ...d, [i]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    e.stopPropagation()
                    add(i)
                  }
                }}
                spellCheck={false}
              />
            </div>
          )
        })}
      </div>
      <label className="check" {...graphPreview}>
        <input
          type="checkbox"
          checked={s.reservedColorsGraph}
          onChange={(e) => updateSettings({ reservedColorsGraph: e.target.checked })}
        />
        Also color the branch’s graph line
      </label>
    </div>
  )
}

function PullGroupsField() {
  const s = useSettings()
  const rows: { id: 'awaiting' | 'yours' | 'others'; label: string }[] = [
    { id: 'awaiting', label: 'Awaiting your review' },
    { id: 'yours', label: 'Yours' },
    { id: 'others', label: 'Others' }
  ]
  return (
    <div className="field">
      <span className="field-label">Pull request list</span>
      <div className="section-order">
        {rows.map((r) => {
          const locked = r.id === 'awaiting'
          const on = locked || s.prGroups[r.id as 'yours' | 'others']
          return (
            <div key={r.id} className={`section-order-row ${on ? '' : 'hidden'}`}>
              <label className="check" title={locked ? 'Always shown' : undefined}>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={locked}
                  onChange={(e) => updateSettings({ prGroups: { ...s.prGroups, [r.id]: e.target.checked } })}
                />
                {r.label}
                {locked && <span className="hint"> · always shown</span>}
              </label>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ThemeCard({ id, name, hint }: { id: ThemeChoice; name: string; hint?: string }) {
  const s = useSettings()
  const theme = id === 'custom' ? activeTheme({ ...s, theme: 'custom' }) : resolveTheme(id)
  const c = theme.colors
  return (
    <button className={`theme-card ${s.theme === id ? 'on' : ''}`} onClick={() => updateSettings({ theme: id })} title={hint}>
      <span className="theme-preview" style={{ background: c.bg }}>
        <span className="tp-side" style={{ background: c['bg-chrome'] }}>
          <span style={{ background: c.accent }} />
          <span style={{ background: c['text-faint'] }} />
          <span style={{ background: c['text-faint'] }} />
        </span>
        <span className="tp-main" style={{ background: c['bg-list'] }}>
          {[0, 1, 2].map((i) => (
            <span key={i} className="tp-row">
              <span className="tp-dot" style={{ background: c[`lane-${i}` as ColorKey] }} />
              <span className="tp-line" style={{ background: c.text, width: `${70 - i * 15}%` }} />
            </span>
          ))}
        </span>
      </span>
      <span className="theme-name">{name}</span>
    </button>
  )
}

export function ThemeSelect() {
  const s = useSettings()
  return (
    <select value={s.theme} onChange={(e) => updateSettings({ theme: e.target.value as ThemeChoice })}>
      {THEME_CHOICES.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </select>
  )
}

// ---------- custom theme colors ----------

const BASE_CHOICES = THEME_CHOICES.filter((t) => t.id !== 'custom') as { id: BaseThemeChoice; name: string }[]

/** The Custom theme's palette, shown under the theme cards while Custom is selected. */
function CustomColors() {
  const s = useSettings()
  const shown = activeTheme(s).colors
  const base = resolveTheme(s.customBase).colors

  const setColor = (key: ColorKey, value: string): void => updateSettings({ customColors: { ...s.customColors, [key]: value } })
  const resetColor = (key: ColorKey): void => {
    const next = { ...s.customColors }
    delete next[key]
    updateSettings({ customColors: next })
  }

  return (
    <div className="custom-colors">
      <div className="form-row">
        <span className="field-label">Start from</span>
        <select value={s.customBase} onChange={(e) => updateSettings({ customBase: e.target.value as BaseThemeChoice })}>
          {BASE_CHOICES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <span className="spacer" />
        {Object.keys(s.customColors).length > 0 && (
          <button className="btn" onClick={() => updateSettings({ customColors: {} })}>
            Reset all
          </button>
        )}
      </div>
      <p className="hint">Colors you haven’t changed follow the theme you start from.</p>
      {COLOR_ELEMENTS.map((g) => (
        <div key={g.group} className="color-group">
          <h4>{g.group}</h4>
          <div className="color-grid">
            {g.items.map(({ key, label }) => {
              const changed = s.customColors[key] !== undefined && s.customColors[key] !== base[key]
              return (
                <label
                  key={key}
                  className={`color-item ${changed ? 'changed' : ''}`}
                  {...hoverPreview(() => ({ title: `Where “${label}” is used`, spec: { kind: 'color', key } }))}
                >
                  <input type="color" value={shown[key]} onChange={(e) => setColor(key, e.target.value)} />
                  <span className="color-label">{label}</span>
                  <span className="color-hex mono">{shown[key]}</span>
                  {changed && (
                    <button
                      className="icon-btn"
                      title="Reset to theme color"
                      onClick={(e) => {
                        e.preventDefault()
                        resetColor(key)
                      }}
                    >
                      <CloseIcon />
                    </button>
                  )}
                </label>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------- author colors ----------

function AuthorsTab() {
  const s = useSettings()
  const authors = knownAuthors()
  const listed = new Set(s.authorColors.map((a) => a.name.trim().toLowerCase()))
  const missing = authors.filter((a) => !listed.has(a.toLowerCase()))
  const nextColor = (offset = 0): string => AUTHOR_PALETTE[(s.authorColors.length + offset) % AUTHOR_PALETTE.length]

  const update = (i: number, patch: Partial<{ name: string; color: string }>): void =>
    updateSettings({ authorColors: s.authorColors.map((a, j) => (j === i ? { ...a, ...patch } : a)) })

  // Previews: a few of this repository's authors, colored as now and as they'd be after the change.
  const key = (n: string): string => n.trim().toLowerCase()
  const colorNow = (n: string): string | null =>
    s.authorColorsEnabled ? (s.authorColors.find((a) => a.name.trim() && key(a.name) === key(n))?.color ?? null) : null
  const sample = (first?: string): string[] => {
    const names = [first, ...s.authorColors.map((a) => a.name.trim()), ...missing].filter((n): n is string => !!n)
    const unique = names.filter((n, i) => names.findIndex((m) => key(m) === key(n)) === i).slice(0, 3)
    return unique.length ? unique : ['Alex Kim', 'Sam Lee', 'Jo Park']
  }
  const authorsPreview = (title: string, from: string, to: string, names: string[], after: (n: string) => string | null) =>
    hoverPreview(() => {
      const authors = names.map((name) => ({ name, from: colorNow(name), to: after(name) }))
      return authors.some((a) => a.from !== a.to) ? { title, from, to, spec: { kind: 'authors', authors } } : null
    })
  const listedColor = (n: string): string | null => s.authorColors.find((a) => a.name.trim() && key(a.name) === key(n))?.color ?? null

  return (
    <>
      <label
        className="check"
        {...authorsPreview('Color commits by author', s.authorColorsEnabled ? 'On' : 'Off', s.authorColorsEnabled ? 'Off' : 'On', sample(), (n) =>
          s.authorColorsEnabled ? null : listedColor(n)
        )}
      >
        <input
          type="checkbox"
          checked={s.authorColorsEnabled}
          onChange={(e) => updateSettings({ authorColorsEnabled: e.target.checked })}
        />
        Color commits by author
      </label>
      <p className="hint">
        Listed authors get their color on the commit dot, avatar and a tint across the row. Match by name or email;
        authors not listed keep the normal look.
      </p>

      <div className={`author-list ${s.authorColorsEnabled ? '' : 'disabled'}`}>
        {s.authorColors.map((a, i) => (
          <div key={i} className="author-row">
            <input
              type="color"
              value={a.color}
              onChange={(e) => update(i, { color: e.target.value })}
              {...authorsPreview(`${a.name.trim() || 'This author'}’s color`, 'Normal', 'Colored', sample(a.name.trim() || undefined), (n) =>
                key(n) === key(a.name) ? a.color : colorNow(n)
              )}
            />
            <AuthorInput value={a.name} authors={authors} onChange={(name) => update(i, { name })} />
            <span
              className="author-sample"
              style={{ '--author': a.color } as React.CSSProperties}
              {...authorsPreview(`${a.name.trim() || 'This author'}’s color`, 'Normal', 'Colored', sample(a.name.trim() || undefined), (n) =>
                key(n) === key(a.name) ? a.color : colorNow(n)
              )}
            >
              {a.name || 'Preview'}
            </span>
            <button
              className="icon-btn"
              aria-label="Remove"
              onClick={() => updateSettings({ authorColors: s.authorColors.filter((_, j) => j !== i) })}
              {...authorsPreview(`Remove ${a.name.trim() || 'this author'}`, 'Colored', 'Normal', sample(a.name.trim() || undefined), (n) =>
                key(n) === key(a.name) ? null : colorNow(n)
              )}
            >
              <CloseIcon />
            </button>
          </div>
        ))}
        {s.authorColors.length === 0 && <p className="muted">No authors yet.</p>}
      </div>

      <div className="form-row">
        <button
          className="btn"
          onClick={() =>
            updateSettings({
              authorColorsEnabled: true,
              authorColors: [...s.authorColors, { name: '', color: nextColor() }]
            })
          }
        >
          <PlusIcon /> Add author
        </button>
        {missing.length > 0 && (
          <button
            className="btn"
            onClick={() =>
              updateSettings({
                authorColorsEnabled: true,
                authorColors: [...s.authorColors, ...missing.map((name, k) => ({ name, color: nextColor(k) }))]
              })
            }
            {...authorsPreview(missing.length === 1 ? `Add ${missing[0]}` : `Add all ${missing.length} authors`, 'Now', 'All colored', sample(), (n) =>
              listedColor(n) ?? nextColor(missing.findIndex((m) => key(m) === key(n)))
            )}
          >
            {missing.length === 1 ? `Add ${missing[0]} from this repository` : `Add all ${missing.length} authors from this repository`}
          </button>
        )}
      </div>
    </>
  )
}

// ---------- accounts ----------

function AccountsTab() {
  const s = useSettings()
  const account = useGitHubAccount()
  const [cliLogin, setCliLogin] = useState<string | null | undefined>(undefined)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [device, setDevice] = useState<DeviceCode | null>(null)
  // Once connected, the sign-in options only come back when you choose to switch accounts.
  const [switching, setSwitching] = useState(false)

  useEffect(() => {
    window.spoon.ghCliLogin().then(setCliLogin)
  }, [])

  const attempt = async (label: string, fn: () => Promise<unknown>): Promise<void> => {
    setBusy(label)
    setError(null)
    try {
      await fn()
      await refreshGitHubAccount()
      setSwitching(false)
    } catch (err) {
      setError(cleanError(err))
    } finally {
      setBusy(null)
    }
  }

  // Spoon's own OAuth app (spoon.config.json) unless you've set your own Client ID.
  const builtInClientId = useAppInfo()?.githubClientId ?? ''
  const clientId = s.githubClientId || builtInClientId
  const browserSignIn = (): Promise<void> =>
    attempt('browser', async () => {
      const code = await window.spoon.ghDeviceStart(clientId)
      setDevice(code)
      try {
        await window.spoon.ghDeviceWait(clientId, code)
      } finally {
        setDevice(null)
      }
    })

  const sourceLabel = { gh: 'GitHub CLI sign-in', token: 'Personal access token', browser: 'Browser sign-in' }

  return (
    <>
      {account ? (
        <div className="account-card">
          <img className="gh-avatar large" src={account.avatarUrl} alt="" />
          <div className="palette-text">
            <span className="palette-name">{account.name ?? account.login}</span>
            <span className="palette-path">
              @{account.login} · {sourceLabel[account.source]} · {account.scopes.join(', ') || 'no scopes listed'}
            </span>
          </div>
          {!switching && (
            <button className="btn" onClick={() => setSwitching(true)}>
              Switch account…
            </button>
          )}
          <button
            className="btn"
            onClick={() =>
              attempt('disconnect', async () => {
                await window.spoon.ghDisconnect()
                setGitHubAccount(null)
              })
            }
          >
            Disconnect
          </button>
        </div>
      ) : (
        <p className="hint">Connect GitHub to see pull requests, review them and submit reviews from Spoon.</p>
      )}
      {account && !account.scopes.includes('repo') && account.source !== 'token' && (
        <p className="error-text">This sign-in lacks the “repo” scope, so private repositories won’t load.</p>
      )}

      {(!account || switching) && (
        <div className="connect-list">
          <div className="connect-row">
            <div className="palette-text">
              <span className="palette-name">Use your GitHub CLI sign-in</span>
              <span className="palette-path">
                {cliLogin === undefined
                  ? 'Checking…'
                  : cliLogin
                    ? `Signed in as ${cliLogin}. Spoon asks gh for the token when it needs it.`
                    : 'gh isn’t installed or signed in (run gh auth login).'}
              </span>
            </div>
            <button className="btn" disabled={!cliLogin || !!busy} onClick={() => attempt('cli', () => window.spoon.ghConnectCli())}>
              {busy === 'cli' ? 'Connecting…' : 'Use this account'}
            </button>
          </div>

          <div className="connect-row column">
            <div className="palette-text">
              <span className="palette-name">Sign in with browser</span>
              {builtInClientId ? (
                <span className="palette-path">Opens GitHub in your browser to approve Spoon, like Fork.</span>
              ) : (
                <span className="palette-path">
                  Uses your own GitHub OAuth app (one-time setup):{' '}
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault()
                      window.spoon.openExternal('https://github.com/settings/applications/new')
                    }}
                  >
                    register one
                  </a>
                  , tick “Enable Device Flow”, then paste its Client ID here.
                </span>
              )}
            </div>
            <div className="form-row">
              {!builtInClientId && (
                <input
                  placeholder="OAuth app Client ID"
                  value={s.githubClientId}
                  onChange={(e) => updateSettings({ githubClientId: e.target.value.trim() })}
                  spellCheck={false}
                  className="mono"
                />
              )}
              <button className="btn" disabled={!clientId || !!busy} onClick={browserSignIn}>
                {busy === 'browser' ? 'Waiting…' : 'Sign in'}
              </button>
            </div>
            {device && (
              <div className="device-code">
                <span className="muted">Enter this code on GitHub:</span>
                <span className="device-code-value mono">{device.userCode}</span>
                <button
                  className="btn primary"
                  onClick={() => {
                    navigator.clipboard.writeText(device.userCode)
                    window.spoon.openExternal(device.verificationUri)
                  }}
                >
                  Copy code and open GitHub
                </button>
                <button className="btn" onClick={() => window.spoon.ghDeviceCancel()}>
                  Cancel
                </button>
              </div>
            )}
          </div>

          <div className="connect-row column">
            <div className="palette-text">
              <span className="palette-name">Personal access token</span>
              <span className="palette-path">
                Stored in your macOS Keychain.{' '}
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault()
                    window.spoon.openExternal('https://github.com/settings/tokens/new?scopes=repo,read:org&description=Spoon')
                  }}
                >
                  Create a token
                </a>{' '}
                with the repo and read:org scopes.
              </span>
            </div>
            <div className="form-row">
              <input
                type="password"
                placeholder="ghp_…"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                spellCheck={false}
                className="mono text-like"
              />
              <button
                className="btn"
                disabled={!token.trim() || !!busy}
                onClick={() => attempt('token', async () => {
                  await window.spoon.ghConnectToken(token)
                  setToken('')
                })}
              >
                {busy === 'token' ? 'Checking…' : 'Connect'}
              </button>
            </div>
          </div>
        </div>
      )}
      {account && switching && (
        <button className="btn cancel-switch" onClick={() => setSwitching(false)}>
          Keep {account.login}
        </button>
      )}
      {error && <p className="error-text">{error}</p>}

      <div className="field jira-field">
        <span className="field-label">Jira</span>
        <span className="hint">
          Ticket keys in branch names and commit messages (like MAINLIB-2580) become links to your Jira site. No sign-in
          needed; your browser handles that.
        </span>
        <div className="form-row">
          <input
            placeholder="https://your-company.atlassian.net"
            value={s.jiraSite}
            onChange={(e) => updateSettings({ jiraSite: e.target.value.trim() })}
            spellCheck={false}
            className="mono"
          />
        </div>
        <div className="form-row">
          <input
            placeholder="Only these projects (optional): MAINLIB, CANFA"
            value={s.jiraProjects}
            onChange={(e) => updateSettings({ jiraProjects: e.target.value })}
            spellCheck={false}
          />
        </div>
        {s.jiraSite && !/^https:\/\//.test(s.jiraSite) && (
          <span className="error-text">The address must start with https://</span>
        )}
      </div>
    </>
  )
}

// ---------- about & updates ----------

function AboutTab() {
  const info = useAppInfo()
  const update = useUpdateState()
  useMinuteTick()
  const status = update?.status ?? 'idle'
  const checked = update?.lastCheck ? Math.round((Date.now() - update.lastCheck) / 60000) : null
  const text: Record<string, string> = {
    disabled: 'Automatic updates aren’t set up for this build.',
    idle: 'Not checked yet.',
    checking: 'Checking for updates…',
    current: `Spoon is up to date${checked !== null ? ` (checked ${checked < 1 ? 'just now' : `${checked} min ago`})` : ''}.`,
    downloading: `Downloading ${update?.version}… ${Math.round((update?.progress ?? 0) * 100)}%`,
    ready: `Spoon ${update?.version} is ready to install.`,
    error: update?.error ?? 'Update failed.'
  }
  const os = info?.platform === 'darwin' ? 'macOS' : info?.platform === 'win32' ? 'Windows' : info?.platform
  return (
    <>
      <div className="about">
        <img src={appIcon} alt="" className="about-icon" />
        <div>
          <h2>Spoon</h2>
          <p className="muted">
            Version {info?.version ?? '…'} · {os}
          </p>
        </div>
      </div>
      <div className="field">
        <span className="field-label">Updates</span>
        <p className={status === 'error' ? 'error-text' : ''}>{text[status]}</p>
        {update?.notes && (status === 'ready' || status === 'downloading') && (
          <pre className="release-notes">{update.notes}</pre>
        )}
        <div className="form-row">
          {status === 'ready' ? (
            <button className="btn primary" onClick={() => window.spoon.installUpdate()}>
              Restart and update
            </button>
          ) : (
            <button
              className="btn"
              disabled={status === 'disabled' || status === 'checking' || status === 'downloading'}
              onClick={() => window.spoon.checkForUpdates()}
            >
              Check now
            </button>
          )}
        </div>
        <span className="hint">
          Spoon checks every few hours, downloads updates in the background and verifies their signature before
          installing.
        </span>
      </div>
    </>
  )
}

// ---------- projects ----------

function ProjectsTab() {
  const s = useSettings()
  const projects = useProjects()
  const [home, setHome] = useState('')
  const [missing, setMissing] = useState<Set<string>>(new Set())

  useEffect(() => {
    window.spoon.homeDir().then(setHome)
  }, [])
  useEffect(() => {
    window.spoon
      .pathsExist(projects.map((p) => p.path))
      .then((ok) => setMissing(new Set(projects.filter((_, i) => !ok[i]).map((p) => p.path))))
  }, [projects])

  const choose = async (): Promise<void> => {
    const folder = await window.spoon.pickFolder('Folder to search for repositories')
    if (folder) updateSettings({ scanFolder: tildify(folder, home) })
  }

  return (
    <>
      <div className="field">
        <span className="field-label">Search for repositories in</span>
        <div className="form-row">
          <input
            value={s.scanFolder}
            onChange={(e) => updateSettings({ scanFolder: e.target.value })}
            spellCheck={false}
            className="mono"
          />
          <button className="btn" onClick={choose}>
            Choose…
          </button>
        </div>
        <span className="hint">
          Press Tab anywhere to search your projects. Repos in this folder you haven’t opened yet are listed too.
        </span>
      </div>
      <div className="form-row">
        <span className="field-label">Look</span>
        <select value={s.scanDepth} onChange={(e) => updateSettings({ scanDepth: Number(e.target.value) })}>
          {[1, 2, 3, 4, 5].map((d) => (
            <option key={d} value={d}>
              {d} folder{d === 1 ? '' : 's'} deep
            </option>
          ))}
        </select>
        <label className="check">
          <input
            type="checkbox"
            checked={s.scanNested}
            onChange={(e) => updateSettings({ scanNested: e.target.checked })}
          />
          Include repos inside other repos (submodules)
        </label>
      </div>

      <div className="field">
        <div className="form-row">
          <span className="field-label">Your projects ({projects.length})</span>
          <span className="spacer" />
          {missing.size > 0 && (
            <button className="btn" onClick={() => forgetProjects([...missing])}>
              Remove {missing.size} missing
            </button>
          )}
        </div>
        <div className="project-list">
          {projects.map((p) => (
            <div key={p.path} className={`project-row ${missing.has(p.path) ? 'missing' : ''}`}>
              <div className="palette-text">
                <span className="palette-name">{projectName(p.path)}</span>
                <span className="palette-path">{tildify(p.path, home)}</span>
              </div>
              {missing.has(p.path) && <span className="badge danger">missing</span>}
              <button className="icon-btn" title="Remove from Spoon" onClick={() => forgetProject(p.path)}>
                <CloseIcon />
              </button>
            </div>
          ))}
          {projects.length === 0 && <p className="muted">Projects you open are remembered here.</p>}
        </div>
      </div>
    </>
  )
}

/** Author name field with suggestions from this repository's history, sized like the rest of the UI. */
function AuthorInput({ value, authors, onChange }: { value: string; authors: string[]; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const q = value.trim().toLowerCase()
  const matches = authors.filter((a) => a.toLowerCase().includes(q) && a.toLowerCase() !== q).slice(0, 8)
  const pick = (a: string): void => {
    onChange(a)
    setOpen(false)
  }
  return (
    <div className="autocomplete">
      <input
        placeholder="Author name"
        value={value}
        spellCheck={false}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
          setHi(0)
        }}
        onKeyDown={(e) => {
          if (!open || !matches.length) return
          if (e.key === 'ArrowDown') setHi((h) => Math.min(matches.length - 1, h + 1))
          else if (e.key === 'ArrowUp') setHi((h) => Math.max(0, h - 1))
          else if (e.key === 'Enter') pick(matches[hi])
          else if (e.key === 'Escape') setOpen(false)
          else return
          e.preventDefault()
          e.stopPropagation()
        }}
      />
      {open && matches.length > 0 && (
        <div className="autocomplete-list">
          {matches.map((a, i) => (
            <div
              key={a}
              className={`autocomplete-item ${i === hi ? 'on' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(a)
              }}
              onMouseEnter={() => setHi(i)}
            >
              {a}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  preview
}: {
  value: T
  options: [T, string][]
  onChange: (v: T) => void
  /** Hovering another option previews switching to it. */
  preview?: { title: string; spec: (from: T, to: T) => PreviewSpec }
}) {
  const ref = useSlidingIndicator<HTMLDivElement>()
  const name = (v: T): string => options.find(([x]) => x === v)?.[1] ?? v
  return (
    <div className="segmented slider" ref={ref}>
      {options.map(([v, label]) => (
        <button
          key={v}
          className={v === value ? 'on' : ''}
          onClick={() => onChange(v)}
          {...(preview && v !== value
            ? hoverPreview(() => ({ title: preview.title, from: name(value), to: label, spec: preview.spec(value, v) }))
            : {})}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
