import { describe, expect, it } from "vitest"
import type { ChangedFile, GitCommit, GitRef, GitStatus } from "../src/shared/types.js"
import {
  DEFAULT_HISTORY_FILTER,
  MAX_LOG_REFS,
  absoluteRepositoryFilePath,
  canonicalRefName,
  canViewFileAtCommit,
  changedFileStats,
  checkoutBlockedReason,
  commitMenuActions,
  decideCompareActivation,
  detectCommitFileContentSupport,
  detectRpcCapabilities,
  firstParentGraphCommits,
  filterRefsToAvailable,
  hasFileStats,
  historyFilterFingerprint,
  historyLogInput,
  isCompareModifier,
  isSizeOnlyFileContent,
  normalizeRefSelection,
  reconcileRefFilter,
  refBadgesForCommit,
  refMenuActions,
  typedRefForBadge,
  workspaceRelativePath,
  type RpcCapabilities,
} from "../src/gui/ref-utils.js"

const HASH = "a".repeat(40)

function commit(overrides: Partial<GitCommit> = {}): GitCommit {
  return {
    hash: HASH,
    parents: [],
    author: "Ada",
    authorDate: "2026-11-09T12:34:56+08:00",
    subject: "subject",
    refs: [],
    ...overrides,
  }
}

function ref(name: string, kind: GitRef["kind"], hash = HASH): GitRef {
  return { name, kind, hash }
}

const CAPS: RpcCapabilities = {
  extendedLog: true,
  comparison: true,
  checkout: true,
  createBranch: true,
  createTag: true,
  renameBranch: true,
  deleteBranch: true,
  deleteTag: true,
}

function status(overrides: Partial<GitStatus> = {}): GitStatus {
  return {
    repositoryId: "repo",
    branch: "main",
    head: HASH,
    detached: false,
    files: [],
    counts: { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 },
    ...overrides,
  }
}

describe("canonical ref names", () => {
  it("maps typed refs to the full allowlist names", () => {
    expect(canonicalRefName(ref("main", "branch"))).toBe("refs/heads/main")
    expect(canonicalRefName(ref("origin/main", "remote"))).toBe(
      "refs/remotes/origin/main",
    )
    expect(canonicalRefName(ref("v1.0.0", "tag"))).toBe("refs/tags/v1.0.0")
    expect(canonicalRefName(ref("HEAD", "head"))).toBeUndefined()
  })

  it("deduplicates, filters previews and caps explicit refs", () => {
    expect(
      normalizeRefSelection([
        "refs/heads/main",
        "refs/heads/main",
        "HEAD",
        "refs/tags/v1",
      ]),
    ).toEqual(["refs/heads/main", "refs/tags/v1"])
    const many = Array.from({ length: MAX_LOG_REFS + 5 }, (_, i) => `refs/heads/b${i}`)
    expect(normalizeRefSelection(many)).toHaveLength(MAX_LOG_REFS)
  })
})

describe("typed ref badges", () => {
  it("keeps same-name branch and tag badges distinct", () => {
    const badges = refBadgesForCommit(
      [ref("main", "branch"), ref("main", "tag")],
      commit({ refs: ["HEAD -> main", "tag: main"] }),
    )
    expect(badges.map((badge) => badge.kind)).toEqual(["branch", "tag"])
    expect(badges.map((badge) => badge.name)).toEqual(["main", "main"])
    expect(badges[0]?.canonical).toBe("refs/heads/main")
    expect(badges[1]?.canonical).toBe("refs/tags/main")
  })

  it("does not duplicate the attached branch as a synthetic HEAD badge", () => {
    const badges = refBadgesForCommit(
      [ref("main", "branch"), ref("main", "head")],
      commit({ refs: ["HEAD -> main"] }),
    )
    expect(badges).toHaveLength(1)
    expect(badges[0]?.kind).toBe("branch")
  })

  it("falls back to an unknown badge when refs have not loaded", () => {
    const badges = refBadgesForCommit([], commit({ refs: ["origin/main"] }))
    expect(badges).toEqual([
      {
        key: "unknown\0origin/main",
        name: "origin/main",
        kind: "unknown",
        hash: HASH,
      },
    ])
  })

  it("resolves a badge back to its typed ref for the context menu", () => {
    const refs = [ref("main", "branch"), ref("main", "tag")]
    const badge = refBadgesForCommit(refs, commit({ refs: ["main"] }))[1]
    expect(badge?.kind).toBe("tag")
    expect(typedRefForBadge(refs, badge!)).toEqual(ref("main", "tag"))
  })
})

describe("history log input", () => {
  it("sends only the historical fields when the server is old", () => {
    expect(
      historyLogInput(
        "repo",
        100,
        0,
        { filter: DEFAULT_HISTORY_FILTER, firstParent: false, order: "date" },
        false,
      ),
    ).toEqual({ repositoryId: "repo", limit: 100 })
    expect(
      historyLogInput(
        "repo",
        100,
        200,
        { filter: DEFAULT_HISTORY_FILTER, firstParent: false, order: "date" },
        false,
      ),
    ).toEqual({ repositoryId: "repo", limit: 100, skip: 200 })
  })

  it("carries every filter flag on the extended contract", () => {
    const input = historyLogInput(
      "repo",
      100,
      200,
      {
        filter: { refs: ["refs/heads/main", "refs/tags/v1"], showRemotes: false, showTags: true },
        firstParent: true,
        order: "topo",
      },
      true,
    )
    expect(input).toEqual({
      repositoryId: "repo",
      limit: 100,
      skip: 200,
      refs: ["refs/heads/main", "refs/tags/v1"],
      showRemotes: false,
      showTags: true,
      firstParent: true,
      order: "topo",
    })
  })

  it("fingerprints filters so stale append pages can be discarded", () => {
    const base = historyFilterFingerprint(DEFAULT_HISTORY_FILTER, false, "date")
    expect(base).toBe(historyFilterFingerprint(DEFAULT_HISTORY_FILTER, false, "date"))
    expect(base).not.toBe(
      historyFilterFingerprint(
        { ...DEFAULT_HISTORY_FILTER, refs: ["refs/heads/main"] },
        false,
        "date",
      ),
    )
    expect(base).not.toBe(historyFilterFingerprint(DEFAULT_HISTORY_FILTER, true, "date"))
    expect(base).not.toBe(historyFilterFingerprint(DEFAULT_HISTORY_FILTER, false, "topo"))
  })
})

describe("capability probing", () => {
  it("detects the extended log schema and mutation methods", () => {
    const client = {
      checkoutBranch: () => undefined,
      createBranch: () => undefined,
      createTag: () => undefined,
      renameBranch: () => undefined,
      deleteBranch: () => undefined,
      deleteTag: () => undefined,
      getComparisonFiles: () => undefined,
      getComparisonDiff: () => undefined,
    }
    const definition = {
      methods: {
        getLog: { input: { shape: { repositoryId: {}, refs: {} } } },
      },
    }
    expect(detectRpcCapabilities(client, definition)).toEqual(CAPS)
  })

  it("keeps the old behaviour when the server has not landed the API", () => {
    expect(detectRpcCapabilities({}, { methods: { getLog: { input: {} } } })).toEqual({
      extendedLog: false,
      comparison: false,
      checkout: false,
      createBranch: false,
      createTag: false,
      renameBranch: false,
      deleteBranch: false,
      deleteTag: false,
    })
  })

  it("detects the real shared contract's ref-filter schema", async () => {
    const { GitGraphRpc } = await import("../src/rpc.js")
    const capabilities = detectRpcCapabilities({}, GitGraphRpc)
    expect(capabilities.extendedLog).toBe(true)
    expect(capabilities.checkout).toBe(true)
    expect(capabilities.comparison).toBe(true)
  })
})

describe("mutation safety", () => {
  it("allows the same branch as a no-op and refuses a dirty checkout", () => {
    expect(checkoutBlockedReason(status(), "main")).toBeUndefined()
    expect(
      checkoutBlockedReason(
        status({ counts: { staged: 1, unstaged: 0, untracked: 0, conflicted: 0 } }),
        "feature",
      ),
    ).toContain("refused")
    expect(
      checkoutBlockedReason(
        status({ files: [{ path: "a.ts", status: "modified", staged: false }] }),
        "feature",
      ),
    ).toContain("refused")
  })
})

describe("menu actions", () => {
  it("offers real branch actions and hides checkout for the current branch", () => {
    const ids = refMenuActions(ref("feature", "branch"), "main", CAPS).map((item) => item.id)
    expect(ids).toContain("checkout")
    expect(ids).toContain("rename-branch")
    expect(ids).toContain("delete-branch")
    const current = refMenuActions(ref("main", "branch"), "main", CAPS).map((item) => item.id)
    expect(current).not.toContain("checkout")
    expect(current).not.toContain("delete-branch")
  })

  it("only renders mutation actions the server advertises", () => {
    const caps: RpcCapabilities = {
      ...CAPS,
      checkout: false,
      createBranch: false,
      renameBranch: false,
      deleteBranch: false,
      deleteTag: false,
    }
    expect(refMenuActions(ref("main", "branch"), "other", caps).map((item) => item.id)).toEqual([
      "view-history",
      "copy-name",
    ])
    expect(refMenuActions(ref("v1", "tag"), "main", caps).map((item) => item.id)).toEqual([
      "view-history",
      "copy-name",
    ])
    expect(refMenuActions(ref("origin/main", "remote"), "main", caps).map((item) => item.id)).toEqual([
      "view-history",
      "copy-name",
    ])
  })

  it("offers comparison only when the server supports it", () => {
    const ids = commitMenuActions(commit(), { capabilities: CAPS }).map((item) => item.id)
    expect(ids).toEqual([
      "view-changes",
      "copy-hash",
      "copy-subject",
      "select-compare",
      "create-branch",
      "create-tag",
    ])
    const withBase = commitMenuActions(commit(), {
      capabilities: CAPS,
      compareBase: commit({ hash: "b".repeat(40) }),
    }).map((item) => item.id)
    expect(withBase).toContain("compare-selected")

    const readonly = commitMenuActions(commit(), {
      capabilities: { ...CAPS, comparison: false, createBranch: false, createTag: false },
    }).map((item) => item.id)
    expect(readonly).toEqual(["view-changes", "copy-hash", "copy-subject"])
  })
})

describe("file row metadata and host paths", () => {
  it("reads optional added/deleted counts and ignores malformed values", () => {
    const file = {
      path: "src/a.ts",
      status: "modified",
      staged: false,
      added: 5,
      deleted: 2,
    } as ChangedFile & { added: number; deleted: number }
    expect(changedFileStats(file)).toEqual({ added: 5, deleted: 2 })
    expect(
      changedFileStats({
        path: "src/b.ts",
        status: "modified",
        staged: false,
      }),
    ).toEqual({})
    expect(
      changedFileStats({
        path: "src/c.ts",
        status: "modified",
        staged: false,
        added: -1,
        deleted: Number.NaN,
      } as unknown as ChangedFile),
    ).toEqual({})
    expect(hasFileStats({ added: 5, deleted: 2 })).toBe(true)
    expect(hasFileStats({ added: 0 })).toBe(true)
    expect(hasFileStats({ deleted: 0 })).toBe(true)
    expect(hasFileStats({})).toBe(false)
  })

  it("disables the commit-version eye only for deleted files", () => {
    expect(
      canViewFileAtCommit({ path: "a", status: "modified", staged: false }),
    ).toBe(true)
    expect(
      canViewFileAtCommit({ path: "a", status: "deleted", staged: false }),
    ).toBe(false)
  })

  it("builds normalized absolute and workspace-relative host paths", () => {
    expect(
      absoluteRepositoryFilePath("C:\\work\\repo", "src\\a.ts"),
    ).toBe("C:/work/repo/src/a.ts")
    expect(
      workspaceRelativePath("C:\\work", "C:\\work\\repo", "src/a.ts"),
    ).toBe("repo/src/a.ts")
    expect(
      workspaceRelativePath("C:\\work\\repo", "C:\\work\\repo", "src/a.ts"),
    ).toBe("src/a.ts")
    expect(
      workspaceRelativePath("C:\\other", "C:\\work\\repo", "src/a.ts"),
    ).toBe("C:/work/repo/src/a.ts")
    expect(workspaceRelativePath("/work", "/work/repo", "src/a.ts")).toBe(
      "repo/src/a.ts",
    )
  })

  it("detects getCommitFileContent independently of mutations", () => {
    expect(
      detectCommitFileContentSupport({
        getCommitFileContent: () => undefined,
      }),
    ).toBe(true)
    expect(detectCommitFileContentSupport({})).toBe(false)
    expect(
      detectCommitFileContentSupport(
        {},
        { methods: { getCommitFileContent: { input: {} } } },
      ),
    ).toBe(false)
  })

  it("detects the real shared contract's file-content method when the client exposes it", async () => {
    const { GitGraphRpc } = await import("../src/rpc.js")
    expect(
      detectCommitFileContentSupport(
        { getCommitFileContent: () => undefined },
        GitGraphRpc,
      ),
    ).toBe(true)
  })

  it("recognizes metadata-only oversized text content", () => {
    expect(
      isSizeOnlyFileContent({
        path: "big.txt",
        mode: "100644",
        kind: "text",
        text: null,
        size: 25 * 1024 * 1024,
        truncated: true,
      }),
    ).toBe(true)
    expect(
      isSizeOnlyFileContent({
        path: "empty.txt",
        mode: "100644",
        kind: "text",
        text: "",
        size: 0,
      }),
    ).toBe(false)
    expect(
      isSizeOnlyFileContent({
        path: "image.png",
        mode: "100644",
        kind: "binary",
        text: null,
        size: 25 * 1024 * 1024,
        truncated: true,
      }),
    ).toBe(false)
  })
})

describe("Ctrl/Cmd comparison activation", () => {
  const A = commit({ hash: "a".repeat(40), subject: "A" })
  const B = commit({ hash: "b".repeat(40), subject: "B" })
  const C = commit({ hash: "c".repeat(40), subject: "C" })

  it("plain A + Ctrl/Cmd B compares A as base and B as head", () => {
    expect(
      decideCompareActivation({ selectedCommit: A, target: B }),
    ).toEqual({ kind: "compare", base: A, head: B })
  })

  it("explicit context base C wins over the inline selection A", () => {
    expect(
      decideCompareActivation({ explicitBase: C, selectedCommit: A, target: B }),
    ).toEqual({ kind: "compare", base: C, head: B })
  })

  it("first Ctrl/Cmd click with no base or selection selects the base", () => {
    expect(decideCompareActivation({ target: A })).toEqual({
      kind: "select-base",
      commit: A,
    })
  })

  it("never opens a same-commit comparison and keeps the inline selection", () => {
    expect(
      decideCompareActivation({ explicitBase: A, selectedCommit: A, target: A }),
    ).toEqual({ kind: "same", explicitBase: true })
    expect(
      decideCompareActivation({ selectedCommit: A, target: A }),
    ).toEqual({ kind: "same", explicitBase: false })
  })

  it("accepts Ctrl, Meta, or both modifiers", () => {
    expect(isCompareModifier({ ctrlKey: true, metaKey: false })).toBe(true)
    expect(isCompareModifier({ ctrlKey: false, metaKey: true })).toBe(true)
    expect(isCompareModifier({ ctrlKey: true, metaKey: true })).toBe(true)
    expect(isCompareModifier({ ctrlKey: false, metaKey: false })).toBe(false)
    // Direction is always base → head, regardless of input order.
    expect(
      decideCompareActivation({ selectedCommit: B, target: A }),
    ).toEqual({ kind: "compare", base: B, head: A })
  })
})

describe("first-parent graph input", () => {
  it("copies merges with only the first parent but leaves originals intact", () => {
    const merge = commit({ hash: "m", parents: ["a", "b"] })
    const parent = commit({ hash: "a", parents: [] })
    const commits = [merge, parent]
    const graphInput = firstParentGraphCommits(commits, true)
    expect(graphInput[0]?.parents).toEqual(["a"])
    expect(graphInput[1]).toBe(parent)
    expect(graphInput[0]).not.toBe(merge)
    expect(merge.parents).toEqual(["a", "b"])
    expect(firstParentGraphCommits(commits, false)).toBe(commits)
  })
})

describe("ref filter reconciliation after writes", () => {
  it("maps a renamed branch and drops a deleted branch or tag", () => {
    expect(
      reconcileRefFilter(
        ["refs/heads/old", "refs/tags/keep"],
        { kind: "rename-branch", oldName: "old", newName: "new" },
      ),
    ).toEqual(["refs/heads/new", "refs/tags/keep"])
    expect(
      reconcileRefFilter(
        ["refs/heads/gone", "refs/heads/keep"],
        { kind: "delete-branch", name: "gone" },
      ),
    ).toEqual(["refs/heads/keep"])
    expect(
      reconcileRefFilter(
        ["refs/tags/gone", "refs/heads/keep"],
        { kind: "delete-tag", name: "gone" },
      ),
    ).toEqual(["refs/heads/keep"])
  })

  it("becomes All (empty) when the last selected ref disappears", () => {
    expect(
      reconcileRefFilter(["refs/heads/only"], {
        kind: "delete-branch",
        name: "only",
      }),
    ).toEqual([])
  })

  it("drops refs missing from the refreshed typed list", () => {
    const refs = [ref("main", "branch"), ref("v1", "tag")]
    expect(
      filterRefsToAvailable(
        ["refs/heads/main", "refs/heads/gone", "refs/tags/v1"],
        refs,
      ),
    ).toEqual(["refs/heads/main", "refs/tags/v1"])
    expect(filterRefsToAvailable([], refs)).toEqual([])
  })
})
