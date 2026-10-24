// Jira links without any account: a ticket key like MAINLIB-2580 always lives at
// <site>/browse/MAINLIB-2580, so Spoon only needs the Jira site address (Settings → Accounts).
import type { Settings } from './settings'

// Not glued to other letters or digits, but underscores around it are fine (MAINLIB-2580_banner).
const KEY = /(?<![A-Za-z0-9])([A-Z][A-Z0-9]{1,9})-(\d{1,7})(?!\d)/g
// Things that look like keys but aren't tickets.
const NOT_PROJECTS = new Set(['UTF', 'ISO', 'SHA', 'RFC', 'HTTP', 'TLS', 'SSL', 'IEEE', 'ARM', 'X86', 'WIN'])

export interface JiraConfig {
  site: string
  projects: Set<string> | null // null = any project key
}

export function jiraConfig(s: Settings): JiraConfig | null {
  const site = s.jiraSite.trim().replace(/\/+$/, '')
  if (!/^https:\/\//.test(site)) return null
  const projects = s.jiraProjects
    .split(/[,\s]+/)
    .map((p) => p.trim().toUpperCase())
    .filter(Boolean)
  return { site, projects: projects.length ? new Set(projects) : null }
}

/** Ticket keys in a piece of text, in order, without duplicates. */
export function ticketKeys(text: string, cfg: JiraConfig | null): string[] {
  if (!cfg) return []
  const keys: string[] = []
  for (const m of text.matchAll(KEY)) {
    const project = m[1]
    if (NOT_PROJECTS.has(project) || (cfg.projects && !cfg.projects.has(project))) continue
    if (!keys.includes(m[0])) keys.push(m[0])
  }
  return keys
}

export function jiraUrl(cfg: JiraConfig, key: string): string {
  return `${cfg.site}/browse/${key}`
}

/** Splits text into plain parts and ticket keys, for rendering keys as links. */
export function splitByTickets(text: string, cfg: JiraConfig | null): { text: string; key?: string }[] {
  if (!cfg) return [{ text }]
  const parts: { text: string; key?: string }[] = []
  let last = 0
  for (const m of text.matchAll(KEY)) {
    const project = m[1]
    if (NOT_PROJECTS.has(project) || (cfg.projects && !cfg.projects.has(project))) continue
    if (m.index! > last) parts.push({ text: text.slice(last, m.index) })
    parts.push({ text: m[0], key: m[0] })
    last = m.index! + m[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last) })
  return parts
}
