import { computeVirtualRange, type VirtualRange } from "./virtual.js"

/**
 * Layout for the commit list with one optional, variable-height expansion slot.
 *
 * The commit rows themselves keep the same fixed `rowHeight`. A single slot is
 * inserted directly below the expanded commit and pushes every following
 * commit down by `slotHeight`. All queries are closed-form (O(1)) and never
 * allocate or scan arrays, so the layout scales with any `count`.
 */
export interface RowLayoutInput {
  /** Number of commit rows. Non-finite and fractional values are sanitized. */
  readonly count: number
  /** Fixed height of every commit row. Values below 1 are clamped to 1. */
  readonly rowHeight: number
  /**
   * Index of the commit that owns the expansion slot. The slot is ignored
   * unless this is a finite integer in `[0, count)`.
   */
  readonly expandedIndex?: number
  /**
   * Slot height. Non-finite or negative values become 0. The slot still
   * exists (and `slotTop` is still reported) when the height is 0.
   */
  readonly expandedHeight?: number
}

export interface RowLayout {
  /** `count * rowHeight` plus the slot height when the slot exists. */
  readonly totalHeight: number
  /** Top of the slot in pixels, or `undefined` when there is no slot. */
  readonly slotTop: number | undefined
  /** Sanitized slot height; 0 when there is no slot. */
  readonly slotHeight: number
  /**
   * Top of a commit row in pixels. `index` is truncated and clamped to
   * `[0, count]`, so `rowTop(count) === totalHeight`. Rows after the expanded
   * commit include `slotHeight`.
   */
  rowTop(index: number): number
  /**
   * Commit index at a pixel offset. Returns `-1` when there are no commits.
   * Offsets inside the slot map to the expanded commit so the slot can always
   * be associated with its owner; offsets after the slot map to the following
   * commit (or the last commit when past the end).
   */
  indexAtOffset(y: number): number
  /**
   * Commit rows to render for a viewport. The returned range is half-open
   * `[start, end)` and never includes the slot as a pseudo-row. It contains
   * the visible rows plus `overscan` rows on each side; when the viewport
   * touches the slot the expanded commit stays inside the range so the slot
   * can be associated with it. Defaults match `computeVirtualRange`.
   */
  range(scrollTop: number, viewportHeight: number, overscan?: number): VirtualRange
}

const DEFAULT_OVERSCAN = 4

export function createRowLayout(input: RowLayoutInput): RowLayout {
  const count = Math.max(0, Math.trunc(finite(input.count, 0)))
  const rowHeight = Math.max(1, finite(input.rowHeight, 1))
  const expandedIndex = validExpandedIndex(input.expandedIndex, count)
  const slotHeight =
    expandedIndex === undefined ? 0 : Math.max(0, finite(input.expandedHeight ?? 0, 0))
  const slotStart = expandedIndex === undefined ? 0 : (expandedIndex + 1) * rowHeight
  const slotTop = expandedIndex === undefined ? undefined : slotStart
  const totalHeight = count * rowHeight + slotHeight

  function rowTop(index: number): number {
    const safeIndex = clampIndex(index, count)
    return (
      safeIndex * rowHeight +
      (expandedIndex !== undefined && safeIndex > expandedIndex ? slotHeight : 0)
    )
  }

  function indexAtOffset(y: number): number {
    if (count === 0) return -1

    const offset = Number.isNaN(y) ? 0 : Math.max(0, y)

    if (expandedIndex === undefined) {
      if (!Number.isFinite(offset)) return count - 1
      return Math.min(count - 1, Math.floor(offset / rowHeight))
    }

    if (offset < slotStart) {
      return Math.min(count - 1, Math.floor(offset / rowHeight))
    }
    if (offset < slotStart + slotHeight) {
      return expandedIndex
    }

    const base = offset - slotHeight
    if (!Number.isFinite(base)) return count - 1
    return Math.min(
      count - 1,
      Math.max(expandedIndex + 1, Math.floor(base / rowHeight)),
    )
  }

  function range(
    scrollTop: number,
    viewportHeight: number,
    overscan?: number,
  ): VirtualRange {
    if (count === 0) return { start: 0, end: 0 }

    // Without a slot the behavior is exactly the existing virtual list.
    if (expandedIndex === undefined) {
      return computeVirtualRange({
        scrollTop,
        viewportHeight,
        rowHeight,
        total: count,
        overscan,
      })
    }

    const extra = Math.max(0, Math.trunc(finite(overscan ?? DEFAULT_OVERSCAN, 0)))
    const top = Math.max(0, finite(scrollTop, 0))
    const viewport = Math.max(0, finite(viewportHeight, 0))
    const bottom = top + viewport

    // Fully over-scrolled content behaves like the old virtual window: an
    // empty range at the very end.
    if (top >= totalHeight) return { start: count, end: count }

    const slotBottom = slotStart + slotHeight
    let start: number | undefined
    let end: number | undefined

    // Rows before the slot use their base pixel positions.
    const preBottom = Math.min(bottom, slotStart)
    if (preBottom > top) {
      start = Math.max(0, Math.floor(top / rowHeight))
      end = Math.min(expandedIndex + 1, Math.ceil(preBottom / rowHeight))
    }

    // Rows after the slot are shifted down by the slot height.
    const postTop = Math.max(top, slotBottom)
    const postBottom = Math.min(bottom, totalHeight)
    if (postBottom > postTop) {
      const first = Math.max(
        expandedIndex + 1,
        Math.floor((postTop - slotHeight) / rowHeight),
      )
      const last = Math.min(count, Math.ceil((postBottom - slotHeight) / rowHeight))
      start = start === undefined ? first : Math.min(start, first)
      end = end === undefined ? last : Math.max(end, last)
    }

    if (start === undefined || end === undefined || end <= start) {
      // The viewport only overlaps the slot: render the owner plus overscan
      // rather than inventing a commit index for the slot.
      const anchor = indexAtOffset(top)
      start = Math.max(0, anchor - extra)
      end = Math.min(count, anchor + 1 + extra)
    } else {
      start = Math.max(0, start - extra)
      end = Math.min(count, end + extra)
    }

    // Keep the expanded commit reachable while its slot is visible.
    if (top < slotBottom && bottom > slotStart) {
      start = Math.min(start, expandedIndex)
      end = Math.max(end, expandedIndex + 1)
    }

    start = Math.min(count, Math.max(0, start))
    end = Math.max(start, Math.min(count, end))
    return { start, end }
  }

  return {
    totalHeight,
    slotTop,
    slotHeight,
    rowTop,
    indexAtOffset,
    range,
  }
}

function validExpandedIndex(value: number | undefined, count: number): number | undefined {
  if (value === undefined || !Number.isFinite(value) || !Number.isInteger(value)) {
    return undefined
  }
  return value >= 0 && value < count ? value : undefined
}

function clampIndex(value: number, count: number): number {
  if (Number.isNaN(value)) return 0
  if (value === Number.POSITIVE_INFINITY) return count
  return Math.min(count, Math.max(0, Math.trunc(value)))
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}
