const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })
const fullFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' })

/** "14:02" today, "Yesterday", "Mon 14:02" this week, otherwise "23 Oct 2026". */
export function shortDate(unix: number): string {
  const d = new Date(unix * 1000)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const t = d.getTime()
  if (t >= startOfToday) return timeFmt.format(d)
  if (t >= startOfToday - 86400000) return `Yesterday ${timeFmt.format(d)}`
  if (t >= startOfToday - 6 * 86400000)
    return `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${timeFmt.format(d)}`
  return dateFmt.format(d)
}

export function fullDate(unix: number): string {
  return fullFmt.format(new Date(unix * 1000))
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Stable hue per author so the same person always gets the same avatar color. */
export function hueFor(text: string): number {
  let h = 0
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0
  return h % 360
}

export function splitPath(path: string): { dir: string; name: string } {
  const i = path.lastIndexOf('/')
  return i === -1 ? { dir: '', name: path } : { dir: path.slice(0, i + 1), name: path.slice(i + 1) }
}
