// A version as separate numbers (4 . 2 . 1), set from the keyboard: ←/→ pick a number, ↑/↓ raise or
// lower it (the numbers after it go back to 0, so 4.1.2 → 4.2.0), digits type one in, "." adds a part
// (up to four) and Backspace on an empty last part removes it. Clicking a number picks it too.
import { useEffect, useRef, useState } from 'react'
import { stepVersion, versionParts } from '../versionSteps'

interface Props {
  value: string
  onChange: (v: string) => void
  /** The part picked when it opens: the last by default (the patch number). */
  autoFocus?: boolean
}

export function VersionPicker({ value, onChange, autoFocus }: Props) {
  const parts = versionParts(value)
  const shown = parts.length ? parts : [0, 0, 0]
  const [at, setAt] = useState(shown.length - 1)
  // Digits typed in a row make one number ("1", "12"); moving or stepping starts a new one.
  const typing = useRef(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (autoFocus) box.current?.focus()
  }, [autoFocus])
  const active = Math.min(at, shown.length - 1)
  const set = (next: number[]): void => onChange(next.join('.'))

  const onKey = (e: React.KeyboardEvent): void => {
    const k = e.key
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      setAt(Math.max(0, Math.min(shown.length - 1, active + (k === 'ArrowLeft' ? -1 : 1))))
      typing.current = false
    } else if (k === 'ArrowUp' || k === 'ArrowDown') {
      set(stepVersion(shown, active, k === 'ArrowUp' ? 1 : -1))
      typing.current = false
    } else if (/^\d$/.test(k)) {
      const n = typing.current ? Number(`${shown[active]}${k}`) : Number(k)
      set(shown.map((p, j) => (j === active ? Math.min(n, 99999) : p)))
      typing.current = true
    } else if (k === '.') {
      // Typing "4.2" moves on to the next number, or adds one (4.2.1 → 4.2.1.0) at the end.
      if (active < shown.length - 1) setAt(active + 1)
      else if (shown.length < 4) {
        set([...shown, 0])
        setAt(shown.length)
      }
      typing.current = false
    } else if (k === 'Backspace') {
      if (typing.current && shown[active] >= 10) set(shown.map((p, j) => (j === active ? Math.floor(p / 10) : p)))
      else if (shown[active] !== 0) set(shown.map((p, j) => (j === active ? 0 : p)))
      else if (active === shown.length - 1 && shown.length > 2) {
        set(shown.slice(0, -1))
        setAt(active - 1)
      }
    } else if (k === 'Home' || k === 'End') {
      setAt(k === 'Home' ? 0 : shown.length - 1)
      typing.current = false
    } else return
    e.preventDefault()
    e.stopPropagation()
  }

  return (
    <div
      ref={box}
      className="version-picker mono"
      tabIndex={0}
      role="spinbutton"
      aria-valuetext={shown.join('.')}
      aria-label="Version: ←/→ pick a number, ↑/↓ change it"
      onKeyDown={onKey}
      onBlur={() => (typing.current = false)}
    >
      {shown.map((p, i) => (
        <span key={i} className="vp-part-wrap">
          {i > 0 && <span className="vp-dot">.</span>}
          <span
            className={`vp-part ${i === active ? 'on' : ''}`}
            onMouseDown={(e) => {
              e.preventDefault()
              box.current?.focus()
              setAt(i)
              typing.current = false
            }}
            onWheel={(e) => {
              setAt(i)
              set(stepVersion(shown, i, e.deltaY < 0 ? 1 : -1))
            }}
          >
            {p}
          </span>
        </span>
      ))}
    </div>
  )
}
