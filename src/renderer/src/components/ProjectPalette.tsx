// Spotlight-style project switcher, opened with Tab: remembered projects first, then git repos
// found in the scan folder that you haven't opened yet.
import { useEffect, useMemo, useRef, useState } from 'react'
import { forgetProject, fuzzyScore, projectName, tildify, useProjects } from '../projects'
import { useSettings } from '../settings'
import { CloudIcon, FolderIcon, LockIcon, SearchIcon } from './Icons'
import type { CloneableRepo } from '../../../shared/types'
import { useGitHubAccount } from '../github'
import { nameOf, sepOf, useCloneFolder, useCloneProtocol, useCloneSubmodules } from '../cloneDefaults'
import { cleanError, usePersistentState } from '../hooks'
import { requestSshSetup, sshTrouble } from '../sshHelp'
import { triedSubmodules } from './Submodules'
import { keys, mod } from '../platform'

interface Item {
  path: string
  name: string
  kind: 'project' | 'found' | 'github'
  missing: boolean
  open: boolean
  repo?: CloneableRepo
}

// Scan results survive closing the palette, so reopening it is instant; a fresh scan runs each time.
let scanCache: { key: string; paths: string[] } | null = null
// The GitHub account's repositories, the same way (fresh ones are asked for each time).
let ghCache: { login: string; repos: CloneableRepo[]; at: number } | null = null
/** How long the list is reused before it's asked for again (⌘R asks now). */
const GITHUB_TTL = 10 * 60_000
// Which GitHub repository each local one is (by its remote), so it isn't offered for cloning again.
const slugCache = new Map<string, string | null>()
/** GitHub repositories listed before anything is typed; typing searches them all. */
const GITHUB_UNTYPED = 8
const ago = (iso: string | null): string => {
  if (!iso) return ''
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)
  return days < 1 ? 'pushed today' : days === 1 ? 'pushed yesterday' : days < 60 ? `pushed ${days} days ago` : `pushed ${new Date(iso).toLocaleDateString()}`
}

interface Props {
  openTabs: string[]
  onOpen: (path: string) => void
  /** Pick any folder with the system dialog. */
  onBrowse: () => void
  /** Opens the Clone dialog, with a GitHub repository picked when one is given. */
  onClone: (repo?: CloneableRepo) => void
  onClose: () => void
}

export function ProjectPalette({ openTabs, onOpen, onBrowse, onClone, onClose }: Props) {
  const settings = useSettings()
  const projects = useProjects()
  const [query, setQuery] = useState('')
  // Only the GitHub repositories that aren't on this computer (⌘G).
  const [githubOnly, setGithubOnly] = useState(false)
  const [index, setIndex] = useState(0)
  const [home, setHome] = useState('')
  const [missing, setMissing] = useState<Set<string>>(new Set())
  const scanKey = `${settings.scanFolder}|${settings.scanDepth}|${settings.scanNested}`
  const [found, setFound] = useState<string[]>(scanCache?.key === scanKey ? scanCache.paths : [])
  const [scanning, setScanning] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  // The account's GitHub repositories, minus the ones already on this computer.
  const account = useGitHubAccount()
  const [ghRepos, setGhRepos] = useState<CloneableRepo[]>(account && ghCache?.login === account.login ? ghCache.repos : [])
  const [ghRefresh, setGhRefresh] = useState(0)
  // ⌘R (View → Refresh) while the search is open reloads the list from GitHub.
  useEffect(
    () =>
      window.spoon.onMenu((command) => {
        if (command === 'refresh') setGhRefresh((n) => n + 1)
      }),
    []
  )
  const [ghLoading, setGhLoading] = useState(false)
  useEffect(() => {
    if (!account) return setGhRepos([])
    if (!ghRefresh && ghCache?.login === account.login && Date.now() - ghCache.at < GITHUB_TTL) return
    // Remotes may have changed too: matched again with the fresh list.
    slugCache.clear()
    let live = true
    setGhLoading(true)
    window.spoon
      .ghCloneableRepos()
      .then(({ repos }) => {
        ghCache = { login: account.login, repos, at: Date.now() }
        if (live) setGhRepos(repos)
      })
      .catch(() => undefined)
      .finally(() => live && setGhLoading(false))
    return () => {
      live = false
    }
  }, [account?.login, ghRefresh]) // eslint-disable-line react-hooks/exhaustive-deps
  const [slugs, setSlugs] = useState<Set<string>>(() => new Set([...slugCache.values()].filter((v): v is string => !!v)))
  const localPaths = useMemo(() => [...projects.map((p) => p.path), ...found], [projects, found])
  useEffect(() => {
    if (!account) return
    const ask = localPaths.filter((p) => !slugCache.has(p))
    const done = (): void => setSlugs(new Set(localPaths.map((p) => slugCache.get(p)).filter((v): v is string => !!v)))
    if (!ask.length) return done()
    window.spoon
      .githubSlugs(ask)
      .then((got) => {
        ask.forEach((p, i) => slugCache.set(p, got[i]))
        done()
      })
      .catch(() => undefined)
  }, [localPaths, account])

  // Cloning in place: the picked repository's row opens (Enter), a second Enter clones it with the
  // usual defaults, ⌘Enter opens the Clone dialog for anything else.
  const { folder } = useCloneFolder(home, projects.map((p) => p.path))
  const [protocol] = useCloneProtocol()
  const [submodules] = useCloneSubmodules()
  const [branchMode] = usePersistentState<'latest' | 'develop' | 'name'>('spoon.clone.branchMode', 'latest')
  const [armed, setArmed] = useState<string | null>(null)
  const [clone, setClone] = useState<{ repo: CloneableRepo; dest: string; line: string; error?: string } | null>(null)
  const [destTaken, setDestTaken] = useState(false)
  const urlOf = (repo: CloneableRepo): string => (protocol === 'ssh' ? repo.sshUrl : repo.httpsUrl)
  const destOf = (repo: CloneableRepo): string => `${folder}${sepOf(folder)}${nameOf(urlOf(repo))}`
  const cloning = !!clone && !clone.error

  useEffect(() => {
    window.spoon.homeDir().then(setHome)
  }, [])

  useEffect(() => {
    window.spoon
      .pathsExist(projects.map((p) => p.path))
      .then((ok) => setMissing(new Set(projects.filter((_, i) => !ok[i]).map((p) => p.path))))
  }, [projects])

  useEffect(() => {
    if (!settings.scanFolder) return
    setScanning(true)
    window.spoon
      .scanRepos(settings.scanFolder, settings.scanDepth, settings.scanNested)
      .then((paths) => {
        scanCache = { key: scanKey, paths }
        setFound(paths)
      })
      .finally(() => setScanning(false))
  }, [scanKey, settings.scanFolder, settings.scanDepth, settings.scanNested])

  const items = useMemo(() => {
    const known = new Set(projects.map((p) => p.path))
    const all: Item[] = [
      ...projects.map((p) => ({
        path: p.path,
        name: projectName(p.path),
        kind: 'project' as const,
        missing: missing.has(p.path),
        open: openTabs.includes(p.path)
      })),
      ...found
        .filter((p) => !known.has(p))
        .map((p) => ({ path: p, name: projectName(p), kind: 'found' as const, missing: false, open: false }))
    ]
    const github: Item[] = ghRepos
      .filter((r) => !slugs.has(r.fullName.toLowerCase()))
      .map((r) => ({ path: `github:${r.fullName}`, name: r.fullName, kind: 'github' as const, missing: false, open: false, repo: r }))
    if (!query.trim()) return githubOnly ? github.slice(0, 300) : [...all, ...github.slice(0, GITHUB_UNTYPED)]
    const matching = (list: Item[], kindOrder: boolean): Item[] =>
      list
        .map((it) => ({ it, score: fuzzyScore(query, it.name, it.kind === 'github' ? (it.repo?.description ?? '') : tildify(it.path, home)) }))
        .filter((x): x is { it: Item; score: number } => x.score !== null)
        .sort((a, b) => b.score - a.score || (kindOrder ? Number(a.it.kind === 'found') - Number(b.it.kind === 'found') : 0))
        .map((x) => x.it)
    if (githubOnly) return matching(github, false).slice(0, 300)
    // What's on this computer first; GitHub's below it.
    return [...matching(all, true), ...matching(github, false).slice(0, 50)]
  }, [projects, found, missing, openTabs, query, home, ghRepos, slugs, githubOnly])
  const githubTotal = useMemo(() => ghRepos.filter((r) => !slugs.has(r.fullName.toLowerCase())).length, [ghRepos, slugs])

  useEffect(() => setIndex(0), [query, githubOnly])
  // The open clone row closes when the selection moves on.
  const active = items[index]
  useEffect(() => {
    if (!cloning && armed && active?.path !== `github:${armed}`) {
      setArmed(null)
      setClone(null)
    }
  }, [active?.path, armed, cloning])
  useEffect(() => {
    const repo = armed ? ghRepos.find((r) => r.fullName === armed) : null
    setDestTaken(false)
    if (repo) window.spoon.pathsExist([destOf(repo)]).then(([e]) => setDestTaken(e))
  }, [armed, folder, protocol]) // eslint-disable-line react-hooks/exhaustive-deps
  // git's progress lines for the clone under way.
  useEffect(() => {
    if (!cloning) return
    const dest = clone!.dest
    return window.spoon.onProgress((repo, line) => {
      if (repo === dest) setClone((c) => (c && c.dest === dest && !c.error ? { ...c, line } : c))
    })
  }, [cloning, clone?.dest]) // eslint-disable-line react-hooks/exhaustive-deps

  const startClone = async (repo: CloneableRepo): Promise<void> => {
    if (cloning || destTaken) return
    const dest = destOf(repo)
    setClone({ repo, dest, line: '' })
    try {
      // The Clone dialog's choice (a branch picked by name there means nothing here: latest commit).
      const { submoduleError, root } = await window.spoon.clone(urlOf(repo), dest, submodules, branchMode === 'develop' ? { kind: 'develop' } : { kind: 'latest' })
      // Submodules stopped with Esc stay stopped (the opened tab doesn't start them again); one that
      // failed is tried again, and explained, by the tab.
      // By both names: the tab may know the folder by its real path (a linked projects folder).
      if (submoduleError === 'Cancelled.') for (const p of [dest, root]) triedSubmodules.add(`${p}\0*`)
      onClose()
      onOpen(dest)
    } catch (err) {
      const message = cleanError(err)
      if (message === 'Cancelled.') setClone(null)
      else setClone({ repo, dest, line: '', error: message })
    }
  }
  const options = (repo: CloneableRepo): void => {
    if (cloning) return
    onClose()
    onClone(repo)
  }

  useEffect(() => {
    listRef.current?.querySelector('.palette-item.active')?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const choose = (it: Item | undefined): void => {
    if (!it || cloning) return
    if (it.kind === 'github' && it.repo) {
      if (armed === it.repo.fullName && !clone?.error) void startClone(it.repo)
      else {
        setClone(null)
        setArmed(it.repo.fullName)
      }
      return
    }
    onClose()
    onOpen(it.path)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (cloning) {
      // Only Escape does anything while cloning: it stops the clone (nothing is left of it), or, once the
      // repository is in, its submodules (the repository opens without them).
      if (e.key === 'Escape') window.spoon.cancel(clone!.dest)
      e.preventDefault()
      return
    }
    if (e.key === 'Enter' && mod(e) && active?.kind === 'github' && active.repo) {
      e.preventDefault()
      return options(active.repo)
    }
    if (mod(e) && e.key.toLowerCase() === 'g' && account) {
      e.preventDefault()
      setGithubOnly((g) => !g)
      return
    }
    if (e.key === 'Escape' && armed) {
      e.preventDefault()
      setArmed(null)
      setClone(null)
      return
    }
    if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault()
      setIndex((i) => Math.min(items.length - 1, i + 1))
    } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
      e.preventDefault()
      setIndex((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(items[index])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'Backspace' && mod(e) && items[index]?.kind === 'project') {
      e.preventDefault()
      forgetProject(items[index].path)
    }
  }

  // Section headers sit between the groups (GitHub's even while searching).
  const firstFound = query.trim() ? -1 : items.findIndex((it) => it.kind === 'found')
  const firstGitHub = items.findIndex((it) => it.kind === 'github')

  return (
    <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !cloning && onClose()}>
      <div className="palette" role="dialog" aria-label="Go to project">
        <div className="palette-input">
          <SearchIcon />
          <input
            autoFocus
            placeholder={githubOnly ? 'Search your GitHub repositories' : account ? 'Search projects and GitHub' : 'Search projects'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
          />
          {(scanning && !githubOnly) || ghLoading ? <span className="spinner" title={ghLoading ? 'Loading your GitHub repositories' : 'Scanning for repositories'} /> : null}
          {account && (
            <button
              className={`palette-scope ${githubOnly ? 'on' : ''}`}
              aria-pressed={githubOnly}
              title={`Only GitHub repositories that aren’t on this computer (${keys('⌘G')}). ${keys('⌘R')} reloads the list from GitHub.`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setGithubOnly((g) => !g)}
            >
              <CloudIcon className="icon" /> GitHub only <kbd className="soft">{keys('⌘G')}</kbd>
            </button>
          )}
        </div>

        <div className="palette-list" ref={listRef}>
          {!query.trim() && !githubOnly && projects.length > 0 && <div className="palette-section">Projects</div>}
          {items.map((it, i) => (
            <div key={it.path}>
              {i === firstFound && (
                <div className="palette-section">
                  Not opened yet <span className="palette-section-path">in {tildify(settings.scanFolder, home)}</span>
                </div>
              )}
              {i === firstGitHub && (
                <div className="palette-section">
                  On GitHub <span className="palette-section-path">not on this computer</span>
                </div>
              )}
              <div
                className={`palette-item ${i === index ? 'active' : ''} ${it.missing ? 'missing' : ''}`}
                onMouseMove={() => !cloning && setIndex(i)}
                onClick={() => choose(it)}
              >
                {it.kind === 'github' ? it.repo?.private ? <LockIcon className="icon" /> : <CloudIcon className="icon" /> : <FolderIcon />}
                <div className="palette-text">
                  <span className="palette-name">{it.name}</span>
                  <span className="palette-path">
                    {it.kind === 'github' ? [ago(it.repo?.pushedAt ?? null), it.repo?.description].filter(Boolean).join(' · ') : tildify(it.path, home)}
                  </span>
                </div>
                {it.open && <span className="badge">open</span>}
                {it.missing && <span className="badge danger">missing</span>}
                {it.kind === 'found' && <span className="badge accent-soft">new</span>}
                {it.kind === 'github' && <span className="badge accent-soft">clone</span>}
              </div>
              {it.kind === 'github' && it.repo && armed === it.repo.fullName && (
                <div className="palette-clone" onClick={(e) => e.stopPropagation()}>
                  {clone && !clone.error ? (
                    <>
                      <span className="spinner" />
                      <span className="palette-clone-line">{clone.line || 'Connecting…'}</span>
                      <span className="spacer" />
                      <button className="btn" onClick={() => window.spoon.cancel(clone.dest)}>
                        Cancel <kbd className="soft">esc</kbd>
                      </button>
                    </>
                  ) : clone?.error ? (
                    <>
                      <span className="palette-clone-error">
                        {sshTrouble(clone.error) ? 'This computer can’t reach GitHub over SSH yet.' : clone.error}
                      </span>
                      <span className="spacer" />
                      {sshTrouble(clone.error) && (
                        <button className="btn" onClick={() => (onClose(), requestSshSetup())}>
                          Set Up SSH Key…
                        </button>
                      )}
                      <button className="btn" onClick={() => setClone(null)}>
                        Try Again
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="palette-clone-dest" title={destOf(it.repo)}>
                        {destTaken ? (
                          <span className="warn-text">There’s already a {nameOf(urlOf(it.repo))} folder in {tildify(folder, home)}.</span>
                        ) : (
                          <>
                            Clone to <b>{tildify(destOf(it.repo), home)}</b>
                          </>
                        )}
                      </span>
                      <span className="badge">{branchMode === 'develop' ? 'develop' : 'latest-commit branch'}</span>
                      {submodules && <span className="badge">+ submodules</span>}
                      <span className="spacer" />
                      <button className="btn" onClick={() => options(it.repo!)}>
                        Options… <kbd className="soft">{keys('⌘↵')}</kbd>
                      </button>
                      <button className="btn primary" disabled={destTaken} onClick={() => startClone(it.repo!)}>
                        Clone <kbd className="soft">↵</kbd>
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
          {!query.trim() && !githubOnly && githubTotal > GITHUB_UNTYPED && (
            <div className="palette-more">
              Type to search all {githubTotal.toLocaleString()} of your GitHub repositories, or press {keys('⌘G')} to list only those.
            </div>
          )}
          {items.length === 0 && (
            <div className="palette-empty">
              {githubOnly
                ? query.trim()
                  ? `None of your GitHub repositories match “${query}”.`
                  : ghRepos.length
                    ? 'All your GitHub repositories are on this computer.'
                    : 'Loading your GitHub repositories…'
                : query.trim()
                  ? `No projects match “${query}”.`
                  : 'No projects yet. Browse for a folder below.'}
            </div>
          )}
        </div>

        <div className="palette-footer">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> move
          </span>
          {active?.kind === 'github' ? (
            <>
              <span>
                <kbd>↵</kbd> clone
              </span>
              <span>
                <kbd>{keys('⌘↵')}</kbd> options…
              </span>
            </>
          ) : (
            <>
              <span>
                <kbd>↵</kbd> open
              </span>
              <span>
                <kbd>{keys('⌘⌫')}</kbd> forget project
              </span>
            </>
          )}
          <span>
            <kbd>esc</kbd> close
          </span>
          <span className="spacer" />
          <button
            className="palette-browse"
            onClick={() => {
              onClose()
              onBrowse()
            }}
          >
            Browse for a folder… <kbd>{keys('⇧⌘O')}</kbd>
          </button>
          <button
            className="palette-browse"
            onClick={() => {
              onClose()
              onClone()
            }}
          >
            Clone…
          </button>
        </div>
      </div>
    </div>
  )
}
