// A Compare tab: the diff of any two files, in the same diff view as everywhere else. It re-reads
// when either file changes on disk (checked every couple of seconds while the window is in front).
import { useEffect, useMemo, useState } from 'react'
import { confirm } from '../dialogs'
import { cleanError } from '../hooks'
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

  // Apply: when exactly one side is a file in a repository (the existing one), it can take the other
  // side's contents (the new one). git still has the old version, so it can be undone.
  const [repos, setRepos] = useState<[string | null, string | null] | null>(null)
  useEffect(() => {
    let live = true
    window.spoon.compareRepos(a, b).then((r) => live && setRepos(r), () => live && setRepos(null))
    return () => {
      live = false
    }
  }, [a, b])
  const existing = repos && !!repos[0] !== !!repos[1] ? (repos[0] ? 'a' : 'b') : null
  const [applyError, setApplyError] = useState<string | null>(null)
  const apply = async (): Promise<void> => {
    if (!existing) return
    const [to, from] = existing === 'a' ? [a, b] : [b, a]
    const repo = (existing === 'a' ? repos![0] : repos![1])!
    const ok = await confirm({
      message: `Replace ${fileName(to)} with the other file?`,
      detail: `${tildify(to, home)} (in ${fileName(repo)}) takes the contents of ${tildify(from, home)}. Its old version stays in git, so Discard in Local Changes can undo it.`,
      confirmLabel: 'Replace',
      risky: true
    })
    if (!ok) return
    setApplyError(null)
    try {
      await window.spoon.applyCompare(from, to)
      window.dispatchEvent(new Event('focus')) // re-read both sides now
    } catch (err) {
      setApplyError(cleanError(err))
    }
  }

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
        {applyError && <span className="error-text">{applyError}</span>}
        {existing && !missing.length && (
          <button
            className="btn primary compare-apply"
            onClick={() => void apply()}
            title={`Replace ${existing === 'a' ? a : b} (in the repository) with ${existing === 'a' ? b : a}`}
          >
            Apply to {fileName(existing === 'a' ? a : b)}
          </button>
        )}
      </div>
      <DiffView path={b.slice(0, b.lastIndexOf('/')) || '/'} target={target} nonce={stamps ? stamps.join(',') : ''} />
    </div>
  )
}
