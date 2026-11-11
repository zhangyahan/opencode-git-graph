import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * Structural guarantees for the chrome that has no DOM test harness. These
 * read the rendered sources directly so a regression (for example a dense-graph
 * banner creeping back in) fails fast without booting a browser.
 */
function source(relative: string): string {
  return readFileSync(new URL(`../src/gui/${relative}`, import.meta.url), "utf8")
}

describe("history chrome structure", () => {
  const panel = source("panel.tsx")
  const styles = source("styles.ts")

  it("shows no dense-graph hint when the graph column clips content", () => {
    expect(panel).not.toContain("dense-graph")
    expect(panel).not.toContain("isGraphClipped")
    expect(styles).not.toContain("gg-dense-graph")
  })

  it("keeps the graph column fixed-spacing and scroll-free", () => {
    expect(styles).toContain("overflow-x: hidden")
    // The lane step is the fixed 14px constant.
    expect(source("graph-geometry.ts")).toContain("export const LANE_SPACING = 14")
  })

  it("resizes columns from the header divider strips", () => {
    expect(panel).toContain("data-testid={`resize-column-${column}`}")
    expect(panel).toContain("aria-label={`Resize ${column} column`}")
    expect(styles).toContain(".gg-column-resize")
    expect(styles).toContain("width: 5px")
    // The divider line is always visible in the header; there is no hover-only
    // handle decoration anymore.
    expect(styles).toContain(".gg-history-head > div + div")
    expect(styles).not.toContain(".gg-column-resize::after")
  })

  it("uses the slot bottom divider as the height handle", () => {
    expect(panel).toContain('data-testid="slot-resize-handle"')
    expect(styles).toContain(".gg-slot-resize")
    expect(styles).toContain("cursor: row-resize")
    expect(styles).not.toContain(".gg-slot-resize::after")
  })

  it("splits the inline slot with a draggable divider", () => {
    expect(panel).toContain('data-testid="inline-split"')
    expect(panel).toContain("startInlineSplit")
    expect(styles).toContain(".gg-inline-split")
    expect(styles).toContain("cursor: col-resize")
  })

  it("keeps ref and branch names unclipped", () => {
    expect(styles).toContain(".gg-ref-badges")
    expect(styles).toContain("overflow-x: auto")
    expect(styles).toContain(".gg-branch-name")
    expect(styles).toContain("overflow-wrap: anywhere")
  })
})
