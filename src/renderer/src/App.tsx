import { useCallback, useEffect, useState } from 'react'
import type { MenuCommand } from '../../shared/types'
import { cleanError, usePersistentState } from './hooks'
import { resetScale, SCALE_STEP, updateSettings, useSettings } from './settings'
import { RepoView } from './components/RepoView'
import { SettingsPopover } from './components/SettingsPopover'
import { SettingsWindow } from './components/SettingsWindow'
import { Welcome } from './components/Welcome'
import { CloseIcon, PlusIcon, TextSizeIcon } from './components/Icons'

export function App() {
  const settings = useSettings()
  const [tabs, setTabs] = usePersistentState<string[]>('spoon.tabs', [])
  const [active, setActive] = usePersistentState<string | null>('spoon.activeTab', null)
  const [recents, setRecents] = usePersistentState<string[]>('spoon.recents', [])
  const [command, setCommand] = useState<{ name: MenuCommand; n: number } | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [settingsWindow, setSettingsWindow] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const current = active && tabs.includes(active) ? active : null

  const openRepo = useCallback(
    async (path: string) => {
      try {
        const repo = await window.spoon.openRepo(path)
        setTabs((t) => (t.includes(repo.path) ? t : [...t, repo.path]))
        setRecents((r) => [repo.path, ...r.filter((p) => p !== repo.path)].slice(0, 12))
        setActive(repo.path)
      } catch (err) {
        setToast(cleanError(err))
      }
    },
    [setTabs, setRecents, setActive]
  )

  const pickRepo = useCallback(async () => {
    const path = await window.spoon.pickRepo()
    if (path) openRepo(path)
  }, [openRepo])

  const closeTab = (path: string): void => {
    const i = tabs.indexOf(path)
    const next = tabs.filter((p) => p !== path)
    setTabs(next)
    if (current === path) setActive(next[Math.min(i, next.length - 1)] ?? null)
  }

  useEffect(
    () =>
      window.spoon.onMenu((cmd) => {
        if (cmd === 'zoom-in') updateSettings({ uiScale: settings.uiScale + SCALE_STEP })
        else if (cmd === 'zoom-out') updateSettings({ uiScale: settings.uiScale - SCALE_STEP })
        else if (cmd === 'zoom-reset') resetScale()
        else if (cmd === 'open-repo') pickRepo()
        else if (cmd === 'settings') setSettingsWindow(true)
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
              setSettingsWindow(true)
            }}
          />
        )}
      </header>

      {current ? (
        <RepoView key={current} path={current} command={command} onOpenRepo={openRepo} />
      ) : (
        <Welcome
          recents={recents}
          onPick={pickRepo}
          onOpen={openRepo}
          onForget={(p) => setRecents((r) => r.filter((x) => x !== p))}
        />
      )}

      {settingsWindow && <SettingsWindow onClose={() => setSettingsWindow(false)} />}

      {toast && (
        <div className="toast" role="alert" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}
    </div>
  )
}
