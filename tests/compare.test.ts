import { execFileSync } from "node:child_process"
import { existsSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { getComparisonDiff, getComparisonFiles } from "../src/server/git/compare.js"
import { commit, mkTmpRepo, type TmpRepo } from "./helpers.js"

interface ComparisonRepo {
  base: string
  head: string
}

/** Run git with arbitrary stdin (needed for plumbing that bypasses the worktree). */
function gitWithInput(dir: string, args: string[], input: string): string {
  return execFileSync("git", ["-C", dir, "--no-pager", ...args], {
    encoding: "utf8",
    input,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    windowsHide: true,
  })
}

/**
 * Add a path to HEAD's tree with plumbing.
 *
 * Windows cannot create a worktree file whose name contains a newline, but git
 * can store one in a tree. Building the tree directly keeps the comparison
 * tests portable while still exercising newline-bearing paths.
 */
function addPathToHeadTree(repo: TmpRepo, filePath: string, content: string): string {
  const blob = gitWithInput(repo.dir, ["hash-object", "-w", "--stdin"], content).trim()
  const entries = repo.git(["ls-tree", "-z", "HEAD"]).split("\0").filter(Boolean)
  entries.push(`100644 blob ${blob}\t${filePath}`)
  const tree = gitWithInput(
    repo.dir,
    ["mktree", "-z"],
    entries.map((entry) => `${entry}\0`).join(""),
  ).trim()
  const head = repo.git(["rev-parse", "HEAD"]).trim()
  const next = repo
    .git(["commit-tree", tree, "-p", head, "-m", "add newline path"])
    .trim()
  repo.git(["update-ref", "refs/heads/main", next])
  return next
}

/**
 * base -> head exercises added, modified, deleted and renamed paths, plus
 * binary content and paths containing spaces, brackets and a newline.
 */
function buildComparisonRepo(repo: TmpRepo): ComparisonRepo {
  const base = commit(
    repo.dir,
    {
      "keep.txt": "keep\n",
      "modify.txt": "old\n",
      "delete.txt": "gone\n",
      "旧 文件.txt": "hello\nworld\n",
      "binary.bin": "one\u0000bin",
      "stable.txt": "same\n",
    },
    "base",
  )

  const committed = commit(
    repo.dir,
    {
      "keep.txt": "keep\n",
      "modify.txt": "new\n",
      "delete.txt": null,
      "added.txt": "added\n",
      "binary.bin": "two\u0000bin",
      "旧 文件.txt": null,
      "新 文件.txt": "hello\nworld\n",
      "with space.txt": "space\n",
      "[brackets].txt": "brackets\n",
    },
    "head",
  )

  const head = addPathToHeadTree(repo, "line\nbreak.txt", "newline path\n")
  expect(head).not.toBe(committed)

  return { base, head }
}

function byPath(files: Awaited<ReturnType<typeof getComparisonFiles>>) {
  return new Map(files.map((file) => [file.path, file]))
}

describe("getComparisonFiles", () => {
  it("reports added, modified, deleted and renamed files", async () => {
    const repo = mkTmpRepo()
    try {
      const { base, head } = buildComparisonRepo(repo)
      const files = await getComparisonFiles(repo.dir, base, head)
      const map = byPath(files)

      expect(map.get("added.txt")).toEqual({
        path: "added.txt",
        status: "added",
        staged: true,
        added: 1,
        deleted: 0,
      })
      expect(map.get("modify.txt")).toEqual({
        path: "modify.txt",
        status: "modified",
        staged: true,
        added: 1,
        deleted: 1,
      })
      expect(map.get("delete.txt")).toEqual({
        path: "delete.txt",
        status: "deleted",
        staged: true,
        added: 0,
        deleted: 1,
      })
      expect(map.get("新 文件.txt")).toEqual({
        path: "新 文件.txt",
        oldPath: "旧 文件.txt",
        status: "renamed",
        staged: true,
        added: 0,
        deleted: 0,
      })
      expect(map.get("binary.bin")?.status).toBe("modified")
      expect(map.get("binary.bin")?.added).toBeUndefined()
      expect(map.get("binary.bin")?.deleted).toBeUndefined()
      expect(map.get("keep.txt")).toBeUndefined()
      expect(map.get("stable.txt")).toBeUndefined()

      // Special paths must survive -z parsing untouched.
      expect(map.get("with space.txt")?.status).toBe("added")
      expect(map.get("[brackets].txt")?.status).toBe("added")
      expect(map.get("line\nbreak.txt")?.status).toBe("added")
    } finally {
      repo.cleanup()
    }
  })

  it("reverses statuses and rename direction when base and head swap", async () => {
    const repo = mkTmpRepo()
    try {
      const { base, head } = buildComparisonRepo(repo)
      const files = await getComparisonFiles(repo.dir, head, base)
      const map = byPath(files)

      expect(map.get("added.txt")).toEqual({
        path: "added.txt",
        status: "deleted",
        staged: true,
        added: 0,
        deleted: 1,
      })
      expect(map.get("delete.txt")).toEqual({
        path: "delete.txt",
        status: "added",
        staged: true,
        added: 1,
        deleted: 0,
      })
      expect(map.get("旧 文件.txt")).toEqual({
        path: "旧 文件.txt",
        oldPath: "新 文件.txt",
        status: "renamed",
        staged: true,
        added: 0,
        deleted: 0,
      })
      expect(map.get("modify.txt")?.status).toBe("modified")
    } finally {
      repo.cleanup()
    }
  })

  it("returns no files for the same commit", async () => {
    const repo = mkTmpRepo()
    try {
      const { base } = buildComparisonRepo(repo)
      await expect(getComparisonFiles(repo.dir, base, base)).resolves.toEqual([])
    } finally {
      repo.cleanup()
    }
  })

  it("compares a root commit as a normal commit with its own tree", async () => {
    const repo = mkTmpRepo()
    try {
      const root = commit(repo.dir, { "a.txt": "one\n" }, "root")
      const child = commit(repo.dir, { "a.txt": "two\n" }, "child")

      const files = await getComparisonFiles(repo.dir, root, child)
      expect(files).toEqual([
        { path: "a.txt", status: "modified", staged: true, added: 1, deleted: 1 },
      ])
      expect(await getComparisonFiles(repo.dir, root, root)).toEqual([])
    } finally {
      repo.cleanup()
    }
  })

  it("does not count gitlink additions or bumps", async () => {
    const repo = mkTmpRepo()
    try {
      const base = commit(repo.dir, { "a.txt": "one\n" }, "base")
      repo.git(["update-index", "--add", "--cacheinfo", `160000,${base},vendor/module`])
      repo.git(["commit", "-m", "add gitlink"])
      const added = repo.git(["rev-parse", "HEAD"]).trim()

      const addFiles = await getComparisonFiles(repo.dir, base, added)
      expect(addFiles).toEqual([
        { path: "vendor/module", status: "added", staged: true },
      ])

      repo.git(["commit", "--allow-empty", "-m", "target2"])
      const target2 = repo.git(["rev-parse", "HEAD"]).trim()
      repo.git(["update-index", "--cacheinfo", `160000,${target2},vendor/module`])
      repo.git(["commit", "-m", "bump gitlink"])
      const bumped = repo.git(["rev-parse", "HEAD"]).trim()

      const bumpFiles = await getComparisonFiles(repo.dir, added, bumped)
      expect(bumpFiles).toEqual([
        { path: "vendor/module", status: "modified", staged: true },
      ])
    } finally {
      repo.cleanup()
    }
  })

  it("ignores the index and working tree", async () => {
    const repo = mkTmpRepo()
    try {
      const { base, head } = buildComparisonRepo(repo)

      writeFileSync(join(repo.dir, "modify.txt"), "worktree only\n")
      writeFileSync(join(repo.dir, "untracked.txt"), "untracked\n")
      repo.git(["add", "modify.txt"])

      const files = byPath(await getComparisonFiles(repo.dir, base, head))
      expect(files.get("modify.txt")?.status).toBe("modified")
      expect(files.get("untracked.txt")).toBeUndefined()

      const diff = await getComparisonDiff(repo.dir, base, head, "modify.txt")
      expect(diff.text).toContain("-old")
      expect(diff.text).toContain("+new")
      expect(diff.text).not.toContain("worktree only")
    } finally {
      repo.cleanup()
    }
  })

  it("rejects invalid, non-commit and malicious hashes without writing files", async () => {
    const repo = mkTmpRepo()
    try {
      const { base, head } = buildComparisonRepo(repo)
      const marker = join(repo.dir, "created-by-hash-attack.txt")
      const tree = repo.git(["rev-parse", `${base}^{tree}`]).trim()
      const blob = repo.git(["rev-parse", `${base}:modify.txt`]).trim()

      const invalid = [
        `--output=${marker}`,
        "HEAD",
        "main~1",
        ":/base",
        "zzzz",
        "abc",
        "a".repeat(65),
        tree,
        blob,
        `${head}\0evil`,
        "",
      ]
      for (const hash of invalid) {
        await expect(getComparisonFiles(repo.dir, hash, head)).rejects.toThrow(
          /Invalid commit oid/,
        )
        await expect(getComparisonFiles(repo.dir, base, hash)).rejects.toThrow(
          /Invalid commit oid/,
        )
        await expect(getComparisonDiff(repo.dir, hash, head, "modify.txt")).rejects.toThrow(
          /Invalid commit oid/,
        )
      }

      expect(existsSync(marker)).toBe(false)
    } finally {
      repo.cleanup()
    }
  })
})

describe("getComparisonDiff", () => {
  it("diffs modified, added and deleted paths in both directions", async () => {
    const repo = mkTmpRepo()
    try {
      const { base, head } = buildComparisonRepo(repo)

      const modified = await getComparisonDiff(repo.dir, base, head, "modify.txt")
      expect(modified).toMatchObject({ path: "modify.txt", status: "modified", binary: false })
      expect(modified.text).toContain("-old")
      expect(modified.text).toContain("+new")

      const added = await getComparisonDiff(repo.dir, base, head, "added.txt")
      expect(added.status).toBe("added")
      expect(added.text).toContain("new file mode")
      expect(added.text).toContain("+added")

      const deleted = await getComparisonDiff(repo.dir, base, head, "delete.txt")
      expect(deleted.status).toBe("deleted")
      expect(deleted.text).toContain("deleted file mode")
      expect(deleted.text).toContain("-gone")

      const reverseAdded = await getComparisonDiff(repo.dir, head, base, "added.txt")
      expect(reverseAdded.status).toBe("deleted")
      expect(reverseAdded.text).toContain("deleted file mode")

      const reverseDeleted = await getComparisonDiff(repo.dir, head, base, "delete.txt")
      expect(reverseDeleted.status).toBe("added")
      expect(reverseDeleted.text).toContain("new file mode")
    } finally {
      repo.cleanup()
    }
  })

  it("diffs a rename using both literal pathspecs and returns oldPath", async () => {
    const repo = mkTmpRepo()
    try {
      const { base, head } = buildComparisonRepo(repo)
      const diff = await getComparisonDiff(repo.dir, base, head, "新 文件.txt")

      expect(diff.status).toBe("renamed")
      expect(diff.oldPath).toBe("旧 文件.txt")
      expect(diff.text).toContain("rename from")
      expect(diff.text).toContain("rename to")

      const reverse = await getComparisonDiff(repo.dir, head, base, "旧 文件.txt")
      expect(reverse.status).toBe("renamed")
      expect(reverse.oldPath).toBe("新 文件.txt")
    } finally {
      repo.cleanup()
    }
  })

  it("treats brackets, spaces and newlines in paths literally", async () => {
    const repo = mkTmpRepo()
    try {
      const { base, head } = buildComparisonRepo(repo)

      const brackets = await getComparisonDiff(repo.dir, base, head, "[brackets].txt")
      expect(brackets.status).toBe("added")
      expect(brackets.text).toContain("+brackets")

      const spaced = await getComparisonDiff(repo.dir, base, head, "with space.txt")
      expect(spaced.status).toBe("added")
      expect(spaced.text).toContain("+space")

      const newline = await getComparisonDiff(repo.dir, base, head, "line\nbreak.txt")
      expect(newline.status).toBe("added")
      expect(newline.text).toContain("+newline path")
    } finally {
      repo.cleanup()
    }
  })

  it("reports binary comparisons without pretending to have blob text", async () => {
    const repo = mkTmpRepo()
    try {
      const { base, head } = buildComparisonRepo(repo)
      const diff = await getComparisonDiff(repo.dir, base, head, "binary.bin")

      expect(diff.binary).toBe(true)
      expect(diff.text).toContain("Binary files")
      expect(diff.text).not.toContain("two\u0000bin")
    } finally {
      repo.cleanup()
    }
  })

  it("rejects unsafe or uncompared paths", async () => {
    const repo = mkTmpRepo()
    try {
      const { base, head } = buildComparisonRepo(repo)
      const unsafe = [
        "",
        "../outside.txt",
        "nested/../../outside.txt",
        "/etc/passwd",
        "C:\\temp\\outside.txt",
        "C:relative.txt",
        "\\\\server\\share\\outside.txt",
        "a.txt\0b.txt",
      ]

      for (const filePath of unsafe) {
        await expect(getComparisonDiff(repo.dir, base, head, filePath)).rejects.toThrow(
          /Invalid file path/,
        )
      }

      // Valid relative path that git does not report as changed.
      await expect(getComparisonDiff(repo.dir, base, head, "keep.txt")).rejects.toThrow(
        /Invalid comparison path/,
      )
      // Same commit: the comparison is empty, so no path belongs to it.
      await expect(getComparisonDiff(repo.dir, base, base, "modify.txt")).rejects.toThrow(
        /Invalid comparison path/,
      )
    } finally {
      repo.cleanup()
    }
  })
})
