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
})
