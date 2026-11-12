import { describe, expect, it } from "vitest"
import {
  BoundedPanelCache,
  PANEL_CACHE_LIMIT,
  commitFilesKey,
  deserializePanelCache,
  panelCacheKey,
  serializePanelCache,
  type PanelCacheSnapshot,
} from "../src/gui/panel-cache.js"
import { DEFAULT_HISTORY_FILTER } from "../src/gui/ref-utils.js"

function snapshot(overrides: Partial<PanelCacheSnapshot> = {}): PanelCacheSnapshot {
  return {
    repositories: [],
    selectedRepositoryId: null,
    status: null,
    commits: [],
    hasMore: false,
    nextSkip: 0,
    filters: DEFAULT_HISTORY_FILTER,
    firstParent: false,
    historyOrder: "date",
    refs: [],
    selectedCommitHash: null,
    selectedParentIndex: 0,
    expandedDirectories: [],
    commitFiles: [],
    commitFilesKey: null,
    uncommittedExpanded: false,
    collapsedGroups: [],
    inlineView: "tree",
    slotHeightOverrides: {},
    inlineInfoRatio: 0.32,
    scrollTop: 0,
    searchQuery: "",
    ...overrides,
  }
}

describe("panel cache key", () => {
  it("separates the server and directory like selectionKey", () => {
    expect(panelCacheKey("server-a", "/workspace-a")).toBe("server-a\n/workspace-a")
    expect(panelCacheKey("server-a", "/workspace-a")).not.toBe(
      panelCacheKey("server-b", "/workspace-a"),
    )
    expect(panelCacheKey("server-a", "/workspace-a")).not.toBe(
      panelCacheKey("server-a", "/workspace-b"),
    )
  })

  it("keys cached commit files by commit and parent", () => {
    expect(commitFilesKey("abc", 0)).toBe("abc\n0")
    expect(commitFilesKey("abc", 0)).not.toBe(commitFilesKey("abc", 1))
    expect(commitFilesKey("abc", 1)).not.toBe(commitFilesKey("def", 1))
  })
})

describe("BoundedPanelCache", () => {
  it("keeps at most the configured number of entries", () => {
    const cache = new BoundedPanelCache<number>(8)
    for (let index = 0; index < 12; index += 1) cache.set(`key-${index}`, index)
    expect(cache.size).toBe(8)
    expect(cache.get("key-0")).toBeUndefined()
    expect(cache.get("key-3")).toBeUndefined()
    expect(cache.get("key-4")).toBe(4)
    expect(cache.get("key-11")).toBe(11)
  })

  it("promotes on get and on overwrite", () => {
    const cache = new BoundedPanelCache<number>(2)
    cache.set("a", 1)
    cache.set("b", 2)
    cache.get("a")
    cache.set("c", 3)
    expect(cache.get("b")).toBeUndefined()
    expect(cache.get("a")).toBe(1)
    expect(cache.get("c")).toBe(3)

    cache.set("a", 10)
    cache.set("d", 4)
    expect(cache.get("c")).toBeUndefined()
    expect(cache.get("a")).toBe(10)
    expect(cache.get("d")).toBe(4)
  })

  it("defaults to the shared limit and supports clear", () => {
    const cache = new BoundedPanelCache<number>()
    expect(PANEL_CACHE_LIMIT).toBe(8)
    for (let index = 0; index < PANEL_CACHE_LIMIT; index += 1) cache.set(`${index}`, index)
    expect(cache.size).toBe(PANEL_CACHE_LIMIT)
    cache.clear()
    expect(cache.size).toBe(0)
  })
})

describe("panel cache serialization", () => {
  it("round-trips the snapshot fields used for restoration", () => {
    const original = snapshot({
      selectedRepositoryId: "/repo",
      commits: [
        {
          hash: "a".repeat(40),
          parents: [],
          author: "A",
          authorDate: "2026-01-01T00:00:00Z",
          subject: "subject",
          refs: ["main"],
        },
      ],
      hasMore: true,
      nextSkip: 1,
      filters: { refs: ["refs/heads/main"], showRemotes: false, showTags: true },
      firstParent: true,
      historyOrder: "topo",
      refs: [{ name: "main", hash: "a".repeat(40), kind: "branch" }],
      selectedCommitHash: "a".repeat(40),
      selectedParentIndex: 0,
      expandedDirectories: ["src"],
      commitFiles: [{ path: "a.ts", status: "modified", staged: false }],
      commitFilesKey: commitFilesKey("a".repeat(40), 0),
      uncommittedExpanded: true,
      collapsedGroups: ["staged"],
      inlineView: "list",
      slotHeightOverrides: { uncommitted: 240 },
      inlineInfoRatio: 0.4,
      scrollTop: 123,
      searchQuery: "fix",
    })

    const restored = deserializePanelCache(serializePanelCache(original))
    expect(restored).toEqual(original)
    expect(restored?.filters.refs).not.toBe(original.filters.refs)
    // Collapse/reopen and panel remounts must keep the expanded working-tree
    // slot and its dragged height for the session.
    expect(restored?.uncommittedExpanded).toBe(true)
    expect(restored?.slotHeightOverrides).toEqual({ uncommitted: 240 })
  })

  it("ignores malformed and incomplete data", () => {
    expect(deserializePanelCache(undefined)).toBeUndefined()
    expect(deserializePanelCache("")).toBeUndefined()
    expect(deserializePanelCache("{")).toBeUndefined()
    expect(deserializePanelCache(JSON.stringify({ repositories: [] }))).toBeUndefined()
    expect(
      deserializePanelCache(
        JSON.stringify({ ...snapshot(), inlineView: "grid" }),
      ),
    ).toBeUndefined()
  })
})
