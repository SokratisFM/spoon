import { useEffect, useState } from 'react'
import { refreshGitHubAccount, setGitHubAccount, useGitHubAccount } from '../github'
import { cleanError } from '../hooks'
import type { DeviceCode } from '../../../shared/types'
import { forgetProject, forgetProjects, projectName, tildify, useProjects } from '../projects'
import { knownAuthors } from '../authors'
import {
  SIDEBAR_SECTIONS,
  activeTheme,
  SCALE_MAX,
  SCALE_MIN,
  SCALE_STEP,
  updateSettings,
  useSettings,
  type Density,
  type Settings
} from '../settings'
import {
  AUTHOR_PALETTE,
  COLOR_ELEMENTS,
  resolveTheme,
  THEME_CHOICES,
  type BaseThemeChoice,
  type ColorKey,
  type ThemeChoice
} from '../themes'
import { Modal } from './Modal'
import { CloseIcon, PlusIcon } from './Icons'

export type SettingsTab = 'appearance' | 'colors' | 'authors' | 'projects' | 'accounts'
type Tab = SettingsTab

export function SettingsWindow({ onClose, initialTab = 'appearance' }: { onClose: () => void; initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab)
  return (
    <Modal
      title="Settings"
      onClose={onClose}
      wide
      footer={
        <button className="btn primary" onClick={onClose}>
          Done
        </button>
      }
    >
      <div className="settings-tabs">
        {(
          [
            ['appearance', 'Appearance'],
            ['colors', 'Theme colors'],
            ['authors', 'Author colors'],
            ['projects', 'Projects'],
            ['accounts', 'Accounts']
          ] as const
        ).map(([id, label]) => (
          <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="settings-page">
        {tab === 'appearance' && <AppearanceTab />}
        {tab === 'colors' && <ColorsTab />}
        {tab === 'authors' && <AuthorsTab />}
        {tab === 'projects' && <ProjectsTab />}
        {tab === 'accounts' && <AccountsTab />}
      </div>
    </Modal>
  )
}

// ---------- appearance ----------

export function SizeControls() {
  const s = useSettings()
  return (
    <>
      <label className="field">
        <span className="field-label">
          Interface size <b>{Math.round(s.uiScale * 100)}%</b>
        </span>
        <div className="stepper">
          <button onClick={() => updateSettings({ uiScale: s.uiScale - SCALE_STEP })} aria-label="Smaller">
            A
          </button>
          <input
            type="range"
            min={SCALE_MIN}
            max={SCALE_MAX}
            step={SCALE_STEP}
            value={s.uiScale}
            onChange={(e) => updateSettings({ uiScale: Number(e.target.value) })}
          />
          <button className="big" onClick={() => updateSettings({ uiScale: s.uiScale + SCALE_STEP })} aria-label="Bigger">
            A
          </button>
        </div>
        <span className="hint">Scales every element and font. Shortcut: ⌘+ ⌘− ⌘0</span>
      </label>
      <label className="field">
        <span className="field-label">
          Diff font size <b>{s.codeSize}px</b>
        </span>
        <input
          type="range"
          min={9}
          max={24}
          step={0.5}
          value={s.codeSize}
          onChange={(e) => updateSettings({ codeSize: Number(e.target.value) })}
        />
      </label>
    </>
  )
}

function AppearanceTab() {
  const s = useSettings()
  return (
    <>
      <SizeControls />
      <div className="field">
        <span className="field-label">Row spacing</span>
        <Segmented<Density>
          value={s.density}
          options={[
            ['compact', 'Compact'],
            ['comfortable', 'Comfortable'],
            ['spacious', 'Spacious']
          ]}
          onChange={(density) => updateSettings({ density })}
        />
      </div>
      <SidebarSectionsField />
      <div className="field">
        <span className="field-label">Theme</span>
        <div className="theme-grid">
          {THEME_CHOICES.map((t) => (
            <ThemeCard key={t.id} id={t.id} name={t.name} hint={t.hint} />
          ))}
        </div>
      </div>
    </>
  )
}

function SidebarSectionsField() {
  const s = useSettings()
  const list = s.sidebarSections
  const move = (i: number, d: -1 | 1): void => {
    const next = [...list]
    ;[next[i], next[i + d]] = [next[i + d], next[i]]
    updateSettings({ sidebarSections: next })
  }
  return (
    <div className="field">
      <span className="field-label">Sidebar sections</span>
      <div className="section-order">
        {list.map((x, i) => (
          <div key={x.id} className={`section-order-row ${x.visible ? '' : 'hidden'}`}>
            <label className="check">
              <input
                type="checkbox"
                checked={x.visible}
                onChange={(e) =>
                  updateSettings({ sidebarSections: list.map((y) => (y.id === x.id ? { ...y, visible: e.target.checked } : y)) })
                }
              />
              {SIDEBAR_SECTIONS.find((d) => d.id === x.id)?.label}
            </label>
            <span className="spacer" />
            <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
              ↑
            </button>
            <button className="icon-btn" disabled={i === list.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
              ↓
            </button>
          </div>
        ))}
      </div>
      <span className="hint">Untick to hide a section; arrows change the order.</span>
    </div>
  )
}

function ThemeCard({ id, name, hint }: { id: ThemeChoice; name: string; hint?: string }) {
  const s = useSettings()
  const theme = id === 'custom' ? activeTheme({ ...s, theme: 'custom' }) : resolveTheme(id)
  const c = theme.colors
  return (
    <button className={`theme-card ${s.theme === id ? 'on' : ''}`} onClick={() => updateSettings({ theme: id })} title={hint}>
      <span className="theme-preview" style={{ background: c.bg }}>
        <span className="tp-side" style={{ background: c['bg-chrome'] }}>
          <span style={{ background: c.accent }} />
          <span style={{ background: c['text-faint'] }} />
          <span style={{ background: c['text-faint'] }} />
        </span>
        <span className="tp-main" style={{ background: c['bg-list'] }}>
          {[0, 1, 2].map((i) => (
            <span key={i} className="tp-row">
              <span className="tp-dot" style={{ background: c[`lane-${i}` as ColorKey] }} />
              <span className="tp-line" style={{ background: c.text, width: `${70 - i * 15}%` }} />
            </span>
          ))}
        </span>
      </span>
      <span className="theme-name">{name}</span>
    </button>
  )
}

export function ThemeSelect() {
  const s = useSettings()
  return (
    <select value={s.theme} onChange={(e) => updateSettings({ theme: e.target.value as ThemeChoice })}>
      {THEME_CHOICES.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </select>
  )
}

// ---------- theme colors ----------

const BASE_CHOICES = THEME_CHOICES.filter((t) => t.id !== 'custom') as { id: BaseThemeChoice; name: string }[]

function ColorsTab() {
  const s = useSettings()
  const isCustom = s.theme === 'custom'
  const shown = activeTheme(s).colors
  const base = resolveTheme(isCustom ? s.customBase : (s.theme as BaseThemeChoice)).colors

  // Editing any color switches to the Custom theme, starting from whatever theme was showing.
  const setColor = (key: ColorKey, value: string): void => {
    const patch: Partial<Settings> = isCustom
      ? { customColors: { ...s.customColors, [key]: value } }
      : { theme: 'custom', customBase: s.theme as BaseThemeChoice, customColors: { [key]: value } }
    updateSettings(patch)
  }
  const resetColor = (key: ColorKey): void => {
    const next = { ...s.customColors }
    delete next[key]
    updateSettings({ customColors: next })
  }

  return (
    <>
      <div className="form-row">
        <span className="field-label">Start from</span>
        <select
          value={isCustom ? s.customBase : (s.theme as BaseThemeChoice)}
          onChange={(e) =>
            isCustom
              ? updateSettings({ customBase: e.target.value as BaseThemeChoice })
              : updateSettings({ theme: e.target.value as ThemeChoice })
          }
        >
          {BASE_CHOICES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <span className="spacer" />
        {isCustom && Object.keys(s.customColors).length > 0 && (
          <button className="btn" onClick={() => updateSettings({ customColors: {} })}>
            Reset all
          </button>
        )}
      </div>
      <p className="hint">
        {isCustom ? 'Custom theme is active.' : 'Changing any color switches to the Custom theme.'}
      </p>
      {COLOR_ELEMENTS.map((g) => (
        <div key={g.group} className="color-group">
          <h4>{g.group}</h4>
          <div className="color-grid">
            {g.items.map(({ key, label }) => {
              const changed = isCustom && s.customColors[key] !== undefined && s.customColors[key] !== base[key]
              return (
                <label key={key} className={`color-item ${changed ? 'changed' : ''}`}>
                  <input type="color" value={shown[key]} onChange={(e) => setColor(key, e.target.value)} />
                  <span className="color-label">{label}</span>
                  <span className="color-hex mono">{shown[key]}</span>
                  {changed && (
                    <button
                      className="icon-btn"
                      title="Reset to theme color"
                      onClick={(e) => {
                        e.preventDefault()
                        resetColor(key)
                      }}
                    >
                      <CloseIcon />
                    </button>
                  )}
                </label>
              )
            })}
          </div>
        </div>
      ))}
    </>
  )
}

// ---------- author colors ----------

function AuthorsTab() {
  const s = useSettings()
  const authors = knownAuthors()
  const listed = new Set(s.authorColors.map((a) => a.name.trim().toLowerCase()))
  const missing = authors.filter((a) => !listed.has(a.toLowerCase()))
  const nextColor = (offset = 0): string => AUTHOR_PALETTE[(s.authorColors.length + offset) % AUTHOR_PALETTE.length]

  const update = (i: number, patch: Partial<{ name: string; color: string }>): void =>
    updateSettings({ authorColors: s.authorColors.map((a, j) => (j === i ? { ...a, ...patch } : a)) })

  return (
    <>
      <label className="check">
        <input
          type="checkbox"
          checked={s.authorColorsEnabled}
          onChange={(e) => updateSettings({ authorColorsEnabled: e.target.checked })}
        />
        Color commits by author
      </label>
      <p className="hint">
        Listed authors get their color on the commit dot, avatar and a tint across the row. Match by name or email;
        authors not listed keep the normal look.
      </p>

      <datalist id="known-authors">
        {authors.map((a) => (
          <option key={a} value={a} />
        ))}
      </datalist>

      <div className={`author-list ${s.authorColorsEnabled ? '' : 'disabled'}`}>
        {s.authorColors.map((a, i) => (
          <div key={i} className="author-row">
            <input type="color" value={a.color} onChange={(e) => update(i, { color: e.target.value })} />
            <input
              list="known-authors"
              placeholder="Author name"
              value={a.name}
              onChange={(e) => update(i, { name: e.target.value })}
              spellCheck={false}
            />
            <span className="author-sample" style={{ '--author': a.color } as React.CSSProperties}>
              {a.name || 'Preview'}
            </span>
            <button
              className="icon-btn"
              aria-label="Remove"
              onClick={() => updateSettings({ authorColors: s.authorColors.filter((_, j) => j !== i) })}
            >
              <CloseIcon />
            </button>
          </div>
        ))}
        {s.authorColors.length === 0 && <p className="muted">No authors yet.</p>}
      </div>

      <div className="form-row">
        <button
          className="btn"
          onClick={() =>
            updateSettings({
              authorColorsEnabled: true,
              authorColors: [...s.authorColors, { name: '', color: nextColor() }]
            })
          }
        >
          <PlusIcon /> Add author
        </button>
        {missing.length > 0 && (
          <button
            className="btn"
            onClick={() =>
              updateSettings({
                authorColorsEnabled: true,
                authorColors: [...s.authorColors, ...missing.map((name, k) => ({ name, color: nextColor(k) }))]
              })
            }
          >
            Add all {missing.length} authors from this repository
          </button>
        )}
      </div>
    </>
  )
}

// ---------- accounts ----------

function AccountsTab() {
  const s = useSettings()
  const account = useGitHubAccount()
  const [cliLogin, setCliLogin] = useState<string | null | undefined>(undefined)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [device, setDevice] = useState<DeviceCode | null>(null)

  useEffect(() => {
    window.spoon.ghCliLogin().then(setCliLogin)
  }, [])

  const attempt = async (label: string, fn: () => Promise<unknown>): Promise<void> => {
    setBusy(label)
    setError(null)
    try {
      await fn()
      await refreshGitHubAccount()
    } catch (err) {
      setError(cleanError(err))
    } finally {
      setBusy(null)
    }
  }

  const browserSignIn = (): Promise<void> =>
    attempt('browser', async () => {
      const code = await window.spoon.ghDeviceStart(s.githubClientId)
      setDevice(code)
      try {
        await window.spoon.ghDeviceWait(s.githubClientId, code)
      } finally {
        setDevice(null)
      }
    })

  const sourceLabel = { gh: 'GitHub CLI sign-in', token: 'Personal access token', browser: 'Browser sign-in' }

  return (
    <>
      {account ? (
        <div className="account-card">
          <img className="gh-avatar large" src={account.avatarUrl} alt="" />
          <div className="palette-text">
            <span className="palette-name">{account.name ?? account.login}</span>
            <span className="palette-path">
              @{account.login} · {sourceLabel[account.source]} · {account.scopes.join(', ') || 'no scopes listed'}
            </span>
          </div>
          <button
            className="btn"
            onClick={() =>
              attempt('disconnect', async () => {
                await window.spoon.ghDisconnect()
                setGitHubAccount(null)
              })
            }
          >
            Disconnect
          </button>
        </div>
      ) : (
        <p className="hint">Connect GitHub to see pull requests, review them and submit reviews from Spoon.</p>
      )}
      {account && !account.scopes.includes('repo') && account.source !== 'token' && (
        <p className="error-text">This sign-in lacks the “repo” scope, so private repositories won’t load.</p>
      )}

      <div className="connect-list">
        <div className="connect-row">
          <div className="palette-text">
            <span className="palette-name">Use your GitHub CLI sign-in</span>
            <span className="palette-path">
              {cliLogin === undefined
                ? 'Checking…'
                : cliLogin
                  ? `Signed in as ${cliLogin}. Spoon asks gh for the token when it needs it.`
                  : 'gh isn’t installed or signed in (run gh auth login).'}
            </span>
          </div>
          <button className="btn" disabled={!cliLogin || !!busy} onClick={() => attempt('cli', () => window.spoon.ghConnectCli())}>
            {busy === 'cli' ? 'Connecting…' : 'Use this account'}
          </button>
        </div>

        <div className="connect-row column">
          <div className="palette-text">
            <span className="palette-name">Sign in with browser</span>
            <span className="palette-path">
              Uses your own GitHub OAuth app (one-time setup):{' '}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault()
                  window.spoon.openExternal('https://github.com/settings/applications/new')
                }}
              >
                register one
              </a>
              , tick “Enable Device Flow”, then paste its Client ID here.
            </span>
          </div>
          <div className="form-row">
            <input
              placeholder="OAuth app Client ID"
              value={s.githubClientId}
              onChange={(e) => updateSettings({ githubClientId: e.target.value.trim() })}
              spellCheck={false}
              className="mono"
            />
            <button className="btn" disabled={!s.githubClientId || !!busy} onClick={browserSignIn}>
              {busy === 'browser' ? 'Waiting…' : 'Sign in'}
            </button>
          </div>
          {device && (
            <div className="device-code">
              <span className="muted">Enter this code on GitHub:</span>
              <span className="device-code-value mono">{device.userCode}</span>
              <button
                className="btn primary"
                onClick={() => {
                  navigator.clipboard.writeText(device.userCode)
                  window.spoon.openExternal(device.verificationUri)
                }}
              >
                Copy code and open GitHub
              </button>
              <button className="btn" onClick={() => window.spoon.ghDeviceCancel()}>
                Cancel
              </button>
            </div>
          )}
        </div>

        <div className="connect-row column">
          <div className="palette-text">
            <span className="palette-name">Personal access token</span>
            <span className="palette-path">
              Stored in your macOS Keychain.{' '}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault()
                  window.spoon.openExternal('https://github.com/settings/tokens/new?scopes=repo,read:org&description=Spoon')
                }}
              >
                Create a token
              </a>{' '}
              with the repo and read:org scopes.
            </span>
          </div>
          <div className="form-row">
            <input
              type="password"
              placeholder="ghp_…"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              spellCheck={false}
              className="mono text-like"
            />
            <button
              className="btn"
              disabled={!token.trim() || !!busy}
              onClick={() => attempt('token', async () => {
                await window.spoon.ghConnectToken(token)
                setToken('')
              })}
            >
              {busy === 'token' ? 'Checking…' : 'Connect'}
            </button>
          </div>
        </div>
      </div>
      {error && <p className="error-text">{error}</p>}
    </>
  )
}

// ---------- projects ----------

function ProjectsTab() {
  const s = useSettings()
  const projects = useProjects()
  const [home, setHome] = useState('')
  const [missing, setMissing] = useState<Set<string>>(new Set())

  useEffect(() => {
    window.spoon.homeDir().then(setHome)
  }, [])
  useEffect(() => {
    window.spoon
      .pathsExist(projects.map((p) => p.path))
      .then((ok) => setMissing(new Set(projects.filter((_, i) => !ok[i]).map((p) => p.path))))
  }, [projects])

  const choose = async (): Promise<void> => {
    const folder = await window.spoon.pickFolder('Folder to search for repositories')
    if (folder) updateSettings({ scanFolder: tildify(folder, home) })
  }

  return (
    <>
      <div className="field">
        <span className="field-label">Search for repositories in</span>
        <div className="form-row">
          <input
            value={s.scanFolder}
            onChange={(e) => updateSettings({ scanFolder: e.target.value })}
            spellCheck={false}
            className="mono"
          />
          <button className="btn" onClick={choose}>
            Choose…
          </button>
        </div>
        <span className="hint">
          Press Tab anywhere to search your projects. Repos in this folder you haven’t opened yet are listed too.
        </span>
      </div>
      <div className="form-row">
        <span className="field-label">Look</span>
        <select value={s.scanDepth} onChange={(e) => updateSettings({ scanDepth: Number(e.target.value) })}>
          {[1, 2, 3, 4, 5].map((d) => (
            <option key={d} value={d}>
              {d} folder{d === 1 ? '' : 's'} deep
            </option>
          ))}
        </select>
        <label className="check">
          <input
            type="checkbox"
            checked={s.scanNested}
            onChange={(e) => updateSettings({ scanNested: e.target.checked })}
          />
          Include repos inside other repos (submodules)
        </label>
      </div>

      <div className="field">
        <div className="form-row">
          <span className="field-label">Your projects ({projects.length})</span>
          <span className="spacer" />
          {missing.size > 0 && (
            <button className="btn" onClick={() => forgetProjects([...missing])}>
              Remove {missing.size} missing
            </button>
          )}
        </div>
        <div className="project-list">
          {projects.map((p) => (
            <div key={p.path} className={`project-row ${missing.has(p.path) ? 'missing' : ''}`}>
              <div className="palette-text">
                <span className="palette-name">{projectName(p.path)}</span>
                <span className="palette-path">{tildify(p.path, home)}</span>
              </div>
              {missing.has(p.path) && <span className="badge danger">missing</span>}
              <button className="icon-btn" title="Remove from Spoon" onClick={() => forgetProject(p.path)}>
                <CloseIcon />
              </button>
            </div>
          ))}
          {projects.length === 0 && <p className="muted">Projects you open are remembered here.</p>}
        </div>
      </div>
    </>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: [T, string][]
  onChange: (v: T) => void
}) {
  return (
    <div className="segmented">
      {options.map(([v, label]) => (
        <button key={v} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  )
}
