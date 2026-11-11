import { describe, expect, it } from "vitest"
import {
  DEFAULT_INLINE_INFO_RATIO,
  INLINE_FILES_MIN_WIDTH,
  INLINE_INFO_MAX_RATIO,
  INLINE_INFO_MIN_RATIO,
  INLINE_INFO_MIN_WIDTH,
  INLINE_VIEW_COLUMN_WIDTH,
  clampInlineInfoRatio,
  inlineInfoWidth,
  resizeInlineInfoRatio,
} from "../src/gui/inline-split.js"

describe("inline info split", () => {
  it("defaults to a 40% info pane inside the remembered ratio bounds", () => {
    expect(DEFAULT_INLINE_INFO_RATIO).toBe(0.4)
    expect(INLINE_INFO_MIN_RATIO).toBe(0.25)
    expect(INLINE_INFO_MAX_RATIO).toBe(0.6)
    expect(INLINE_INFO_MIN_WIDTH).toBe(200)
  })

  it("clamps remembered ratios to 25%..60%", () => {
    expect(clampInlineInfoRatio(0)).toBe(0.25)
    expect(clampInlineInfoRatio(0.1)).toBe(0.25)
    expect(clampInlineInfoRatio(0.4)).toBe(0.4)
    expect(clampInlineInfoRatio(0.9)).toBe(0.6)
    expect(clampInlineInfoRatio(Number.NaN)).toBe(DEFAULT_INLINE_INFO_RATIO)
    expect(clampInlineInfoRatio(Number.POSITIVE_INFINITY)).toBe(
      DEFAULT_INLINE_INFO_RATIO,
    )
  })

  it("gives the info pane ~40% of a wide slot body", () => {
    expect(inlineInfoWidth(900, 0.4)).toBe(360)
    expect(inlineInfoWidth(900, 0.6)).toBe(540)
    expect(inlineInfoWidth(900, 0.25)).toBe(225)
  })

  it("keeps the 200px preferred minimum on a medium body", () => {
    expect(inlineInfoWidth(600, 0.25)).toBe(200)
    expect(inlineInfoWidth(600, 0.4)).toBe(240)
  })

  it("never lets the three panes overflow a narrow body", () => {
    // 520px panel with the graph column at its 240px default leaves 280px.
    const body = 280
    const width = inlineInfoWidth(body, 0.6)
    expect(width).toBeLessThanOrEqual(
      body - INLINE_FILES_MIN_WIDTH - INLINE_VIEW_COLUMN_WIDTH,
    )
    expect(width).toBe(172)
    expect(width + INLINE_FILES_MIN_WIDTH + INLINE_VIEW_COLUMN_WIDTH).toBe(body)
  })

  it("returns zero for missing or unusable body widths", () => {
    expect(inlineInfoWidth(0, 0.4)).toBe(0)
    expect(inlineInfoWidth(-10, 0.4)).toBe(0)
    expect(inlineInfoWidth(Number.NaN, 0.4)).toBe(0)
    expect(inlineInfoWidth(20, 0.4)).toBe(0)
  })

  it("turns a horizontal drag delta into a clamped ratio", () => {
    expect(resizeInlineInfoRatio(0.4, 90, 900)).toBeCloseTo(0.5)
    expect(resizeInlineInfoRatio(0.4, -90, 900)).toBeCloseTo(0.3)
    expect(resizeInlineInfoRatio(0.4, 1_000, 900)).toBe(0.6)
    expect(resizeInlineInfoRatio(0.4, -1_000, 900)).toBe(0.25)
    expect(resizeInlineInfoRatio(0.4, 90, 0)).toBe(0.4)
    expect(resizeInlineInfoRatio(0.4, Number.NaN, 900)).toBe(0.4)
    expect(resizeInlineInfoRatio(0.4, 0, 900)).toBe(0.4)
  })
})
