// What a new clone needs to know before it starts, shared by the Clone dialog and the Tab search:
// where it goes, over which protocol, and with what.
import { useAsync, usePersistentState } from './hooks'

/** owner/name when the URL is a GitHub repository. */
export const githubSlug = (url: string): string | null => /github\.com[:/]+([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/.exec(url.trim())?.[1] ?? null
/** The folder a URL clones into, as git would name it. */
export const nameOf = (url: string): string => /([^/:\s]+?)(?:\.git)?\/*$/.exec(url.trim())?.[1] ?? ''
export const sepOf = (path: string): string => (path.includes('\\') && !path.includes('/') ? '\\' : '/')
export const parentOf = (path: string): string => path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')))

/**
 * The folder new clones go into: the one last chosen, else next to the last project (the folder
 * holding it, or, for a submodule like MainLib inside a game, the folder holding the repository it's
 * part of).
 */
export function useCloneFolder(home: string, recents: string[]): { folder: string; setParent: (p: string) => void } {
  const outside = useAsync(async () => {
    let top = recents[0]
    if (!top) return home
    for (let i = 0; i < 5; i++) {
      const [up] = await window.spoon.repoParents([top]).catch(() => [null])
      if (!up) break
      top = up
    }
    return parentOf(top) || home
  }, [])
  const [parent, setParent] = usePersistentState<string>('spoon.clone.parent', '')
  return { folder: parent || outside.data || home, setParent }
}

export const useCloneProtocol = (): [ 'ssh' | 'https', (p: 'ssh' | 'https') => void ] =>
  usePersistentState<'ssh' | 'https'>('spoon.clone.protocol', 'ssh')
export const useCloneSubmodules = (): [boolean, (v: boolean) => void] => usePersistentState('spoon.clone.submodules', true)
