// Read-only access to Confluence for the MainLib changelog, with an Atlassian API token
// (id.atlassian.com → Security → API tokens). The email and token live in the Keychain on macOS
// (safeStorage elsewhere); pages are fetched with the REST API and returned as HTML.
import { execFile } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import type { AtlassianAccount, ConfluencePage } from '../shared/types'

const SERVICE = 'Spoon Atlassian'
const ACCOUNT = 'credentials'
const secretFile = (): string => join(app.getPath('userData'), 'atlassian.bin')

interface Creds {
  email: string
  token: string
}
let cache: Creds | null | undefined

function security(args: string[]): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile('security', args, (err, out, stderr) => (err ? reject(new Error(stderr.trim() || err.message)) : resolve(out)))
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
  } catch {
    cache = null
  }
  return cache
}

async function writeCreds(c: Creds): Promise<void> {
  const raw = JSON.stringify(c)
  if (process.platform === 'darwin')
    await security(['add-generic-password', '-U', '-s', SERVICE, '-a', ACCOUNT, '-l', 'Spoon Atlassian token', '-w', raw])
  else writeFileSync(secretFile(), safeStorage.encryptString(raw))
  cache = c
}

const auth = (c: Creds): string => `Basic ${Buffer.from(`${c.email}:${c.token}`).toString('base64')}`

/** https://site.atlassian.net/wiki/spaces/X/pages/123/Title → the site and page id. */
function parsePageUrl(url: string): { origin: string; id: string } {
  const u = new URL(url)
  const id = /\/pages\/(\d+)/.exec(u.pathname)?.[1] ?? u.searchParams.get('pageId')
  if (u.protocol !== 'https:' || !id) throw new Error(`Not a Confluence page link: ${url}`)
  return { origin: u.origin, id }
}

async function get<T>(c: Creds, url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Authorization: auth(c), Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000)
  })
  if (res.status === 401 || res.status === 403)
    throw new Error('Atlassian didn’t accept the email and API token. Check them in Settings → Accounts.')
  if (res.status === 404) throw new Error('That Confluence page wasn’t found (or this account can’t see it).')
  if (!res.ok) throw new Error(`Confluence returned ${res.status}`)
  return (await res.json()) as T
}

export async function account(): Promise<AtlassianAccount | null> {
  const c = await readCreds()
  return c ? { email: c.email } : null
}

/** Saves the credentials after checking them against the site of `pageUrl`. */
export async function connect(email: string, token: string, pageUrl: string): Promise<AtlassianAccount> {
  const c = { email: email.trim(), token: token.trim() }
  const { origin } = parsePageUrl(pageUrl)
  await get(c, `${origin}/wiki/rest/api/user/current`)
  await writeCreds(c)
  return { email: c.email }
}

export async function disconnect(): Promise<void> {
  if (process.platform === 'darwin') await security(['delete-generic-password', '-s', SERVICE, '-a', ACCOUNT]).catch(() => undefined)
  else rmSync(secretFile(), { force: true })
  cache = null
}

export async function page(url: string): Promise<ConfluencePage> {
  const c = await readCreds()
  if (!c) throw new Error('Connect your Atlassian account in Settings → Accounts to read the MainLib changelog.')
  const { origin, id } = parsePageUrl(url)
  const p = await get<{ title: string; body?: { storage?: { value?: string } } }>(
    c,
    `${origin}/wiki/api/v2/pages/${id}?body-format=storage`
  )
  return { title: p.title, html: p.body?.storage?.value ?? '' }
}
