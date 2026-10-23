import { useCallback, useEffect, useState } from 'react'
import type { MenuCommand } from '../../shared/types'
import { cleanError, usePersistentState } from './hooks'
import { resetScale, SCALE_STEP, updateSettings, useSettings } from './settings'
import { RepoView } from './components/RepoView'
import { SettingsPopover } from './components/SettingsPopover'
import { SettingsWindow, type SettingsTab } from './components/SettingsWindow'
import { Welcome } from './components/Welcome'
import { ProjectPalette } from './components/ProjectPalette'
import { CloseIcon, FolderIcon, PlusIcon, SearchIcon, TextSizeIcon } from './components/Icons'
import { forgetProject, projectName, rememberProject, useProjects } from './projects'

export function App() {
  const settings = useSettings()
  const [tabs, setTabs] = usePersistentState<string[]>('spoon.tabs', [])
  const [active, setActive] = usePersistentState<string | null>('spoon.activeTab', null)
  const projects = useProjects()
  const [palette, setPalette] = useState(false)
  const [currentMissing, setCurrentMissing] = useState(false)
  const [command, setCommand] = useState<{ name: MenuCommand; n: number } | null>(null)
  const [showSettings, setShowSettings] = useState(false)
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
        setToast(cleanError(err))
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setTabs, setActive]
  )

  /** Like Fork: a project that's gone can be removed from the list or pointed at its new location. */
  const resolveMissing = async (path: string): Promise<void> => {
    const choice = await window.spoon.missingProject(path)
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

  useEffect(
    () =>
      window.spoon.onMenu((cmd) => {
        if (cmd === 'zoom-in') updateSettings({ uiScale: settings.uiScale + SCALE_STEP })
        else if (cmd === 'zoom-out') updateSettings({ uiScale: settings.uiScale - SCALE_STEP })
        else if (cmd === 'zoom-reset') resetScale()
        else if (cmd === 'open-repo') pickRepo()
        else if (cmd === 'settings') setSettingsWindow('appearance')
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
        <div className="tabs">
          {tabs.map((path) => (
            <div
              key={path}
              className={`tab ${path === current ? 'active' : ''}`}
              onClick={() => setActive(path)}
              onAuxClick={(e) => e.button === 1 && closeTab(path)}
              title={path}
            >
              <span className="tab-name">{path.split('/').pop()}</span>
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
          ))}
          <button className="icon-btn tab-add" onClick={() => setActive(null)} title="Open repository">
            <PlusIcon />
          </button>
        </div>
        <div className="titlebar-right">
          <button className="icon-btn" onClick={() => setPalette(true)} title="Go to project (Tab)">
            <SearchIcon />
          </button>
          <button
            className={`icon-btn ${showSettings ? 'on' : ''}`}
            onClick={() => setShowSettings((s) => !s)}
            title="Appearance (⌘+ / ⌘− to resize)"
          >
            <TextSizeIcon />
            <span className="scale-label">{Math.round(settings.uiScale * 100)}%</span>
          </button>
        </div>
        {showSettings && (
          <SettingsPopover
            onClose={() => setShowSettings(false)}
            onMore={() => {
              setShowSettings(false)
              setSettingsWindow('appearance')
            }}
          />
        )}
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

      {palette && <ProjectPalette openTabs={tabs} onOpen={openRepo} onClose={() => setPalette(false)} />}

      {settingsWindow && <SettingsWindow initialTab={settingsWindow} onClose={() => setSettingsWindow(false)} />}

      {toast && (
        <div className="toast" role="alert" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}
    </div>
  )
}
