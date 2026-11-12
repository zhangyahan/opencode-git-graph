import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  GIT_GRAPH_TAB_ICON,
  GIT_GRAPH_TAB_LABEL_STYLE,
  GIT_GRAPH_TAB_TITLE,
} from "../src/gui/label.js"

function source(): string {
  return readFileSync(new URL("../src/gui.tsx", import.meta.url), "utf8")
}

describe("Git Graph tab label", () => {
  it("keeps the shared icon and text values", () => {
    expect(GIT_GRAPH_TAB_TITLE).toBe("Git Graph")
    expect(GIT_GRAPH_TAB_ICON).toBe("branch")
    expect(GIT_GRAPH_TAB_LABEL_STYLE).toContain("display:inline-flex")
    expect(GIT_GRAPH_TAB_LABEL_STYLE).toContain("align-items:center")
    expect(GIT_GRAPH_TAB_LABEL_STYLE).toContain("gap:6px")
  })

  it("renders icon plus text inside the tab label", () => {
    const text = source()
    expect(text).toMatch(/label:\s*\(\)\s*=>\s*\(\s*<span style=\{GIT_GRAPH_TAB_LABEL_STYLE\}>/)
    expect(text).toContain("<ctx.ui.Icon name={GIT_GRAPH_TAB_ICON} size=\"small\" />")
    expect(text).toContain("<span>{GIT_GRAPH_TAB_TITLE}</span>")
    expect(text).toContain("title: GIT_GRAPH_TAB_TITLE")
  })

  it("leaves mobile and menu icons in place", () => {
    const text = source()
    expect(text).toContain("mobile:")
    expect(text).toContain("icon: GIT_GRAPH_TAB_ICON")
    expect(text).toContain("ctx.add(MenuItem")
    expect(text).toContain("menu: \"session.panel\"")
  })
})
