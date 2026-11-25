// A Compare tab: the diff of any two files, in the same diff view as everywhere else. It re-reads
// when either file changes on disk (checked every couple of seconds while the window is in front).
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { confirm } from '../dialogs'
import { cleanError } from '../hooks'
import type { CompareFileInfo, DiffTarget } from '../../../shared/types'
import { tildify } from '../projects'
import { fileName } from '../compare'
import { DiffView } from './DiffView'
import { BranchIcon } from './Icons'
import { useSettings } from '../settings'
import { timeAgo } from '../simpleMode'

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
      detail: `${tildify(to, home)} (in ${fileName(repo)}) takes the contents of ${tildify(from, home)}. If git has it unchanged, Discard in Local Changes undoes this; otherwise (uncommitted edits, an untracked or ignored file) its current version goes to the Trash first.`,
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

  // What each side's header card says: the repository and the commit that last changed it, or when
  // it was saved. Read again whenever either file changes (Apply, a save in an editor).
  const [infos, setInfos] = useState<[CompareFileInfo | null, CompareFileInfo | null]>([null, null])
  const stampKey = stamps ? stamps.join(',') : ''
  useEffect(() => {
    let live = true
    Promise.all([a, b].map((p) => window.spoon.compareFileInfo(p).catch(() => null))).then(
      ([x, y]) => live && setInfos([x, y])
    )
    return () => {
      live = false
    }
  }, [a, b, stampKey])
  const hashLength = useSettings().hashLength

  const card = (side: 'a' | 'b'): ReactNode => {
    const file = side === 'a' ? a : b
    const info = infos[side === 'a' ? 0 : 1]
    const gone = stamps?.[side === 'a' ? 0 : 1] === null
    // The folder, its end kept: a long path outside a repository shows its last few folders.
    const outside = tildify(file.slice(0, file.lastIndexOf('/') + 1), home).split('/')
    const folder = info?.rel
      ? info.rel.slice(0, info.rel.lastIndexOf('/') + 1) || './'
      : outside.length > 6
        ? `…/${outside.slice(-5).join('/')}`
        : outside.join('/')
    const state =
      info?.state === 'modified'
        ? 'has uncommitted changes'
        : info?.state === 'untracked'
          ? 'not tracked by git'
          : info?.state === 'ignored'
            ? 'ignored by git'
            : null
    return (
      <div className={`compare-card ${info?.repo ? 'in-repo' : ''}`}>
        <div className="compare-card-title">
          {info?.repo ? (
            <span className="compare-pill from-repo" title={info.repo}>
              <BranchIcon /> {fileName(info.repo)}
              {info.branch ? ` · ${info.branch}` : ' · detached'}
            </span>
          ) : (
            <span className="compare-pill">{info ? 'Not in a repository' : '…'}</span>
          )}
          <b className="compare-card-name" title={file}>
            {fileName(file)}
          </b>
          <button className="link-btn" onClick={() => void choose(side)} title={`${file}\nCompare another file on this side`}>
            Change…
          </button>
        </div>
        <div className="compare-card-path mono" title={file}>
          {folder}
        </div>
        <div className="compare-card-meta">
          {gone ? (
            <span className="error-text">Can’t be found.</span>
          ) : info?.repo ? (
            <>
              {info.last ? (
                <span title={`${info.last.hash}\n${info.last.subject}\n${info.last.author}, ${new Date(info.last.date * 1000).toLocaleString()}`}>
                  Last changed {timeAgo(info.last.date)} in <span className="mono">{info.last.hash.slice(0, hashLength)}</span> “{info.last.subject}” · {info.last.author}
                </span>
              ) : (
                <span>Never committed</span>
              )}
              {state && <span className="compare-state"> · {state}</span>}
            </>
          ) : info?.mtime ? (
            <span>Saved {timeAgo(info.mtime / 1000)}</span>
          ) : null}
        </div>
      </div>
    )
  }

  const applyTo = existing ? fileName(existing === 'a' ? a : b) : ''
  return (
    <div className="compare">
      <div className="compare-cards">
        {card('a')}
        {card('b')}
      </div>
      <DiffView
        path={b.slice(0, b.lastIndexOf('/')) || '/'}
        target={target}
        nonce={stampKey}
        headerLead={
          <>
            <button className="btn small" onClick={() => onChange(b, a)} title="Swap the two sides">
              ⇄ Swap
            </button>
            {existing && !missing.length && (
              <button
                className="btn small primary"
                onClick={() => void apply()}
                title={`Replace ${existing === 'a' ? a : b} (in the repository) with ${existing === 'a' ? b : a}`}
              >
                {existing === 'a' ? `← Apply to ${applyTo}` : `Apply to ${applyTo} →`}
              </button>
            )}
            {applyError && <span className="error-text">{applyError}</span>}
          </>
        }
      />
    </div>
  )
}
