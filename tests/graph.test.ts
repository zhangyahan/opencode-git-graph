import { describe, expect, it } from "vitest"
import {
  layoutGraph,
  type GraphRow,
  type LayoutCommit,
} from "../src/server/graph/layout.js"

function c(hash: string, parents: string[] = []): LayoutCommit {
  return { hash, parents, refs: [] }
}

/**
 * Follow one commit's parent edge through the per-row segments.
 *
 * A position is the lane entering a row from the gap above it. When that lane
 * equals a row's node lane, the path has hit a commit node: it succeeds only
 * for the expected parent, otherwise the line would cross an unrelated node.
 */
function reachesParent(
  rows: GraphRow[],
  startRow: number,
  parentHash: string,
  parentRow: number,
): boolean {
  const queue: Array<{ row: number; lane: number }> = []
  for (const segment of rows[startRow].segments) {
    if (segment.from === rows[startRow].lane) {
      queue.push({ row: startRow + 1, lane: segment.to })
    }
  }

  const seen = new Set<string>()
  while (queue.length > 0) {
    const position = queue.shift() as { row: number; lane: number }
    if (position.row > parentRow) continue
    const row = rows[position.row]
    if (row === undefined) continue

    if (row.lane === position.lane) {
      if (row.commit.hash === parentHash) return true
      // Reached an unrelated commit node: this path is invalid.
      continue
    }

    const key = `${position.row}:${position.lane}`
    if (seen.has(key)) continue
    seen.add(key)

    for (const segment of row.segments) {
      if (segment.from === position.lane) {
        queue.push({ row: position.row + 1, lane: segment.to })
      }
    }
  }

  return false
}

/**
 * Structural checks shared by every fixture: row order, lane/colour validity,
 * last-row emptiness, and BFS connectivity for every known parent.
 */
function assertLayout(commits: LayoutCommit[], rows: GraphRow[]): void {
  expect(rows).toHaveLength(commits.length)
  const rowOf = new Map<string, number>()
  commits.forEach((commit, index) => rowOf.set(commit.hash, index))

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]
    expect(row.commit).toBe(commits[i])
    expect(Number.isInteger(row.lane)).toBe(true)
    expect(row.lane).toBeGreaterThanOrEqual(0)
    expect(row.colour).toBe(row.lane)
    expect(row.lanes).toBeGreaterThan(row.lane)

    if (i === rows.length - 1) {
      expect(row.segments).toEqual([])
    }

    for (const segment of row.segments) {
      expect(Number.isInteger(segment.from)).toBe(true)
      expect(Number.isInteger(segment.to)).toBe(true)
      expect(Number.isInteger(segment.colour)).toBe(true)
      expect(segment.from).toBeGreaterThanOrEqual(0)
      expect(segment.to).toBeGreaterThanOrEqual(0)
      expect(segment.from).toBeLessThan(row.lanes)
      expect(segment.to).toBeLessThan(row.lanes)
      // Every emitted track is coloured by its target lane; colours are
      // therefore stable along a track and reusable after the lane is freed.
      expect(segment.colour).toBe(segment.to)
    }
  }

  for (let i = 0; i < rows.length; i += 1) {
    for (const parentHash of rows[i].commit.parents) {
      const parentRow = rowOf.get(parentHash)
      if (parentRow === undefined) continue // unknown parent outside the window
      expect(parentRow).toBeGreaterThan(i)
      expect(reachesParent(rows, i, parentHash, parentRow)).toBe(true)
    }
  }
}

describe("layoutGraph", () => {
  it("keeps a linear newest-first history on one lane", () => {
    const commits = [
      c("e5", ["d4"]),
      c("d4", ["c3"]),
      c("c3", ["b2"]),
      c("b2", ["a1"]),
      c("a1"),
    ]

    const rows = layoutGraph(commits)
    assertLayout(commits, rows)

    rows.forEach((row, i) => {
      expect(row.lane).toBe(0)
      expect(row.colour).toBe(0)
      if (i === rows.length - 1) {
        expect(row.segments).toEqual([])
      } else {
        expect(row.segments).toEqual([{ from: 0, to: 0, colour: 0 }])
      }
    })
  })

  it("places a forked branch on its own lane and rejoins it at the fork point", () => {
    // Newest → oldest: f2 → f1 → m1, m2 → m1, m1 → m0.
    const commits = [
      c("f2", ["f1"]),
      c("f1", ["m1"]),
      c("m2", ["m1"]),
      c("m1", ["m0"]),
      c("m0"),
    ]

    const rows = layoutGraph(commits)
    assertLayout(commits, rows)

    const branchLane = rows[0].lane
    expect(rows[1].lane).toBe(branchLane)
    expect(rows[2].lane).not.toBe(branchLane)
    expect(rows[3].lane).toBe(branchLane)

    // m2 leaves its temporary lane and joins the existing m1 target track.
    expect(rows[2].segments).toContainEqual({
      from: rows[2].lane,
      to: rows[3].lane,
      colour: rows[3].lane,
    })
  })

  it("models a two-parent merge with one segment per parent edge", () => {
    // m6 merges c5 and f4; f4 → f3 → b2 and c5 → b2; b2 → a1.
    const commits = [
      c("m6", ["c5", "f4"]),
      c("c5", ["b2"]),
      c("f4", ["f3"]),
      c("f3", ["b2"]),
      c("b2", ["a1"]),
      c("a1"),
    ]

    const rows = layoutGraph(commits)
    assertLayout(commits, rows)

    const merge = rows[0]
    expect(merge.lane).toBe(rows[1].lane)
    const mergeEdges = merge.segments.filter((segment) => segment.from === merge.lane)
    expect(mergeEdges).toHaveLength(2)
    expect(mergeEdges.map((segment) => segment.to)).toEqual([
      rows[1].lane,
      rows[2].lane,
    ])
    expect(rows[1].lane).not.toBe(rows[2].lane)
  })

  it("models an octopus merge with three parent edges", () => {
    // m5 merges b2, c3 and d4; each of them descends to a1.
    const commits = [
      c("m5", ["b2", "c3", "d4"]),
      c("d4", ["a1"]),
      c("c3", ["a1"]),
      c("b2", ["a1"]),
      c("a1"),
    ]

    const rows = layoutGraph(commits)
    assertLayout(commits, rows)

    const merge = rows[0]
    const mergeEdges = merge.segments.filter((segment) => segment.from === merge.lane)
    expect(mergeEdges).toHaveLength(3)
    expect(mergeEdges.map((segment) => segment.to)).toEqual([
      rows[3].lane,
      rows[2].lane,
      rows[1].lane,
    ])
    expect(new Set(mergeEdges.map((segment) => segment.to)).size).toBe(3)
  })

  it("handles criss-cross merges without assuming unique segment endpoints", () => {
    // m6 = merge(d4, e5), d4 = merge(b2, c3), e5 = merge(c3, b2),
    // b2/c3 both descend to a1.
    const commits = [
      c("m6", ["d4", "e5"]),
      c("d4", ["b2", "c3"]),
      c("e5", ["c3", "b2"]),
      c("b2", ["a1"]),
      c("c3", ["a1"]),
      c("a1"),
    ]

    const rows = layoutGraph(commits)
    assertLayout(commits, rows)

    expect(rows[0].segments.filter((segment) => segment.from === rows[0].lane)).toHaveLength(2)
    expect(rows[1].segments.filter((segment) => segment.from === rows[1].lane)).toHaveLength(2)
    expect(rows[2].segments.filter((segment) => segment.from === rows[2].lane)).toHaveLength(2)

    // Multiple branches merge into a1 from different lanes.
    const a1Incoming = rows
      .slice(0, 5)
      .flatMap((row) => row.segments)
      .filter((segment) => segment.to === rows[5].lane)
    expect(a1Incoming.length).toBeGreaterThan(1)
  })

  it("supports multiple disconnected roots and reuses the freed lane/colour", () => {
    const commits = [c("r3"), c("r2"), c("r1")]

    const rows = layoutGraph(commits)
    assertLayout(commits, rows)

    for (const row of rows) {
      expect(row.segments).toEqual([])
      expect(row.lane).toBe(0)
      expect(row.colour).toBe(0)
      expect(row.lanes).toBe(1)
    }
  })

  it("keeps unknown-parent tracks alive until the bottom of the window", () => {
    const commits = [
      c("a1", ["ghost"]), // ghost is outside this page/window
      c("b2", ["c3"]),
      c("c3"),
      c("d4"), // forces a released lane to be reused while ghost stays active
    ]

    const rows = layoutGraph(commits)
    assertLayout(commits, rows)

    const ghostLane = rows[0].lane
    expect(rows[0].segments).toContainEqual({
      from: ghostLane,
      to: ghostLane,
      colour: ghostLane,
    })
    // The ghost track still crosses the b2 and c3 rows.
    expect(rows[1].segments).toContainEqual({
      from: ghostLane,
      to: ghostLane,
      colour: ghostLane,
    })
    expect(rows[2].segments).toContainEqual({
      from: ghostLane,
      to: ghostLane,
      colour: ghostLane,
    })
    expect(rows[3].segments).toEqual([])
  })

  it("reuses colours after their lanes end", () => {
    const commits = [
      c("f2", ["f1"]),
      c("g2", ["g1"]),
      c("f1", ["base"]),
      c("g1", ["base"]),
      c("base"),
      c("n1", ["n0"]),
      c("n2", ["n0"]),
      c("n0"),
    ]

    const rows = layoutGraph(commits)
    assertLayout(commits, rows)

    // Branches f and g use lanes 0 and 1; after they end, two new roots reuse
    // exactly those lanes and colours.
    expect(rows[0].lane).toBe(0)
    expect(rows[1].lane).toBe(1)
    expect(rows[5].lane).toBe(0)
    expect(rows[6].lane).toBe(1)
    expect(rows[0].colour).toBe(rows[2].colour)
    expect(rows[1].colour).toBe(rows[3].colour)
    expect(rows[5].colour).toBe(0)
    expect(rows[6].colour).toBe(1)
    expect(new Set(rows.map((row) => row.colour))).toEqual(new Set([0, 1]))
  })

  it("is deterministic and does not mutate the input", () => {
    const commits = [
      c("m6", ["c5", "f4"]),
      c("c5", ["b2"]),
      c("f4", ["f3"]),
      c("f3", ["b2"]),
      c("b2", ["a1"]),
      c("a1"),
    ]
    const snapshot = JSON.stringify(commits)

    const first = layoutGraph(commits)
    const second = layoutGraph(commits)

    expect(JSON.stringify(commits)).toBe(snapshot)
    expect(second).toEqual(first)
  })

  it("rejects duplicate commit hashes", () => {
    expect(() => layoutGraph([c("a1"), c("a1")])).toThrow(/duplicate/i)
  })

  it("rejects parents that appear on the same or an earlier (newer) row", () => {
    expect(() => layoutGraph([c("a1", ["a1"])])).toThrow(/topological/i)
    expect(() =>
      layoutGraph([c("a1", ["b2"]), c("b2", ["c3"]), c("c3", ["a1"])]),
    ).toThrow(/topological/i)
  })

  it("accepts a known parent on a later row and unknown parents", () => {
    const commits = [c("child", ["parent", "outside"]), c("parent")]
    expect(() => layoutGraph(commits)).not.toThrow()
  })

  it("keeps every edge of the same DAG but stays compact when merges interleave with side commits", () => {
    const sideCount = 150

    // One DAG with two valid newest-first topological orders. Each merge m_i
    // joins the next mainline commit m_{i+1} and side commit s_{i+1}; every side
    // commit descends straight to the shared root.
    const mergeFirst: LayoutCommit[] = []
    for (let i = 0; i < sideCount; i += 1) {
      mergeFirst.push(c(`m${i}`, [`m${i + 1}`, `s${i + 1}`]))
    }
    mergeFirst.push(c(`m${sideCount}`, ["base"]))
    for (let i = 1; i <= sideCount; i += 1) {
      mergeFirst.push(c(`s${i}`, ["base"]))
    }
    mergeFirst.push(c("base"))

    // Same DAG, but each side commit sits immediately after the merge that
    // introduced it, so its target track is closed again right away.
    const interleaved: LayoutCommit[] = []
    for (let i = 0; i < sideCount; i += 1) {
      interleaved.push(c(`m${i}`, [`m${i + 1}`, `s${i + 1}`]))
      interleaved.push(c(`s${i + 1}`, ["base"]))
    }
    interleaved.push(c(`m${sideCount}`, ["base"]))
    interleaved.push(c("base"))

    const snapshot = (commits: LayoutCommit[]) =>
      commits
        .map((commit) => ({ hash: commit.hash, parents: [...commit.parents].sort() }))
        .sort((left, right) => left.hash.localeCompare(right.hash))
    expect(snapshot(interleaved)).toEqual(snapshot(mergeFirst))

    const wide = layoutGraph(mergeFirst)
    const narrow = layoutGraph(interleaved)
    assertLayout(mergeFirst, wide)
    assertLayout(interleaved, narrow)

    const maxLanes = (rows: GraphRow[]): number =>
      Math.max(...rows.map((row) => row.lanes))
    const parentEdges = (commits: LayoutCommit[]): number =>
      commits.reduce((total, commit) => total + commit.parents.length, 0)
    const emittedEdges = (rows: GraphRow[]): number =>
      rows.reduce(
        (total, row) =>
          total + row.segments.filter((segment) => segment.from === row.lane).length,
        0,
      )

    // No parent edge is dropped in either order: every edge becomes exactly one
    // outgoing segment, and connectivity is checked by assertLayout.
    expect(emittedEdges(wide)).toBe(parentEdges(mergeFirst))
    expect(emittedEdges(narrow)).toBe(parentEdges(interleaved))
    expect(parentEdges(mergeFirst)).toBe(parentEdges(interleaved))

    // Listing all merges before their side commits keeps ~one lane per merge
    // open; interleaving closes each side track immediately.
    expect(maxLanes(wide)).toBe(sideCount + 1)
    expect(maxLanes(narrow)).toBeLessThanOrEqual(4)
  })

  it("lays out 5000 commits of dense, deterministic history within 3 seconds", () => {
    const count = 5_000
    let seed = 0x9e3779b9
    const random = (): number => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0
      return seed / 0x1_0000_0000
    }

    const commits: LayoutCommit[] = []
    for (let i = 0; i < count; i += 1) {
      const parents: string[] = []
      if (i + 1 < count) parents.push(`h${i + 1}`)
      const extraCount = i + 1 < count ? 1 + Math.floor(random() * 2) : 0
      for (let extra = 0; extra < extraCount; extra += 1) {
        const span = Math.min(60, count - i - 1)
        if (span <= 0) break
        const parent = `h${i + 1 + Math.floor(random() * span)}`
        if (!parents.includes(parent)) parents.push(parent)
      }
      commits.push({
        hash: `h${i}`,
        parents,
        refs: i % 250 === 0 ? [`refs/tags/t${i}`] : [],
      })
    }

    const started = performance.now()
    const rows = layoutGraph(commits)
    const elapsed = performance.now() - started

    expect(rows).toHaveLength(count)
    expect(rows[count - 1].segments).toEqual([])

    let segments = 0
    for (const row of rows) {
      segments += row.segments.length
      for (const segment of row.segments) {
        expect(segment.to).toBeLessThan(row.lanes)
      }
    }

    console.log(
      `[layoutGraph perf] ${count} commits, ${segments} segments, ${elapsed.toFixed(1)} ms`,
    )
    expect(elapsed).toBeLessThan(3_000)
  })
})
