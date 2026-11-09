// Compare…: files (two slots, each taking a dropped file or a click to choose one) or text (two
// boxes to paste into), opening a Compare or Text compare tab; or two branches of the open
// repository, opening Compare Branches. With a repository open, a file you choose gets its twin from
// the repository put beside it (the repository's copy on the right, as the current one), and either
// side can be filled by searching the repository's files.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CompareCandidate, CompareCandidates, CompareMode } from '../../../shared/types'
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
  // What a side shows instead of its folder (a last committed version lives in a temporary folder).
  const [notes, setNotes] = useState<[string | null, string | null]>([null, null])
  const [over, setOver] = useState<number | null>(null)
  const set = (i: number, p: string | null, note: string | null = null): void => {
    setFiles((f) => (i === 0 ? [p, f[1]] : [f[0], p]))
    setNotes((n) => (i === 0 ? [note, n[1]] : [n[0], note]))
  }
  const swap = (): void => {
    setFiles((f) => [f[1], f[0]])
    setNotes((n) => [n[1], n[0]])
    setSuggest((s) => (s ? { ...s, side: s.side === 0 ? 1 : 0 } : s))
    setSearch((s) => (s ? { ...s, side: s.side === 0 ? 1 : 0 } : s))
  }
  const ready = !!files[0] && !!files[1]
  const repoName = repo ? fileName(repo) : ''

  // The repository's files that could go beside the chosen one, and which side they go on.
  const [suggest, setSuggest] = useState<{ name: string; side: 0 | 1; data: CompareCandidates; picked: number } | null>(null)
  const [search, setSearch] = useState<{ side: 0 | 1; query: string } | null>(null)
  const asked = useRef(0)
  const putCandidate = async (side: 0 | 1, c: CompareCandidate): Promise<void> => {
    if (!c.commit) return set(side, c.path)
    const temp = await window.spoon.fileAtCommitToTemp(c.commit.repo, c.commit.hash, c.commit.rel).catch(() => null)
    if (temp) set(side, temp, `Last commit · ${c.commit.hash.slice(0, 7)}`)
  }
  /** A file you dropped or picked: with the other side empty, its twin from the repository goes there. */
  const choose = async (i: number, p: string): Promise<void> => {
    set(i, p)
    setSuggest(null)
    setSearch(null)
    const other: 0 | 1 = i === 0 ? 1 : 0
    if (!repo || files[other]) return
    const id = ++asked.current
    const found = await window.spoon.compareCandidates(repo, p).catch(() => null)
    if (!found || id !== asked.current) return
    // Your file stays on the side you put it; what's found goes on the other.
    const theirSide: 0 | 1 = other
    if (!found.candidates.length) {
      if (!found.inRepo) setSearch({ side: theirSide, query: fileName(p).replace(/\.[^.]+$/, '') })
      return
    }
    setSuggest({ name: fileName(p), side: theirSide, data: found, picked: 0 })
    await putCandidate(theirSide, found.candidates[0])
  }
  // The side holding what was found (until you put something else there yourself).
  const foundSide = suggest && suggest.picked >= 0 ? suggest.side : null
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
        className={`compare-slot ${p ? 'full' : ''} ${over === i ? 'over' : ''} ${foundSide === i && p ? 'found' : ''}`}
        onClick={async () => {
          const picked = await window.spoon.pickFile(i === 0 ? 'Compare from…' : 'Compare with…')
          if (picked) void choose(i, picked)
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
          if (dropped.length >= 2) {
            setFiles([dropped[0], dropped[1]])
            setNotes([null, null])
            setSuggest(null)
            setSearch(null)
          } else if (dropped[0]) void choose(i, dropped[0])
        }}
      >
        {p ? (
          <>
            <b>{notes[i] ? fileName(p).replace(/^[0-9a-f]{7}-/, '') : fileName(p)}</b>
            <span className="muted">{notes[i] ?? tildify(p.slice(0, Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))), home)}</span>
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
        <>
          <div className={`compare-slots files ${foundSide !== null ? 'captioned' : ''}`}>
            {[0, 1].map((i) => (
              <div key={i} className="compare-side">
                {foundSide !== null &&
                  (foundSide === i ? (
                    <span className="compare-caption found">✦ Found in {repoName}</span>
                  ) : (
                    <span className="compare-caption">Your file</span>
                  ))}
                {slot(i)}
                {suggest && foundSide === i && !search ? (
                  <div className="compare-suggest">
                    <div className="cs-head">
                      <span>
                        {suggest.data.total} file{suggest.data.total === 1 ? '' : 's'} named {suggest.name}
                      </span>
                      <button className="link-btn" onClick={() => setSearch({ side: suggest.side, query: '' })}>
                        Find another…
                      </button>
                    </div>
                    <div className="cs-results">
                      {suggest.data.candidates.map((c, n) => (
                        <button
                          key={c.commit ? 'commit' : c.path}
                          className={`cs-row ${n === suggest.picked ? 'on' : ''}`}
                          onClick={() => {
                            setSuggest({ ...suggest, picked: n })
                            void putCandidate(suggest.side, c)
                          }}
                          title={c.shown}
                        >
                          <span className="cs-path">
                            <bdi>{c.commit ? `Last commit · ${c.commit.hash.slice(0, 7)}` : c.shown.slice(0, c.shown.lastIndexOf('/') + 1) || './'}</bdi>
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  repo && (
                    <button
                      className={`link-btn compare-find ${search?.side === i ? 'on' : ''}`}
                      onClick={() => setSearch(search?.side === i ? null : { side: i as 0 | 1, query: '' })}
                    >
                      Find in {repoName}…
                    </button>
                  )
                )}
              </div>
            ))}
            <button className="compare-swap" onClick={swap} disabled={!files[0] && !files[1]} title="Swap sides" aria-label="Swap sides">
              ⇄
            </button>
          </div>
          {repo && search && (
            <RepoFileSearch
              repo={repo}
              side={search.side}
              query={search.query}
              onQuery={(q) => setSearch({ ...search, query: q })}
              onPick={(rel) => {
                set(search.side, `${repo.replace(/[\\/]$/, '')}/${rel}`)
                setSuggest((s) => (s && s.side === search.side ? { ...s, picked: -1 } : s))
                setSearch(null)
              }}
              onClose={() => setSearch(null)}
            />
          )}
        </>
      ) : (
        <div className="compare-slots">
          {textBox('from')}
          {textBox('to')}
        </div>
      )}
    </Modal>
  )
}

/** Searching the repository's files (its submodules' too) by words in their paths. */
function RepoFileSearch({
  repo,
  side,
  query,
  onQuery,
  onPick,
  onClose
}: {
  repo: string
  side: 0 | 1
  query: string
  onQuery: (q: string) => void
  onPick: (rel: string) => void
  onClose: () => void
}) {
  const { data: all, error } = useAsync(() => window.spoon.projectFiles(repo), [repo])
  const [active, setActive] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const hits = useMemo(() => {
    if (!all || !words.length) return []
    const metas = words.some((w) => w.includes('meta'))
    const found: { rel: string; rank: number }[] = []
    for (const rel of all) {
      const low = rel.toLowerCase()
      if (!metas && low.endsWith('.meta')) continue
      if (!words.every((w) => low.includes(w))) continue
      const name = low.slice(low.lastIndexOf('/') + 1)
      // Words in the file's name count most, then shorter paths.
      const rank = words.filter((w) => name.includes(w)).length * 1000 - rel.length
      found.push({ rel, rank })
    }
    return found.sort((a, b) => b.rank - a.rank).slice(0, 50)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, query])
  useEffect(() => setActive(0), [query])
  useEffect(() => {
    list.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest' })
  }, [active])
  const mark = (rel: string): React.ReactNode => {
    if (!words.length) return rel
    const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'ig')
    return rel.split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part))
  }
  return (
    <div className="compare-suggest">
      <div className="cs-head">
        <span>
          {side === 0 ? 'Left' : 'Right'} side: find a file in {fileName(repo)}
          {all && words.length ? ` · ${hits.length === 50 ? '50+' : hits.length} of ${all.length.toLocaleString()}` : ''}
        </span>
        <button className="link-btn" onClick={onClose}>
          Close
        </button>
      </div>
      <input
        className="cs-search"
        autoFocus
        value={query}
        placeholder="Words from the file’s name or folder, e.g. manifest android"
        spellCheck={false}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => Math.max(0, Math.min(hits.length - 1, a + (e.key === 'ArrowDown' ? 1 : -1))))
          } else if (e.key === 'Enter') {
            if (hits[active]) onPick(hits[active].rel)
          } else if (e.key === 'Escape') onClose()
          else return
          e.stopPropagation()
        }}
      />
      {error && <div className="error-text">{error}</div>}
      <div className="cs-results" ref={list}>
        {!all && !error && <div className="cs-empty">Reading the file list…</div>}
        {all && words.length > 0 && !hits.length && <div className="cs-empty">Nothing matches.</div>}
        {hits.map((h, n) => (
          <button key={h.rel} className={`cs-row ${n === active ? 'on' : ''}`} onMouseEnter={() => setActive(n)} onClick={() => onPick(h.rel)} title={h.rel}>
            <span className="cs-path"><bdi>{mark(h.rel)}</bdi></span>
          </button>
        ))}
      </div>
    </div>
  )
}
