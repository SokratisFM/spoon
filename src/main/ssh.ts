// SSH access to GitHub for someone who has never set it up: a key on this computer, GitHub as a known
// host (from the keys GitHub publishes, not whatever answers), and a check that GitHub knows the key.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { homedir, hostname, userInfo } from 'node:os'
import { join } from 'node:path'
import type { SshAuth, SshKey } from '../shared/types'
import { toolPath } from './git'

// A test copy (SPOON_SSH_HOME) keeps its keys and known hosts in its own folder, never in ~/.ssh.
const testHome = process.env.SPOON_SSH_HOME
const sshDir = (): string => testHome ?? join(homedir(), '.ssh')
const knownHosts = (): string => join(sshDir(), 'known_hosts')
/** The keys ssh offers on its own, in the order Spoon prefers them. */
const KEYS = ['id_ed25519', 'id_ecdsa', 'id_rsa']
const env = { ...process.env, PATH: toolPath }

function exec(cmd: string, args: string[], timeout = 20_000): Promise<{ code: number; out: string }> {
  return new Promise((resolve) =>
    execFile(cmd, args, { env, timeout }, (err, stdout, stderr) =>
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, out: `${stdout}\n${stderr}`.trim() || (err?.message ?? '') })
    )
  )
}

/** The key ssh will offer GitHub, if there is one. */
export async function findKey(): Promise<SshKey | null> {
  for (const name of KEYS) {
    const path = join(sshDir(), name)
    if (!existsSync(path) || !existsSync(`${path}.pub`)) continue
    return { path, publicKey: (await readFile(`${path}.pub`, 'utf8')).trim() }
  }
  return null
}

/** Whether github.com is in known_hosts (hashed entries included). */
export async function knowsGitHub(): Promise<boolean> {
  if (!existsSync(knownHosts())) return false
  return (await exec('ssh-keygen', ['-F', 'github.com', '-f', knownHosts()])).code === 0
}

/** Asks GitHub who this computer's key belongs to (it answers "Hi <login>!" and closes). */
export async function check(): Promise<SshAuth> {
  const test = testHome
    ? ['-F', '/dev/null', '-o', `UserKnownHostsFile=${knownHosts()}`, '-o', 'IdentitiesOnly=yes', ...KEYS.flatMap((k) => ['-i', join(sshDir(), k)])]
    : []
  const { out } = await exec('ssh', ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', ...test, 'git@github.com'])
  const hi = /Hi ([^!\s]+)!/.exec(out)
  if (hi) return { state: 'ok', user: hi[1] }
  if (/Host key verification failed|No .* host key is known/i.test(out)) return { state: 'unknown-host' }
  if (/Permission denied \(publickey/i.test(out)) return { state: 'denied' }
  return { state: 'error', message: out || 'ssh gave no answer.' }
}

/** Makes a key (ed25519, no passphrase) unless there is one already. */
export async function createKey(): Promise<SshKey> {
  const existing = await findKey()
  if (existing) return existing
  await mkdir(sshDir(), { recursive: true, mode: 0o700 })
  const path = join(sshDir(), 'id_ed25519')
  const comment = `${userInfo().username}@${hostname().replace(/\.local$/, '')} (Spoon)`
  const made = await exec('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', comment, '-f', path, '-q'])
  if (made.code !== 0) throw new Error(made.out || 'ssh-keygen failed.')
  const key = await findKey()
  if (!key) throw new Error('ssh-keygen made no key.')
  return key
}

/** Adds GitHub's published host keys to known_hosts, so ssh trusts github.com without asking. */
export async function trustGitHub(): Promise<void> {
  if (await knowsGitHub()) return
  const res = await fetch('https://api.github.com/meta', { headers: { 'User-Agent': 'Spoon' }, signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`GitHub returned ${res.status} for its host keys.`)
  const keys = ((await res.json()) as { ssh_keys?: string[] }).ssh_keys ?? []
  if (!keys.length) throw new Error('GitHub listed no host keys.')
  await mkdir(sshDir(), { recursive: true, mode: 0o700 })
  const before = existsSync(knownHosts()) ? await readFile(knownHosts(), 'utf8') : ''
  const lines = keys.map((k) => `github.com ${k.trim()}`).join('\n')
  await appendFile(knownHosts(), `${before && !before.endsWith('\n') ? '\n' : ''}${lines}\n`, { mode: 0o644 })
}
