// Persistent key-value storage backed by spoon-state.json (see main/store.ts), used instead of
// localStorage so nothing is lost when the app is force-quit or reinstalled.
const data: Record<string, string> = { ...window.spoon.storeSnapshot }

// One-time move of anything saved by older versions in localStorage.
if (!Object.keys(data).some((k) => k.startsWith('spoon.'))) {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key?.startsWith('spoon.')) continue
      const value = localStorage.getItem(key)
      if (value === null) continue
      data[key] = value
      window.spoon.storeSet(key, value)
    }
  } catch {
    // localStorage unavailable: nothing to migrate
  }
}

export function getItem(key: string): string | null {
  return key in data ? data[key] : null
}

export function setItem(key: string, value: string): void {
  if (data[key] === value) return
  data[key] = value
  window.spoon.storeSet(key, value)
}

export function removeItem(key: string): void {
  if (!(key in data)) return
  delete data[key]
  window.spoon.storeSet(key, null)
}
