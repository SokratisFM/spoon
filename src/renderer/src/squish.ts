// Squish branches: each straight run of commits in the history shrinks to its first and latest
// commit. A commit in the middle of a run (one parent, one child, no branch, tag or stash on it,
// not checked out) is hidden when its parent is one too; the newer kept commit then points straight
// at the run's first commit (bead style), or at a fold row standing in for what's hidden (fold style).
import type { Commit, RepoState } from '../../shared/types'
import type { SquishStyle } from './settings'

/** The prefix of a fold row's hash; the rest is its group's key. */
export const FOLD = 'squish:'

interface Group {
  /** The newest hidden commit's hash. */
  key: string
  /** Hidden when squished, newest first. */
  members: Commit[]
  /** The kept commit right above the run (its latest). */
  above: Commit
  /** The kept commit right below it (the run's first). */
  first: Commit
}

/** Every run that squishing would shrink, whatever is squished right now. */
function findGroups(commits: Commit[], repo: RepoState): Group[] {
  const byHash = new Map(commits.map((c) => [c.hash, c]))
  const children = new Map<string, number>()
  const childOf = new Map<string, Commit>()
  for (const c of commits)
    for (const p of c.parents) {
      children.set(p, (children.get(p) ?? 0) + 1)
      childOf.set(p, c)
    }
  const special = new Set<string>([
    ...repo.refs.map((r) => r.target),
    ...repo.stashes.map((s) => s.hash),
    ...(repo.headHash ? [repo.headHash] : [])
  ])
  const linear = (c: Commit | undefined): boolean =>
    !!c && c.parents.length === 1 && children.get(c.hash) === 1 && !special.has(c.hash)
  const hidden = (c: Commit): boolean => linear(c) && linear(byHash.get(c.parents[0]))
  const groups: Group[] = []
  for (const c of commits) {
    const above = childOf.get(c.hash)
    if (!hidden(c) || !above || hidden(above)) continue // only start at the newest of a run
    const members: Commit[] = []
    for (let x: Commit | undefined = c; x && hidden(x); x = byHash.get(x.parents[0])) members.push(x)
    if (members.length < 2) continue
    groups.push({ key: c.hash, members, above, first: byHash.get(members[members.length - 1].parents[0])! })
  }
  return groups
}

/**
 * The run a commit belongs to, for folding it from the keyboard: the one it's hidden in, or the
 * one right below it (it's the run's latest commit), or right above it (it's the run's first).
 */
export function runAt(hash: string, commits: Commit[], repo: RepoState): Group | null {
  const groups = findGroups(commits, repo)
  return (
    groups.find((g) => g.members.some((m) => m.hash === hash)) ??
    groups.find((g) => g.above.hash === hash) ??
    groups.find((g) => g.first.hash === hash) ??
    null
  )
}

/** The history with each run that `squished` says yes to shrunk to its first and latest commit. */
export function squishCommits(commits: Commit[], repo: RepoState, style: SquishStyle, squished: (key: string) => boolean): Commit[] {
  const drop = new Set<string>()
  const rewired = new Map<string, Commit>() // kept commit above a group → its new self
  const folds = new Map<string, Commit>() // kept commit above a group → the fold row under it
  for (const { key, members, above, first } of findGroups(commits, repo)) {
    if (!squished(key)) continue
    const c = members[0]
    members.forEach((g) => drop.add(g.hash))
    const info = { key, count: members.length, newest: c.authorTime, oldest: members[members.length - 1].authorTime }
    const target = style === 'fold' ? FOLD + key : first.hash
    const prev = rewired.get(above.hash) ?? above
    rewired.set(above.hash, {
      ...prev,
      parents: prev.parents.map((p) => (p === c.hash ? target : p)),
      ...(style === 'bead' ? { squish: info } : {})
    })
    if (style === 'fold')
      folds.set(above.hash, {
        hash: target,
        parents: [first.hash],
        authorName: '',
        authorEmail: '',
        authorTime: c.authorTime,
        committerName: '',
        commitTime: c.commitTime,
        subject: '',
        squish: info
      })
  }
  if (!drop.size) return commits
  const out: Commit[] = []
  for (const c of commits) {
    if (drop.has(c.hash)) continue
    out.push(rewired.get(c.hash) ?? c)
    const fold = folds.get(c.hash)
    if (fold) out.push(fold)
  }
  return out
}

/** The squished group holding a hidden commit (its key), so jumping to that commit can open it. */
export function groupOf(hash: string, commits: Commit[], shown: Commit[]): string | null {
  const visible = new Set(shown.map((c) => c.hash))
  if (visible.has(hash) || !commits.some((c) => c.hash === hash)) return null
  const childOf = new Map<string, string>()
  for (const c of commits) for (const p of c.parents) childOf.set(p, c.hash)
  let key: string | null = null
  for (let x: string | undefined = hash; x && !visible.has(x); x = childOf.get(x)) key = x
  return key
}
