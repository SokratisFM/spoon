// Squish branches: each straight run of commits in the history shrinks to its first and latest
// commit. A commit in the middle of a run (one parent, one child, no branch, tag or stash on it,
// not checked out) is hidden when its parent is one too; the newer kept commit then points straight
// at the run's first commit (bead style), or at a fold row standing in for what's hidden (fold style).
import type { Commit, RepoState } from '../../shared/types'
import type { SquishStyle } from './settings'

/** The prefix of a fold row's hash; the rest is its group's key. */
export const FOLD = 'squish:'

export function squishCommits(commits: Commit[], repo: RepoState, style: SquishStyle, expanded: Set<string>): Commit[] {
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

  const drop = new Set<string>()
  const rewired = new Map<string, Commit>() // kept commit above a group → its new self
  const folds = new Map<string, Commit>() // kept commit above a group → the fold row under it
  for (const c of commits) {
    const above = childOf.get(c.hash)
    if (!hidden(c) || !above || hidden(above)) continue // only start at the newest of a run
    const group: Commit[] = []
    for (let x: Commit | undefined = c; x && hidden(x); x = byHash.get(x.parents[0])) group.push(x)
    if (group.length < 2 || expanded.has(c.hash)) continue
    const first = byHash.get(group[group.length - 1].parents[0])!
    group.forEach((g) => drop.add(g.hash))
    const info = { key: c.hash, count: group.length, newest: c.authorTime, oldest: group[group.length - 1].authorTime }
    const target = style === 'fold' ? FOLD + c.hash : first.hash
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
