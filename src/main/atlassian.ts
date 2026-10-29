// Read-only access to Confluence for the MainLib changelog, with an Atlassian API token
// (id.atlassian.com → Security → API tokens): a classic token, or one with scopes that includes
// read:page:confluence. The email and token live in the Keychain on macOS
// (safeStorage elsewhere); pages are fetched with the REST API and returned as HTML.
import { execFile } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import type { AtlassianAccount, ConfluencePage, JiraIssue } from '../shared/types'

const SERVICE = 'Spoon Atlassian'
const ACCOUNT = 'credentials'
const secretFile = (): string => join(app.getPath('userData'), 'atlassian.bin')

interface Creds {
  email: string
  token: string
  /** The site the token was checked against when connecting; it's only ever sent there. */
  origin?: string
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

class AuthError extends Error {}

async function get<T>(c: Creds, url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Authorization: auth(c), Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000)
  })
  if (res.status === 401 || res.status === 403)
    throw new AuthError(
      'Atlassian didn’t accept the email and API token (or the token lacks the read:page:confluence scope). Check them in Settings → Accounts.'
    )
  if (res.status === 404) throw new Error('That Confluence page wasn’t found (or this account can’t see it).')
  if (!res.ok) throw new Error(`Confluence returned ${res.status}`)
  return (await res.json()) as T
}

// A site's cloud id, needed to reach it through api.atlassian.com (public, no sign-in needed).
const cloudIds = new Map<string, string>()
async function cloudId(origin: string): Promise<string> {
  const known = cloudIds.get(origin)
  if (known) return known
  const res = await fetch(`${origin}/_edge/tenant_info`, { signal: AbortSignal.timeout(10_000) })
  const id = res.ok ? ((await res.json()) as { cloudId?: string }).cloudId : undefined
  if (!id) throw new Error(`Couldn’t look up the Atlassian site ${origin}.`)
  cloudIds.set(origin, id)
  return id
}

/**
 * A Confluence REST path, tried on the site itself (classic API tokens) and then through
 * api.atlassian.com (tokens with scopes only work there).
 */
async function confluence<T>(c: Creds, origin: string, path: string): Promise<T> {
  try {
    return await get<T>(c, `${origin}/wiki${path}`)
  } catch (err) {
    if (!(err instanceof AuthError)) throw err
    return get<T>(c, `https://api.atlassian.com/ex/confluence/${await cloudId(origin)}/wiki${path}`)
  }
}

export async function account(): Promise<AtlassianAccount | null> {
  const c = await readCreds()
  return c ? { email: c.email } : null
}

/** Saves the credentials after checking that they can read `pageUrl` (the changelog). */
export async function connect(email: string, token: string, pageUrl: string): Promise<AtlassianAccount> {
  const { origin, id } = parsePageUrl(pageUrl)
  const c = { email: email.trim(), token: token.trim(), origin }
  await confluence(c, origin, `/api/v2/pages/${id}`)
  await writeCreds(c)
  return { email: c.email }
}

export async function disconnect(): Promise<void> {
  if (process.platform === 'darwin') await security(['delete-generic-password', '-s', SERVICE, '-a', ACCOUNT]).catch(() => undefined)
  else rmSync(secretFile(), { force: true })
  cache = null
}

/**
 * A Jira ticket's title and type, read with the connected Atlassian account; null when there's no
 * account, it's for another site, or it can't read the ticket (a Confluence-only token, say).
 */
export async function jiraIssue(site: string, key: string): Promise<JiraIssue | null> {
  const c = await readCreds()
  if (!c || !/^[A-Z][A-Z0-9]+-\d+$/.test(key)) return null
  let origin: string
  try {
    origin = new URL(site).origin
  } catch {
    return null
  }
  const allowed = c.origin ? origin === c.origin : new URL(origin).hostname.endsWith('.atlassian.net')
  if (!allowed) return null
  const path = `/rest/api/3/issue/${key}?fields=summary,issuetype`
  type Issue = { fields?: { summary?: string; issuetype?: { name?: string } } }
  try {
    let issue: Issue
    try {
      issue = await get<Issue>(c, `${origin}${path}`)
    } catch (err) {
      if (!(err instanceof AuthError)) throw err
      issue = await get<Issue>(c, `https://api.atlassian.com/ex/jira/${await cloudId(origin)}${path}`)
    }
    return issue.fields?.summary ? { summary: issue.fields.summary, type: issue.fields.issuetype?.name ?? '' } : null
  } catch {
    return null
  }
}

export async function page(url: string): Promise<ConfluencePage> {
  const c = await readCreds()
  if (!c) throw new Error('Connect your Atlassian account in Settings → Accounts to read the MainLib changelog.')
  const { origin, id } = parsePageUrl(url)
  // The token goes only to the site it was connected with (or, for credentials saved before that was
  // recorded, an Atlassian Cloud site), never to wherever a link happens to point.
  const allowed = c.origin ? origin === c.origin : new URL(origin).hostname.endsWith('.atlassian.net')
  if (!allowed)
    throw new Error(
      `The changelog link is on ${new URL(origin).hostname}, but your Atlassian token was connected for ${c.origin ? new URL(c.origin).hostname : 'an Atlassian Cloud site'}. Reconnect in Settings → Accounts with this link to use it.`
    )
  const p = await confluence<{ title: string; body?: { storage?: { value?: string } } }>(
    c,
    origin,
    `/api/v2/pages/${id}?body-format=storage`
  )
  return { title: p.title, html: p.body?.storage?.value ?? '' }
}
