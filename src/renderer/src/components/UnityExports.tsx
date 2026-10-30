// Sidebar "Exports" section for Unity repositories: native files in exported Android/iOS projects
// whose copy differs from their source (under Assets/ or in a local package), with Bring Back
// (export → source) and Relink (replace the copy with a link to the source), and files made in the
// exports with Add. Turned on per repository with "Link exports…". The watching, scanning and
// automatic bring-backs run in the background (exportsAgent.ts), whichever tab is showing; this
// shows their state. Sources in a submodule or a package's own repository change that repository,
// so the section offers a button to open it when they have changes.
import { useEffect, useState, type ReactNode } from 'react'
import type { ExportCandidate, ExportFolder, ExportLink, ExportNew, RepoState } from '../../../shared/types'
import { choose, confirm } from '../dialogs'
import { contextMenu } from '../menus'
import { requestCompare } from '../compare'
import { revealLabel } from '../platform'
import {
  addNew,
  bringBackNow,
  editedOf,
  markHandled,
  relink as relinkNow,
  setAuto,
  setDirs,
  skipNew,
  useExportsState,
  yours as yoursIn
} from '../exportsAgent'
import { ChildIcon } from './Icons'
import { Modal } from './Modal'
import { openFileEditor } from './FileEditor'

type Section = (key: string, title: string, count: number, body: ReactNode) => ReactNode

const fileName = (p: string): string => p.split('/').pop() ?? p
const PLATFORM = { android: 'Android', ios: 'iOS' } as const

interface Props {
  repo: RepoState
  section: Section
  query: string
  onOpenRepo: (path: string) => void
}

export function UnityExports({ repo, section, query, onOpenRepo }: Props): ReactNode {
  const path = repo.path
  const [unity, setUnity] = useState(false)
  const st = useExportsState(path)
  const { dirs, auto, links, added, error, dirty } = st
  const [linking, setLinking] = useState(false)
  const [adding, setAdding] = useState<ExportNew | null>(null)

  useEffect(() => {
    window.spoon.isUnityProject(path).then(setUnity, () => setUnity(false))
  }, [path])

  const edited = editedOf(st)
  const yours = (l: ExportLink): boolean => yoursIn(st, l)

  if (!unity) return null

  const abs = (rel: string): string => (rel.startsWith('/') ? rel : `${path}/${rel}`)
  // Changed sources in other repositories (a submodule such as Assets/MainLib, a local package): this
  // repository's Local Changes doesn't list them, so each gets a button that opens it.
  const elsewhere = new Map<string, number>()
  for (const l of links ?? []) if (l.sourceRepo !== path && dirty.has(l.sourcePath)) elsewhere.set(l.sourceRepo, (elsewhere.get(l.sourceRepo) ?? 0) + 1)
  const repoLabel = (dir: string): string => repo.submodules.find((sm) => `${path}/${sm.path}` === dir)?.name ?? dir.split('/').pop() ?? dir
  const q = query.trim().toLowerCase()
  const shown = edited.filter((l) => !q || l.export.toLowerCase().includes(q))
  const fresh = added.filter((n) => !st.skipped.includes(n.export) && (!q || n.export.toLowerCase().includes(q)))
  const newMenu = async (e: React.MouseEvent, n: ExportNew): Promise<void> => {
    e.preventDefault()
    const choice = await contextMenu([
      { id: 'add', label: 'Add to the Repository…' },
      { id: 'edit', label: 'Open in Spoon…' },
      { id: 'reveal', label: revealLabel },
      { separator: true },
      { id: 'skip', label: 'Leave Out' }
    ])
    if (choice === 'add') setAdding(n)
    else if (choice === 'edit') openFileEditor({ repo: path, file: n.export })
    else if (choice === 'reveal') window.spoon.revealInFinder(abs(n.export))
    else if (choice === 'skip') skipNew(path, n.export)
  }
  const copies = (links ?? []).filter((l) => l.state === 'same')
  const outdated = (links ?? []).filter((l) => l.state === 'source-newer').length
  const linkedCount = (links ?? []).filter((l) => l.state === 'linked').length

  const bringBack = async (list: ExportLink[]): Promise<boolean> => {
    const both = list.filter(yours)
    if (both.length) {
      const ok = await confirm({
        message: `Replace your uncommitted changes to ${both.length === 1 ? fileName(both[0].source) : `${both.length} files`}?`,
        detail: `${both.map((l) => l.source).join('\n')}\n\n${both.length === 1 ? 'It has' : 'They have'} uncommitted changes in the source. Bringing the export’s version back replaces them; commit or stash them first to keep them.`,
        confirmLabel: 'Bring Back',
        risky: true,
        enterConfirms: true
      })
      if (!ok) return false
    }
    return bringBackNow(path, list, list.length === 1 ? `Bringing back ${fileName(list[0].source)}…` : `Bringing back ${list.length} files…`)
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
    await relinkNow(path, list, force)
  }

  const menu = async (e: React.MouseEvent, l: ExportLink): Promise<void> => {
    e.preventDefault()
    const choice = await contextMenu([
      { id: 'compare', label: 'Compare Source with Export' },
      ...(l.sourceRepo === path ? [{ id: 'edit-src', label: 'Open Source File in Spoon…' }] : [{ id: 'open-repo', label: `Open ${repoLabel(l.sourceRepo)}` }]),
      { id: 'edit-exp', label: 'Open Export Copy in Spoon…' },
      { separator: true },
      { id: 'back', label: 'Bring Back to Source' },
      { id: 'ignore', label: 'Leave Source as It Is' },
      { id: 'relink', label: 'Replace Export Copy with a Link…' },
      { separator: true },
      { id: 'reveal-src', label: `${revealLabel}: Source` },
      { id: 'reveal-exp', label: `${revealLabel}: Export` }
    ])
    if (choice === 'compare') requestCompare(abs(l.source), abs(l.export))
    else if (choice === 'edit-src') openFileEditor({ repo: path, file: l.source })
    else if (choice === 'open-repo') onOpenRepo(l.sourceRepo)
    else if (choice === 'edit-exp') openFileEditor({ repo: path, file: l.export })
    else if (choice === 'back') bringBack([l])
    else if (choice === 'ignore') markHandled(path, [l])
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
        {links && shown.length === 0 && fresh.length === 0 && elsewhere.size === 0 && <div className="side-empty">No edits in the exports.</div>}
        {[...elsewhere].map(([dir, n]) => (
          <button
            key={dir}
            className="btn export-repo-btn"
            title={`${n} native ${n === 1 ? 'file the exports use has' : 'files the exports use have'} changes in ${dir}. Open it to commit them.`}
            onClick={() => onOpenRepo(dir)}
          >
            <ChildIcon /> Native changes in {repoLabel(dir)}
            <span className="badge accent">{n}</span>
          </button>
        ))}
        {shown.map((l) => (
          <div
            key={l.export}
            className="side-item"
            style={{ paddingLeft: '1.85rem' }}
            title={`Edited in the export:\n${l.export}\n${
              yours(l)
                ? `\n${l.source} has changes of yours too (uncommitted, or not tracked by git), so it isn’t replaced by itself.\n`
                : st.base[l.export] !== l.sourceHash
                  ? `\n${l.source} changed too since the two last matched (a pull, say), so it isn’t replaced by itself: compare them first.\n`
                  : ''
            }\nClick to compare; right-click for more.`}
            onClick={() => requestCompare(abs(l.source), abs(l.export))}
            onContextMenu={(e) => menu(e, l)}
          >
            <span className="export-state export-newer">↩</span>
            <span className="side-label">{fileName(l.export)}</span>
            {yours(l) && (
              <span className="badge warn" title="The source has changes of yours too (uncommitted, or not tracked by git)">
                both
              </span>
            )}
            <span className={`badge export-platform ${l.platform}`}>{PLATFORM[l.platform]}</span>
          </div>
        ))}
        {fresh.map((n) => (
          <div
            key={n.export}
            className="side-item"
            style={{ paddingLeft: '1.85rem' }}
            title={`Made in ${n.platform === 'ios' ? 'Xcode' : 'Android Studio'}, and not in the repository yet:\n${n.export}\n\n${n.certain ? '' : n.folders.length ? 'More than one folder could fit, or there’s no .meta to copy there, so it isn’t added by itself.\n' : 'Spoon can’t tell which folder it belongs in.\n'}Click to add it; right-click for more.`}
            onClick={() => setAdding(n)}
            onContextMenu={(e) => newMenu(e, n)}
          >
            <span className="export-state export-new">+</span>
            <span className="side-label">{fileName(n.export)}</span>
            <span className={`badge export-platform ${n.platform}`}>{PLATFORM[n.platform]}</span>
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
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(path, e.target.checked)} />
              Bring edits and new files back by themselves
            </label>
            <span
              className="exports-counts"
              title={`${copies.length + linkedCount} exported files match their source (${linkedCount} linked)${outdated ? `, ${outdated} out of date (changed in the source since the export)` : ''}.${copies.length > 0 && linkedCount === 0 ? ' Turn on Symlink Sources in Unity’s build settings and exports link back by themselves.' : ''}`}
            >
              {linkedCount} linked · {copies.length} copies{outdated > 0 ? ` · ${outdated} out of date` : ''}
            </span>
            {copies.length > 0 && (
              <button
                className="link-btn"
                title="Replace the copies that match their source with links to it"
                onClick={async () => {
                  const ok = await confirm({
                    message: `Link ${copies.length} exported file${copies.length === 1 ? '' : 's'} to their sources?`,
                    detail:
                      'Each copy that matches its source becomes a link to it, so edits in Android Studio or Xcode go straight into the repository. A new export from Unity replaces them again unless Symlink Sources is on.',
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
      {section('exports', 'Exports', shown.length + fresh.length, body)}
      {adding && (
        <AddToSourceDialog
          path={path}
          file={adding}
          label={repoLabel}
          onClose={() => setAdding(null)}
          onAdd={async (folder) => {
            const n = adding
            setAdding(null)
            const { ok, meta } = await addNew(path, n, folder)
            if (ok && !meta)
              await choose({
                title: `${fileName(n.export)} has no .meta file yet`,
                detail:
                  'There was no native file next to it to copy its plug-in settings from. Open the project in Unity once before committing, so Unity makes one (otherwise each teammate’s Unity makes its own).',
                buttons: [{ id: 'ok', label: 'OK', kind: 'primary' }],
                cancelId: 'ok'
              })
          }}
        />
      )}
      {linking && (
        <LinkExportsDialog
          path={path}
          linked={dirs}
          onClose={() => setLinking(false)}
          onSave={(next) => {
            setDirs(path, next)
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
        Matched by path (iOS Libraries/… ↔ Assets/… or a local package), by package and file name (Java, Kotlin) and
        by .androidlib folder. Unity’s generated files have no source and are left out.
      </p>
    </Modal>
  )
}

function AddToSourceDialog({
  path,
  file,
  label,
  onClose,
  onAdd
}: {
  path: string
  file: ExportNew
  /** A repository's name, as the Exports section shows it. */
  label: (repo: string) => string
  onClose: () => void
  onAdd: (folder: string) => void
}) {
  const [folders, setFolders] = useState<ExportFolder[]>(file.folders)
  const [picked, setPicked] = useState<string | null>(file.folders[0]?.id ?? null)
  const name = fileName(file.export)
  const chosen = folders.find((f) => f.id === picked)
  const other = async (): Promise<void> => {
    const dir = await window.spoon.pickFolder(`Folder for ${name}`)
    if (!dir) return
    // Inside this repository it's named relative to it; elsewhere (a package) by its full path.
    const inRepo = dir.startsWith(`${path}/`) ? dir.slice(path.length + 1) : null
    const f: ExportFolder = { id: inRepo ?? dir, repo: inRepo ? path : dir, rel: inRepo ?? '' }
    setFolders((list) => [...list.filter((x) => x.id !== f.id), f])
    setPicked(f.id)
  }
  const where = (f: ExportFolder): string => `${label(f.repo)}${f.rel ? ` / ${f.rel}` : ''}`
  return (
    <Modal
      title={`Add ${name} to the repository`}
      onClose={onClose}
      onSubmit={picked ? () => onAdd(picked) : undefined}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!picked} onClick={() => picked && onAdd(picked)}>
            {chosen ? `Add to ${label(chosen.repo)}` : 'Add'}
          </button>
        </>
      }
    >
      <p className="muted">
        Made in {file.platform === 'ios' ? 'Xcode' : 'Android Studio'}: <span className="mono export-path">{file.export}</span>
      </p>
      <div className="field">
        <span className="field-label">Put it in</span>
        {folders.length === 0 && <p className="muted">Spoon couldn’t tell where it belongs: choose a folder in Assets or a local package.</p>}
        {folders.length > 0 && (
        <div className="blocked-files">
          {folders.map((f, i) => (
            <label key={f.id} className="check blocked-file">
              <input type="radio" name="add-folder" checked={picked === f.id} onChange={() => setPicked(f.id)} />
              <span className="mono">{where(f)}</span>
              {i === 0 && file.folders[0]?.id === f.id && <span className="badge accent-soft">where the files next to it come from</span>}
            </label>
          ))}
        </div>
        )}
        <button className="link-btn add-other-folder" onClick={other}>
          Choose another folder…
        </button>
      </div>
      <p className="hint">
        Spoon copies it there with a .meta file (copied from a file next to it, so it gets the same platforms, with a GUID
        of its own), and the export’s copy becomes a link to it. It then shows up in {chosen ? label(chosen.repo) : 'that repository'}’s
        Local Changes, ready to commit.
      </p>
    </Modal>
  )
}
