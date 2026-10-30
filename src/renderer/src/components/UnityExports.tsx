// Sidebar "Exports" section for Unity repositories: native files in exported Android/iOS projects
// whose copy differs from their source under Assets/, with Bring Back (export → Assets) and Relink
// (replace the copy with a link to Assets). Turned on per repository with "Link exports…".
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { ExportCandidate, ExportLink, RepoState } from '../../../shared/types'
import { usePersistentState } from '../hooks'
import { confirm } from '../dialogs'
import { contextMenu } from '../menus'
import { requestCompare } from '../compare'
import { revealLabel } from '../platform'
import { Modal } from './Modal'
import { openFileEditor } from './FileEditor'
import type { Ops } from './RepoView'

type Section = (key: string, title: string, count: number, body: ReactNode) => ReactNode

const fileName = (p: string): string => p.split('/').pop() ?? p
const PLATFORM = { android: 'Android', ios: 'iOS' } as const

interface Props {
  repo: RepoState
  ops: Ops
  section: Section
  query: string
}

export function UnityExports({ repo, ops, section, query }: Props): ReactNode {
  const path = repo.path
  const [unity, setUnity] = useState(false)
  const [dirs, setDirs] = usePersistentState<string[] | null>(`spoon.exports.${path}`, null)
  // Edits in an export are copied into Assets by themselves (and show up as unstaged changes).
  const [auto, setAuto] = usePersistentState(`spoon.exports.auto.${path}`, true)
  // Export edits already brought back or set aside, by the export copy's save time: an edit isn't
  // brought back twice (say, after you discarded it in Local Changes) until the export is saved again.
  const [handled, setHandled] = usePersistentState<Record<string, number>>(`spoon.exports.handled.${path}`, {})
  // Sources Spoon brought back, by their save time then: still that time = not edited in Assets since.
  const [wrote, setWrote] = usePersistentState<Record<string, number>>(`spoon.exports.wrote.${path}`, {})
  const [links, setLinks] = useState<ExportLink[] | null>(null)
  // Sources under Assets with uncommitted changes: an export edit never overwrites those by itself.
  const [dirty, setDirty] = useState<Set<string>>(new Set())
  const [recent, setRecent] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [linking, setLinking] = useState(false)
  const applying = useRef(false)
  // Automatic bring-backs that failed, by the export copy's save time: not tried again (and the error
  // not shown again) until the export is saved again.
  const failed = useRef<Record<string, number>>({})

  useEffect(() => {
    window.spoon.isUnityProject(path).then(setUnity, () => setUnity(false))
  }, [path])

  const scan = useCallback(async () => {
    if (!dirs?.length) return setLinks(null)
    try {
      const found = await window.spoon.scanExports(path, dirs)
      // The repository's status leaves out changes inside submodules (Assets/MainLib…), so sources in
      // a submodule are checked against that submodule's own status.
      const trees = [{ prefix: '', dir: path }]
      for (const sm of repo.submodules)
        if (found.some((l) => l.source.startsWith(`${sm.path}/`))) trees.push({ prefix: `${sm.path}/`, dir: `${path}/${sm.path}` })
      const changed = new Set<string>()
      for (const t of trees) {
        const tree = await window.spoon.workingTree(t.dir).catch(() => ({ staged: [], unstaged: [] }))
        for (const f of [...tree.staged, ...tree.unstaged]) changed.add(t.prefix + f.path)
      }
      setDirty(changed)
      setLinks(found)
      setError(null)
    } catch (err) {
      setError(String((err as Error).message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, dirs, repo.submodules.map((sm) => sm.path).join('\n')])
  // Again after every refresh of the repository (a commit, a checkout), on coming back to the window,
  // and whenever a native file in a linked export is saved (they're watched).
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => {
    if (!unity) return
    clearTimeout(timer.current)
    timer.current = setTimeout(scan, 300)
    return () => clearTimeout(timer.current)
  }, [unity, scan, repo])
  useEffect(() => {
    if (!unity || !dirs?.length) return
    window.spoon.watchExports(path, dirs)
    const off = window.spoon.onExportsChanged((repoPath) => repoPath === path && scan())
    const onFocus = (): void => void scan()
    window.addEventListener('focus', onFocus)
    return () => {
      off()
      window.removeEventListener('focus', onFocus)
      window.spoon.watchExports(path, [])
    }
  }, [unity, path, dirs, scan])

  const markHandled = (list: ExportLink[]): void =>
    setHandled((h) => ({ ...h, ...Object.fromEntries(list.map((l) => [l.export, l.exportMtime])) }))
  const bringBackNow = (list: ExportLink[], label: string, auto = false): Promise<boolean> =>
    ops.run(
      label,
      async () => {
        const times: Record<string, number> = {}
        for (const l of list) times[l.source] = await window.spoon.exportBringBack(path, l.export, l.source)
        setWrote((w) => ({ ...w, ...times }))
      },
      'Bring back failed'
    ).then((ok) => {
      if (ok) {
        markHandled(list)
        setRecent((r) => [...new Set([...list.map((l) => l.source), ...r])].slice(0, 6))
      } else if (auto) for (const l of list) failed.current[l.export] = l.exportMtime
      scan()
      return ok
    })

  // Edits made in Xcode or Android Studio: newer than Assets, and not brought back or set aside yet.
  const edited = (links ?? []).filter((l) => l.state === 'export-newer' && handled[l.export] !== l.exportMtime)

  // Uncommitted changes in Assets that only Spoon made don't count: those are earlier bring-backs.
  const yours = (l: ExportLink): boolean => dirty.has(l.source) && wrote[l.source] !== l.sourceMtime

  useEffect(() => {
    if (!auto || applying.current) return
    const ready = edited.filter((l) => !yours(l) && failed.current[l.export] !== l.exportMtime)
    if (!ready.length) return
    applying.current = true
    bringBackNow(
      ready,
      ready.length === 1 ? `Bringing back ${fileName(ready[0].source)} from the export…` : `Bringing back ${ready.length} files from exports…`,
      true
    ).finally(
      () => (applying.current = false)
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [links, auto])

  if (!unity) return null

  const abs = (rel: string): string => `${path}/${rel}`
  // Sources inside a submodule (Assets/MainLib…) change that submodule: the parent's Local Changes
  // only lists the submodule itself.
  const subOf = (src: string): string | null => repo.submodules.find((sm) => src.startsWith(`${sm.path}/`))?.name ?? null
  const recentSubs = [...new Set(recent.map(subOf).filter((x): x is string => !!x))]
  const linkedSubs = [...new Set((links ?? []).filter((l) => l.state === 'linked').map((l) => subOf(l.source)).filter((x): x is string => !!x))]
  const q = query.trim().toLowerCase()
  const shown = edited.filter((l) => !q || l.export.toLowerCase().includes(q))
  const copies = (links ?? []).filter((l) => l.state === 'same')
  const outdated = (links ?? []).filter((l) => l.state === 'source-newer').length
  const linkedCount = (links ?? []).filter((l) => l.state === 'linked').length

  const bringBack = async (list: ExportLink[]): Promise<boolean> => {
    const both = list.filter(yours)
    if (both.length) {
      const ok = await confirm({
        message: `Replace your uncommitted changes to ${both.length === 1 ? fileName(both[0].source) : `${both.length} files`}?`,
        detail: `${both.map((l) => l.source).join('\n')}\n\n${both.length === 1 ? 'It has' : 'They have'} changes in Assets that aren’t committed. Bringing the export’s version back replaces them; commit or stash them first to keep them.`,
        confirmLabel: 'Bring Back',
        risky: true,
        enterConfirms: true
      })
      if (!ok) return false
    }
    return bringBackNow(list, list.length === 1 ? `Bringing back ${fileName(list[0].source)}…` : `Bringing back ${list.length} files…`)
  }
  const relink = async (list: ExportLink[], force = false): Promise<void> => {
    if (force) {
      const ok = await confirm({
        message: `Replace the export’s copy of ${fileName(list[0].export)} with a link?`,
        detail: `The export’s copy differs from ${list[0].source}; it’s thrown away and the export uses the version in Assets from now on.`,
        confirmLabel: 'Relink',
        risky: true,
        enterConfirms: true
      })
      if (!ok) return
    }
    await ops.run(
      list.length === 1 ? `Linking ${fileName(list[0].export)}…` : `Linking ${list.length} files…`,
      async () => {
        for (const l of list) await window.spoon.exportRelink(path, l.export, l.source, force)
      },
      'Relink failed'
    )
    scan()
  }

  const menu = async (e: React.MouseEvent, l: ExportLink): Promise<void> => {
    e.preventDefault()
    const choice = await contextMenu([
      { id: 'compare', label: 'Compare Assets with Export' },
      { id: 'edit-src', label: 'Open Assets File in Spoon…' },
      { id: 'edit-exp', label: 'Open Export Copy in Spoon…' },
      { separator: true },
      { id: 'back', label: 'Bring Back to Assets' },
      { id: 'ignore', label: 'Leave Assets as It Is' },
      { id: 'relink', label: 'Replace Export Copy with a Link…' },
      { separator: true },
      { id: 'reveal-src', label: `${revealLabel}: Assets` },
      { id: 'reveal-exp', label: `${revealLabel}: Export` }
    ])
    if (choice === 'compare') requestCompare(abs(l.source), abs(l.export))
    else if (choice === 'edit-src') openFileEditor({ repo: path, file: l.source })
    else if (choice === 'edit-exp') openFileEditor({ repo: path, file: l.export })
    else if (choice === 'back') bringBack([l])
    else if (choice === 'ignore') markHandled([l])
    else if (choice === 'relink') relink([l], true)
    else if (choice === 'reveal-src') window.spoon.revealInFinder(abs(l.source))
    else if (choice === 'reveal-exp') window.spoon.revealInFinder(abs(l.export))
  }

  let body: ReactNode
  if (!dirs) {
    body = (
      <div className="side-empty">
        Bring edits made in Android Studio or Xcode back into Assets: Spoon pairs the native files in exported projects
        with their sources.{' '}
        <button className="link-btn" onClick={() => setLinking(true)}>
          Link exports…
        </button>
      </div>
    )
  } else {
    body = (
      <div className="exports">
        {error && <div className="side-empty error-text">{error}</div>}
        {links && shown.length === 0 && recent.length === 0 && <div className="side-empty">No edits in the exports.</div>}
        {recent.length > 0 && (
          <div className="side-empty">
            Brought back: {recent.map(fileName).join(', ')}.{' '}
            {recentSubs.length
              ? `They’re in Local Changes${recentSubs.length < recent.length ? ', or' : ''} in the ${recentSubs.join(', ')} submodule${recentSubs.length === 1 ? '' : 's'} (open it from Submodules).`
              : 'They’re in Local Changes.'}
          </div>
        )}
        {shown.map((l) => (
          <div
            key={l.export}
            className="side-item"
            style={{ paddingLeft: '1.85rem' }}
            title={`Edited in the export:\n${l.export}\n${
              yours(l) ? `\n${l.source} has uncommitted changes too, so it wasn’t replaced by itself.\n` : ''
            }\nClick to compare; right-click for more.`}
            onClick={() => requestCompare(abs(l.source), abs(l.export))}
            onContextMenu={(e) => menu(e, l)}
          >
            <span className="export-state export-newer">↩</span>
            <span className="side-label">{fileName(l.export)}</span>
            {yours(l) && (
              <span className="badge warn" title="Assets has uncommitted changes to it too">
                both
              </span>
            )}
            <span className={`badge export-platform ${l.platform}`}>{PLATFORM[l.platform]}</span>
          </div>
        ))}
        {shown.length > 0 && (
          <div className="stale-actions">
            <button className="btn primary" onClick={() => bringBack(shown)} title="Copy the exports' edits into Assets">
              Bring back {shown.length}
            </button>
          </div>
        )}
        {links && (
          <div className="side-empty exports-summary">
            <label className="check exports-auto">
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
              Bring edits back by themselves
            </label>
            {copies.length + linkedCount} exported files match Assets ({linkedCount} linked)
            {outdated > 0 && `, ${outdated} out of date (changed in Assets since the export)`}.
            {copies.length > 0 && linkedCount === 0 && (
              <> Turn on Symlink Sources in Unity’s build settings and exports link back by themselves.</>
            )}
            {linkedSubs.length > 0 && (
              <>
                {' '}
                Edits to linked files in {linkedSubs.join(', ')} show up in {linkedSubs.length === 1 ? 'that submodule' : 'those submodules'}, not
                here.
              </>
            )}{' '}
            {copies.length > 0 && (
              <button
                className="link-btn"
                title="Replace the copies that match Assets with links to it"
                onClick={async () => {
                  const ok = await confirm({
                    message: `Link ${copies.length} exported file${copies.length === 1 ? '' : 's'} to Assets?`,
                    detail:
                      'Each copy that matches its source in Assets becomes a link to it, so edits in Android Studio or Xcode go straight into the repository. A new export from Unity replaces them again unless Symlink Sources is on.',
                    confirmLabel: 'Relink',
                    enterConfirms: true
                  })
                  if (ok) relink(copies)
                }}
              >
                Relink {copies.length}…
              </button>
            )}{' '}
            <button className="link-btn" onClick={() => setLinking(true)}>
              Change exports…
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      {section('exports', 'Exports', shown.length, body)}
      {linking && (
        <LinkExportsDialog
          path={path}
          linked={dirs}
          onClose={() => setLinking(false)}
          onSave={(next) => {
            setDirs(next)
            setLinking(false)
          }}
        />
      )}
    </>
  )
}

function LinkExportsDialog({
  path,
  linked,
  onClose,
  onSave
}: {
  path: string
  linked: string[] | null
  onClose: () => void
  onSave: (dirs: string[] | null) => void
}) {
  const [found, setFound] = useState<ExportCandidate[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  useEffect(() => {
    window.spoon.findExports(path).then(
      (list) => {
        setFound(list)
        setPicked(new Set(linked ?? list.filter((c) => c.files > 0).map((c) => c.dir)))
      },
      (err) => setError(String(err))
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])
  const toggle = (dir: string): void =>
    setPicked((p) => {
      const n = new Set(p)
      if (n.has(dir)) n.delete(dir)
      else n.add(dir)
      return n
    })
  const save = (): void => onSave(picked.size ? [...picked] : null)

  return (
    <Modal
      title="Link exports to Unity sources"
      onClose={onClose}
      onSubmit={found ? save : undefined}
      pending={!found && !error}
      footer={
        <>
          {linked && (
            <button className="btn nb-checkout" onClick={() => onSave(null)}>
              Unlink all
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save} disabled={!found}>
            {picked.size ? `Link ${picked.size} export${picked.size === 1 ? '' : 's'}` : 'Save'}
          </button>
        </>
      }
    >
      {error && <p className="error-text">{error}</p>}
      {found && found.length === 0 && (
        <p className="muted">
          No exported projects found. Spoon looks for Android exports (a folder with unityLibrary) and Xcode projects
          inside this repository, e.g. Builds/Android and Builds/iOS.
        </p>
      )}
      {found && found.length > 0 && (
        <div className="blocked-files">
          {found.map((c) => (
            <label key={c.dir} className="check blocked-file">
              <input type="checkbox" checked={picked.has(c.dir)} onChange={() => toggle(c.dir)} />
              <span className={`badge export-platform ${c.platform}`}>{PLATFORM[c.platform]}</span>
              <span className="mono">{c.dir}</span>
              <span className="hint export-count">
                {c.files} file{c.files === 1 ? '' : 's'} → Assets
              </span>
            </label>
          ))}
        </div>
      )}
      <p className="hint">
        Matched by path (iOS Libraries/… ↔ Assets/…), by package and file name (Java, Kotlin) and by .androidlib folder.
        Unity’s generated files have no source in Assets and are left out.
      </p>
    </Modal>
  )
}
