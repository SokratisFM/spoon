// Jenkins builds started from Spoon, followed until they end: each is polled every few seconds (the
// queue, then the run's stages), shown as a card at the bottom right, and announced when it's done.
import { useSyncExternalStore } from 'react'
import type { JenkinsRun } from '../../shared/types'

export interface TrackedBuild {
  id: number
  job: string
  queueId: number
  /** What to call it: the game code and branch. */
  label: string
  branch: string
  run: JenkinsRun | null
  error: string | null
  startedAt: number
}

let builds: TrackedBuild[] = []
const listeners = new Set<() => void>()
const emit = (): void => listeners.forEach((l) => l())
let nextId = 1

function update(id: number, change: Partial<TrackedBuild>): void {
  builds = builds.map((b) => (b.id === id ? { ...b, ...change } : b))
  emit()
}

const POLL_MS = 5000

/** How long a build is followed at most (a stuck queue or a build that never ends). */
const FOLLOW_MS = 12 * 60 * 60_000

async function follow(id: number): Promise<void> {
  let failures = 0
  let lost = 0
  for (;;) {
    const b = builds.find((x) => x.id === id)
    if (!b) return // dismissed
    if (Date.now() - b.startedAt > FOLLOW_MS) return update(id, { error: 'Stopped following after 12 hours. Open Jenkins to see how it went.' })
    try {
      const run = await window.spoon.jenkinsProgress(b.job, b.queueId, b.run?.number ?? null)
      failures = 0
      lost = run.lost ? lost + 1 : 0
      // Not in the queue and not among the job's builds for a minute: Jenkins dropped it.
      if (lost >= 12) return update(id, { run, error: 'Jenkins no longer knows this build (it may have been removed from the queue). Open the job to check.' })
      update(id, { run, error: null })
      if (run.state === 'done') return announce({ ...b, run })
    } catch (err) {
      // The VPN dropping for a moment shouldn't end it: it keeps trying, saying why meanwhile.
      update(id, { error: err instanceof Error ? err.message : String(err) })
      if (++failures >= 60) return
    }
    await new Promise((r) => setTimeout(r, POLL_MS))
  }
}

export const minutes = (ms: number): string => {
  const m = Math.round(ms / 60_000)
  return m < 1 ? 'under a minute' : m === 1 ? '1 min' : `${m} min`
}

function announce(b: TrackedBuild): void {
  const run = b.run!
  const failedAt = run.stages.find((s) => s.status === 'FAILED' || s.status === 'ABORTED')
  const title = `${b.label} #${run.number ?? '?'} ${run.status === 'SUCCESS' ? 'finished' : run.status === 'CANCELLED' ? 'was cancelled' : run.status === 'ABORTED' ? 'was aborted' : run.status === 'UNSTABLE' ? 'is unstable' : 'failed'}`
  const body = run.status === 'SUCCESS' ? `${b.branch} · ${minutes(run.durationMillis)}` : failedAt ? `At ${failedAt.name} · ${b.branch}` : b.branch
  try {
    const n = new Notification(title, { body })
    n.onclick = () => run.url && void window.spoon.jenkinsOpen(run.url).catch(() => undefined)
  } catch {
    // No notifications allowed: the card still shows it.
  }
}

/** Starts following a build that was just queued. */
export function trackBuild(b: Omit<TrackedBuild, 'id' | 'run' | 'error' | 'startedAt'>): void {
  const id = nextId++
  builds = [...builds, { ...b, id, run: null, error: null, startedAt: Date.now() }]
  emit()
  void follow(id)
}

export function dismissBuild(id: number): void {
  builds = builds.filter((b) => b.id !== id)
  emit()
}

export function useTrackedBuilds(): TrackedBuild[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => builds
  )
}
