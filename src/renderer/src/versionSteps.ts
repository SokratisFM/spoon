// Version numbers as parts, for the version picker (New candidate).

/** "4.2.1" → [4, 2, 1]; anything after the numbers (a "-rc1") is dropped. */
export function versionParts(v: string): number[] {
  const m = /^\d+(\.\d+)*/.exec(v.trim())
  return m ? m[0].split('.').map(Number) : []
}

/** The parts after `i` back to 0: what raising or lowering part `i` means for a version. */
export function stepVersion(parts: number[], i: number, delta: number): number[] {
  return parts.map((p, j) => (j < i ? p : j === i ? Math.max(0, p + delta) : 0))
}
