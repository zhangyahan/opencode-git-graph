import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { createRowLayout } from "../src/gui/row-layout.js"
import {
  clampSlotHeight,
  defaultSlotHeight,
  SLOT_MAX_HEIGHT,
  SLOT_MIN_HEIGHT,
  slotHeightBounds,
} from "../src/gui/slot-size.js"

function source(relative: string): string {
  return readFileSync(new URL(`../src/gui/${relative}`, import.meta.url), "utf8")
}

/**
 * The working-tree expansion uses the same bottom-divider contract as a commit
 * slot. These checks cover the wiring that has no DOM harness plus the pure
 * layout/clamp math that makes a drag update the leading slot height.
 */
describe("uncommitted slot resize contract", () => {
  it("renders the working-tree slot with the shared bottom resize handle", () => {
    const panel = source("panel.tsx")
    const start = panel.indexOf("interface UncommittedSlotProps")
    const end = panel.indexOf("/* ---------- inline commit file slot ---------- */")
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const slot = panel.slice(start, end)

    expect(slot).toContain("gg-row-slot gg-uncommitted-slot")
    expect(slot).toContain("style={{ top: `${props.top}px`, height: `${props.height}px` }}")
    expect(slot).toContain('data-testid="slot-resize-handle"')
    expect(slot).toContain("onPointerDown={(event) => props.onResizeStart(event)}")
    expect(slot).toContain("onKeyDown={(event) => props.onResizeKeyDown(event)}")
    expect(slot).not.toContain("gg-slot-resize-grip")
  })

  it("wires the uncommitted slot height to the leading slot layout", () => {
    const panel = source("panel.tsx")
    const start = panel.indexOf("<UncommittedSlot")
    const end = panel.indexOf(
      "/>",
      panel.indexOf("onResizeKeyDown", start),
    )
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const render = panel.slice(start, end)

    expect(render).toContain("height={rowLayout().leadingSlotHeight}")
    expect(render).toContain("startSlotResize(UNCOMMITTED_SLOT_KEY, event)")
    expect(render).toContain("nudgeSlotHeight(UNCOMMITTED_SLOT_KEY, event)")
    expect(panel).toContain('const UNCOMMITTED_SLOT_KEY = "uncommitted"')
    expect(panel).toContain("leadingSlotHeight: uncommittedSlotHeight()")
  })

  it("uses a session-remembered override for collapse/reopen", () => {
    const panel = source("panel.tsx")

    expect(panel).toContain("const [slotHeightOverrides, setSlotHeightOverrides]")
    expect(panel).toContain("const stored = slotHeightOverrides()[key]")
    expect(panel).toContain("clampSlotHeight(stored, viewportHeight())")
    expect(panel).toContain("resolveSlotHeight(\n      UNCOMMITTED_SLOT_KEY,")
    expect(panel).toContain(
      "setSlotHeightOverrides((previous) =>\n        previous[key] === next ? previous : { ...previous, [key]: next },",
    )
  })

  it("keeps the divider itself as the full-width 5px row-resize hit area", () => {
    const styles = source("styles.ts")
    const start = styles.indexOf(".gg-slot-resize {")
    const end = styles.indexOf("}", start)
    expect(start).toBeGreaterThan(-1)
    const block = styles.slice(start, end)

    expect(block).toContain("left: 0")
    expect(block).toContain("right: 0")
    expect(block).toContain("bottom: 0")
    expect(block).toContain("width: 100%")
    expect(block).toContain("height: 5px")
    expect(block).toContain("cursor: row-resize")
    expect(styles).not.toContain(".gg-slot-resize::after")
  })
})

describe("leading slot height math", () => {
  it("moves the leading slot and total height by the dragged delta", () => {
    const base = createRowLayout({
      count: 3,
      rowHeight: 28,
      leadingRows: 1,
      leadingSlotHeight: SLOT_MIN_HEIGHT,
    })
    const grown = createRowLayout({
      count: 3,
      rowHeight: 28,
      leadingRows: 1,
      leadingSlotHeight: 340,
    })

    expect(base.leadingSlotTop).toBe(28)
    expect(base.leadingSlotHeight).toBe(SLOT_MIN_HEIGHT)
    expect(base.totalHeight).toBe(28 + SLOT_MIN_HEIGHT + 3 * 28)
    expect(grown.leadingSlotHeight).toBe(340)
    expect(grown.totalHeight - base.totalHeight).toBe(340 - SLOT_MIN_HEIGHT)
    expect(grown.rowTop(0) - base.rowTop(0)).toBe(340 - SLOT_MIN_HEIGHT)
  })

  it("clamps a drag to 96..max(96, min(560, viewport - 80))", () => {
    for (const viewport of [150, 320, 700, 1_200]) {
      const bounds = slotHeightBounds(viewport)
      expect(bounds.min).toBe(SLOT_MIN_HEIGHT)
      expect(bounds.max).toBe(
        Math.max(SLOT_MIN_HEIGHT, Math.min(SLOT_MAX_HEIGHT, viewport - 80)),
      )
      expect(clampSlotHeight(-10_000, viewport)).toBe(bounds.min)
      expect(clampSlotHeight(10_000, viewport)).toBe(bounds.max)
      expect(clampSlotHeight(SLOT_MIN_HEIGHT + 24.4, viewport)).toBe(
        Math.min(bounds.max, SLOT_MIN_HEIGHT + 24),
      )
    }
  })

  it("caps the automatic content estimate so long file lists scroll internally", () => {
    expect(defaultSlotHeight(0, 900)).toBe(96)
    expect(defaultSlotHeight(10, 900)).toBe(250)
    expect(defaultSlotHeight(45, 900)).toBe(260)
    expect(defaultSlotHeight(45, 320)).toBe(240)
    expect(defaultSlotHeight(45, 150)).toBe(96)
  })
})
