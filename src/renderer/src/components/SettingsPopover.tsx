import { useEffect, useRef } from 'react'
import { SCALE_MAX, SCALE_MIN, SCALE_STEP, updateSettings, useSettings, type Density, type Theme } from '../settings'

export function SettingsPopover({ onClose }: { onClose: () => void }) {
  const s = useSettings()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node) && !(e.target as Element).closest('.titlebar-right')) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div className="popover settings" ref={ref}>
      <h3>Appearance</h3>

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
        <Segmented<Theme>
          value={s.theme}
          options={[
            ['system', 'System'],
            ['dark', 'Dark'],
            ['light', 'Light']
          ]}
          onChange={(theme) => updateSettings({ theme })}
        />
      </div>
    </div>
  )
}

function Segmented<T extends string>({
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
