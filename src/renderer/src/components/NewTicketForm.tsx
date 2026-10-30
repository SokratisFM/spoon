// The first step of New branch (⌘N) when there's no ticket yet: create it in Jira (project, type,
// title, description, fix version), then the branch is made for it. Starts from the defaults in
// Settings → Accounts → New tickets.
import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { JiraProject, JiraProjectMeta } from '../../../shared/types'
import { useSettings } from '../settings'
import { cleanError } from '../hooks'

/** Fields of the form (the rest can't be set here). */
const FORM_FIELDS = new Set(['Description', 'Fix versions', 'Fix Version/s', 'Assignee'])

/** The ticket types offered, in this order, when the project has them. */
const PREFERRED = ['Task', 'Bug', 'Defect']

export interface CreatedTicket {
  key: string
  url: string
  summary: string
  type: string
}

interface Props {
  site: string
  /** Set to the form's submit, for the dialog's footer button (and Enter). */
  submit: MutableRefObject<() => void>
  /** Whether it can be submitted now, and whether it's creating. */
  onState: (state: { ready: boolean; busy: boolean }) => void
  onCreated: (t: CreatedTicket) => void
}

export function NewTicketForm({ site, submit, onState, onCreated }: Props) {
  const s = useSettings()
  const [projects, setProjects] = useState<JiraProject[] | null>(null)
  const [project, setProject] = useState('')
  const [meta, setMeta] = useState<JiraProjectMeta | null>(null)
  const [typeId, setTypeId] = useState('')
  const [summary, setSummary] = useState('')
  const [description, setDescription] = useState(s.jiraNewTemplate)
  const [fixVersion, setFixVersion] = useState<string>('')
  const [assignMe, setAssignMe] = useState(s.jiraNewAssignMe)
  const [required, setRequired] = useState<{ id: string; name: string }[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const title = useRef<HTMLInputElement>(null)

  // Projects you can create in; the ones listed in Settings (Jira → only these projects) first.
  useEffect(() => {
    let live = true
    window.spoon.jiraProjects(site).then(
      (list) => {
        if (!live) return
        const mine = s.jiraProjects.split(/[,\s]+/).map((k) => k.trim().toUpperCase()).filter(Boolean)
        const sorted = [...list.filter((p) => mine.includes(p.key)), ...list.filter((p) => !mine.includes(p.key))]
        setProjects(sorted)
        setProject((sorted.find((p) => p.key === s.jiraNewProject) ?? sorted[0])?.key ?? '')
      },
      (err) => live && setError(cleanError(err))
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site])

  // The project's types and unreleased fix versions; the defaults picked again for it.
  useEffect(() => {
    if (!project) return
    let live = true
    // Nothing of the previous project's (its type or fix version) is kept meanwhile.
    setMeta(null)
    setTypeId('')
    setFixVersion('')
    setError(null)
    window.spoon.jiraProjectMeta(site, project).then(
      (m) => {
        if (!live) return
        setMeta(m)
        const offered = offeredTypes(m)
        setTypeId((offered.find((t) => t.name.toLowerCase() === s.jiraNewType.toLowerCase()) ?? offered[0])?.id ?? '')
        setFixVersion(s.jiraNewFixVersion === 'next' ? (m.versions[0]?.id ?? '') : '')
      },
      (err) => live && setError(cleanError(err))
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site, project])

  // Fields this type requires that the form doesn't have: creating would fail, so they're named up front.
  useEffect(() => {
    if (!project || !typeId) return setRequired([])
    let live = true
    window.spoon.jiraRequiredFields(site, project, typeId).then(
      (r) => live && setRequired(r),
      () => live && setRequired([])
    )
    return () => {
      live = false
    }
  }, [site, project, typeId])

  useEffect(() => title.current?.focus(), [meta])

  const ready = !!project && !!meta && !!typeId && !!summary.trim() && !busy
  useEffect(() => onState({ ready, busy }), [ready, busy, onState])

  submit.current = async () => {
    if (!ready) return
    setBusy(true)
    setError(null)
    try {
      const made = await window.spoon.jiraCreate(site, {
        project,
        typeId,
        summary,
        description,
        fixVersionId: fixVersion || null,
        assignToMe: assignMe
      })
      onCreated({ ...made, summary: summary.trim(), type: meta?.types.find((t) => t.id === typeId)?.name ?? '' })
    } catch (err) {
      setError(cleanError(err))
    } finally {
      setBusy(false)
    }
  }

  const offered = meta ? offeredTypes(meta) : []
  // Required fields still empty: the form's own (description, fix version, assignee) only while left empty.
  const missing = required
    .filter((f) => (f.id === 'description' ? !description.trim() : f.id === 'fixVersions' ? !fixVersion : f.id === 'assignee' ? !assignMe : true))
    .map((f) => f.name)
  return (
    <div className="nt-form">
      {error && <div className="error-text nt-error">{error}</div>}
      <div className="nt-row">
        <label className="field nt-col">
          <span className="field-label">Project</span>
          <select value={project} onChange={(e) => setProject(e.target.value)} disabled={!projects}>
            {!projects && <option>Loading…</option>}
            {projects?.map((p) => (
              <option key={p.key} value={p.key}>
                {p.key} · {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field nt-col">
          <span className="field-label">Fix version</span>
          <select value={fixVersion} onChange={(e) => setFixVersion(e.target.value)} disabled={!meta}>
            <option value="">None</option>
            {meta?.versions.map((v, i) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {i === 0 ? ' (next)' : ''}
                {v.releaseDate ? ` · ${v.releaseDate}` : ''}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="field">
        <span className="field-label">Type</span>
        <div className="nt-types">
          {!meta && <span className="muted">Loading…</span>}
          {offered.map((t) => (
            <button key={t.id} className={`nb-type nt-type ${typeId === t.id ? 'on' : ''}`} onClick={() => setTypeId(t.id)}>
              {t.name}
            </button>
          ))}
        </div>
        {missing.length > 0 && (
          <span className="hint warn">
            {offered.find((t) => t.id === typeId)?.name} tickets in {project} need {missing.join(', ')}
            {missing.some((m) => !FORM_FIELDS.has(m)) ? ', some of which can’t be set here' : ''}: creating may fail.
          </span>
        )}
      </div>
      <label className="field">
        <span className="field-label">Title</span>
        <input ref={title} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Fast dev build for Android" />
      </label>
      <label className="field">
        <span className="field-label">
          Description <span className="muted">· Markdown</span>
        </span>
        <textarea className="nt-description" rows={5} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label className="check">
        <input type="checkbox" checked={assignMe} onChange={(e) => setAssignMe(e.target.checked)} />
        Assign to me
      </label>
    </div>
  )
}

/** Task, Bug and Defect, when the project has them (else every type it has). */
function offeredTypes(meta: JiraProjectMeta): { id: string; name: string }[] {
  const picked = PREFERRED.map((n) => meta.types.find((t) => t.name.toLowerCase() === n.toLowerCase())).filter(
    (t): t is { id: string; name: string } => !!t
  )
  return picked.length ? picked : meta.types
}
