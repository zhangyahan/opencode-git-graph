export interface VirtualRange {
  /** First row to render, inclusive. */
  readonly start: number
  /** Last row to render, exclusive. */
  readonly end: number
}

export interface VirtualRangeInput {
  readonly scrollTop: number
  readonly viewportHeight: number
  readonly rowHeight: number
  readonly total: number
  /** Rows rendered beyond each edge of the viewport. */
  readonly overscan?: number
}

/**
 * Compute the fixed-row-height window to render.
 *
 * All inputs are clamped so callers can pass raw scroll measurements (which
 * can briefly be negative, fractional or larger than the content) without
 * producing an invalid slice.
 */
export function computeVirtualRange(input: VirtualRangeInput): VirtualRange {
  const total = Math.max(0, Math.trunc(finite(input.total, 0)))
  if (total === 0) return { start: 0, end: 0 }

  const rowHeight = Math.max(1, finite(input.rowHeight, 1))
  const scrollTop = Math.max(0, finite(input.scrollTop, 0))
  const viewportHeight = Math.max(0, finite(input.viewportHeight, 0))
  const overscan = Math.max(0, Math.trunc(finite(input.overscan ?? 4, 0)))

  const firstVisible = Math.floor(scrollTop / rowHeight)
  const visibleEnd = Math.ceil((scrollTop + viewportHeight) / rowHeight)
  const start = Math.min(total, Math.max(0, firstVisible - overscan))
  const end = Math.min(total, Math.max(start, visibleEnd + overscan))

  return { start, end }
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}
