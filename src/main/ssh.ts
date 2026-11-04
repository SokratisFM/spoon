// SSH access to GitHub for someone who has never set it up: a key on this computer, GitHub as a known
// host (from the keys GitHub publishes, not whatever answers), and a check that GitHub knows the key.
// It goes by what ssh itself would use for github.com (ssh -G): its identity files, the host and port
// (ssh.github.com:443 too) and its known_hosts file, and checks with git's own ssh command if one is set.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir, hostname, userInfo } from 'node:os'
import { join } from 'node:path'
import type { SshAuth, SshKey } from '../shared/types'
import { toolPath } from './git'

// A test copy (SPOON_SSH_HOME) keeps its keys, config and known hosts in its own folder, never in ~/.ssh.
const testHome = process.env.SPOON_SSH_HOME
const sshDir = (): string => testHome ?? join(homedir(), '.ssh')
/** The keys ssh offers on its own, in the order Spoon prefers them. */
const KEYS = ['id_ed25519', 'id_ecdsa', 'id_rsa']
/** The key Spoon makes when the usual name is taken (by a key it can't see, say). */
const SPOON_KEY = 'id_ed25519_spoon'
const env = { ...process.env, PATH: toolPath }

function exec(cmd: string, args: string[], timeout = 20_000, shell = false): Promise<{ code: number; out: string; stdout: string }> {
  return new Promise((resolve) =>
    execFile(cmd, args, { env, timeout, shell }, (err, stdout, stderr) =>
      resolve({
        code: err ? (typeof err.code === 'number' ? err.code : -1) : 0,
        out: `${stdout}\n${stderr}`.trim() || (err?.message ?? ''),
        stdout
      })
    )
  )
}

const expand = (p: string): string => (p.startsWith('~/') ? join(homedir(), p.slice(2)) : p)

/** What ssh will use for github.com: host, port, identity files and the known_hosts file. */
async function effective(): Promise<{ host: string; port: number; identities: string[]; knownHosts: string; config: string }> {
  const config = join(sshDir(), 'config')
  if (testHome)
    return { host: 'github.com', port: 22, identities: [...KEYS, SPOON_KEY].map((k) => join(sshDir(), k)), knownHosts: join(sshDir(), 'known_hosts'), config }
  const { stdout } = await exec('ssh', ['-G', 'github.com'])
  const get = (key: string): string[] => stdout.split('\n').flatMap((l) => (l.startsWith(`${key} `) ? [l.slice(key.length + 1).trim()] : []))
  const host = get('hostname')[0] || 'github.com'
  const identities = get('identityfile').map(expand)
  const known = (get('userknownhostsfile')[0] ?? '').split(/\s+/).filter(Boolean).map(expand)[0]
  return {
    host,
    port: Number(get('port')[0]) || 22,
    identities: identities.length ? identities : KEYS.map((k) => join(sshDir(), k)),
    knownHosts: known && known !== '/dev/null' ? known : join(sshDir(), 'known_hosts'),
    config
  }
}
/** How known_hosts names the host: github.com, or [ssh.github.com]:443. */
const hostKey = (host: string, port: number): string => (port === 22 ? host : `[${host}]:${port}`)
/** Only GitHub's own hosts are ever written to known_hosts. */
const isGitHub = (host: string): boolean => host === 'github.com' || host === 'ssh.github.com'

/** A key's public half, made again from the private key when the .pub is missing (null if it has a passphrase). */
async function publicOf(path: string): Promise<string | null> {
  if (existsSync(`${path}.pub`)) return (await readFile(`${path}.pub`, 'utf8')).trim()
  const made = await exec('ssh-keygen', ['-y', '-P', '', '-f', path])
  if (made.code !== 0) return null
  const pub = made.stdout.trim()
  await writeFile(`${path}.pub`, `${pub}\n`, { mode: 0o644 }).catch(() => undefined)
  return pub
}

/** Whether a private key needs a passphrase that ssh can't get without asking. */
async function locked(path: string): Promise<boolean> {
  if (!existsSync(path)) return false
  return (await exec('ssh-keygen', ['-y', '-P', '', '-f', path])).code !== 0
}

/** The keys in the SSH agent (their "type key" part). */
async function agentKeys(): Promise<string[]> {
  if (testHome) return []
  const { code, stdout } = await exec('ssh-add', ['-L'], 5_000)
  return code === 0 ? stdout.split('\n').map((l) => l.split(/\s+/).slice(0, 2).join(' ')).filter((l) => l.includes(' ')) : []
}

/**
 * The key ssh will offer GitHub, if there is one: from its identity files, a public key whose private
 * half lives elsewhere (an agent, a password manager, a security key) included.
 */
export async function findKey(): Promise<SshKey | null> {
  const { identities } = await effective()
  const agent = await agentKeys()
  for (const path of identities) {
    if (!existsSync(path) && !existsSync(`${path}.pub`)) continue
    const publicKey = existsSync(path) ? await publicOf(path) : (await readFile(`${path}.pub`, 'utf8')).trim()
    const inAgent = !!publicKey && agent.includes(publicKey.split(/\s+/).slice(0, 2).join(' '))
    if (publicKey) return { path, publicKey, locked: false, inAgent }
    // A private key with a passphrase and no .pub: it's there, but it has to be unlocked first.
    return { path, publicKey: '', locked: true, inAgent: false }
  }
  return null
}

/** The key as found, with whether it waits for a passphrase (not unlocked in the agent). */
export async function keyStatus(): Promise<SshKey | null> {
  const key = await findKey()
  if (!key || key.locked || key.inAgent) return key
  return { ...key, locked: await locked(key.path) }
}

async function knownLines(file: string, name: string): Promise<string[]> {
  if (!existsSync(file)) return []
  const found = await exec('ssh-keygen', ['-F', name, '-f', file])
  if (found.code === -1) {
    // No ssh-keygen: plain (unhashed) lines only.
    const text = await readFile(file, 'utf8').catch(() => '')
    return text.split('\n').filter((l) => l.split(/\s+/)[0]?.split(',').includes(name))
  }
  return found.code === 0 ? found.stdout.split('\n').filter((l) => l && !l.startsWith('#')) : []
}
const keyPart = (line: string): string => line.trim().split(/\s+/).slice(-2).join(' ')

/** GitHub's published SSH host keys ("type key"). */
async function publishedKeys(): Promise<string[]> {
  const res = await fetch('https://api.github.com/meta', { headers: { 'User-Agent': 'Spoon' }, signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`GitHub returned ${res.status} for its host keys.`)
  const keys = ((await res.json()) as { ssh_keys?: string[] }).ssh_keys ?? []
  if (!keys.length) throw new Error('GitHub listed no host keys.')
  return keys.map((k) => k.trim())
}

/** Whether known_hosts has a key for GitHub's host as ssh reaches it. */
export async function knowsGitHub(): Promise<boolean> {
  const { host, port, knownHosts } = await effective()
  return (await knownLines(knownHosts, hostKey(host, port))).length > 0
}

/** Adds GitHub's published host keys to known_hosts for the host ssh uses, so ssh trusts it without asking. */
export async function trustGitHub(): Promise<void> {
  const { host, port, knownHosts } = await effective()
  if (!isGitHub(host)) throw new Error(`ssh reaches GitHub through ${host}, which Spoon doesn't set up.`)
  const name = hostKey(host, port)
  if ((await knownLines(knownHosts, name)).length) return
  const keys = await publishedKeys()
  await mkdir(sshDir(), { recursive: true, mode: 0o700 })
  const before = existsSync(knownHosts) ? await readFile(knownHosts, 'utf8') : ''
  await appendFile(knownHosts, `${before && !before.endsWith('\n') ? '\n' : ''}${keys.map((k) => `${name} ${k}`).join('\n')}\n`, { mode: 0o644 })
}

/** Whether the host keys known_hosts has for GitHub are ones GitHub no longer publishes (an old key, or not GitHub). */
export async function hostKeyStale(): Promise<boolean> {
  const { host, port, knownHosts } = await effective()
  const lines = await knownLines(knownHosts, hostKey(host, port))
  if (!lines.length || !isGitHub(host)) return false
  const published = new Set(await publishedKeys())
  return lines.some((l) => !published.has(keyPart(l)))
}

/** Replaces the host keys for GitHub with the published ones: only after the user confirmed it. */
export async function replaceGitHubHostKey(): Promise<void> {
  const { host, port, knownHosts } = await effective()
  if (!isGitHub(host)) throw new Error(`ssh reaches GitHub through ${host}, which Spoon doesn't set up.`)
  if (!(await hostKeyStale())) return trustGitHub()
  const removed = await exec('ssh-keygen', ['-R', hostKey(host, port), '-f', knownHosts])
  if (removed.code !== 0) throw new Error(removed.out || 'Couldn’t remove the old host key.')
  await trustGitHub()
}

/** Asks GitHub who this computer's key belongs to (it answers "Hi <login>!" and closes), with git's own ssh if it has one. */
export async function check(): Promise<SshAuth> {
  const opts = ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10']
  const custom = testHome ? '' : (process.env.GIT_SSH_COMMAND || (await exec('git', ['config', '--global', 'core.sshCommand'])).stdout.trim())
  const test = testHome
    ? ['-F', join(sshDir(), 'config'), '-o', `UserKnownHostsFile=${join(sshDir(), 'known_hosts')}`, '-o', 'IdentitiesOnly=yes', ...[...KEYS, SPOON_KEY].flatMap((k) => ['-i', join(sshDir(), k)])]
    : []
  if (testHome && !existsSync(join(sshDir(), 'config'))) test.splice(0, 2, '-F', '/dev/null')
  // git's ssh command is a shell command line (the user's own setting).
  const { out } = custom
    ? await exec(`${custom} ${opts.join(' ')} git@github.com`, [], 20_000, true)
    : await exec('ssh', [...opts, ...test, 'git@github.com'])
  const hi = /Hi ([^!\s]+)!/.exec(out)
  if (hi) return { state: 'ok', user: hi[1] }
  if (/REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed|No .* host key is known/i.test(out)) return { state: 'unknown-host' }
  if (/Permission denied \(publickey/i.test(out)) return { state: 'denied' }
  return { state: 'error', message: out || 'ssh gave no answer.' }
}

/**
 * Makes a key (ed25519, no passphrase) unless ssh has one to offer. Never writes over any part of an
 * existing key: when the usual name is taken it makes id_ed25519_spoon and tells ssh to use it for GitHub.
 */
export async function createKey(): Promise<SshKey> {
  const existing = await findKey()
  if (existing) return existing
  await mkdir(sshDir(), { recursive: true, mode: 0o700 })
  const usual = join(sshDir(), 'id_ed25519')
  const taken = existsSync(usual) || existsSync(`${usual}.pub`)
  const path = taken ? join(sshDir(), SPOON_KEY) : usual
  if (existsSync(path) || existsSync(`${path}.pub`)) throw new Error(`${path} is already there; Spoon won't replace it.`)
  const comment = `${userInfo().username}@${hostname().replace(/\.(local|localdomain|lan)$/i, '')} (Spoon)`
  const made = await exec('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', comment, '-f', path, '-q'])
  if (made.code !== 0) throw new Error(made.out || 'ssh-keygen failed.')
  if (taken) {
    // ssh only offers the usual names by itself: point it at this one for GitHub.
    const { config } = await effective()
    const before = existsSync(config) ? await readFile(config, 'utf8') : ''
    // First, so ssh takes it; "Host *" after it, so what follows in the file stays for every host.
    const entry = `# Added by Spoon: the key for GitHub\nHost github.com ssh.github.com\n  IdentityFile "${path}"\nHost *\n`
    await writeFile(config, `${entry}\n${before}`, { mode: 0o600 })
  }
  const key = await findKey()
  if (!key) throw new Error('ssh-keygen made no key.')
  return key
}
