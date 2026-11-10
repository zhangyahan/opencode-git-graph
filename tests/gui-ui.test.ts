import { describe, expect, it } from "vitest"
import type { GitCommit, GitRepository } from "../src/shared/types.js"
import {
  DATE_COLUMN_MIN_WIDTH,
  AUTHOR_COLUMN_MIN_WIDTH,
  DETAILS_COLUMNS_MIN_WIDTH,
  detailsLayout,
  historyColumnTemplate,
  historyColumns,
  refBadgeCountForBudget,
  visibleRefCount,
} from "../src/gui/history-columns.js"
import {
  clampGraphColumnWidth,
  DEFAULT_LANE_SPACING,
  graphContentWidth,
  graphLaneSpacing,
  graphLaneX,
  graphLinePath,
  GRAPH_COLUMN_MAX_WIDTH,
  GRAPH_COLUMN_MIN_WIDTH,
  GRAPH_COLUMN_WIDTH,
  isDenseGraph,
} from "../src/gui/graph-geometry.js"
import {
  repositoryOptionLabel,
  relativeRepositoryPath,
} from "../src/gui/repository-label.js"
import { commitMatches, searchMatches } from "../src/gui/search.js"
import { findStatusFile, statusFileTarget } from "../src/gui/changes.js"
import {
  formatCommitDate,
  formatRefLabel,
  refHue,
  shortHash,
} from "../src/gui/format.js"
import {
  clampScrollOffset,
  maxScrollOffset,
  scrollTopForRow,
} from "../src/gui/scroll.js"

function commit(overrides: Partial<GitCommit> = {}): GitCommit {
  return {
    hash: "0123456789abcdef0123456789abcdef01234567",
    parents: [],
    author: "Ada Lovelace",
    authorDate: "2026-11-09T12:34:56+08:00",
    subject: "Add graph rendering",
    refs: ["main"],
    ...overrides,
  }
}

function repository(overrides: Partial<GitRepository> = {}): GitRepository {
  return {
    id: "c:/work/app",
    name: "app",
    rootPath: "C:\\work\\app",
    gitDir: "C:\\work\\app\\.git",
    type: "normal",
    branch: "main",
    head: "0123456789abcdef0123456789abcdef01234567",
    detached: false,
    changes: { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 },
    ...overrides,
  }
}

describe("history column policy", () => {
  it("hides date and author before the subject at narrow side-panel widths", () => {
    expect(historyColumns(520)).toEqual({ date: false, author: false })
    expect(historyColumns(600)).toEqual({ date: false, author: false })
  })

  it("brings date back first, then author, as the panel widens", () => {
    expect(historyColumns(DATE_COLUMN_MIN_WIDTH)).toEqual({ date: true, author: false })
    expect(historyColumns(AUTHOR_COLUMN_MIN_WIDTH - 1)).toEqual({ date: true, author: false })
    expect(historyColumns(AUTHOR_COLUMN_MIN_WIDTH)).toEqual({ date: true, author: true })
    expect(historyColumns(1100)).toEqual({ date: true, author: true })
  })

  it("builds one grid template that matches the visible columns", () => {
    expect(
      historyColumnTemplate({ graphWidth: 240, date: false, author: false }),
    ).toBe("240px minmax(0, 1fr) 74px")
    expect(
      historyColumnTemplate({ graphWidth: 240, date: true, author: false }),
    ).toBe("240px minmax(0, 1fr) 150px 74px")
    expect(
      historyColumnTemplate({ graphWidth: 240, date: true, author: true }),
    ).toBe("240px minmax(0, 1fr) 150px 118px 74px")
  })

  it("shows fewer ref badges before the subject on narrow panels", () => {
    expect(visibleRefCount(520)).toBe(1)
    expect(visibleRefCount(600)).toBe(2)
    expect(visibleRefCount(DATE_COLUMN_MIN_WIDTH)).toBe(3)
    expect(visibleRefCount(AUTHOR_COLUMN_MIN_WIDTH)).toBe(4)
  })

  it("caps ref chips by the description budget", () => {
    expect(refBadgeCountForBudget(206)).toBe(1)
    expect(refBadgeCountForBudget(518)).toBe(3)
    expect(refBadgeCountForBudget(1000)).toBe(4)
  })

  it("splits commit details vertically on narrow panels and horizontally when wide", () => {
    expect(detailsLayout(520)).toBe("rows")
    expect(detailsLayout(1100)).toBe("columns")
    expect(detailsLayout(DETAILS_COLUMNS_MIN_WIDTH)).toBe("columns")
    expect(detailsLayout(DETAILS_COLUMNS_MIN_WIDTH - 1)).toBe("rows")
  })
})

describe("graph geometry", () => {
  const options = { laneSpacing: 14, rowHeight: 28, padding: 8 }

  it("keeps lane centres on a fixed step instead of compressing them", () => {
    expect(graphLaneX(0, 14, 8)).toBe(15)
    expect(graphLaneX(1, 14, 8)).toBe(29)
    expect(graphLaneX(10, 14, 8)).toBe(155)
  })

  it("sizes the lane field from the lane count and never below one lane", () => {
    expect(graphContentWidth(1, 14, 8)).toBe(30)
    expect(graphContentWidth(172, 14, 8)).toBe(2424)
    expect(graphContentWidth(0, 14, 8)).toBe(30)
  })

  it("draws vertical tracks as lines and lane changes as cubic Beziers", () => {
    expect(
      graphLinePath(
        { kind: "through", from: { lane: 1, y: 0 }, to: { lane: 1, y: 1 }, colour: 1 },
        options,
      ),
    ).toBe("M 29 0 L 29 28")
    expect(
      graphLinePath(
        { kind: "outgoing", from: { lane: 0, y: 0.5 }, to: { lane: 1, y: 1 }, colour: 1 },
        options,
      ),
    ).toBe("M 15 14 C 15 21, 29 21, 29 28")
  })

  it("clamps the graph column to its application-owned range", () => {
    expect(clampGraphColumnWidth(10)).toBe(GRAPH_COLUMN_MIN_WIDTH)
    expect(clampGraphColumnWidth(9999)).toBe(GRAPH_COLUMN_MAX_WIDTH)
    expect(clampGraphColumnWidth(Number.NaN)).toBe(GRAPH_COLUMN_WIDTH)
    expect(clampGraphColumnWidth(171.6)).toBe(172)
  })

  it("keeps 14px for common lane counts and fits every edge in the fixed column", () => {
    expect(graphLaneSpacing(GRAPH_COLUMN_WIDTH, 15, 8)).toBe(DEFAULT_LANE_SPACING)
    expect(graphLaneSpacing(GRAPH_COLUMN_WIDTH, 1, 8)).toBe(DEFAULT_LANE_SPACING)
    const dense = graphLaneSpacing(GRAPH_COLUMN_WIDTH, 172, 8)
    expect(dense).toBeLessThan(2)
    expect(isDenseGraph(dense)).toBe(true)
    const lastLane = 171
    expect(graphLaneX(lastLane, dense, 8) + dense / 2).toBeLessThanOrEqual(
      GRAPH_COLUMN_WIDTH - 8,
    )
  })
})

describe("repository option labels", () => {
  it("keeps a unique repository name short", () => {
    const app = repository()
    expect(repositoryOptionLabel(app, [app], "C:\\work")).toBe("app")
  })

  it("disambiguates same-named repositories with their relative path", () => {
    const first = repository({ id: "c:/work/app", rootPath: "C:\\work\\app" })
    const second = repository({
      id: "c:/work/packages/app",
      rootPath: "C:\\work\\packages\\app",
    })
    expect(repositoryOptionLabel(first, [first, second], "C:\\work")).toBe("app")
    expect(repositoryOptionLabel(second, [first, second], "C:\\work")).toBe("packages/app")
  })

  it("marks worktrees and submodules", () => {
    const worktree = repository({ type: "worktree", name: "app" })
    const submodule = repository({ type: "submodule", name: "lib" })
    expect(repositoryOptionLabel(worktree, [worktree], "C:\\work")).toBe("app (worktree)")
    expect(repositoryOptionLabel(submodule, [submodule], "C:\\work")).toBe("lib (submodule)")
  })

  it("computes relative paths without node:path", () => {
    expect(relativeRepositoryPath("C:\\work", "C:\\work\\packages\\app")).toBe("packages/app")
    expect(relativeRepositoryPath("/work", "/work/app")).toBe("app")
    expect(relativeRepositoryPath("/work", "/other/app")).toBe("/other/app")
    expect(relativeRepositoryPath("", "/work/app")).toBe("/work/app")
  })
})

describe("loaded commit search", () => {
  it("matches subject, hash, author and refs case-insensitively", () => {
    const entry = commit()
    expect(commitMatches(entry, "GRAPH")).toBe(true)
    expect(commitMatches(entry, "012345")).toBe(true)
    expect(commitMatches(entry, "ada")).toBe(true)
    expect(commitMatches(entry, "MAIN")).toBe(true)
    expect(commitMatches(entry, "missing")).toBe(false)
    expect(commitMatches(entry, "   ")).toBe(true)
  })

  it("returns null for an empty query so no row is dimmed", () => {
    expect(searchMatches([commit()], "")).toBeNull()
    expect(searchMatches([commit()], "   ")).toBeNull()
  })

  it("returns only matching hashes without changing the commit list", () => {
    const first = commit({ hash: "a".repeat(40), subject: "alpha" })
    const second = commit({ hash: "b".repeat(40), subject: "beta" })
    const commits = [first, second]
    const matches = searchMatches(commits, "alpha")
    expect(matches?.size).toBe(1)
    expect(matches?.has(first.hash)).toBe(true)
    expect(matches?.has(second.hash)).toBe(false)
    expect(commits[0]).toBe(first)
    expect(commits[1]).toBe(second)
  })
})

describe("status file selection", () => {
  const files = [
    { path: "src/a.ts", status: "modified" as const, staged: true },
    { path: "src/a.ts", status: "modified" as const, staged: false },
    { path: "src/new.ts", status: "untracked" as const, staged: false },
    { path: "src/both.ts", status: "conflicted" as const, staged: true },
  ]

  it("finds the index and working-tree entry for the same path independently", () => {
    expect(findStatusFile(files, "src/a.ts", "index")).toBe(files[0])
    expect(findStatusFile(files, "src/a.ts", "working-tree")).toBe(files[1])
    expect(statusFileTarget(files[0]!)).toEqual({ type: "index" })
    expect(statusFileTarget(files[1]!)).toEqual({ type: "working-tree" })
  })

  it("opens untracked and conflicted entries from the working tree", () => {
    expect(statusFileTarget(files[2]!)).toEqual({ type: "working-tree" })
    expect(statusFileTarget(files[3]!)).toEqual({ type: "working-tree" })
    expect(findStatusFile(files, "missing.ts", "index")).toBeUndefined()
  })
})

describe("scroll clamping", () => {
  const ROWS = 200
  const ROW_HEIGHT = 28
  const CONTENT = ROWS * ROW_HEIGHT
  const VIEWPORT = 400
  const MAX = CONTENT - VIEWPORT

  it("clamps a row jump to the real list range so the virtual window never points past the end", () => {
    expect(scrollTopForRow(100, ROW_HEIGHT, CONTENT, VIEWPORT)).toBe(2_800)
    expect(scrollTopForRow(195, ROW_HEIGHT, CONTENT, VIEWPORT)).toBe(MAX)
    expect(scrollTopForRow(199, ROW_HEIGHT, CONTENT, VIEWPORT)).toBe(MAX)
    expect(scrollTopForRow(0, ROW_HEIGHT, CONTENT, VIEWPORT)).toBe(0)
  })

  it("clamps horizontal offsets to the real graph viewport width", () => {
    expect(maxScrollOffset(226, 152)).toBe(74)
    expect(clampScrollOffset(100, 226, 152)).toBe(74)
    expect(clampScrollOffset(50, 226, 152)).toBe(50)
    expect(clampScrollOffset(0, 226, 152)).toBe(0)
  })

  it("handles non-finite, negative and oversized measurements", () => {
    expect(maxScrollOffset(100, 200)).toBe(0)
    expect(maxScrollOffset(Number.NaN, 152)).toBe(0)
    expect(clampScrollOffset(-5, 226, 152)).toBe(0)
    expect(clampScrollOffset(Number.NaN, 226, 152)).toBe(0)
    expect(scrollTopForRow(-3, ROW_HEIGHT, CONTENT, VIEWPORT)).toBe(0)
  })
})

describe("commit formatting", () => {
  it("formats dates without locale or time-zone state", () => {
    const value = formatCommitDate("2026-11-09T12:34:56+08:00")
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    expect(value).not.toContain("T")
    expect(value).not.toContain("+")
    expect(formatCommitDate("not a date")).toBe("not a date")
    expect(formatCommitDate("")).toBe("")
  })

  it("shortens hashes and friendly ref labels", () => {
    expect(shortHash("0123456789abcdef")).toBe("0123456")
    expect(shortHash(undefined)).toBe("")
    expect(formatRefLabel("HEAD -> main")).toBe("HEAD → main")
    expect(formatRefLabel("origin/main")).toBe("origin/main")
  })

  it("derives a stable badge hue from a ref name", () => {
    expect(refHue("main")).toBe(refHue("main"))
    expect(refHue("main")).toBeGreaterThanOrEqual(0)
    expect(refHue("main")).toBeLessThan(360)
  })
})
