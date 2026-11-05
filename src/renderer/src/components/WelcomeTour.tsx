// The welcome tour: on the first launch after installing, a few small steps that show what can be made
// your own (one group at a time: colors, sizes, diffs, history…), each change applied as it's picked,
// with a preview beside it. Every step can be skipped, and so can the whole tour. Help → Welcome Tour
// shows it again.
import { useEffect, useState, type ReactNode } from 'react'
import wizardArt from '../assets/wizard.svg?raw'
import { updateSettings, useSettings, type Density, type DialogPosition, type DiffLayout, type DiffSyntax, type HeadHighlight, type LaneSpotlight, type SquishStyle, type TagDisplay } from '../settings'
import { THEME_CHOICES } from '../themes'
import { getItem, setItem } from '../storage'
import { useGitHubAccount } from '../github'
import { requestSshSetup } from '../sshHelp'
import { tildify } from '../projects'
import { keys } from '../platform'
import { useAsync } from '../hooks'
import { Segmented, SizeControls, ThemeCard } from './SettingsWindow'
import { ScenePreview } from './SettingsPreview'
import type { SettingsTab } from './SettingsWindow'

const SEEN_KEY = 'spoon.welcomeTour'

/**
 * Whether the tour opens by itself: only on a fresh install (no projects, no tabs). Someone updating
 * from an older Spoon has used it already; for them it's marked seen without showing.
 */
export function shouldShowTour(hasProjects: boolean): boolean {
  if (getItem(SEEN_KEY)) return false
  if (hasProjects) {
    setItem(SEEN_KEY, JSON.stringify('existing'))
    return false
  }
  return true
}
const markSeen = (how: 'done' | 'skipped'): void => setItem(SEEN_KEY, JSON.stringify(how))

interface Props {
  home: string
  onClose: () => void
  onOpenSettings: (tab: SettingsTab) => void
  onClone: () => void
  onOpenFolder: () => void
  onSearch: () => void
}

interface Step {
  id: string
  title: string
  lead: string
  body: () => ReactNode
  /** The previews beside it, of the settings as they are now. */
  preview?: () => ReactNode
}

export function WelcomeTour({ home, onClose, onOpenSettings, onClone, onOpenFolder, onSearch }: Props) {
  const s = useSettings()
  const account = useGitHubAccount()
  const [at, setAt] = useState(0)
  const [sshTick, setSshTick] = useState(0)
  useEffect(() => {
    const on = (): void => setSshTick((t) => t + 1)
    window.addEventListener('spoon:sshChanged', on)
    return () => window.removeEventListener('spoon:sshChanged', on)
  }, [])
  const ssh = useAsync(() => window.spoon.sshStatus(), [sshTick])

  const finish = (how: 'done' | 'skipped'): void => {
    markSeen(how)
    onClose()
  }
  const check = (id: string, label: ReactNode, on: boolean, set: (v: boolean) => void, hint?: string): ReactNode => (
    <label className="check tour-check" htmlFor={id}>
      <input id={id} type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />
      <span>
        {label}
        {hint && <span className="hint"> {hint}</span>}
      </span>
    </label>
  )
  const field = (label: string, control: ReactNode, hint?: string): ReactNode => (
    <div className="field">
      <span className="field-label">{label}</span>
      {control}
      {hint && <span className="hint">{hint}</span>}
    </div>
  )

  const steps: Step[] = [
    {
      id: 'welcome',
      title: 'Welcome to Spoon',
      lead: 'Put the fork down. In a few small steps you’ll see what you can make your own, and every change shows up as you pick it.',
      body: () => (
        <div className="tour-welcome">
          <p>Each step is one group of settings: colors, sizes, diffs, history, a few extras, then your accounts and projects.</p>
          <p className="muted">Skip any step, or the whole tour. Everything here is also in Settings ({keys('⌘,')}), and Help → Welcome Tour brings this back.</p>
        </div>
      )
    },
    {
      id: 'colors',
      title: 'Colors',
      lead: 'Pick a theme, then how much color code and branches get.',
      body: () => (
        <>
          {field(
            'Theme',
            <div className="theme-grid tour-themes">
              {THEME_CHOICES.filter((t) => t.id !== 'custom').map((t) => (
                <ThemeCard key={t.id} id={t.id} name={t.name} hint={t.hint} />
              ))}
            </div>,
            'Every color can be changed one by one later: Settings → Appearance → Custom.'
          )}
          {field(
            'Syntax colors in diffs',
            <Segmented<DiffSyntax> value={s.diffSyntax} options={[['full', 'Full'], ['subtle', 'Subtle'], ['off', 'Off']]} onChange={(diffSyntax) => updateSettings({ diffSyntax })} />
          )}
          {check('tour-lane-labels', 'Color branch labels like their line in the graph', s.laneColoredBranches, (laneColoredBranches) => updateSettings({ laneColoredBranches }))}
        </>
      ),
      preview: () => (
        <>
          <ScenePreview label="Code" spec={{ kind: 'syntax', from: s.diffSyntax, to: s.diffSyntax, words: s.diffWordChanges }} />
          <ScenePreview label="Branch labels" spec={{ kind: 'laneLabels', from: s.laneColoredBranches, to: s.laneColoredBranches }} />
        </>
      )
    },
    {
      id: 'size',
      title: 'Size and spacing',
      lead: 'Make everything bigger or smaller, and give the lists more or less room.',
      body: () => (
        <>
          <SizeControls />
          {field(
            'Row spacing',
            <Segmented<Density> value={s.density} options={[['compact', 'Compact'], ['comfortable', 'Comfortable'], ['spacious', 'Spacious']]} onChange={(density) => updateSettings({ density })} />
          )}
          {field(
            'Popups open',
            <Segmented<DialogPosition> value={s.dialogPosition} options={[['center', 'In the middle'], ['top', 'Near the top']]} onChange={(dialogPosition) => updateSettings({ dialogPosition })} />
          )}
        </>
      ),
      preview: () => (
        <>
          <ScenePreview label="Rows" spec={{ kind: 'density', from: s.density, to: s.density }} />
          <ScenePreview label="Code size" spec={{ kind: 'code', from: s.codeSize, to: s.codeSize }} />
        </>
      )
    },
    {
      id: 'diffs',
      title: 'Diffs',
      lead: 'How a file’s changes are shown.',
      body: () => (
        <>
          {field(
            'Layout',
            <Segmented<DiffLayout> value={s.diffLayout} options={[['unified', 'Unified'], ['split', 'Side by side']]} onChange={(diffLayout) => updateSettings({ diffLayout })} />,
            'Also switchable from any diff’s header.'
          )}
          {check('tour-words', 'Highlight the words that changed within a line', s.diffWordChanges, (diffWordChanges) => updateSettings({ diffWordChanges }))}
          {check('tour-tree', 'Show changed files as a folder tree', s.fileTree, (fileTree) => updateSettings({ fileTree }))}
        </>
      ),
      preview: () => (
        <>
          <ScenePreview label="Layout" spec={{ kind: 'layout', from: s.diffLayout, to: s.diffLayout }} />
          <ScenePreview label="Changed words" spec={{ kind: 'syntax', from: s.diffSyntax, to: s.diffSyntax, words: s.diffWordChanges }} />
        </>
      )
    },
    {
      id: 'history',
      title: 'History',
      lead: 'The commit list and its graph.',
      body: () => (
        <>
          {check('tour-squish', <>Squish branches: show only the first and latest commit of each <kbd className="setting-key">{keys('⇧⌘S')}</kbd></>, s.squishBranches, (squishBranches) => updateSettings({ squishBranches }))}
          {s.squishBranches &&
            field('Squished commits show as', <Segmented<SquishStyle> value={s.squishStyle} options={[['fold', 'Fold row'], ['bead', 'Bead on the line']]} onChange={(squishStyle) => updateSettings({ squishStyle })} />)}
          {field(
            'Tags',
            <Segmented<TagDisplay> value={s.tagDisplay} options={[['diamond', 'Diamond dot'], ['badge', 'Count on dot'], ['chip', 'Tag chip'], ['all', 'Show all']]} onChange={(tagDisplay) => updateSettings({ tagDisplay })} />
          )}
          {field(
            'Branch spotlight',
            <Segmented<LaneSpotlight> value={s.laneSpotlight} options={[['selected', 'Selected commit’s'], ['hover', 'Hovered label'], ['off', 'Off']]} onChange={(laneSpotlight) => updateSettings({ laneSpotlight })} />,
            'Lights up one branch’s line through the graph.'
          )}
          {field(
            'Checked-out commit',
            <Segmented<HeadHighlight> value={s.headHighlight} options={[['band', 'Highlighted row'], ['pill', 'HEAD label'], ['ring', 'Glowing dot']]} onChange={(headHighlight) => updateSettings({ headHighlight })} />
          )}
        </>
      ),
      preview: () => (
        <>
          <ScenePreview label="Branches" spec={{ kind: 'squish', from: s.squishBranches ? s.squishStyle : 'off', to: s.squishBranches ? s.squishStyle : 'off' }} />
          <ScenePreview label="Checked-out commit" spec={{ kind: 'head', from: s.headHighlight, to: s.headHighlight }} />
        </>
      )
    },
    {
      id: 'extras',
      title: 'A few extras',
      lead: 'Small things, on or off.',
      body: () => (
        <>
          {check('tour-playful', 'Playful toolbar: a dog fetches, a rope gets pulled, a big button gets pushed', s.playfulNet, (playfulNet) => updateSettings({ playfulNet }))}
          {check('tour-claude', 'Review with Claude: ask Claude to look over your changes before you commit', s.claudeEnabled, (claudeEnabled) => updateSettings({ claudeEnabled }))}
          {check('tour-drag', 'Drag files between Unstaged and Staged', s.dragFiles, (dragFiles) => updateSettings({ dragFiles }))}
          {check('tour-remote', 'Show the remote’s name on branch labels (☁ origin)', s.showRemoteName, (showRemoteName) => updateSettings({ showRemoteName }))}
        </>
      ),
      preview: () => (
        <>
          <ScenePreview label="Toolbar" spec={{ kind: 'playful', from: s.playfulNet, to: s.playfulNet }} />
          <ScenePreview label="Branch labels" spec={{ kind: 'remoteName', from: s.showRemoteName, to: s.showRemoteName }} />
        </>
      )
    },
    {
      id: 'accounts',
      title: 'GitHub and SSH',
      lead: 'So Spoon can list your repositories and download the ones that need an SSH key, like MainLib.',
      body: () => (
        <div className="tour-status">
          <div className="tour-status-row">
            <span className={`tone-dot ${account ? 'ok' : 'warn'}`} />
            <span className="tour-status-text">
              <b>GitHub</b>
              <span className="muted">{account ? `Connected as @${account.login}.` : 'Not connected. Sign in to clone your repositories and see pull requests.'}</span>
            </span>
            <button className="btn" onClick={() => onOpenSettings('accounts')}>
              {account ? 'Details…' : 'Connect…'}
            </button>
          </div>
          <div className="tour-status-row">
            <span className={`tone-dot ${ssh.data?.auth.state === 'ok' ? 'ok' : ssh.loading ? '' : 'warn'}`} />
            <span className="tour-status-text">
              <b>SSH key</b>
              <span className="muted">
                {ssh.loading && !ssh.data
                  ? 'Checking…'
                  : ssh.data?.auth.state === 'ok'
                    ? `Working: GitHub knows this computer’s key as @${ssh.data.auth.user}.`
                    : 'Not set up yet. Spoon can make a key and add it to GitHub for you.'}
              </span>
            </span>
            <button className="btn" onClick={requestSshSetup}>
              {ssh.data?.auth.state === 'ok' ? 'Details…' : 'Set Up…'}
            </button>
          </div>
          <p className="hint">Both can wait: Settings → Accounts has them whenever you need them.</p>
        </div>
      )
    },
    {
      id: 'projects',
      title: 'Your projects',
      lead: 'Where your repositories live, so the Tab search finds them.',
      body: () => (
        <>
          {field(
            'Look for repositories in',
            <div className="form-row">
              <span className="tour-folder mono">{tildify(s.scanFolder, home) || '~'}</span>
              <button
                className="btn"
                onClick={async () => {
                  const folder = await window.spoon.pickFolder('Folder with your repositories')
                  if (folder) updateSettings({ scanFolder: tildify(folder, home) })
                }}
              >
                Choose…
              </button>
            </div>,
            `Press ${keys('Tab')} anywhere in Spoon to search your projects, and the GitHub ones you haven’t cloned yet.`
          )}
          {check(
            'tour-subs',
            'Download missing submodules automatically',
            s.autoSubmodules,
            (autoSubmodules) => updateSettings({ autoSubmodules }),
            'A project opened for the first time comes complete, MainLib included.'
          )}
        </>
      )
    },
    {
      id: 'done',
      title: 'All set',
      lead: 'Spoon is yours. Where to start?',
      body: () => (
        <div className="tour-done">
          <div className="tour-actions">
            <button className="btn primary" onClick={() => (finish('done'), onClone())}>
              Clone a Repository…
            </button>
            <button className="btn" onClick={() => (finish('done'), onOpenFolder())}>
              Open a Folder…
            </button>
            <button className="btn" onClick={() => (finish('done'), onSearch())}>
              Search Projects <kbd className="soft">{keys('Tab')}</kbd>
            </button>
          </div>
          <ul className="tour-tips">
            <li>
              In Settings, hover the <span className="tour-eye">eye</span> next to a setting to see every option side by side.
            </li>
            <li>Right-click almost anything (files, commits, branches, tabs) for what you can do with it.</li>
            <li>Help → Welcome Tour shows this again.</li>
          </ul>
        </div>
      )
    }
  ]

  const step = steps[at]
  const last = at === steps.length - 1
  const next = (): void => (last ? finish('done') : setAt(at + 1))

  // ←/→ move between steps; Escape skips the tour (fields keep their own keys).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement
      if (t.closest('input, select, textarea')) return
      if (e.key === 'ArrowRight') setAt((i) => Math.min(steps.length - 1, i + 1))
      else if (e.key === 'ArrowLeft') setAt((i) => Math.max(0, i - 1))
      else if (e.key === 'Escape') finish('skipped')
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps.length])

  return (
    <div className="tour-backdrop">
      <div className="tour" role="dialog" aria-label={`Welcome tour: ${step.title}`}>
        <div className="tour-top">
          <span className="tour-dots" aria-hidden="true">
            {steps.map((st, i) => (
              <button key={st.id} className={`tour-dot ${i === at ? 'on' : i < at ? 'past' : ''}`} onClick={() => setAt(i)} title={st.title} tabIndex={-1} />
            ))}
          </span>
          <span className="tour-count muted">
            {at + 1} of {steps.length}
          </span>
          <span className="spacer" />
          <button className="tour-skip" onClick={() => finish('skipped')} style={last ? { visibility: 'hidden' } : undefined}>
            Skip the tour
          </button>
        </div>
        <div className={`tour-body ${step.id === 'welcome' ? 'welcome' : ''}`} key={step.id}>
          {step.id === 'welcome' && <div className="tour-art" aria-hidden="true" dangerouslySetInnerHTML={{ __html: wizardArt }} />}
          <div className="tour-main">
            <h2 className="tour-title">{step.title}</h2>
            <p className="tour-lead">{step.lead}</p>
            <div className="tour-fields">{step.body()}</div>
          </div>
          {step.preview ? (
            <div className="tour-preview">{step.preview()}</div>
          ) : (
            step.id !== 'welcome' && <div className="tour-art side" aria-hidden="true" dangerouslySetInnerHTML={{ __html: wizardArt }} />
          )}
        </div>
        <div className="tour-foot">
          {at > 0 && (
            <button className="btn" onClick={() => setAt(at - 1)}>
              Back
            </button>
          )}
          <span className="spacer" />
          {at > 0 && !last && (
            <button className="btn tour-step-skip" onClick={() => setAt(at + 1)} title="Leave these as they are">
              Skip this step
            </button>
          )}
          <button className="btn primary" onClick={next} autoFocus>
            {at === 0 ? 'Show me around' : last ? 'Finish' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}
