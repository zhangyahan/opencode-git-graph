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
   * Optional per-row heights (for example rows whose ref badges wrap). Entries
   * are sanitized to at least 1px; missing entries fall back to `rowHeight`.
   * When supplied, the layout uses prefix sums and binary search instead of the
   * closed-form fixed-row math.
   */
  readonly rowHeights?: readonly number[]
  /**
   * Optional fixed special rows above the commit list (for example the
   * working-tree "Uncommitted changes" row). They share the commit row height
   * and never receive a commit index. Defaults to 0.
   */
  readonly leadingRows?: number
  /**
   * Height of the expansion slot directly below the leading special rows.
   * Ignored when `leadingRows` is 0. Defaults to 0.
   */
  readonly leadingSlotHeight?: number
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
  /**
   * Height of the leading special rows, excluding their optional slot.
   * 0 when `leadingRows` is 0.
   */
  readonly leadingHeight: number
  /** Top of the leading special slot, or `undefined` when there are no leading rows. */
  readonly leadingSlotTop: number | undefined
  /** Sanitized leading slot height; 0 when there are no leading rows. */
  readonly leadingSlotHeight: number
  /** `leadingRows * rowHeight + leadingSlotHeight + count * rowHeight` plus the commit slot. */
  readonly totalHeight: number
  /** Top of the commit slot in pixels, or `undefined` when there is no commit slot. */
  readonly slotTop: number | undefined
  /** Sanitized commit slot height; 0 when there is no commit slot. */
  readonly slotHeight: number
  /** Height of one commit row; base `rowHeight` when no per-row heights apply. */
  rowHeightAt(index: number): number
  /**
   * Top of a commit row in pixels. `index` is truncated and clamped to
   * `[0, count]`, so `rowTop(count) === totalHeight`. Rows after the expanded
   * commit include `slotHeight`; every commit row includes the leading block.
   */
  rowTop(index: number): number
  /**
   * Commit index at a pixel offset. Returns `-1` when there are no commits or
   * when the offset lies inside the leading special rows/slot. Offsets inside
   * the commit slot map to the expanded commit so the slot can always be
   * associated with its owner; offsets after the slot map to the following
   * commit (or the last commit when past the end).
   */
  indexAtOffset(y: number): number
  /**
   * Commit rows to render for a viewport. The returned range is half-open
   * `[start, end)` and never includes the leading rows or either slot as a
   * pseudo-row. It contains the visible rows plus `overscan` rows on each side;
   * when the viewport touches the commit slot the expanded commit stays inside
   * the range so the slot can be associated with it. Defaults match
   * `computeVirtualRange` when there is no leading block or expansion slot.
   */
  range(scrollTop: number, viewportHeight: number, overscan?: number): VirtualRange
}

const DEFAULT_OVERSCAN = 4

export function createRowLayout(input: RowLayoutInput): RowLayout {
  const count = Math.max(0, Math.trunc(finite(input.count, 0)))
  const rowHeight = Math.max(1, finite(input.rowHeight, 1))
  const leadingRows = Math.max(0, Math.trunc(finite(input.leadingRows ?? 0, 0)))
  const leadingHeight = leadingRows * rowHeight
  const leadingSlotHeight =
    leadingRows === 0 ? 0 : Math.max(0, finite(input.leadingSlotHeight ?? 0, 0))
  const leadingSlotTop = leadingRows === 0 ? undefined : leadingHeight
  const leadingBlockHeight = leadingHeight + leadingSlotHeight
  const expandedIndex = validExpandedIndex(input.expandedIndex, count)
  const slotHeight =
    expandedIndex === undefined ? 0 : Math.max(0, finite(input.expandedHeight ?? 0, 0))

  if (input.rowHeights !== undefined) {
    return createVariableRowLayout({
      count,
      baseRowHeight: rowHeight,
      rowHeights: input.rowHeights,
      leadingBlockHeight,
      leadingSlotTop,
      leadingSlotHeight,
      expandedIndex,
      slotHeight,
    })
  }

  const slotStart = expandedIndex === undefined ? 0 : (expandedIndex + 1) * rowHeight
  const slotTop = expandedIndex === undefined ? undefined : leadingBlockHeight + slotStart
  const commitTotalHeight = count * rowHeight + slotHeight
  const totalHeight = leadingBlockHeight + commitTotalHeight

  function rowTop(index: number): number {
    const safeIndex = clampIndex(index, count)
    return (
      leadingBlockHeight +
      safeIndex * rowHeight +
      (expandedIndex !== undefined && safeIndex > expandedIndex ? slotHeight : 0)
    )
  }

  function indexAtOffset(y: number): number {
    if (count === 0) return -1

    const offset = Number.isNaN(y) ? 0 : Math.max(0, y)
    if (offset < leadingBlockHeight) return -1
    const local = offset - leadingBlockHeight

    if (expandedIndex === undefined) {
      if (!Number.isFinite(local)) return count - 1
      return Math.min(count - 1, Math.floor(local / rowHeight))
    }

    if (local < slotStart) {
      return Math.min(count - 1, Math.floor(local / rowHeight))
    }
    if (local < slotStart + slotHeight) {
      return expandedIndex
    }

    const base = local - slotHeight
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

    const rawTop = Math.max(0, finite(scrollTop, 0))
    const viewport = Math.max(0, finite(viewportHeight, 0))

    // The viewport may be entirely above the commit list. In that case no
    // commit row is visible (the leading special row is rendered separately).
    if (leadingBlockHeight > 0 && rawTop + viewport <= leadingBlockHeight) {
      return { start: 0, end: 0 }
    }

    const top = Math.max(0, rawTop - leadingBlockHeight)
    const viewportStart = Math.max(rawTop, leadingBlockHeight)
    const localViewport = Math.max(0, rawTop + viewport - viewportStart)
    const localBottom = top + localViewport

    // Without a slot the behavior is exactly the existing virtual list.
    if (expandedIndex === undefined) {
      return computeVirtualRange({
        scrollTop: top,
        viewportHeight: localViewport,
        rowHeight,
        total: count,
        overscan,
      })
    }

    const extra = Math.max(0, Math.trunc(finite(overscan ?? DEFAULT_OVERSCAN, 0)))
    const bottom = localBottom

    // Fully over-scrolled content behaves like the old virtual window: an
    // empty range at the very end.
    if (top >= commitTotalHeight) return { start: count, end: count }

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
    const postBottom = Math.min(bottom, commitTotalHeight)
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
      const anchor = indexAtOffset(top + leadingBlockHeight)
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
    leadingHeight,
    leadingSlotTop,
    leadingSlotHeight,
    totalHeight,
    slotTop,
    slotHeight,
    rowHeightAt: () => rowHeight,
    rowTop,
    indexAtOffset,
    range,
  }
}

/**
 * Prefix sums of sanitized row heights. `prefix[i]` is the top of row `i`, and
 * `prefix[heights.length]` is the total height of the rows.
 */
export function buildRowHeightPrefix(heights: readonly number[]): number[] {
  const prefix = new Array<number>(heights.length + 1)
  prefix[0] = 0
  for (let index = 0; index < heights.length; index += 1) {
    const height = Math.max(1, finite(heights[index] ?? 1, 1))
    prefix[index + 1] = prefix[index]! + height
  }
  return prefix
}

/**
 * Binary search for the row containing `offset` in a prefix-sum array.
 * Returns `-1` for an empty list, the first row for negative offsets and the
 * last row for offsets at or beyond the end.
 */
export function rowIndexAtHeightOffset(
  prefix: readonly number[],
  offset: number,
): number {
  const count = prefix.length - 1
  if (count <= 0) return -1
  const target = Number.isFinite(offset) ? Math.max(0, offset) : 0
  if (target >= prefix[count]!) return count - 1

  let low = 0
  let high = count - 1
  while (low < high) {
    const middle = Math.floor((low + high + 1) / 2)
    if (prefix[middle]! <= target) low = middle
    else high = middle - 1
  }
  return Math.min(count - 1, low)
}

interface VariableLayoutInput {
  readonly count: number
  readonly baseRowHeight: number
  readonly rowHeights: readonly number[]
  readonly leadingBlockHeight: number
  readonly leadingSlotTop: number | undefined
  readonly leadingSlotHeight: number
  readonly expandedIndex: number | undefined
  readonly slotHeight: number
}

function createVariableRowLayout(input: VariableLayoutInput): RowLayout {
  const count = input.count
  const heights = new Array<number>(count)
  for (let index = 0; index < count; index += 1) {
    heights[index] = Math.max(
      1,
      finite(input.rowHeights[index] ?? input.baseRowHeight, input.baseRowHeight),
    )
  }
  const prefix = buildRowHeightPrefix(heights)
  const commitSlotStart =
    input.expandedIndex === undefined
      ? undefined
      : prefix[input.expandedIndex + 1]!
  const slotTop =
    commitSlotStart === undefined
      ? undefined
      : input.leadingBlockHeight + commitSlotStart
  const commitTotalHeight = prefix[count]! + input.slotHeight
  const totalHeight = input.leadingBlockHeight + commitTotalHeight

  function rowHeightAt(index: number): number {
    if (count === 0) return input.baseRowHeight
    const safeIndex = Math.min(count - 1, Math.max(0, Math.trunc(finite(index, 0))))
    return heights[safeIndex]!
  }

  function rowTop(index: number): number {
    const safeIndex = clampIndex(index, count)
    return (
      input.leadingBlockHeight +
      prefix[safeIndex]! +
      (input.expandedIndex !== undefined && safeIndex > input.expandedIndex
        ? input.slotHeight
        : 0)
    )
  }

  function indexAtOffset(y: number): number {
    if (count === 0) return -1
    const offset = Number.isNaN(y) ? 0 : Math.max(0, y)
    if (offset < input.leadingBlockHeight) return -1
    let local = offset - input.leadingBlockHeight

    if (input.expandedIndex !== undefined && commitSlotStart !== undefined) {
      const slotEnd = commitSlotStart + input.slotHeight
      if (local >= commitSlotStart && local < slotEnd) {
        return input.expandedIndex
      }
      if (local >= slotEnd) local -= input.slotHeight
    }

    return rowIndexAtHeightOffset(prefix, local)
  }

  function range(
    scrollTop: number,
    viewportHeight: number,
    overscan?: number,
  ): VirtualRange {
    if (count === 0) return { start: 0, end: 0 }

    const rawTop = Math.max(0, finite(scrollTop, 0))
    const viewport = Math.max(0, finite(viewportHeight, 0))
    if (
      input.leadingBlockHeight > 0 &&
      rawTop + viewport <= input.leadingBlockHeight
    ) {
      return { start: 0, end: 0 }
    }

    const localTop = Math.max(
      0,
      Math.max(rawTop, input.leadingBlockHeight) - input.leadingBlockHeight,
    )
    const visibleBottom =
      Math.max(rawTop + viewport, input.leadingBlockHeight) -
      input.leadingBlockHeight
    const localBottom = Math.min(commitTotalHeight, visibleBottom)
    if (localTop >= commitTotalHeight) return { start: count, end: count }

    const extra = Math.max(
      0,
      Math.trunc(finite(overscan ?? DEFAULT_OVERSCAN, 0)),
    )

    const first = indexAtCommitOffset(localTop)
    const hasVisibleSpan = localBottom > localTop
    const last = hasVisibleSpan
      ? indexAtCommitOffset(Math.max(localTop, localBottom - 0.001))
      : first

    let start = Math.max(0, first - extra)
    let end = Math.min(
      count,
      Math.max(start, hasVisibleSpan ? last + 1 + extra : first + extra),
    )

    // Keep the expanded commit reachable while its slot intersects the window.
    if (
      input.expandedIndex !== undefined &&
      commitSlotStart !== undefined &&
      localTop < commitSlotStart + input.slotHeight &&
      localBottom > commitSlotStart
    ) {
      start = Math.max(0, Math.min(start, input.expandedIndex))
      end = Math.min(
        count,
        Math.max(end, input.expandedIndex + 1),
      )
    }

    return { start, end }
  }

  /** Slot-aware index lookup in commit coordinates (leading block excluded). */
  function indexAtCommitOffset(local: number): number {
    if (input.expandedIndex !== undefined && commitSlotStart !== undefined) {
      const slotEnd = commitSlotStart + input.slotHeight
      if (local >= commitSlotStart && local < slotEnd) {
        return input.expandedIndex
      }
      if (local >= slotEnd) local -= input.slotHeight
    }
    return rowIndexAtHeightOffset(prefix, local)
  }

  return {
    leadingHeight: input.leadingBlockHeight - input.leadingSlotHeight,
    leadingSlotTop: input.leadingSlotTop,
    leadingSlotHeight: input.leadingSlotHeight,
    totalHeight,
    slotTop,
    slotHeight: input.slotHeight,
    rowHeightAt,
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
