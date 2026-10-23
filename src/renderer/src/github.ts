// The connected GitHub account, shared by Settings and the pull request views.
import { useSyncExternalStore } from 'react'
import type { GitHubAccount } from '../../shared/types'

let account: GitHubAccount | null = null
const listeners = new Set<() => void>()

export function setGitHubAccount(next: GitHubAccount | null): void {
  account = next
  listeners.forEach((l) => l())
}

export async function refreshGitHubAccount(): Promise<void> {
  setGitHubAccount(await window.spoon.ghAccount())
}
refreshGitHubAccount()

export function useGitHubAccount(): GitHubAccount | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => account
  )
}
