/**
 * Bottom working-tree/index diff details height policy.
 *
 * The drag handle edits a remembered pixel height for the details pane that
 * sits below history. Bounds are expressed against the stable space shared by
 * history + details, never against the history viewport itself: growing the
 * details pane shrinks the history viewport by the same amount, so feeding that
 * height back into the bounds would move the maximum while the user drags.
 */

/** Smallest comfortable details height on a normal viewport. */
export const DETAILS_MIN_HEIGHT = 160
/** History keeps at least this much space, including its header/footer. */
export const DETAILS_HISTORY_MIN_HEIGHT = 120
/** Share of the shared history + details space used before the first drag. */
export const DETAILS_DEFAULT_RATIO = 0.42

export interface DetailsHeightBounds {
  readonly min: number
  readonly max: number
}

/**
 * Hard bounds for the shared `availableHeight` (history + details). A short
 * viewport never produces an inverted range, and never needs more space than
 * the parent has: the maximum always leaves `DETAILS_HISTORY_MIN_HEIGHT` for
 * history. When even that does not fit, details is allowed to shrink to zero
 * instead of pushing the page taller.
 */
export function detailsHeightBounds(availableHeight: number): DetailsHeightBounds {
  const available = Number.isFinite(availableHeight)
    ? Math.max(0, availableHeight)
    : 0
  const max = Math.max(0, available - DETAILS_HISTORY_MIN_HEIGHT)
  const min = Math.min(DETAILS_MIN_HEIGHT, max)
  return { min, max }
}

/** Clamp a candidate drag/remembered height into the shared-space bounds. */
export function clampDetailsHeight(height: number, availableHeight: number): number {
  const bounds = detailsHeightBounds(availableHeight)
  const value = Number.isFinite(height) ? height : bounds.min
  return Math.round(Math.min(bounds.max, Math.max(bounds.min, value)))
}

/**
 * Initial height before the user drags: the historical 42% share, clamped so a
 * short panel cannot start taller than its bounds.
 */
export function defaultDetailsHeight(availableHeight: number): number {
  const available = Number.isFinite(availableHeight)
    ? Math.max(0, availableHeight)
    : 0
  const bounds = detailsHeightBounds(available)
  return Math.round(
    Math.min(bounds.max, Math.max(bounds.min, available * DETAILS_DEFAULT_RATIO)),
  )
}
