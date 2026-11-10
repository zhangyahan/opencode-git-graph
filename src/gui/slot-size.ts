/**
 * Expansion-slot height policy.
 *
 * The drag handle edits a per-session remembered height. The bounds are owned
 * here so the panel and the pure tests agree on the contract: at least 96px,
 * never taller than 560px, and always leaving 80px of the viewport visible.
 */

export const SLOT_MIN_HEIGHT = 96
export const SLOT_MAX_HEIGHT = 560
export const SLOT_VIEWPORT_MARGIN = 80

/** Height of the header row inside an expansion slot. */
export const SLOT_HEADER_HEIGHT = 30
/** Height of one file/group row inside an expansion slot. */
export const SLOT_CONTENT_ROW_HEIGHT = 22
/** Default cap before the user drags; the list scrolls internally above it. */
export const DEFAULT_SLOT_MAX_HEIGHT = 260

export interface SlotHeightBounds {
  readonly min: number
  readonly max: number
}

/**
 * Hard bounds for the current viewport. A short viewport never produces a max
 * below the minimum: `max = max(min, min(560, viewportHeight - 80))`.
 */
export function slotHeightBounds(viewportHeight: number): SlotHeightBounds {
  const viewport = Number.isFinite(viewportHeight) ? Math.max(0, viewportHeight) : 0
  const available = Math.min(SLOT_MAX_HEIGHT, viewport - SLOT_VIEWPORT_MARGIN)
  return { min: SLOT_MIN_HEIGHT, max: Math.max(SLOT_MIN_HEIGHT, available) }
}

/** Clamp a candidate drag/remembered height into the viewport bounds. */
export function clampSlotHeight(height: number, viewportHeight: number): number {
  const bounds = slotHeightBounds(viewportHeight)
  const value = Number.isFinite(height) ? height : bounds.min
  return Math.round(Math.min(bounds.max, Math.max(bounds.min, value)))
}

/**
 * Automatic height for an expanded slot with `contentRows` rows. It grows with
 * the content but keeps the default cap (and the viewport bounds), so a long
 * file list scrolls internally instead of pushing the history away.
 */
export function defaultSlotHeight(
  contentRows: number,
  viewportHeight: number,
): number {
  const rows = Number.isFinite(contentRows) ? Math.max(0, Math.trunc(contentRows)) : 0
  const bounds = slotHeightBounds(viewportHeight)
  const desired = SLOT_HEADER_HEIGHT + rows * SLOT_CONTENT_ROW_HEIGHT
  return Math.round(
    Math.min(bounds.max, Math.max(bounds.min, Math.min(DEFAULT_SLOT_MAX_HEIGHT, desired))),
  )
}
