import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { discoverRepositories } from "../src/server/repository/discovery.js"
import { commit, gitTry, initRepo, mkTmpDir } from "./helpers.js"

function normalizedId(target: string): string {
  return process.platform === "win32"
    ? target.replace(/^([a-zA-Z]):/, (_match, drive: string) => `${drive.toLowerCase()}:`)
    : target
}

describe("discoverRepositories", () => {
  it("finds nested repositories and skips ignored directories", async () => {
    const root = mkTmpDir()
    try {
      const repo1 = join(root.dir, "repo1")
      initRepo(repo1)
      const repo1Head = commit(repo1, { "a.txt": "one\n" }, "c1")

      const repo2 = join(root.dir, "group", "nested", "repo2")
      initRepo(repo2)
      commit(repo2, { "b.txt": "two\n" }, "c1")

      const ignoredRepo = join(root.dir, "node_modules", "pkg")
      initRepo(ignoredRepo)

      const repositories = await discoverRepositories(root.dir)
      expect(repositories.map((repository) => repository.name).sort()).toEqual(["repo1", "repo2"])

      const first = repositories.find((repository) => repository.name === "repo1")
      expect(first).toBeDefined()
      expect(first?.id).toBe(normalizedId(repo1))
      expect(first?.rootPath).toBe(repo1)
      expect(first?.gitDir).toBe(join(repo1, ".git"))
      expect(first?.type).toBe("normal")
      expect(first?.branch).toBe("main")
      expect(first?.head).toBe(repo1Head)
      expect(first?.detached).toBe(false)
      expect(first?.changes).toEqual({ staged: 0, unstaged: 0, untracked: 0, conflicted: 0 })
    } finally {
      root.cleanup()
    }
  })

  it("recognizes linked worktrees", async () => {
    const root = mkTmpDir()
    try {
      const main = join(root.dir, "main")
      initRepo(main)
      const head = commit(main, { "a.txt": "one\n" }, "c1")

      const worktree = join(root.dir, "wt")
      const added = gitTry(main, ["worktree", "add", "-b", "wtbranch", worktree])
      expect(added.status).toBe(0)

      const repositories = await discoverRepositories(root.dir)
      expect(repositories).toHaveLength(2)

      const worktreeRepo = repositories.find((repository) => repository.name === "wt")
      expect(worktreeRepo).toBeDefined()
      expect(worktreeRepo?.type).toBe("worktree")
      expect(worktreeRepo?.branch).toBe("wtbranch")
      expect(worktreeRepo?.head).toBe(head)
      expect(worktreeRepo?.rootPath).toBe(worktree)
      expect(worktreeRepo?.gitDir.replace(/\\/g, "/")).toContain("/worktrees/")

      const mainRepo = repositories.find((repository) => repository.name === "main")
      expect(mainRepo?.type).toBe("normal")
    } finally {
      root.cleanup()
    }
  })

  it("includes the scan root itself when it is a repository", async () => {
    const root = mkTmpDir()
    try {
      initRepo(root.dir)
      commit(root.dir, { "a.txt": "one\n" }, "c1")

      const repositories = await discoverRepositories(root.dir)
      expect(repositories).toHaveLength(1)
      expect(repositories[0].rootPath).toBe(root.dir)
    } finally {
      root.cleanup()
    }
  })

  it("skips a repository whose configured worktree escapes the scan root", async () => {
    const root = mkTmpDir()
    const outside = mkTmpDir()
    try {
      const repo = join(root.dir, "repo")
      initRepo(repo)
      commit(repo, { "a.txt": "one\n" }, "c1")

      writeFileSync(join(outside.dir, "secret.txt"), "secret\n")
      const configured = gitTry(repo, ["config", "core.worktree", outside.dir])
      expect(configured.status).toBe(0)

      const repositories = await discoverRepositories(root.dir)
      expect(repositories).toEqual([])
    } finally {
      root.cleanup()
      outside.cleanup()
    }
  })

  it("skips a repository with a corrupt index but keeps healthy repositories", async () => {
    const root = mkTmpDir()
    try {
      const healthy = join(root.dir, "healthy")
      initRepo(healthy)
      commit(healthy, { "a.txt": "one\n" }, "c1")

      const corrupt = join(root.dir, "corrupt")
      initRepo(corrupt)
      commit(corrupt, { "b.txt": "two\n" }, "c1")
      // Invalid 12-byte index header: `git status` fails while rev-parse works.
      writeFileSync(join(corrupt, ".git", "index"), Buffer.from("DIRC\x00\x00\x00\x02\x00\x00\x00\x05"))

      const repositories = await discoverRepositories(root.dir)
      expect(repositories.map((repository) => repository.name)).toEqual(["healthy"])
    } finally {
      root.cleanup()
    }
  })

  it("recognizes submodule-style gitdir files", async () => {
    const root = mkTmpDir()
    try {
      const parent = join(root.dir, "parent")
      initRepo(parent)
      commit(parent, { "a.txt": "one\n" }, "c1")

      const modules = join(parent, ".git", "modules")
      mkdirSync(modules, { recursive: true })
      const childGitDir = join(modules, "sub")
      const child = join(root.dir, "child")

      const initialized = gitTry(root.dir, [
        "init",
        "-b",
        "main",
        `--separate-git-dir=${childGitDir}`,
        child,
      ])
      expect(initialized.status).toBe(0)

      const repositories = await discoverRepositories(root.dir)
      const childRepo = repositories.find((repository) => repository.name === "child")
      expect(childRepo).toBeDefined()
      expect(childRepo?.type).toBe("submodule")
      expect(childRepo?.rootPath).toBe(child)
      expect(childRepo?.gitDir.replace(/\\/g, "/")).toContain("/modules/")
    } finally {
      root.cleanup()
    }
  })

  it("honors maxDepth", async () => {
    const root = mkTmpDir()
    try {
      const deep = join(root.dir, "a", "b", "repo")
      initRepo(deep)
      commit(deep, { "a.txt": "one\n" }, "c1")

      const shallow = await discoverRepositories(root.dir, { maxDepth: 2 })
      expect(shallow).toEqual([])

      const deepEnough = await discoverRepositories(root.dir, { maxDepth: 3 })
      expect(deepEnough.map((repository) => repository.name)).toEqual(["repo"])
    } finally {
      root.cleanup()
    }
  })

  it("does not descend into a discovered repository", async () => {
    const root = mkTmpDir()
    try {
      const outer = join(root.dir, "outer")
      initRepo(outer)
      commit(outer, { "a.txt": "one\n" }, "c1")

      const inner = join(outer, "inner")
      initRepo(inner)
      commit(inner, { "b.txt": "two\n" }, "c1")

      const repositories = await discoverRepositories(root.dir)
      expect(repositories.map((repository) => repository.name)).toEqual(["outer"])
    } finally {
      root.cleanup()
    }
  })

  it("supports custom ignore lists", async () => {
    const root = mkTmpDir()
    try {
      const ignored = join(root.dir, "vendor", "vendorRepo")
      initRepo(ignored)
      commit(ignored, { "a.txt": "one\n" }, "c1")

      const kept = join(root.dir, "src", "keptRepo")
      initRepo(kept)
      commit(kept, { "b.txt": "two\n" }, "c1")

      const repositories = await discoverRepositories(root.dir, { ignore: ["vendor"] })
      expect(repositories.map((repository) => repository.name)).toEqual(["keptRepo"])
    } finally {
      root.cleanup()
    }
  })
})
