// Atlassian with an API token (id.atlassian.com → Security → API tokens; a classic one, or one with
// scopes): Confluence pages for the MainLib changelog, Jira tickets' titles for new branches, and
// creating Jira tickets. The email and token live in the Keychain on macOS
// (safeStorage elsewhere); pages are fetched with the REST API and returned as HTML.
import { execFile } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import type { AtlassianAccount, ConfluencePage, JiraIssue, JiraNewIssue, JiraProject, JiraProjectMeta } from '../shared/types'

const SERVICE = 'Spoon Atlassian'
const ACCOUNT = 'credentials'
const secretFile = (): string => join(app.getPath('userData'), 'atlassian.bin')

interface Creds {
  email: string
  token: string
  /** The site the token was checked against when connecting; it's only ever sent there. */
  origin?: string
  /**
   * A second token for Jira only: a token with scopes covers one app, so with scoped tokens
   * Confluence and Jira each need their own. Without it, `token` is used for both.
   */
  jiraToken?: string
}

/** The credentials Jira is called with: its own token when there is one. */
const jiraCreds = (c: Creds): Creds => (c.jiraToken ? { ...c, token: c.jiraToken } : c)
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
  jiraBases.clear() // a new token may answer somewhere else (site vs api.atlassian.com)
}

/**
 * Whether the token may be sent to `origin`: https only, and the site it was connected with (or, for
 * credentials saved before that was recorded, an Atlassian Cloud site, which is then pinned).
 */
async function allowedOrigin(c: Creds, origin: string): Promise<boolean> {
  let u: URL
  try {
    u = new URL(origin)
  } catch {
    return false
  }
  if (u.protocol !== 'https:') return false
  if (c.origin) return u.origin === c.origin
  if (!u.hostname.endsWith('.atlassian.net')) return false
  await writeCreds({ ...c, origin: u.origin }).catch(() => undefined)
  return true
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
  // Only Atlassian Cloud sites go through api.atlassian.com; a self-hosted server never does.
  if (!new URL(origin).hostname.endsWith('.atlassian.net')) throw new Error(`${origin} isn’t an Atlassian Cloud site.`)
  const res = await fetch(`${origin}/_edge/tenant_info`, { signal: AbortSignal.timeout(10_000) })
  const id = res.ok ? ((await res.json()) as { cloudId?: string }).cloudId : undefined
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error(`Couldn’t look up the Atlassian site ${origin}.`)
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
  return c ? { email: c.email, jiraToken: !!c.jiraToken } : null
}

/** Saves the credentials after checking that they can read `pageUrl` (the changelog). */
export async function connect(email: string, token: string, pageUrl: string): Promise<AtlassianAccount> {
  const { origin, id } = parsePageUrl(pageUrl)
  const c = { email: email.trim(), token: token.trim(), origin }
  await confluence(c, origin, `/api/v2/pages/${id}`)
  await writeCreds(c)
  return { email: c.email }
}

/**
 * Replaces the token of the connected account (same email and site), after checking what the new one
 * can do: read the changelog page (Confluence) and use Jira. It's saved if it can do either, and
 * says which.
 */
export async function updateToken(token: string, pageUrl: string): Promise<{ confluence: boolean; jira: boolean }> {
  const old = await readCreds()
  if (!old) throw new Error('No Atlassian account is connected.')
  let page: { origin: string; id: string } | null = null
  try {
    page = parsePageUrl(pageUrl)
  } catch {
    // no changelog page set: only Jira is checked
  }
  const origin = old.origin ?? page?.origin
  if (!origin) throw new Error('Reconnect with your email instead: Spoon doesn’t know which Atlassian site this account is for.')
  // A separate Jira token, if there is one, stays: this is the main (Confluence) token.
  const c: Creds = { ...old, token: token.trim(), origin }
  const confluenceOk = page && page.origin === origin ? await confluence(c, origin, `/api/v2/pages/${page.id}`).then(() => true, () => false) : false
  // Jira is checked with this token itself (not the separate Jira token, which would pass for any token).
  jiraBases.clear()
  const jiraOk = await jiraBase({ ...c, jiraToken: undefined }, origin).then(() => true, () => false)
  jiraBases.clear()
  if (!confluenceOk && !jiraOk) throw new Error('Atlassian didn’t accept that token for Confluence or Jira. Check you copied all of it.')
  // With a separate Jira token, this one is Confluence's: it has to work there.
  if (old.jiraToken && !confluenceOk)
    throw new Error('Confluence didn’t accept that token, and Jira has its own token, so it wasn’t saved. Check you copied all of it.')
  await writeCreds(c)
  return { confluence: confluenceOk, jira: jiraOk || !!old.jiraToken }
}

/**
 * Sets (after checking Jira accepts it) or removes (null) the separate Jira token. `site` is the Jira
 * site from Settings, for accounts connected before Spoon recorded which site they're for.
 */
export async function setJiraToken(token: string | null, site: string): Promise<void> {
  const old = await readCreds()
  if (!old) throw new Error('Connect your Atlassian account first.')
  let origin = old.origin
  if (!origin) {
    try {
      const u = new URL(site)
      if (u.protocol === 'https:' && u.hostname.endsWith('.atlassian.net')) origin = u.origin
    } catch {
      // no usable site
    }
  }
  if (!origin) throw new Error('Set your Jira site (https://…atlassian.net) above first.')
  const c: Creds = { ...old, origin, jiraToken: token?.trim() || undefined }
  jiraBases.clear()
  if (c.jiraToken)
    await jiraBase(jiraCreds(c), c.origin!).catch(() => {
      throw new Error('Jira didn’t accept that token. It needs the Jira app, with read:jira-work, write:jira-work and read:jira-user.')
    })
  await writeCreds(c)
}

export async function disconnect(): Promise<void> {
  if (process.platform === 'darwin') await security(['delete-generic-password', '-s', SERVICE, '-a', ACCOUNT]).catch(() => undefined)
  else rmSync(secretFile(), { force: true })
  cache = null
  jiraBases.clear()
}

/**
 * A Jira ticket's title and type, read with the connected Atlassian account; null when there's no
 * account, it's for another site, or it can't read the ticket (a Confluence-only token, say).
 */
export async function jiraIssue(site: string, key: string): Promise<JiraIssue | null> {
  const c = await readCreds()
  if (!c || !/^[A-Z][A-Z0-9_]+-\d+$/.test(key)) return null
  let origin: string
  try {
    origin = new URL(site).origin
  } catch {
    return null
  }
  if (!(await allowedOrigin(c, origin))) return null
  type Issue = { fields?: { summary?: string; issuetype?: { name?: string } } }
  try {
    const issue = await jira<Issue>(origin, `/rest/api/3/issue/${key}?fields=summary,issuetype`)
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
  if (!(await allowedOrigin(c, origin)))
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

// ---------- creating Jira tickets ----------

/** The Jira site to talk to, if the connected token may be sent there; else an error to show. */
async function jiraSite(site: string): Promise<{ c: Creds; origin: string }> {
  const c = await readCreds()
  if (!c) throw new Error('Connect your Atlassian account in Settings → Accounts to create tickets.')
  let origin: string
  try {
    origin = new URL(site).origin
  } catch {
    throw new Error('Set your Jira site in Settings → Accounts (e.g. https://acme.atlassian.net).')
  }
  if (!(await allowedOrigin(c, origin)))
    throw new Error(`Your Atlassian token can only be used with ${c.origin ? new URL(c.origin).hostname : 'an Atlassian Cloud site'} over https, not ${new URL(origin).host}.`)
  return { c: (await readCreds()) ?? c, origin }
}

/** Jira's own words for what went wrong ("Summary is required", "Field 'components' is required"). */
async function jiraError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { errorMessages?: string[]; errors?: Record<string, string> } | null
  const parts = [...(body?.errorMessages ?? []), ...Object.entries(body?.errors ?? {}).map(([k, v]) => `${k}: ${v}`)]
  return parts.length ? parts.join('\n') : `Jira returned ${res.status}`
}

const NO_JIRA =
  'Your Atlassian token can’t use Jira (it was made for Confluence only). In Settings → Accounts → Atlassian account, update it to one without scopes (Create API token), or add a separate Jira token (a scoped one for the Jira app, with read:jira-work, write:jira-work and read:jira-user).'

// Where Jira answers for the token, per site: the site itself (classic tokens) or api.atlassian.com
// (scoped tokens). Found by asking who it is: a token Jira doesn't accept is treated as an anonymous
// visitor (no error, just nothing found), so that's checked first.
const jiraBases = new Map<string, string>()
async function jiraBase(c: Creds, origin: string): Promise<string> {
  const key = `${c.email}|${origin}`
  const known = jiraBases.get(key)
  if (known) return known
  // The site first; api.atlassian.com (which needs the cloud id) only if the site doesn't know the token.
  for (const pick of [async () => origin, async () => `https://api.atlassian.com/ex/jira/${await cloudId(origin)}`]) {
    const base = await pick().catch(() => null)
    if (!base) continue
    const res = await fetch(`${base}/rest/api/3/myself`, {
      headers: { Authorization: auth(c), Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000)
    }).catch(() => null)
    if (res?.ok && ((await res.json().catch(() => null)) as { accountId?: string } | null)?.accountId) {
      jiraBases.set(key, base)
      return base
    }
  }
  throw new Error(NO_JIRA)
}

/** A Jira REST call, as the connected account. */
async function jira<T>(site: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const { c: main, origin } = await jiraSite(site)
  const c = jiraCreds(main)
  const base = await jiraBase(c, origin)
  const res = await fetch(`${base}${path}`, {
    method: init.method ?? 'GET',
    headers: { Authorization: auth(c), Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(20_000)
  })
  if (res.status === 401) {
    jiraBases.delete(`${c.email}|${origin}`) // looked up again next time
    throw new Error(NO_JIRA)
  }
  // Signed in but not allowed (a scope missing, say write:jira-work, or no permission in the project).
  if (res.status === 403)
    throw new Error(`Jira refused: ${await jiraError(res)}\nYour token may lack a scope (Jira tokens need read:jira-work, write:jira-work and read:jira-user), or your account this permission.`)
  if (!res.ok) throw new Error(await jiraError(res))
  return (res.status === 204 ? null : await res.json()) as T
}

/** Projects you can create tickets in. */
export async function jiraProjects(site: string): Promise<JiraProject[]> {
  const out: JiraProject[] = []
  // Pages as long as Jira makes them (it may return fewer than asked), up to 1000 projects.
  for (let start = 0; start < 1000; ) {
    const page = await jira<{ values: { id: string; key: string; name: string }[]; isLast?: boolean }>(
      site,
      `/rest/api/3/project/search?action=create&orderBy=name&maxResults=100&startAt=${start}`
    )
    out.push(...page.values.map((p) => ({ id: p.id, key: p.key, name: p.name })))
    if (page.isLast !== false || !page.values.length) break
    start += page.values.length
  }
  return out
}

/** A project's ticket types (not sub-tasks) and its fix versions that aren't released yet, soonest first. */
export async function jiraProjectMeta(site: string, project: string): Promise<JiraProjectMeta> {
  if (!/^[A-Z][A-Z0-9_]+$/.test(project)) throw new Error(`Not a project key: ${project}`)
  const [types, versions] = await Promise.all([
    jira<{ issueTypes?: { id: string; name: string; subtask?: boolean }[]; values?: { id: string; name: string; subtask?: boolean }[] }>(
      site,
      `/rest/api/3/issue/createmeta/${project}/issuetypes?maxResults=100`
    ),
    jira<{ id: string; name: string; released?: boolean; archived?: boolean; releaseDate?: string }[]>(site, `/rest/api/3/project/${project}/versions`)
  ])
  return {
    types: (types.issueTypes ?? types.values ?? []).filter((t) => !t.subtask).map((t) => ({ id: t.id, name: t.name })),
    versions: versions
      .filter((v) => !v.released && !v.archived)
      .sort((a, b) => (a.releaseDate ?? '9999').localeCompare(b.releaseDate ?? '9999') || a.name.localeCompare(b.name, undefined, { numeric: true }))
      .map((v) => ({ id: v.id, name: v.name, releaseDate: v.releaseDate ?? null }))
  }
}

// Fields the form always fills in. Description, fix version and assignee it may leave empty, so
// those are returned too (the form warns only while they're empty).
const FILLED = new Set(['summary', 'issuetype', 'project', 'reporter'])

/** Fields a ticket type requires that the form doesn't always fill in, by id and name. */
export async function jiraRequiredFields(site: string, project: string, typeId: string): Promise<{ id: string; name: string }[]> {
  if (!/^[A-Z][A-Z0-9_]+$/.test(project) || !/^\d+$/.test(typeId)) return []
  const meta = await jira<{ fields?: { fieldId: string; name: string; required: boolean; hasDefaultValue?: boolean }[]; values?: { fieldId: string; name: string; required: boolean; hasDefaultValue?: boolean }[] }>(
    site,
    `/rest/api/3/issue/createmeta/${project}/issuetypes/${typeId}?maxResults=200`
  )
  return (meta.fields ?? meta.values ?? [])
    .filter((f) => f.required && !f.hasDefaultValue && !FILLED.has(f.fieldId))
    .map((f) => ({ id: f.fieldId, name: f.name }))
}

/** Creates a ticket; resolves to its key and link. */
export async function jiraCreate(site: string, t: JiraNewIssue): Promise<{ key: string; url: string }> {
  const fields: Record<string, unknown> = {
    project: { key: t.project },
    issuetype: { id: t.typeId },
    summary: t.summary.trim(),
    ...(t.description.trim() ? { description: markdownToAdf(t.description) } : {}),
    ...(t.fixVersionId ? { fixVersions: [{ id: t.fixVersionId }] } : {})
  }
  if (t.assignToMe) fields.assignee = { accountId: (await jira<{ accountId: string }>(site, '/rest/api/3/myself')).accountId }
  const made = await jira<{ key: string }>(site, '/rest/api/3/issue', { method: 'POST', body: { fields } })
  return { key: made.key, url: `${new URL(site).origin}/browse/${made.key}` }
}

// ---------- Markdown → Atlassian Document Format ----------

type AdfNode = { type: string; attrs?: Record<string, unknown>; content?: AdfNode[]; text?: string; marks?: { type: string; attrs?: Record<string, unknown> }[] }

/** **bold**, *italic*, `code` and [links](https://…) inside a line. */
function inline(text: string): AdfNode[] {
  const out: AdfNode[] = []
  // Emphasis only at word edges (CommonMark-like): Load_Scene_Async and 2*3*4 stay as written.
  const re =
    /(?<![\w*])\*\*(?!\s)([^*]+?)(?<!\s)\*\*(?![\w*])|`([^`]+)`|(?<![\w*])\*(?![\s*])([^*]+?)(?<![\s*])\*(?![\w*])|(?<![\w_])_(?![\s_])([^_]+?)(?<![\s_])_(?![\w_])|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g
  let last = 0
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push({ type: 'text', text: text.slice(last, m.index) })
    if (m[1]) out.push({ type: 'text', text: m[1], marks: [{ type: 'strong' }] })
    else if (m[2]) out.push({ type: 'text', text: m[2], marks: [{ type: 'code' }] })
    else if (m[3] || m[4]) out.push({ type: 'text', text: m[3] ?? m[4], marks: [{ type: 'em' }] })
    else out.push({ type: 'text', text: m[5], marks: [{ type: 'link', attrs: { href: m[6] } }] })
    last = m.index! + m[0].length
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) })
  // Jira rejects empty text nodes.
  return out.filter((n) => n.text !== '')
}

/** The description as Jira stores it: headings, lists, code blocks and paragraphs from Markdown. */
export function markdownToAdf(md: string): AdfNode {
  // Unicode line and paragraph separators (pasted from Slack, the web) are line breaks too.
  const lines = md.replace(/\r\n?|[\u2028\u2029]/g, '\n').split('\n')
  const content: AdfNode[] = []
  for (let i = 0; i < lines.length; ) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }
    if (/^```/.test(line)) {
      const lang = line.slice(3).trim()
      const code: string[] = []
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) code.push(lines[i])
      i++
      const text = code.join('\n')
      content.push({ type: 'codeBlock', ...(lang ? { attrs: { language: lang } } : {}), content: text.trim() ? [{ type: 'text', text }] : [] })
      continue
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      content.push({ type: 'heading', attrs: { level: h[1].length }, content: inline(h[2]) })
      i++
      continue
    }
    const list = (re: RegExp, type: string): boolean => {
      if (!re.test(line)) return false
      const items: AdfNode[] = []
      for (; i < lines.length && re.test(lines[i]); i++)
        items.push({ type: 'listItem', content: [{ type: 'paragraph', content: inline(lines[i].replace(re, '')) }] })
      content.push({ type, content: items })
      return true
    }
    if (list(/^\s*[-*+]\s+/, 'bulletList') || list(/^\s*\d+[.)]\s+/, 'orderedList')) continue
    // A paragraph: the lines up to a blank one (or another block), joined with line breaks.
    // The first line always goes in (whatever it looks like), so this always moves on.
    const para: AdfNode[] = []
    const start = i
    for (; i < lines.length && lines[i].trim() && (i === start || !/^(```|#{1,6}\s|\s*[-*+]\s|\s*\d+[.)]\s)/.test(lines[i])); i++) {
      if (para.length) para.push({ type: 'hardBreak' })
      para.push(...inline(lines[i]))
    }
    if (para.length) content.push({ type: 'paragraph', content: para })
  }
  return { type: 'doc', attrs: { version: 1 }, content } as AdfNode
}
