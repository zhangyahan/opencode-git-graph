import { describe, expect, it } from "vitest"
import {
  COLUMN_MIN_WIDTHS,
  COLUMN_PREFERENCES_STORAGE_KEY,
  DEFAULT_COLUMN_PREFERENCES,
  normalizeColumnPreferences,
  readColumnPreferences,
  resizeColumnPreferences,
  resolveColumnLayout,
  writeColumnPreferences,
  type ColumnId,
  type ColumnPreferenceStorage,
  type ColumnPreferences,
  type ResolvedColumnLayout,
} from "../src/gui/column-layout.js"
import { GRAPH_COLUMN_WIDTH } from "../src/gui/graph-geometry.js"

const PANEL_WIDE = 1100
const PANEL_NARROW = 520

function layout(
  preferences: ColumnPreferences = DEFAULT_COLUMN_PREFERENCES,
  panelWidth = PANEL_WIDE,
): ResolvedColumnLayout {
  return resolveColumnLayout(panelWidth, preferences)
}

function visibleTotal(resolved: ResolvedColumnLayout): number {
  return resolved.visible.reduce(
    (total, column) => total + resolved.widths[column],
    0,
  )
}

function expectedTemplate(resolved: ResolvedColumnLayout): string {
  const parts = [
    `${resolved.widths.graph}px`,
    `minmax(${COLUMN_MIN_WIDTHS.description}px, 1fr)`,
  ]
  if (resolved.visibility.date) parts.push(`${resolved.widths.date}px`)
  if (resolved.visibility.author) parts.push(`${resolved.widths.author}px`)
  parts.push(`${resolved.widths.commit}px`)
  return parts.join(" ")
}

function memoryStorage(): ColumnPreferenceStorage & {
  values: Map<string, string>
} {
  const values = new Map<string, string>()
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    },
  }
}

describe("default column layout", () => {
  it("reproduces 240 / 518 / 150 / 118 / 74 at 1100px", () => {
    const resolved = layout()
    expect(resolved.visible).toEqual([
      "graph",
      "description",
      "date",
      "author",
      "commit",
    ])
    expect(resolved.widths).toEqual({
      graph: 240,
      description: 518,
      date: 150,
      author: 118,
      commit: 74,
    })
    expect(resolved.gridTemplate).toBe(
      "240px minmax(120px, 1fr) 150px 118px 74px",
    )
    expect(resolved.satisfied).toBe(true)
    expect(resolved.minimumWidth).toBe(480)
    expect(visibleTotal(resolved)).toBe(PANEL_WIDE)
  })

  it("reproduces 240 / 206 / 74 at 520px with date and author hidden", () => {
    const resolved = layout(DEFAULT_COLUMN_PREFERENCES, PANEL_NARROW)
    expect(resolved.visible).toEqual(["graph", "description", "commit"])
    expect(resolved.visibility.date).toBe(false)
    expect(resolved.visibility.author).toBe(false)
    expect(resolved.widths.graph).toBe(240)
    expect(resolved.widths.description).toBe(206)
    expect(resolved.widths.commit).toBe(74)
    expect(resolved.gridTemplate).toBe("240px minmax(120px, 1fr) 74px")
    expect(resolved.satisfied).toBe(true)
    expect(visibleTotal(resolved)).toBe(PANEL_NARROW)
  })

  it("brings date back at its existing historyColumns threshold", () => {
    const resolved = layout(DEFAULT_COLUMN_PREFERENCES, 640)
    expect(resolved.visibility.date).toBe(true)
    expect(resolved.visibility.author).toBe(false)
    expect(resolved.widths.date).toBe(150)
    expect(resolved.widths.description).toBe(176)
    expect(resolved.gridTemplate).toBe(
      "240px minmax(120px, 1fr) 150px 74px",
    )
  })

  it("brings author back at its existing historyColumns threshold", () => {
    const resolved = layout(DEFAULT_COLUMN_PREFERENCES, 800)
    expect(resolved.visibility.date).toBe(true)
    expect(resolved.visibility.author).toBe(true)
    expect(resolved.widths.description).toBe(218)
    expect(resolved.gridTemplate).toBe(
      "240px minmax(120px, 1fr) 150px 118px 74px",
    )
  })

  it("drops author first, then date, when stored widths exceed the budget", () => {
    const hiddenAuthor = layout({ ...DEFAULT_COLUMN_PREFERENCES, author: 500 }, 800)
    expect(hiddenAuthor.visibility.author).toBe(false)
    expect(hiddenAuthor.visibility.date).toBe(true)
    expect(hiddenAuthor.widths.description).toBeGreaterThanOrEqual(120)

    const hiddenDate = layout({ ...DEFAULT_COLUMN_PREFERENCES, date: 500 }, 650)
    expect(hiddenDate.visibility.date).toBe(false)
    expect(hiddenDate.visibility.author).toBe(false)
    expect(hiddenDate.widths.description).toBeGreaterThanOrEqual(120)
  })
})

describe("application-owned graph column", () => {
  it("ignores any stored graph width and stays at 240px on a normal panel", () => {
    for (const stored of [96, 152, 240, 260, 9999]) {
      const resolved = layout({ ...DEFAULT_COLUMN_PREFERENCES, graph: stored }, PANEL_WIDE)
      expect(resolved.widths.graph).toBe(GRAPH_COLUMN_WIDTH)
      expect(resolved.gridTemplate.startsWith(`${GRAPH_COLUMN_WIDTH}px `)).toBe(true)
    }
  })

  it("shrinks passively only when the panel budget requires it", () => {
    expect(layout(DEFAULT_COLUMN_PREFERENCES, 434).widths.graph).toBe(240)
    expect(layout(DEFAULT_COLUMN_PREFERENCES, 400).widths.graph).toBe(206)
    expect(layout(DEFAULT_COLUMN_PREFERENCES, 314).widths.graph).toBe(120)
    expect(layout(DEFAULT_COLUMN_PREFERENCES, 290).widths.graph).toBe(96)
    expect(layout(DEFAULT_COLUMN_PREFERENCES, 272).widths.graph).toBe(96)
    expect(layout(DEFAULT_COLUMN_PREFERENCES, 250).widths.graph).toBe(96)
  })
})

describe("shared grid template", () => {
  it("returns one template derived from the resolved columns", () => {
    for (const width of [520, 640, 800, 1100]) {
      const resolved = layout(DEFAULT_COLUMN_PREFERENCES, width)
      expect(resolved.gridTemplate).toBe(expectedTemplate(resolved))
      // A single string, no per-header/per-row variant.
      expect(resolved.gridTemplate).toContain(
        `minmax(${COLUMN_MIN_WIDTHS.description}px, 1fr)`,
      )
    }
  })
})

describe("dragging editable columns", () => {
  it("does not resize the graph column", () => {
    const prefs = resizeColumnPreferences(
      DEFAULT_COLUMN_PREFERENCES,
      "graph",
      100,
      PANEL_WIDE,
    )
    expect(prefs.graph).toBe(GRAPH_COLUMN_WIDTH)
    expect(prefs.description).toBe(DEFAULT_COLUMN_PREFERENCES.description)
    const resolved = layout(prefs)
    expect(resolved.widths.graph).toBe(GRAPH_COLUMN_WIDTH)
    expect(resolved.widths.description).toBe(518)
  })

  it("date grows and description compensates", () => {
    const prefs = resizeColumnPreferences(
      DEFAULT_COLUMN_PREFERENCES,
      "date",
      20,
      PANEL_WIDE,
    )
    expect(prefs.date).toBe(170)
    expect(prefs.description).toBe(498)
    const resolved = layout(prefs)
    expect(resolved.widths.date).toBe(170)
    expect(resolved.widths.description).toBe(498)
    expect(visibleTotal(resolved)).toBe(PANEL_WIDE)
  })

  it("author grows and description compensates", () => {
    const prefs = resizeColumnPreferences(
      DEFAULT_COLUMN_PREFERENCES,
      "author",
      20,
      PANEL_WIDE,
    )
    expect(prefs.author).toBe(138)
    expect(prefs.description).toBe(498)
    const resolved = layout(prefs)
    expect(resolved.widths.author).toBe(138)
    expect(resolved.widths.description).toBe(498)
    expect(visibleTotal(resolved)).toBe(PANEL_WIDE)
  })

  it("commit grows and description compensates", () => {
    const prefs = resizeColumnPreferences(
      DEFAULT_COLUMN_PREFERENCES,
      "commit",
      20,
      PANEL_WIDE,
    )
    expect(prefs.commit).toBe(94)
    expect(prefs.description).toBe(498)
    const resolved = layout(prefs)
    expect(resolved.widths.commit).toBe(94)
    expect(resolved.widths.description).toBe(498)
    expect(visibleTotal(resolved)).toBe(PANEL_WIDE)
  })

  it("description grows by shrinking the right visible neighbour (date)", () => {
    const prefs = resizeColumnPreferences(
      DEFAULT_COLUMN_PREFERENCES,
      "description",
      20,
      PANEL_WIDE,
    )
    expect(prefs.date).toBe(130)
    expect(prefs.description).toBe(538)
    const resolved = layout(prefs)
    expect(resolved.widths.description).toBe(538)
    expect(resolved.widths.date).toBe(130)
    expect(visibleTotal(resolved)).toBe(PANEL_WIDE)
  })

  it("uses commit as the neighbour when date is hidden", () => {
    const prefs = resizeColumnPreferences(
      DEFAULT_COLUMN_PREFERENCES,
      "description",
      20,
      PANEL_NARROW,
    )
    expect(prefs.commit).toBe(56) // clamped to the 56px minimum
    expect(prefs.date).toBe(150) // untouched, date is hidden
    expect(prefs.description).toBe(224)
    const resolved = layout(prefs, PANEL_NARROW)
    expect(resolved.visible).not.toContain("date")
    expect(resolved.widths.description).toBe(224)
    expect(visibleTotal(resolved)).toBe(PANEL_NARROW)
  })

  it("can also shrink description, growing its neighbour", () => {
    const prefs = resizeColumnPreferences(
      DEFAULT_COLUMN_PREFERENCES,
      "description",
      -40,
      PANEL_WIDE,
    )
    expect(prefs.date).toBe(190)
    expect(prefs.description).toBe(478)
    expect(layout(prefs).widths.description).toBe(478)
  })

  it("keeps date at its 128px minimum and commit at 56px", () => {
    expect(COLUMN_MIN_WIDTHS.date).toBe(128)
    expect(COLUMN_MIN_WIDTHS.commit).toBe(56)
    expect(COLUMN_MIN_WIDTHS.graph).toBe(96)
  })
})

describe("resize on narrow panels", () => {
  it("never pushes a visible layout past the panel width", () => {
    const cases: Array<[ColumnId, number]> = [
      ["graph", 1000],
      ["commit", 1000],
      ["description", 1000],
    ]
    for (const [column, delta] of cases) {
      const prefs = resizeColumnPreferences(
        DEFAULT_COLUMN_PREFERENCES,
        column,
        delta,
        PANEL_NARROW,
      )
      const resolved = layout(prefs, PANEL_NARROW)
      expect(resolved.widths.description).toBeGreaterThanOrEqual(
        COLUMN_MIN_WIDTHS.description,
      )
      expect(visibleTotal(resolved)).toBe(PANEL_NARROW)
      for (const id of resolved.visible) {
        expect(resolved.widths[id]).toBeGreaterThan(0)
      }
    }
  })

  it("preserves a growing commit by driving graph and description to their minimums", () => {
    const prefs = resizeColumnPreferences(
      DEFAULT_COLUMN_PREFERENCES,
      "commit",
      1000,
      PANEL_NARROW,
    )
    expect(prefs.commit).toBe(304)
    const resolved = layout(prefs, PANEL_NARROW)
    expect(resolved.widths.commit).toBe(200)
    expect(resolved.widths.graph).toBe(200)
    expect(resolved.widths.description).toBe(120)
    expect(visibleTotal(resolved)).toBe(PANEL_NARROW)
  })
})

describe("minimum budget policy", () => {
  it("keeps minimum widths and reports the shortfall instead of going negative", () => {
    const resolved = layout(DEFAULT_COLUMN_PREFERENCES, 200)
    expect(resolved.visible).toEqual(["graph", "description", "commit"])
    expect(resolved.satisfied).toBe(false)
    expect(resolved.minimumWidth).toBe(272)
    expect(resolved.widths.description).toBe(120)
    expect(resolved.widths.graph).toBe(96)
    expect(resolved.widths.commit).toBe(56)
    for (const width of Object.values(resolved.widths)) {
      expect(width).toBeGreaterThanOrEqual(0)
    }
  })

  it("treats a non-finite panel width as zero without crashing", () => {
    const resolved = layout(DEFAULT_COLUMN_PREFERENCES, Number.NaN)
    expect(resolved.satisfied).toBe(false)
    expect(resolved.widths.description).toBe(120)
    expect(resolved.widths.graph).toBe(96)
    expect(resolved.widths.commit).toBe(56)
    expect(resolved.visible).toEqual(["graph", "description", "commit"])
  })
})

describe("wide → narrow → wide budget restoration", () => {
  it("shrinks effective fixed widths at 520 and restores the stored wide layout", () => {
    const storage = memoryStorage()
    const wide = resizeColumnPreferences(
      DEFAULT_COLUMN_PREFERENCES,
      "commit",
      426,
      PANEL_WIDE,
    )
    expect(wide.commit).toBe(500)
    expect(wide.description).toBe(210)
    expect(wide.author).toBe(118)
    expect(writeColumnPreferences(wide, storage)).toBe(true)

    const saved = readColumnPreferences(storage)
    expect(saved.commit).toBe(500)

    const wideLayout = layout(saved, PANEL_WIDE)
    expect(wideLayout.visibility.date).toBe(true)
    expect(wideLayout.visibility.author).toBe(false)
    expect(wideLayout.widths.commit).toBe(500)
    expect(wideLayout.widths.description).toBe(210)
    expect(visibleTotal(wideLayout)).toBe(PANEL_WIDE)

    // The stored commit width is impossible at 520. Date/author are already
    // hidden; graph and commit share the remaining budget.
    const narrow = layout(saved, PANEL_NARROW)
    expect(narrow.visibility.date).toBe(false)
    expect(narrow.visibility.author).toBe(false)
    expect(narrow.satisfied).toBe(true)
    expect(narrow.widths.graph).toBe(200)
    expect(narrow.widths.commit).toBe(200)
    expect(narrow.widths.description).toBe(120)
    expect(visibleTotal(narrow)).toBe(PANEL_NARROW)
    expect(narrow.gridTemplate).toBe("200px minmax(120px, 1fr) 200px")

    // Widening again must use the untouched stored preference, not the
    // effective widths from the narrow pass.
    const restored = layout(saved, PANEL_WIDE)
    expect(restored.widths.commit).toBe(500)
    expect(restored.widths.description).toBe(210)
    expect(restored.gridTemplate).toBe(wideLayout.gridTemplate)
    expect(saved.commit).toBe(500)
  })

  it("handles huge finite date/author/commit values and an application-owned graph", () => {
    const huge: ColumnPreferences = {
      graph: 9999,
      description: 9999,
      date: 5000,
      author: 5000,
      commit: 5000,
    }
    const normalized = normalizeColumnPreferences(huge)
    expect(normalized.graph).toBe(240)
    expect(normalized.date).toBe(5000)
    expect(normalized.author).toBe(5000)
    expect(normalized.commit).toBe(5000)

    const wide = layout(normalized, PANEL_WIDE)
    expect(wide.satisfied).toBe(true)
    expect(wide.visibility.date).toBe(false)
    expect(wide.visibility.author).toBe(false)
    expect(visibleTotal(wide)).toBe(PANEL_WIDE)
    expect(wide.widths.graph).toBe(240)
    expect(wide.widths.commit).toBe(740)
    expect(wide.widths.description).toBe(120)
    expect(wide.gridTemplate.startsWith(`${wide.widths.graph}px `)).toBe(true)

    const narrow = layout(normalized, PANEL_NARROW)
    expect(narrow.satisfied).toBe(true)
    expect(visibleTotal(narrow)).toBe(PANEL_NARROW)
    expect(narrow.widths.description).toBe(120)
    expect(narrow.widths.graph).toBe(200)
    expect(narrow.widths.commit).toBe(200)
    expect(narrow.gridTemplate.startsWith(`${narrow.widths.graph}px `)).toBe(
      true,
    )
  })

  it("ignores graph drags while preserving other stored preferences", () => {
    const stored: ColumnPreferences = {
      ...DEFAULT_COLUMN_PREFERENCES,
      graph: 260,
      commit: 500,
    }
    const before = layout(stored, PANEL_NARROW)
    expect(before.widths.graph).toBe(200)
    expect(before.widths.commit).toBe(200)

    const next = resizeColumnPreferences(stored, "graph", -10, PANEL_NARROW)
    expect(next.graph).toBe(240)
    expect(next.commit).toBe(500)

    const after = layout(next, PANEL_NARROW)
    expect(after.widths.graph).toBe(200)
    expect(after.widths.commit).toBe(200)
    expect(visibleTotal(after)).toBe(PANEL_NARROW)
  })

  it("accepts extreme finite stored widths without overflowing", () => {
    const stored = readColumnPreferences({
      getItem: () =>
        '{"graph":1e300,"date":1e300,"author":1e300,"commit":1e300}',
    })
    expect(stored.graph).toBe(240)
    expect(stored.commit).toBe(1e300)

    const narrow = layout(stored, PANEL_NARROW)
    expect(narrow.satisfied).toBe(true)
    expect(narrow.widths.description).toBe(120)
    expect(visibleTotal(narrow)).toBe(PANEL_NARROW)
    expect(narrow.gridTemplate.startsWith(`${narrow.widths.graph}px `)).toBe(
      true,
    )
  })

  it("falls back safely when bad storage contains NaN", () => {
    expect(
      readColumnPreferences({
        getItem: () => '{"graph":NaN,"commit":NaN}',
      }),
    ).toEqual(DEFAULT_COLUMN_PREFERENCES)

    expect(
      readColumnPreferences({
        getItem: () =>
          '{"graph":null,"date":null,"author":null,"commit":null,"description":null}',
      }),
    ).toEqual(DEFAULT_COLUMN_PREFERENCES)

    expect(
      readColumnPreferences({
        getItem: () => Number.NaN as unknown as string,
      }),
    ).toEqual(DEFAULT_COLUMN_PREFERENCES)
  })
})

describe("persisted preferences", () => {
  it("round-trips valid preferences through injected storage", () => {
    const storage = memoryStorage()
    const preferences: ColumnPreferences = {
      graph: 240,
      description: 500,
      date: 150,
      author: 90,
      commit: 60,
    }
    expect(writeColumnPreferences(preferences, storage)).toBe(true)
    expect(storage.values.has(COLUMN_PREFERENCES_STORAGE_KEY)).toBe(true)
    expect(readColumnPreferences(storage)).toEqual(preferences)
  })

  it("falls back to defaults for invalid JSON, missing data and invalid fields", () => {
    const invalid = [
      "{not json",
      "null",
      "[]",
      '"hello"',
      '{"graph":null,"date":"96","author":-5,"commit":1e999,"description":0}',
    ]
    for (const raw of invalid) {
      expect(readColumnPreferences({ getItem: () => raw })).toEqual(
        DEFAULT_COLUMN_PREFERENCES,
      )
    }
    expect(readColumnPreferences({ getItem: () => null })).toEqual(
      DEFAULT_COLUMN_PREFERENCES,
    )
  })

  it("forces the graph width and clamps finite out-of-range persisted widths", () => {
    expect(
      readColumnPreferences({ getItem: () => '{"graph":10}' }),
    ).toEqual({
      ...DEFAULT_COLUMN_PREFERENCES,
      graph: 240,
    })

    expect(
      readColumnPreferences({
        getItem: () =>
          '{"graph":9999,"date":50,"author":60,"commit":40,"description":10}',
      }),
    ).toEqual({
      graph: 240,
      description: 120,
      date: 128,
      author: 80,
      commit: 56,
    })
  })

  it("never throws when storage access throws", () => {
    const throwing: ColumnPreferenceStorage = {
      getItem: () => {
        throw new Error("blocked")
      },
      setItem: () => {
        throw new Error("blocked")
      },
    }
    expect(() => readColumnPreferences(throwing)).not.toThrow()
    expect(readColumnPreferences(throwing)).toEqual(DEFAULT_COLUMN_PREFERENCES)
    expect(writeColumnPreferences(DEFAULT_COLUMN_PREFERENCES, throwing)).toBe(
      false,
    )
  })

  it("degrades gracefully without storage", () => {
    expect(readColumnPreferences(null)).toEqual(DEFAULT_COLUMN_PREFERENCES)
    expect(writeColumnPreferences(DEFAULT_COLUMN_PREFERENCES, null)).toBe(false)
  })
})

describe("immutability", () => {
  it("does not mutate input preferences during resize or resolve", () => {
    const original: ColumnPreferences = { ...DEFAULT_COLUMN_PREFERENCES }
    const next = resizeColumnPreferences(
      original,
      "graph",
      100,
      PANEL_WIDE,
    )
    expect(next).not.toBe(original)
    expect(original).toEqual(DEFAULT_COLUMN_PREFERENCES)

    const resolved = resolveColumnLayout(PANEL_WIDE, original)
    expect(resolved.widths.description).toBe(518)
    expect(original).toEqual(DEFAULT_COLUMN_PREFERENCES)
  })

  it("keeps the shared default object frozen", () => {
    expect(Object.isFrozen(DEFAULT_COLUMN_PREFERENCES)).toBe(true)
  })
})
