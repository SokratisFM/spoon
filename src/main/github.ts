// GitHub account and API. The token never reaches the renderer: it lives in the macOS Keychain
// (or, for the GitHub CLI option, is asked from `gh` each time), and every API call happens here.
import { execFile } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import * as git from './git'
import { safeStorage } from 'electron'
import type { NewRelease,
  CreatedPull,
  DeviceCode,
  NewPull,
  GhUser,
  GitHubAccount,
  GitHubSource,
  PullDetail,
  PullFile,
  PullSummary,
  ReviewComment,
  ReviewSubmission,
  TimelineItem
} from '../shared/types'

const API = 'https://api.github.com'
const KEYCHAIN_SERVICE = 'Spoon GitHub'
const SCOPES = 'repo read:org'
const env = { ...process.env, PATH: git.toolPath }
// A request that hangs (captive portal, dead proxy) fails instead of spinning forever.
const TIMEOUT_MS = 30_000
const timeout = (): AbortSignal => AbortSignal.timeout(TIMEOUT_MS)

function exec(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(cmd, args, { env }, (err, stdout, stderr) => (err ? reject(new Error(stderr.trim() || err.message)) : resolve(stdout)))
  )
}

// ---------- account storage ----------

const accountFile = (): string => join(app.getPath('userData'), 'github-account.json')
let account: GitHubAccount | null | undefined
let tokenCache: string | null = null

export function getAccount(): GitHubAccount | null {
  if (account === undefined) {
    try {
      account = existsSync(accountFile()) ? JSON.parse(readFileSync(accountFile(), 'utf8')) : null
    } catch {
      account = null
    }
  }
  return account ?? null
}

async function token(): Promise<string> {
  const acc = getAccount()
  if (!acc) throw new Error('Connect a GitHub account in Settings → Accounts first.')
  if (tokenCache) return tokenCache
  tokenCache = acc.source === 'gh' ? (await exec('gh', ['auth', 'token', '-h', 'github.com'])).trim() : await readSecret(acc.login)
  return tokenCache
}

// Tokens: macOS Keychain through the `security` tool (its access isn't tied to Spoon's own signature,
// so updates never trigger Keychain prompts); on Windows, DPAPI-encrypted in the data folder.
const secretFile = (): string => join(app.getPath('userData'), 'github-token.bin')

async function readSecret(login: string): Promise<string> {
  if (process.platform === 'darwin')
    return (await exec('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', login, '-w'])).trim()
  return safeStorage.decryptString(readFileSync(secretFile()))
}

async function writeSecret(login: string, tok: string): Promise<void> {
  if (process.platform === 'darwin') {
    await exec('security', ['add-generic-password', '-U', '-s', KEYCHAIN_SERVICE, '-a', login, '-l', 'Spoon GitHub token', '-w', tok])
  } else {
    writeFileSync(secretFile(), safeStorage.encryptString(tok))
  }
}

async function deleteSecret(login: string): Promise<void> {
  if (process.platform === 'darwin') {
    await exec('security', ['delete-generic-password', '-s', KEYCHAIN_SERVICE, '-a', login]).catch(() => undefined)
  } else {
    rmSync(secretFile(), { force: true })
  }
}

/** Checks the token against /user and saves the account (and the token in the Keychain, unless it's gh's). */
async function connect(tok: string, source: GitHubSource): Promise<GitHubAccount> {
  const res = await fetch(`${API}/user`, { headers: headers(tok), signal: timeout() })
  if (res.status === 401) throw new Error('GitHub rejected this token. Check that it is correct and not expired.')
  if (!res.ok) throw new Error(`GitHub returned ${res.status}: ${await res.text()}`)
  const user = (await res.json()) as { login: string; name: string | null; avatar_url: string }
  const scopes = (res.headers.get('x-oauth-scopes') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  await disconnect()
  if (source !== 'gh') await writeSecret(user.login, tok)
  account = { login: user.login, name: user.name, avatarUrl: user.avatar_url, scopes, source }
  tokenCache = tok
  writeFileSync(accountFile(), JSON.stringify(account, null, 2))
  return account
}

export async function cliLogin(): Promise<string | null> {
  try {
    const out = await exec('gh', ['auth', 'status', '-h', 'github.com', '--active'])
    return /account (\S+)/.exec(out)?.[1] ?? null
  } catch (err) {
    // Older gh versions print the status to stderr.
    return /account (\S+)/.exec((err as Error).message)?.[1] ?? null
  }
}

export async function connectCli(): Promise<GitHubAccount> {
  let tok: string
  try {
    tok = (await exec('gh', ['auth', 'token', '-h', 'github.com'])).trim()
  } catch {
    throw new Error('The GitHub CLI isn’t signed in. Run `gh auth login` in Terminal, or use another option.')
  }
  return connect(tok, 'gh')
}

export function connectToken(tok: string): Promise<GitHubAccount> {
  return connect(tok.trim(), 'token')
}

export async function disconnect(): Promise<void> {
  const acc = getAccount()
  if (acc && acc.source !== 'gh') await deleteSecret(acc.login)
  account = null
  tokenCache = null
  rmSync(accountFile(), { force: true })
}

// ---------- browser sign-in (OAuth device flow) ----------

let deviceCancelled = false

export async function deviceStart(clientId: string): Promise<DeviceCode> {
  if (!clientId.trim()) throw new Error('Add your OAuth app’s Client ID first.')
  deviceCancelled = false
  const res = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId.trim(), scope: SCOPES }),
    signal: timeout()
  })
  const data = (await res.json()) as Record<string, string | number>
  if (!res.ok || data.error)
    throw new Error(
      data.error === 'device_flow_disabled'
        ? 'Device flow is turned off for this OAuth app. Enable it in the app’s settings on GitHub.'
        : String(data.error_description ?? data.error ?? `GitHub returned ${res.status}`)
    )
  return {
    userCode: String(data.user_code),
    verificationUri: String(data.verification_uri),
    deviceCode: String(data.device_code),
    interval: Number(data.interval),
    expiresIn: Number(data.expires_in)
  }
}

export async function deviceWait(clientId: string, code: DeviceCode): Promise<GitHubAccount> {
  let interval = code.interval
  const deadline = Date.now() + code.expiresIn * 1000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval * 1000))
    if (deviceCancelled) throw new Error('Sign-in cancelled.')
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId.trim(),
        device_code: code.deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
      }),
      signal: timeout()
    })
    const data = (await res.json()) as Record<string, string | number>
    if (data.access_token) return connect(String(data.access_token), 'browser')
    if (data.error === 'authorization_pending') continue
    if (data.error === 'slow_down') {
      interval = Number(data.interval ?? interval + 5)
      continue
    }
    if (data.error === 'access_denied') throw new Error('Sign-in was cancelled on GitHub.')
    throw new Error(String(data.error_description ?? data.error))
  }
  throw new Error('The code expired. Start again.')
}

export function deviceCancel(): void {
  deviceCancelled = true
}

// ---------- API ----------

function headers(tok: string): Record<string, string> {
  return {
    Authorization: `Bearer ${tok}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Spoon'
  }
}

async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
    method: init.method ?? 'GET',
    headers: { ...headers(await token()), ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: timeout()
  })
  if (res.status === 401) {
    tokenCache = null
    throw new Error('GitHub says the token is no longer valid. Reconnect in Settings → Accounts.')
  }
  if (!res.ok) {
    let msg = `GitHub returned ${res.status}`
    try {
      const err = (await res.json()) as { message?: string; errors?: (string | { message?: string })[] }
      const details = (err.errors ?? []).map((e) => (typeof e === 'string' ? e : e.message)).filter(Boolean)
      msg = [err.message, ...details].filter(Boolean).join(': ')
    } catch {
      // keep the status line
    }
    throw new Error(msg)
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}

/** Follows `Link: rel="next"` up to maxPages, for lists like PR files. */
async function apiAll<T>(path: string, maxPages = 10): Promise<T[]> {
  const out: T[] = []
  let url: string | null = `${API}${path}${path.includes('?') ? '&' : '?'}per_page=100`
  for (let page = 0; url && page < maxPages; page++) {
    const res: Response = await fetch(url, { headers: headers(await token()), signal: timeout() })
    if (res.status === 401) tokenCache = null
    if (!res.ok) throw new Error(`GitHub returned ${res.status} for ${path}`)
    out.push(...((await res.json()) as T[]))
    url = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get('link') ?? '')?.[1] ?? null
  }
  return out
}

async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await api<{ data: T; errors?: { message: string }[] }>('/graphql', {
    method: 'POST',
    body: { query, variables }
  })
  if (res.errors?.length) throw new Error(res.errors.map((e) => e.message).join('; '))
  return res.data
}

const user = (u: { login: string; avatar_url: string } | null): GhUser =>
  u ? { login: u.login, avatarUrl: u.avatar_url } : { login: 'ghost', avatarUrl: '' }

/** owner/name from the repo's GitHub remote (origin first). */
export async function repoSlug(path: string): Promise<string | null> {
  return (await repoRemote(path))?.slug ?? null
}

/** The GitHub repo and the remote that points at it: origin when it's on GitHub, else the first one that is. */
export async function repoRemote(path: string): Promise<{ slug: string; remote: string } | null> {
  const remotes = await git.remoteUrls(path)
  const ordered = Object.entries(remotes).sort(([a], [b]) => Number(b === 'origin') - Number(a === 'origin'))
  for (const [remote, url] of ordered) {
    const m = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url)
    if (m) return { slug: `${m[1]}/${m[2]}`, remote }
  }
  return null
}

async function slugOrThrow(path: string): Promise<string> {
  const slug = await repoSlug(path)
  if (!slug) throw new Error('This repository has no GitHub remote.')
  return slug
}

interface RawPull {
  number: number
  node_id: string
  title: string
  body: string | null
  state: string
  merged_at: string | null
  draft: boolean
  user: { login: string; avatar_url: string }
  head: { ref: string; sha: string; repo: { full_name: string } | null }
  base: { ref: string; repo: { full_name: string } }
  html_url: string
  created_at: string
  updated_at: string
  additions: number
  deletions: number
  requested_reviewers: { login: string }[]
}

export async function pulls(path: string): Promise<PullSummary[]> {
  const slug = await slugOrThrow(path)
  const me = getAccount()?.login
  const list = await api<RawPull[]>(`/repos/${slug}/pulls?state=open&per_page=100&sort=updated&direction=desc`)
  return list.map((p) => ({
    number: p.number,
    title: p.title,
    author: user(p.user),
    draft: p.draft,
    headRef: p.head.ref,
    baseRef: p.base.ref,
    updatedAt: p.updated_at,
    url: p.html_url,
    reviewRequested: p.requested_reviewers.some((r) => r.login === me),
    mine: p.user.login === me
  }))
}

export async function pull(path: string, number: number): Promise<PullDetail> {
  const slug = await slugOrThrow(path)
  const base = `/repos/${slug}/pulls/${number}`
  const p = await api<RawPull>(base)

  const [commits, files, issueComments, reviews, reviewComments, checkRuns, status, viewed] = await Promise.all([
    apiAll<{ sha: string; commit: { message: string; author: { name: string; date: string } }; author: { avatar_url: string } | null }>(
      `${base}/commits`
    ),
    apiAll<{ filename: string; previous_filename?: string; status: string; additions: number; deletions: number; patch?: string }>(
      `${base}/files`,
      30
    ),
    apiAll<{ id: number; user: { login: string; avatar_url: string }; body: string; created_at: string }>(
      `/repos/${slug}/issues/${number}/comments`
    ),
    apiAll<{ id: number; user: { login: string; avatar_url: string }; state: string; body: string; submitted_at: string }>(
      `${base}/reviews`
    ),
    apiAll<{
      id: number
      path: string
      line: number | null
      start_line: number | null
      side: 'LEFT' | 'RIGHT'
      body: string
      user: { login: string; avatar_url: string }
      created_at: string
      in_reply_to_id?: number
      diff_hunk: string
    }>(`${base}/comments`),
    api<{ check_runs: { status: string; conclusion: string | null }[] }>(
      `/repos/${slug}/commits/${p.head.sha}/check-runs?per_page=100`
    ).catch(() => ({ check_runs: [] })),
    api<{ statuses: { state: string }[] }>(`/repos/${slug}/commits/${p.head.sha}/status`).catch(() => ({ statuses: [] })),
    viewedFiles(p.node_id).catch(() => new Map<string, boolean>())
  ])

  const checks = { total: 0, passed: 0, failed: 0, pending: 0 }
  for (const r of checkRuns.check_runs) {
    checks.total++
    if (r.status !== 'completed') checks.pending++
    else if (['success', 'neutral', 'skipped'].includes(r.conclusion ?? '')) checks.passed++
    else checks.failed++
  }
  for (const s of status.statuses) {
    checks.total++
    if (s.state === 'success') checks.passed++
    else if (s.state === 'pending') checks.pending++
    else checks.failed++
  }

  const timeline: TimelineItem[] = [
    ...issueComments.map((c) => ({ kind: 'comment' as const, id: c.id, author: user(c.user), body: c.body ?? '', createdAt: c.created_at })),
    ...reviews
      .filter((r) => r.state !== 'PENDING' && (r.body || r.state !== 'COMMENTED'))
      .map((r) => ({
        kind: 'review' as const,
        id: r.id,
        author: user(r.user),
        state: r.state,
        body: r.body ?? '',
        createdAt: r.submitted_at
      }))
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  return {
    number: p.number,
    nodeId: p.node_id,
    title: p.title,
    body: p.body ?? '',
    state: p.merged_at ? 'merged' : p.state === 'open' ? 'open' : 'closed',
    draft: p.draft,
    author: user(p.user),
    headRef: p.head.ref,
    headSha: p.head.sha,
    headRepo: p.head.repo?.full_name ?? null,
    baseRef: p.base.ref,
    baseRepo: p.base.repo.full_name,
    url: p.html_url,
    createdAt: p.created_at,
    additions: p.additions,
    deletions: p.deletions,
    checks,
    commits: commits.map((c) => ({
      sha: c.sha,
      message: c.commit.message,
      author: c.commit.author.name,
      avatarUrl: c.author?.avatar_url,
      date: c.commit.author.date
    })),
    files: files.map(
      (f): PullFile => ({
        path: f.filename,
        previousPath: f.previous_filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch,
        viewed: viewed.get(f.filename) ?? false
      })
    ),
    timeline,
    reviewComments: reviewComments.map(
      (c): ReviewComment => ({
        id: c.id,
        path: c.path,
        line: c.line,
        startLine: c.start_line,
        side: c.side,
        body: c.body,
        author: user(c.user),
        createdAt: c.created_at,
        inReplyTo: c.in_reply_to_id,
        diffHunk: c.diff_hunk
      })
    ),
    viewer: getAccount()?.login ?? ''
  }
}

/** GitHub's per-file "Viewed" checkboxes only exist in the GraphQL API. */
async function viewedFiles(nodeId: string): Promise<Map<string, boolean>> {
  const map = new Map<string, boolean>()
  let after: string | null = null
  for (let page = 0; page < 10; page++) {
    const data: {
      node: { files: { nodes: { path: string; viewerViewedState: string }[]; pageInfo: { hasNextPage: boolean; endCursor: string } } }
    } = await graphql(
      `query($id: ID!, $after: String) { node(id: $id) { ... on PullRequest {
        files(first: 100, after: $after) { nodes { path viewerViewedState } pageInfo { hasNextPage endCursor } } } } }`,
      { id: nodeId, after }
    )
    for (const f of data.node.files.nodes) map.set(f.path, f.viewerViewedState === 'VIEWED')
    if (!data.node.files.pageInfo.hasNextPage) break
    after = data.node.files.pageInfo.endCursor
  }
  return map
}

export async function setViewed(nodeId: string, file: string, viewed: boolean): Promise<void> {
  const name = viewed ? 'markFileAsViewed' : 'unmarkFileAsViewed'
  await graphql(`mutation($id: ID!, $path: String!) { ${name}(input: { pullRequestId: $id, path: $path }) { clientMutationId } }`, {
    id: nodeId,
    path: file
  })
}

export async function comment(path: string, number: number, body: string): Promise<void> {
  await api(`/repos/${await slugOrThrow(path)}/issues/${number}/comments`, { method: 'POST', body: { body } })
}

export async function reply(path: string, number: number, commentId: number, body: string): Promise<void> {
  await api(`/repos/${await slugOrThrow(path)}/pulls/${number}/comments/${commentId}/replies`, { method: 'POST', body: { body } })
}

export async function submitReview(path: string, number: number, review: ReviewSubmission): Promise<void> {
  await api(`/repos/${await slugOrThrow(path)}/pulls/${number}/reviews`, {
    method: 'POST',
    body: {
      commit_id: review.commitId,
      event: review.event,
      body: review.body,
      comments: review.comments.map((c) => ({
        path: c.path,
        body: c.body,
        line: c.line,
        side: c.side,
        ...(c.startLine !== undefined && c.startLine !== c.line ? { start_line: c.startLine, start_side: c.startSide ?? c.side } : {})
      }))
    }
  })
}

/**
 * Same-repo PRs check out as a tracking branch; PRs from forks as a local pr-<number> branch. An
 * existing branch is fast-forwarded to the PR, or left as it is if it has commits of its own.
 */
export async function checkoutPull(path: string, number: number): Promise<void> {
  const p = await api<RawPull>(`/repos/${await slugOrThrow(path)}/pulls/${number}`)
  const baseRepo = p.base.repo.full_name
  const remotes = await git.remoteUrls(path)
  const remote =
    Object.entries(remotes).find(([, url]) => url.includes(`${baseRepo}.git`) || url.endsWith(baseRepo))?.[0] ?? 'origin'
  if (p.head.repo?.full_name === baseRepo) {
    await git.fetchAndCheckout(path, remote, `refs/heads/${p.head.ref}`, p.head.ref, `${remote}/${p.head.ref}`)
  } else {
    await git.fetchAndCheckout(path, remote, `refs/pull/${number}/head`, `pr-${number}`)
  }
}

// ---------- creating pull requests ----------

/** Everyone who can be assigned (and so asked for review) in the repository. */
// ---------- releases ----------

/** The tag of the newest published release, or null when there's none yet. */
export async function latestRelease(path: string): Promise<string | null> {
  const slug = await slugOrThrow(path)
  try {
    return (await api<{ tag_name: string }>(`/repos/${slug}/releases/latest`)).tag_name
  } catch {
    return null
  }
}

/** Release notes as GitHub writes them: the pull requests merged since the previous release. */
export async function releaseNotes(path: string, tag: string, target: string): Promise<{ name: string; body: string }> {
  const slug = await slugOrThrow(path)
  return api(`/repos/${slug}/releases/generate-notes`, { method: 'POST', body: { tag_name: tag, target_commitish: target } })
}

export async function createRelease(path: string, r: NewRelease): Promise<string> {
  const slug = await slugOrThrow(path)
  const created = await api<{ html_url: string }>(`/repos/${slug}/releases`, {
    method: 'POST',
    body: {
      tag_name: r.tag,
      target_commitish: r.target,
      name: r.name,
      body: r.body,
      draft: r.draft,
      prerelease: r.prerelease,
      make_latest: r.latest ? 'true' : 'false'
    }
  })
  return created.html_url
}

export async function assignable(path: string): Promise<GhUser[]> {
  const slug = await slugOrThrow(path)
  const list = await apiAll<{ login: string; avatar_url: string }>(`/repos/${slug}/assignees`, 3)
  return list.map(user)
}

export async function createPull(path: string, p: NewPull): Promise<CreatedPull> {
  const slug = await slugOrThrow(path)
  const created = await api<{ number: number; html_url: string }>(`/repos/${slug}/pulls`, {
    method: 'POST',
    body: { title: p.title, body: p.body, head: p.headRef, base: p.base, draft: p.draft }
  })
  const warnings: string[] = []
  if (p.assignees.length) {
    await api(`/repos/${slug}/issues/${created.number}/assignees`, {
      method: 'POST',
      body: { assignees: p.assignees }
    }).catch((e: Error) => warnings.push(`Assignee: ${e.message}`))
  }
  if (p.reviewers.length) {
    await api(`/repos/${slug}/pulls/${created.number}/requested_reviewers`, {
      method: 'POST',
      body: { reviewers: p.reviewers }
    }).catch((e: Error) => warnings.push(`Reviewers: ${e.message}`))
  }
  return { number: created.number, url: created.html_url, warnings }
}
