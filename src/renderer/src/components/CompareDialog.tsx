// Compare…: files (two slots, each taking a dropped file or a click to choose one) or text (two
// boxes to paste into), opening a Compare or Text compare tab; or two branches of the open
// repository, opening Compare Branches.
import { useEffect, useState } from 'react'
import type { CompareMode } from '../../../shared/types'
import { tildify } from '../projects'
import { defaultPair, fileName, requestBranchDiff, shortRef } from '../compare'
import { useAsync, usePersistentState } from '../hooks'
import { checkJson } from '../json'
import { Modal } from './Modal'
import { BranchPicker } from './BranchPicker'

interface Props {
  home: string
  /** The open repository, whose branches can be compared. */
  repo: string | null
  onCompare: (a: string, b: string) => void
  onCompareText: (from: string, to: string) => void
  onClose: () => void
}

export function CompareDialog({ home, repo, onCompare, onCompareText, onClose }: Props) {
  const [chosenMode, setMode] = usePersistentState<'files' | 'text' | 'branches'>('spoon.compare.mode', 'files')
  const mode = chosenMode === 'branches' && !repo ? 'files' : chosenMode
  const state = useAsync(() => (repo ? window.spoon.openRepo(repo) : Promise.resolve(null)), [repo])
  const refs = state.data?.refs ?? []
  const [branches, setBranches] = useState<{ base: string; compare: string } | null>(null)
  const [diffMode, setDiffMode] = usePersistentState<CompareMode>('spoon.branchDiff.mode', 'changes')
  useEffect(() => {
    if (!state.data || !repo || branches) return
    const names = refs.filter((r) => r.kind === 'head' || r.kind === 'remote').map((r) => r.fullName)
    const head = state.data.headBranch
    window.spoon
      .recentCheckouts(repo)
      .catch(() => [])
      .then((recent) => setBranches((b) => b ?? defaultPair(names, head, recent)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.data])
  const [texts, setTexts] = useState({ from: '', to: '' })
  const [files, setFiles] = useState<[string | null, string | null]>([null, null])
  const [over, setOver] = useState<number | null>(null)
  const set = (i: number, p: string): void => setFiles((f) => (i === 0 ? [p, f[1]] : [f[0], p]))
  const ready = !!files[0] && !!files[1]
  const go = (): void => {
    if (mode === 'branches') {
      if (!repo || !branches || branches.base === branches.compare) return
      onClose()
      requestBranchDiff({ path: repo, ...branches })
      return
    }
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

  const branchPicker = (side: 'base' | 'compare', label: string, hint: string) => (
    <label className="field">
      <span className="field-label">{label}</span>
      <BranchPicker
        refs={refs}
        value={branches?.[side] ?? ''}
        title={hint}
        onChange={(v) => setBranches((b) => (b ? { ...b, [side]: v } : { base: v, compare: v, [side]: v }))}
      />
    </label>
  )

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
          {mode === 'branches' && branches && (
            <button className="btn" style={{ marginRight: 'auto' }} onClick={() => setBranches({ base: branches.compare, compare: branches.base })}>
              ⇄ Swap
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={go} disabled={(mode === 'files' && !ready) || (mode === 'branches' && (!branches || branches.base === branches.compare))}>
            {mode === 'text' && !texts.from && !texts.to ? 'Open text compare' : 'Compare'}
          </button>
        </>
      }
    >
      <div className="segmented compare-mode">
        {(
          [
            ['files', 'Files'],
            ['text', 'Text'],
            ...(repo ? [['branches', 'Branches'] as const] : [])
          ] as const
        ).map(([m, label]) => (
          <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
            {label}
          </button>
        ))}
      </div>
      {mode === 'branches' ? (
        <div className="compare-branches">
          {state.error ? (
            <div className="error-text">{state.error}</div>
          ) : (
            <>
              <div className="compare-branch-picks">
                {branchPicker('base', 'Base', 'What the changes are compared against')}
                <span className="muted compare-branch-arrow">←</span>
                {branchPicker('compare', 'Compare', 'The branch whose changes are shown')}
              </div>
              <label className="check">
                <input type="radio" checked={diffMode === 'changes'} onChange={() => setDiffMode('changes')} />
                <span>
                  Only what {branches ? shortRef(branches.compare) : 'it'} changed <span className="muted">— like a pull request</span>
                </span>
              </label>
              <label className="check">
                <input type="radio" checked={diffMode === 'all'} onChange={() => setDiffMode('all')} />
                <span>
                  Every difference between the two <span className="muted">— including what {branches ? shortRef(branches.base) : 'the base'} changed since</span>
                </span>
              </label>
            </>
          )}
        </div>
      ) : mode === 'files' ? (
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
