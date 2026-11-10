import { describe, expect, it } from "vitest"
import type { ChangedFile } from "../src/shared/types.js"
import { classifyDiff } from "../src/gui/diff.js"
import {
  buildFileTree,
  collectDirectoryPaths,
  type FileTreeDirectory,
} from "../src/gui/tree.js"
import { computeVirtualRange } from "../src/gui/virtual.js"
import { mergeCommits } from "../src/gui/pagination.js"
import {
  AUTO_LOAD_THRESHOLD_ROWS,
  INITIAL_AUTO_LOAD_STATE,
  beginAutoLoad,
  completeAutoLoad,
  isNearBottom,
  rearmAutoLoad,
  resolveScrollMetrics,
  shouldAutoLoad,
} from "../src/gui/pagination.js"
import {
  BoundedSelectionCache,
  SelectionGeneration,
  selectionKey,
} from "../src/gui/selection.js"
import { groupStatusFiles, statusFileTarget } from "../src/gui/changes.js"

function file(path: string, status: ChangedFile["status"], staged = false): ChangedFile {
  return { path, status, staged }
}

describe("buildFileTree", () => {
  it("nests directories, sorts directories before files and counts subtree files", () => {
    const files = [
      file("src/z.ts", "modified"),
      file("README.md", "modified"),
      file("src/a.ts", "added", true),
      file("src/components/b.ts", "deleted", true),
      file("docs/guide/intro.md", "modified"),
    ]

    const snapshot = JSON.stringify(files)
    const tree = buildFileTree(files)

    expect(JSON.stringify(files)).toBe(snapshot)
    expect(tree.map((node) => node.name)).toEqual(["docs", "src", "README.md"])

    const src = tree[1] as FileTreeDirectory
    expect(src.kind).toBe("directory")
    expect(src.fileCount).toBe(3)
    expect(src.children.map((node) => node.name)).toEqual(["components", "a.ts", "z.ts"])

    const docs = tree[0] as FileTreeDirectory
    expect(docs.fileCount).toBe(1)
    expect(docs.children[0]?.kind).toBe("directory")

    expect(collectDirectoryPaths(tree)).toEqual([
      "docs",
      "docs/guide",
      "src",
      "src/components",
    ])
  })

  it("ignores duplicate paths after the first occurrence", () => {
    const tree = buildFileTree([
      file("src/a.ts", "modified", true),
      file("src/a.ts", "modified", false),
    ])

    const src = tree[0] as FileTreeDirectory
    expect(src.fileCount).toBe(1)
    expect(src.children).toHaveLength(1)
    expect((src.children[0] as { file: ChangedFile }).file.staged).toBe(true)
  })
})

describe("classifyDiff", () => {
  it("distinguishes file headers, hunks, additions, removals and context", () => {
    const text = [
      "diff --git a/a.ts b/a.ts",
      "index 1111111..2222222 100644",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,2 +1,3 @@",
      " context line",
      "-old line",
      "+new line",
      "+++not a header inside a hunk",
      "",
    ].join("\n")

    const lines = classifyDiff(text)
    expect(lines.map((line) => line.kind)).toEqual([
      "meta",
      "meta",
      "meta",
      "meta",
      "hunk",
      "context",
      "remove",
      "add",
      "add",
    ])
    expect(lines[8]?.text).toBe("+++not a header inside a hunk")
  })

  it("classifies empty interior lines separately", () => {
    const lines = classifyDiff(["diff --git a/a b/a", "@@ -1 +1 @@", "", "+a"].join("\n"))
    expect(lines.map((line) => line.kind)).toEqual(["meta", "hunk", "empty", "add"])
  })

  it("treats ---/+++ inside a hunk as removed/added content", () => {
    const lines = classifyDiff(
      ["diff --git a/a b/a", "@@ -1 +1 @@", "---content", "+++content"].join("\n"),
    )
    expect(lines.slice(2).map((line) => line.kind)).toEqual(["remove", "add"])
  })

  it("returns no lines for empty text and marks no-newline notes as metadata", () => {
    expect(classifyDiff("")).toEqual([])
    const lines = classifyDiff(
      ["diff --git a/a b/a", "@@ -1 +1 @@", "-a", "\\ No newline at end of file", "+b"].join("\n"),
    )
    expect(lines[3]?.kind).toBe("meta")
  })
})

describe("computeVirtualRange", () => {
  it("adds overscan around the visible rows", () => {
    expect(
      computeVirtualRange({
        scrollTop: 0,
        viewportHeight: 60,
        rowHeight: 20,
        total: 100,
        overscan: 2,
      }),
    ).toEqual({ start: 0, end: 5 })
  })

  it("clamps to the content when scrolled near the bottom", () => {
    expect(
      computeVirtualRange({
        scrollTop: 205,
        viewportHeight: 60,
        rowHeight: 20,
        total: 100,
        overscan: 2,
      }),
    ).toEqual({ start: 8, end: 16 })
  })

  it("handles empty, negative and over-scrolled inputs", () => {
    expect(
      computeVirtualRange({
        scrollTop: -50,
        viewportHeight: 0,
        rowHeight: 20,
        total: 0,
        overscan: 2,
      }),
    ).toEqual({ start: 0, end: 0 })
    expect(
      computeVirtualRange({
        scrollTop: 100_000,
        viewportHeight: 60,
        rowHeight: 20,
        total: 100,
        overscan: 2,
      }),
    ).toEqual({ start: 100, end: 100 })
  })

  it("renders every row when the viewport is taller than the content", () => {
    expect(
      computeVirtualRange({
        scrollTop: 0,
        viewportHeight: 1_000,
        rowHeight: 20,
        total: 3,
        overscan: 2,
      }),
    ).toEqual({ start: 0, end: 3 })
  })
})

describe("mergeCommits", () => {
  it("appends unseen commits in order and de-duplicates by hash", () => {
    const a = { hash: "a" }
    const b = { hash: "b" }
    const c = { hash: "c" }
    const d = { hash: "d" }

    expect(mergeCommits([a, b], [b, c, a, d])).toEqual([a, b, c, d])
    expect(mergeCommits([], [a, a, b])).toEqual([a, b])
    expect(mergeCommits([], [])).toEqual([])
  })

  it("keeps existing commit objects referentially stable", () => {
    const a = { hash: "a" }
    const merged = mergeCommits([a], [{ hash: "a" }])
    expect(merged[0]).toBe(a)
  })
})

describe("automatic load more", () => {
  const armed = { ...INITIAL_AUTO_LOAD_STATE }
  const base = {
    state: armed,
    nearBottom: true,
    hasMore: true,
    busy: false,
    loadingMore: false,
    graphError: false,
    historyActive: true,
  }

  it("allows one page when the viewport reaches the bottom", () => {
    expect(shouldAutoLoad(base)).toBe(true)
    expect(AUTO_LOAD_THRESHOLD_ROWS).toBeGreaterThanOrEqual(2)
    expect(AUTO_LOAD_THRESHOLD_ROWS).toBeLessThanOrEqual(4)
  })

  it("does not trigger while busy, loading, exhausted, failing or inactive", () => {
    expect(shouldAutoLoad({ ...base, hasMore: false })).toBe(false)
    expect(shouldAutoLoad({ ...base, busy: true })).toBe(false)
    expect(shouldAutoLoad({ ...base, loadingMore: true })).toBe(false)
    expect(shouldAutoLoad({ ...base, graphError: true })).toBe(false)
    expect(shouldAutoLoad({ ...base, historyActive: false })).toBe(false)
    expect(shouldAutoLoad({ ...base, nearBottom: false })).toBe(false)
  })

  it("does not start twice in the same bottom visit", () => {
    const started = beginAutoLoad(armed)
    expect(shouldAutoLoad({ ...base, state: started })).toBe(false)

    // A successful page keeps the visit armed, so an under-filled viewport
    // cannot pull the whole repository in a tight loop.
    const loaded = completeAutoLoad(started, { added: 100, failed: false, cancelled: false })
    expect(shouldAutoLoad({ ...base, state: loaded })).toBe(false)

    // Leaving the bottom (or Retry) re-arms the guard.
    const rearmed = rearmAutoLoad(loaded)
    expect(shouldAutoLoad({ ...base, state: rearmed })).toBe(true)
  })

  it("locks after an automatic failure until the viewport leaves the bottom", () => {
    const started = beginAutoLoad(armed)
    const failed = completeAutoLoad(started, { added: 0, failed: true, cancelled: false })
    expect(failed.failed).toBe(true)
    expect(shouldAutoLoad({ ...base, state: failed })).toBe(false)

    // A manual retry re-arms everything.
    expect(rearmAutoLoad(failed)).toEqual(INITIAL_AUTO_LOAD_STATE)
  })

  it("stops automatic loading when a page adds no new commits", () => {
    const started = beginAutoLoad(armed)
    const duplicate = completeAutoLoad(started, {
      added: 0,
      failed: false,
      cancelled: false,
    })
    expect(duplicate.stalled).toBe(true)
    expect(shouldAutoLoad({ ...base, state: duplicate })).toBe(false)

    const empty = completeAutoLoad(started, { added: 0, failed: false, cancelled: false })
    expect(empty.stalled).toBe(true)
    expect(shouldAutoLoad({ ...base, state: empty })).toBe(false)
  })

  it("ignores a cancelled response so a stale request cannot overwrite newer state", () => {
    const started = beginAutoLoad(armed)
    expect(completeAutoLoad(started, { added: 0, failed: true, cancelled: true })).toBe(
      started,
    )
  })

  it("uses live container measurements when the viewport signal is stale", () => {
    // Background host tabs can freeze ResizeObserver, leaving the signal at its
    // default while the real DOM scroller already has its final size.
    const fallback = {
      scrollTop: 0,
      viewportHeight: 320,
      contentHeight: 2800,
    }
    const metrics = resolveScrollMetrics(
      { scrollTop: 2296, clientHeight: 504, scrollHeight: 2800 },
      fallback,
    )
    expect(metrics).toEqual({
      scrollTop: 2296,
      viewportHeight: 504,
      contentHeight: 2800,
    })
    expect(
      isNearBottom({
        ...metrics,
        threshold: AUTO_LOAD_THRESHOLD_ROWS * 28,
      }),
    ).toBe(true)
    // The stale signal alone would have missed the bottom.
    expect(
      isNearBottom({
        ...fallback,
        threshold: AUTO_LOAD_THRESHOLD_ROWS * 28,
      }),
    ).toBe(false)
  })

  it("falls back field by field when the scroller is detached or unsized", () => {
    const fallback = { scrollTop: 140, viewportHeight: 400, contentHeight: 1400 }
    expect(resolveScrollMetrics(undefined, fallback)).toEqual(fallback)
    expect(
      resolveScrollMetrics({ scrollTop: 0, clientHeight: 0, scrollHeight: 0 }, fallback),
    ).toEqual({ scrollTop: 0, viewportHeight: 400, contentHeight: 1400 })
    expect(
      resolveScrollMetrics(
        { scrollTop: Number.NaN, clientHeight: Number.NaN, scrollHeight: Number.NaN },
        fallback,
      ),
    ).toEqual(fallback)
    // A live scrollHeight smaller than the derived layout height cannot shrink
    // the content used for the bottom test.
    expect(
      resolveScrollMetrics({ scrollTop: -5, clientHeight: 300, scrollHeight: 100 }, fallback),
    ).toEqual({ scrollTop: 0, viewportHeight: 300, contentHeight: 1400 })
  })

  it("counts the real content height (including an expanded slot) for near-bottom", () => {
    const threshold = AUTO_LOAD_THRESHOLD_ROWS * 28
    expect(
      isNearBottom({
        scrollTop: 1_000,
        viewportHeight: 400,
        contentHeight: 1_400,
        threshold,
      }),
    ).toBe(true)
    expect(
      isNearBottom({
        scrollTop: 1_000,
        viewportHeight: 400,
        contentHeight: 1_400 + threshold + 1,
        threshold,
      }),
    ).toBe(false)
    // Content shorter than the viewport still counts as near the bottom.
    expect(
      isNearBottom({ scrollTop: 0, viewportHeight: 500, contentHeight: 100, threshold }),
    ).toBe(true)
    // Raw/negative measurements never produce a false trigger from NaN.
    expect(
      isNearBottom({
        scrollTop: Number.NaN,
        viewportHeight: Number.NaN,
        contentHeight: Number.NaN,
        threshold,
      }),
    ).toBe(true)
  })
})

describe("groupStatusFiles", () => {
  it("splits staged, unstaged, untracked and conflicted entries", () => {
    const files = [
      file("staged.ts", "added", true),
      file("unstaged.ts", "modified", false),
      file("untracked.ts", "untracked", false),
      file("conflict.ts", "conflicted", false),
      file("both.ts", "modified", true),
      file("both.ts", "modified", false),
    ]

    const groups = groupStatusFiles(files)
    expect(groups.staged.map((entry) => entry.path)).toEqual(["staged.ts", "both.ts"])
    expect(groups.unstaged.map((entry) => entry.path)).toEqual(["unstaged.ts", "both.ts"])
    expect(groups.untracked.map((entry) => entry.path)).toEqual(["untracked.ts"])
    expect(groups.conflicted.map((entry) => entry.path)).toEqual(["conflict.ts"])
    expect(statusFileTarget(files[0]!)).toEqual({ type: "index" })
    expect(statusFileTarget(files[3]!)).toEqual({ type: "working-tree" })
  })
})

describe("selection cache", () => {
  it("keeps the most recently used entries within its bound", () => {
    const cache = new BoundedSelectionCache<number>(2)
    cache.set("a", 1)
    cache.set("b", 2)
    expect(cache.get("a")).toBe(1)
    cache.set("c", 3)
    expect(cache.size).toBe(2)
    expect(cache.get("b")).toBeUndefined()
    expect(cache.get("a")).toBe(1)
    expect(cache.get("c")).toBe(3)
  })

  it("keys selections by server and directory", () => {
    expect(selectionKey("server-1", "/repo")).toBe("server-1\n/repo")
    expect(selectionKey("server-1", "/repo")).not.toBe(selectionKey("server-2", "/repo"))
  })
})

describe("SelectionGeneration", () => {
  it("invalidates a refresh snapshot after a newer user selection", () => {
    const generation = new SelectionGeneration()

    // Refresh starts with selection A.
    const refreshSnapshot = generation.current()
    expect(generation.isCurrent(refreshSnapshot)).toBe(true)

    // The user selects B while the refresh request is still in flight.
    const selectionB = generation.bump()

    expect(generation.isCurrent(refreshSnapshot)).toBe(false)
    expect(generation.isCurrent(selectionB)).toBe(true)
  })

  it("lets only the latest request own a shared loading flag", () => {
    const generation = new SelectionGeneration()
    let loading = true

    // Two loads start; the older one settles first and must not clear loading
    // that now belongs to the successor.
    const older = generation.bump()
    const newer = generation.bump()
    if (generation.isCurrent(older)) loading = false
    expect(loading).toBe(true)

    if (generation.isCurrent(newer)) loading = false
    expect(loading).toBe(false)
  })
})
