import { useEffect, useState } from 'react'
import type { FileChange } from '../../../shared/types'
import { fullDate, hueFor, initials } from '../format'
import { useAsync } from '../hooks'
import { authorColorMap, useSettings } from '../settings'
import { Split } from './Split'
import { FileList } from './FileList'
import { DiffView } from './DiffView'
import { CheckIcon, CopyIcon } from './Icons'

interface Props {
  path: string
  hash: string | null
  onJump: (hash: string) => void
}

export function CommitPanel({ path, hash, onJump }: Props) {
  const { data: details, error } = useAsync(
    () => (hash ? window.spoon.commitDetails(path, hash) : Promise.resolve(null)),
    [path, hash]
  )
  const [file, setFile] = useState<FileChange | null>(null)
  const [copied, setCopied] = useState(false)
  const authorColors = authorColorMap(useSettings())

  // Keep the same file selected when moving between commits that both touch it.
  useEffect(() => {
    if (!details) return
    setFile((prev) => details.files.find((f) => f.path === prev?.path) ?? details.files[0] ?? null)
  }, [details])

  if (!hash) return <div className="empty-state muted">Select a commit.</div>
  if (error) return <div className="empty-state error-text">{error}</div>
  if (!details) return <div className="panel" />

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
      <div className="panel commit-info">
        <div className="commit-head">
          <h2 className="commit-subject">{subject}</h2>
          {body.join('\n').trim() && <pre className="commit-body">{body.join('\n').trim()}</pre>}
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
        <div className="section-title">
          {details.files.length} changed file{details.files.length === 1 ? '' : 's'}
          {details.parents.length > 1 && <span className="muted"> · compared to first parent</span>}
        </div>
        <FileList
          files={details.files}
          selected={new Set(file ? [file.path] : [])}
          focused={file?.path ?? null}
          onSelect={(_, f) => setFile(f)}
          emptyText="No file changes."
        />
      </div>
      <DiffView path={path} target={file ? { kind: 'commit', hash: details.hash, file } : null} />
    </Split>
  )
}
