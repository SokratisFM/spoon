// Spotlight-style project switcher, opened with Tab: remembered projects first, then git repos
// found in the scan folder that you haven't opened yet.
import { useEffect, useMemo, useRef, useState } from 'react'
import { forgetProject, fuzzyScore, projectName, tildify, useProjects } from '../projects'
import { useSettings } from '../settings'
import { FolderIcon, SearchIcon } from './Icons'
import { keys, mod } from '../platform'

interface Item {
  path: string
  name: string
  kind: 'project' | 'found'
  missing: boolean
  open: boolean
}

// Scan results survive closing the palette, so reopening it is instant; a fresh scan runs each time.
let scanCache: { key: string; paths: string[] } | null = null

interface Props {
  openTabs: string[]
  onOpen: (path: string) => void
  onClose: () => void
}

export function ProjectPalette({ openTabs, onOpen, onClose }: Props) {
  const settings = useSettings()
  const projects = useProjects()
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const [home, setHome] = useState('')
  const [missing, setMissing] = useState<Set<string>>(new Set())
  const scanKey = `${settings.scanFolder}|${settings.scanDepth}|${settings.scanNested}`
  const [found, setFound] = useState<string[]>(scanCache?.key === scanKey ? scanCache.paths : [])
  const [scanning, setScanning] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

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
    if (!query.trim()) return all
    return all
      .map((it) => ({ it, score: fuzzyScore(query, it.name, tildify(it.path, home)) }))
      .filter((x): x is { it: Item; score: number } => x.score !== null)
      .sort((a, b) => b.score - a.score || Number(a.it.kind === 'found') - Number(b.it.kind === 'found'))
      .map((x) => x.it)
  }, [projects, found, missing, openTabs, query, home])

  useEffect(() => setIndex(0), [query])

  useEffect(() => {
    listRef.current?.querySelector('.palette-item.active')?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const choose = (it: Item | undefined): void => {
    if (!it) return
    onClose()
    onOpen(it.path)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
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

  // Section headers sit between the two groups when browsing without a query.
  const firstFound = query.trim() ? -1 : items.findIndex((it) => it.kind === 'found')

  return (
    <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-label="Go to project">
        <div className="palette-input">
          <SearchIcon />
          <input
            autoFocus
            placeholder="Search projects"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
          />
          {scanning && <span className="spinner" title="Scanning for repositories" />}
        </div>

        <div className="palette-list" ref={listRef}>
          {!query.trim() && projects.length > 0 && <div className="palette-section">Projects</div>}
          {items.map((it, i) => (
            <div key={it.path}>
              {i === firstFound && (
                <div className="palette-section">
                  Not opened yet <span className="palette-section-path">in {tildify(settings.scanFolder, home)}</span>
                </div>
              )}
              <div
                className={`palette-item ${i === index ? 'active' : ''} ${it.missing ? 'missing' : ''}`}
                onMouseMove={() => setIndex(i)}
                onClick={() => choose(it)}
              >
                <FolderIcon />
                <div className="palette-text">
                  <span className="palette-name">{it.name}</span>
                  <span className="palette-path">{tildify(it.path, home)}</span>
                </div>
                {it.open && <span className="badge">open</span>}
                {it.missing && <span className="badge danger">missing</span>}
                {it.kind === 'found' && <span className="badge accent-soft">new</span>}
              </div>
            </div>
          ))}
          {items.length === 0 && (
            <div className="palette-empty">
              {query.trim() ? `No projects match “${query}”.` : `No projects yet. Open one with ${keys('⌘O')}.`}
            </div>
          )}
        </div>

        <div className="palette-footer">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> move
          </span>
          <span>
            <kbd>↵</kbd> open
          </span>
          <span>
            <kbd>{keys('⌘⌫')}</kbd> forget project
          </span>
          <span>
            <kbd>esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  )
}
