// New branch from a Jira ticket (⌘N). The name follows the pattern in Settings
// ("{type}/{dev}/{ticket}/{description}"); each /-separated part is its own box, filled in from the
// ticket, git's user.name and (with an Atlassian account) the ticket's title. Every part stays editable.
// With "New ticket", the ticket is created in Jira first (NewTicketForm), then the branch for it.
// In the MainLib repository, "New MainLib release" makes candidates/<version> instead, and can bump
// the version file and commit that on it.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NewTicketForm, type CreatedTicket } from './NewTicketForm'
import type { CandidateInfo, JiraIssue, RepoState } from '../../../shared/types'
import { VersionPicker } from './VersionPicker'
import { JiraLogoIcon, PlusIcon, TagIcon } from './Icons'
import { Modal } from './Modal'
import { BranchPicker } from './BranchPicker'
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

/** Orders "4.2.0", "4.10.1" and "4.3.0-rc1" by their numbers. */
function compareVersions(a: string, b: string): number {
  const x = a.split(/[.\-_]/).map((p) => Number.parseInt(p, 10) || 0)
  const y = b.split(/[.\-_]/).map((p) => Number.parseInt(p, 10) || 0)
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0)
  return 0
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
  // A release repository (MainLibCore, MainLib, HGT): its kind and version, checked out. New candidates
  // are offered there, and wherever candidate branches already exist.
  const [candidate, setCandidate] = useState<CandidateInfo | null>(null)
  const candidatePrefix = useMemo(() => {
    const names = repo.refs
      .filter((r) => r.kind === 'head' || r.kind === 'remote')
      .map((r) => (r.kind === 'remote' ? r.name.slice(r.name.indexOf('/') + 1) : r.name))
    const n = (p: string): number => names.filter((x) => x.startsWith(p)).length
    if (n('candidate/') || n('candidates/')) return n('candidate/') > n('candidates/') ? 'candidate/' : 'candidates/'
    return candidate?.kind === 'mainlibcore' ? 'candidate/' : s.mainlibPrefix || 'candidates/'
  }, [repo.refs, candidate?.kind, s.mainlibPrefix])
  const hasCandidates = repo.refs.some((r) => /(^|\/)candidates?\//.test(r.name))
  const mode = savedMode === 'release' && !candidate && !hasCandidates ? 'existing' : savedMode
  const release = mode === 'release'
  const [version, setVersion] = useState('')
  const [bump, setBump] = usePersistentState('spoon.newBranch.bump', true)
  // A new candidate goes to the remote straight away (with its upstream), unless you turn that off.
  const [pushCandidate, setPushCandidate] = usePersistentState('spoon.newBranch.pushCandidate', true)
  const pushRemote = repo.remotes.includes('origin') ? 'origin' : repo.remotes[0]
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
      window.spoon.candidateInfo(path).catch(() => null)
    ]).then(([clip, name, account, info]) => {
      setCandidate(info)
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
  const releaseName = `${candidatePrefix}${version.trim()}`
  // A release branch already on a remote counts too: making it here would start a second one.
  const exists = release
    ? locals.some((r) => r.name === releaseName) || remotes.some((r) => r.name.endsWith(`/${releaseName}`))
    : locals.some((r) => r.name === name)

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
  // A new candidate starts from the latest one (each is cut from the one before it): its local branch
  // if that's up to date, else the remote's. Until you pick another base yourself.
  const [baseTouched, setBaseTouched] = useState(false)
  const latestCandidate = useMemo(() => {
    const versionOf = (r: (typeof locals)[number]): string | null => {
      const n = r.kind === 'remote' ? r.name.slice(r.name.indexOf('/') + 1) : r.name
      return n.startsWith(candidatePrefix) && /^\d+(\.\d+)+/.test(n.slice(candidatePrefix.length)) ? n.slice(candidatePrefix.length) : null
    }
    const all = [...locals, ...remotes].filter((r) => versionOf(r) !== null)
    const top = all.map((r) => versionOf(r)!).sort((x, y) => compareVersions(y, x))[0]
    if (!top) return null
    const local = locals.find((r) => versionOf(r) === top)
    const remote = remotes.find((r) => versionOf(r) === top && r.name.startsWith('origin/')) ?? remotes.find((r) => versionOf(r) === top)
    return (local && !local.behind ? local : (remote ?? local))!.name
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo.refs, candidatePrefix])
  useEffect(() => {
    if (baseTouched) return
    setBase(release && latestCandidate ? latestCandidate : defaultBase)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [release, latestCandidate])
  const baseRefs = useMemo(() => [...locals, ...remotes], [locals, remotes])
  const baseRef = baseRefs.find((r) => r.name === base)
  // What git is given: the full name of a listed branch, so a tag with the same name can't win.
  const baseArg = baseRef?.fullName ?? base

  // The version the release starts from: what the chosen base has (the bump lands only on the release
  // branch, so the working copy may say something else).
  const [baseVersion, setBaseVersion] = useState<string | null>(null)
  const [baseInfo, setBaseInfo] = useState<CandidateInfo | null>(null)
  // What a bump writes: the base's version file (the checked-out one until that's read).
  const bumpInfo = baseInfo ?? candidate
  const canBump = !!bumpInfo
  useEffect(() => {
    if (!release || !base) return
    let live = true
    window.spoon.candidateInfo(path, baseArg).then(
      (info) => live && (setBaseVersion(info?.version ?? null), setBaseInfo(info)),
      () => live && (setBaseVersion(null), setBaseInfo(null))
    )
    return () => {
      live = false
    }
  }, [path, baseArg, release])

  const problem = release
    ? !/^\d+(\.\d+){1,3}([-.][0-9A-Za-z.-]+)?$/.test(version.trim())
      ? 'Type the version, like 4.3.0.'
      : bump && canBump && baseVersion === version.trim()
        ? `${base} is already at ${version.trim()}.`
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
    const ok = await ops.run(`Creating ${name}…`, () => window.spoon.createBranch(path, name, baseArg), 'Couldn’t create the branch')
    setCreating(false)
    if (!ok) return
    onClose()
    if (checkout) ops.checkout({ kind: 'branch', name }, name)
  }

  // A MainLib release: candidates/<version>. With the bump, made, switched to and committed in one step
  // (undone if any of it fails); without it, made and checked out like any new branch.
  const createRelease = async (): Promise<void> => {
    if (problem || creating) return
    const v = version.trim()
    setCreating(true)
    const bumping = bump && canBump
    const ok = bumping
      ? await ops.run(`Creating ${releaseName}…`, () => window.spoon.createCandidate(path, releaseName, baseArg, v), 'Couldn’t make the candidate')
      : await ops.run(`Creating ${releaseName}…`, () => window.spoon.createBranch(path, releaseName, baseArg), 'Couldn’t make the candidate')
    setCreating(false)
    if (!ok) return
    onClose()
    if (pushCandidate && pushRemote)
      await ops.run(
        `Pushing ${releaseName}…`,
        () => window.spoon.push(path, { remote: pushRemote, remoteBranch: releaseName, setUpstream: true, tags: false, branch: releaseName }),
        'Push failed'
      )
    if (!bumping && checkout) ops.checkout({ kind: 'branch', name: releaseName }, releaseName)
  }
  // The next patch, minor and major version after the latest one: the base's, or a release branch's
  // (here or on a remote) when that's further on. A pre-release (4.3.0-rc1) is followed by its release.
  const nextVersions = ((): string[] => {
    const made = [...locals, ...remotes]
      .map((r) => (r.kind === 'remote' ? r.name.slice(r.name.indexOf('/') + 1) : r.name))
      .filter((n) => n.startsWith(candidatePrefix))
      .map((n) => n.slice(candidatePrefix.length))
      .filter((v) => /^\d+\.\d+\.\d+/.test(v))
    const latest = [baseVersion ?? candidate?.version ?? '', ...made].filter(Boolean).sort((x, y) => compareVersions(y, x))[0]
    const m = /^(\d+)\.(\d+)\.(\d+)(.*)$/.exec(latest ?? '')
    if (!m) return []
    const [a, b, c] = [Number(m[1]), Number(m[2]), Number(m[3])]
    const pre = !!m[4] && !made.includes(`${a}.${b}.${c}`)
    return [pre ? `${a}.${b}.${c}` : `${a}.${b}.${c + 1}`, `${a}.${b + 1}.0`, `${a + 1}.0.0`].filter((v) => !made.includes(v))
  })()
  // The version starts as the next patch after the latest (↑/↓ from there).
  useEffect(() => {
    if (release && !version && nextVersions[0]) setVersion(nextVersions[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [release, nextVersions.join()])

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
      {/* Type to search, or name any branch, tag or commit; the list picks as you go. */}
      <BranchPicker
        className="nb-base"
        refs={baseRefs}
        value={baseRef?.fullName ?? base}
        onChange={(v) => {
          setBaseTouched(true)
          setBase(baseRefs.find((r) => r.fullName === v)?.name ?? v)
        }}
        title="The branch, tag or commit the new branch starts from"
      />
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
          checked={checkout || (release && bump && canBump)}
          disabled={release && bump && canBump}
          title={release && bump ? 'Bumping the version commits on the new branch, so it’s checked out' : undefined}
          onChange={(e) => setCheckout(e.target.checked)}
        />
        Check out after creating
      </label>
      {release && canBump && (
        <label
          className="check nb-checkout"
          title={`Write the version into ${bumpInfo!.file} and commit it as “${bumpInfo!.message.replace('{version}', version.trim() || '…')}”`}
        >
          <input type="checkbox" checked={bump} onChange={(e) => setBump(e.target.checked)} />
          Bump the version and commit
        </label>
      )}
      {release && (
        <label
          className="check nb-checkout"
          title={pushRemote ? `Push ${releaseName} to ${pushRemote} when it’s made, and track it there` : 'This repository has no remote to push to'}
        >
          <input type="checkbox" checked={pushCandidate && !!pushRemote} disabled={!pushRemote} onChange={(e) => setPushCandidate(e.target.checked)} />
          Push when done
        </label>
      )}
    </>
  )

  let firstEmptySet = false
  return (
    <Modal
      title={release ? `New ${candidate?.label ?? ''} candidate`.replace(/\s+/g, ' ') : mode === 'create' ? 'New ticket and branch' : 'New branch from ticket'}
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
        <div className="nb-modes" role="tablist">
          <button role="tab" aria-selected={mode === 'existing'} className={mode === 'existing' ? 'on' : ''} onClick={() => setMode('existing')}>
            <JiraLogoIcon className="icon nb-mode-icon jira" />
            <span className="nb-mode-text">
              <b>Existing ticket</b>
              <span>Branch for a ticket you paste</span>
            </span>
          </button>
          <button
            role="tab"
            aria-selected={mode === 'create'}
            className={mode === 'create' ? 'on' : ''}
            disabled={!hasAccount}
            title={hasAccount ? undefined : 'Connect your Atlassian account in Settings → Accounts to create tickets'}
            onClick={() => setMode('create')}
          >
            <PlusIcon className="icon nb-mode-icon" />
            <span className="nb-mode-text">
              <b>New ticket</b>
              <span>Make the ticket, then its branch</span>
            </span>
          </button>
          {(candidate || hasCandidates) && (
            <button role="tab" aria-selected={release} className={release ? 'on' : ''} onClick={() => setMode('release')}>
              <TagIcon className="icon nb-mode-icon" />
              <span className="nb-mode-text">
                <b>New candidate</b>
                <span>Next {candidatePrefix}… and its version</span>
              </span>
            </button>
          )}
        </div>
      )}
      {release ? (
        <>
          <div className="field">
            <span className="field-label">Version</span>
            <div className="form-row nb-release-row">
              <VersionPicker value={version} onChange={setVersion} autoFocus />
              <span className="hint" title={bumpInfo ? `${bumpInfo.file} on ${base}` : `No version file on ${base}`}>
                now {baseVersion ?? '—'}
              </span>
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
                <span className="nb-seg-label">candidates</span>
                <span className="mono nb-fixed">{candidatePrefix}</span>
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
                : bump && canBump && version.trim()
                  ? `Then ${bumpInfo!.file.split('/').pop()} goes ${baseVersion || '?'} → ${version.trim()}, committed as “${bumpInfo!.message.replace('{version}', version.trim())}”${pushCandidate && pushRemote ? `, and it’s pushed to ${pushRemote}` : ''}.`
                  : `↑/↓ change the picked number (the ones after it go back to 0), ←/→ pick another, digits type one in.`}
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
