import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { getStatus, parsePorcelainV1 } from "../src/server/git/status.js"
import { commit, mkTmpRepo } from "./helpers.js"

describe("parsePorcelainV1", () => {
  it("parses untracked files", () => {
    expect(parsePorcelainV1("?? new.txt\0")).toEqual([
      { path: "new.txt", status: "untracked", staged: false },
    ])
  })

  it("emits a staged and an unstaged entry for a partially staged file", () => {
    const files = parsePorcelainV1("MM a.txt\0")
    expect(files).toHaveLength(2)
    expect(files[0]).toMatchObject({ path: "a.txt", status: "modified", staged: true })
    expect(files[1]).toMatchObject({ path: "a.txt", status: "modified", staged: false })
  })

  it("parses rename records (new path first, old path second)", () => {
    expect(parsePorcelainV1("R  new.txt\0old.txt\0")).toEqual([
      { path: "new.txt", oldPath: "old.txt", status: "renamed", staged: true },
    ])
  })

  it("parses unmerged records as conflicted", () => {
    expect(parsePorcelainV1("UU conflict.txt\0")).toEqual([
      { path: "conflict.txt", status: "conflicted", staged: false },
    ])
  })

  it("handles type changes as modified", () => {
    expect(parsePorcelainV1("T  link\0")).toEqual([
      { path: "link", status: "modified", staged: true },
    ])
  })
})

describe("getStatus", () => {
  it("reports untracked files in an empty repository", async () => {
    const repo = mkTmpRepo()
    try {
      mkdirSync(join(repo.dir, "src"))
      writeFileSync(join(repo.dir, "src", "new.txt"), "hello\n")

      const status = await getStatus(repo.dir)
      expect(status.files).toEqual([{ path: "src/new.txt", status: "untracked", staged: false }])
      expect(status.counts).toEqual({ staged: 0, unstaged: 0, untracked: 1, conflicted: 0 })
      expect(status.head).toBeNull()
      expect(status.detached).toBe(false)
      expect(status.branch).toBeNull()
    } finally {
      repo.cleanup()
    }
  })

  it("reports staged additions", async () => {
    const repo = mkTmpRepo()
    try {
      writeFileSync(join(repo.dir, "added.txt"), "content\n")
      repo.git(["add", "added.txt"])

      const status = await getStatus(repo.dir)
      expect(status.files).toEqual([{ path: "added.txt", status: "added", staged: true }])
      expect(status.counts).toEqual({ staged: 1, unstaged: 0, untracked: 0, conflicted: 0 })
    } finally {
      repo.cleanup()
    }
  })

  it("reports unstaged modifications and a branch/head after committing", async () => {
    const repo = mkTmpRepo()
    try {
      const hash = commit(repo.dir, { "a.txt": "one\n" }, "c1")
      writeFileSync(join(repo.dir, "a.txt"), "two\n")

      const status = await getStatus(repo.dir)
      expect(status.files).toEqual([{ path: "a.txt", status: "modified", staged: false }])
      expect(status.counts).toEqual({ staged: 0, unstaged: 1, untracked: 0, conflicted: 0 })
      expect(status.branch).toBe("main")
      expect(status.head).toBe(hash)
      expect(status.detached).toBe(false)
    } finally {
      repo.cleanup()
    }
  })

  it("emits two entries for a partially staged file", async () => {
    const repo = mkTmpRepo()
    try {
      commit(repo.dir, { "a.txt": "one\n" }, "c1")
      writeFileSync(join(repo.dir, "a.txt"), "two\n")
      repo.git(["add", "a.txt"])
      writeFileSync(join(repo.dir, "a.txt"), "three\n")

      const status = await getStatus(repo.dir)
      const entries = status.files.filter((file) => file.path === "a.txt")
      expect(entries).toHaveLength(2)
      expect(entries.map((entry) => entry.staged).sort()).toEqual([false, true])
      expect(status.counts).toEqual({ staged: 1, unstaged: 1, untracked: 0, conflicted: 0 })
    } finally {
      repo.cleanup()
    }
  })

  it("reports renames with the original path", async () => {
    const repo = mkTmpRepo()
    try {
      commit(repo.dir, { "a.txt": "one\n" }, "c1")
      repo.git(["mv", "a.txt", "b.txt"])

      const status = await getStatus(repo.dir)
      expect(status.files).toEqual([
        { path: "b.txt", oldPath: "a.txt", status: "renamed", staged: true },
      ])
      expect(status.counts.staged).toBe(1)
    } finally {
      repo.cleanup()
    }
  })

  it("keeps non-ascii and space-containing rename paths intact", async () => {
    const repo = mkTmpRepo()
    try {
      commit(repo.dir, { "旧 文件.txt": "one\n" }, "c1")
      repo.git(["mv", "旧 文件.txt", "新 文件.txt"])

      const status = await getStatus(repo.dir)
      expect(status.files).toEqual([
        {
          path: "新 文件.txt",
          oldPath: "旧 文件.txt",
          status: "renamed",
          staged: true,
        },
      ])
    } finally {
      repo.cleanup()
    }
  })

  it("reports merge conflicts", async () => {
    const repo = mkTmpRepo()
    try {
      commit(repo.dir, { "conflict.txt": "base\n" }, "base")
      repo.git(["checkout", "-b", "feature"])
      commit(repo.dir, { "conflict.txt": "feature\n" }, "feature change")
      repo.git(["checkout", "main"])
      commit(repo.dir, { "conflict.txt": "main\n" }, "main change")

      const merge = repo.tryGit(["merge", "--no-commit", "feature"])
      expect(merge.status).not.toBe(0)

      const status = await getStatus(repo.dir)
      expect(status.files).toContainEqual({
        path: "conflict.txt",
        status: "conflicted",
        staged: false,
      })
      expect(status.counts.conflicted).toBe(1)
    } finally {
      repo.cleanup()
    }
  })
})
