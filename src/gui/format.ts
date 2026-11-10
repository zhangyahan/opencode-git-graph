/**
 * Small, presentation-only formatters. No locale state is used, so a commit
 * always renders the same text for the same machine time zone.
 */

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0")
}

export function shortHash(hash: string | null | undefined): string {
  return hash ? hash.slice(0, 7) : ""
}

/**
 * `2026-11-09T12:34:56+08:00` -> `2026-11-09 12:34:56` in the machine's local
 * time zone. Date-only values render as local midnight (`YYYY-MM-DD 00:00:00`);
 * empty values become `""` and unparsable input is returned unchanged.
 */
export function formatCommitDate(value: string): string {
  if (!value) return ""
  const text = value.trim()
  if (!text) return ""

  const dateOnly = DATE_ONLY.exec(text)
  if (dateOnly) {
    const year = Number(dateOnly[1])
    const month = Number(dateOnly[2])
    const day = Number(dateOnly[3])
    const date = new Date(year, month - 1, day)
    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      return value
    }
    return `${text} 00:00:00`
  }

  const date = new Date(text)
  if (Number.isNaN(date.getTime())) return value

  const year = pad(date.getFullYear(), 4)
  const month = pad(date.getMonth() + 1)
  const day = pad(date.getDate())
  const hours = pad(date.getHours())
  const minutes = pad(date.getMinutes())
  const seconds = pad(date.getSeconds())
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
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
