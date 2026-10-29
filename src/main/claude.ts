// Hands a review over to Claude: an interactive Claude Code session in Terminal, or a new Code
// session in the Claude desktop app. Spoon only writes the prompt; Claude reads the diff itself.
import { execFile } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { shell } from 'electron'
import type { ClaudeAvailability, ClaudeLaunch } from '../shared/types'

const DESKTOP_APP = '/Applications/Claude.app'

/** Finds `claude` the way a login shell would, so ~/.local/bin and Homebrew paths count. */
function findCli(): Promise<string | null> {
  if (process.platform !== 'darwin') return Promise.resolve(null)
  return new Promise((resolve) => {
    execFile('/bin/zsh', ['-lc', 'command -v claude'], { timeout: 5000 }, (err, out) =>
      resolve(err ? null : out.trim() || null)
    )
  })
}

// Finding `claude` starts a login shell, which can take seconds with a heavy shell setup, so the
// answer is reused for a while; installing Claude meanwhile shows up within a minute.
let cached: { at: number; value: Promise<ClaudeAvailability> } | null = null

export function availability(): Promise<ClaudeAvailability> {
  if (!cached || Date.now() - cached.at > 60_000) {
    const value = findCli().then((cli) => ({ cli, desktop: process.platform === 'darwin' && existsSync(DESKTOP_APP) }))
    cached = { at: Date.now(), value }
  }
  return cached.value
}

const sq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`

export async function launch(l: ClaudeLaunch): Promise<void> {
  if (l.where === 'desktop') {
    // The app's own link for a new Code session: it takes the prompt and the folder (the same link its
    // recent-folders menu uses). Model, effort and permission mode aren't part of it.
    const q = new URLSearchParams({ q: l.prompt, folder: l.cwd })
    await shell.openExternal(`claude://code/new?${q.toString().replace(/\+/g, '%20')}`)
    return
  }
  const cli = await findCli()
  if (!cli) throw new Error('Claude Code isn’t installed (no `claude` command found). Install it, or send the review to the Claude desktop app.')
  // A .command file opens in Terminal and runs there; the prompt goes in its own file so no
  // quoting can break it.
  const dir = join(tmpdir(), 'spoon-reviews')
  mkdirSync(dir, { recursive: true })
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const promptFile = join(dir, `${id}.txt`)
  const script = join(dir, `${id}.command`)
  writeFileSync(promptFile, l.prompt)
  const args = ['--model', l.model, '--effort', l.effort, '-n', l.name].map(sq).join(' ')
  writeFileSync(
    script,
    [
      '#!/bin/zsh -l',
      `cd ${sq(l.cwd)} || exit 1`,
      'clear',
      `prompt="$(cat ${sq(promptFile)})"`,
      `rm -f ${sq(promptFile)} ${sq(script)}`,
      `exec ${sq(cli)} ${args} -- "$prompt"`, // -- : a prompt starting with "-" is still the prompt
      ''
    ].join('\n')
  )
  chmodSync(script, 0o755)
  await new Promise<void>((resolve, reject) =>
    execFile('/usr/bin/open', ['-a', 'Terminal', script], (err) => (err ? reject(err) : resolve()))
  )
}
