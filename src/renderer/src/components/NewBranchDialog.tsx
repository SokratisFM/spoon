// New branch from a Jira ticket (⌘N). The name follows the pattern in Settings
// ("{type}/{dev}/{ticket}/{description}"); each /-separated part is its own box, filled in from the
// ticket, git's user.name and (with an Atlassian account) the ticket's title. Every part stays editable.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { JiraIssue, RepoState } from '../../../shared/types'
import { Modal } from './Modal'
import type { Ops } from './RepoView'
import { useSettings } from '../settings'
import { usePersistentState } from '../hooks'
import { keys } from '../platform'

type Part = { token: string } | { text: string }

/** "{type}/{dev}/{ticket}-{description}" → segments (split at /), each a list of tokens and fixed text. */
export function parsePattern(pattern: string): Part[][] {
  return pattern
    .split('/')
    .filter((seg) => seg.trim())
    .map((seg) => {
      const parts: Part[] = []
      let last = 0
      for (const m of seg.matchAll(/\{(\w+)\}/g)) {
        if (m.index! > last) parts.push({ text: seg.slice(last, m.index) })
        parts.push({ token: m[1] })
        last = m.index! + m[0].length
      }
      if (last < seg.length) parts.push({ text: seg.slice(last) })
      return parts
    })
}

/** The ticket key in a link or text ("…/browse/MAINLIB-2592", "mainlib-2592"), upper-cased. */
export function ticketFrom(text: string): string {
  const m = /\/browse\/([A-Za-z][A-Za-z0-9]{1,9}-\d{1,7})\b/.exec(text) ?? /(?<![A-Za-z0-9])([A-Za-z][A-Za-z0-9]{1,9}-\d{1,7})(?!\d)/.exec(text)
  return m ? m[1].toUpperCase() : ''
}

/** A title as a branch-name part: "Banner ads stop refreshing!" → "banner-ads-stop-refreshing". */
export function slug(text: string, max = 50): string {
  let s = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ'’]/g, '')
    .replace(/[^a-z0-9._]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
  if (s.length > max) s = s.slice(0, max).replace(/-[^-]*$/, '')
  return s
}

/** What can be typed into a part: no spaces (they become -), no / and nothing git refuses in a name. */
const clean = (v: string): string => v.replace(/\s+/g, '-').replace(/[~^:?*[\\/\x00-\x1f\x7f]/g, '')

const LABEL: Record<string, string> = { type: 'type', dev: 'dev', ticket: 'ticket', description: 'short description' }

interface Props {
  path: string
  repo: RepoState
  ops: Ops
  onClose: () => void
}

export function NewBranchDialog({ path, repo, ops, onClose }: Props) {
  const s = useSettings()
  const segments = useMemo(() => parsePattern(s.branchPattern), [s.branchPattern])
  const types = useMemo(() => s.branchTypes.split(',').map((t) => t.trim()).filter(Boolean), [s.branchTypes])

  const [ticketText, setTicketText] = useState('')
  const [userName, setUserName] = useState('')
  const [issue, setIssue] = useState<{ key: string; issue: JiraIssue | null } | null>(null)
  const [hasAccount, setHasAccount] = useState(true)
  // Parts the user typed into: those keep their text when the ticket changes.
  const [typed, setTyped] = useState<Record<string, string>>({})
  const [checkout, setCheckout] = usePersistentState('spoon.newBranch.checkout', true)
  const [ready, setReady] = useState(false)
  const [creating, setCreating] = useState(false)
  const firstEmpty = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    // A Jira link just copied goes straight into the ticket field.
    Promise.all([
      window.spoon.readClipboard().catch(() => ''),
      window.spoon.userName(path).catch(() => ''),
      window.spoon.atlassianAccount().catch(() => null)
    ]).then(([clip, name, account]) => {
      if (/jira|atlassian/i.test(clip) && clip.length < 500) setTicketText(clip.trim())
      setUserName(name)
      setHasAccount(!!account)
      setReady(true)
    })
  }, [path])

  const key = ticketFrom(ticketText)
  useEffect(() => {
    if (!key) return
    let site = s.jiraSite
    try {
      const u = new URL(ticketText.trim())
      if (/atlassian\.net$|jira/i.test(u.hostname)) site = u.origin
    } catch {
      // not a link: the Jira site from Settings
    }
    let live = true
    const t = setTimeout(() => {
      window.spoon.jiraIssue(site, key).then(
        (found) => live && setIssue({ key, issue: found }),
        () => live && setIssue({ key, issue: null })
      )
    }, 250)
    return () => {
      live = false
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  const found = issue?.key === key ? issue.issue : null

  const auto: Record<string, string> = {
    type: (found && /bug/i.test(found.type) && types.find((t) => t === 'fix')) || types[0] || '',
    dev: clean(s.branchDevName.trim()) || slug(userName.trim().split(/\s+/)[0] ?? ''),
    ticket: key,
    description: found ? slug(found.summary) : ''
  }
  const valueOf = (token: string): string => typed[token] ?? auto[token] ?? ''
  const setPart = (token: string, v: string): void => setTyped((t) => ({ ...t, [token]: clean(v) }))
  const resetPart = (token: string): void =>
    setTyped((t) => {
      const n = { ...t }
      delete n[token]
      return n
    })

  const name = segments.map((seg) => seg.map((p) => ('text' in p ? p.text : valueOf(p.token))).join('')).join('/')
  const missing = segments.flat().filter((p): p is { token: string } => 'token' in p && !valueOf(p.token))
  const locals = repo.refs.filter((r) => r.kind === 'head')
  const remotes = repo.refs.filter((r) => r.kind === 'remote' && !r.name.endsWith('/HEAD'))
  const exists = locals.some((r) => r.name === name)

  // Starts from the branch in Settings (develop): the local one if it's up to date, else its remote copy.
  const defaultBase = useMemo(() => {
    const want = s.branchBase.trim()
    const local = locals.find((r) => r.name === want)
    const remote = remotes.find((r) => r.name === `origin/${want}`) ?? remotes.find((r) => r.name.endsWith(`/${want}`))
    if (local && !local.behind) return local.name
    if (remote) return remote.name
    return local?.name ?? repo.headBranch ?? locals[0]?.name ?? ''
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [base, setBase] = useState(defaultBase)
  const baseRef = [...locals, ...remotes].find((r) => r.name === base)

  const problem = missing.length
      ? `Fill in the ${LABEL[missing[0].token] ?? missing[0].token}.`
      : exists
        ? `${name} already exists.`
        : !base
          ? 'Pick the branch to start from.'
          : null

  // Problems show once there's something to go on, not on an empty dialog.
  const started = !!key || Object.keys(typed).length > 0

  const create = async (): Promise<void> => {
    if (problem || creating) return
    // The dialog stays until it worked, so a failure doesn't lose what was filled in.
    setCreating(true)
    const ok = await ops.run(`Creating ${name}…`, () => window.spoon.createBranch(path, name, base), 'Couldn’t create the branch')
    setCreating(false)
    if (!ok) return
    onClose()
    if (checkout) ops.checkout({ kind: 'branch', name }, name)
  }

  // Focus goes to the first part still to fill in (the ticket field when there's no ticket yet).
  const ticketInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!ready) return
    if (!key) ticketInput.current?.focus()
    else firstEmpty.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, !!key])

  let firstEmptySet = false
  return (
    <Modal
      title="New branch from ticket"
      titleExtra={keys('⌘N')}
      onClose={onClose}
      onSubmit={create}
      wide
      pending={!ready}
      footer={
        <>
          <label className="check nb-checkout">
            <input type="checkbox" checked={checkout} onChange={(e) => setCheckout(e.target.checked)} />
            Check out after creating
          </label>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={create} disabled={!!problem || creating} title={problem ?? undefined}>
            Create branch
          </button>
        </>
      }
    >
      <div className="field">
        <span className="field-label">Jira ticket</span>
        <input
          ref={ticketInput}
          value={ticketText}
          onChange={(e) => setTicketText(e.target.value)}
          placeholder="https://fm-games.atlassian.net/browse/MAINLIB-2592"
          spellCheck={false}
          className="mono"
        />
        {key && (
          <span className="hint nb-ticket">
            <b className="nb-key">✓ {key}</b>
            {found ? (
              <> · “{found.summary}”</>
            ) : issue?.key !== key ? null : hasAccount ? (
              <> · your Atlassian token can’t read this ticket’s title (it needs Jira access)</>
            ) : (
              <> · connect Atlassian in Settings → Accounts to fill in the title</>
            )}
          </span>
        )}
      </div>

      <div className="field">
        <span className="field-label">Branch</span>
        <div className="nb-segments">
          {segments.map((seg, i) => {
            const tokens = seg.filter((p): p is { token: string } => 'token' in p)
            const wide = tokens.some((t) => t.token === 'description')
            return (
              <div key={i} className="nb-seg-wrap">
                {i > 0 && <span className="nb-slash">/</span>}
                <div className={`nb-seg ${wide ? 'grow' : ''} ${tokens.some((t) => !valueOf(t.token)) ? 'empty' : ''}`}>
                  <span className="nb-seg-label">
                    {tokens.length ? tokens.map((t) => LABEL[t.token] ?? t.token).join(' · ') : 'fixed'}
                    {tokens
                      .filter((t) => t.token in typed && auto[t.token])
                      .map((t) => (
                        <button key={t.token} className="link-btn" title={`Back to “${auto[t.token]}”`} onClick={() => resetPart(t.token)}>
                          ↺
                        </button>
                      ))}
                  </span>
                  <span className="nb-seg-inputs">
                    {seg.map((p, j) => {
                      if ('text' in p) return <span key={j} className="nb-fixed">{p.text}</span>
                      const v = valueOf(p.token)
                      const isFirstEmpty = !v && !firstEmptySet
                      if (isFirstEmpty) firstEmptySet = true
                      return (
                        <input
                          key={j}
                          ref={isFirstEmpty ? firstEmpty : undefined}
                          className="mono nb-input"
                          value={v}
                          size={Math.max(4, v.length + 1, p.token === 'description' ? 18 : 0)}
                          placeholder={p.token === 'description' ? 'short-description' : p.token}
                          spellCheck={false}
                          onChange={(e) => setPart(p.token, e.target.value)}
                        />
                      )
                    })}
                  </span>
                  {tokens.some((t) => t.token === 'type') && types.length > 1 && (
                    <span className="nb-types">
                      {types.map((t) => (
                        <button key={t} className={`nb-type ${valueOf('type') === t ? 'on' : ''}`} onClick={() => setPart('type', t)}>
                          {t}
                        </button>
                      ))}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
        <span className={`hint nb-name ${problem && started ? 'warn' : ''}`}>
          {problem && started ? problem : <span className="mono">{name}</span>}
        </span>
      </div>

      <div className="field">
        <span className="field-label">Based on</span>
        <select value={base} onChange={(e) => setBase(e.target.value)}>
          {locals.length > 0 && (
            <optgroup label="Branches">
              {locals.map((r) => (
                <option key={r.name} value={r.name}>
                  {r.name}
                </option>
              ))}
            </optgroup>
          )}
          {remotes.length > 0 && (
            <optgroup label="Remote branches">
              {remotes.map((r) => (
                <option key={r.name} value={r.name}>
                  {r.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        {baseRef?.kind === 'head' && !!baseRef.behind && (
          <span className="hint warn">
            {base} is {baseRef.behind} commit{baseRef.behind === 1 ? '' : 's'} behind {baseRef.upstream}.
          </span>
        )}
      </div>
    </Modal>
  )
}
