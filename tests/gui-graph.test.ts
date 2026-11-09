import { describe, expect, it } from "vitest"
import type { GitCommit } from "../src/shared/types.js"
import { layoutGraph, type GraphRow } from "../src/server/graph/layout.js"
import { graphRowLines } from "../src/gui/graph-geometry.js"
import { createGraphRowViews, visibleGraphRowViews } from "../src/gui/graph-view.js"

describe("graphRowLines", () => {
  it("does not draw a line above a tip whose parent reuses the node lane", () => {
    const tip: GraphRow = {
      commit: { hash: "tip", parents: ["base"], refs: [] },
      lane: 0,
      colour: 0,
      segments: [{ from: 0, to: 0, colour: 0 }],
      lanes: 1,
    }

    const lines = graphRowLines(tip, undefined)
    expect(lines).toEqual([
      {
        kind: "outgoing",
        from: { lane: 0, y: 0.5 },
        to: { lane: 0, y: 1 },
        colour: 0,
      },
    ])
    expect(lines.some((line) => line.from.y === 0)).toBe(false)
  })

  it("keeps through tracks full-height and starts node edges at the node centre", () => {
    const row: GraphRow = {
      commit: { hash: "a", parents: ["b"], refs: [] },
      lane: 0,
      colour: 0,
      segments: [
        { from: 0, to: 0, colour: 0 },
        { from: 1, to: 1, colour: 1 },
      ],
      lanes: 2,
    }

    const lines = graphRowLines(row, undefined)
    expect(lines).toContainEqual({
      kind: "outgoing",
      from: { lane: 0, y: 0.5 },
      to: { lane: 0, y: 1 },
      colour: 0,
    })
    expect(lines).toContainEqual({
      kind: "through",
      from: { lane: 1, y: 0 },
      to: { lane: 1, y: 1 },
      colour: 1,
    })
    expect(lines.filter((line) => line.kind === "through")).toHaveLength(1)
  })

  it("draws incoming edges from the row top to the node centre", () => {
    const previous: GraphRow = {
      commit: { hash: "a", parents: ["b"], refs: [] },
      lane: 0,
      colour: 0,
      segments: [{ from: 0, to: 0, colour: 0 }],
      lanes: 1,
    }
    const current: GraphRow = {
      commit: { hash: "b", parents: [], refs: [] },
      lane: 0,
      colour: 0,
      segments: [],
      lanes: 1,
    }

    expect(graphRowLines(current, previous)).toEqual([
      {
        kind: "incoming",
        from: { lane: 0, y: 0 },
        to: { lane: 0, y: 0.5 },
        colour: 0,
      },
    ])
  })

  it("starts every merge parent edge at the node centre", () => {
    const merge: GraphRow = {
      commit: { hash: "m", parents: ["a", "b"], refs: [] },
      lane: 0,
      colour: 0,
      segments: [
        { from: 0, to: 1, colour: 1 },
        { from: 0, to: 2, colour: 2 },
      ],
      lanes: 3,
    }

    const lines = graphRowLines(merge, undefined)
    expect(lines).toHaveLength(2)
    for (const line of lines) {
      expect(line.kind).toBe("outgoing")
      expect(line.from).toEqual({ lane: 0, y: 0.5 })
      expect(line.to.y).toBe(1)
    }
  })
})

describe("graph row views", () => {
  const commits: GitCommit[] = [
    {
      hash: "a",
      parents: ["b"],
      author: "A",
      authorDate: "2026-01-01T00:00:00Z",
      subject: "a",
      refs: [],
    },
    {
      hash: "b",
      parents: [],
      author: "A",
      authorDate: "2026-01-01T00:00:00Z",
      subject: "b",
      refs: [],
    },
  ]

  it("reuses the same view object when the virtual window slides", () => {
    const rows = layoutGraph(commits)
    const views = createGraphRowViews(rows, commits)

    expect(views).toHaveLength(2)
    expect(views[0]?.row).toBe(rows[0])
    expect(views[0]?.commit).toBe(commits[0])
    expect(views[1]?.previous).toBe(rows[0])

    const firstWindow = visibleGraphRowViews(views, { start: 0, end: 2 })
    const secondWindow = visibleGraphRowViews(views, { start: 1, end: 2 })

    expect(secondWindow).not.toBe(firstWindow)
    expect(secondWindow[0]).toBe(firstWindow[1])
    expect(secondWindow[0]).toBe(views[1])
  })
})
