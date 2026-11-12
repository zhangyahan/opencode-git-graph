import { describe, expect, it } from "vitest"
import {
  clampDetailsHeight,
  defaultDetailsHeight,
  DETAILS_HISTORY_MIN_HEIGHT,
  DETAILS_MIN_HEIGHT,
  detailsHeightBounds,
} from "../src/gui/details-size.js"

describe("details height bounds", () => {
  it("leaves room for history and caps the details pane", () => {
    expect(detailsHeightBounds(1_000)).toEqual({
      min: DETAILS_MIN_HEIGHT,
      max: 1_000 - DETAILS_HISTORY_MIN_HEIGHT,
    })
    expect(detailsHeightBounds(320)).toEqual({ min: 160, max: 200 })
    expect(detailsHeightBounds(300)).toEqual({ min: 160, max: 180 })
  })

  it("never inverts on short viewports or malformed input", () => {
    expect(detailsHeightBounds(120)).toEqual({ min: 0, max: 0 })
    expect(detailsHeightBounds(100)).toEqual({ min: 0, max: 0 })
    expect(detailsHeightBounds(0)).toEqual({ min: 0, max: 0 })
    expect(detailsHeightBounds(Number.NaN)).toEqual({ min: 0, max: 0 })
    expect(detailsHeightBounds(Number.POSITIVE_INFINITY)).toEqual({ min: 0, max: 0 })
    expect(detailsHeightBounds(-40)).toEqual({ min: 0, max: 0 })
    expect(detailsHeightBounds(160)).toEqual({ min: 40, max: 40 })
  })

  it("clamps drag heights into the shared space without NaN leakage", () => {
    expect(clampDetailsHeight(10, 1_000)).toBe(DETAILS_MIN_HEIGHT)
    expect(clampDetailsHeight(9_999, 1_000)).toBe(1_000 - DETAILS_HISTORY_MIN_HEIGHT)
    expect(clampDetailsHeight(240.6, 1_000)).toBe(241)
    expect(clampDetailsHeight(999, 320)).toBe(200)
    expect(clampDetailsHeight(Number.NaN, 1_000)).toBe(DETAILS_MIN_HEIGHT)
    expect(clampDetailsHeight(Number.NaN, 120)).toBe(0)
  })

  it("defaults to the historical 42% share, bounded for short panels", () => {
    expect(defaultDetailsHeight(1_000)).toBe(420)
    expect(defaultDetailsHeight(500)).toBe(210)
    expect(defaultDetailsHeight(320)).toBe(160)
    expect(defaultDetailsHeight(300)).toBe(160)
    expect(defaultDetailsHeight(200)).toBe(80)
    expect(defaultDetailsHeight(120)).toBe(0)
    expect(defaultDetailsHeight(Number.NaN)).toBe(0)
  })
})
