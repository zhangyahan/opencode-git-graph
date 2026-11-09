/**
 * Small, presentation-only formatters. No locale or time-zone state is used,
 * so the same commit always renders the same text.
 */

export function shortHash(hash: string | null | undefined): string {
  return hash ? hash.slice(0, 7) : ""
}

/** `2026-11-09T12:34:56+08:00` -> `2026-11-09`; unknown input is unchanged. */
export function formatCommitDate(value: string): string {
  if (!value) return ""
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value)
  return match ? match[1] : value
}

export function formatRefLabel(ref: string): string {
  return ref.replace(/^HEAD -> /, "HEAD → ")
}

/**
 * Stable 0-359 hue for a ref badge. Git decoration names are plain strings in
 * the shared contract (kind is only available on `GitRef`), so the colour has
 * to be derived from the name itself.
 */
export function refHue(ref: string): number {
  let hash = 0
  for (let index = 0; index < ref.length; index += 1) {
    hash = (hash * 31 + ref.charCodeAt(index)) % 360
  }
  return Math.abs(hash) % 360
}
