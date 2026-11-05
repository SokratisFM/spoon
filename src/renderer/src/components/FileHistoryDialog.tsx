// A file's history: the commits that changed it on the left (following renames), and what the picked
// one did to it on the right, as a diff or as the whole file then. From there: show the commit in the
// history, compare that version with the working copy, or put it back.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { FileHistoryEntry, Ref } from '../../../shared/types'
import { cleanError, useAsync, usePersistentState } from '../hooks'
import { codeLineHeight, useSettings } from '../settings'
import { paletteVars } from '../syntax'
import { splitPath } from '../format'
import { timeAgo } from '../simpleMode'
import { requestCompare } from '../compare'
import { snapshots } from '../repoCache'
import { confirm } from '../dialogs'
import type { Ops } from './RepoView'
import { Modal } from './Modal'
import { Split } from './Split'
import { CodeText, DiffView, useLineLooks, type Line, type Parsed } from './DiffView'

export interface FileHistoryRequest {
  repo: string
  /** The file as it's named now (or in the commit it was picked from). */
  file: string
}

/** Opens a file's history from anywhere; the repository's view shows it. */
export function requestFileHistory(req: FileHistoryRequest): void {
  window.dispatchEvent(new CustomEvent<FileHistoryRequest>('spoon:file-history', { detail: req }))
}

/** Asks the visible list (Local Changes, a commit's files) for its selected file's history (⌥⌘L). */
export const SELECTED_FILE_HISTORY = 'spoon:selected-file-history'

/** In RepoView: shows the history for requests about this repository. */
export function FileHistoryHost({ path, ops, onJump }: { path: string; ops: Ops; onJump: (hash: string) => void }) {
  const [req, setReq] = useState<FileHistoryRequest | null>(null)
  useEffect(() => {
    const on = (e: Event): void => {
      const d = (e as CustomEvent<FileHistoryRequest>).detail
      if (d.repo === path) setReq(d)
    }
    window.addEventListener('spoon:file-history', on)
    return () => window.removeEventListener('spoon:file-history', on)
  }, [path])
  return req ? <FileHistoryDialog key={req.file} req={req} ops={ops} onJump={onJump} onClose={() => setReq(null)} /> : null
}

function FileHistoryDialog({ req, ops, onJump, onClose }: { req: FileHistoryRequest; ops: Ops; onJump: (hash: string) => void; onClose: () => void }) {
  const { repo, file } = req
  const settings = useSettings()
  const [follow, setFollow] = usePersistentState('spoon.fileHistory.follow', true)
  const [show, setShow] = usePersistentState<'changes' | 'file'>('spoon.fileHistory.show', 'changes')
  const history = useAsync(() => window.spoon.fileHistory(repo, file, follow), [repo, file, follow])
  const [filter, setFilter] = useState('')
  const entries = useMemo(() => {
    const words = filter.toLowerCase().split(/\s+/).filter(Boolean)
    return (history.data ?? []).filter((e) => words.every((w) => `${e.subject} ${e.author} ${e.hash}`.toLowerCase().includes(w)))
  }, [history.data, filter])
  const [picked, setPicked] = useState<string | null>(null)
  const entry = entries.find((e) => e.hash === picked) ?? entries[0] ?? null
  // Branch and tag names on the commits that are their tips.
  const refs = useMemo(() => {
    const byHash = new Map<string, Ref[]>()
    for (const r of snapshots.get(repo)?.repo?.refs ?? []) if (r.kind !== 'stash') byHash.set(r.target, [...(byHash.get(r.target) ?? []), r])
    return byHash
  }, [repo])

  // ↑/↓ in the list move the pick.
  const list = useRef<HTMLDivElement>(null)
  const move = (by: number): void => {
    const i = entries.findIndex((e) => e.hash === entry?.hash)
    const next = entries[Math.max(0, Math.min(entries.length - 1, i + by))]
    if (!next) return
    setPicked(next.hash)
    list.current?.querySelector(`[data-hash="${next.hash}"]`)?.scrollIntoView({ block: 'nearest' })
  }

  // The version a commit has of the file: for one that deleted it, the version just before.
  const versionOf = (e: FileHistoryEntry): string | null => (e.file.status === 'D' ? (e.parents[0] ?? null) : e.hash)
  const compareWorking = async (e: FileHistoryEntry): Promise<void> => {
    const at = versionOf(e)
    if (!at) return
    try {
      requestCompare(await window.spoon.fileAtCommitToTemp(repo, at, e.file.oldPath && e.file.status === 'D' ? e.file.oldPath : e.file.path), `${repo}/${file}`)
    } catch (err) {
      await confirm({ message: `Couldn’t compare ${splitPath(file).name}`, detail: cleanError(err), confirmLabel: 'OK' })
    }
  }
  const restore = async (e: FileHistoryEntry): Promise<void> => {
    const at = versionOf(e)
    if (!at) return
    const short = at.slice(0, 7)
    const ok = await confirm({
      message: `Put the ${short} version of ${splitPath(file).name} in your working copy?`,
      detail: `${e.file.status === 'D' ? `That's the version just before ${e.hash.slice(0, 7)} deleted it. ` : ''}The file's current contents are replaced. It shows up in Local Changes; uncommitted changes to it go to the Trash first, so you can get them back.`,
      confirmLabel: 'Restore',
      risky: true
    })
    if (ok) ops.run(`Restoring ${file}…`, () => window.spoon.restoreFileFrom(repo, at, file, e.file.path), 'Couldn’t restore the file')
  }

  const { dir, name } = splitPath(file)
  const count = history.data?.length ?? 0
  return (
    <div className="branch-diff-modal file-history">
      <Modal
        title={`History of ${name}`}
        titleExtra={
          <span className="bd-summary muted">
            {dir.replace(/\/$/, '') || '(top folder)'}
            {history.data && ` · ${count === 5000 ? 'latest 5,000' : count} commit${count === 1 ? '' : 's'}`}
          </span>
        }
        onClose={onClose}
        wide
        footer={
          <button className="btn primary" onClick={onClose}>
            Close
          </button>
        }
      >
        <div className="bd-bar">
          <label className="check" title="Also list the commits from before the file was renamed or moved">
            <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow renames
          </label>
          <span className="spacer" />
          <span className="segmented bd-mode">
            <button className={show === 'changes' ? 'on' : ''} onClick={() => setShow('changes')}>
              Changes
            </button>
            <button className={show === 'file' ? 'on' : ''} onClick={() => setShow('file')}>
              Whole file
            </button>
          </span>
        </div>
        <div className="bd-body">
          {history.error ? (
            <div className="empty-state small error-text">{history.error}</div>
          ) : !history.data ? (
            <div className="empty-state small muted">Reading the history…</div>
          ) : !history.data.length ? (
            <div className="empty-state muted">No commit has this file yet.</div>
          ) : (
            <Split id="file-history" direction="row" mode="rem" initial={20} min={12} max={40}>
              <div className="bd-files">
                <div className="bd-files-head">
                  <input
                    className="bd-filter"
                    placeholder="Filter by message or author"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    data-own-escape={filter ? '' : undefined}
                    onKeyDown={(e) => {
                      e.stopPropagation()
                      if (e.key === 'Escape' && filter) setFilter('')
                      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                        e.preventDefault()
                        move(e.key === 'ArrowDown' ? 1 : -1)
                      }
                    }}
                  />
                </div>
                <div
                  className="fh-list"
                  ref={list}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
                    e.preventDefault()
                    move(e.key === 'ArrowDown' ? 1 : -1)
                  }}
                >
                  {!entries.length && <p className="muted fh-none">No commits match.</p>}
                  {entries.map((e) => (
                    <button key={e.hash} data-hash={e.hash} className={`fh-commit ${e.hash === entry?.hash ? 'on' : ''}`} onClick={() => setPicked(e.hash)}>
                      <span className="fh-subject">{e.subject}</span>
                      <span className="fh-stats mono">
                        {e.file.status === 'R' && e.added === 0 && e.removed === 0 ? (
                          <span className="muted">renamed</span>
                        ) : e.added === null ? (
                          <span className="muted">binary</span>
                        ) : (
                          <>
                            <span className="plus">+{e.added}</span> <span className="minus">−{e.removed}</span>
                          </>
                        )}
                      </span>
                      <span className="muted fh-meta">
                        {e.author} · {timeAgo(e.time)}
                      </span>
                      <span className="fh-tags">
                        {e.file.status === 'R' && e.file.oldPath && <span className="muted">from {e.file.oldPath}</span>}
                        {e.file.status === 'A' && <span className="muted">added</span>}
                        {e.file.status === 'D' && <span className="minus">deleted</span>}
                      </span>
                      {/* Branches and tags on their own line, so the message and author keep their room. */}
                      {!!refs.get(e.hash)?.length && (
                        <span className="fh-refs">
                          {refs.get(e.hash)!.map((r) => (
                            <span key={r.fullName} className={`ref-badge ${r.kind}`} title={r.name}>
                              {r.name}
                            </span>
                          ))}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
              <div className="fh-right">
                {entry && (
                  <>
                    <div className="fh-head">
                      <span className="mono muted">{entry.hash.slice(0, 7)}</span>
                      <span className="fh-head-subject" title={entry.subject}>
                        {entry.subject}
                      </span>
                      <span className="spacer" />
                      <button
                        className="btn"
                        onClick={() => {
                          onClose()
                          onJump(entry.hash)
                        }}
                      >
                        Show in History
                      </button>
                      <button className="btn" onClick={() => compareWorking(entry)} disabled={!versionOf(entry)}>
                        Compare with Working Copy
                      </button>
                      <button className="btn" onClick={() => restore(entry)} disabled={!versionOf(entry)}>
                        Restore This Version…
                      </button>
                    </div>
                    {show === 'changes' ? (
                      <DiffView path={repo} target={{ kind: 'commit', hash: entry.hash, file: entry.file }} />
                    ) : (
                      <WholeFile repo={repo} entry={entry} lineH={codeLineHeight(settings)} />
                    )}
                  </>
                )}
              </div>
            </Split>
          )}
        </div>
      </Modal>
    </div>
  )
}

/** The file as it was in a commit (or just before, for the commit that deleted it), with line numbers and colors. */
function WholeFile({ repo, entry, lineH }: { repo: string; entry: FileHistoryEntry; lineH: number }) {
  const settings = useSettings()
  const loaded = useAsync(() => window.spoon.diffFile(repo, { kind: 'commit', hash: entry.hash, file: entry.file }), [repo, entry.hash, entry.file.path])
  const parsed = useMemo<Parsed | null>(() => {
    if (!loaded.data) return null
    const text = loaded.data.text.replace(/\n$/, '')
    const lines: Line[] = text.split('\n').map((t, i) => ({ kind: 'ctx', text: t.replace(/\t/g, '    '), oldNo: i + 1, newNo: i + 1 }))
    return { lines, added: 0, removed: 0, maxLen: lines.reduce((m, l) => Math.max(m, l.text.length), 0) }
  }, [loaded.data])
  const { look } = useLineLooks(parsed, entry.file.path)
  const box = useRef<HTMLDivElement>(null)
  const rows = useVirtualizer({ count: parsed?.lines.length ?? 0, getScrollElement: () => box.current, estimateSize: () => lineH, overscan: 30 })
  if (loaded.error) return <div className="empty-state small error-text">{loaded.error}</div>
  if (!loaded.data) return <div className="empty-state small muted">{loaded.loading ? 'Loading…' : 'This version is too big to show.'}</div>
  if (/\0/.test(loaded.data.text.slice(0, 8000))) return <div className="empty-state small muted">Binary file.</div>
  return (
    <div className="diff fh-file" style={paletteVars(settings.syntaxPalette, settings.syntaxIdeBackground)}>
      {loaded.data.side === 'old' && <div className="list-footnote">This commit deleted the file; this is its last version.</div>}
      <div className="diff-scroll" ref={box}>
        <div className={`diff-lines syntax-${settings.diffSyntax}`} style={{ height: rows.getTotalSize(), minWidth: `calc(${(parsed?.maxLen ?? 0) + 2}ch + 6em)` }}>
          {rows.getVirtualItems().map((v) => {
            const l = parsed!.lines[v.index]
            const lk = look(v.index)
            return (
              <div key={v.index} className="diff-line ctx" style={{ transform: `translateY(${v.start}px)`, height: lineH, lineHeight: `${lineH}px` }}>
                <span className="ln">{l.newNo}</span>
                <span className="code">
                  <CodeText text={l.text} tokens={lk.tokens} faded={lk.faded} />
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
