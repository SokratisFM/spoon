// Compare Files…: two slots, each taking a dropped file or a click to choose one.
import { useState } from 'react'
import { tildify } from '../projects'
import { fileName } from '../compare'
import { Modal } from './Modal'

export function CompareDialog({ home, onCompare, onClose }: { home: string; onCompare: (a: string, b: string) => void; onClose: () => void }) {
  const [files, setFiles] = useState<[string | null, string | null]>([null, null])
  const [over, setOver] = useState<number | null>(null)
  const set = (i: number, p: string): void => setFiles((f) => (i === 0 ? [p, f[1]] : [f[0], p]))
  const ready = !!files[0] && !!files[1]
  const go = (): void => {
    if (!ready) return
    onClose()
    onCompare(files[0]!, files[1]!)
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
            <span className="muted">{tildify(p.slice(0, p.lastIndexOf('/')), home)}</span>
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
      title="Compare files"
      onClose={onClose}
      onSubmit={go}
      wide
      footer={
        <>
          {ready && (
            <button className="btn" style={{ marginRight: 'auto' }} onClick={() => setFiles([files[1], files[0]])}>
              ⇄ Swap
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={go} disabled={!ready}>
            Compare
          </button>
        </>
      }
    >
      <div className="compare-slots">
        {slot(0)}
        {slot(1)}
      </div>
    </Modal>
  )
}
