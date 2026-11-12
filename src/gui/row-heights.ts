/**
 * Pure row-height estimation for history rows with ref badges.
 *
 * A commit row is no longer a fixed 28px strip: every branch/tag/remote badge
 * is rendered in full, and the description column wraps the badge strip. The
 * estimate below is the first-frame fallback used by the virtual list; the
 * panel additionally measures rendered rows and writes the real height back.
 *
 * The constants mirror `styles.ts` (10px badge font, 1px border, 3px gap,
 * 6px vertical description padding and a 16px subject line). Keeping them here
 * means the pure layout tests and the DOM stay in the same contract.
 */

/** Approximate advance width of one badge character at the 10px UI font. */
export const REF_BADGE_CHAR_WIDTH = 4.8
/** Horizontal padding (4px + 4px) plus the 1px border on both sides. */
export const REF_BADGE_HORIZONTAL_INSET = 10
/** Outer height of one single-line badge: 15px line box + 1px border. */
export const REF_BADGE_HEIGHT = 17
/** Vertical gap between wrapped badge lines. */
export const REF_BADGE_ROW_GAP = 3
/** Vertical padding above and below the description content. */
export const DESCRIPTION_VERTICAL_PADDING = 6
/** Line box of the subject text that shares the description column. */
export const SUBJECT_LINE_HEIGHT = 16
/** Approximate advance width of one subject character. */
export const SUBJECT_CHAR_WIDTH = 5.1
/** The subject never shrinks below this, matching `.gg-subject`. */
export const SUBJECT_MIN_WIDTH = 48
/** Horizontal gap between the badge strip and the subject. */
export const DESCRIPTION_GAP = 6
/** Vertical gap when the subject wraps below the badge strip. */
export const DESCRIPTION_ROW_GAP = 4

export interface RefBadgeLineLayout {
  /** Number of wrapped badge lines; 1 for a non-empty strip, 0 when empty. */
  readonly lines: number
  /** Width already used on the last line. */
  readonly lastLineWidth: number
  /** Full width of the strip, including inter-badge gaps. */
  readonly width: number
}

export interface CommitRowHeightInput {
  /** Base row height (28px in the panel). */
  readonly baseHeight: number
  /** Width of the description grid track in CSS pixels. */
  readonly descriptionWidth: number
  /** Display label for every badge, in render order. */
  readonly badgeLabels: readonly string[]
  /** Commit subject; the subject stays on the badge line while it fits. */
  readonly subject?: string
}

/** Estimated natural width of one badge, including its padding and border. */
export function estimateRefBadgeWidth(label: string): number {
  const text = typeof label === "string" ? label : ""
  let units = 0
  for (const character of text) {
    // CJK/wide glyphs take roughly twice the advance of the Latin UI font.
    units += character.codePointAt(0)! > 0x2e7f ? REF_BADGE_CHAR_WIDTH * 2 : REF_BADGE_CHAR_WIDTH
  }
  return Math.ceil(units + REF_BADGE_HORIZONTAL_INSET)
}

/** Usable strip width inside the description column (its 2px/8px padding). */
export function refBadgeAvailableWidth(descriptionWidth: number): number {
  const width = Number.isFinite(descriptionWidth) ? descriptionWidth : 0
  return Math.max(1, width - 10)
}

/**
 * Greedy line wrapping for the badge strip.
 *
 * Badges never truncate. A single badge wider than the available track wraps
 * its own text across lines (`overflow-wrap:anywhere`), which is modelled by
 * consuming `ceil(width / available)` lines.
 */
export function layoutRefBadges(
  labels: readonly string[],
  availableWidth: number,
): RefBadgeLineLayout {
  const available = Number.isFinite(availableWidth)
    ? Math.max(1, availableWidth)
    : 1
  let lines = 0
  let lastLineWidth = 0
  let totalWidth = 0

  for (const label of labels ?? []) {
    const width = estimateRefBadgeWidth(label)
    totalWidth += width + (lines > 0 ? REF_BADGE_ROW_GAP : 0)

    if (lines === 0) {
      lines = 1
      lastLineWidth = width
    } else if (lastLineWidth + REF_BADGE_ROW_GAP + width <= available) {
      lastLineWidth += REF_BADGE_ROW_GAP + width
    } else {
      lines += 1
      lastLineWidth = width
    }

    // Very long single refs wrap inside the badge instead of being clipped.
    if (lastLineWidth > available) {
      const internalLines = Math.ceil(lastLineWidth / available)
      lines += internalLines - 1
      lastLineWidth = lastLineWidth - (internalLines - 1) * available
    }
  }

  return { lines, lastLineWidth, width: totalWidth }
}

/** Estimated natural width of the subject line (it is `white-space:nowrap`). */
export function estimateSubjectWidth(subject: string | undefined): number {
  if (!subject) return 0
  let units = 0
  for (const character of subject) {
    units += character.codePointAt(0)! > 0x2e7f ? SUBJECT_CHAR_WIDTH * 2 : SUBJECT_CHAR_WIDTH
  }
  return Math.ceil(units)
}

/**
 * Estimated height of a commit row. Rows without refs keep the base height;
 * a badge strip adds its own line height and pushes the subject to a new line
 * when its natural width no longer fits after the last badge line.
 */
export function estimateCommitRowHeight(input: CommitRowHeightInput): number {
  const baseHeight = Number.isFinite(input.baseHeight)
    ? Math.max(1, input.baseHeight)
    : 1
  const labels = Array.isArray(input.badgeLabels) ? input.badgeLabels : []
  if (labels.length === 0) return baseHeight

  const available = refBadgeAvailableWidth(input.descriptionWidth)
  const layout = layoutRefBadges(labels, available)
  const badgeHeight =
    layout.lines * REF_BADGE_HEIGHT +
    Math.max(0, layout.lines - 1) * REF_BADGE_ROW_GAP
  const remaining = available - layout.lastLineWidth - DESCRIPTION_GAP
  const subjectWidth = Math.max(
    SUBJECT_MIN_WIDTH,
    estimateSubjectWidth(input.subject),
  )
  const subjectBelow = remaining < subjectWidth
  const contentHeight =
    badgeHeight +
    (subjectBelow ? DESCRIPTION_ROW_GAP + SUBJECT_LINE_HEIGHT : 0)
  const padding = DESCRIPTION_VERTICAL_PADDING * 2

  return Math.max(baseHeight, padding + contentHeight)
}

/**
 * Cache key for measured heights. Including the width and badge labels means a
 * panel reflow or a ref change invalidates the old measurement automatically.
 */
export function rowHeightCacheKey(
  hash: string,
  descriptionWidth: number,
  badgeLabels: readonly string[],
): string {
  const width = Number.isFinite(descriptionWidth)
    ? Math.round(descriptionWidth)
    : 0
  return `${hash}\u0000${width}\u0000${badgeLabels.join("\u0001")}`
}
