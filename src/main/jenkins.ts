// Jenkins with an API token (Jenkins → your name → Security → API Token): starting a game's build job
// with its parameters, and following the build (queue, then the pipeline's stages from Stage View).
// The server is usually only reachable over the VPN. The username and token live in the Keychain on
// macOS (safeStorage elsewhere), and the token is only ever sent to the server it was connected with.
import { execFile } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import type { JenkinsAccount, JenkinsJob, JenkinsParam, JenkinsRun } from '../shared/types'

// A test copy (its own SPOON_USER_DATA) keeps its own Keychain item: it never reads or changes yours.
const SERVICE = process.env.SPOON_USER_DATA ? 'Spoon Jenkins (test)' : 'Spoon Jenkins'
const ACCOUNT = 'credentials'
const secretFile = (): string => join(app.getPath('userData'), 'jenkins.bin')

interface Creds {
  /** The server's origin, e.g. http://jenkins2:8080. */
  server: string
  user: string
  token: string
}
let cache: Creds | null | undefined

function security(args: string[]): Promise<string> {
  // Never err.message: it repeats the command line, which holds the token when saving it.
  return new Promise((resolve, reject) =>
    execFile('security', args, (err, out, stderr) =>
      err ? reject(new Error(stderr.trim().replace(/\{.*\}/s, '…') || 'The Keychain refused (security exited with an error).')) : resolve(out)
    )
  )
}

async function readCreds(): Promise<Creds | null> {
  if (cache !== undefined) return cache
  try {
    const raw =
      process.platform === 'darwin'
        ? (await security(['find-generic-password', '-s', SERVICE, '-a', ACCOUNT, '-w'])).trim()
        : safeStorage.decryptString(readFileSync(secretFile()))
    cache = JSON.parse(raw) as Creds
    return cache
  } catch {
    // Not cached: a locked Keychain or a moment's failure shouldn't hide the account until Spoon restarts.
    return null
  }
}

async function writeCreds(c: Creds): Promise<void> {
  const raw = JSON.stringify(c)
  if (process.platform === 'darwin')
    await security(['add-generic-password', '-U', '-s', SERVICE, '-a', ACCOUNT, '-l', 'Spoon Jenkins token', '-w', raw])
  else writeFileSync(secretFile(), safeStorage.encryptString(raw))
  cache = c
}

/** http(s)://host[:port], without a path. */
function serverOrigin(server: string): string {
  let u: URL
  try {
    u = new URL(server.trim())
  } catch {
    throw new Error('The Jenkins address should look like http://jenkins2:8080')
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('The Jenkins address should start with http:// or https://')
  return u.origin
}

const auth = (c: Creds): string => `Basic ${Buffer.from(`${c.user}:${c.token}`).toString('base64')}`

/** A request to the server the token belongs to; a server that can't be reached says to use the VPN. */
async function call(c: Creds, path: string, init: RequestInit = {}): Promise<Response> {
  const url = new URL(path, c.server)
  if (url.origin !== c.server) throw new Error('Refusing to send the Jenkins token to another server.')
  let res: Response
  try {
    res = await fetch(url, {
      ...init,
      redirect: 'manual',
      headers: { Authorization: auth(c), Accept: 'application/json', ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(15_000)
    })
  } catch {
    throw new Error(`Can’t reach ${new URL(c.server).host}. Connect to the VPN, then try again.`)
  }
  if (res.status >= 300 && res.status < 400) {
    const to = res.headers.get('location') ?? ''
    throw new Error(
      `Jenkins sent Spoon on to ${to.replace(/[?#].*$/, '') || 'another address'}. Check the server address in Settings → Accounts${/^https:/i.test(to) && url.protocol === 'http:' ? ' (it may need https://)' : ''}.`
    )
  }
  if (res.status === 401 || res.status === 403)
    throw new Error('Jenkins didn’t accept your username and API token, or you can’t do this there. Check them in Settings → Accounts.')
  if (res.status === 404) throw new Error('Jenkins doesn’t have that job (or you can’t see it).')
  if (res.status >= 400) throw new Error(`Jenkins answered ${res.status} ${res.statusText}`.trim())
  return res
}

async function json<T>(c: Creds, path: string): Promise<T> {
  const res = await call(c, path)
  if (res.status !== 200) throw new Error(`Jenkins answered ${res.status} (are you signed in to the right server?)`)
  return (await res.json()) as T
}

async function creds(): Promise<Creds> {
  const c = await readCreds()
  if (!c) throw new Error('Add your Jenkins username and API token in Settings → Accounts first.')
  return c
}

/** A job's path from its full name: "Folder/JISFI-…-ios" → /job/Folder/job/JISFI-…-ios. */
const jobPath = (name: string): string => {
  const parts = name.split('/')
  if (!name || parts.some((p) => !p || /\\|^\.\.?$/.test(p))) throw new Error(`Not a Jenkins job name: ${name}`)
  return parts.map((p) => `/job/${encodeURIComponent(p)}`).join('')
}

export async function account(): Promise<JenkinsAccount | null> {
  const c = await readCreds()
  return c ? { server: c.server, user: c.user } : null
}

/** Saves the credentials after checking that Jenkins knows them. */
export async function connect(server: string, user: string, token: string): Promise<JenkinsAccount> {
  const c: Creds = { server: serverOrigin(server), user: user.trim(), token: token.trim() }
  if (!c.user || !c.token) throw new Error('Enter your Jenkins username and an API token.')
  const me = await json<{ id?: string; fullName?: string }>(c, '/me/api/json?tree=id,fullName')
  if (!me.id) throw new Error('Jenkins didn’t say who that token belongs to.')
  await writeCreds({ ...c, user: me.id })
  return { server: c.server, user: me.id }
}

export async function disconnect(): Promise<void> {
  if (process.platform === 'darwin') await security(['delete-generic-password', '-s', SERVICE, '-a', ACCOUNT]).catch(() => undefined)
  else rmSync(secretFile(), { force: true })
  cache = null
}

/** The jobs for a game code: "jisfi" → JISFI-jigsawsolitaire-fiogonia-ios. */
export async function jobsFor(code: string): Promise<string[]> {
  const c = await creds()
  // Jobs in folders too (three levels down), by their full name ("Folder/JISFI-…").
  type Item = { name: string; jobs?: Item[] }
  const { jobs } = await json<{ jobs?: Item[] }>(c, '/api/json?tree=jobs[name,jobs[name,jobs[name,jobs[name]]]]')
  const all: string[] = []
  const walk = (items: Item[] | undefined, at: string): void => {
    for (const j of items ?? []) {
      const full = at ? `${at}/${j.name}` : j.name
      if (j.jobs) walk(j.jobs, full)
      else all.push(full)
    }
  }
  walk(jobs, '')
  const prefix = `${code.trim().toLowerCase()}-`
  return all.filter((n) => n.slice(n.lastIndexOf('/') + 1).toLowerCase().startsWith(prefix))
}

const KINDS: Record<string, JenkinsParam['type']> = {
  StringParameterDefinition: 'string',
  TextParameterDefinition: 'text',
  BooleanParameterDefinition: 'boolean',
  ChoiceParameterDefinition: 'choice'
}

/** A job's parameters (what its "Build with Parameters" page asks) and the values its last build used. */
export async function job(name: string): Promise<JenkinsJob> {
  const c = await creds()
  type Raw = {
    url?: string
    property?: { parameterDefinitions?: { name: string; type: string; description?: string; defaultParameterValue?: { value?: unknown }; choices?: string[] }[] }[]
    lastBuild?: { number: number; actions?: { parameters?: { name: string; value: unknown }[] }[] } | null
  }
  const raw = await json<Raw>(
    c,
    `${jobPath(name)}/api/json?tree=url,property[parameterDefinitions[name,type,description,defaultParameterValue[value],choices]],lastBuild[number,actions[parameters[name,value]]]`
  )
  const defs = raw.property?.flatMap((p) => p.parameterDefinitions ?? []) ?? []
  const params: JenkinsParam[] = defs.map((d) => {
    const type = KINDS[d.type] ?? 'other'
    const v = d.defaultParameterValue?.value
    return {
      name: d.name,
      type,
      description: d.description ?? '',
      default: type === 'boolean' ? v === true : typeof v === 'string' ? v : '',
      ...(d.choices ? { choices: d.choices } : {})
    }
  })
  const values: Record<string, string | boolean> = {}
  for (const a of raw.lastBuild?.actions ?? [])
    for (const p of a.parameters ?? []) if (typeof p.value === 'string' || typeof p.value === 'boolean') values[p.name] = p.value
  return {
    name,
    url: `${c.server}${jobPath(name)}/`,
    params,
    last: raw.lastBuild ? { number: raw.lastBuild.number, values } : null
  }
}

/** Starts a build; returns its queue item (Jenkins numbers the build once it leaves the queue). */
export async function build(name: string, values: Record<string, string | boolean>): Promise<{ queueId: number }> {
  const c = await creds()
  const body = new URLSearchParams()
  for (const [k, v] of Object.entries(values)) body.set(k, String(v))
  const res = await call(c, `${jobPath(name)}/buildWithParameters`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  })
  const id = Number(/\/queue\/item\/(\d+)/.exec(res.headers.get('location') ?? '')?.[1])
  if (res.status !== 201 || !id) throw new Error(`Jenkins answered ${res.status} without queueing the build.`)
  return { queueId: id }
}

/** Where a started build is: waiting in the queue, running (with its stages so far), or done. */
export async function progress(name: string, queueId: number, number: number | null): Promise<JenkinsRun> {
  const c = await creds()
  if (number === null) {
    const q = await json<{ cancelled?: boolean; why?: string | null; executable?: { number: number } | null }>(
      c,
      `/queue/item/${Math.floor(queueId)}/api/json?tree=cancelled,why,executable[number]`
    ).catch((err: Error) => {
      // Jenkins forgets queue items a few minutes after they start; the build is found by its queue id then.
      if (/doesn’t have/.test(err.message)) return null
      throw err
    })
    if (q?.cancelled) return { state: 'done', number: null, url: null, status: 'CANCELLED', why: 'Taken out of the queue', durationMillis: 0, stages: [] }
    if (q === null) {
      const { builds } = await json<{ builds?: { number: number; queueId: number }[] }>(c, `${jobPath(name)}/api/json?tree=builds[number,queueId]{0,30}`)
      const found = builds?.find((b) => b.queueId === queueId)
      if (!found) return { state: 'queued', number: null, url: null, status: 'QUEUED', why: 'Looking for the build in Jenkins…', durationMillis: 0, stages: [], lost: true }
      number = found.number
    } else if (!q.executable) return { state: 'queued', number: null, url: null, status: 'QUEUED', why: q.why ?? undefined, durationMillis: 0, stages: [] }
    else number = q.executable.number
  }
  type Stage = { name: string; status: string; durationMillis: number }
  const run = await json<{ status: string; durationMillis: number; stages?: Stage[] }>(c, `${jobPath(name)}/${Math.floor(number)}/wfapi/describe`)
  const running = ['IN_PROGRESS', 'QUEUED', 'PAUSED_PENDING_INPUT', 'NOT_EXECUTED'].includes(run.status)
  return {
    state: running ? 'running' : 'done',
    number,
    url: `${c.server}${jobPath(name)}/${number}/`,
    status: run.status,
    durationMillis: run.durationMillis,
    stages: (run.stages ?? []).map((s) => ({ name: s.name, status: s.status, durationMillis: s.durationMillis }))
  }
}

/** Opens the API token page (your user's Security page) on a Jenkins server, before connecting to it. */
export async function openTokenPage(server: string): Promise<void> {
  const { shell } = await import('electron')
  await shell.openExternal(`${serverOrigin(server)}/me/security/`)
}

/** Opens a page of the connected Jenkins server in the browser (it's http, which openExternal refuses). */
export async function open(url: string): Promise<void> {
  const c = await creds()
  const u = new URL(url)
  if (u.origin !== c.server) throw new Error('Not a page of your Jenkins server.')
  const { shell } = await import('electron')
  await shell.openExternal(u.toString())
}
