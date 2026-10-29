// Compare…: files (two slots, each taking a dropped file or a click to choose one) or text (two
// boxes to paste into), opening a Compare or Text compare tab.
import { useState } from 'react'
import { tildify } from '../projects'
import { fileName } from '../compare'
import { usePersistentState } from '../hooks'
import { checkJson } from '../json'
import { Modal } from './Modal'

interface Props {
  home: string
  onCompare: (a: string, b: string) => void
  onCompareText: (from: string, to: string) => void
  onClose: () => void
}

export function CompareDialog({ home, onCompare, onCompareText, onClose }: Props) {
  const [mode, setMode] = usePersistentState<'files' | 'text'>('spoon.compare.mode', 'files')
  const [texts, setTexts] = useState({ from: '', to: '' })
  const [files, setFiles] = useState<[string | null, string | null]>([null, null])
  const [over, setOver] = useState<number | null>(null)
  const set = (i: number, p: string): void => setFiles((f) => (i === 0 ? [p, f[1]] : [f[0], p]))
  const ready = !!files[0] && !!files[1]
  const go = (): void => {
    if (mode === 'text') {
      onClose()
      onCompareText(texts.from, texts.to)
      return
    }
    if (!ready) return
    onClose()
    onCompare(files[0]!, files[1]!)
  }
  const textBox = (side: 'from' | 'to') => {
    const c = checkJson(texts[side])
    return (
      <label className="compare-text-box">
        <span className="tc-head">
          <b>{side === 'from' ? 'From' : 'To'}</b>
          {c.json && (c.ok ? <span className="tc-ok">JSON ✓</span> : <span className="tc-bad">JSON ✕</span>)}
        </span>
        <textarea
          className="tc-text"
          rows={7}
          spellCheck={false}
          value={texts[side]}
          placeholder="Paste or type here (or leave empty and fill it in the tab)"
          onChange={(e) => setTexts((t) => ({ ...t, [side]: e.target.value }))}
          onKeyDown={(e) => e.stopPropagation()}
        />
      </label>
    )
  }

  const slot = (i: number) => {
    const p = files[i]
    return (
      <button
        className={`compare-slot ${p ? 'full' : ''} ${over === i ? 'over' : ''}`}
        onClick={async () => {
          const picked = await window.spoon.pickFile(i === 0 ? 'Compare from…' : 'Compare with…')
          if (picked) set(i, picked)
        }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return
          e.preventDefault()
          e.stopPropagation()
          setOver(i)
        }}
        onDragLeave={() => setOver(null)}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOver(null)
          const dropped = [...e.dataTransfer.files].map((f) => window.spoon.pathForFile(f)).filter(Boolean)
          // Two files dropped on one slot fill both.
          if (dropped.length >= 2) setFiles([dropped[0], dropped[1]])
          else if (dropped[0]) set(i, dropped[0])
        }}
      >
        {p ? (
          <>
            <b>{fileName(p)}</b>
            <span className="muted">{tildify(p.slice(0, Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))), home)}</span>
          </>
        ) : (
          <>
            <b>Drop a file here</b>
            <span className="muted">or click to choose</span>
          </>
        )}
      </button>
    )
  }

  return (
    <Modal
      title="Compare"
      onClose={onClose}
      onSubmit={go}
      wide
      footer={
        <>
          {mode === 'files' && ready && (
            <button className="btn" style={{ marginRight: 'auto' }} onClick={() => setFiles([files[1], files[0]])}>
              ⇄ Swap
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={go} disabled={mode === 'files' && !ready}>
            {mode === 'text' && !texts.from && !texts.to ? 'Open text compare' : 'Compare'}
          </button>
        </>
      }
    >
      <div className="segmented compare-mode">
        {(
          [
            ['files', 'Files'],
            ['text', 'Text']
          ] as const
        ).map(([m, label]) => (
          <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
            {label}
          </button>
        ))}
      </div>
      {mode === 'files' ? (
        <div className="compare-slots">
          {slot(0)}
          {slot(1)}
        </div>
      ) : (
        <div className="compare-slots">
          {textBox('from')}
          {textBox('to')}
        </div>
      )}
    </Modal>
  )
}
