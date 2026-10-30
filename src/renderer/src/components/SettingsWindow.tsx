import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { clearFilter, filterOptions, type SearchResult } from '../settingsSearch'
import { refreshGitHubAccount, setGitHubAccount, useGitHubAccount } from '../github'
import { useAppInfo, useMinuteTick, useUpdateState } from '../appinfo'
import appIcon from '../../../../build/icon.png'
import { cleanError, useSlidingIndicator, useAsync } from '../hooks'
import { hoverPreview, PreviewCard, PreviewEye, type Preview, type PreviewSpec, type SectionState } from './SettingsPreview'
import type { DeviceCode, AtlassianAccount, SyntaxPalette, SyntaxSlot } from '../../../shared/types'
import { ideSchemes, paletteVars, SAMPLE, SLOT_LABELS } from '../syntax'
import { CodeText } from './DiffView'
import { contextMenu } from '../menus'
import { forgetProject, forgetProjects, projectName, tildify, useProjects } from '../projects'
import { knownAuthors } from '../authors'
import { askPin, setSimpleConfig, SIMPLE_DEFAULTS, TYPE_GROUPS, useSimpleConfig } from '../simpleMode'
import {
  SIDEBAR_SECTIONS,
  activeTheme,
  SCALE_MAX,
  SCALE_MIN,
  SCALE_STEP,
  updateSettings,
  useSettings,
  type Density,
  type DiffLayout,
  type SubmoduleTabs,
  type TagDisplay,
  type HeadHighlight,
  type LaneSpotlight,
  type SquishStyle,
  type DialogPosition,
  type DiffSyntax,
  MAINLIB_DEFAULTS
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
import { CloseIcon, PlusIcon, SearchIcon } from './Icons'
import { keys } from '../platform'

export type SettingsTab = 'appearance' | 'authors' | 'projects' | 'simple' | 'accounts' | 'about'
type Tab = SettingsTab

const TABS: [Tab, string][] = [
  ['appearance', 'Appearance'],
  ['authors', 'Author colors'],
  ['projects', 'Projects'],
  ['simple', 'Simple Mode'],
  ['accounts', 'Accounts'],
  ['about', 'About']
]

function TabPage({ tab }: { tab: Tab }) {
  if (tab === 'appearance') return <AppearanceTab />
  if (tab === 'authors') return <AuthorsTab />
  if (tab === 'projects') return <ProjectsTab />
  if (tab === 'simple') return <SimpleModeTab />
  if (tab === 'accounts') return <AccountsTab />
  return <AboutTab />
}

// Lookups the tabs need (gh login, Claude, Atlassian, IDE schemes): once each time Settings opens,
// not again whenever a search remounts the tabs.
let lookups = new Map<string, Promise<unknown>>()
function once<T>(key: string, load: () => Promise<T>): Promise<T> {
  if (!lookups.has(key)) lookups.set(key, load())
  return lookups.get(key) as Promise<T>
}

/** The repository showing behind Settings (for per-project settings such as Simple Mode). */
const ProjectContext = createContext<string | null>(null)

export function SettingsWindow({ onClose, initialTab = 'appearance', project = null }: { onClose: () => void; initialTab?: Tab; project?: string | null }) {
  useState(() => {
    lookups = new Map() // fresh answers for this opening
    return null
  })
  const [tab, setTab] = useState<Tab>(initialTab)
  const info = useAppInfo()
  const tabsRef = useSlidingIndicator<HTMLDivElement>(tab)

  // Search: every tab's options at once, the ones that don't match hidden (see settingsSearch.ts).
  const [query, setQuery] = useState('')
  const searching = !!query.trim()
  const input = useRef<HTMLInputElement>(null)
  const page = useRef<HTMLDivElement>(null)
  const [result, setResult] = useState<SearchResult | null>(null)
  useLayoutEffect(() => {
    const root = page.current
    if (!root || !searching) return
    const run = (): void => {
      const next = filterOptions(root, query)
      setResult((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next))
    }
    run()
    // Options that appear later (an account loading, a list filling) are filtered too.
    let frame = 0
    const watch = new MutationObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(run)
    })
    watch.observe(root, { childList: true, subtree: true, characterData: true })
    return () => {
      watch.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [query, searching])
  useEffect(() => {
    if (!searching && page.current) clearFilter(page.current)
  }, [searching])
  // ⌘F (which the menu sends as Filter Commits) jumps to the search while Settings is open.
  useEffect(() => {
    const focus = (): void => input.current?.focus()
    window.addEventListener('spoon:settings-search', focus)
    return () => window.removeEventListener('spoon:settings-search', focus)
  }, [])

  return (
    <Modal
      title="Settings"
      titleExtra={info && <span title="The Spoon version you're running">Spoon {info.version}</span>}
      // Esc clears a search first; the next one closes Settings.
      onClose={() => (searching ? setQuery('') : onClose())}
      wide
      footer={
        <button className="btn primary" onClick={onClose}>
          Done
        </button>
      }
    >
      <div className={`settings-search ${searching ? 'on' : ''}`}>
        <SearchIcon />
        <input
          ref={input}
          value={query}
          placeholder="Search settings"
          spellCheck={false}
          data-own-enter
          onChange={(e) => setQuery(e.target.value)}
        />
        {searching && result && (
          <span className="muted settings-search-count">
            {result.total} option{result.total === 1 ? '' : 's'}
          </span>
        )}
        {searching && (
          <button className="icon-btn" aria-label="Clear search" onClick={() => setQuery('')}>
            <CloseIcon />
          </button>
        )}
      </div>
      <div className={`settings-tabs ${searching ? 'searching' : 'slider'}`} ref={searching ? undefined : tabsRef}>
        {TABS.map(([id, label]) => {
          const n = searching ? (result?.counts[id] ?? 0) : null
          return (
            <button
              key={id}
              className={`${!searching && tab === id ? 'on' : ''} ${n === 0 ? 'dim' : ''}`}
              onClick={() => {
                if (!searching) return setTab(id)
                // While searching, a tab jumps to its matches.
                page.current?.querySelector(`.search-group[data-tab="${id}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
              }}
            >
              {label}
              {n !== null && n > 0 && <span className="search-count">{n}</span>}
            </button>
          )
        })}
      </div>
      <ProjectContext.Provider value={project}>
      <div className={`settings-page ${searching ? 'search-results' : ''}`} ref={page}>
        {searching ? (
          <>
            {TABS.map(([id, label]) => (
              <section key={id} className="search-group" data-tab={id}>
                <h5 className="search-group-title">{label}</h5>
                <div className="search-opts">
                  <TabPage tab={id} />
                </div>
              </section>
            ))}
            {result && result.total === 0 && (
              <div className="search-none">
                <b>No settings match “{query.trim()}”</b>
                {result.suggestions.length > 0 && (
                  <>
                    <span className="muted">Did you mean</span>
                    <div>
                      {result.suggestions.map((s) => (
                        <button key={s} className="search-suggestion" onClick={() => setQuery(s)}>
                          {s}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        ) : (
          <TabPage tab={tab} />
        )}
      </div>
      </ProjectContext.Provider>
      <PreviewCard />
    </Modal>
  )
}

// ---------- appearance ----------

const pct = (v: number): string => `${Math.round(v * 100)}%`

/** A size setting's eye: a step smaller, the current size and a step bigger. */
function sizeOptions(
  title: string,
  current: number,
  steps: number[],
  min: number,
  max: number,
  name: (v: number) => string,
  spec: (v: number) => PreviewSpec
): Preview {
  const values = [...new Set(steps.map((d) => Math.round(Math.min(max, Math.max(min, current + d)) * 100) / 100))]
  return {
    title,
    spec: spec(current),
    options: values.map((v) => ({ label: name(v), current: Math.abs(v - current) < 0.001, spec: spec(v) }))
  }
}

export function SizeControls() {
  const s = useSettings()
  return (
    <>
      <label className="field">
        <span className="field-label">
          Interface size
          <PreviewEye
            label="Interface size"
            make={() => sizeOptions('Interface size', s.uiScale, [-0.15, 0, 0.15], SCALE_MIN, SCALE_MAX, pct, (v) => ({ kind: 'size', from: v, to: v }))}
          />
          <b>{Math.round(s.uiScale * 100)}%</b>
        </span>
        <div className="stepper">
          <button
            onClick={() => updateSettings({ uiScale: s.uiScale - SCALE_STEP })}
            aria-label="Smaller"
          >
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
          <button
            className="big"
            onClick={() => updateSettings({ uiScale: s.uiScale + SCALE_STEP })}
            aria-label="Bigger"
          >
            A
          </button>
        </div>
        <span className="hint">Scales every element and font. Shortcut: {keys('⌘+ ⌘− ⌘0')}</span>
      </label>
      <label className="field">
        <span className="field-label">
          Diff font size
          <PreviewEye
            label="Diff font size"
            make={() => sizeOptions('Diff font size', s.codeSize, [-2, 0, 2], 9, 24, (v) => `${v}px`, (v) => ({ kind: 'code', from: v, to: v }))}
          />
          <b>{s.codeSize}px</b>
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
      <div className="field">
        <span className="field-label">
          Popups open
          <PreviewEye label={'Popups open'} make={() => choicePreviews<DialogPosition>('Popups open', s.dialogPosition, [
            ['center', 'In the middle'],
            ['top', 'Near the top']
          ], (from, to) => ({ kind: 'dialogs', from, to }))} />
        </span>
        <Segmented<DialogPosition>
          value={s.dialogPosition}
          options={[
            ['center', 'In the middle'],
            ['top', 'Near the top']
          ]}
          onChange={(dialogPosition) => updateSettings({ dialogPosition })}
        />
        <span className="hint">Where every popup (Settings, New tag, Create pull request, Review with Claude…) appears. It grows downward from there. Also switchable by right-clicking any popup’s title.</span>
      </div>
      <SizeControls />
      <div className="field">
        <span className="field-label">
          Row spacing
          <PreviewEye label={'Row spacing'} make={() => choicePreviews<Density>('Row spacing', s.density, [
            ['compact', 'Compact'],
            ['comfortable', 'Comfortable'],
            ['spacious', 'Spacious']
          ], (from, to) => ({ kind: 'density', from, to }))} />
        </span>
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
      <div className="field">
        <span className="field-label">
          Diff layout
          <PreviewEye label={'Diff layout'} make={() => choicePreviews<DiffLayout>('Diff layout', s.diffLayout, [
            ['unified', 'Unified'],
            ['split', 'Side by side']
          ], (from, to) => ({ kind: 'layout', from, to }))} />
        </span>
        <Segmented<DiffLayout>
          value={s.diffLayout}
          options={[
            ['unified', 'Unified'],
            ['split', 'Side by side']
          ]}
          onChange={(diffLayout) => updateSettings({ diffLayout })}
        />
        <span className="hint">Also switchable from any diff’s header.</span>
      </div>
      <div className="field">
        <span className="field-label">
          Syntax colors in diffs
          <PreviewEye label={'Syntax colors in diffs'} make={() => choicePreviews<DiffSyntax>('Syntax colors in diffs', s.diffSyntax, [
            ['full', 'Full'],
            ['subtle', 'Subtle'],
            ['off', 'Off']
          ], (from, to) => ({ kind: 'syntax', from, to, words: s.diffWordChanges }))} />
        </span>
        <Segmented<DiffSyntax>
          value={s.diffSyntax}
          options={[
            ['full', 'Full'],
            ['subtle', 'Subtle'],
            ['off', 'Off']
          ]}
          onChange={(diffSyntax) => updateSettings({ diffSyntax })}
        />
        <span className="hint">
          The language comes from the file’s extension; click it in a diff’s header to pick another. Unity scenes,
          prefabs and assets fade object ids and name the GameObject a change is in.
        </span>
      </div>
      <SyntaxSourceField />
      {/* The eye sits outside the label, so pressing it never presses the checkbox. */}
      <div className="check">
        <input
          id="set-diff-word-changes"
          type="checkbox"
          checked={s.diffWordChanges}
          onChange={(e) => updateSettings({ diffWordChanges: e.target.checked })}
        />
        <span>
          <label htmlFor="set-diff-word-changes">Highlight the words that changed within a line</label>{' '}
          <ToggleEye
            title={'Changed words'}
            on={s.diffWordChanges}
            spec={(from, to) => ({ kind: 'syntax', from: s.diffSyntax, to: s.diffSyntax, words: to, wordsFrom: from })}
          />
        </span>
      </div>
      <div className="field">
        <span className="field-label">
          Tags in the commit list
          <PreviewEye label={'Tags in the commit list'} make={() => choicePreviews<TagDisplay>('Tags in the commit list', s.tagDisplay, [
            ['diamond', 'Diamond dot'],
            ['badge', 'Count on dot'],
            ['chip', 'Tag chip'],
            ['all', 'Show all']
          ], (from, to) => ({ kind: 'tags', from, to }))} />
        </span>
        <Segmented<TagDisplay>
          value={s.tagDisplay}
          options={[
            ['diamond', 'Diamond dot'],
            ['badge', 'Count on dot'],
            ['chip', 'Tag chip'],
            ['all', 'Show all']
          ]}
          onChange={(tagDisplay) => updateSettings({ tagDisplay })}
        />
        <span className="hint">Collapsed tags open in a list when you click the dot or chip.</span>
      </div>
      {/* The eye sits outside the label, so pressing it never presses the checkbox. */}
      <div className="check">
        <input
          id="set-squish-branches"
          type="checkbox"
          checked={s.squishBranches}
          onChange={(e) => updateSettings({ squishBranches: e.target.checked })}
        />
        <span>
          <label htmlFor="set-squish-branches">Squish branches: show only the first and latest commit of each branch</label>{' '}
          <kbd className="setting-key" title="View → Squish Branches">{keys('⇧⌘S')}</kbd>{' '}
          <ToggleEye
            title={'Squish branches'}
            on={s.squishBranches}
            spec={(from, to) => ({ kind: 'squish', from: from ? s.squishStyle : 'off', to: to ? s.squishStyle : 'off' })}
          />
        </span>
      </div>
      <div className="field">
        <span className="field-label">
          Squished commits show as
          <PreviewEye label={'Squished commits'} make={() => choicePreviews<SquishStyle>('Squished commits show as', s.squishStyle, [
            ['fold', 'Fold row'],
            ['bead', 'Bead on the line']
          ], (from, to) => ({ kind: 'squish', from, to }))} />
        </span>
        <Segmented<SquishStyle>
          value={s.squishStyle}
          options={[
            ['fold', 'Fold row'],
            ['bead', 'Bead on the line']
          ]}
          onChange={(squishStyle) => updateSettings({ squishStyle })}
        />
        <span className="hint">
          Click a fold row or bead to show those commits again. {keys('⇧⌘S')} turns squishing on and off from anywhere.
        </span>
      </div>
      {/* The eye sits outside the label, so pressing it never presses the checkbox. */}
      <div className="check">
        <input id="set-branch-labels-in-lane-colors"
          type="checkbox"
          checked={s.laneColoredBranches}
          onChange={(e) => updateSettings({ laneColoredBranches: e.target.checked })}
        />
        <span>
          <label htmlFor="set-branch-labels-in-lane-colors">Color branch labels like their graph line</label> <ToggleEye title={'Branch labels in lane colors'} on={s.laneColoredBranches} spec={(from, to) => ({ kind: 'laneLabels', from, to })} />
        </span>
      </div>
      {/* The eye sits outside the label, so pressing it never presses the checkbox. */}
      <div className="check">
        <input id="set-playful-toolbar-animations" type="checkbox" checked={s.playfulNet} onChange={(e) => updateSettings({ playfulNet: e.target.checked })} />
        <span>
          <label htmlFor="set-playful-toolbar-animations">Playful toolbar animations: a dog fetches, a rope gets pulled, a big button gets pushed</label> <ToggleEye title={'Playful toolbar animations'} on={s.playfulNet} spec={(from, to) => ({ kind: 'playful', from, to })} />
        </span>
      </div>
      {/* The eye sits outside the label, so pressing it never presses the checkbox. */}
      <div className="check">
        <input id="set-remote-name-on-branch-labels"
          type="checkbox"
          checked={s.showRemoteName}
          onChange={(e) => updateSettings({ showRemoteName: e.target.checked })}
        />
        <span>
          <label htmlFor="set-remote-name-on-branch-labels">Show the remote’s name next to the cloud on branch labels (☁ origin), including remote-only branches</label> <ToggleEye title={'Remote name on branch labels'} on={s.showRemoteName} spec={(from, to) => ({ kind: 'remoteName', from, to })} />
        </span>
      </div>
      <div className="field">
        <span className="field-label">
          Branch spotlight
          <PreviewEye label={'Branch spotlight'} make={() => choicePreviews<LaneSpotlight>('Branch spotlight', s.laneSpotlight, [
            ['selected', 'Selected commit’s branch'],
            ['hover', 'Hovered branch label'],
            ['off', 'Off']
          ], (from, to) => ({ kind: 'spotlight', from, to }))} />
        </span>
        <Segmented<LaneSpotlight>
          value={s.laneSpotlight}
          options={[
            ['selected', 'Selected commit’s branch'],
            ['hover', 'Hovered branch label'],
            ['off', 'Off']
          ]}
          onChange={(laneSpotlight) => updateSettings({ laneSpotlight })}
        />
        <span className="hint">Lights up one branch’s line through the graph and dims the rest.</span>
      </div>
      {/* The eye sits outside the label, so pressing it never presses the checkbox. */}
      <div className="check">
        <input
          id="set-spotlight-fade"
          type="checkbox"
          checked={s.spotlightFadeCommits}
          disabled={s.laneSpotlight === 'off'}
          onChange={(e) => updateSettings({ spotlightFadeCommits: e.target.checked })}
        />
        <span>
          <label htmlFor="set-spotlight-fade">Also fade the commits of other branches, not just their lines</label>{' '}
          <ToggleEye title={'Fade other branches’ commits'} on={s.spotlightFadeCommits} spec={(from, to) => ({ kind: 'spotFade', from, to })} />
        </span>
      </div>
      <div className="field">
        <span className="field-label">
          Checked-out commit
          <PreviewEye label={'Checked-out commit'} make={() => choicePreviews<HeadHighlight>('Checked-out commit', s.headHighlight, [
            ['band', 'Highlighted row'],
            ['pill', 'HEAD label'],
            ['ring', 'Glowing dot']
          ], (from, to) => ({ kind: 'head', from, to }))} />
        </span>
        <Segmented<HeadHighlight>
          value={s.headHighlight}
          options={[
            ['band', 'Highlighted row'],
            ['pill', 'HEAD label'],
            ['ring', 'Glowing dot']
          ]}
          onChange={(headHighlight) => updateSettings({ headHighlight })}
        />
      </div>
      <div className="field">
        <span className="field-label">
          Submodule tabs
          <PreviewEye label={'Submodule tabs'} make={() => choicePreviews<SubmoduleTabs>('Submodule tabs', s.submoduleTabs, [
            ['grouped', 'Grouped with parent'],
            ['labelled', 'Labelled “in parent”']
          ], (from, to) => ({ kind: 'subtabs', from, to }))} />
        </span>
        <Segmented<SubmoduleTabs>
          value={s.submoduleTabs}
          options={[
            ['grouped', 'Grouped with parent'],
            ['labelled', 'Labelled “in parent”']
          ]}
          onChange={(submoduleTabs) => updateSettings({ submoduleTabs })}
        />
      </div>
      <BranchColorsField />
      <SidebarSectionsField />
      <PullGroupsField />
      <div className="field">
        <span className="field-label">Theme</span>
        <div className="theme-grid">
          {THEME_CHOICES.map((t) => (
            <ThemeCard key={t.id} id={t.id} name={t.name} hint={t.hint} />
          ))}
        </div>
        {s.theme === 'custom' && <CustomColors />}
      </div>
    </>
  )
}

/** Hover handlers for an on/off setting: previews flipping it. */
function ToggleEye({ title, on, spec }: { title: string; on: boolean; spec: (from: boolean, to: boolean) => PreviewSpec }) {
  return (
    <PreviewEye
      label={title}
      make={() => ({
        title,
        spec: spec(on, on),
        options: [false, true].map((v) => ({ label: v ? 'On' : 'Off', current: v === on, spec: spec(v, v) }))
      })}
    />
  )
}

/** Every option of a choice, side by side, for its eye. */
function choicePreviews<T extends string>(
  title: string,
  value: T,
  options: [T, string][],
  spec: (from: T, to: T) => PreviewSpec
): Preview {
  return {
    title,
    spec: spec(value, value),
    options: options.map(([v, label]) => ({ label, current: v === value, spec: spec(v, v) }))
  }
}

function SidebarSectionsField() {
  const s = useSettings()
  const list = s.sidebarSections
  const move = (i: number, d: -1 | 1): void => {
    const next = [...list]
    ;[next[i], next[i + d]] = [next[i + d], next[i]]
    updateSettings({ sidebarSections: next })
  }
  const states = (l: typeof list): SectionState[] =>
    l.map((x) => ({ id: x.id, visible: x.visible, label: SIDEBAR_SECTIONS.find((d) => d.id === x.id)?.label ?? x.id }))
  const preview = (next: typeof list, change: string) =>
    hoverPreview(() => ({ title: 'Sidebar sections', from: 'Now', to: change, spec: { kind: 'sidebar', from: states(list), to: states(next) } }))
  const moved = (i: number, d: -1 | 1): typeof list => {
    const next = [...list]
    ;[next[i], next[i + d]] = [next[i + d], next[i]]
    return next
  }
  return (
    <div className="field">
      <span className="field-label">
        Sidebar sections
        <PreviewEye
          label="Sidebar sections"
          make={() => {
            const defaults = SIDEBAR_SECTIONS.map((d) => ({ id: d.id, visible: true }))
            const same = JSON.stringify(defaults) === JSON.stringify(list.map(({ id, visible }) => ({ id, visible })))
            const tile = (l: typeof list): PreviewSpec => ({ kind: 'sidebar', from: states(l), to: states(l) })
            return {
              title: 'Sidebar sections',
              spec: tile(list),
              options: same
                ? [{ label: 'Now (the default)', current: true, spec: tile(list) }]
                : [
                    { label: 'Now', current: true, spec: tile(list) },
                    { label: 'Default (Reset)', current: false, spec: tile(defaults) }
                  ]
            }
          }}
        />
      </span>
      <div className="section-order">
        {list.map((x, i) => (
          <div key={x.id} className={`section-order-row ${x.visible ? '' : 'hidden'}`}>
            <label
              className="check"
              {...preview(
                list.map((y) => (y.id === x.id ? { ...y, visible: !y.visible } : y)),
                x.visible ? 'Hidden' : 'Shown'
              )}
            >
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
            <button
              className="icon-btn"
              disabled={i === 0}
              onClick={() => move(i, -1)}
              aria-label="Move up"
              {...(i > 0 ? preview(moved(i, -1), 'Moved up') : {})}
            >
              ↑
            </button>
            <button
              className="icon-btn"
              disabled={i === list.length - 1}
              onClick={() => move(i, 1)}
              aria-label="Move down"
              {...(i < list.length - 1 ? preview(moved(i, 1), 'Moved down') : {})}
            >
              ↓
            </button>
          </div>
        ))}
      </div>
      <span className="hint">Switch a section off to hide it; the arrows change the order.</span>
    </div>
  )
}

const COLOR_NAMES = ['Color 1', 'Color 2', 'Color 3', 'Color 4', 'Color 5', 'Color 6', 'Color 7', 'Color 8']

/** Reserve any of the 8 branch colors for one or more branch-name prefixes. */
function BranchColorsField() {
  const s = useSettings()
  const colors = activeTheme(s).colors
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const reserved = s.reservedColors

  const add = (i: number): void => {
    let v = (drafts[i] ?? '').trim()
    if (!v) return
    if (!v.endsWith('/')) v += '/'
    // A prefix lives in one color: adding it here moves it from wherever it was.
    const next: Record<number, string[]> = {}
    for (const [k, list] of Object.entries(reserved)) next[Number(k)] = list.filter((p) => p !== v)
    next[i] = [...(next[i] ?? []), v]
    updateSettings({ reservedColors: next })
    setDrafts((d) => ({ ...d, [i]: '' }))
  }
  const remove = (i: number, p: string): void =>
    updateSettings({ reservedColors: { ...reserved, [i]: (reserved[i] ?? []).filter((x) => x !== p) } })

  // Previews: a branch with the slot's prefix goes from an automatic color to the reserved one.
  const reservedSlots = Object.entries(reserved).filter(([, l]) => l.length).map(([k]) => Number(k))
  const autoLane = (not: number): number => [0, 1, 2, 3, 4, 5, 6, 7].find((x) => x !== not && !reservedSlots.includes(x)) ?? (not + 1) % 8
  const slotPreview = (i: number) =>
    hoverPreview(() => {
      const auto = autoLane(i)
      return {
        title: `${COLOR_NAMES[i]} for ${reserved[i]?.[0] ?? 'release/'} branches`,
        from: 'Automatic',
        to: COLOR_NAMES[i],
        spec: { kind: 'branch', prefix: reserved[i]?.[0] ?? 'release/', from: { label: auto, line: auto }, to: { label: i, line: s.reservedColorsGraph ? i : auto } }
      }
    })
  // The graph-line switch's eye: the reserved branch with its line in the usual color, then in its own.
  const graphOptions = (): Preview => {
    const slot = reservedSlots[0] ?? 2
    const auto = autoLane(slot)
    const prefix = reserved[slot]?.[0] ?? 'release/'
    const spec = (on: boolean): PreviewSpec => ({ kind: 'branch', prefix, from: { label: slot, line: on ? slot : auto }, to: { label: slot, line: on ? slot : auto } })
    return {
      title: 'Reserved color on the graph line',
      spec: spec(s.reservedColorsGraph),
      options: [false, true].map((on) => ({ label: on ? 'On' : 'Off', current: on === s.reservedColorsGraph, spec: spec(on) }))
    }
  }

  return (
    <div className="field">
      <span className="field-label">Branch colors</span>
      <span className="hint">
        Reserve a color for branch prefixes (type one and press Enter). Reserved colors are only used for those
        branches; other branches share the rest.
      </span>
      <div className="color-slots">
        {COLOR_NAMES.map((name, i) => {
          const c = colors[`lane-${i}` as ColorKey]
          const list = reserved[i] ?? []
          return (
            <div
              key={i}
              className={`color-slot ${list.length ? 'reserved' : ''}`}
              style={{ '--slot': c } as React.CSSProperties}
              {...slotPreview(i)}
            >
              <div className="slot-top">
                <span className="slot-swatch" />
                <span>{name}</span>
                <span className="spacer" />
                <span className="hint">{list.length ? 'reserved' : 'auto'}</span>
              </div>
              <div className="slot-chips">
                {list.map((p) => (
                  <span key={p} className="slot-chip mono">
                    {p}
                    <button aria-label={`Remove ${p}`} onClick={() => remove(i, p)}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <input
                className="slot-input mono"
                placeholder="+ prefix/"
                value={drafts[i] ?? ''}
                onChange={(e) => setDrafts((d) => ({ ...d, [i]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    e.stopPropagation()
                    add(i)
                  }
                }}
                spellCheck={false}
              />
            </div>
          )
        })}
      </div>
      <div className="check">
        <input
          id="set-reserved-graph-line"
          type="checkbox"
          checked={s.reservedColorsGraph}
          onChange={(e) => updateSettings({ reservedColorsGraph: e.target.checked })}
        />
        <span>
          <label htmlFor="set-reserved-graph-line">Also color the branch’s graph line</label>{' '}
          <PreviewEye label="Reserved color on the graph line" make={graphOptions} />
        </span>
      </div>
    </div>
  )
}

function PullGroupsField() {
  const s = useSettings()
  const rows: { id: 'awaiting' | 'yours' | 'others'; label: string }[] = [
    { id: 'awaiting', label: 'Awaiting your review' },
    { id: 'yours', label: 'Yours' },
    { id: 'others', label: 'Others' }
  ]
  return (
    <div className="field">
      <span className="field-label">Pull request list</span>
      <div className="section-order">
        {rows.map((r) => {
          const locked = r.id === 'awaiting'
          const on = locked || s.prGroups[r.id as 'yours' | 'others']
          return (
            <div key={r.id} className={`section-order-row ${on ? '' : 'hidden'}`}>
              <label className="check" title={locked ? 'Always shown' : undefined}>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={locked}
                  onChange={(e) => updateSettings({ prGroups: { ...s.prGroups, [r.id]: e.target.checked } })}
                />
                {r.label}
                {locked && <span className="hint"> · always shown</span>}
              </label>
            </div>
          )
        })}
      </div>
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

// ---------- custom theme colors ----------

const BASE_CHOICES = THEME_CHOICES.filter((t) => t.id !== 'custom') as { id: BaseThemeChoice; name: string }[]

/** The Custom theme's palette, shown under the theme cards while Custom is selected. */
function CustomColors() {
  const s = useSettings()
  const shown = activeTheme(s).colors
  const base = resolveTheme(s.customBase).colors

  const setColor = (key: ColorKey, value: string): void => updateSettings({ customColors: { ...s.customColors, [key]: value } })
  const resetColor = (key: ColorKey): void => {
    const next = { ...s.customColors }
    delete next[key]
    updateSettings({ customColors: next })
  }

  return (
    <div className="custom-colors">
      <div className="form-row">
        <span className="field-label">Start from</span>
        <select value={s.customBase} onChange={(e) => updateSettings({ customBase: e.target.value as BaseThemeChoice })}>
          {BASE_CHOICES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <span className="spacer" />
        {Object.keys(s.customColors).length > 0 && (
          <button className="btn" onClick={() => updateSettings({ customColors: {} })}>
            Reset all
          </button>
        )}
      </div>
      <p className="hint">Colors you haven’t changed follow the theme you start from.</p>
      {COLOR_ELEMENTS.map((g) => (
        <div key={g.group} className="color-group">
          <h4>{g.group}</h4>
          <div className="color-grid">
            {g.items.map(({ key, label }) => {
              const changed = s.customColors[key] !== undefined && s.customColors[key] !== base[key]
              return (
                <label
                  key={key}
                  className={`color-item ${changed ? 'changed' : ''}`}
                  {...hoverPreview(() => ({ title: `Where “${label}” is used`, spec: { kind: 'color', key } }))}
                >
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
    </div>
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

  // Previews: a few of this repository's authors, colored as now and as they'd be after the change.
  const key = (n: string): string => n.trim().toLowerCase()
  const colorNow = (n: string): string | null =>
    s.authorColorsEnabled ? (s.authorColors.find((a) => a.name.trim() && key(a.name) === key(n))?.color ?? null) : null
  const sample = (first?: string): string[] => {
    const names = [first, ...s.authorColors.map((a) => a.name.trim()), ...missing].filter((n): n is string => !!n)
    const unique = names.filter((n, i) => names.findIndex((m) => key(m) === key(n)) === i).slice(0, 3)
    return unique.length ? unique : ['Alex Kim', 'Sam Lee', 'Jo Park']
  }
  const authorsPreview = (title: string, from: string, to: string, names: string[], after: (n: string) => string | null) =>
    hoverPreview(() => {
      const authors = names.map((name) => ({ name, from: colorNow(name), to: after(name) }))
      return authors.some((a) => a.from !== a.to) ? { title, from, to, spec: { kind: 'authors', authors } } : null
    })
  const listedColor = (n: string): string | null => s.authorColors.find((a) => a.name.trim() && key(a.name) === key(n))?.color ?? null

  return (
    <>
      <div className="check">
        <input
          id="set-author-colors"
          type="checkbox"
          checked={s.authorColorsEnabled}
          onChange={(e) => updateSettings({ authorColorsEnabled: e.target.checked })}
        />
        <span>
          <label htmlFor="set-author-colors">Color commits by author</label>{' '}
          {sample().some((n) => listedColor(n)) && (
            <PreviewEye
              label="Color commits by author"
              make={() => {
                const tile = (on: boolean): PreviewSpec => ({
                  kind: 'authors',
                  authors: sample().map((name) => ({ name, from: on ? listedColor(name) : null, to: on ? listedColor(name) : null }))
                })
                return {
                  title: 'Color commits by author',
                  spec: tile(s.authorColorsEnabled),
                  options: [false, true].map((on) => ({ label: on ? 'On' : 'Off', current: on === s.authorColorsEnabled, spec: tile(on) }))
                }
              }}
            />
          )}
        </span>
      </div>
      <p className="hint">
        Listed authors get their color on the commit dot, avatar and a tint across the row. Match by name or email;
        authors not listed keep the normal look.
      </p>

      <div className={`author-list ${s.authorColorsEnabled ? '' : 'disabled'}`}>
        {s.authorColors.map((a, i) => (
          <div key={i} className="author-row">
            <input
              type="color"
              value={a.color}
              onChange={(e) => update(i, { color: e.target.value })}
              {...authorsPreview(`${a.name.trim() || 'This author'}’s color`, 'Normal', 'Colored', sample(a.name.trim() || undefined), (n) =>
                key(n) === key(a.name) ? a.color : colorNow(n)
              )}
            />
            <AuthorInput value={a.name} authors={authors} onChange={(name) => update(i, { name })} />
            <span
              className="author-sample"
              style={{ '--author': a.color } as React.CSSProperties}
              {...authorsPreview(`${a.name.trim() || 'This author'}’s color`, 'Normal', 'Colored', sample(a.name.trim() || undefined), (n) =>
                key(n) === key(a.name) ? a.color : colorNow(n)
              )}
            >
              {a.name || 'Preview'}
            </span>
            <button
              className="icon-btn"
              aria-label="Remove"
              onClick={() => updateSettings({ authorColors: s.authorColors.filter((_, j) => j !== i) })}
              {...authorsPreview(`Remove ${a.name.trim() || 'this author'}`, 'Colored', 'Normal', sample(a.name.trim() || undefined), (n) =>
                key(n) === key(a.name) ? null : colorNow(n)
              )}
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
            {...authorsPreview(missing.length === 1 ? `Add ${missing[0]}` : `Add all ${missing.length} authors`, 'Now', 'All colored', sample(), (n) =>
              listedColor(n) ?? nextColor(missing.findIndex((m) => key(m) === key(n)))
            )}
          >
            {missing.length === 1 ? `Add ${missing[0]} from this repository` : `Add all ${missing.length} authors from this repository`}
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
  // Once connected, the sign-in options only come back when you choose to switch accounts.
  const [switching, setSwitching] = useState(false)

  useEffect(() => {
    once('ghCliLogin', () => window.spoon.ghCliLogin()).then(setCliLogin)
  }, [])

  const attempt = async (label: string, fn: () => Promise<unknown>): Promise<void> => {
    setBusy(label)
    setError(null)
    try {
      await fn()
      await refreshGitHubAccount()
      setSwitching(false)
    } catch (err) {
      setError(cleanError(err))
    } finally {
      setBusy(null)
    }
  }

  // Spoon's own OAuth app (spoon.config.json) unless you've set your own Client ID.
  const builtInClientId = useAppInfo()?.githubClientId ?? ''
  const clientId = s.githubClientId || builtInClientId
  const browserSignIn = (): Promise<void> =>
    attempt('browser', async () => {
      const code = await window.spoon.ghDeviceStart(clientId)
      setDevice(code)
      try {
        await window.spoon.ghDeviceWait(clientId, code)
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
          {!switching && (
            <button className="btn" onClick={() => setSwitching(true)}>
              Switch account…
            </button>
          )}
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

      {(!account || switching) && (
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
              {builtInClientId ? (
                <span className="palette-path">Opens GitHub in your browser to approve Spoon, like Fork.</span>
              ) : (
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
              )}
            </div>
            <div className="form-row">
              {!builtInClientId && (
                <SettingInput
                  placeholder="OAuth app Client ID"
                  value={s.githubClientId}
                  onCommit={(v) => updateSettings({ githubClientId: v.trim() })}
                  spellCheck={false}
                  className="mono"
                />
              )}
              <button className="btn" disabled={!clientId || !!busy} onClick={browserSignIn}>
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
      )}
      {account && switching && (
        <button className="btn cancel-switch" onClick={() => setSwitching(false)}>
          Keep {account.login}
        </button>
      )}
      {error && <p className="error-text">{error}</p>}

      <div className="field jira-field">
        <span className="field-label">Jira</span>
        <span className="hint">
          Ticket keys in branch names and commit messages (like MAINLIB-2580) become links to your Jira site. No sign-in
          needed; your browser handles that.
        </span>
        <div className="form-row">
          <SettingInput
            placeholder="https://your-company.atlassian.net"
            value={s.jiraSite}
            onCommit={(v) => updateSettings({ jiraSite: v.trim() })}
            spellCheck={false}
            className="mono"
          />
        </div>
        <div className="form-row">
          <SettingInput
            placeholder="Only these projects (optional): MAINLIB, CANFA"
            value={s.jiraProjects}
            onCommit={(v) => updateSettings({ jiraProjects: v })}
            spellCheck={false}
          />
        </div>
        {s.jiraSite && !/^https:\/\//.test(s.jiraSite) && (
          <span className="error-text">The address must start with https://</span>
        )}
      </div>

      <TicketBranchField />
      <ClaudeField />
      <MainLibField />
    </>
  )
}

function TicketBranchField() {
  const s = useSettings()
  const row = (label: string, input: React.ReactNode) => (
    <div className="nb-setting">
      <span className="hint">{label}</span>
      {input}
    </div>
  )
  return (
    <div className="field jira-field">
      <span className="field-label">
        New branch from ticket <kbd className="setting-key">{keys('⌘N')}</kbd>
      </span>
      <span className="hint">
        Paste a Jira link (one you just copied is filled in) and Spoon builds the branch name from this pattern. Every
        part can still be edited before creating it.
      </span>
      {row(
        'Pattern',
        <SettingInput
          className="mono"
          value={s.branchPattern}
          spellCheck={false}
          onCommit={(v) => updateSettings({ branchPattern: v.trim() || '{type}/{dev}/{ticket}/{description}' })}
        />
      )}
      <span className="hint">
        Parts: {'{type}'} {'{dev}'} {'{ticket}'} {'{description}'}; any other text stays as written, and each / starts a
        new part.
      </span>
      {row('Types', <SettingInput value={s.branchTypes} spellCheck={false} onCommit={(v) => updateSettings({ branchTypes: v })} />)}
      {row(
        'Dev name',
        <SettingInput
          value={s.branchDevName}
          placeholder="First name from git’s user.name"
          spellCheck={false}
          onCommit={(v) => updateSettings({ branchDevName: v.trim() })}
        />
      )}
      {row(
        'Based on',
        <SettingInput
          className="mono"
          value={s.branchBase}
          placeholder="develop"
          spellCheck={false}
          onCommit={(v) => updateSettings({ branchBase: v.trim() })}
        />
      )}
      <span className="hint">
        Starts from this branch when the repository has it (its remote copy when the local one is behind), else the
        checked-out one. With an Atlassian account connected below, the ticket’s title becomes the description, and a
        bug picks “fix”.
      </span>
    </div>
  )
}

function ClaudeField() {
  const s = useSettings()
  const { data: avail } = useAsync(() => once('claude', () => window.spoon.claudeAvailability()), [])
  const found = avail ? [avail.desktop && 'the Claude app', avail.cli && 'Claude Code'].filter(Boolean).join(' and ') : ''
  return (
    <div className="field jira-field">
      <span className="field-label">Claude</span>
      <label className="check">
        <input type="checkbox" checked={s.claudeEnabled} onChange={(e) => updateSettings({ claudeEnabled: e.target.checked })} />
        Review with Claude
      </label>
      <span className="hint">
        Adds a Claude button next to Push ({keys('⇧⌘R')}), a Review button in the commit box and “Review This Commit” to the
        right-click menu. Reviews open in the Claude app or in Terminal, using your own Claude sign-in.
        {avail && (found ? ` Found ${found} on this computer.` : ' Neither the Claude app nor Claude Code is installed.')}
      </span>
    </div>
  )
}

function MainLibField() {
  const s = useSettings()
  const [account, setAccount] = useState<AtlassianAccount | null | undefined>(undefined)
  const [email, setEmail] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    once('atlassian', () => window.spoon.atlassianAccount()).then(setAccount)
  }, [])
  const url = (key: 'mainlibChangelogUrl' | 'mainlibInstructionsUrl', label: string, hint: string, def: string) => (
    <div className="field">
      <span className="field-label">
        {label}
        {s[key] !== def && (
          <button className="link-btn" onClick={() => updateSettings({ [key]: def })}>
            Reset to the team default
          </button>
        )}
      </span>
      <SettingInput className="mono" value={s[key]} spellCheck={false} onCommit={(v) => updateSettings({ [key]: v.trim() })} />
      <span className="hint">{hint}</span>
    </div>
  )
  const connect = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      setAccount(await window.spoon.atlassianConnect(email, token, s.mainlibChangelogUrl))
      setToken('')
    } catch (err) {
      setError(cleanError(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="field jira-field mainlib-field">
      <span className="field-label">MainLib updates</span>
      <span className="hint">
        In a repository with the {s.mainlibName} submodule, “Update {s.mainlibName}…” (submodule menu) moves it to a newer
        version branch and can hand the follow-up work to Claude.
      </span>
      {url('mainlibChangelogUrl', 'Changelog page', 'Where the version pills and ticket lists come from.', MAINLIB_DEFAULTS.changelog)}
      {url(
        'mainlibInstructionsUrl',
        'Upgrade instructions',
        'The page Claude follows when it updates MainLib in a game.',
        MAINLIB_DEFAULTS.instructions
      )}
      <div className="form-row">
        <label className="field">
          <span className="field-label">Submodule name</span>
          <SettingInput value={s.mainlibName} spellCheck={false} onCommit={(v) => updateSettings({ mainlibName: v.trim() })} />
        </label>
        <label className="field">
          <span className="field-label">Version branches</span>
          <SettingInput className="mono" value={s.mainlibPrefix} spellCheck={false} onCommit={(v) => updateSettings({ mainlibPrefix: v.trim() })} />
        </label>
      </div>
      <div className="field">
        <span className="field-label">Atlassian account</span>
        {account ? (
          <div className="form-row">
            <span>
              Connected as <b>{account.email}</b>
            </span>
            <span className="spacer" />
            <button className="btn" onClick={() => window.spoon.atlassianDisconnect().then(() => setAccount(null))}>
              Disconnect
            </button>
          </div>
        ) : (
          <>
            <span className="hint">
              Lets Spoon read the changelog page. Use your Atlassian email and an{' '}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault()
                  window.spoon.openExternal('https://id.atlassian.com/manage-profile/security/api-tokens')
                }}
              >
                API token
              </a>
              : a classic token, or one with scopes that includes <span className="mono">read:page:confluence</span>. It’s kept in
              your Keychain.
            </span>
            <div className="form-row">
              <input placeholder="you@fm-games.com" value={email} spellCheck={false} onChange={(e) => setEmail(e.target.value)} />
              <input type="password" placeholder="API token" value={token} onChange={(e) => setToken(e.target.value)} />
              <button className="btn" disabled={busy || !email.trim() || !token.trim()} onClick={connect}>
                {busy ? 'Checking…' : 'Connect'}
              </button>
            </div>
          </>
        )}
        {error && <span className="error-text">{error}</span>}
      </div>
    </div>
  )
}

// ---------- about & updates ----------

function AboutTab() {
  const info = useAppInfo()
  const update = useUpdateState()
  useMinuteTick()
  const status = update?.status ?? 'idle'
  const checked = update?.lastCheck ? Math.round((Date.now() - update.lastCheck) / 60000) : null
  const text: Record<string, string> = {
    disabled: 'Automatic updates aren’t set up for this build.',
    idle: 'Not checked yet.',
    checking: 'Checking for updates…',
    current: `Spoon is up to date${checked !== null ? ` (checked ${checked < 1 ? 'just now' : `${checked} min ago`})` : ''}.`,
    downloading: `Downloading ${update?.version}… ${Math.round((update?.progress ?? 0) * 100)}%`,
    ready: `Spoon ${update?.version} is ready to install.`,
    error: update?.error ?? 'Update failed.'
  }
  const os = info?.platform === 'darwin' ? 'macOS' : info?.platform === 'win32' ? 'Windows' : info?.platform
  return (
    <>
      <div className="about">
        <img src={appIcon} alt="" className="about-icon" />
        <div>
          <h2>Spoon</h2>
          <p className="muted">
            Version {info?.version ?? '…'} · {os}
          </p>
        </div>
      </div>
      <div className="field">
        <span className="field-label">Updates</span>
        <p className={status === 'error' ? 'error-text' : ''}>{text[status]}</p>
        {update?.notes && (status === 'ready' || status === 'downloading') && (
          <pre className="release-notes">{update.notes}</pre>
        )}
        <div className="form-row">
          {status === 'ready' ? (
            <button className="btn primary" onClick={() => window.spoon.installUpdate()}>
              Restart and update
            </button>
          ) : (
            <button
              className="btn"
              disabled={status === 'disabled' || status === 'checking' || status === 'downloading'}
              onClick={() => window.spoon.checkForUpdates()}
            >
              Check now
            </button>
          )}
          <button className="btn" onClick={() => window.dispatchEvent(new Event('spoon:whats-new'))}>
            What’s new
          </button>
        </div>
        <span className="hint">
          Spoon checks every few hours, downloads updates in the background and verifies their signature before
          installing.
        </span>
      </div>
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
          <SettingInput
            value={s.scanFolder}
            onCommit={(v) => updateSettings({ scanFolder: v })}
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

// ---------- Simple Mode ----------

function SimpleModeTab() {
  const current = useContext(ProjectContext)
  const projects = useProjects()
  const [chosen, setChosen] = useState<string | null>(current ?? projects[0]?.path ?? null)
  const config = useSimpleConfig(chosen)
  const [branches, setBranches] = useState<{ list: string[]; head: string | null } | null>(null)
  const [unlocked, setUnlocked] = useState(false)
  const [folderError, setFolderError] = useState('')
  const [pinDraft, setPinDraft] = useState('')
  useEffect(() => {
    setBranches(null)
    setUnlocked(false)
    setFolderError('')
    if (!chosen) return
    let live = true
    window.spoon.openRepo(chosen).then(
      (r) => live && setBranches({ list: r.refs.filter((x) => x.kind === 'head').map((x) => x.name), head: r.headBranch }),
      () => live && setBranches({ list: [], head: null })
    )
    return () => {
      live = false
    }
  }, [chosen])

  if (!chosen) return <p className="muted">Open a project first: Simple Mode is set up per project.</p>
  const locked = !!config?.pin && !unlocked
  const set = (patch: Parameters<typeof setSimpleConfig>[1]): void => setSimpleConfig(chosen, patch)
  const unlock = async (): Promise<boolean> => {
    if (!locked) return true
    const ok = await askPin(config, `Enter the PIN to change Simple Mode for ${projectName(chosen)}.`)
    if (ok) setUnlocked(true)
    return ok
  }
  const chooseFolder = async (): Promise<void> => {
    const dir = await window.spoon.pickFolder('Only show files in this folder')
    if (!dir) return
    const root = chosen.replace(/\/$/, '') + '/'
    if (dir !== chosen && !dir.startsWith(root)) return setFolderError('That folder isn’t inside this project.')
    setFolderError('')
    set({ folder: dir === chosen ? '' : dir.slice(root.length) })
  }
  const c = config ?? { ...SIMPLE_DEFAULTS, on: false }
  const off = !config?.on || locked

  return (
    <>
      <div className="field">
        <span className="field-label">Simple Mode</span>
        <span className="hint">
          For people who don’t use git themselves, like artists: the project shows only the files they changed, with
          previews, and walks them through saving and sharing them. No branches, history graph or diffs. Set up per
          project; the Simple/Full switch in the title bar flips between the two.
        </span>
        <div className="form-row">
          <span className="field-label">Project</span>
          <select value={chosen} onChange={(e) => setChosen(e.target.value)}>
            {projects.map((p) => (
              <option key={p.path} value={p.path}>
                {projectName(p.path)}
                {p.path === current ? ' (open now)' : ''}
              </option>
            ))}
          </select>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={!!config?.on}
            onChange={async (e) => {
              const on = e.target.checked
              if (!on && !(await unlock())) return
              // Set up for the first time: it works on the branch that's checked out now.
              set(config ? { on } : { on, branch: branches?.head ?? '' })
            }}
          />
          Use Simple Mode for <b>{projectName(chosen)}</b>
        </label>
      </div>
      {locked && config?.on && (
        <div className="field">
          <div className="form-row">
            <span className="muted">These settings are locked with a PIN.</span>
            <button className="btn" onClick={unlock}>
              Unlock…
            </button>
          </div>
        </div>
      )}
      <div className={`field ${off ? 'disabled-field' : ''}`}>
        <div className="form-row">
          <span className="field-label">Work on</span>
          <select disabled={off} value={c.branch} onChange={(e) => set({ branch: e.target.value })}>
            <option value="">Whichever branch is checked out</option>
            {[...new Set([...(branches?.list ?? []), ...(c.branch ? [c.branch] : [])])].map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>
        <span className="hint">Other branches are never shown. When the project is on a different one, Simple Mode offers to switch back.</span>
      </div>
      <div className={`field ${off ? 'disabled-field' : ''}`}>
        <div className="form-row">
          <span className="field-label">Show changed files as</span>
          <Segmented
            value={c.view}
            options={[
              ['previews', 'Previews'],
              ['list', 'List']
            ]}
            onChange={(view) => !off && set({ view })}
          />
        </div>
      </div>
      <div className={`field ${off ? 'disabled-field' : ''}`}>
        <span className="field-label">Only show files in</span>
        <div className="form-row">
          <SettingInput
            className="mono"
            disabled={off}
            value={c.folder}
            placeholder="The whole project"
            spellCheck={false}
            onCommit={(v) => set({ folder: v.trim().replace(/^\/+|\/+$/g, '') })}
          />
          <button className="btn" disabled={off} onClick={chooseFolder}>
            Choose…
          </button>
        </div>
        {folderError && <span className="error-text">{folderError}</span>}
        <span className="hint">For example Assets/Art. Changes outside it aren’t shown, and aren’t saved.</span>
      </div>
      <div className={`field ${off ? 'disabled-field' : ''}`}>
        <div className="form-row">
          <span className="field-label">File types to show</span>
          <span className="spacer" />
          <button className="link-btn" disabled={off} onClick={() => set({ hiddenTypes: SIMPLE_DEFAULTS.hiddenTypes })}>
            Reset
          </button>
        </div>
        <span className="hint">
          Hidden types aren’t shown and aren’t saved; they can be toggled above the changed files too. Types not in this
          list always show. A Unity .meta file is saved along with its asset either way.
        </span>
        <div className="simple-type-settings">
          {TYPE_GROUPS.map((g) => (
            <label key={g.id} className="check" title={g.exts.map((e) => '.' + e).join(' ')}>
              <input
                type="checkbox"
                disabled={off}
                checked={!c.hiddenTypes.includes(g.id)}
                onChange={(e) =>
                  set({ hiddenTypes: e.target.checked ? c.hiddenTypes.filter((t) => t !== g.id) : [...c.hiddenTypes, g.id] })
                }
              />
              <span>
                {g.label} <span className="faint">{g.exts.slice(0, 4).map((e) => '.' + e).join(' ')}{g.exts.length > 4 ? ' …' : ''}</span>
              </span>
            </label>
          ))}
        </div>
      </div>
      <div className={`field ${off ? 'disabled-field' : ''}`}>
        <label className="check">
          <input type="checkbox" disabled={off} checked={c.shareOnSave} onChange={(e) => set({ shareOnSave: e.target.checked })} />
          Save & share in one step
        </label>
        <span className="hint">The main button saves and shares with the team at once (commit and push). Off: Save, and Share separately.</span>
        <label className="check">
          <input type="checkbox" disabled={off} checked={!c.hideSwitch} onChange={(e) => set({ hideSwitch: !e.target.checked })} />
          Show the Simple/Full switch in the title bar
        </label>
      </div>
      <div className={`field ${off ? 'disabled-field' : ''}`}>
        <span className="field-label">PIN lock</span>
        <span className="hint">
          With a PIN, leaving Simple Mode or changing these settings asks for it. It keeps people from wandering into the
          full view by accident; it isn’t a security measure.
        </span>
        <div className="form-row">
          {c.pin ? (
            <>
              <span className="muted">A PIN is set.</span>
              <button className="btn" disabled={off} onClick={() => set({ pin: '' })}>
                Remove PIN
              </button>
            </>
          ) : (
            <>
              <input
                type="password"
                disabled={off}
                value={pinDraft}
                placeholder="New PIN"
                onChange={(e) => setPinDraft(e.target.value)}
              />
              <button
                className="btn"
                disabled={off || !pinDraft.trim()}
                onClick={() => {
                  set({ pin: pinDraft.trim() })
                  setPinDraft('')
                  setUnlocked(true)
                }}
              >
                Set PIN
              </button>
            </>
          )}
        </div>
      </div>
    </>
  )
}

/** Author name field with suggestions from this repository's history, sized like the rest of the UI. */
function AuthorInput({ value, authors, onChange }: { value: string; authors: string[]; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const q = value.trim().toLowerCase()
  const matches = authors.filter((a) => a.toLowerCase().includes(q) && a.toLowerCase() !== q).slice(0, 8)
  const pick = (a: string): void => {
    onChange(a)
    setOpen(false)
  }
  return (
    <div className="autocomplete">
      <input
        placeholder="Author name"
        value={value}
        spellCheck={false}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
          setHi(0)
        }}
        onKeyDown={(e) => {
          if (!open || !matches.length) return
          if (e.key === 'ArrowDown') setHi((h) => Math.min(matches.length - 1, h + 1))
          else if (e.key === 'ArrowUp') setHi((h) => Math.max(0, h - 1))
          else if (e.key === 'Enter') pick(matches[hi])
          else if (e.key === 'Escape') setOpen(false)
          else return
          e.preventDefault()
          e.stopPropagation()
        }}
      />
      {open && matches.length > 0 && (
        <div className="autocomplete-list">
          {matches.map((a, i) => (
            <div
              key={a}
              className={`autocomplete-item ${i === hi ? 'on' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(a)
              }}
              onMouseEnter={() => setHi(i)}
            >
              {a}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** A few lines of code in a palette's colors (or the Spoon theme's), on its background. */
function SyntaxSample({ palette }: { palette: SyntaxPalette | null }) {
  return (
    <div className="diff-lines syntax-full syn-sample" style={paletteVars(palette, true)}>
      {SAMPLE.map((tokens, i) => (
        <div key={i}>
          <CodeText text={tokens.map((t) => t.text).join('')} tokens={tokens} />
        </div>
      ))}
    </div>
  )
}

const SOURCE_LABEL: Record<SyntaxPalette['source'], string> = { rider: 'Rider', vscode: 'VS Code', cursor: 'Cursor', file: 'File' }

/**
 * Where diff syntax colors come from: the Spoon theme, a scheme an IDE on this Mac is using, or a
 * scheme file. Below it, how the chosen IDE scheme's colors map onto Spoon's, each one changeable.
 */
function SyntaxSourceField() {
  const s = useSettings()
  const { data: found } = useAsync(() => once('ideSchemes', () => ideSchemes(true)), [])
  const [error, setError] = useState<string | null>(null)
  const current = s.syntaxPalette
  const options = [...(found ?? [])]
  // The chosen scheme when the IDE no longer uses it: picking it is then on purpose, and stays put.
  if (current && !options.some((o) => o.id === current.id)) options.push({ ...current, active: false })
  const isCurrent = (p: SyntaxPalette): boolean => current?.id === p.id
  // A detected scheme that's chosen shows the chosen copy, with any colors picked by hand.
  const shown = (p: SyntaxPalette): SyntaxPalette => (isCurrent(p) && current ? current : p)

  const importFile = (): void => {
    setError(null)
    window.spoon.importSyntaxColors().then(
      (p) => p && updateSettings({ syntaxPalette: p }),
      (err: Error) => setError(cleanError(err.message))
    )
  }
  const pickColor = async (slot: SyntaxSlot): Promise<void> => {
    if (!current) return
    const choice = await contextMenu([
      { label: `${SLOT_LABELS[slot]} take the color of…`, enabled: false },
      ...current.choices.slice(0, 40).map(([name, c]) => ({
        id: `${name}|${c}`,
        label: `${name}  ${c}`,
        kind: 'checkbox' as const,
        checked: current.colors[slot] === c
      }))
    ])
    if (!choice) return
    const cut = choice.lastIndexOf('|') // a color never has one; a name might
    const [name, c] = [choice.slice(0, cut), choice.slice(cut + 1)]
    updateSettings({
      syntaxPalette: {
        ...current,
        colors: { ...current.colors, [slot]: c },
        origin: { ...current.origin, [slot]: { from: name, exact: true, picked: true } }
      }
    })
  }

  return (
    <div className="field">
      <span className="field-label">Syntax colors from</span>
      <div className="syn-cards">
        <button className={`syn-card ${current ? '' : 'on'}`} onClick={() => updateSettings({ syntaxPalette: null })}>
          <SyntaxSample palette={null} />
          <span className="syn-name">Spoon theme</span>
          <span className="syn-sub">Follows Spoon’s theme</span>
        </button>
        {options.map((p) => (
          <button key={p.id} className={`syn-card ${isCurrent(p) ? 'on' : ''}`} onClick={() => updateSettings({ syntaxPalette: p })}>
            <SyntaxSample palette={shown(p)} />
            <span className="syn-name">
              {p.source === 'file' ? p.name : `${SOURCE_LABEL[p.source]} · ${p.name}`}
              {p.active && <span className="syn-pill">in use</span>}
            </span>
            <span className="syn-sub">{p.source === 'file' ? p.app : `Detected in ${p.app}`}</span>
          </button>
        ))}
        <button className="syn-card import" onClick={importFile}>
          <span className="syn-name">Import file…</span>
          <span className="syn-sub">Rider .icls · VS Code theme .json</span>
        </button>
      </div>
      {error && <span className="error-text hint">{error}</span>}
      {found && found.length === 0 && (
        <span className="hint">No Rider, VS Code or Cursor color scheme found on this Mac; a scheme file can still be imported.</span>
      )}
      <div className="check">
        <input
          id="set-syntax-follow"
          type="checkbox"
          checked={s.syntaxFollowIde}
          disabled={!current || current.source === 'file'}
          onChange={(e) => updateSettings({ syntaxFollowIde: e.target.checked })}
        />
        <label htmlFor="set-syntax-follow">Follow the IDE: when it switches scheme, switch too</label>
      </div>
      <div className="check">
        <input
          id="set-syntax-background"
          type="checkbox"
          checked={s.syntaxIdeBackground}
          disabled={!current?.bg}
          onChange={(e) => updateSettings({ syntaxIdeBackground: e.target.checked })}
        />
        <label htmlFor="set-syntax-background">Also use the scheme’s background in diffs</label>
      </div>
      {current && (
        <details className="syn-map">
          <summary>How {current.source === 'file' ? current.name : SOURCE_LABEL[current.source]}’s colors were translated</summary>
          {(Object.keys(SLOT_LABELS) as SyntaxSlot[]).map((slot) => {
            const o = current.origin[slot]
            return (
              <button key={slot} className="syn-map-row" onClick={() => pickColor(slot)} title="Click to pick another color">
                <span>{SLOT_LABELS[slot]}</span>
                <span className="syn-swatch" style={{ background: current.colors[slot] ?? 'transparent' }} />
                <span className="muted mono">{o?.from ?? 'not in this scheme: Spoon’s color'}</span>
                <span className={`syn-pill ${o?.picked ? '' : o?.exact ? 'exact' : 'close'}`}>
                  {o?.picked ? 'picked' : o?.exact ? 'exact' : o ? 'close' : 'none'}
                </span>
              </button>
            )
          })}
        </details>
      )}
    </div>
  )
}

/**
 * A text setting that's saved when typing pauses, on Enter or on leaving the field, not on every
 * keystroke (each save redraws the whole window behind Settings).
 */
function SettingInput({ value, onCommit, ...rest }: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value)
  const editing = useRef(false)
  useEffect(() => {
    if (!editing.current) setDraft(value)
  }, [value])
  useEffect(() => {
    if (draft === value) return
    const t = setTimeout(() => onCommit(draft), 600)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft])
  const commit = (): void => {
    if (draft !== value) onCommit(draft)
  }
  // Closing Settings right after typing removes the field without a blur: what's typed is kept then too.
  const latest = useRef({ draft, value, onCommit })
  latest.current = { draft, value, onCommit }
  useEffect(
    () => () => {
      const l = latest.current
      if (l.draft !== l.value) l.onCommit(l.draft)
    },
    []
  )
  return (
    <input
      {...rest}
      value={draft}
      onFocus={() => (editing.current = true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        editing.current = false
        commit()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        rest.onKeyDown?.(e)
      }}
    />
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: [T, React.ReactNode][]
  onChange: (v: T) => void
}) {
  const ref = useSlidingIndicator<HTMLDivElement>(value)
  return (
    <div className="segmented slider" ref={ref}>
      {options.map(([v, label]) => (
        <button
          key={v}
          className={v === value ? 'on' : ''}
          onClick={() => onChange(v)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
