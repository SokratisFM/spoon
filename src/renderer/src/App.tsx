import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { MenuCommand } from '../../shared/types'
import { cleanError, usePersistentState } from './hooks'
import { getSettings, resetScale, SCALE_STEP, updateSettings, useSettings } from './settings'
import { ideSchemes } from './syntax'
import { RepoView } from './components/RepoView'
import { GitHistoryDialog } from './components/GitHistoryDialog'
import { warmTabs } from './repoCache'
import { SettingsWindow, type SettingsTab } from './components/SettingsWindow'
import { askPin, PinHost, setSimpleConfig, useSimpleConfig } from './simpleMode'
import { runAgents, useLinkedExports } from './exportsAgent'
import { Welcome } from './components/Welcome'
import { ProjectPalette } from './components/ProjectPalette'
import { BoxIcon, ChildIcon, CloseIcon, CogIcon, CompareIcon, FolderIcon, NewBranchIcon, PlusIcon, SearchIcon, TerminalHistoryIcon } from './components/Icons'
import { choose, confirm, DialogHost } from './dialogs'
import { unsavedEdits } from './components/FileEditor'
import { forgetProject, projectName, rememberProject, useProjects } from './projects'
import { keys, revealLabel } from './platform'
import { useAppInfo, useUpdateState } from './appinfo'
import { closeMenu, contextMenu, MenuHost } from './menus'
import { COMPARE_TEXT, compareFiles, compareTab, compareTextId, fileName, forgetText, liveText, textKey, unforgetText } from './compare'
import * as storage from './storage'
import { TextCompareView } from './components/TextCompareView'
import { WhatsNewDialog } from './components/WhatsNewDialog'
import { changelog, newerVersion } from './whatsNew'
import { CompareView } from './components/CompareView'
import { CompareDialog } from './components/CompareDialog'

export function App() {
  const settings = useSettings()
  const [tabs, setTabs] = usePersistentState<string[]>('spoon.tabs', [])
  const [active, setActive] = usePersistentState<string | null>('spoon.activeTab', null)
  const projects = useProjects()
  const update = useUpdateState()
  const appVersion = useAppInfo()?.version ?? null

  // What's New opens by itself once after an update, with what changed since the version you had.
  // Not on a first install; someone updating from before this existed sees just the newest version.
  useEffect(() => {
    if (!appVersion) return
    const seen = storage.getItem('spoon.whatsNew.seen')
    storage.setItem('spoon.whatsNew.seen', appVersion)
    if (seen && !newerVersion(appVersion, seen)) return
    if (!seen) {
      const usedBefore = storage.getItem('spoon.tabs') !== null || storage.getItem('spoon.settings') !== null
      if (!usedBefore) return
      const previous = changelog().find((v) => v.version && newerVersion(appVersion, v.version))?.version
      if (previous) setWhatsNew({ since: previous })
      return
    }
    setWhatsNew({ since: seen })
  }, [appVersion])
  useEffect(() => {
    const open = (): void => setWhatsNew({ since: null })
    window.addEventListener('spoon:whats-new', open)
    return () => window.removeEventListener('spoon:whats-new', open)
  }, [])
  const [palette, setPalette] = useState(false)
  const [gitHistory, setGitHistory] = useState(false)
  // What's New: since = the version updated from (only what's newer shows first); null = everything.
  const [whatsNew, setWhatsNew] = useState<{ since: string | null } | null>(null)
  const [missing, setMissing] = useState<{ path: string; missing: boolean } | null>(null)
  const [command, setCommand] = useState<{ name: MenuCommand; n: number } | null>(null)
  const [settingsWindow, setSettingsWindow] = useState<false | SettingsTab>(false)
  const settingsOpen = useRef(false)
  settingsOpen.current = !!settingsWindow
  const [toast, setToast] = useState<string | null>(null)

  const current = active && tabs.includes(active) ? active : null
  const currentMissing = !!current && missing?.path === current && missing.missing
  const currentCompare = current ? compareFiles(current) : null
  const currentText = current ? compareTextId(current) : null
  const simple = useSimpleConfig(current)
  // For the menu handler, which is set up once.
  const simpleOnRef = useRef(false)
  simpleOnRef.current = !!simple?.on
  /** Compare and Text compare tabs aren't repositories. */
  const isRepoTab = (t: string): boolean => !compareFiles(t) && !compareTextId(t)
  // Unity exports are watched (and edits made in them brought back) for every open repository that
  // has them linked, and for the Unity project a submodule tab (Assets/MainLib) is part of.
  const linked = useLinkedExports()
  const exportRepos = [
    ...new Set(
      tabs.filter(isRepoTab).flatMap((t) => {
        const up: string[] = []
        for (let p = t; p.includes('/') && p !== '/'; p = p.slice(0, p.lastIndexOf('/')) || '/') up.push(p)
        return up.filter(linked)
      })
    )
  ]
  useEffect(() => runAgents(exportRepos), [exportRepos.join('\n')]) // eslint-disable-line react-hooks/exhaustive-deps

  // Comparing two files: a Compare tab, from the menu's picker, a drop on the window or any part of
  // the app (requestCompare).
  const [comparing, setComparing] = useState(false)
  const comparingRef = useRef(comparing)
  comparingRef.current = comparing
  const [home, setHome] = useState('')
  useEffect(() => {
    window.spoon.homeDir().then(setHome)
  }, [])
  const openCompare = useCallback(
    (a: string, b: string, replace?: string) => {
      const key = compareTab(a, b)
      setTabs((t) => (t.includes(key) ? t.filter((x) => x !== replace) : replace ? t.map((x) => (x === replace ? key : x)) : [...t, key]))
      setActive(key)
    },
    [setTabs, setActive]
  )
  const openTextCompare = useCallback(
    (from: string, to: string) => {
      const id = Date.now().toString(36)
      storage.setItem(textKey(id), JSON.stringify({ from, to }))
      setTabs((t) => [...t, COMPARE_TEXT + id])
      setActive(COMPARE_TEXT + id)
    },
    [setTabs, setActive]
  )
  useEffect(() => {
    const on = (e: Event): void => {
      const [a, b] = (e as CustomEvent<[string, string]>).detail
      openCompare(a, b)
    }
    window.addEventListener('spoon:compare', on)
    return () => window.removeEventListener('spoon:compare', on)
  }, [openCompare])
  // Files dragged over the window: drop two to compare them, or one now and one after.
  const [dropping, setDropping] = useState(false)
  const [firstDropped, setFirstDropped] = useState<string | null>(null)
  const firstDroppedRef = useRef(firstDropped)
  firstDroppedRef.current = firstDropped
  useEffect(() => {
    const hasFiles = (e: DragEvent): boolean => !!e.dataTransfer?.types.includes('Files')
    let depth = 0
    const enter = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      depth++
      setDropping(true)
    }
    const leave = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      if (--depth <= 0) {
        depth = 0
        setDropping(false)
      }
    }
    const over = (e: DragEvent): void => {
      if (hasFiles(e)) e.preventDefault()
    }
    // Any drop or cancelled drag ends the overlay, even one a Compare Files slot takes for itself.
    const end = (): void => {
      depth = 0
      setDropping(false)
    }
    const drop = (e: DragEvent): void => {
      if (!hasFiles(e) || e.defaultPrevented) return
      // With Compare Files open, only its slots take files.
      if (comparingRef.current) return e.preventDefault()
      e.preventDefault()
      const paths = [...(e.dataTransfer?.files ?? [])].map((f) => window.spoon.pathForFile(f)).filter(Boolean)
      if (paths.length >= 2) {
        setFirstDropped(null)
        openCompare(paths[0], paths[1])
      } else if (paths[0]) {
        const first = firstDroppedRef.current
        if (first && first !== paths[0]) {
          setFirstDropped(null)
          openCompare(first, paths[0])
        } else setFirstDropped(paths[0])
      }
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    window.addEventListener('drop', end, true)
    window.addEventListener('dragend', end, true)
    return () => {
      window.removeEventListener('drop', end, true)
      window.removeEventListener('dragend', end, true)
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [openCompare])

  const dropTab = useCallback(
    (path: string) => {
      const textId = compareTextId(path)
      if (textId) forgetText(textId, (k) => storage.removeItem(k))
      setTabs((t) => {
        const i = t.indexOf(path)
        const next = t.filter((p) => p !== path)
        setActive((a) => (a === path ? (next[Math.min(i, next.length - 1)] ?? null) : a))
        return next
      })
    },
    [setTabs, setActive]
  )

  const openRepo = useCallback(
    async (path: string): Promise<void> => {
      const [exists] = await window.spoon.pathsExist([path])
      if (!exists) return resolveMissing(path)
      try {
        const repo = await window.spoon.openRepo(path)
        if (repo.path !== path) forgetProject(path) // opened a subfolder: remember the repo root instead
        setTabs((t) => (t.includes(repo.path) ? t : [...t, repo.path]))
        rememberProject(repo.path)
        setActive(repo.path)
      } catch (err) {
        const msg = cleanError(err)
        setToast(
          /not permitted|permission denied/i.test(msg)
            ? 'macOS hasn’t given Spoon access to this folder. Allow it in System Settings → Privacy & Security → Files and Folders, then try again.'
            : msg
        )
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setTabs, setActive]
  )

  /** Like Fork: a project that's gone can be removed from the list or pointed at its new location. */
  const resolveMissing = async (path: string): Promise<void> => {
    const choice = await choose({
      title: `“${projectName(path)}” can’t be found`,
      detail: `${path}\n\nIt may have been moved, renamed or deleted.`,
      cancelId: 'cancel',
      buttons: [
        { id: 'cancel', label: 'Cancel' },
        { id: 'locate', label: 'Locate…' },
        { id: 'remove', label: 'Remove from Spoon', kind: 'primary' }
      ]
    })
    if (choice === 'remove') {
      forgetProject(path)
      dropTab(path)
    } else if (choice === 'locate') {
      const found = await window.spoon.pickFolder(`Locate ${projectName(path)}`)
      if (!found) return
      forgetProject(path)
      dropTab(path)
      openRepo(found)
    }
  }

  const pickRepo = useCallback(async () => {
    const path = await window.spoon.pickRepo()
    if (path) openRepo(path)
  }, [openRepo])

  // A tab restored at startup may point at a folder that has since been moved or deleted.
  useEffect(() => {
    if (!current || !isRepoTab(current)) return setMissing(null)
    // Each answer says which tab it's about: a slow one for a tab already switched away from is ignored.
    window.spoon.pathsExist([current]).then(([ok]) => setMissing({ path: current, missing: !ok }))
  }, [current])

  useEffect(() => window.spoon.setMenuItemVisible('review', settings.claudeEnabled), [settings.claudeEnabled])

  // A menu belongs to the tab it was opened in; its choice must never act on another repo.
  useEffect(() => void closeMenu(), [current])

  // Once the visible tab has had its turn, load the others in the background so switching is instant.
  useEffect(() => {
    // Only repository tabs: Compare tabs aren't repositories.
    warmTabs(tabs.filter(isRepoTab), current && isRepoTab(current) ? current : null)
  }, [tabs, current])

  // Tab opens the project palette, unless you're typing or a dialog is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab' || e.metaKey || e.ctrlKey || e.altKey || palette) return
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select, [contenteditable="true"]')) return
      if (document.querySelector('.modal-backdrop, .popover')) return
      e.preventDefault()
      setPalette(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [palette])

  // Closed tabs, newest last, so ⌘Z can bring them back: each close is one step (Close Other Tabs
  // closes several at once), with where each tab was and what a Text compare tab held.
  const closed = useRef<{ path: string; index: number; text: string | null }[][]>([])
  const closeTabs = (paths: string[]): void => {
    if (!paths.length) return
    closed.current.push(
      paths.map((p) => {
        const id = compareTextId(p)
        return { path: p, index: tabs.indexOf(p), text: id ? (liveText(id) ?? storage.getItem(textKey(id))) : null }
      })
    )
    if (closed.current.length > 30) closed.current.shift()
    if (paths.length === 1) return dropTab(paths[0])
    for (const p of paths) {
      const id = compareTextId(p)
      if (id) forgetText(id, (k) => storage.removeItem(k))
    }
    const keep = tabs.filter((p) => !paths.includes(p))
    setTabs(keep)
    if (current && paths.includes(current)) setActive(keep[0] ?? null)
  }
  const closeTab = (path: string): void => closeTabs([path])
  const reopenClosed = (): boolean => {
    const step = closed.current.pop()
    if (!step) return false
    const back = step.filter((x) => !tabs.includes(x.path))
    for (const x of back) {
      const id = compareTextId(x.path)
      if (id) unforgetText(id, x.text, (k, v) => storage.setItem(k, v))
    }
    setTabs((t) => {
      const next = [...t]
      for (const x of [...back].sort((a, b) => a.index - b.index)) next.splice(Math.min(Math.max(x.index, 0), next.length), 0, x.path)
      return next
    })
    if (back.length) setActive(back[0].path)
    return true
  }
  const reopenRef = useRef(reopenClosed)
  reopenRef.current = reopenClosed
  // ⌘Z / Ctrl+Z outside a text field (and with no dialog open) reopens the last closed tab(s); in a
  // field it's the field's own undo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'z') return
      const t = e.target as HTMLElement | null
      if (t?.closest('input, textarea, select, [contenteditable], .cm-editor')) return
      if (document.querySelector('.modal-backdrop, .palette-backdrop, .ctx-layer')) return
      if (reopenRef.current()) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ⌘W / Ctrl+W: dismiss an open dialog first, then close the current tab; with only one tab (or
  // none) left, close the window instead, as its close button would. The last tab is kept so it
  // reopens next time.
  const closeTabOrWindow = (): void => {
    if (closeMenu()) return // an open menu goes first, like a dialog
    const overlay = document.querySelector('.modal-backdrop, .palette-backdrop, .popover')
    if (overlay) {
      // Once, from the focused element: it bubbles up to window, so listeners there get it too (two
      // would ask "Close without saving?" twice).
      ;(document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      return
    }
    if (current && tabs.length > 1) closeTab(current)
    else window.spoon.closeWindow()
  }
  const closeRef = useRef(closeTabOrWindow)
  closeRef.current = closeTabOrWindow

  // ---- drag to reorder: a submodule group moves as one unit ----
  const [drag, setDrag] = useState<{ unit: string; over?: string; after?: boolean } | null>(null)
  const moveUnit = (unitPaths: string[], targetPaths: string[], after: boolean): void => {
    setTabs((t) => {
      const rest = t.filter((p) => !unitPaths.includes(p))
      const anchor = after ? targetPaths[targetPaths.length - 1] : targetPaths[0]
      let at = rest.indexOf(anchor)
      if (at === -1) return t
      if (after) at += 1
      return [...rest.slice(0, at), ...unitPaths, ...rest.slice(at)]
    })
  }

  // Which open tabs are submodules, and of what. Re-checked when the tab list changes.
  const [parents, setParents] = useState<Record<string, string | null>>({})
  useEffect(() => {
    const repos = tabs.filter(isRepoTab)
    window.spoon.repoParents(repos).then((ps) => setParents(Object.fromEntries(repos.map((t, i) => [t, ps[i]]))))
  }, [tabs])

  const tab = (path: string, variant: 'plain' | 'child' | 'labelled') => {
    const files = compareFiles(path)
    const textTab = !!compareTextId(path)
    const name = files ? `${fileName(files[0])} ↔ ${fileName(files[1])}` : textTab ? 'Text compare' : projectName(path)
    const parent = parents[path]
    return (
      <div
        key={path}
        className={`tab ${variant} ${path === current ? 'active' : ''}`}
        onClick={() => setActive(path)}
        onAuxClick={(e) => e.button === 1 && closeTab(path)}
        onContextMenu={(e) => tabMenu(e, path)}
        title={textTab ? 'Text compare' : files ? `${files[0]}\n${files[1]}` : parent ? `${name}, submodule of ${projectName(parent)}\n${path}` : path}
      >
        {(files || textTab) && <CompareIcon className="icon tab-sub-icon" />}
        {variant === 'child' && <ChildIcon className="icon tab-sub-icon" />}
        {variant === 'labelled' && <BoxIcon className="icon tab-sub-icon" />}
        {variant === 'labelled' ? (
          <span className="tab-two">
            <span className="tab-name">{name}</span>
            <small>in {projectName(parent!)}</small>
          </span>
        ) : (
          <span className="tab-name">{name}</span>
        )}
        <button
          className="tab-close"
          onClick={(e) => {
            e.stopPropagation()
            closeTab(path)
          }}
          aria-label="Close tab"
        >
          <CloseIcon />
        </button>
      </div>
    )
  }

  // Grouped: each open submodule tab follows its parent's tab inside one outline (nested
  // submodules follow theirs). A submodule whose parent isn't open, or labelled mode, keeps its
  // place and gets the "in parent" line instead.
  const parentOpen = (p: string): boolean => !!parents[p] && tabs.includes(parents[p]!)
  const descendants = (p: string): string[] =>
    tabs.filter((c) => parents[c] === p).flatMap((c) => [c, ...descendants(c)])
  const units: { key: string; paths: string[]; node: ReactNode }[] =
    settings.submoduleTabs === 'grouped'
      ? tabs
          .filter((t) => !parentOpen(t))
          .map((t) => {
            const kids = descendants(t)
            if (!kids.length) return { key: t, paths: [t], node: tab(t, parents[t] ? 'labelled' : 'plain') }
            return {
              key: t,
              paths: [t, ...kids],
              node: (
                <div className="tab-group">
                  {tab(t, parents[t] ? 'labelled' : 'plain')}
                  {kids.map((k) => tab(k, 'child'))}
                </div>
              )
            }
          })
      : tabs.map((t) => ({ key: t, paths: [t], node: tab(t, parents[t] ? 'labelled' : 'plain') }))

  const submoduleTabItems = () => [
    { separator: true },
    { label: 'Submodule tabs', enabled: false },
    { id: 'grouped', label: 'Grouped with Parent', kind: 'radio' as const, checked: settings.submoduleTabs === 'grouped' },
    { id: 'labelled', label: 'Labelled “in Parent”', kind: 'radio' as const, checked: settings.submoduleTabs === 'labelled' }
  ]
  const applyTabChoice = (choice: string | null): boolean => {
    if (choice === 'grouped' || choice === 'labelled') {
      updateSettings({ submoduleTabs: choice })
      return true
    }
    return false
  }
  const tabMenu = async (e: React.MouseEvent, path: string): Promise<void> => {
    e.preventDefault()
    e.stopPropagation()
    const order = tabOrder
    const after = order.slice(order.indexOf(path) + 1)
    const choice = await contextMenu([
      { id: 'close', label: 'Close Tab' },
      { id: 'others', label: 'Close Other Tabs', enabled: tabs.length > 1 },
      { id: 'right', label: 'Close Tabs to the Right', enabled: after.length > 0 },
      { separator: true },
      { id: 'reveal', label: revealLabel, enabled: !compareTextId(path) },
      { id: 'copy', label: 'Copy Path', enabled: !compareTextId(path) },
      ...submoduleTabItems()
    ])
    if (applyTabChoice(choice)) return
    if (choice === 'close') closeTab(path)
    else if (choice === 'others') {
      closeTabs(tabs.filter((p) => p !== path))
      setActive(path)
    } else if (choice === 'right') {
      closeTabs(after)
      if (current && after.includes(current)) setActive(path)
    } else if (choice === 'reveal') window.spoon.revealInFinder(compareFiles(path)?.[1] ?? path)
    else if (choice === 'copy') navigator.clipboard.writeText(compareFiles(path)?.join('\n') ?? path)
  }
  const tabBarMenu = async (e: React.MouseEvent): Promise<void> => {
    if (e.defaultPrevented) return
    e.preventDefault()
    const choice = await contextMenu([
      { id: 'find', label: 'Open Project…' },
      { id: 'browse', label: 'Open Folder…' },
      ...submoduleTabItems()
    ])
    if (applyTabChoice(choice)) return
    if (choice === 'find') setPalette(true)
    else if (choice === 'browse') pickRepo()
  }

  // Ctrl+Tab / Ctrl+Shift+Tab cycle through tabs in the order the tab bar shows them (groups
  // included), wrapping around. Ctrl on every platform, like browsers.
  const tabOrder = units.flatMap((u) => u.paths)
  const cycleRef = useRef<(dir: 1 | -1) => void>(() => undefined)
  cycleRef.current = (dir) => {
    if (tabOrder.length < 2) return
    const at = current ? tabOrder.indexOf(current) : -1
    setActive(tabOrder[(at + dir + tabOrder.length) % tabOrder.length])
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab' || !e.ctrlKey || e.metaKey || e.altKey) return
      e.preventDefault()
      e.stopPropagation()
      // Not while the file popup has unsaved edits: switching tabs would close it.
      if (unsavedEdits()) return
      cycleRef.current(e.shiftKey ? -1 : 1)
    }
    window.addEventListener('keydown', onKey, true) // capture: works even while typing in a field
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const tabBar = units.map((u) => (
    <div
      key={u.key}
      className={[
        'tab-unit',
        drag?.unit === u.key ? 'dragging' : '',
        drag?.over === u.key && drag.unit !== u.key ? (drag.after ? 'drop-after' : 'drop-before') : ''
      ].join(' ')}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', u.key)
        setDrag({ unit: u.key })
      }}
      onDragOver={(e) => {
        if (!drag) return
        e.preventDefault()
        const r = e.currentTarget.getBoundingClientRect()
        const after = e.clientX > r.left + r.width / 2
        if (drag.over !== u.key || drag.after !== after) setDrag({ ...drag, over: u.key, after })
      }}
      onDrop={(e) => {
        e.preventDefault()
        const from = units.find((x) => x.key === drag?.unit)
        if (from && drag && from.key !== u.key) moveUnit(from.paths, u.paths, !!drag.after)
        setDrag(null)
      }}
      onDragEnd={() => setDrag(null)}
    >
      {u.node}
    </div>
  ))

  // Follow the IDE: when Spoon comes to the front, pick up a scheme switch (or edit) made in the IDE.
  // Only a scheme that was the IDE's own when chosen follows it (one picked on purpose stays), and
  // only the newest reply counts when focus comes and goes quickly.
  useEffect(() => {
    let asked = 0
    const follow = (): void => {
      const s = getSettings()
      const chosen = s.syntaxPalette
      if (!s.syntaxFollowIde || !chosen || chosen.source === 'file' || !chosen.active) return
      const id = ++asked
      ideSchemes(true).then((list) => {
        if (id !== asked || getSettings().syntaxPalette?.id !== chosen.id) return
        const now = list.find((p) => p.source === chosen.source && p.active)
        if (!now) return
        // The same scheme keeps the colors picked by hand; another scheme starts fresh.
        const next =
          now.id === chosen.id
            ? {
                ...now,
                colors: { ...now.colors, ...Object.fromEntries(Object.entries(chosen.origin).filter(([, o]) => o?.picked).map(([k]) => [k, chosen.colors[k as keyof typeof chosen.colors]])) },
                origin: { ...now.origin, ...Object.fromEntries(Object.entries(chosen.origin).filter(([, o]) => o?.picked)) }
              }
            : now
        if (JSON.stringify(next) !== JSON.stringify(chosen)) updateSettings({ syntaxPalette: next })
      })
    }
    follow()
    window.addEventListener('focus', follow)
    return () => window.removeEventListener('focus', follow)
  }, [])

  useEffect(
    () =>
      window.spoon.onMenu((cmd) => {
        if (cmd === 'zoom-in') updateSettings({ uiScale: settings.uiScale + SCALE_STEP })
        else if (cmd === 'zoom-out') updateSettings({ uiScale: settings.uiScale - SCALE_STEP })
        else if (cmd === 'zoom-reset') resetScale()
        else if ((cmd === 'open-repo' || cmd === 'find-project') && unsavedEdits()) return
        else if (cmd === 'open-repo') pickRepo()
        else if (cmd === 'find-project') setPalette(true)
        else if (cmd === 'git-history') {
          if (!simpleOnRef.current) setGitHistory((open) => !open)
        }
        else if (cmd === 'whats-new') setWhatsNew({ since: null })
        else if (cmd === 'compare-files') setComparing(true)
        else if (cmd === 'filter-commits' && settingsOpen.current) window.dispatchEvent(new Event('spoon:settings-search'))
        else if (cmd === 'squish') updateSettings({ squishBranches: !getSettings().squishBranches })
        else if (cmd === 'settings') setSettingsWindow('appearance')
        else if (cmd === 'close-tab') closeRef.current() // latest tabs, not the ones this effect saw
        else setCommand({ name: cmd, n: Date.now() }) // repo-level commands go to the active RepoView
      }),
    [settings.uiScale, pickRepo]
  )

  // Background work (Unity exports) reports failures here, whichever tab is showing.
  useEffect(() => {
    const on = (e: Event): void => setToast((e as CustomEvent<string>).detail)
    window.addEventListener('spoon:toast', on)
    return () => window.removeEventListener('spoon:toast', on)
  }, [])

  // Closing the window (or quitting) with unsaved edits in the file popup asks first.
  useEffect(() => {
    let leaving = false
    const onUnload = (e: BeforeUnloadEvent): void => {
      const name = unsavedEdits()
      if (!name || leaving) return
      e.preventDefault()
      e.returnValue = false
      void confirm({
        message: `Close Spoon without saving ${name}?`,
        detail: 'Your edits to it are thrown away.',
        confirmLabel: 'Don’t Save',
        risky: true
      }).then((ok) => {
        if (!ok) return
        leaving = true
        window.spoon.closeWindow(true)
      })
    }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(t)
  }, [toast])

  return (
    <div className="app">
      <header className="titlebar">
        <div className="tabs" onContextMenu={tabBarMenu}>
          {tabBar}
          <button className="icon-btn tab-add" onClick={() => setActive(null)} onContextMenu={tabBarMenu} title="Open repository">
            <PlusIcon />
          </button>
        </div>
        <div className="titlebar-right">
          {update?.status === 'ready' && (
            <button className="update-pill" onClick={() => window.spoon.installUpdate()} title={update.notes}>
              Restart to update to {update.version}
            </button>
          )}
          {current && simple && !(simple.on && simple.hideSwitch) && (
            <button
              className="simple-switch"
              title={simple.on ? 'Simple Mode: show the full view' : 'Back to Simple Mode'}
              onClick={async () => {
                if (!simple.on) setSimpleConfig(current, { on: true })
                else if (await askPin(simple, 'Enter the PIN to show the full view.')) setSimpleConfig(current, { on: false })
              }}
            >
              <span className={simple.on ? 'on' : ''}>Simple</span>
              <span className={simple.on ? '' : 'on'}>Full</span>
            </button>
          )}
          <button className="icon-btn keyed-btn" onClick={() => setPalette(true)} title="Go to project">
            <SearchIcon />
            <kbd className="keyed-key">Tab</kbd>
          </button>
          {current && !currentMissing && (
            <button
              className="icon-btn keyed-btn"
              onClick={() => setCommand({ name: 'new-branch', n: Date.now() })}
              disabled={!!simple?.on}
              title={simple?.on ? 'New branch from a Jira ticket (not in Simple Mode)' : 'New branch from a Jira ticket'}
            >
              <NewBranchIcon />
              <kbd className="keyed-key">{keys('⌘N')}</kbd>
            </button>
          )}
          <button className="icon-btn keyed-btn" onClick={() => setComparing(true)} title="Compare files or text">
            <CompareIcon />
            <kbd className="keyed-key">{keys('⌥⌘D')}</kbd>
          </button>
          <button
            className="icon-btn keyed-btn"
            onClick={() => setGitHistory(true)}
            disabled={!!simple?.on}
            title={simple?.on ? 'Git command history (not in Simple Mode)' : 'Git command history'}
          >
            <TerminalHistoryIcon />
            <kbd className="keyed-key">{keys('⇧⌘H')}</kbd>
          </button>
          <button className="icon-btn keyed-btn settings-btn" onClick={() => setSettingsWindow('appearance')} title="Settings">
            <CogIcon />
            <kbd className="keyed-key">{keys('⌘,')}</kbd>
          </button>
        </div>
      </header>

      {current && currentMissing ? (
        <div className="empty-state">
          <FolderIcon className="icon big-icon" />
          <p>
            <b>{projectName(current)}</b> can’t be found.
          </p>
          <p className="muted">{current}</p>
          <div className="form-row">
            <button className="btn" onClick={() => resolveMissing(current)}>
              Remove or locate…
            </button>
            <button className="btn" onClick={() => dropTab(current)}>
              Close tab
            </button>
          </div>
        </div>
      ) : current && currentText ? (
        <TextCompareView key={current} id={currentText} />
      ) : current && currentCompare ? (
        <CompareView
          key={current}
          a={currentCompare[0]}
          b={currentCompare[1]}
          onChange={(a, b) => openCompare(a, b, current)}
        />
      ) : current ? (
        <RepoView
          key={current}
          path={current}
          command={command}
          onOpenRepo={openRepo}
          onOpenSettings={(tab) => setSettingsWindow(tab)}
        />
      ) : (
        <Welcome
          recents={projects.slice(0, 12).map((p) => p.path)}
          onPick={pickRepo}
          onOpen={openRepo}
          onForget={forgetProject}
          onSearch={() => setPalette(true)}
        />
      )}

      {palette && (
        <ProjectPalette
          openTabs={tabs}
          onOpen={openRepo}
          onBrowse={pickRepo}
          onClose={() => setPalette(false)}
        />
      )}

      {settingsWindow && <SettingsWindow initialTab={settingsWindow} project={current && !currentText && !currentCompare ? current : null} onClose={() => setSettingsWindow(false)} />}

      {whatsNew && appVersion && (
        <WhatsNewDialog current={appVersion} since={whatsNew.since} onClose={() => setWhatsNew(null)} />
      )}
      {gitHistory && <GitHistoryDialog current={current} onClose={() => setGitHistory(false)} />}
      {comparing && (
        <CompareDialog home={home} onCompare={openCompare} onCompareText={openTextCompare} onClose={() => setComparing(false)} />
      )}
      {dropping && !comparing && (
        <div className="drop-overlay">
          <span>
            <CompareIcon className="icon" />{' '}
            {firstDropped ? `Drop a file to compare with ${fileName(firstDropped)}` : 'Drop 2 files to compare them'}
          </span>
        </div>
      )}
      {firstDropped && !dropping && (
        <div className="toast compare-wait" role="status">
          Comparing <b>{fileName(firstDropped)}</b>: drop the second file anywhere.
          <button className="link-btn" onClick={() => setFirstDropped(null)}>
            Cancel
          </button>
        </div>
      )}
      <DialogHost />
      <PinHost />
      <MenuHost />

      {toast && (
        <div className="toast" role="alert" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}
    </div>
  )
}
