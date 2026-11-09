// Send Build: the build bot's command for a branch, and opening its Slack channel.

/** The team's build channel, used while Settings has no other link. */
export const BUILD_CHANNEL = 'https://fm-games.slack.com/archives/C08HZDB98H5'

/** The build bot's extra options, added after the four values (in any order). */
export const BUILD_OPTIONS: { id: string; label: string; about: string; iosOnly?: boolean; risky?: boolean }[] = [
  { id: 'addressables', label: 'addressables', about: 'Builds the addressable assets as an extra step before exporting' },
  { id: 'wipe', label: 'wipe', about: 'Wipes the whole project’s workspace', risky: true },
  { id: 'skip_symbols', label: 'skip symbols', about: 'Skips uploading symbols to Firebase' },
  { id: 'skip_declination', label: 'skip declination', about: 'Skips the declination database validation' },
  { id: 'full_history', label: 'full history', about: 'Downloads the repository’s full history instead of a shallow clone (takes longer)' },
  { id: 'remove_pod_trunk', label: 'remove pod trunk', about: 'iOS only: tries to fix “HTTP2 framing layer” errors when updating pods', iosOnly: true }
]

/** The command from the pattern in Settings: {code} {version} {branch} {unity}, then the options. */
export function fillCommand(
  pattern: string,
  values: { code: string; version: string; branch: string; unity: string },
  options: string[] = []
): string {
  const opts = options.join(' ')
  const filled = pattern.replace(/\{(code|version|branch|unity|options)\}/g, (_, k: keyof typeof values | 'options') =>
    k === 'options' ? opts : values[k].trim()
  )
  return (pattern.includes('{options}') ? filled : `${filled} ${opts}`).replace(/\s+/g, ' ').trim()
}

/**
 * Where to send the browser so Slack's app opens on the channel, from a channel link as Slack's
 * "Copy link" gives it (https://team.slack.com/archives/C…) or as the web client shows it
 * (https://app.slack.com/client/T…/C…). Null when it isn't one.
 */
export function slackOpenUrl(link: string): string | null {
  const t = link.trim()
  const archive = t.match(/^https:\/\/([a-z0-9-]+)\.slack\.com\/archives\/([A-Z0-9]+)(?:[/?#]|$)/i)
  if (archive) return `https://${archive[1]}.slack.com/app_redirect?channel=${archive[2]}`
  const client = t.match(/^https:\/\/app\.slack\.com\/client\/(T[A-Z0-9]+)\/([A-Z0-9]+)(?:[/?#]|$)/i)
  if (client) return `https://slack.com/app_redirect?team=${client[1]}&channel=${client[2]}`
  return null
}
