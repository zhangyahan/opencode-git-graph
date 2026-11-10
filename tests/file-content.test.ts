import { execFileSync } from "node:child_process"
import { symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { getCommitFileContent } from "../src/server/git/file-content.js"
import { commit, mkTmpRepo } from "./helpers.js"

/** Write a blob without a worktree file (needed for an oversized symlink). */
function hashBlob(repoDir: string, content: Buffer): string {
  return execFileSync("git", ["-C", repoDir, "--no-pager", "hash-object", "-w", "--stdin"], {
    input: content,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    windowsHide: true,
  }).trim()
}

describe("getCommitFileContent", () => {
  it("returns text from the selected commit tree, including non-ascii paths", async () => {
    const repo = mkTmpRepo()
    try {
      const root = commit(
        repo.dir,
        {
          "text.txt": "hello\nworld\n",
          "目录 中文 文件.txt": "你好\n",
        },
        "root",
      )

      await expect(getCommitFileContent(repo.dir, root, "text.txt")).resolves.toEqual({
        path: "text.txt",
        mode: "100644",
        kind: "text",
        text: "hello\nworld\n",
        size: 12,
      })
      await expect(getCommitFileContent(repo.dir, root, "目录 中文 文件.txt")).resolves.toEqual({
        path: "目录 中文 文件.txt",
        mode: "100644",
        kind: "text",
        text: "你好\n",
        size: 7,
      })
    } finally {
      repo.cleanup()
    }
  })

  it("reads exactly the requested commit, independent of parents and parents-to-be", async () => {
    const repo = mkTmpRepo()
    try {
      const first = commit(repo.dir, { "a.txt": "one\n" }, "first")
      const second = commit(repo.dir, { "a.txt": "two\n" }, "second")
      const third = commit(repo.dir, { "a.txt": null }, "delete")

      expect((await getCommitFileContent(repo.dir, first, "a.txt")).text).toBe("one\n")
      expect((await getCommitFileContent(repo.dir, second, "a.txt")).text).toBe("two\n")
      await expect(getCommitFileContent(repo.dir, third, "a.txt")).rejects.toThrow(/does not exist/)
    } finally {
      repo.cleanup()
    }
  })

  it("reports binary blobs by size without returning their bytes", async () => {
    const repo = mkTmpRepo()
    try {
      const hash = commit(repo.dir, { "blob.bin": "abc\u0000def" }, "binary")
      await expect(getCommitFileContent(repo.dir, hash, "blob.bin")).resolves.toEqual({
        path: "blob.bin",
        mode: "100644",
        kind: "binary",
        text: null,
        size: 7,
      })
    } finally {
      repo.cleanup()
    }
  })

  it("truncates text larger than 1 MiB and flags the result", async () => {
    const repo = mkTmpRepo()
    try {
      const content = "a".repeat(1024 * 1024 + 128)
      const hash = commit(repo.dir, { "large.txt": content }, "large")

      const result = await getCommitFileContent(repo.dir, hash, "large.txt")
      expect(result.kind).toBe("text")
      expect(result.size).toBe(Buffer.byteLength(content, "utf8"))
      expect(result.truncated).toBe(true)
      expect(Buffer.byteLength(result.text ?? "", "utf8")).toBe(1024 * 1024)
      expect(result.text?.startsWith("aaaa")).toBe(true)
    } finally {
      repo.cleanup()
    }
  })

  it("truncates on a UTF-8 code point boundary without U+FFFD", async () => {
    const repo = mkTmpRepo()
    try {
      const prefix = "a".repeat(1024 * 1024 - 2)
      const content = `${prefix}😀`
      const hash = commit(repo.dir, { "emoji.txt": content }, "emoji")

      const result = await getCommitFileContent(repo.dir, hash, "emoji.txt")
      expect(result.kind).toBe("text")
      expect(result.truncated).toBe(true)
      expect(result.text).toBe(prefix)
      expect(result.text).not.toContain("\uFFFD")
      expect(Buffer.byteLength(result.text ?? "", "utf8")).toBe(1024 * 1024 - 2)
      expect(result.size).toBe(Buffer.byteLength(content, "utf8"))
    } finally {
      repo.cleanup()
    }
  })

  it("returns size only for blobs above the 20 MiB executor buffer", async () => {
    const repo = mkTmpRepo()
    try {
      const bytes = 20 * 1024 * 1024 + 1
      writeFileSync(join(repo.dir, "huge.txt"), Buffer.alloc(bytes, 97))
      repo.git(["add", "-A"])
      repo.git(["commit", "-m", "huge"])
      const hash = repo.git(["rev-parse", "HEAD"]).trim()

      await expect(getCommitFileContent(repo.dir, hash, "huge.txt")).resolves.toEqual({
        path: "huge.txt",
        mode: "100644",
        kind: "text",
        text: null,
        size: bytes,
        truncated: true,
      })
    } finally {
      repo.cleanup()
    }
  }, 30_000)

  it("keeps kind symlink for an oversized link target without reading it", async () => {
    const repo = mkTmpRepo()
    try {
      const bytes = 20 * 1024 * 1024 + 1
      const blob = hashBlob(repo.dir, Buffer.alloc(bytes, 97))
      repo.git(["update-index", "--add", "--cacheinfo", `120000,${blob},huge-link`])
      repo.git(["commit", "-m", "huge symlink"])
      const hash = repo.git(["rev-parse", "HEAD"]).trim()

      await expect(getCommitFileContent(repo.dir, hash, "huge-link")).resolves.toEqual({
        path: "huge-link",
        mode: "120000",
        kind: "symlink",
        text: null,
        size: bytes,
        truncated: true,
      })
    } finally {
      repo.cleanup()
    }
  }, 30_000)

  it("returns the stored link target for symlinks instead of following it", async () => {
    const repo = mkTmpRepo()
    try {
      commit(repo.dir, { "text.txt": "hello\n" }, "target")
      try {
        symlinkSync("text.txt", join(repo.dir, "link.txt"), "file")
      } catch {
        // Symlinks require developer mode on Windows; skip.
        return
      }
      const hash = commit(repo.dir, {}, "link", { allowEmpty: true })

      await expect(getCommitFileContent(repo.dir, hash, "link.txt")).resolves.toEqual({
        path: "link.txt",
        mode: "120000",
        kind: "symlink",
        text: "text.txt",
        size: 8,
      })
    } finally {
      repo.cleanup()
    }
  })

  it("reports gitlinks as missing without entering the submodule", async () => {
    const repo = mkTmpRepo()
    try {
      const target = commit(repo.dir, { "a.txt": "one\n" }, "base")
      repo.git(["update-index", "--add", "--cacheinfo", `160000,${target},vendor/module`])
      repo.git(["commit", "-m", "gitlink"])
      const hash = repo.git(["rev-parse", "HEAD"]).trim()

      await expect(getCommitFileContent(repo.dir, hash, "vendor/module")).resolves.toEqual({
        path: "vendor/module",
        mode: "160000",
        kind: "missing",
        text: null,
        size: null,
      })
    } finally {
      repo.cleanup()
    }
  })

  it("rejects unknown paths, directories, invalid ids and unsafe paths", async () => {
    const repo = mkTmpRepo()
    try {
      const hash = commit(repo.dir, { "dir/a.txt": "one\n" }, "root")

      await expect(getCommitFileContent(repo.dir, hash, "missing.txt")).rejects.toThrow(
        /does not exist/,
      )
      await expect(getCommitFileContent(repo.dir, hash, "dir")).rejects.toThrow(/not a file/)

      for (const invalid of ["--all", "HEAD", "main~1", "zzzz", "a".repeat(65), ""]) {
        await expect(getCommitFileContent(repo.dir, invalid, "dir/a.txt")).rejects.toThrow(
          /Invalid commit oid/,
        )
      }

      const tree = repo.git(["rev-parse", `${hash}^{tree}`]).trim()
      await expect(getCommitFileContent(repo.dir, tree, "dir/a.txt")).rejects.toThrow(
        /Invalid commit oid/,
      )
      await expect(
        getCommitFileContent(repo.dir, "f".repeat(40), "dir/a.txt"),
      ).rejects.toThrow(/Invalid commit oid/)
      for (const unsafe of [
        "",
        "../outside.txt",
        "nested/../../outside.txt",
        "/etc/passwd",
        "C:\\temp\\outside.txt",
        "C:relative.txt",
        "\\\\server\\share\\file.txt",
        "a.txt\0b.txt",
      ]) {
        await expect(getCommitFileContent(repo.dir, hash, unsafe)).rejects.toThrow(
          /Invalid file path/,
        )
      }

      // The real path still works after the rejected attempts.
      await expect(getCommitFileContent(repo.dir, hash, "dir/a.txt")).resolves.toMatchObject({
        kind: "text",
        text: "one\n",
      })
    } finally {
      repo.cleanup()
    }
  })

  it("honours cancellation before starting git", async () => {
    const repo = mkTmpRepo()
    try {
      const hash = commit(repo.dir, { "a.txt": "one\n" }, "root")
      const controller = new AbortController()
      controller.abort()
      await expect(
        getCommitFileContent(repo.dir, hash, "a.txt", { signal: controller.signal }),
      ).rejects.toThrow(/abort/i)
    } finally {
      repo.cleanup()
    }
  })

  it("does not write to the repository", async () => {
    const repo = mkTmpRepo()
    try {
      const hash = commit(repo.dir, { "a.txt": "one\n" }, "root")
      const before = repo.git(["status", "--porcelain=v1", "-z"])
      await getCommitFileContent(repo.dir, hash, "a.txt")
      expect(repo.git(["status", "--porcelain=v1", "-z"])).toBe(before)
    } finally {
      repo.cleanup()
    }
  })

  it("reads through a detached HEAD and a merge commit's tree", async () => {
    const repo = mkTmpRepo()
    try {
      const base = commit(repo.dir, { "a.txt": "base\n" }, "base")
      repo.git(["checkout", "-b", "side"])
      const side = commit(repo.dir, { "side.txt": "side\n" }, "side")
      repo.git(["checkout", "main"])
      commit(repo.dir, { "main.txt": "main\n" }, "main")
      repo.git(["merge", "--no-ff", "-m", "merge", side])
      const merge = repo.git(["rev-parse", "HEAD"]).trim()

      await expect(getCommitFileContent(repo.dir, merge, "a.txt")).resolves.toMatchObject({
        text: "base\n",
        kind: "text",
      })
      repo.git(["checkout", "--detach"])
      await expect(getCommitFileContent(repo.dir, merge, "side.txt")).resolves.toMatchObject({
        text: "side\n",
      })
      expect(base).not.toBe(merge)
      writeFileSync(join(repo.dir, "untracked.txt"), "ignored\n")
    } finally {
      repo.cleanup()
    }
  })
})
