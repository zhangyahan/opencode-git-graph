import { describe, expect, it } from "vitest"
import { getRefs } from "../src/server/git/refs.js"
import { commit, mkTmpRepo } from "./helpers.js"

describe("getRefs", () => {
  it("lists branches with commit hashes plus the attached head entry", async () => {
    const repo = mkTmpRepo()
    try {
      const hash = commit(repo.dir, { "a.txt": "one\n" }, "first")
      repo.git(["branch", "feature"])
      repo.git(["tag", "v1.0.0"])

      const refs = await getRefs(repo.dir)

      expect(refs).toContainEqual({ name: "main", hash, kind: "branch" })
      expect(refs).toContainEqual({ name: "feature", hash, kind: "branch" })
      expect(refs).toContainEqual({ name: "v1.0.0", hash, kind: "tag" })
      expect(refs).toContainEqual({ name: "main", hash, kind: "head" })
    } finally {
      repo.cleanup()
    }
  })

  it("resolves annotated tags to the commit they point at", async () => {
    const repo = mkTmpRepo()
    try {
      const hash = commit(repo.dir, { "a.txt": "one\n" }, "first")
      repo.git(["tag", "-a", "v2.0.0", "-m", "annotated release"])

      const tagObject = repo.git(["rev-parse", "v2.0.0"]).trim()
      expect(tagObject).not.toBe(hash)

      const refs = await getRefs(repo.dir)
      const tag = refs.find((ref) => ref.kind === "tag")
      expect(tag).toEqual({ name: "v2.0.0", hash, kind: "tag" })
      expect(tag?.hash).toBe(repo.git(["rev-parse", "v2.0.0^{commit}"]).trim())
    } finally {
      repo.cleanup()
    }
  })

  it("exposes a detached HEAD entry that can be graphed", async () => {
    const repo = mkTmpRepo()
    try {
      const hash = commit(repo.dir, { "a.txt": "one\n" }, "only")
      repo.git(["checkout", "--detach", hash])
      repo.git(["branch", "-D", "main"])

      const refs = await getRefs(repo.dir)
      expect(refs).toContainEqual({ name: "HEAD", hash, kind: "head" })
      expect(refs.filter((ref) => ref.kind === "branch")).toEqual([])
    } finally {
      repo.cleanup()
    }
  })

  it("returns no refs for an empty repository", async () => {
    const repo = mkTmpRepo()
    try {
      await expect(getRefs(repo.dir)).resolves.toEqual([])
    } finally {
      repo.cleanup()
    }
  })
})
