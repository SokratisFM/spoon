import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { MenuCommand } from '../../shared/types'
import { cleanError, usePersistentState } from './hooks'
import { getSettings, resetScale, SCALE_STEP, updateSettings, useSettings } from './settings'
import { ideSchemes } from './syntax'
import { RepoView } from './components/RepoView'
import { GitHistoryDialog } from './components/GitHistoryDialog'
import { warmTabs } from './repoCache'
import { SettingsWindow, type SettingsTab } from './components/SettingsWindow'
import { Welcome } from './components/Welcome'
import { ProjectPalette } from './components/ProjectPalette'
import { BoxIcon, ChildIcon, CloseIcon, CogIcon, FolderIcon, PlusIcon, SearchIcon, TerminalHistoryIcon } from './components/Icons'
import { choose, DialogHost } from './dialogs'
import { forgetProject, projectName, rememberProject, useProjects } from './projects'
import { keys, revealLabel } from './platform'
import { useUpdateState } from './appinfo'
import { closeMenu, contextMenu, MenuHost } from './menus'

export function App() {
  const settings = useSettings()
  const [tabs, setTabs] = usePersistentState<string[]>('spoon.tabs', [])
  const [active, setActive] = usePersistentState<string | null>('spoon.activeTab', null)
  const projects = useProjects()
  const update = useUpdateState()
  const [palette, setPalette] = useState(false)
  const [gitHistory, setGitHistory] = useState(false)
  const [currentMissing, setCurrentMissing] = useState(false)
  const [command, setCommand] = useState<{ name: MenuCommand; n: number } | null>(null)
  const [settingsWindow, setSettingsWindow] = useState<false | SettingsTab>(false)
  const [toast, setToast] = useState<string | null>(null)

  const current = active && tabs.includes(active) ? active : null

  const dropTab = useCallback(
    (path: string) => {
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
    if (!current) return setCurrentMissing(false)
    window.spoon.pathsExist([current]).then(([ok]) => setCurrentMissing(!ok))
  }, [current])

  useEffect(() => window.spoon.setMenuItemVisible('review', settings.claudeEnabled), [settings.claudeEnabled])

  // A menu belongs to the tab it was opened in; its choice must never act on another repo.
  useEffect(() => void closeMenu(), [current])

  // Once the visible tab has had its turn, load the others in the background so switching is instant.
  useEffect(() => {
    warmTabs(tabs, current)
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

  const closeTab = (path: string): void => dropTab(path)

  // ⌘W / Ctrl+W: dismiss an open dialog first, then close the current tab; with only one tab (or
  // none) left, close the window instead, as its close button would. The last tab is kept so it
  // reopens next time.
  const closeTabOrWindow = (): void => {
    if (closeMenu()) return // an open menu goes first, like a dialog
    const overlay = document.querySelector('.modal-backdrop, .palette-backdrop, .popover')
    if (overlay) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
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
    window.spoon.repoParents(tabs).then((ps) => setParents(Object.fromEntries(tabs.map((t, i) => [t, ps[i]]))))
  }, [tabs])

  const tab = (path: string, variant: 'plain' | 'child' | 'labelled') => {
    const name = projectName(path)
    const parent = parents[path]
    return (
      <div
        key={path}
        className={`tab ${variant} ${path === current ? 'active' : ''}`}
        onClick={() => setActive(path)}
        onAuxClick={(e) => e.button === 1 && closeTab(path)}
        onContextMenu={(e) => tabMenu(e, path)}
        title={parent ? `${name}, submodule of ${projectName(parent)}\n${path}` : path}
      >
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
      { id: 'reveal', label: revealLabel },
      { id: 'copy', label: 'Copy Path' },
      ...submoduleTabItems()
    ])
    if (applyTabChoice(choice)) return
    if (choice === 'close') closeTab(path)
    else if (choice === 'others') {
      setTabs([path])
      setActive(path)
    } else if (choice === 'right') {
      setTabs((t) => t.filter((p) => !after.includes(p)))
      if (current && after.includes(current)) setActive(path)
    } else if (choice === 'reveal') window.spoon.revealInFinder(path)
    else if (choice === 'copy') navigator.clipboard.writeText(path)
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
        else if (cmd === 'open-repo') pickRepo()
        else if (cmd === 'find-project') setPalette(true)
        else if (cmd === 'git-history') setGitHistory((open) => !open)
        else if (cmd === 'squish') updateSettings({ squishBranches: !getSettings().squishBranches })
        else if (cmd === 'settings') setSettingsWindow('appearance')
        else if (cmd === 'close-tab') closeRef.current() // latest tabs, not the ones this effect saw
        else setCommand({ name: cmd, n: Date.now() }) // repo-level commands go to the active RepoView
      }),
    [settings.uiScale, pickRepo]
  )

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
          <button className="icon-btn keyed-btn" onClick={() => setPalette(true)} title="Go to project">
            <SearchIcon />
            <kbd className="keyed-key">Tab</kbd>
          </button>
          <button className="icon-btn keyed-btn" onClick={() => setGitHistory(true)} title="Git command history">
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
        <ProjectPalette openTabs={tabs} onOpen={openRepo} onBrowse={pickRepo} onClose={() => setPalette(false)} />
      )}

      {settingsWindow && <SettingsWindow initialTab={settingsWindow} onClose={() => setSettingsWindow(false)} />}

      {gitHistory && <GitHistoryDialog current={current} onClose={() => setGitHistory(false)} />}
      <DialogHost />
      <MenuHost />

      {toast && (
        <div className="toast" role="alert" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}
    </div>
  )
}
