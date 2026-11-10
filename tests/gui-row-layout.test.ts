import { describe, expect, it } from "vitest"
import { createRowLayout } from "../src/gui/row-layout.js"
import { computeVirtualRange } from "../src/gui/virtual.js"

const ROW = 28

describe("createRowLayout", () => {
  it("lays out an empty list", () => {
    const layout = createRowLayout({ count: 0, rowHeight: ROW })

    expect(layout.totalHeight).toBe(0)
    expect(layout.slotTop).toBeUndefined()
    expect(layout.slotHeight).toBe(0)
    expect(layout.rowTop(0)).toBe(0)
    expect(layout.rowTop(10)).toBe(0)
    expect(layout.indexAtOffset(0)).toBe(-1)
    expect(layout.indexAtOffset(100)).toBe(-1)
    expect(layout.range(0, 100, 2)).toEqual({ start: 0, end: 0 })
  })

  it("sanitizes count to a non-negative integer", () => {
    const fractional = createRowLayout({ count: 2.9, rowHeight: ROW })
    expect(fractional.totalHeight).toBe(2 * ROW)
    expect(fractional.range(0, 100, 0)).toEqual({ start: 0, end: 2 })

    const negative = createRowLayout({ count: -4, rowHeight: ROW })
    expect(negative.totalHeight).toBe(0)
    expect(negative.range(0, 100, 0)).toEqual({ start: 0, end: 0 })

    const nan = createRowLayout({ count: Number.NaN, rowHeight: ROW })
    expect(nan.totalHeight).toBe(0)
  })

  it("matches computeVirtualRange when no commit is expanded", () => {
    const layout = createRowLayout({ count: 100, rowHeight: ROW })
    const cases: Array<{ scrollTop: number; viewportHeight: number; overscan?: number }> = [
      { scrollTop: 0, viewportHeight: 60, overscan: 2 },
      { scrollTop: 205, viewportHeight: 60, overscan: 2 },
      { scrollTop: -50, viewportHeight: 0, overscan: 2 },
      { scrollTop: 100_000, viewportHeight: 60, overscan: 2 },
      { scrollTop: 0, viewportHeight: 1_000, overscan: 2 },
      { scrollTop: 123.4, viewportHeight: 77.7 },
      { scrollTop: 0, viewportHeight: 60, overscan: 0 },
      { scrollTop: 0, viewportHeight: 60, overscan: Number.NaN },
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

  it("places the slot after the expanded commit (first, middle and last)", () => {
    const first = createRowLayout({
      count: 10,
      rowHeight: ROW,
      expandedIndex: 0,
      expandedHeight: 120,
    })
    expect(first.slotTop).toBe(28)
    expect(first.slotHeight).toBe(120)
    expect(first.totalHeight).toBe(400)
    expect(first.rowTop(0)).toBe(0)
    expect(first.rowTop(1)).toBe(148)
    expect(first.rowTop(10)).toBe(400)

    const middle = createRowLayout({
      count: 10,
      rowHeight: ROW,
      expandedIndex: 4,
      expandedHeight: 120,
    })
    expect(middle.slotTop).toBe(140)
    expect(middle.slotHeight).toBe(120)
    expect(middle.totalHeight).toBe(400)
    expect(middle.rowTop(4)).toBe(112)
    expect(middle.rowTop(5)).toBe(260)
    expect(middle.rowTop(10)).toBe(400)

    const last = createRowLayout({
      count: 10,
      rowHeight: ROW,
      expandedIndex: 9,
      expandedHeight: 120,
    })
    expect(last.slotTop).toBe(280)
    expect(last.totalHeight).toBe(400)
    expect(last.rowTop(9)).toBe(252)
    expect(last.rowTop(10)).toBe(400)
    expect(last.indexAtOffset(300)).toBe(9)
  })

  it("maps slot offsets to the expanded commit and post-slot offsets to the next row", () => {
    const layout = createRowLayout({
      count: 10,
      rowHeight: ROW,
      expandedIndex: 4,
      expandedHeight: 100,
    })

    // The slot occupies [140, 240).
    expect(layout.indexAtOffset(139)).toBe(4)
    expect(layout.indexAtOffset(140)).toBe(4)
    expect(layout.indexAtOffset(239)).toBe(4)
    expect(layout.indexAtOffset(240)).toBe(5)
    expect(layout.indexAtOffset(268)).toBe(6)
    expect(layout.indexAtOffset(9_999)).toBe(9)
  })

  it("keeps rowTop monotonic across the slot", () => {
    const layout = createRowLayout({
      count: 50,
      rowHeight: ROW,
      expandedIndex: 20,
      expandedHeight: 333,
    })

    expect(layout.rowTop(0)).toBe(0)
    for (let index = 1; index <= 50; index += 1) {
      const previous = layout.rowTop(index - 1)
      const current = layout.rowTop(index)
      expect(current).toBeGreaterThan(previous)
      expect(current - previous).toBe(index === 21 ? ROW + 333 : ROW)
    }
    expect(layout.rowTop(50)).toBe(layout.totalHeight)
  })

  it("computes 28px slot windows before, across, inside and after the slot", () => {
    const layout = createRowLayout({
      count: 20,
      rowHeight: ROW,
      expandedIndex: 5,
      expandedHeight: 200,
    })
    // Slot occupies [168, 368).
    expect(layout.range(56, 56, 0)).toEqual({ start: 2, end: 4 }) // before
    expect(layout.range(100, 168, 0)).toEqual({ start: 3, end: 6 }) // rows + slot
    expect(layout.range(100, 400, 1)).toEqual({ start: 2, end: 12 }) // across
    expect(layout.range(168, 200, 0)).toEqual({ start: 5, end: 6 }) // inside only
    expect(layout.range(200, 60, 2)).toEqual({ start: 3, end: 8 }) // deep inside
    expect(layout.range(400, 56, 0)).toEqual({ start: 7, end: 10 }) // after
  })

  it("renders a slot at index 0 without treating it as a row", () => {
    const layout = createRowLayout({
      count: 5,
      rowHeight: ROW,
      expandedIndex: 0,
      expandedHeight: 56,
    })

    expect(layout.slotTop).toBe(28)
    expect(layout.rowTop(1)).toBe(84)
    expect(layout.range(28, 56, 0)).toEqual({ start: 0, end: 1 })
    expect(layout.range(0, 112, 0)).toEqual({ start: 0, end: 2 })
  })

  it("keeps the last commit associated with a trailing slot", () => {
    const layout = createRowLayout({
      count: 10,
      rowHeight: ROW,
      expandedIndex: 9,
      expandedHeight: 100,
    })

    // Slot occupies [280, 380).
    expect(layout.range(300, 50, 2)).toEqual({ start: 7, end: 10 })
    expect(layout.range(380, 100, 0)).toEqual({ start: 10, end: 10 })
    expect(layout.indexAtOffset(300)).toBe(9)
    expect(layout.rowTop(9) + ROW).toBe(280)
  })

  it("clamps the tail and over-scrolled ranges", () => {
    const layout = createRowLayout({
      count: 20,
      rowHeight: ROW,
      expandedIndex: 5,
      expandedHeight: 200,
    })

    expect(layout.totalHeight).toBe(760)
    expect(layout.rowTop(19)).toBe(732)
    expect(layout.rowTop(19) + ROW).toBe(760)
    expect(layout.range(660, 100, 0)).toEqual({ start: 16, end: 20 })
    expect(layout.range(760, 100, 0)).toEqual({ start: 20, end: 20 })
    expect(layout.range(1_000_000, 100, 0)).toEqual({ start: 20, end: 20 })
    expect(layout.range(0, 1_000, 2)).toEqual({ start: 0, end: 20 })
  })

  it("ignores invalid expanded indexes", () => {
    const invalid = [
      Number.NaN,
      -1,
      10,
      4.5,
      Number.POSITIVE_INFINITY,
    ]

    for (const expandedIndex of invalid) {
      const layout = createRowLayout({
        count: 10,
        rowHeight: ROW,
        expandedIndex,
        expandedHeight: 120,
      })
      expect(layout.slotTop).toBeUndefined()
      expect(layout.slotHeight).toBe(0)
      expect(layout.totalHeight).toBe(280)
      expect(layout.range(0, 60, 2)).toEqual(
        computeVirtualRange({
          scrollTop: 0,
          viewportHeight: 60,
          rowHeight: ROW,
          total: 10,
          overscan: 2,
        }),
      )
    }
  })

  it("sanitizes the slot height", () => {
    for (const expandedHeight of [Number.NaN, Number.POSITIVE_INFINITY, -50]) {
      const layout = createRowLayout({
        count: 10,
        rowHeight: ROW,
        expandedIndex: 3,
        expandedHeight,
      })
      expect(layout.slotTop).toBe(112)
      expect(layout.slotHeight).toBe(0)
      expect(layout.totalHeight).toBe(280)
      expect(layout.rowTop(4)).toBe(112)
      expect(layout.indexAtOffset(112)).toBe(4)
    }
  })

  it("clamps a non-finite row height", () => {
    const layout = createRowLayout({
      count: 3,
      rowHeight: Number.NaN,
      expandedIndex: 1,
      expandedHeight: 5,
    })

    expect(layout.slotTop).toBe(2)
    expect(layout.totalHeight).toBe(8)
    expect(layout.rowTop(2)).toBe(7)
  })

  it("sanitizes query inputs", () => {
    const layout = createRowLayout({
      count: 10,
      rowHeight: ROW,
      expandedIndex: 4,
      expandedHeight: 100,
    })

    expect(layout.rowTop(Number.NaN)).toBe(0)
    expect(layout.rowTop(-3)).toBe(0)
    expect(layout.rowTop(Number.POSITIVE_INFINITY)).toBe(layout.totalHeight)
    expect(layout.rowTop(100)).toBe(layout.totalHeight)
    expect(layout.indexAtOffset(Number.NaN)).toBe(0)
    expect(layout.indexAtOffset(-100)).toBe(0)
    expect(layout.indexAtOffset(Number.POSITIVE_INFINITY)).toBe(9)
    expect(layout.indexAtOffset(100_000)).toBe(9)
    expect(layout.range(-100, -50, -5)).toEqual({ start: 0, end: 1 })
    expect(layout.range(Number.NaN, Number.NaN, Number.NaN)).toEqual({
      start: 0,
      end: 1,
    })
  })

  it("does not mutate its input", () => {
    const input = Object.freeze({
      count: 10,
      rowHeight: ROW,
      expandedIndex: 3,
      expandedHeight: 100,
    })
    const layout = createRowLayout(input)

    expect(input).toEqual({
      count: 10,
      rowHeight: ROW,
      expandedIndex: 3,
      expandedHeight: 100,
    })
    expect(layout.totalHeight).toBe(380)
  })

  it("returns a bounded window for huge lists", () => {
    const expandedIndex = 500_000
    const slotHeight = 10_000_000
    const layout = createRowLayout({
      count: 1_000_000,
      rowHeight: ROW,
      expandedIndex,
      expandedHeight: slotHeight,
    })
    const slotTop = (expandedIndex + 1) * ROW

    expect(layout.slotTop).toBe(slotTop)
    expect(layout.indexAtOffset(slotTop + 1_000)).toBe(expandedIndex)
    expect(layout.rowTop(999_999)).toBe(999_999 * ROW + slotHeight)

    const range = layout.range(slotTop + 5_000_000, 800, 4)
    expect(range.start).toBeLessThanOrEqual(expandedIndex)
    expect(range.end).toBeGreaterThan(expandedIndex)
    expect(range.end - range.start).toBeLessThanOrEqual(2 * 4 + 1)
    expect(range.end).toBeLessThanOrEqual(1_000_000)
  })
})

describe("createRowLayout leading special rows", () => {
  it("puts the working-tree row and its slot above every commit row", () => {
    const layout = createRowLayout({
      count: 10,
      rowHeight: ROW,
      leadingRows: 1,
      leadingSlotHeight: 100,
    })

    expect(layout.leadingHeight).toBe(28)
    expect(layout.leadingSlotTop).toBe(28)
    expect(layout.leadingSlotHeight).toBe(100)
    expect(layout.totalHeight).toBe(408)
    expect(layout.rowTop(0)).toBe(128)
    expect(layout.rowTop(10)).toBe(408)

    // The special row/slot never receives a commit index.
    expect(layout.indexAtOffset(0)).toBe(-1)
    expect(layout.indexAtOffset(27)).toBe(-1)
    expect(layout.indexAtOffset(127)).toBe(-1)
    expect(layout.indexAtOffset(128)).toBe(0)
    expect(layout.indexAtOffset(155)).toBe(0)
    expect(layout.indexAtOffset(156)).toBe(1)
  })

  it("keeps the commit slot after its owner, offset by the leading block", () => {
    const layout = createRowLayout({
      count: 10,
      rowHeight: ROW,
      leadingRows: 1,
      leadingSlotHeight: 100,
      expandedIndex: 0,
      expandedHeight: 50,
    })

    expect(layout.slotTop).toBe(156)
    expect(layout.slotHeight).toBe(50)
    expect(layout.totalHeight).toBe(458)
    expect(layout.rowTop(1)).toBe(206)
    expect(layout.indexAtOffset(170)).toBe(0)
    expect(layout.indexAtOffset(206)).toBe(1)
  })

  it("returns no commit rows while the viewport only covers the leading block", () => {
    const layout = createRowLayout({
      count: 20,
      rowHeight: ROW,
      leadingRows: 1,
      leadingSlotHeight: 100,
    })

    expect(layout.range(0, 56, 0)).toEqual({ start: 0, end: 0 })
    expect(layout.range(127, 1, 0)).toEqual({ start: 0, end: 0 })
    expect(layout.range(0, 160, 0)).toEqual({ start: 0, end: 2 })
    expect(layout.range(128, 56, 0)).toEqual({ start: 0, end: 2 })
    expect(layout.range(140, 28, 0)).toEqual({ start: 0, end: 2 })
    expect(layout.range(500, 56, 2)).toEqual({ start: 11, end: 18 })
  })

  it("keeps the old virtual window when leading rows are absent", () => {
    const layout = createRowLayout({ count: 100, rowHeight: ROW })
    expect(layout.leadingHeight).toBe(0)
    expect(layout.leadingSlotTop).toBeUndefined()
    expect(layout.leadingSlotHeight).toBe(0)
    expect(layout.totalHeight).toBe(2_800)
    expect(layout.rowTop(0)).toBe(0)
    expect(layout.range(0, 56, 0)).toEqual(
      computeVirtualRange({
        scrollTop: 0,
        viewportHeight: 56,
        rowHeight: ROW,
        total: 100,
        overscan: 0,
      }),
    )
  })
})
