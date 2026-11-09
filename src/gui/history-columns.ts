/**
 * Responsive column policy for the history table.
 *
 * The panel is normally a 520px side panel, but the host can widen it (or the
 * acceptance harness can switch it to 1100px). Date and author are the first
 * columns to go: the subject must never be squeezed out by metadata.
 */

export interface HistoryColumnVisibility {
  readonly date: boolean
  readonly author: boolean
}

export type DetailsLayout = "columns" | "rows"

/** Date stays visible from this width upwards. */
export const DATE_COLUMN_MIN_WIDTH = 640
/** Author needs a little more room than date. */
export const AUTHOR_COLUMN_MIN_WIDTH = 800
/** Files and diff sit side by side from this width upwards. */
export const DETAILS_COLUMNS_MIN_WIDTH = 700

export function historyColumns(width: number): HistoryColumnVisibility {
  const measured = Number.isFinite(width) ? width : 0
  return {
    date: measured >= DATE_COLUMN_MIN_WIDTH,
    author: measured >= AUTHOR_COLUMN_MIN_WIDTH,
  }
}

/**
 * Ref badges shown before the subject. At side-panel widths the subject has to
 * win, so only the two short refs are shown; a `+N` badge summarises the rest.
 */
export function visibleRefCount(width: number): number {
  const measured = Number.isFinite(width) ? width : 0
  if (measured < DATE_COLUMN_MIN_WIDTH) return 2
  if (measured < AUTHOR_COLUMN_MIN_WIDTH) return 3
  return 4
}

/** Whether commit details use a horizontal (files | diff) or vertical split. */
export function detailsLayout(width: number): DetailsLayout {
  const measured = Number.isFinite(width) ? width : 0
  return measured >= DETAILS_COLUMNS_MIN_WIDTH ? "columns" : "rows"
}

export interface HistoryColumnTemplateOptions {
  readonly graphWidth: number
  readonly date: boolean
  readonly author: boolean
}

/**
 * Build the CSS grid template shared by the sticky header and every row.
 * Keeping one template string is what keeps the two grids aligned.
 */
export function historyColumnTemplate(options: HistoryColumnTemplateOptions): string {
  const graphWidth = Number.isFinite(options.graphWidth)
    ? Math.max(1, Math.round(options.graphWidth))
    : 152
  const columns = [`${graphWidth}px`, "minmax(0, 1fr)"]
  if (options.date) columns.push("96px")
  if (options.author) columns.push("118px")
  columns.push("74px")
  return columns.join(" ")
}
