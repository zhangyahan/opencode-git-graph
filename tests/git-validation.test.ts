import { symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { filterOverrideArgs } from "../src/server/git/safety.js"
import {
  assertCommitOid,
  assertLogLimit,
  assertLogSkip,
  assertParentIndex,
  assertParentIndexInRange,
  assertRelativeFilePath,
  GitInputError,
  resolveRepositoryPath,
} from "../src/server/git/validation.js"
import { mkTmpDir, mkTmpRepo } from "./helpers.js"

describe("commit oid validation", () => {
  it("accepts abbreviated and full hexadecimal ids", () => {
    expect(assertCommitOid("abcd")).toBe("abcd")
    expect(assertCommitOid("A1B2C3D4")).toBe("A1B2C3D4")
    expect(assertCommitOid("a".repeat(64))).toBe("a".repeat(64))
  })

  it("rejects options, ref expressions and malformed ids", () => {
    const invalid = [
      "",
      "abc",
      "a".repeat(65),
      "HEAD",
      "main",
      "main~1",
      "HEAD^2",
      ":/message",
      "--output=owned.txt",
      "-n1",
      "deadbeef ",
      "dead beef",
    ]
    for (const value of invalid) {
      expect(() => assertCommitOid(value), value).toThrow(GitInputError)
    }
  })
})

describe("parent index validation", () => {
  it("requires a non-negative integer", () => {
    expect(assertParentIndex(undefined)).toBe(0)
    expect(assertParentIndex(2)).toBe(2)
    for (const value of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "0"]) {
      expect(() => assertParentIndex(value)).toThrow(/non-negative integer/)
    }
  })

  it("rejects out-of-range indexes but allows the root empty-tree index", () => {
    expect(assertParentIndexInRange(0, 1)).toBe(0)
    expect(assertParentIndexInRange(1, 2)).toBe(1)
    expect(assertParentIndexInRange(0, 0)).toBe(0)
    expect(() => assertParentIndexInRange(1, 1)).toThrow(/out of range/)
    expect(() => assertParentIndexInRange(2, 2)).toThrow(/out of range/)
    expect(() => assertParentIndexInRange(1, 0)).toThrow(/root commit/)
  })
})

describe("relative file path validation", () => {
  it("keeps safe nested paths and normalizes separators", () => {
    expect(assertRelativeFilePath("a.txt")).toBe("a.txt")
    expect(assertRelativeFilePath("src/中文 文件.txt")).toBe("src/中文 文件.txt")
    expect(assertRelativeFilePath("src\\nested\\file.txt")).toBe("src/nested/file.txt")
  })

  it("rejects empty, NUL, absolute, drive, UNC and traversal paths", () => {
    const invalid = [
      "",
      "a.txt\0b.txt",
      "/etc/passwd",
      "\\etc\\passwd",
      "C:\\temp\\a.txt",
      "C:relative.txt",
      "\\\\server\\share\\a.txt",
      "//server/share/a.txt",
      "../outside.txt",
      "nested/../../outside.txt",
      "nested\\..\\outside.txt",
    ]
    for (const value of invalid) {
      expect(() => assertRelativeFilePath(value), value).toThrow(/Invalid file path/)
    }
  })
})

describe("resolveRepositoryPath", () => {
  it("resolves files inside the repository", async () => {
    const repo = mkTmpRepo()
    try {
      writeFileSync(join(repo.dir, "a.txt"), "hello\n")
      const resolved = await resolveRepositoryPath(repo.dir, "a.txt")
      expect(resolved.kind).toBe("file")
      expect(resolved.absolutePath.endsWith("a.txt")).toBe(true)
    } finally {
      repo.cleanup()
    }
  })

  it("refuses to traverse a symlinked parent directory outside the repository", async () => {
    const repo = mkTmpRepo()
    const outside = mkTmpDir()
    try {
      writeFileSync(join(outside.dir, "secret.txt"), "TOP SECRET\n")
      try {
        symlinkSync(
          outside.dir,
          join(repo.dir, "linked-outside"),
          process.platform === "win32" ? "junction" : "dir",
        )
      } catch {
        // Symlink creation can be unavailable without privileges; skip.
        return
      }

      await expect(
        resolveRepositoryPath(repo.dir, "linked-outside/secret.txt"),
      ).rejects.toThrow(/outside the repository/)
    } finally {
      outside.cleanup()
      repo.cleanup()
    }
  })

  it("returns link text for a final symlink instead of following it", async () => {
    const repo = mkTmpRepo()
    const outside = mkTmpDir()
    try {
      const secret = join(outside.dir, "secret.txt")
      writeFileSync(secret, "TOP SECRET\n")
      try {
        symlinkSync(secret, join(repo.dir, "link.txt"), "file")
      } catch {
        // File symlinks require developer mode on Windows; skip.
        return
      }

      const resolved = await resolveRepositoryPath(repo.dir, "link.txt")
      expect(resolved.kind).toBe("symlink")
      expect(resolved.linkTarget).toBe(secret)
    } finally {
      outside.cleanup()
      repo.cleanup()
    }
  })
})

describe("log pagination validation", () => {
  it("accepts bounded positive limits and non-negative skips", () => {
    expect(assertLogLimit(1)).toBe(1)
    expect(assertLogLimit(1000)).toBe(1000)
    expect(assertLogSkip(0)).toBe(0)
    expect(assertLogSkip(10_000_000)).toBe(10_000_000)
  })

  it("rejects non-finite, fractional and unbounded values", () => {
    for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 1001]) {
      expect(() => assertLogLimit(value)).toThrow(/Invalid log limit/)
    }
    for (const value of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 10_000_001]) {
      expect(() => assertLogSkip(value)).toThrow(/Invalid log skip/)
    }
  })
})

describe("filter configuration safety", () => {
  it("builds command-line overrides for each configured driver", async () => {
    const repo = mkTmpRepo()
    try {
      repo.git(["config", "filter.evil.clean", "node evil.js"])
      repo.git(["config", "filter.evil.process", "node evil2.js"])
      repo.git(["config", "filter.evil.required", "true"])

      const args = await filterOverrideArgs(repo.dir)
      expect(args).toEqual(
        expect.arrayContaining([
          "-c",
          "filter.evil.clean=",
          "-c",
          "filter.evil.process=",
          "-c",
          "filter.evil.required=false",
        ]),
      )
    } finally {
      repo.cleanup()
    }
  })

  it("refuses driver names that cannot be safely overridden", async () => {
    const repo = mkTmpRepo()
    try {
      repo.git(["config", "filter.a=b.clean", "node evil.js"])
      await expect(filterOverrideArgs(repo.dir)).rejects.toThrow(/unsupported driver name/)
    } finally {
      repo.cleanup()
    }
  })
})
