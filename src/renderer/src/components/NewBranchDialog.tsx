// New branch from a Jira ticket (⌘N). The name follows the pattern in Settings
// ("{type}/{dev}/{ticket}/{description}"); each /-separated part is its own box, filled in from the
// ticket, git's user.name and (with an Atlassian account) the ticket's title. Every part stays editable.
// With "New ticket", the ticket is created in Jira first (NewTicketForm), then the branch for it.
// In the MainLib repository, "New MainLib release" makes candidates/<version> instead, and can bump
// the version file and commit that on it.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NewTicketForm, type CreatedTicket } from './NewTicketForm'
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
  // Project keys can have underscores (MY_PROJ-12).
  const m = /\/browse\/([A-Za-z][A-Za-z0-9_]{1,9}-\d{1,7})\b/.exec(text) ?? /(?<![A-Za-z0-9_])([A-Za-z][A-Za-z0-9_]{1,9}-\d{1,7})(?!\d)/.exec(text)
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
  // A ticket to create first (step 1), or one that exists already (pasted, or just created).
  const [savedMode, setMode] = usePersistentState<'existing' | 'create' | 'release'>('spoon.newBranch.mode', 'existing')
  // The MainLib version, when this repository is MainLib (only then is there a release to make).
  const [mainlibNow, setMainlibNow] = useState<string | null>(null)
  const mode = savedMode === 'release' && mainlibNow === null ? 'existing' : savedMode
  const release = mode === 'release'
  const [version, setVersion] = useState('')
  const [bump, setBump] = usePersistentState('spoon.newBranch.bump', true)
  const [created, setCreated] = useState<CreatedTicket | null>(null)
  const ticketStep = mode === 'create' && !created
  const submitTicket = useRef<() => void>(() => undefined)
  const [ticketState, setTicketState] = useState({ ready: false, busy: false })
  const onTicketState = useCallback((st: { ready: boolean; busy: boolean }) => setTicketState(st), [])

  useEffect(() => {
    // A Jira link just copied goes straight into the ticket field.
    Promise.all([
      window.spoon.readClipboard().catch(() => ''),
      window.spoon.userName(path).catch(() => ''),
      window.spoon.atlassianAccount().catch(() => null),
      window.spoon.mainlibVersion(path).catch(() => null)
    ]).then(([clip, name, account, mainlib]) => {
      setMainlibNow(mainlib)
      // A Jira link just copied: that's the ticket, so there's none to create.
      if (/jira|atlassian/i.test(clip) && clip.length < 500 && ticketFrom(clip)) {
        setTicketText(clip.trim())
        setMode('existing')
      }
      setUserName(name)
      setHasAccount(!!account)
      setReady(true)
    })
  }, [path])

  // A ticket made here is known as it is: no need to read it back from its link.
  const key = created?.key ?? ticketFrom(ticketText)
  useEffect(() => {
    if (!key || created) return
    let site = s.jiraSite
    try {
      const u = new URL(ticketText.trim())
      if (u.protocol === 'https:' && /atlassian\.net$|jira/i.test(u.hostname)) site = u.origin
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
    type: (found && /^(bug|defect)$/i.test(found.type.trim()) && types.find((t) => t.toLowerCase() === 'fix')) || types[0] || '',
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

  // Every part is optional: a part left empty is left out, with its slash (and any fixed text next to it).
  const skipped = (seg: (typeof segments)[number]): boolean =>
    seg.some((p) => 'token' in p) && seg.every((p) => 'text' in p || !valueOf(p.token))
  const name = segments
    .filter((seg) => !skipped(seg))
    .map((seg) =>
      // Fixed text next to an empty part goes too ("{ticket}-{description}" with no description isn't "MAINLIB-1-").
      seg
        .map((p, i) => {
          if ('token' in p) return valueOf(p.token)
          const near = [seg[i - 1], seg[i + 1]].filter((q): q is { token: string } => !!q && 'token' in q)
          return near.every((q) => valueOf(q.token)) ? p.text : ''
        })
        .join('')
    )
    .join('/')
  const locals = repo.refs.filter((r) => r.kind === 'head')
  const remotes = repo.refs.filter((r) => r.kind === 'remote' && !r.name.endsWith('/HEAD'))
  const releaseName = `${s.mainlibPrefix}${version.trim()}`
  const exists = locals.some((r) => r.name === (release ? releaseName : name))

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

  const problem = release
    ? !/^\d+\.\d+\.\d+([-.][0-9A-Za-z.-]+)?$/.test(version.trim())
      ? 'Type the version, like 4.3.0.'
      : exists
        ? `${releaseName} already exists.`
        : !base
          ? 'Pick the branch to start from.'
          : null
    : !name
      ? 'Fill in at least one part.'
      : exists
        ? `${name} already exists.`
        : !base
          ? 'Pick the branch to start from.'
          : null

  // Problems show once there's something to go on, not on an empty dialog.
  const started = !!key || Object.keys(typed).length > 0

  const create = async (): Promise<void> => {
    if (release) return createRelease()
    if (problem || creating) return
    // The dialog stays until it worked, so a failure doesn't lose what was filled in.
    setCreating(true)
    const ok = await ops.run(`Creating ${name}…`, () => window.spoon.createBranch(path, name, base), 'Couldn’t create the branch')
    setCreating(false)
    if (!ok) return
    onClose()
    if (checkout) ops.checkout({ kind: 'branch', name }, name)
  }

  // A MainLib release: candidates/<version>, checked out, and (with the toggle) the version file bumped
  // and committed there, one step after the other.
  const createRelease = async (): Promise<void> => {
    if (problem || creating) return
    const v = version.trim()
    setCreating(true)
    const ok = await ops.run(
      `Creating ${releaseName}…`,
      async () => {
        await window.spoon.createBranch(path, releaseName, base)
        if (checkout || bump) await window.spoon.checkout(path, { kind: 'branch', name: releaseName })
        if (bump) await window.spoon.bumpMainlibVersion(path, v)
      },
      'Couldn’t make the release branch'
    )
    setCreating(false)
    if (ok) onClose()
  }
  // The next patch, minor and major version after the current one.
  const nextVersions = ((): string[] => {
    const m = /^(\d+)\.(\d+)\.(\d+)/.exec(mainlibNow ?? '')
    if (!m) return []
    const [a, b, c] = [Number(m[1]), Number(m[2]), Number(m[3])]
    return [`${a}.${b}.${c + 1}`, `${a}.${b + 1}.0`, `${a + 1}.0.0`]
  })()

  // Focus goes to the first part still to fill in (the ticket field when there's no ticket yet).
  const ticketInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!ready || ticketStep) return
    if (!key) ticketInput.current?.focus()
    else firstEmpty.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, !!key, ticketStep])

  // The ticket just made: it's the one the branch is for, with its title and type straight away.
  const ticketMade = (t: CreatedTicket): void => {
    setCreated(t)
    setIssue({ key: t.key, issue: { summary: t.summary, type: t.type } })
    setTicketText(t.url)
  }
  // While the ticket is being created the popup stays: closing it wouldn't stop that, and creating
  // again would make a second ticket.
  const close = (): void => {
    if (!ticketState.busy) onClose()
  }

  // Where the new branch starts: the same for every kind of branch.
  const basedOn = (
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
  )

  // After creating: check out, and (for a MainLib release) bump the version; in the footer, or for a
  // release (two of them) under Based on.
  const toggles = (
    <>
      <label className="check nb-checkout">
        <input
          type="checkbox"
          checked={checkout || (release && bump)}
          disabled={release && bump}
          title={release && bump ? 'Bumping the version commits on the new branch, so it’s checked out' : undefined}
          onChange={(e) => setCheckout(e.target.checked)}
        />
        Check out after creating
      </label>
      {release && (
        <label className="check nb-checkout" title={`Write the version into Version/Resources/mainlib-version.txt and commit it as “bumping version to ${version.trim() || '…'}”`}>
          <input type="checkbox" checked={bump} onChange={(e) => setBump(e.target.checked)} />
          Bump the version and commit
        </label>
      )}
    </>
  )

  let firstEmptySet = false
  return (
    <Modal
      title={release ? 'New MainLib release' : mode === 'create' ? 'New ticket and branch' : 'New branch from ticket'}
      titleExtra={
        mode === 'create' ? (
          <span className="nt-steps">
            <span className={ticketStep ? 'now' : 'done'}>{ticketStep ? '1' : '✓'} Ticket</span>
            <span className="nt-step-sep">›</span>
            <span className={ticketStep ? '' : 'now'}>2 Branch</span>
          </span>
        ) : (
          `${keys('⌘N')} · ${keys('⇧⌘B')}`
        )
      }
      onClose={close}
      onSubmit={ticketStep ? () => submitTicket.current() : create}
      wide
      pending={!ready}
      footer={
        ticketStep ? (
          <>
            <span className="spacer" />
            <button className="btn" onClick={close} disabled={ticketState.busy}>
              Cancel
            </button>
            <button className="btn primary" onClick={() => submitTicket.current()} disabled={!ticketState.ready}>
              {ticketState.busy ? 'Creating…' : 'Create ticket →'}
            </button>
          </>
        ) : (
        <>
          {!release && toggles}
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={create} disabled={!!problem || creating} title={problem ?? undefined}>
            {release && !problem ? `Create ${releaseName}` : 'Create branch'}
          </button>
        </>
        )
      }
    >
      {!created && (
        <div className="segmented nt-mode" role="tablist">
          <button className={mode === 'existing' ? 'on' : ''} onClick={() => setMode('existing')}>
            Use an existing ticket
          </button>
          <button
            className={mode === 'create' ? 'on' : ''}
            disabled={!hasAccount}
            title={hasAccount ? undefined : 'Connect your Atlassian account in Settings → Accounts to create tickets'}
            onClick={() => setMode('create')}
          >
            Create a new ticket
          </button>
          {mainlibNow !== null && (
            <button className={release ? 'on' : ''} onClick={() => setMode('release')}>
              New MainLib release
            </button>
          )}
        </div>
      )}
      {release ? (
        <>
          <div className="field">
            <span className="field-label">Version</span>
            <div className="form-row nb-release-row">
              <input
                className="mono nb-version"
                value={version}
                autoFocus
                placeholder={nextVersions[1] ?? '4.3.0'}
                spellCheck={false}
                onChange={(e) => setVersion(e.target.value.replace(/\s/g, ''))}
              />
              <span className="hint">now {mainlibNow || '—'}</span>
              {nextVersions.map((v) => (
                <button key={v} className={`nb-type ${version === v ? 'on' : ''}`} onClick={() => setVersion(v)}>
                  {v}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span className="field-label">Branch</span>
            <div className="nb-segments">
              <div className="nb-seg">
                <span className="nb-seg-label">version branches</span>
                <span className="mono nb-fixed">{s.mainlibPrefix}</span>
              </div>
              <div className="nb-seg-wrap grow">
                <div className="nb-seg-col">
                  <div className={`nb-seg ${version.trim() ? '' : 'empty'}`}>
                    <span className="nb-seg-label">version</span>
                    <span className="mono">{version.trim() || <span className="faint">version</span>}</span>
                  </div>
                </div>
              </div>
            </div>
            <span className={`hint nb-name ${problem && version ? 'warn' : ''}`}>
              {problem && version
                ? problem
                : bump && version.trim()
                  ? `Then mainlib-version.txt goes ${mainlibNow || '?'} → ${version.trim()}, committed as “bumping version to ${version.trim()}”.`
                  : 'The prefix is Settings → MainLib → Version branches.'}
            </span>
          </div>
          {basedOn}
          <div className="form-row nb-release-toggles">{toggles}</div>
        </>
      ) : ticketStep ? (
        <NewTicketForm site={s.jiraSite} submit={submitTicket} onState={onTicketState} onCreated={ticketMade} />
      ) : (
      <>
      {created ? (
        <div className="hint nb-ticket nt-created">
          <b className="nb-key">✓ Created {created.key}</b> · “{created.summary}”{' '}
          <button className="link-btn" onClick={() => window.spoon.openExternal(created.url)}>
            Open in Jira
          </button>
        </div>
      ) : (
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
      )}

      <div className="field">
        <span className="field-label">Branch</span>
        <div className="nb-segments">
          {segments.map((seg, i) => {
            const tokens = seg.filter((p): p is { token: string } => 'token' in p)
            const wide = tokens.some((t) => t.token === 'description')
            return (
              <div key={i} className={`nb-seg-wrap ${wide ? 'grow' : ''}`}>
                {i > 0 && <span className="nb-slash">/</span>}
                <div className="nb-seg-col">
                <div
                  className={`nb-seg ${skipped(seg) ? 'empty' : ''}`}
                  title={skipped(seg) ? 'Empty: left out of the name' : undefined}
                >
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
                </div>
                {/* Under the box, so the boxes all stay one line tall. */}
                {tokens.some((t) => t.token === 'type') && types.length > 1 && (
                  <span className="nb-types">
                    {types.map((t) => (
                      <button
                        key={t}
                        className={`nb-type ${valueOf('type') === t ? 'on' : ''}`}
                        title={valueOf('type') === t ? 'Click again to leave it out' : undefined}
                        onClick={() => setPart('type', valueOf('type') === t ? '' : t)}
                      >
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

      {basedOn}
      </>
      )}
    </Modal>
  )
}
