// Branch colors by name: a branch's name always gives it the same color, in every repository and
// submodule, on every computer. Any hue can come out (not just the theme's 8 lane colors); lightness
// and chroma are fixed per theme (--name-l, --name-c in styles.css), so every branch reads equally well.
// A reserved prefix ("feature/") makes its branches a family: shades around that lane color.

/** FNV-1a: small, fast, and the same everywhere. */
function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const cache = new Map<string, string>()

/** The color for a branch name (without its remote), as a CSS color. */
export function nameColor(name: string, prefixes: [string, number][] = []): string {
  const family = prefixes.find(([p]) => name.startsWith(p))
  const key = `${family?.[1] ?? ''}|${name}`
  const known = cache.get(key)
  if (known) return known
  const h = hash(name)
  const color = family
    ? // Within 20° of the family's hue, a little lighter or darker: related, but each branch its own.
      `oklch(from var(--lane-${family[1]}) calc(l + ${(((h >>> 8) % 5) - 2) * 0.025}) c calc(h + ${(h % 41) - 20}))`
    : `oklch(var(--name-l) var(--name-c) ${h % 360})`
  if (cache.size > 5000) cache.clear()
  cache.set(key, color)
  return color
}

/** A line with no branch name anywhere (its branch was deleted and no merge names it). */
export const UNNAMED_COLOR = 'var(--text-faint)'

/** The branch a merge commit brought in, from its message (git, GitHub, GitLab, Bitbucket wording). */
export function mergedBranch(subject: string, remotes: string[]): string | null {
  const m =
    /^Merge (?:remote-tracking )?branch '([^']+)'/.exec(subject) ??
    /^Merge (?:remote-tracking )?branch "([^"]+)"/.exec(subject) ??
    /^Merge pull request #\d+ from [^/\s]+\/(\S+)/.exec(subject) ??
    /^Merged in (\S+)/.exec(subject)
  if (!m) return null
  const name = m[1]
  const remote = remotes.filter((r) => name.startsWith(`${r}/`)).sort((a, b) => b.length - a.length)[0]
  return remote ? name.slice(remote.length + 1) : name
}

/** Of several branches on one commit, the one whose line it most likely is: a main line first. */
const MAIN = ['main', 'master', 'develop', 'development', 'dev', 'trunk']
export function lineName(names: string[]): string | null {
  return names.find((n) => MAIN.includes(n)) ?? names[0] ?? null
}
