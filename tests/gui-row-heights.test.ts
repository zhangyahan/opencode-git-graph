import { describe, expect, it } from "vitest"
import {
  DESCRIPTION_ROW_GAP,
  REF_BADGE_CHAR_WIDTH,
  REF_BADGE_HEIGHT,
  REF_BADGE_ROW_GAP,
  estimateCommitRowHeight,
  estimateRefBadgeWidth,
  layoutRefBadges,
  rowHeightCacheKey,
} from "../src/gui/row-heights.js"
import {
  buildRowHeightPrefix,
  createRowLayout,
  rowIndexAtHeightOffset,
} from "../src/gui/row-layout.js"
import { computeVirtualRange } from "../src/gui/virtual.js"

const ROW = 28
const NARROW_DESCRIPTION = 206
const WIDE_DESCRIPTION = 518

const REF_LABELS = [
  "master",
  "origin/HEAD",
  "origin/fix-operation-login-only",
  "origin/master",
  "v1.2.3",
]

describe("ref badge estimation", () => {
  it("estimates badge width from text and chrome", () => {
    expect(estimateRefBadgeWidth("main")).toBeGreaterThan(
      estimateRefBadgeWidth("ma"),
    )
    expect(estimateRefBadgeWidth("")).toBe(10)
  })

  it("wraps every badge into complete lines without truncating one", () => {
    const layout = layoutRefBadges(REF_LABELS, 196)
    expect(layout.lines).toBeGreaterThan(1)
    expect(layout.lastLineWidth).toBeGreaterThan(0)
    expect(layout.lastLineWidth).toBeLessThanOrEqual(196)
  })

  it("puts a very long badge on multiple internal lines instead of clipping it", () => {
    const label = `origin/${"very-long-branch-name-".repeat(8)}`
    const layout = layoutRefBadges([label], 196)
    expect(layout.lines).toBeGreaterThan(4)
  })

  it("keeps the base height without refs", () => {
    expect(
      estimateCommitRowHeight({
        baseHeight: ROW,
        descriptionWidth: NARROW_DESCRIPTION,
        badgeLabels: [],
        subject: "A normal subject",
      }),
    ).toBe(ROW)
  })

  it("grows when badges wrap and shrinks again on a wider description", () => {
    const narrow = estimateCommitRowHeight({
      baseHeight: ROW,
      descriptionWidth: NARROW_DESCRIPTION,
      badgeLabels: REF_LABELS,
      subject: "A normal subject",
    })
    const wide = estimateCommitRowHeight({
      baseHeight: ROW,
      descriptionWidth: WIDE_DESCRIPTION,
      badgeLabels: REF_LABELS,
      subject: "A normal subject",
    })

    expect(narrow).toBeGreaterThan(ROW)
    expect(narrow).toBeGreaterThan(wide)
    expect(wide).toBeGreaterThanOrEqual(ROW)
  })

  it("is slightly taller than 28px once a badge line exists", () => {
    const single = estimateCommitRowHeight({
      baseHeight: ROW,
      descriptionWidth: WIDE_DESCRIPTION,
      badgeLabels: ["main"],
      subject: "A normal subject",
    })
    expect(single).toBeGreaterThan(28)
    expect(single).toBe(
      6 * 2 + REF_BADGE_HEIGHT,
    )
  })

  it("adds a subject line only when the strip leaves less than 48px", () => {
    const fits = estimateCommitRowHeight({
      baseHeight: ROW,
      descriptionWidth: WIDE_DESCRIPTION,
      badgeLabels: ["main"],
      subject: "ok",
    })
    const pushed = estimateCommitRowHeight({
      baseHeight: ROW,
      descriptionWidth: 80,
      badgeLabels: ["a-very-long-branch-name"],
      subject: "x".repeat(200),
    })

    expect(pushed).toBeGreaterThan(fits)
    expect(pushed).toBeGreaterThanOrEqual(
      ROW + DESCRIPTION_ROW_GAP + REF_BADGE_HEIGHT,
    )
  })

  it("keeps its text units in sync with the exported constants", () => {
    expect(estimateRefBadgeWidth("1234")).toBe(
      Math.ceil(4 * REF_BADGE_CHAR_WIDTH) + 10,
    )
    const layout = layoutRefBadges(["a", "b"], 100)
    expect(layout.lines).toBe(1)
    expect(layout.width).toBe(
      estimateRefBadgeWidth("a") + REF_BADGE_ROW_GAP + estimateRefBadgeWidth("b"),
    )
  })

  it("changes the measurement cache key with width and refs", () => {
    const base = rowHeightCacheKey("abc", 206, ["main"])
    expect(rowHeightCacheKey("abc", 518, ["main"])).not.toBe(base)
    expect(rowHeightCacheKey("abc", 206, ["main", "dev"])).not.toBe(base)
    expect(rowHeightCacheKey("abc", 206, ["main"])).toBe(base)
  })
})

describe("per-row height layout", () => {
  const heights = [28, 49, 28, 69, 28]

  it("builds prefix sums and finds the containing row", () => {
    const prefix = buildRowHeightPrefix(heights)
    expect(prefix).toEqual([0, 28, 77, 105, 174, 202])
    expect(rowIndexAtHeightOffset(prefix, 0)).toBe(0)
    expect(rowIndexAtHeightOffset(prefix, 27.9)).toBe(0)
    expect(rowIndexAtHeightOffset(prefix, 28)).toBe(1)
    expect(rowIndexAtHeightOffset(prefix, 76.9)).toBe(1)
    expect(rowIndexAtHeightOffset(prefix, 77)).toBe(2)
    expect(rowIndexAtHeightOffset(prefix, 202)).toBe(4)
    expect(rowIndexAtHeightOffset(prefix, 10_000)).toBe(4)
    expect(rowIndexAtHeightOffset([], 10)).toBe(-1)
  })

  it("uses the per-row heights for rowTop, height and total", () => {
    const layout = createRowLayout({
      count: heights.length,
      rowHeight: ROW,
      rowHeights: heights,
    })

    expect(layout.totalHeight).toBe(202)
    expect(layout.rowTop(0)).toBe(0)
    expect(layout.rowTop(1)).toBe(28)
    expect(layout.rowTop(2)).toBe(77)
    expect(layout.rowTop(3)).toBe(105)
    expect(layout.rowTop(5)).toBe(202)
    expect(layout.rowHeightAt(0)).toBe(28)
    expect(layout.rowHeightAt(1)).toBe(49)
    expect(layout.rowHeightAt(3)).toBe(69)
    expect(layout.rowHeightAt(-2)).toBe(28)
    expect(layout.rowHeightAt(99)).toBe(28)
  })

  it("binary-searches indexAtOffset for every row", () => {
    const layout = createRowLayout({
      count: heights.length,
      rowHeight: ROW,
      rowHeights: heights,
    })

    expect(layout.indexAtOffset(0)).toBe(0)
    expect(layout.indexAtOffset(27)).toBe(0)
    expect(layout.indexAtOffset(28)).toBe(1)
    expect(layout.indexAtOffset(76)).toBe(1)
    expect(layout.indexAtOffset(77)).toBe(2)
    expect(layout.indexAtOffset(104)).toBe(2)
    expect(layout.indexAtOffset(105)).toBe(3)
    expect(layout.indexAtOffset(201)).toBe(4)
    expect(layout.indexAtOffset(10_000)).toBe(4)
    expect(layout.indexAtOffset(Number.NaN)).toBe(0)
  })

  it("inserts the expansion slot after the measured row", () => {
    const layout = createRowLayout({
      count: heights.length,
      rowHeight: ROW,
      rowHeights: heights,
      expandedIndex: 1,
      expandedHeight: 120,
    })

    expect(layout.slotTop).toBe(77)
    expect(layout.slotHeight).toBe(120)
    expect(layout.totalHeight).toBe(322)
    expect(layout.rowTop(1)).toBe(28)
    expect(layout.rowTop(2)).toBe(197)
    expect(layout.indexAtOffset(76)).toBe(1)
    expect(layout.indexAtOffset(77)).toBe(1)
    expect(layout.indexAtOffset(196)).toBe(1)
    expect(layout.indexAtOffset(197)).toBe(2)
    expect(layout.rowTop(1) + layout.rowHeightAt(1)).toBe(layout.slotTop)
  })

  it("keeps the leading working-tree block and slot above commit rows", () => {
    const layout = createRowLayout({
      count: heights.length,
      rowHeight: ROW,
      rowHeights: heights,
      leadingRows: 1,
      leadingSlotHeight: 100,
      expandedIndex: 3,
      expandedHeight: 50,
    })

    expect(layout.leadingHeight).toBe(28)
    expect(layout.leadingSlotTop).toBe(28)
    expect(layout.rowTop(0)).toBe(128)
    expect(layout.slotTop).toBe(128 + 174)
    expect(layout.totalHeight).toBe(128 + 202 + 50)
    expect(layout.indexAtOffset(127)).toBe(-1)
    expect(layout.indexAtOffset(128)).toBe(0)
  })

  it("returns the same windows as computeVirtualRange for uniform heights", () => {
    const uniform = new Array<number>(100).fill(ROW)
    const layout = createRowLayout({
      count: uniform.length,
      rowHeight: ROW,
      rowHeights: uniform,
    })
    const cases = [
      { scrollTop: 0, viewportHeight: 60, overscan: 2 },
      { scrollTop: 205, viewportHeight: 60, overscan: 2 },
      { scrollTop: -50, viewportHeight: 0, overscan: 2 },
      { scrollTop: 100_000, viewportHeight: 60, overscan: 2 },
      { scrollTop: 0, viewportHeight: 1_000, overscan: 2 },
      { scrollTop: 123.4, viewportHeight: 77.7 },
      { scrollTop: 0, viewportHeight: 60, overscan: 0 },
      { scrollTop: 28, viewportHeight: 0, overscan: 0 },
    ]

    for (const item of cases) {
      expect(layout.range(item.scrollTop, item.viewportHeight, item.overscan)).toEqual(
        computeVirtualRange({
          scrollTop: item.scrollTop,
          viewportHeight: item.viewportHeight,
          rowHeight: ROW,
          total: 100,
          overscan: item.overscan,
        }),
      )
    }
  })

  it("re-estimates heights on a width change and keeps row mapping correct", () => {
    const narrow = heights
    const wide = [28, 29, 28, 29, 28]
    const narrowLayout = createRowLayout({
      count: narrow.length,
      rowHeight: ROW,
      rowHeights: narrow,
    })
    const wideLayout = createRowLayout({
      count: wide.length,
      rowHeight: ROW,
      rowHeights: wide,
    })

    expect(narrowLayout.rowTop(4)).toBe(174)
    expect(wideLayout.rowTop(4)).toBe(114)
    // The same first-visible row and intra-row offset maps back to the same
    // commit after the reflow.
    const index = narrowLayout.indexAtOffset(120)
    const offset = 120 - narrowLayout.rowTop(index)
    const nextTop = wideLayout.rowTop(index) + offset
    expect(wideLayout.indexAtOffset(nextTop)).toBe(index)
    expect(nextTop).toBeGreaterThanOrEqual(wideLayout.rowTop(index))
    expect(nextTop).toBeLessThan(
      wideLayout.rowTop(index) + wideLayout.rowHeightAt(index),
    )
  })

  it("clamps a dynamic viewport at the end and across the slot", () => {
    const layout = createRowLayout({
      count: heights.length,
      rowHeight: ROW,
      rowHeights: heights,
      expandedIndex: 3,
      expandedHeight: 120,
    })
    // Slot occupies [174, 294); the next row starts at 294.
    expect(layout.range(174, 120, 0)).toEqual({ start: 3, end: 4 })
    expect(layout.range(200, 100, 1)).toEqual({ start: 2, end: 5 })
    expect(layout.range(294, 28, 0)).toEqual({ start: 4, end: 5 })
    expect(layout.range(322, 100, 0)).toEqual({ start: 5, end: 5 })
  })
})
