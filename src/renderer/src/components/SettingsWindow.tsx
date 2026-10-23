import { useState } from 'react'
import { knownAuthors } from '../authors'
import {
  activeTheme,
  SCALE_MAX,
  SCALE_MIN,
  SCALE_STEP,
  updateSettings,
  useSettings,
  type Density,
  type Settings
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

type Tab = 'appearance' | 'colors' | 'authors'

export function SettingsWindow({ onClose, initialTab = 'appearance' }: { onClose: () => void; initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab)
  return (
    <Modal
      title="Settings"
      onClose={onClose}
      wide
      footer={
        <button className="btn primary" onClick={onClose}>
          Done
        </button>
      }
    >
      <div className="settings-tabs">
        {(
          [
            ['appearance', 'Appearance'],
            ['colors', 'Theme colors'],
            ['authors', 'Author colors']
          ] as const
        ).map(([id, label]) => (
          <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="settings-page">
        {tab === 'appearance' && <AppearanceTab />}
        {tab === 'colors' && <ColorsTab />}
        {tab === 'authors' && <AuthorsTab />}
      </div>
    </Modal>
  )
}

// ---------- appearance ----------

export function SizeControls() {
  const s = useSettings()
  return (
    <>
      <label className="field">
        <span className="field-label">
          Interface size <b>{Math.round(s.uiScale * 100)}%</b>
        </span>
        <div className="stepper">
          <button onClick={() => updateSettings({ uiScale: s.uiScale - SCALE_STEP })} aria-label="Smaller">
            A
          </button>
          <input
            type="range"
            min={SCALE_MIN}
            max={SCALE_MAX}
            step={SCALE_STEP}
            value={s.uiScale}
            onChange={(e) => updateSettings({ uiScale: Number(e.target.value) })}
          />
          <button className="big" onClick={() => updateSettings({ uiScale: s.uiScale + SCALE_STEP })} aria-label="Bigger">
            A
          </button>
        </div>
        <span className="hint">Scales every element and font. Shortcut: ⌘+ ⌘− ⌘0</span>
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
        />
      </div>
      <div className="field">
        <span className="field-label">Theme</span>
        <div className="theme-grid">
          {THEME_CHOICES.map((t) => (
            <ThemeCard key={t.id} id={t.id} name={t.name} hint={t.hint} />
          ))}
        </div>
      </div>
    </>
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

// ---------- theme colors ----------

const BASE_CHOICES = THEME_CHOICES.filter((t) => t.id !== 'custom') as { id: BaseThemeChoice; name: string }[]

function ColorsTab() {
  const s = useSettings()
  const isCustom = s.theme === 'custom'
  const shown = activeTheme(s).colors
  const base = resolveTheme(isCustom ? s.customBase : (s.theme as BaseThemeChoice)).colors

  // Editing any color switches to the Custom theme, starting from whatever theme was showing.
  const setColor = (key: ColorKey, value: string): void => {
    const patch: Partial<Settings> = isCustom
      ? { customColors: { ...s.customColors, [key]: value } }
      : { theme: 'custom', customBase: s.theme as BaseThemeChoice, customColors: { [key]: value } }
    updateSettings(patch)
  }
  const resetColor = (key: ColorKey): void => {
    const next = { ...s.customColors }
    delete next[key]
    updateSettings({ customColors: next })
  }

  return (
    <>
      <div className="form-row">
        <span className="field-label">Start from</span>
        <select
          value={isCustom ? s.customBase : (s.theme as BaseThemeChoice)}
          onChange={(e) =>
            isCustom
              ? updateSettings({ customBase: e.target.value as BaseThemeChoice })
              : updateSettings({ theme: e.target.value as ThemeChoice })
          }
        >
          {BASE_CHOICES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <span className="spacer" />
        {isCustom && Object.keys(s.customColors).length > 0 && (
          <button className="btn" onClick={() => updateSettings({ customColors: {} })}>
            Reset all
          </button>
        )}
      </div>
      <p className="hint">
        {isCustom ? 'Custom theme is active.' : 'Changing any color switches to the Custom theme.'}
      </p>
      {COLOR_ELEMENTS.map((g) => (
        <div key={g.group} className="color-group">
          <h4>{g.group}</h4>
          <div className="color-grid">
            {g.items.map(({ key, label }) => {
              const changed = isCustom && s.customColors[key] !== undefined && s.customColors[key] !== base[key]
              return (
                <label key={key} className={`color-item ${changed ? 'changed' : ''}`}>
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
    </>
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

  return (
    <>
      <label className="check">
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

      <datalist id="known-authors">
        {authors.map((a) => (
          <option key={a} value={a} />
        ))}
      </datalist>

      <div className={`author-list ${s.authorColorsEnabled ? '' : 'disabled'}`}>
        {s.authorColors.map((a, i) => (
          <div key={i} className="author-row">
            <input type="color" value={a.color} onChange={(e) => update(i, { color: e.target.value })} />
            <input
              list="known-authors"
              placeholder="Author name"
              value={a.name}
              onChange={(e) => update(i, { name: e.target.value })}
              spellCheck={false}
            />
            <span className="author-sample" style={{ '--author': a.color } as React.CSSProperties}>
              {a.name || 'Preview'}
            </span>
            <button
              className="icon-btn"
              aria-label="Remove"
              onClick={() => updateSettings({ authorColors: s.authorColors.filter((_, j) => j !== i) })}
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
          >
            Add all {missing.length} authors from this repository
          </button>
        )}
      </div>
    </>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: [T, string][]
  onChange: (v: T) => void
}) {
  return (
    <div className="segmented">
      {options.map(([v, label]) => (
        <button key={v} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  )
}
