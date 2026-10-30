import { memo, useEffect, useRef, useState } from 'react'
import type { CommitDetails, FileChange } from '../../../shared/types'
import { fullDate, hueFor, initials } from '../format'
import { useCachedAsync } from '../hooks'
import { detailsCache } from '../repoCache'
import { authorColorMap, useSettings } from '../settings'
import { jiraConfig, jiraUrl, splitByTickets } from '../jira'
import { Split } from './Split'
import { FileList } from './FileList'
import { DiffView } from './DiffView'
import { CheckIcon, CopyIcon } from './Icons'
import { contextMenu } from '../menus'
import { confirm } from '../dialogs'
import { requestCompare } from '../compare'
import { revealLabel } from '../platform'
import { openFileEditor, OPEN_SELECTED_FILE } from './FileEditor'
import type { Ops } from './RepoView'

interface Props {
  path: string
  hash: string | null
  onJump: (hash: string) => void
  ops: Ops
}

/**
 * A commit's changed file, right-clicked: only what can be done with it. A file the commit deleted
 * has no version in it, so its last version (in the parent) is the one to view or restore; a file
 * that's no longer in the working copy can't be opened, compared with it or revealed.
 */
async function fileMenu(path: string, d: CommitDetails, f: FileChange, ops: Ops): Promise<void> {
  const deleted = f.status === 'D'
  const parent = d.parents[0]
  const versionAt = deleted ? parent : d.hash
  const at = versionAt ? { hash: versionAt, label: versionAt === d.hash ? d.hash.slice(0, 7) : `${versionAt.slice(0, 7)} (before)` } : undefined
  const [exists] = await window.spoon.pathsExist([`${path}/${f.path}`])
  const short = d.hash.slice(0, 7)
  const choice = await contextMenu([
    { id: 'edit', label: 'Open in Spoon…', accelerator: 'CmdOrCtrl+E', enabled: exists },
    { id: 'view', label: deleted ? 'View Last Version…' : 'View This Version…', enabled: !!at },
    { id: 'default', label: 'Open with Default App', enabled: exists },
    { separator: true },
    { id: 'compare-working', label: 'Compare with Working Copy', enabled: exists && !deleted },
    { id: 'compare', label: 'Compare with…', enabled: !deleted },
    { id: 'restore', label: deleted ? 'Restore This File…' : 'Restore This Version…', enabled: !!at },
    { separator: true },
    { id: 'reveal', label: revealLabel, enabled: exists },
    { id: 'copy', label: 'Copy Path' },
    { id: 'copy-hash', label: 'Copy Commit Hash' }
  ])
  if (choice === 'edit') openFileEditor({ repo: path, file: f.path, at })
  else if (choice === 'view') openFileEditor({ repo: path, file: f.path, at, show: 'commit' })
  else if (choice === 'default') window.spoon.openWithDefaultApp(path, f.path)
  else if (choice === 'compare-working')
    requestCompare(await window.spoon.fileAtCommitToTemp(path, d.hash, f.path), `${path}/${f.path}`)
  else if (choice === 'compare') {
    const other = await window.spoon.pickFile(`Compare ${f.path} at ${short} with…`)
    if (other) requestCompare(await window.spoon.fileAtCommitToTemp(path, d.hash, f.path), other)
  } else if (choice === 'restore' && at) {
    const ok = await confirm({
      message: deleted ? `Restore ${f.path}?` : `Put the ${short} version of ${f.path} in your working copy?`,
      detail: `${deleted ? `It's brought back as it was before ${short} deleted it.` : 'The file’s current contents are replaced.'} It shows up in Local Changes; uncommitted changes to it go to the Trash first, so you can get them back.`,
      confirmLabel: 'Restore',
      risky: true
    })
    if (ok) ops.run(`Restoring ${f.path}…`, () => window.spoon.restoreFileFrom(path, at.hash, f.path), 'Couldn’t restore the file')
  } else if (choice === 'reveal') window.spoon.revealInFinder(`${path}/${f.path}`)
  else if (choice === 'copy') navigator.clipboard.writeText(f.path)
  else if (choice === 'copy-hash') navigator.clipboard.writeText(d.hash)
}

// Memoized: RepoView re-renders on every status refresh and progress tick.
export const CommitPanel = memo(function CommitPanel({ path, hash, onJump, ops }: Props) {
  // Commits never change, so their details come from the cache when they've been shown before.
  const { data: details, error } = useCachedAsync(detailsCache, hash ? `${path}|${hash}` : null, () =>
    window.spoon.commitDetails(path, hash!)
  )
  const [file, setFile] = useState<FileChange | null>(null)
  const [copied, setCopied] = useState(false)
  // ⌘E: the shown file in the popup (set once the details are in).
  const openShown = useRef<(() => void) | null>(null)
  useEffect(() => {
    const open = (): void => openShown.current?.()
    window.addEventListener(OPEN_SELECTED_FILE, open)
    return () => window.removeEventListener(OPEN_SELECTED_FILE, open)
  }, [])
  const settings = useSettings()
  const authorColors = authorColorMap(settings)
  const jira = jiraConfig(settings)
  // Ticket keys in the message become links to Jira.
  const linkify = (text: string) =>
    splitByTickets(text, jira).map((part, i) =>
      part.key && jira ? (
        <a key={i} href="#" className="jira-key" onClick={(e) => (e.preventDefault(), window.spoon.openExternal(jiraUrl(jira, part.key!)))}>
          {part.text}
        </a>
      ) : (
        <span key={i}>{part.text}</span>
      )
    )

  if (!hash) return <div className="empty-state muted">Select a commit.</div>
  if (error) return <div className="empty-state error-text">{error}</div>
  if (!details) return <div className="panel" />

  // The same file stays selected when moving between commits that both touch it; worked out here, so
  // the diff never asks for the previous commit's file in the new commit.
  const shown = details.files.find((f) => f.path === file?.path) ?? details.files[0] ?? null
  openShown.current = shown
    ? () =>
        openFileEditor({
          repo: path,
          file: shown.path,
          // A deleted file's last version is in the parent.
          at:
            shown.status !== 'D'
              ? { hash: details.hash, label: details.hash.slice(0, 7) }
              : details.parents[0]
                ? { hash: details.parents[0], label: `${details.parents[0].slice(0, 7)} (before)` }
                : undefined,
          show: shown.status === 'D' ? 'commit' : undefined
        })
    : null
  const [subject, ...body] = details.message.split('\n')
  const authorColor =
    authorColors?.get(details.authorName.toLowerCase()) ?? authorColors?.get(details.authorEmail.toLowerCase())
  const copyHash = (): void => {
    navigator.clipboard.writeText(details.hash)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  return (
    <Split id="commit-panel" direction="row" mode="fraction" initial={0.36} min={0.18} max={0.7}>
      {/* Details above, changed files below; drag the divider up to give the files the whole height. */}
      <Split id="commit-info" direction="column" mode="fraction" initial={0.42} min={0} max={0.92} collapsedLabel="Commit details">
        <div className="commit-head">
          <h2 className="commit-subject">{linkify(subject)}</h2>
          {body.join('\n').trim() && <pre className="commit-body">{linkify(body.join('\n').trim())}</pre>}
          <div className="commit-meta">
            <span
              className={`avatar large ${authorColor ? 'authored' : ''}`}
              style={{ '--hue': hueFor(details.authorEmail), '--author': authorColor } as React.CSSProperties}
            >
              {initials(details.authorName)}
            </span>
            <div className="meta-text">
              <span>
                <b>{details.authorName}</b> <span className="muted">&lt;{details.authorEmail}&gt;</span>
              </span>
              <span className="muted">{fullDate(details.authorTime)}</span>
              {details.committerName !== details.authorName && (
                <span className="muted">Committed by {details.committerName}</span>
              )}
            </div>
          </div>
          <div className="commit-ids">
            <button className="hash-chip mono" onClick={copyHash} title="Copy full hash">
              {details.hash.slice(0, 10)} {copied ? <CheckIcon /> : <CopyIcon />}
            </button>
            {details.parents.length > 0 && <span className="muted">Parents</span>}
            {details.parents.map((p) => (
              <button key={p} className="hash-chip mono link" onClick={() => onJump(p)}>
                {p.slice(0, 7)}
              </button>
            ))}
          </div>
        </div>
        <div className="panel commit-files">
          <div className="section-title">
            {details.files.length} changed file{details.files.length === 1 ? '' : 's'}
            {details.parents.length > 1 && <span className="muted"> · compared to first parent</span>}
          </div>
          <FileList
            files={details.files}
            selected={new Set(shown ? [shown.path] : [])}
            focused={shown?.path ?? null}
            onSelect={(_, f) => setFile(f)}
            onContextMenu={(files) => files[0] && fileMenu(path, details, files[0], ops)}
            emptyText="No file changes."
          />
        </div>
      </Split>
      <DiffView path={path} target={shown ? { kind: 'commit', hash: details.hash, file: shown } : null} />
    </Split>
  )
})

