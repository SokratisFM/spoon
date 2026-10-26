// The right-click menu for a stash, shared by the sidebar and its row in the history.
import type { Stash } from '../../../shared/types'
import { confirm } from '../dialogs'
import { contextMenu } from '../menus'
import type { Ops } from './RepoView'

/** "On feature/x: tidy up" → "tidy up"; git's own "WIP on …" messages are kept as they are. */
export const stashTitle = (s: Stash): string => s.message.replace(/^[Oo]n [^:]+: /, '')

export async function stashMenu(stash: Stash, path: string, ops: Ops, onShow?: () => void): Promise<void> {
  const choice = await contextMenu([
    { id: 'apply', label: 'Apply Stash' },
    { id: 'pop', label: 'Apply and Delete Stash' },
    { separator: true },
    ...(onShow ? [{ id: 'show', label: 'Show in History' }] : []),
    { id: 'copy', label: 'Copy Message' },
    { separator: true },
    { id: 'drop', label: 'Delete Stash…' }
  ])
  if (choice === 'apply' || choice === 'pop')
    ops.run(
      choice === 'pop' ? 'Applying and deleting stash…' : 'Applying stash…',
      () => window.spoon.stashApply(path, stash.name, choice === 'pop'),
      'Couldn’t apply the stash'
    )
  else if (choice === 'show') onShow?.()
  else if (choice === 'copy') navigator.clipboard.writeText(stashTitle(stash))
  else if (choice === 'drop') {
    const ok = await confirm({
      message: `Delete the stash “${stashTitle(stash)}”?`,
      detail: 'Its changes are gone once it’s deleted.',
      confirmLabel: 'Delete',
      risky: true
    })
    if (ok) ops.run('Deleting stash…', () => window.spoon.stashDrop(path, stash.name), 'Couldn’t delete the stash')
  }
}
