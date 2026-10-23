// Authors seen in the open repository's history, offered as suggestions in Settings > Authors.
let known: string[] = []

export function setKnownAuthors(names: string[]): void {
  known = [...new Set(names)].sort((a, b) => a.localeCompare(b))
}

export function knownAuthors(): string[] {
  return known
}
