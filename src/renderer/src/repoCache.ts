// Per-repo state kept outside React, so switching tabs draws immediately: the last loaded repo,
// working tree, history and built graph, plus commit details, commit diffs and pull requests.
// Open tabs are also loaded in the background, so even the first switch to a tab isn't cold.
import type { Commit, CommitDetails, DiffResult, PullSummary, RepoState, WorkingTree } from '../../shared/types'
import { buildGraph, type ColorRules, type Graph } from './graph'
import { getSettings, reservedPrefixes, type Settings } from './settings'

export const LOG_LIMIT = 5000

export interface Snapshot {
  repo: RepoState
  tree: WorkingTree
  commits: Commit[]
  refsSignature: string
  selected: string | null
  graph?: Graph
  graphKey?: string
}
export const snapshots = new Map<string, Snapshot>()

/** Changes when HEAD or any ref moves: the history needs re-reading. */
export const refsSignatureOf = (r: RepoState): string =>
  `${r.headHash}|${r.refs.map((x) => x.fullName + x.target).join(',')}`

/** Everything the graph's layout and colors depend on besides the commits. */
export function graphKeyOf(repo: RepoState | null, s: Settings): string {
  if (!repo) return ''
  const refs = `${repo.remotes.join(',')}|${repo.refs.map((r) => r.fullName + r.target).join(',')}`
  return `${refs}|${s.reservedColorsGraph ? JSON.stringify(reservedPrefixes(s)) : ''}`
}

function graphFor(commits: Commit[], repo: RepoState | null, s: Settings): Graph {
  const prefixes = reservedPrefixes(s)
  if (!s.reservedColorsGraph || !prefixes.length || !repo) return buildGraph(commits)
  // Branch names per commit (remote ones without "origin/"), to match against reserved prefixes.
  const names = new Map<string, string[]>()
  for (const r of repo.refs) {
    if (r.kind !== 'head' && r.kind !== 'remote') continue
    const remote = r.kind === 'remote' ? repo.remotes.find((x) => r.name.startsWith(`${x}/`)) : undefined
    const name = remote ? r.name.slice(remote.length + 1) : r.name
    names.set(r.target, [...(names.get(r.target) ?? []), name])
  }
  const reservedIdx = new Set(prefixes.map(([, i]) => i))
  const free = [0, 1, 2, 3, 4, 5, 6, 7].filter((i) => !reservedIdx.has(i))
  const rules: ColorRules = {
    free: free.length ? free : [0, 1, 2, 3, 4, 5, 6, 7],
    colorAt: (hash) => {
      for (const n of names.get(hash) ?? []) for (const [p, i] of prefixes) if (n.startsWith(p)) return i
      return null
    }
  }
  return buildGraph(commits, rules)
}

/** The graph for this history, reusing the one kept in the repo's snapshot when nothing it depends on changed. */
export function cachedGraph(path: string, commits: Commit[], repo: RepoState | null, s: Settings): Graph {
  const key = graphKeyOf(repo, s)
  const snap = snapshots.get(path)
  if (snap?.graph && snap.graphKey === key && snap.commits === commits) return snap.graph
  const graph = graphFor(commits, repo, s)
  if (snap && snap.commits === commits) Object.assign(snap, { graph, graphKey: key })
  return graph
}

// ---------- immutable per-commit data ----------

/** A small least-recently-used map. */
export class Lru<T> {
  private map = new Map<string, T>()
  constructor(private max: number) {}
  get(key: string): T | undefined {
    const v = this.map.get(key)
    if (v !== undefined) {
      this.map.delete(key)
      this.map.set(key, v)
    }
    return v
  }
  set(key: string, v: T): void {
    this.map.delete(key)
    this.map.set(key, v)
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value!)
  }
}

// Commits never change, so their details and diffs can be kept as long as there's room.
export const detailsCache = new Lru<CommitDetails>(400)
export const commitDiffCache = new Lru<DiffResult>(60)

// ---------- pull requests ----------

export interface PrState {
  slug?: string | null // undefined until looked up
  prs: PullSummary[] | null
  error: string | null
  loadedAt: number
}
export const prStates = new Map<string, PrState>()
export const prStateOf = (path: string): PrState => {
  let s = prStates.get(path)
  if (!s) prStates.set(path, (s = { prs: null, error: null, loadedAt: 0 }))
  return s
}

// ---------- background loading of open tabs ----------

const idle = (): Promise<void> =>
  new Promise((r) => (window.requestIdleCallback ? window.requestIdleCallback(() => r(), { timeout: 2000 }) : setTimeout(r, 50)))

/** Reads a repo the way its tab would and keeps the result as its snapshot. */
async function prefetch(path: string): Promise<void> {
  const prev = snapshots.get(path)
  const [repo, tree] = await Promise.all([window.spoon.openRepo(path), window.spoon.workingTree(path)])
  const sig = refsSignatureOf(repo)
  const commits = prev && prev.refsSignature === sig ? prev.commits : await window.spoon.log(path, LOG_LIMIT)
  const snap: Snapshot = {
    repo,
    tree,
    commits,
    refsSignature: sig,
    selected: prev?.selected ?? repo.headHash,
    graph: prev?.commits === commits ? prev.graph : undefined,
    graphKey: prev?.commits === commits ? prev.graphKey : undefined
  }
  snapshots.set(path, snap)
  // The tab opens with this commit selected; have its details ready too.
  const sel = snap.selected
  if (sel && !detailsCache.get(`${path}|${sel}`))
    detailsCache.set(`${path}|${sel}`, await window.spoon.commitDetails(path, sel))
  await idle()
  cachedGraph(path, commits, repo, getSettings())
}

let warmRun = 0
const loadedListeners = new Set<(path: string) => void>()

/** RepoView calls this when a tab's own load finishes; the warm-up waits for the visible tab. */
export function markLoaded(path: string): void {
  loadedListeners.forEach((l) => l(path))
}

function untilLoaded(path: string, timeoutMs: number): Promise<void> {
  if (snapshots.has(path)) return Promise.resolve()
  return new Promise((resolve) => {
    const done = (): void => {
      loadedListeners.delete(listener)
      clearTimeout(timer)
      resolve()
    }
    const listener = (p: string): void => void (p === path && done())
    const timer = setTimeout(done, timeoutMs)
    loadedListeners.add(listener)
  })
}

/**
 * Loads open tabs that have never been loaded, one at a time while the app is idle, starting once
 * the visible tab has loaded and going outwards from it (neighbours are the likeliest next clicks).
 * Tabs already loaded are left alone: they refresh themselves when shown, so the background work
 * doesn't grow with every switch. A newer call (tabs or active tab changed) takes over.
 */
export async function warmTabs(tabs: string[], active: string | null): Promise<void> {
  const run = ++warmRun
  if (active) await untilLoaded(active, 3000)
  const at = active ? tabs.indexOf(active) : 0
  const order = tabs
    .map((path, i) => ({ path, d: Math.abs(i - at) + (i < at ? 0.5 : 0) }))
    .filter((t) => t.path !== active)
    .sort((a, b) => a.d - b.d)
    .map((t) => t.path)
  for (const path of order) {
    if (run !== warmRun) return
    if (snapshots.has(path)) continue
    await idle()
    if (run !== warmRun) return
    await prefetch(path).catch(() => undefined) // a missing or broken repo stays cold; tried again next time
  }
}
