// Confirms bringing a submodule to the commit its parent records, explaining what moves where:
// a before/after of the commits involved, then what happens to branches, commits and local changes.
import { useState, type ReactNode } from 'react'
import type { ShortCommit, Submodule, SubmoduleUpdatePreview } from '../../../shared/types'
import { useAsync } from '../hooks'
import { Modal } from './Modal'
import { AlertIcon, ArrowDownIcon, ArrowUpIcon, BranchIcon, FetchIcon, ShieldIcon } from './Icons'

interface Props {
  repoPath: string
  sub: Submodule
  onClose: () => void
  onConfirm: (backupBranch?: string) => void
  /** Keep the submodule where it is: stage its new pointer in the parent instead. */
  onRecordCurrent: () => void
}

const short = (h: string): string => h.slice(0, 7)
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

interface GraphRow {
  key: string
  text?: string
  hash?: string
  tags?: { text: string; kind: 'you' | 'recorded' | 'branch' }[]
  dot: 'you' | 'recorded' | 'branch' | 'old'
  faded?: boolean
}

function Graph({ caption, rows }: { caption: string; rows: GraphRow[] }) {
  return (
    <div className="smu-col">
      <div className="smu-caption">{caption}</div>
      {rows.map((r) => (
        <div key={r.key} className={`smu-row ${r.faded ? 'faded' : ''}`}>
          <span className={`smu-dot ${r.dot}`} />
          {r.tags?.map((t) => (
            <span key={t.text} className={`smu-tag ${t.kind}`}>
              {t.text}
            </span>
          ))}
          {r.text && <span className="smu-text">{r.text}</span>}
          {r.hash && <span className="mono muted">{short(r.hash)}</span>}
        </div>
      ))}
    </div>
  )
}

/** Commit rows, with a "+N more" row when the list was capped. */
function commitRows(list: ShortCommit[], total: number, row: (c: ShortCommit, i: number) => GraphRow): GraphRow[] {
  const rows = list.slice(0, 4).map(row)
  if (total > rows.length) rows.push({ key: 'more', text: `+${total - rows.length} more`, dot: 'old', faded: true })
  return rows
}

export function SubmoduleUpdateDialog({ repoPath, sub, onClose, onConfirm, onRecordCurrent }: Props) {
  const parent = repoPath.split('/').pop() ?? 'the parent'
  const { data: p, error } = useAsync(
    () => window.spoon.submoduleUpdatePreview(repoPath, sub.path),
    [repoPath, sub.path]
  )
  const [backup, setBackup] = useState(true)

  const catchingUp = !!p && !p.needsFetch && p.aheadCount === 0
  const title = `${catchingUp ? 'Update' : 'Reset'} ${sub.name} to the commit ${parent} records?`

  if (!p) {
    return (
      <Modal
        title={title}
        onClose={onClose}
        footer={
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
        }
      >
        {error ? <p className="error-text">{error}</p> : <p className="muted">Looking at {sub.name}…</p>}
      </Modal>
    )
  }

  const orphaned = p.orphaned.length > 0 && p.aheadCount > 0
  const backupName = `spoon/backup-${short(p.head)}`
  const risky = !catchingUp && ((orphaned && !backup) || p.dirtyFiles > 0)
  const confirm = (): void => {
    onClose()
    onConfirm(orphaned && backup ? backupName : undefined)
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      onSubmit={confirm}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className={`btn primary ${risky ? 'warn' : ''}`} onClick={confirm} autoFocus>
            {catchingUp ? 'Update' : risky ? 'Reset Anyway' : `Reset to ${short(p.recorded)}`}
          </button>
        </>
      }
    >
      <div className={`smu ${risky ? 'risky' : ''}`}>
        <p className="muted">{summary(p, sub.name, parent)}</p>
        {!p.needsFetch && (p.aheadCount === 0 || p.behindCount === 0) && (
          <div className="smu-graphs">
            <Graph caption="Now" rows={nowRows(p)} />
            <Graph caption={catchingUp ? 'After update' : 'After reset'} rows={afterRows(p)} />
          </div>
        )}
        <ul className="smu-points">{points(p, sub.name, parent, orphaned, backup)}</ul>
        {orphaned && (
          <label className="check">
            <input type="checkbox" checked={backup} onChange={(e) => setBackup(e.target.checked)} />
            Create branch <span className="mono">{backupName}</span> first, so{' '}
            {p.orphaned.length === 1 ? 'that commit isn’t' : 'those commits aren’t'} lost
          </label>
        )}
        {!catchingUp && (
          <div className="smu-alt">
            <span>
              Meant to keep the newer {sub.name}? Record it in {parent} instead, so {parent} points at{' '}
              <span className="mono">{short(p.head)}</span>.
            </span>
            <button
              className="link-btn"
              onClick={() => {
                onClose()
                onRecordCurrent()
              }}
            >
              Stage it in {parent}’s Local Changes →
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}

function summary(p: SubmoduleUpdatePreview, name: string, parent: string): string {
  const at = p.branch ? `on ${p.branch}` : `at ${short(p.head)}`
  if (p.needsFetch) return `${parent} expects ${name} at ${short(p.recorded)}, which ${name} doesn’t have yet.`
  if (p.aheadCount === 0)
    return `${parent} expects ${name} at ${short(p.recorded)}. You’re ${at}, ${plural(p.behindCount, 'commit')} behind it.`
  if (p.behindCount === 0) return `You’re ${at}, ${plural(p.aheadCount, 'commit')} ahead of what ${parent} records.`
  return `You’re ${at}. You and the recorded commit have each moved: ${plural(p.aheadCount, 'commit')} of yours, ${p.behindCount} the recorded one has that you don’t.`
}

function nowRows(p: SubmoduleUpdatePreview): GraphRow[] {
  const you = { text: 'you', kind: 'you' as const }
  const branch = p.branch ? [{ text: p.branch, kind: 'branch' as const }] : []
  if (p.aheadCount === 0) {
    return [
      ...commitRows(p.behind, p.behindCount, (c) => ({ key: c.hash, text: c.subject, dot: 'recorded', faded: true })),
      { key: 'head', tags: [you, ...branch], text: p.headSubject, dot: 'you' }
    ]
  }
  return [
    ...commitRows(p.ahead, p.aheadCount, (c, i) => ({
      key: c.hash,
      text: c.subject,
      tags: i === 0 ? [you, ...branch] : undefined,
      dot: i === 0 ? 'you' : 'branch'
    })),
    { key: 'rec', tags: [{ text: 'recorded', kind: 'recorded' }], text: p.recordedSubject ?? '', dot: 'recorded' }
  ]
}

function afterRows(p: SubmoduleUpdatePreview): GraphRow[] {
  const landing = p.fastForward ? p.branch : p.landingBranch
  const youHere = [
    { text: 'you', kind: 'you' as const },
    ...(landing ? [{ text: landing, kind: 'branch' as const }] : []),
    { text: 'recorded', kind: 'recorded' as const }
  ]
  if (p.aheadCount === 0) {
    return [
      ...commitRows(p.behind, p.behindCount, (c, i) => ({
        key: c.hash,
        text: c.subject,
        tags: i === 0 ? youHere : undefined,
        dot: i === 0 ? 'you' : 'recorded'
      })),
      { key: 'head', text: p.headSubject, dot: 'old', faded: true }
    ]
  }
  return [
    ...commitRows(p.ahead, p.aheadCount, (c, i) => ({
      key: c.hash,
      text: c.subject,
      tags: i === 0 && p.branch ? [{ text: `${p.branch} stays`, kind: 'branch' }] : undefined,
      dot: 'branch',
      faded: true
    })),
    { key: 'rec', tags: youHere, text: p.recordedSubject ?? '', dot: 'you' }
  ]
}

function points(p: SubmoduleUpdatePreview, name: string, parent: string, orphaned: boolean, backup: boolean) {
  const items: { icon: ReactNode; tone: string; text: string }[] = []
  if (p.needsFetch)
    items.push({
      icon: <FetchIcon />,
      tone: 'muted',
      text: `Fetches ${name}’s remotes first to get ${short(p.recorded)}.`
    })
  if (p.aheadCount === 0 && !p.needsFetch) {
    items.push({
      icon: <ArrowUpIcon />,
      tone: 'ok',
      text: p.fastForward
        ? `Fast-forwards ${p.branch} by ${plural(p.behindCount, 'commit')}, to exactly what ${parent} expects.`
        : p.landingBranch
          ? `Switches to ${p.landingBranch}, which is at the recorded commit, ${plural(p.behindCount, 'commit')} ahead of you.`
          : `Moves ${name} forward ${plural(p.behindCount, 'commit')}, to exactly what ${parent} expects.`
    })
  } else {
    items.push({
      icon: <ArrowDownIcon />,
      tone: 'warn',
      text: p.landingBranch
        ? `Switches ${name} to ${p.landingBranch}, which is at ${short(p.recorded)}.`
        : p.behindCount === 0
          ? `Moves ${name} back ${plural(p.aheadCount, 'commit')}, to ${short(p.recorded)}.`
          : `Switches ${name} to ${short(p.recorded)}.`
    })
    if (p.branch)
      items.push({
        icon: <BranchIcon />,
        tone: 'ok',
        text: `${p.branch} and its ${plural(p.aheadCount, 'commit')} stay. Check it out again anytime.`
      })
  }
  if (orphaned) {
    const first = p.orphaned[0]
    items.push({
      icon: <AlertIcon />,
      tone: backup ? 'muted' : 'warn',
      text: `${p.orphaned.length === 1 ? `Your commit ${short(first.hash)} “${first.subject}” is` : `${p.orphaned.length} of your commits are`} on no branch. ${backup ? `The backup branch below keeps ${p.orphaned.length === 1 ? 'it' : 'them'}.` : `After the reset only the reflog finds ${p.orphaned.length === 1 ? 'it' : 'them'}.`}`
    })
  }
  if (p.dirtyFiles)
    items.push({
      icon: <AlertIcon />,
      tone: 'warn',
      text: `${plural(p.dirtyFiles, 'file')} in ${name} ${p.dirtyFiles === 1 ? 'has' : 'have'} uncommitted changes. They’re carried over; if one clashes, git stops and nothing changes.`
    })
  else
    items.push({
      icon: <ShieldIcon />,
      tone: 'ok',
      text:
        orphaned && !backup
          ? `No uncommitted changes in ${name}.`
          : `Nothing is lost. No uncommitted changes in ${name}.`
    })
  return items.map((it, i) => (
    <li key={i} className={`smu-point ${it.tone}`}>
      {it.icon}
      <span>{it.text}</span>
    </li>
  ))
}
