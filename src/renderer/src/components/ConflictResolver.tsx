// Resolving a conflicted file in Local Changes (after a merge, rebase, cherry-pick or a stash that didn't
// go back cleanly): each conflict shows both sides next to each other, and is resolved by using one,
// both (in either order) or text of your own. Save writes the file and marks it resolved.
// Mounted with the file as its key, so another file starts afresh.
import { useEffect, useMemo, useState } from 'react'
import type { FileContent } from '../../../shared/types'
import { chosenLines, hasMarkers, parseConflicts, resolveText, show, type Choice, type Conflict } from '../conflicts'
import { confirm } from '../dialogs'
import { cleanError } from '../hooks'
import { openFileEditor } from './FileEditor'

interface Props {
  path: string
  file: string
  /** What the two sides are called here ("Your Branch’s Version", "the Upstream Version"…). */
  sides: { ours: string; theirs: string }
  /** Changes when the working copy may have changed on disk. */
  nonce: number
  /** Show the plain diff instead. */
  onShowDiff: () => void
  /** Keep one side of the whole file (the existing right-click action). */
  onKeepSide: (side: 'ours' | 'theirs') => void
  /** Runs an operation with Spoon's progress and error handling; resolves to whether it worked. */
  run: (label: string, fn: () => Promise<unknown>, failTitle: string) => Promise<boolean>
}

const CONTEXT = 3
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

export function ConflictResolver({ path, file, sides, nonce, onShowDiff, onKeepSide, run }: Props) {
  const [content, setContent] = useState<FileContent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [choices, setChoices] = useState<(Choice | null)[]>([])
  const [editing, setEditing] = useState<{ n: number; text: string } | null>(null)
  const [open, setOpen] = useState<Set<number>>(new Set())

  const touched = choices.some(Boolean)
  useEffect(() => {
    // A reload while you're choosing would throw your choices away: only when nothing is chosen yet.
    if (touched && content) return
    let live = true
    window.spoon.readWorkingFile(path, file).then(
      (c) => live && (setContent(c), setError(null)),
      (err) => live && setError(cleanError(err))
    )
    return () => void (live = false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, file, nonce])

  const segments = useMemo(() => (content?.text != null ? parseConflicts(content.text) : null), [content])
  const conflicts = (segments ?? []).filter((s): s is Conflict => s.kind === 'conflict')
  const resolved = conflicts.filter((_, i) => choices[i]).length
  const choose = (n: number, c: Choice | null): void => {
    setChoices((old) => {
      const next = [...old]
      next[n] = c
      return next
    })
    setEditing(null)
  }

  const save = async (): Promise<void> => {
    if (!segments || !content) return
    const text = resolveText(segments, choices)
    // Lines in the file that only look like markers (a doc about git, a test fixture): yours to say.
    const force =
      hasMarkers(text) &&
      (await confirm({
        message: `${file.split('/').pop()} still has lines that look like conflict markers`,
        detail: 'Lines starting with <<<<<<< or >>>>>>> are left in what you chose. If they belong in the file, mark it resolved anyway; otherwise edit those conflicts first.',
        confirmLabel: 'Mark Resolved Anyway'
      }))
    if (hasMarkers(text) && !force) return
    void run(
      `Resolving ${file.split('/').pop()}…`,
      async () => {
        // Written as is: every line keeps its own ending (not converted to the file's usual one).
        await window.spoon.writeWorkingFile(path, file, text, 'lf', content.mtime)
        await window.spoon.markResolved(path, [file], force)
      },
      'Couldn’t save the resolved file'
    ).then((ok) => ok && setChoices([]))
  }

  if (error) return <div className="resolver empty-state error-text">{error}</div>
  if (!content) return <div className="resolver empty-state muted">Loading…</div>
  // Nothing Spoon can take apart: a binary file, another encoding, or markers it can't read.
  if (!segments) {
    const why = content.binary
      ? 'It’s a binary file, so it can’t be merged line by line.'
      : content.text === null
        ? 'It isn’t UTF-8 text (or is too big), so it can’t be edited here.'
        : 'Spoon can’t tell its conflicts apart for sure: the markers may have been edited, one side deleted the file, or a line of ======= in the text itself makes the split between the sides a guess.'
    return (
      <div className="resolver resolver-plain">
        <p>
          <b>{file}</b> is in conflict. {why}
        </p>
        <div className="resolver-plain-actions">
          <button className="btn" onClick={() => onKeepSide('ours')}>
            Keep {sides.ours}
          </button>
          <button className="btn" onClick={() => onKeepSide('theirs')}>
            Keep {sides.theirs}
          </button>
          {content.text !== null && (
            <button className="btn" onClick={() => openFileEditor({ repo: path, file })}>
              Open in Editor
            </button>
          )}
          <button className="btn" onClick={onShowDiff}>
            Show Diff
          </button>
        </div>
      </div>
    )
  }

  let n = -1
  return (
    <div className="resolver">
      <div className="resolver-head">
        <span className="resolver-file mono" title={file}>
          {file.split('/').pop()}
        </span>
        <span className={`resolver-count ${resolved === conflicts.length ? 'done' : ''}`}>
          {resolved} of {conflicts.length} {conflicts.length === 1 ? 'conflict' : 'conflicts'} resolved
        </span>
        <span className="resolver-spacer" />
        <button className="btn small" onClick={() => setChoices(conflicts.map(() => 'ours'))} title={`Use ${sides.ours} in every conflict`}>
          All Left
        </button>
        <button className="btn small" onClick={() => setChoices(conflicts.map(() => 'theirs'))} title={`Use ${sides.theirs} in every conflict`}>
          All Right
        </button>
        <button className="btn small" onClick={onShowDiff}>
          Diff
        </button>
        <button className="btn small primary" disabled={resolved < conflicts.length} onClick={() => void save()} title="Write the file and mark it resolved">
          Save and Mark Resolved
        </button>
      </div>
      <div className="resolver-body">
        {segments.map((s, i) => {
          if (s.kind === 'text') {
            const first = i === 0
            const last = i === segments.length - 1
            const lines = s.lines
            // Around each conflict a few unchanged lines; the rest folded (a click shows them).
            const head = first ? 0 : CONTEXT
            const tail = last ? 0 : CONTEXT
            const text = (part: string[]): string => part.map(show).join('\n')
            if (open.has(i) || lines.length <= head + tail + 1) return <pre key={i} className="rc-text">{text(lines)}</pre>
            const hidden = lines.length - head - tail
            return (
              <div key={i} className="rc-text-wrap">
                {head > 0 && <pre className="rc-text">{text(lines.slice(0, head))}</pre>}
                <button className="rc-fold" onClick={() => setOpen(new Set(open).add(i))}>
                  ⋯ {hidden} unchanged {hidden === 1 ? 'line' : 'lines'}
                </button>
                {tail > 0 && <pre className="rc-text">{text(lines.slice(lines.length - tail))}</pre>}
              </div>
            )
          }
          const k = ++n
          const choice = choices[k] ?? null
          const edit = editing?.n === k ? editing : null
          const label =
            choice === 'ours'
              ? cap(sides.ours)
              : choice === 'theirs'
                ? cap(sides.theirs)
                : choice === 'ours-theirs'
                  ? 'Both, left first'
                  : choice === 'theirs-ours'
                    ? 'Both, right first'
                    : 'Your own text'
          return (
            <div key={i} className={`rc-block ${choice ? 'resolved' : ''}`}>
              <div className="rc-title">
                Conflict {k + 1} of {conflicts.length}
                {choice && !edit && (
                  <>
                    <span className="rc-using">· {label}</span>
                    <button className="link-btn" onClick={() => choose(k, null)}>
                      Change
                    </button>
                  </>
                )}
              </div>
              {edit ? (
                <div className="rc-edit">
                  <textarea
                    className="mono"
                    autoFocus
                    data-own-enter
                    value={edit.text}
                    rows={Math.min(20, Math.max(4, edit.text.split('\n').length + 1))}
                    onChange={(e) => setEditing({ n: k, text: e.target.value })}
                  />
                  <div className="rc-actions">
                    <button className="btn small" onClick={() => setEditing(null)}>
                      Cancel
                    </button>
                    <button className="btn small primary" onClick={() => choose(k, { custom: edit.text })}>
                      Use This Text
                    </button>
                  </div>
                </div>
              ) : choice ? (
                <pre className="rc-result">{chosenLines(s, choice).map(show).join('\n') || ' '}</pre>
              ) : (
                <>
                  <div className="rc-sides">
                    {(['ours', 'theirs'] as const).map((side) => (
                      <div key={side} className={`rc-side ${side}`}>
                        <div className="rc-side-head">
                          <span>{cap(sides[side])}</span>
                          <button className="btn small" onClick={() => choose(k, side)}>
                            Use This
                          </button>
                        </div>
                        <pre>{(side === 'ours' ? s.ours : s.theirs).map(show).join('\n') || ' '}</pre>
                      </div>
                    ))}
                  </div>
                  <div className="rc-actions">
                    <button className="btn small" onClick={() => choose(k, 'ours-theirs')}>
                      Both, Left First
                    </button>
                    <button className="btn small" onClick={() => choose(k, 'theirs-ours')}>
                      Both, Right First
                    </button>
                    <button className="btn small" onClick={() => setEditing({ n: k, text: [...s.ours, ...s.theirs].map(show).join('\n') })}>
                      Edit…
                    </button>
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
