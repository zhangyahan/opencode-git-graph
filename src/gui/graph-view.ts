import type { GitCommit } from "../shared/types.js"
import type { GraphRow } from "../server/graph/layout.js"
import type { VirtualRange } from "./virtual.js"

export interface GraphRowView {
  readonly row: GraphRow
  readonly commit: GitCommit
  readonly previous: GraphRow | undefined
  readonly index: number
}

/**
 * Build one stable view object per laid-out row. Call this from a memo:
 * scrolling must only slice this array, never rebuild it, or every visible
 * row is replaced and re-created by `<For>` on each scroll event.
 */
export function createGraphRowViews(
  rows: readonly GraphRow[],
  commits: readonly GitCommit[],
): GraphRowView[] {
  const views: GraphRowView[] = []
  const count = Math.min(rows.length, commits.length)
  for (let index = 0; index < count; index += 1) {
    const row = rows[index]
    const commit = commits[index]
    if (!row || !commit) continue
    views.push({ row, commit, previous: rows[index - 1], index })
  }
  return views
}

/**
 * Slice a prebuilt view array for a virtual window. The returned array is new,
 * but its elements are the same objects, so keyed `<For>` rendering keeps the
 * existing row DOM while the user scrolls.
 */
export function visibleGraphRowViews(
  views: readonly GraphRowView[],
  range: VirtualRange,
): GraphRowView[] {
  return views.slice(range.start, range.end)
}
