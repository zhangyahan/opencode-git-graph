/**
 * Inline commit-slot split geometry.
 *
 * The expanded row is one horizontal band: commit information on the left, the
 * file list in the middle and the 28px list/tree column on the right. The
 * vertical divider between the information pane and the file list is
 * user-draggable; this module owns the numbers so the panel and the pure tests
 * agree on the contract.
 *
 * Contract
 * --------
 * - The remembered value is a ratio of the slot body width, clamped to
 *   25%..60%, so widening/narrowing the host panel keeps the split sensible.
 * - The information pane never gets wider than the space left after the file
 *   list minimum and the fixed view-switch column, so the three panes can never
 *   overflow the slot horizontally.
 * - The information pane prefers at least 200px, but gives way before the file
 *   list minimum on a narrow panel (a 520px panel leaves ~280px next to the
 *   graph column).
 */

/** Lower bound of the remembered ratio. */
export const INLINE_INFO_MIN_RATIO = 0.25
/** Upper bound of the remembered ratio. */
export const INLINE_INFO_MAX_RATIO = 0.6
/** Preferred share of the slot body width. */
export const DEFAULT_INLINE_INFO_RATIO = 0.4
/** Preferred minimum width of the information pane. */
export const INLINE_INFO_MIN_WIDTH = 200
/** The file list keeps at least this much width before the info pane gives way. */
export const INLINE_FILES_MIN_WIDTH = 80
/** Fixed list/tree switch column on the right. */
export const INLINE_VIEW_COLUMN_WIDTH = 28

function finite(value: number): number | undefined {
  return Number.isFinite(value) ? value : undefined
}

/** Clamp a remembered/desired ratio into the supported range. */
export function clampInlineInfoRatio(value: number): number {
  const ratio = finite(value)
  if (ratio === undefined) return DEFAULT_INLINE_INFO_RATIO
  return Math.min(INLINE_INFO_MAX_RATIO, Math.max(INLINE_INFO_MIN_RATIO, ratio))
}

/**
 * Resolved information-pane width in pixels for a slot body of `bodyWidth`.
 * The result always leaves room for the file-list minimum and the 28px switch
 * column, so the panes cannot overflow. A body too narrow to satisfy the
 * preferred 200px minimum keeps whatever width is left (never negative).
 */
export function inlineInfoWidth(bodyWidth: number, ratio: number): number {
  const width = finite(bodyWidth)
  if (width === undefined || width <= 0) return 0
  const available = width - INLINE_VIEW_COLUMN_WIDTH
  if (available <= 0) return 0
  const desired = Math.round(width * clampInlineInfoRatio(ratio))
  const maximum = Math.max(0, available - INLINE_FILES_MIN_WIDTH)
  const minimum = Math.min(INLINE_INFO_MIN_WIDTH, maximum)
  return Math.min(maximum, Math.max(minimum, desired))
}

/**
 * Apply one horizontal drag step to the remembered ratio. `delta` is the
 * pointer movement in CSS pixels (positive = drag right = wider info pane), so
 * the ratio moves by `delta / bodyWidth` before being clamped again.
 */
export function resizeInlineInfoRatio(
  ratio: number,
  delta: number,
  bodyWidth: number,
): number {
  const current = clampInlineInfoRatio(ratio)
  const width = finite(bodyWidth)
  const movement = finite(delta)
  if (width === undefined || width <= 0 || movement === undefined || movement === 0) {
    return current
  }
  return clampInlineInfoRatio(current + movement / width)
}
