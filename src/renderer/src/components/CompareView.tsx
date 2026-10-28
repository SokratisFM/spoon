// A Compare tab: the diff of any two files, in the same diff view as everywhere else. It re-reads
// when either file changes on disk (checked every couple of seconds while the window is in front).
import { useEffect, useMemo, useState } from 'react'
import type { DiffTarget } from '../../../shared/types'
import { tildify } from '../projects'
import { fileName } from '../compare'
import { DiffView } from './DiffView'

interface Props {
  a: string
  b: string
  /** Swap the sides, or put another file on one side. */
  onChange: (a: string, b: string) => void
}

export function CompareView({ a, b, onChange }: Props) {
  const [home, setHome] = useState('')
  useEffect(() => {
    window.spoon.homeDir().then(setHome)
  }, [])
  const [stamps, setStamps] = useState<(number | null)[] | null>(null)
  useEffect(() => {
    let live = true
    const check = (): void => {
      if (document.hidden) return
      window.spoon.fileStamps([a, b]).then((s) => live && setStamps((old) => (JSON.stringify(old) === JSON.stringify(s) ? old : s)))
    }
    check()
    const timer = setInterval(check, 2000)
    window.addEventListener('focus', check)
    return () => {
      live = false
      clearInterval(timer)
      window.removeEventListener('focus', check)
    }
  }, [a, b])

  // The paths shown (and used to pick a language) leave out the folders both files share ("…/old/x.cs
  // → …/new/x.cs"), or read as ~/…; the diff runs on the real paths.
  const target = useMemo<DiffTarget>(() => {
    const [pa, pb] = [a.split('/'), b.split('/')]
    let same = 0
    while (same < Math.min(pa.length, pb.length) - 1 && pa[same] === pb[same]) same++
    const shown = (parts: string[], full: string): string => (same > 2 ? `…/${parts.slice(same).join('/')}` : tildify(full, home))
    return { kind: 'files', a, b, file: { path: shown(pb, b), oldPath: shown(pa, a), status: 'M' } }
  }, [a, b, home])
  const choose = async (side: 'a' | 'b'): Promise<void> => {
    const picked = await window.spoon.pickFile(`Compare ${side === 'a' ? 'from' : 'with'}…`)
    if (picked) onChange(side === 'a' ? picked : a, side === 'b' ? picked : b)
  }
  const missing = stamps ? [a, b].filter((_, i) => stamps[i] === null) : []

  return (
    <div className="compare">
      <div className="compare-bar">
        <button className="btn" onClick={() => choose('a')} title={`${a}\nClick to compare another file`}>
          <span className="muted">From</span> {fileName(a)}…
        </button>
        <button className="btn" onClick={() => onChange(b, a)} title="Swap the two sides">
          ⇄ Swap
        </button>
        <button className="btn" onClick={() => choose('b')} title={`${b}\nClick to compare with another file`}>
          <span className="muted">To</span> {fileName(b)}…
        </button>
        {missing.length > 0 && (
          <span className="error-text">{missing.map((p) => tildify(p, home)).join(' and ')} can’t be found.</span>
        )}
      </div>
      <DiffView path={b.slice(0, b.lastIndexOf('/')) || '/'} target={target} nonce={stamps ? stamps.join(',') : ''} />
    </div>
  )
}
