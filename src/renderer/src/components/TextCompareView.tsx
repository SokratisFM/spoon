// A Text compare tab: two sides to paste or type into, and their diff below, updating as you go.
// A side that's JSON can be linted, pretty-printed or compacted; with "compare JSON by content" two
// valid JSON sides are compared formatted the same way, so only real changes show.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { DiffTarget } from '../../../shared/types'
import { readStored, usePersistentState } from '../hooks'
import * as storage from '../storage'
import { textClosed, textKey, type TextSides } from '../compare'
import { checkJson, formatJson, type JsonCheck } from '../json'
import { DiffView } from './DiffView'
import { Split } from './Split'

/** One side: its label, JSON status and tools, and the text. */
function Side({
  label,
  value,
  check,
  onChange
}: {
  label: string
  value: string
  check: JsonCheck
  onChange: (v: string) => void
}) {
  const area = useRef<HTMLTextAreaElement>(null)
  const goToError = (): void => {
    const el = area.current
    if (!el || !check.json || check.ok) return
    el.focus()
    el.setSelectionRange(check.pos, Math.min(check.pos + 1, value.length))
    const lineH = parseFloat(getComputedStyle(el).lineHeight) || 18
    el.scrollTop = Math.max(0, (check.line - 3) * lineH)
  }
  const valid = check.json && check.ok
  return (
    <div className="tc-side">
      <div className="tc-head">
        <b>{label}</b>
        {check.json && (check.ok ? <span className="tc-ok">JSON ✓</span> : <span className="tc-bad">JSON ✕</span>)}
        <span className="spacer" />
        {check.json && (
          <>
            <button className="mini-btn" disabled={!valid} onClick={() => onChange(formatJson(value, 'pretty'))}>
              Pretty
            </button>
            <button className="mini-btn" disabled={!valid} onClick={() => onChange(formatJson(value, 'compact'))}>
              Compact
            </button>
          </>
        )}
      </div>
      <textarea
        ref={area}
        className="tc-text"
        value={value}
        spellCheck={false}
        placeholder={`Paste or type the ${label === 'From' ? 'first' : 'second'} text here`}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
      />
      {check.json && !check.ok && (
        <div className="tc-error">
          <span className="error-text">
            {check.message} (line {check.line}, column {check.col})
          </span>{' '}
          <button className="link-btn" onClick={goToError}>
            Go to error
          </button>
        </div>
      )}
    </div>
  )
}

export function TextCompareView({ id }: { id: string }) {
  // What's typed is kept per tab; saved once typing pauses, not on every key.
  const [sides, setSides] = useState<TextSides>(() => readStored(textKey(id), { from: '', to: '' }))
  useEffect(() => {
    const t = setTimeout(() => !textClosed(id) && storage.setItem(textKey(id), JSON.stringify(sides)), 400)
    return () => clearTimeout(t)
  }, [id, sides])
  // …and right away when the tab closes or Spoon quits, so the last edit isn't lost.
  const latest = useRef(sides)
  latest.current = sides
  useEffect(() => {
    const save = (): void => void (!textClosed(id) && storage.setItem(textKey(id), JSON.stringify(latest.current)))
    window.addEventListener('beforeunload', save)
    return () => {
      save()
      window.removeEventListener('beforeunload', save)
    }
  }, [id])
  const [byContent, setByContent] = usePersistentState('spoon.compareText.byContent', true)

  const checks = useMemo(() => ({ from: checkJson(sides.from), to: checkJson(sides.to) }), [sides])
  const bothJson = checks.from.json && checks.from.ok && checks.to.json && checks.to.ok
  const anyJson = checks.from.json || checks.to.json
  const set = (side: keyof TextSides) => (v: string) => setSides((s) => ({ ...s, [side]: v }))
  // Both sides that are valid JSON; a side that isn't stays as it is.
  const formatBoth = (mode: 'pretty' | 'compact'): void => {
    const fmt = (t: string): string => {
      const c = checkJson(t)
      return c.json && c.ok ? formatJson(t, mode) : t
    }
    setSides((s) => ({ from: fmt(s.from), to: fmt(s.to) }))
  }

  // The diff follows the text a moment after typing stops.
  const [shown, setShown] = useState(sides)
  useEffect(() => {
    const t = setTimeout(() => setShown(sides), 250)
    return () => clearTimeout(t)
  }, [sides])
  const target = useMemo<DiffTarget>(() => {
    const json = checkJson(shown.from)
    const json2 = checkJson(shown.to)
    const asContent = byContent && json.json && json.ok && json2.json && json2.ok
    return {
      kind: 'text',
      left: asContent ? formatJson(shown.from, 'pretty') + '\n' : shown.from,
      right: asContent ? formatJson(shown.to, 'pretty') + '\n' : shown.to,
      file: { path: (json.json || json2.json ? 'text.json' : 'text.txt'), status: 'M' }
    }
  }, [shown, byContent])

  return (
    <div className="compare text-compare">
      <div className="compare-bar">
        <b>Text compare</b>
        <span className="spacer" />
        {anyJson && (
          <>
            <label className="check" title="Formats both sides the same way first, so spacing differences don't show">
              <input type="checkbox" checked={byContent} disabled={!bothJson} onChange={(e) => setByContent(e.target.checked)} />
              Compare JSON by content
            </label>
            <button className="btn" onClick={() => formatBoth('pretty')}>
              Pretty-print both
            </button>
            <button className="btn" onClick={() => formatBoth('compact')}>
              Compact both
            </button>
          </>
        )}
        <button className="btn" onClick={() => setSides((s) => ({ from: s.to, to: s.from }))}>
          ⇄ Swap
        </button>
        <button className="btn" disabled={!sides.from && !sides.to} onClick={() => setSides({ from: '', to: '' })}>
          Clear
        </button>
      </div>
      <Split id="text-compare" direction="column" mode="fraction" initial={0.45} min={0.15} max={0.85}>
        <div className="tc-sides">
          <Side label="From" value={sides.from} check={checks.from} onChange={set('from')} />
          <Side label="To" value={sides.to} check={checks.to} onChange={set('to')} />
        </div>
        {shown.from || shown.to ? (
          <DiffView path="/" target={target} />
        ) : (
          <div className="diff empty-state muted">Paste or type on both sides to see what’s different.</div>
        )}
      </Split>
    </div>
  )
}
