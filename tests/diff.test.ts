import { chmodSync, existsSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { getCommitFiles, getDiff } from "../src/server/git/diff.js"
import { getStatus } from "../src/server/git/status.js"
import { commit, mkTmpDir, mkTmpRepo } from "./helpers.js"

describe("getCommitFiles", () => {
  it("lists root-commit files against the empty tree", async () => {
    const repo = mkTmpRepo()
    try {
      const hash = commit(repo.dir, { "a.txt": "hello\nworld\n" }, "root")
      const files = await getCommitFiles(repo.dir, hash)
      expect(files).toEqual([{ path: "a.txt", status: "added", staged: true }])
    } finally {
      repo.cleanup()
    }
  })

  it("reports renames with their original path", async () => {
    const repo = mkTmpRepo()
    try {
      commit(repo.dir, { "a.txt": "hello\n" }, "add")
      repo.git(["mv", "a.txt", "b.txt"])
      repo.git(["commit", "-m", "rename"])

      const hash = repo.git(["rev-parse", "HEAD"]).trim()
      const files = await getCommitFiles(repo.dir, hash)
      expect(files).toEqual([
        { path: "b.txt", oldPath: "a.txt", status: "renamed", staged: true },
      ])
    } finally {
      repo.cleanup()
    }
  })

  it("keeps non-ascii and space-containing rename paths intact", async () => {
    const repo = mkTmpRepo()
    try {
      commit(repo.dir, { "旧 文件.txt": "hello\n" }, "add")
      repo.git(["mv", "旧 文件.txt", "新 文件.txt"])
      repo.git(["commit", "-m", "rename"])

      const hash = repo.git(["rev-parse", "HEAD"]).trim()
      const files = await getCommitFiles(repo.dir, hash)
      expect(files).toEqual([
        { path: "新 文件.txt", oldPath: "旧 文件.txt", status: "renamed", staged: true },
      ])
    } finally {
      repo.cleanup()
    }
  })

  it("rejects option-like and revision-expression arguments before invoking git", async () => {
    const repo = mkTmpRepo()
    try {
      const hash = commit(repo.dir, { "a.txt": "hello\n" }, "root")
      const output = join(repo.dir, "created-by-attack.txt")

      for (const malicious of [`--output=${output}`, "HEAD", "main~1", ":/root"]) {
        await expect(getCommitFiles(repo.dir, malicious)).rejects.toThrow(/Invalid commit oid/)
        await expect(
          getDiff(repo.dir, { type: "commit", hash: malicious }, "a.txt"),
        ).rejects.toThrow(/Invalid commit oid/)
      }

      expect(existsSync(output)).toBe(false)
      expect(await getCommitFiles(repo.dir, hash)).toHaveLength(1)
    } finally {
      repo.cleanup()
    }
  })

  it("rejects invalid and out-of-range parent indexes instead of falling back", async () => {
    const repo = mkTmpRepo()
    try {
      commit(repo.dir, { "a.txt": "one\n" }, "first")
      const second = commit(repo.dir, { "a.txt": "two\n" }, "second")

      await expect(getCommitFiles(repo.dir, second, 1)).rejects.toThrow(/out of range/)
      await expect(getCommitFiles(repo.dir, second, -1)).rejects.toThrow(/parent index/i)
      await expect(getCommitFiles(repo.dir, second, 1.5)).rejects.toThrow(/parent index/i)
      await expect(
        getDiff(repo.dir, { type: "commit", hash: second, parentIndex: 1 }, "a.txt"),
      ).rejects.toThrow(/out of range/)

      // Root commits only have the implicit "index 0" (empty tree) parent.
      const root = repo.git(["rev-list", "--max-parents=0", "HEAD"]).trim()
      await expect(getCommitFiles(repo.dir, root, 0)).resolves.toHaveLength(1)
      await expect(getCommitFiles(repo.dir, root, 1)).rejects.toThrow(/root commit/)
      await expect(
        getDiff(repo.dir, { type: "commit", hash: root, parentIndex: 1 }, "a.txt"),
      ).rejects.toThrow(/root commit/)
    } finally {
      repo.cleanup()
    }
  })
})

describe("getDiff", () => {
  it("diffs a root commit against the empty tree", async () => {
    const repo = mkTmpRepo()
    try {
      const hash = commit(repo.dir, { "a.txt": "hello\nworld\n" }, "root")
      const diff = await getDiff(repo.dir, { type: "commit", hash }, "a.txt")

      expect(diff.status).toBe("added")
      expect(diff.binary).toBe(false)
      expect(diff.text).toContain("new file mode 100644")
      expect(diff.text).toContain("@@ -0,0 +1,2 @@")
      expect(diff.text).toContain("+hello")
      expect(diff.text).toContain("+world")
    } finally {
      repo.cleanup()
    }
  })

  it("diffs a normal commit against its parent", async () => {
    const repo = mkTmpRepo()
    try {
      commit(repo.dir, { "a.txt": "hello\nworld\n" }, "first")
      const second = commit(repo.dir, { "a.txt": "hello changed\nworld\n" }, "second")

      const diff = await getDiff(repo.dir, { type: "commit", hash: second }, "a.txt")
      expect(diff.status).toBe("modified")
      expect(diff.text).toContain("@@")
      expect(diff.text).toContain("-hello")
      expect(diff.text).toContain("+hello changed")
    } finally {
      repo.cleanup()
    }
  })

  it("diffs the index with --cached", async () => {
    const repo = mkTmpRepo()
    try {
      commit(repo.dir, { "a.txt": "one\n" }, "first")
      writeFileSync(join(repo.dir, "a.txt"), "two\n")
      repo.git(["add", "a.txt"])

      const diff = await getDiff(repo.dir, { type: "index" }, "a.txt")
      expect(diff.status).toBe("modified")
      expect(diff.text).toContain("-one")
      expect(diff.text).toContain("+two")
    } finally {
      repo.cleanup()
    }
  })

  it("diffs a newly staged file from the index", async () => {
    const repo = mkTmpRepo()
    try {
      commit(repo.dir, { "a.txt": "one\n" }, "first")
      writeFileSync(join(repo.dir, "new.txt"), "brand new\n")
      repo.git(["add", "new.txt"])

      const diff = await getDiff(repo.dir, { type: "index" }, "new.txt")
      expect(diff.status).toBe("added")
      expect(diff.text).toContain("new file mode")
      expect(diff.text).toContain("+brand new")
    } finally {
      repo.cleanup()
    }
  })

  it("diffs the working tree", async () => {
    const repo = mkTmpRepo()
    try {
      commit(repo.dir, { "a.txt": "one\n" }, "first")
      writeFileSync(join(repo.dir, "a.txt"), "changed\n")

      const diff = await getDiff(repo.dir, { type: "working-tree" }, "a.txt")
      expect(diff.status).toBe("modified")
      expect(diff.text).toContain("-one")
      expect(diff.text).toContain("+changed")
    } finally {
      repo.cleanup()
    }
  })

  it("synthesizes a diff for an untracked file", async () => {
    const repo = mkTmpRepo()
    try {
      commit(repo.dir, { "a.txt": "one\n" }, "first")
      writeFileSync(join(repo.dir, "untracked.txt"), "one\ntwo\n")

      const diff = await getDiff(repo.dir, { type: "working-tree" }, "untracked.txt")
      expect(diff.status).toBe("untracked")
      expect(diff.binary).toBe(false)
      expect(diff.text).toContain("diff --git a/untracked.txt b/untracked.txt")
      expect(diff.text).toContain("new file mode 100644")
      expect(diff.text).toContain("@@ -0,0 +1,2 @@")
      expect(diff.text).toContain("+one")
      expect(diff.text).toContain("+two")
      expect(diff.truncated).toBeUndefined()
    } finally {
      repo.cleanup()
    }
  })

  it("diffs a renamed commit file using both literal pathspecs", async () => {
    const repo = mkTmpRepo()
    try {
      commit(repo.dir, { "旧 文件.txt": "hello\nworld\n" }, "add")
      repo.git(["mv", "旧 文件.txt", "新 文件.txt"])
      repo.git(["commit", "-m", "rename"])
      const hash = repo.git(["rev-parse", "HEAD"]).trim()

      const diff = await getDiff(repo.dir, { type: "commit", hash }, "新 文件.txt")
      expect(diff.status).toBe("renamed")
      expect(diff.oldPath).toBe("旧 文件.txt")
      expect(diff.text).toContain("rename from")
      expect(diff.text).toContain("rename to")
    } finally {
      repo.cleanup()
    }
  })

  it("diffs a renamed index file using the status old path", async () => {
    const repo = mkTmpRepo()
    try {
      commit(repo.dir, { "旧 文件.txt": "hello\nworld\n" }, "add")
      repo.git(["mv", "旧 文件.txt", "新 文件.txt"])

      const diff = await getDiff(repo.dir, { type: "index" }, "新 文件.txt")
      expect(diff.status).toBe("renamed")
      expect(diff.oldPath).toBe("旧 文件.txt")
      expect(diff.text).toContain("rename from")
      expect(diff.text).toContain("similarity index 100%")
    } finally {
      repo.cleanup()
    }
  })

  it("shows the link text of an untracked symlink instead of reading its target", async () => {
    const repo = mkTmpRepo()
    const outside = mkTmpDir()
    try {
      commit(repo.dir, { "a.txt": "one\n" }, "first")
      const secret = join(outside.dir, "secret.txt")
      writeFileSync(secret, "TOP SECRET\n")
      try {
        symlinkSync(secret, join(repo.dir, "link.txt"), "file")
      } catch {
        // File symlinks require developer mode on Windows; skip.
        return
      }

      const diff = await getDiff(repo.dir, { type: "working-tree" }, "link.txt")
      expect(diff.status).toBe("untracked")
      expect(diff.text).toContain("new file mode 120000")
      expect(diff.text).toContain("+")
      expect(diff.text).not.toContain("TOP SECRET")
    } finally {
      outside.cleanup()
      repo.cleanup()
    }
  })

  it("rejects absolute, traversal and UNC paths for every target", async () => {
    const repo = mkTmpRepo()
    try {
      const hash = commit(repo.dir, { "a.txt": "one\n" }, "first")
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
        await expect(
          getDiff(repo.dir, { type: "working-tree" }, filePath),
        ).rejects.toThrow(/Invalid file path/)
        await expect(getDiff(repo.dir, { type: "index" }, filePath)).rejects.toThrow(
          /Invalid file path/,
        )
        await expect(
          getDiff(repo.dir, { type: "commit", hash }, filePath),
        ).rejects.toThrow(/Invalid file path/)
      }
    } finally {
      repo.cleanup()
    }
  })

  it("treats wildcard characters in pathspecs literally", async () => {
    const repo = mkTmpRepo()
    try {
      commit(repo.dir, { "a1.txt": "one\n" }, "first")
      writeFileSync(join(repo.dir, "a1.txt"), "two\n")
      writeFileSync(join(repo.dir, "u1.txt"), "untracked\n")

      const tracked = await getDiff(repo.dir, { type: "working-tree" }, "a?.txt")
      expect(tracked.text).toBe("")

      const untracked = await getDiff(repo.dir, { type: "working-tree" }, "u?.txt")
      expect(untracked.status).toBe("modified")
      expect(untracked.text).toBe("")
    } finally {
      repo.cleanup()
    }
  })

  it("reports binary commit diffs without decoding their contents", async () => {
    const repo = mkTmpRepo()
    try {
      commit(repo.dir, { "blob.bin": "text\u0000binary" }, "first")
      const second = commit(repo.dir, { "blob.bin": "other\u0000binary" }, "second")

      const diff = await getDiff(repo.dir, { type: "commit", hash: second }, "blob.bin")
      expect(diff.status).toBe("modified")
      expect(diff.binary).toBe(true)
      expect(diff.text).toContain("Binary files")
    } finally {
      repo.cleanup()
    }
  })

  it("never executes a repository-configured external diff driver", async () => {
    const repo = mkTmpRepo()
    try {
      const root = commit(repo.dir, { "a.txt": "one\n" }, "first")
      const marker = join(repo.dir, "external-diff-ran.txt")
      const script = join(repo.dir, "external-diff.cjs")
      writeFileSync(
        script,
        `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "executed")\n`,
      )
      const node = "node"
      repo.git([
        "config",
        "diff.external",
        `${node} "${script.replace(/\\/g, "/")}"`,
      ])

      writeFileSync(join(repo.dir, "a.txt"), "two\n")
      const worktree = await getDiff(repo.dir, { type: "working-tree" }, "a.txt")
      expect(worktree.text).toContain("-one")

      repo.git(["add", "a.txt"])
      const index = await getDiff(repo.dir, { type: "index" }, "a.txt")
      expect(index.text).toContain("-one")

      const commitDiff = await getDiff(repo.dir, { type: "commit", hash: root }, "a.txt")
      expect(commitDiff.status).toBe("added")

      expect(existsSync(marker)).toBe(false)
    } finally {
      repo.cleanup()
    }
  })

  it("never executes a repository-configured textconv filter", async () => {
    const repo = mkTmpRepo()
    try {
      commit(repo.dir, { "a.txt": "one\n" }, "first")
      const marker = join(repo.dir, "textconv-ran.txt")
      const script = join(repo.dir, "textconv.cjs")
      writeFileSync(
        script,
        `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "executed")\n`,
      )
      const node = "node"
      repo.git([
        "config",
        "diff.evil.textconv",
        `${node} "${script.replace(/\\/g, "/")}"`,
      ])
      writeFileSync(join(repo.dir, ".gitattributes"), "*.txt diff=evil\n")
      writeFileSync(join(repo.dir, "a.txt"), "two\n")

      const diff = await getDiff(repo.dir, { type: "working-tree" }, "a.txt")
      expect(diff.text).toContain("-one")
      expect(existsSync(marker)).toBe(false)
    } finally {
      repo.cleanup()
    }
  })

  it("does not emit ANSI colors even when color.diff=always", async () => {
    const repo = mkTmpRepo()
    try {
      const root = commit(repo.dir, { "a.txt": "one\n" }, "first")
      repo.git(["config", "color.ui", "always"])
      repo.git(["config", "color.diff", "always"])
      writeFileSync(join(repo.dir, "a.txt"), "two\n")

      const worktree = await getDiff(repo.dir, { type: "working-tree" }, "a.txt")
      expect(worktree.status).toBe("modified")
      expect(worktree.text).not.toContain("\u001b[")

      repo.git(["add", "a.txt"])
      const index = await getDiff(repo.dir, { type: "index" }, "a.txt")
      expect(index.text).not.toContain("\u001b[")

      const commitDiff = await getDiff(repo.dir, { type: "commit", hash: root }, "a.txt")
      expect(commitDiff.text).not.toContain("\u001b[")
    } finally {
      repo.cleanup()
    }
  })

  it("does not treat source text mentioning binary files as binary", async () => {
    const repo = mkTmpRepo()
    try {
      commit(repo.dir, { "a.txt": "one\n" }, "first")
      const second = commit(
        repo.dir,
        { "a.txt": "Binary files a and b differ\n" },
        "second",
      )

      const diff = await getDiff(repo.dir, { type: "commit", hash: second }, "a.txt")
      expect(diff.binary).toBe(false)
      expect(diff.text).toContain("+Binary files a and b differ")
    } finally {
      repo.cleanup()
    }
  })

  it("does not execute configured clean/process filters for status or worktree diff", async () => {
    const repo = mkTmpRepo()
    try {
      commit(repo.dir, { "a.txt": "one\n" }, "first")
      const cleanMarker = join(repo.dir, "filter-clean-ran.txt")
      const processMarker = join(repo.dir, "filter-process-ran.txt")
      const cleanScript = join(repo.dir, "filter-clean.sh")
      const processScript = join(repo.dir, "filter-process.sh")
      writeFileSync(
        cleanScript,
        `#!/bin/sh\nprintf executed >> "${cleanMarker.replace(/\\/g, "/")}"\ncat\n`,
      )
      writeFileSync(
        processScript,
        `#!/bin/sh\nprintf executed >> "${processMarker.replace(/\\/g, "/")}"\nexit 1\n`,
      )
      chmodSync(cleanScript, 0o755)
      chmodSync(processScript, 0o755)
      repo.git(["config", "filter.evil.clean", `"${cleanScript.replace(/\\/g, "/")}"`])
      repo.git(["config", "filter.evil.process", `"${processScript.replace(/\\/g, "/")}"`])
      repo.git(["config", "filter.evil.required", "true"])
      writeFileSync(join(repo.dir, ".gitattributes"), "*.txt filter=evil\n")
      writeFileSync(join(repo.dir, "a.txt"), "two\n")

      const diff = await getDiff(repo.dir, { type: "working-tree" }, "a.txt")
      expect(diff.text).toContain("-one")
      expect(diff.text).toContain("+two")

      await getStatus(repo.dir)

      expect(existsSync(cleanMarker)).toBe(false)
      expect(existsSync(processMarker)).toBe(false)
    } finally {
      repo.cleanup()
    }
  })
})
