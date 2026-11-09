/**
 * Scroll-range math shared by the commit virtual list and the graph viewport.
 *
 * The DOM is the source of truth for the final value: browsers clamp
 * `scrollTop`/`scrollLeft` to the real content and viewport sizes, and setting
 * the same value may not emit a scroll event. Callers therefore compute a
 * safe value from real measurements and mirror the DOM value back into state
 * instead of trusting an unclamped request.
 */

export function maxScrollOffset(contentSize: number, viewportSize: number): number {
  const content = Number.isFinite(contentSize) ? Math.max(0, contentSize) : 0
  const viewport = Number.isFinite(viewportSize) ? Math.max(0, viewportSize) : 0
  return Math.max(0, content - viewport)
}

export function clampScrollOffset(
  offset: number,
  contentSize: number,
  viewportSize: number,
): number {
  const value = Number.isFinite(offset) ? offset : 0
  return Math.min(Math.max(0, value), maxScrollOffset(contentSize, viewportSize))
}

/** Scroll position for a row index, clamped to the real list range. */
export function scrollTopForRow(
  index: number,
  rowHeight: number,
  contentSize: number,
  viewportSize: number,
): number {
  const safeIndex = Number.isFinite(index) ? Math.max(0, Math.trunc(index)) : 0
  const safeRowHeight = Number.isFinite(rowHeight) ? Math.max(1, rowHeight) : 1
  return clampScrollOffset(safeIndex * safeRowHeight, contentSize, viewportSize)
}
