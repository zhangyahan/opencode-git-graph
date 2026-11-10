import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it as vitestIt } from "vitest"
import {
  checkoutBranch,
  createBranch,
  createTag,
  deleteBranch,
  deleteTag,
  GitMutationError,
  renameBranch,
} from "../src/server/git/mutations.js"
import { GitInputError } from "../src/server/git/validation.js"
import { commit, mkTmpDir, mkTmpRepo, type TmpRepo } from "./helpers.js"

// Integration tests run real git processes; allow enough time per case without
// raising the timeout for the rest of the suite.
const TEST_TIMEOUT = 15_000
function it(name: string, run: () => Promise<void>): void {
  vitestIt(name, run, TEST_TIMEOUT)
}

function head(repo: TmpRepo): string {
  return repo.git(["rev-parse", "HEAD"]).trim()
}

function currentBranch(repo: TmpRepo): string {
  return repo.git(["symbolic-ref", "--short", "HEAD"]).trim()
}

async function failure(promise: Promise<unknown>): Promise<GitMutationError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  )
  expect(error).toBeInstanceOf(GitMutationError)
  return error as GitMutationError
}

describe("checkoutBranch", () => {
  it("switches to an existing local branch and returns the refreshed status", async () => {
    const repo = mkTmpRepo()
    try {
      const base = commit(repo.dir, { "a.txt": "base\n" }, "base")
      repo.git(["branch", "feature"])

      const result = await checkoutBranch(repo.dir, { branch: "feature", expectedHead: base })

      expect(result.changed).toBe(true)
      expect(result.status.branch).toBe("feature")
      expect(result.status.head).toBe(base)
      expect(result.status.detached).toBe(false)
      expect(result.warning).toBeUndefined()
      expect(currentBranch(repo)).toBe("feature")
    } finally {
      repo.cleanup()
    }
  })

  it("treats switching to the current branch as a no-op even with dirty files", async () => {
    const repo = mkTmpRepo()
    try {
      const base = commit(repo.dir, { "a.txt": "base\n" }, "base")
      writeFileSync(join(repo.dir, "a.txt"), "dirty\n")

      const result = await checkoutBranch(repo.dir, { branch: "main", expectedHead: base })

      expect(result.changed).toBe(false)
      expect(result.status.branch).toBe("main")
      expect(readFileSync(join(repo.dir, "a.txt"), "utf8")).toBe("dirty\n")
    } finally {
      repo.cleanup()
    }
  })

  it("refuses to switch with unstaged tracked changes and keeps the content", async () => {
    const repo = mkTmpRepo()
    try {
      const base = commit(repo.dir, { "a.txt": "base\n" }, "base")
      repo.git(["branch", "feature"])
      writeFileSync(join(repo.dir, "a.txt"), "changed\n")

      const error = await failure(checkoutBranch(repo.dir, { branch: "feature", expectedHead: base }))

      expect(error.reason).toBe("dirty")
      expect(currentBranch(repo)).toBe("main")
      expect(readFileSync(join(repo.dir, "a.txt"), "utf8")).toBe("changed\n")
    } finally {
      repo.cleanup()
    }
  })

  it("refuses to switch with staged changes and keeps the index", async () => {
    const repo = mkTmpRepo()
    try {
      const base = commit(repo.dir, { "a.txt": "base\n" }, "base")
      repo.git(["branch", "feature"])
      writeFileSync(join(repo.dir, "a.txt"), "staged\n")
      repo.git(["add", "a.txt"])

      const error = await failure(checkoutBranch(repo.dir, { branch: "feature", expectedHead: base }))

      expect(error.reason).toBe("dirty")
      expect(currentBranch(repo)).toBe("main")
      expect(repo.git(["diff", "--cached", "--name-only"]).trim()).toBe("a.txt")
    } finally {
      repo.cleanup()
    }
  })

  it("refuses to switch with unresolved conflicts and leaves the conflict markers intact", async () => {
    const repo = mkTmpRepo()
    try {
      commit(repo.dir, { "a.txt": "base\n" }, "base")
      repo.git(["branch", "other"])
      repo.git(["checkout", "-b", "side"])
      commit(repo.dir, { "a.txt": "side\n" }, "side")
      repo.git(["checkout", "main"])
      commit(repo.dir, { "a.txt": "main\n" }, "main")
      const merge = repo.tryGit(["merge", "side"])
      expect(merge.status).not.toBe(0)
      const conflicted = readFileSync(join(repo.dir, "a.txt"), "utf8")

      const error = await failure(checkoutBranch(repo.dir, { branch: "other", expectedHead: null }))

      expect(error.reason).toBe("conflicted")
      expect(currentBranch(repo)).toBe("main")
      expect(readFileSync(join(repo.dir, "a.txt"), "utf8")).toBe(conflicted)
    } finally {
      repo.cleanup()
    }
  })

  it("keeps untracked files that block the native checkout guard", async () => {
    const repo = mkTmpRepo()
    try {
      commit(repo.dir, { "a.txt": "base\n" }, "base")
      repo.git(["checkout", "-b", "feature"])
      commit(repo.dir, { "collision.txt": "tracked\n" }, "feature")
      repo.git(["checkout", "main"])
      writeFileSync(join(repo.dir, "collision.txt"), "mine\n")

      const error = await failure(checkoutBranch(repo.dir, { branch: "feature", expectedHead: null }))

      expect(error.reason).toBe("untracked_collision")
      expect(currentBranch(repo)).toBe("main")
      expect(readFileSync(join(repo.dir, "collision.txt"), "utf8")).toBe("mine\n")
    } finally {
      repo.cleanup()
    }
  })

  it("keeps ignored files that the target branch would silently overwrite", async () => {
    const repo = mkTmpRepo()
    try {
      commit(repo.dir, { ".gitignore": "secret.txt\n" }, "base")
      repo.git(["checkout", "-b", "feature"])
      writeFileSync(join(repo.dir, "secret.txt"), "tracked\n")
      repo.git(["add", "-f", "secret.txt"])
      repo.git(["commit", "-m", "tracked secret"])
      repo.git(["checkout", "main"])
      writeFileSync(join(repo.dir, "secret.txt"), "local-only\n")

      const error = await failure(checkoutBranch(repo.dir, { branch: "feature", expectedHead: null }))

      expect(error.reason).toBe("untracked_collision")
      expect(currentBranch(repo)).toBe("main")
      expect(readFileSync(join(repo.dir, "secret.txt"), "utf8")).toBe("local-only\n")
    } finally {
      repo.cleanup()
    }
  })

  it("rejects unknown names, remote-tracking refs and tags (no DWIM)", async () => {
    const repo = mkTmpRepo()
    try {
      const base = commit(repo.dir, { "a.txt": "base\n" }, "base")
      repo.git(["update-ref", "refs/remotes/origin/feature", base])
      repo.git(["tag", "v1"])

      for (const name of ["missing", "origin/feature", "v1"]) {
        const error = await failure(checkoutBranch(repo.dir, { branch: name, expectedHead: base }))
        expect(error.reason).toBe("branch_not_found")
      }
      expect(currentBranch(repo)).toBe("main")
    } finally {
      repo.cleanup()
    }
  })

  it("refuses a branch checked out in another worktree", async () => {
    const repo = mkTmpRepo()
    const worktree = mkTmpDir("git-graph-worktree-")
    try {
      const base = commit(repo.dir, { "a.txt": "base\n" }, "base")
      repo.git(["worktree", "add", "-b", "feature", worktree.dir, base])

      const error = await failure(checkoutBranch(repo.dir, { branch: "feature", expectedHead: base }))

      expect(error.reason).toBe("branch_in_use")
      expect(currentBranch(repo)).toBe("main")
    } finally {
      repo.tryGit(["worktree", "remove", "--force", worktree.dir])
      worktree.cleanup()
      repo.cleanup()
    }
  })

  it("rejects a stale expectedHead before switching", async () => {
    const repo = mkTmpRepo()
    try {
      const first = commit(repo.dir, { "a.txt": "one\n" }, "one")
      commit(repo.dir, { "a.txt": "two\n" }, "two")

      const error = await failure(checkoutBranch(repo.dir, { branch: "main", expectedHead: first }))

      expect(error.reason).toBe("head_mismatch")
      expect(currentBranch(repo)).toBe("main")
    } finally {
      repo.cleanup()
    }
  })

  it("rejects switching in an unborn repository", async () => {
    const repo = mkTmpRepo()
    try {
      const error = await failure(checkoutBranch(repo.dir, { branch: "main", expectedHead: null }))
      expect(error.reason).toBe("unborn")
    } finally {
      repo.cleanup()
    }
  })

  it("validates expectedHead format and cancellation before writing", async () => {
    const repo = mkTmpRepo()
    try {
      const base = commit(repo.dir, { "a.txt": "base\n" }, "base")
      repo.git(["branch", "feature"])
      await expect(
        checkoutBranch(repo.dir, { branch: "feature", expectedHead: "abc" }),
      ).rejects.toBeInstanceOf(GitInputError)
      await expect(
        checkoutBranch(repo.dir, {
          branch: "feature",
          expectedHead: base.slice(0, 39),
        }),
      ).rejects.toBeInstanceOf(GitInputError)

      const controller = new AbortController()
      controller.abort()
      await expect(
        checkoutBranch(repo.dir, {
          branch: "feature",
          expectedHead: base,
          signal: controller.signal,
        }),
      ).rejects.toMatchObject({ name: "AbortError" })
      expect(currentBranch(repo)).toBe("main")
    } finally {
      repo.cleanup()
    }
  })
})

describe("createBranch", () => {
  it("creates a metadata-only branch without touching a dirty worktree", async () => {
    const repo = mkTmpRepo()
    try {
      const base = commit(repo.dir, { "a.txt": "base\n" }, "base")
      writeFileSync(join(repo.dir, "a.txt"), "dirty\n")

      const result = await createBranch(repo.dir, {
        name: "feature",
        startPoint: base,
        checkout: false,
        expectedHead: base,
      })

      expect(result.changed).toBe(true)
      expect(repo.git(["rev-parse", "refs/heads/feature"]).trim()).toBe(base)
      expect(currentBranch(repo)).toBe("main")
      expect(readFileSync(join(repo.dir, "a.txt"), "utf8")).toBe("dirty\n")

      // Other metadata-only operations are also allowed on a dirty worktree.
      const tag = await createTag(repo.dir, { name: "v1", target: base, expectedHead: base })
      expect(tag.changed).toBe(true)

      const renamed = await renameBranch(repo.dir, {
        oldName: "feature",
        newName: "feature-renamed",
        expectedHead: base,
      })
      expect(renamed.changed).toBe(true)
      expect(repo.git(["rev-parse", "refs/heads/feature-renamed"]).trim()).toBe(base)
    } finally {
      repo.cleanup()
    }
  })

  it("creates and checks out a branch from a commit id", async () => {
    const repo = mkTmpRepo()
    try {
      const base = commit(repo.dir, { "a.txt": "base\n" }, "base")
      const result = await createBranch(repo.dir, {
        name: "feature",
        startPoint: base,
        checkout: true,
        expectedHead: base,
      })

      expect(result.changed).toBe(true)
      expect(result.status.branch).toBe("feature")
      expect(currentBranch(repo)).toBe("feature")
    } finally {
      repo.cleanup()
    }
  })

  it("does not create a branch when checkout is requested from a dirty worktree", async () => {
    const repo = mkTmpRepo()
    try {
      const base = commit(repo.dir, { "a.txt": "base\n" }, "base")
      writeFileSync(join(repo.dir, "a.txt"), "dirty\n")

      const error = await failure(
        createBranch(repo.dir, {
          name: "feature",
          startPoint: base,
          checkout: true,
          expectedHead: base,
        }),
      )

      expect(error.reason).toBe("dirty")
      expect(repo.tryGit(["rev-parse", "--verify", "refs/heads/feature"]).status).not.toBe(0)
    } finally {
      repo.cleanup()
    }
  })

  it("refuses to overwrite an existing branch", async () => {
    const repo = mkTmpRepo()
    try {
      const base = commit(repo.dir, { "a.txt": "base\n" }, "base")
      repo.git(["branch", "feature"])

      const error = await failure(
        createBranch(repo.dir, {
          name: "feature",
          startPoint: base,
          expectedHead: base,
        }),
      )
      expect(error.reason).toBe("target_exists")
    } finally {
      repo.cleanup()
    }
  })

  it("rejects a non-commit start point", async () => {
    const repo = mkTmpRepo()
    try {
      const base = commit(repo.dir, { "a.txt": "base\n" }, "base")
      writeFileSync(join(repo.dir, "blob.txt"), "blob\n")
      const blob = repo.git(["hash-object", "-w", "blob.txt"]).trim()

      const error = await failure(
        createBranch(repo.dir, { name: "feature", startPoint: blob, expectedHead: base }),
      )
      expect(error.reason).toBe("invalid_target")
    } finally {
      repo.cleanup()
    }
  })

  it("reports a typed partial failure when the branch is created but checkout fails", async () => {
    const repo = mkTmpRepo()
    try {
      commit(repo.dir, { "a.txt": "base\n" }, "base")
      repo.git(["checkout", "-b", "feature"])
      commit(repo.dir, { "collision.txt": "tracked\n" }, "feature")
      const featureHead = head(repo)
      repo.git(["checkout", "main"])
      writeFileSync(join(repo.dir, "collision.txt"), "mine\n")

      const error = await failure(
        createBranch(repo.dir, {
          name: "from-feature",
          startPoint: featureHead,
          checkout: true,
          expectedHead: null,
        }),
      )

      expect(error.reason).toBe("partial_failure")
      expect(repo.git(["rev-parse", "refs/heads/from-feature"]).trim()).toBe(featureHead)
      expect(readFileSync(join(repo.dir, "collision.txt"), "utf8")).toBe("mine\n")
    } finally {
      repo.cleanup()
    }
  })

  it("rejects option-like and malformed names", async () => {
    const repo = mkTmpRepo()
    try {
      const base = commit(repo.dir, { "a.txt": "base\n" }, "base")
      for (const name of ["--output=evil.txt", "bad..name", "ends.", "dir/.hidden", "x.lock"]) {
        const error = await failure(
          createBranch(repo.dir, { name, startPoint: base, expectedHead: base }),
        )
        expect(error.reason).toBe("invalid_name")
      }
      expect(existsSync(join(repo.dir, "evil.txt"))).toBe(false)
    } finally {
      repo.cleanup()
    }
  })
})

describe("renameBranch and deleteBranch", () => {
  it("renames a local branch", async () => {
    const repo = mkTmpRepo()
    try {
      const base = commit(repo.dir, { "a.txt": "base\n" }, "base")
      repo.git(["branch", "old"])

      const result = await renameBranch(repo.dir, {
        oldName: "old",
        newName: "renamed",
        expectedHead: base,
      })

      expect(result.changed).toBe(true)
      expect(repo.tryGit(["rev-parse", "--verify", "refs/heads/old"]).status).not.toBe(0)
      expect(repo.git(["rev-parse", "refs/heads/renamed"]).trim()).toBe(base)
    } finally {
      repo.cleanup()
    }
  })

  it("renames the current branch and reports the new name", async () => {
    const repo = mkTmpRepo()
    try {
      const base = commit(repo.dir, { "a.txt": "base\n" }, "base")

      const result = await renameBranch(repo.dir, {
        oldName: "main",
        newName: "trunk",
        expectedHead: base,
      })

      expect(result.status.branch).toBe("trunk")
      expect(currentBranch(repo)).toBe("trunk")
    } finally {
      repo.cleanup()
    }
  })

  it("refuses to rename onto an existing branch or rename a missing branch", async () => {
    const repo = mkTmpRepo()
    try {
      const base = commit(repo.dir, { "a.txt": "base\n" }, "base")
      repo.git(["branch", "one"])
      repo.git(["branch", "two"])

      const exists = await failure(
        renameBranch(repo.dir, { oldName: "one", newName: "two", expectedHead: base }),
      )
      expect(exists.reason).toBe("target_exists")

      const missing = await failure(
        renameBranch(repo.dir, { oldName: "missing", newName: "new", expectedHead: base }),
      )
      expect(missing.reason).toBe("branch_not_found")
    } finally {
      repo.cleanup()
    }
  })

  it("deletes a fully merged branch", async () => {
    const repo = mkTmpRepo()
    try {
      const base = commit(repo.dir, { "a.txt": "base\n" }, "base")
      repo.git(["branch", "merged"])

      const result = await deleteBranch(repo.dir, { name: "merged", expectedHead: base })

      expect(result.changed).toBe(true)
      expect(repo.tryGit(["rev-parse", "--verify", "refs/heads/merged"]).status).not.toBe(0)
    } finally {
      repo.cleanup()
    }
  })

  it("refuses to delete an unmerged branch (no -D)", async () => {
    const repo = mkTmpRepo()
    try {
      commit(repo.dir, { "a.txt": "base\n" }, "base")
      repo.git(["checkout", "-b", "side"])
      commit(repo.dir, { "side.txt": "side\n" }, "side")
      repo.git(["checkout", "main"])

      const error = await failure(deleteBranch(repo.dir, { name: "side", expectedHead: null }))

      expect(error.reason).toBe("not_merged")
      expect(repo.tryGit(["rev-parse", "--verify", "refs/heads/side"]).status).toBe(0)
      expect(currentBranch(repo)).toBe("main")
    } finally {
      repo.cleanup()
    }
  })

  it("refuses to delete the current branch or a missing branch", async () => {
    const repo = mkTmpRepo()
    try {
      const base = commit(repo.dir, { "a.txt": "base\n" }, "base")

      const current = await failure(deleteBranch(repo.dir, { name: "main", expectedHead: base }))
      expect(current.reason).toBe("branch_in_use")

      const missing = await failure(
        deleteBranch(repo.dir, { name: "missing", expectedHead: base }),
      )
      expect(missing.reason).toBe("branch_not_found")
      expect(currentBranch(repo)).toBe("main")
    } finally {
      repo.cleanup()
    }
  })

  it("refuses operations when expectedHead is stale", async () => {
    const repo = mkTmpRepo()
    try {
      const first = commit(repo.dir, { "a.txt": "one\n" }, "one")
      repo.git(["branch", "candidate"])
      commit(repo.dir, { "a.txt": "two\n" }, "two")

      const renameError = await failure(
        renameBranch(repo.dir, {
          oldName: "candidate",
          newName: "renamed",
          expectedHead: first,
        }),
      )
      expect(renameError.reason).toBe("head_mismatch")

      const deleteError = await failure(
        deleteBranch(repo.dir, { name: "candidate", expectedHead: first }),
      )
      expect(deleteError.reason).toBe("head_mismatch")
      expect(repo.tryGit(["rev-parse", "--verify", "refs/heads/candidate"]).status).toBe(0)
    } finally {
      repo.cleanup()
    }
  })
})

describe("tags", () => {
  it("creates a lightweight tag", async () => {
    const repo = mkTmpRepo()
    try {
      const base = commit(repo.dir, { "a.txt": "base\n" }, "base")

      const result = await createTag(repo.dir, {
        name: "v1",
        target: base,
        expectedHead: base,
      })

      expect(result.changed).toBe(true)
      expect(repo.git(["cat-file", "-t", "refs/tags/v1"]).trim()).toBe("commit")
      expect(repo.git(["rev-parse", "refs/tags/v1"]).trim()).toBe(base)
    } finally {
      repo.cleanup()
    }
  })

  it("creates an unsigned annotated tag even when tag signing is enabled", async () => {
    const repo = mkTmpRepo()
    try {
      const base = commit(repo.dir, { "a.txt": "base\n" }, "base")
      repo.git(["config", "tag.gpgsign", "true"])
      repo.git(["config", "user.signingkey", "definitely-not-a-key"])

      await createTag(repo.dir, {
        name: "v2",
        target: base,
        message: "release notes",
        expectedHead: base,
      })

      expect(repo.git(["cat-file", "-t", "refs/tags/v2"]).trim()).toBe("tag")
      const object = repo.git(["cat-file", "-p", "refs/tags/v2"])
      expect(object).toContain("release notes")
      expect(object).not.toContain("BEGIN PGP SIGNATURE")
    } finally {
      repo.cleanup()
    }
  })

  it("refuses to overwrite an existing tag", async () => {
    const repo = mkTmpRepo()
    try {
      const first = commit(repo.dir, { "a.txt": "one\n" }, "one")
      await createTag(repo.dir, { name: "v1", target: first, expectedHead: first })
      const second = commit(repo.dir, { "a.txt": "two\n" }, "two")

      const error = await failure(
        createTag(repo.dir, { name: "v1", target: second, expectedHead: second }),
      )
      expect(error.reason).toBe("target_exists")
      expect(repo.git(["rev-parse", "refs/tags/v1"]).trim()).toBe(first)
    } finally {
      repo.cleanup()
    }
  })

  it("deletes an existing tag and rejects a missing tag", async () => {
    const repo = mkTmpRepo()
    try {
      const base = commit(repo.dir, { "a.txt": "base\n" }, "base")
      await createTag(repo.dir, { name: "v1", target: base, expectedHead: base })

      const result = await deleteTag(repo.dir, { name: "v1", expectedHead: base })
      expect(result.changed).toBe(true)
      expect(repo.tryGit(["rev-parse", "--verify", "refs/tags/v1"]).status).not.toBe(0)

      const missing = await failure(deleteTag(repo.dir, { name: "v1", expectedHead: base }))
      expect(missing.reason).toBe("tag_not_found")
    } finally {
      repo.cleanup()
    }
  })

  it("rejects non-commit targets, malformed names and option-like names", async () => {
    const repo = mkTmpRepo()
    try {
      const base = commit(repo.dir, { "a.txt": "base\n" }, "base")
      writeFileSync(join(repo.dir, "blob.txt"), "blob\n")
      const blob = repo.git(["hash-object", "-w", "blob.txt"]).trim()

      const nonCommit = await failure(
        createTag(repo.dir, { name: "v1", target: blob, expectedHead: base }),
      )
      expect(nonCommit.reason).toBe("invalid_target")

      for (const name of ["--output=evil.txt", "bad..tag", "tag.lock", "dir/.hidden"]) {
        const error = await failure(
          createTag(repo.dir, { name, target: base, expectedHead: base }),
        )
        expect(error.reason).toBe("invalid_name")
      }
      expect(existsSync(join(repo.dir, "evil.txt"))).toBe(false)
    } finally {
      repo.cleanup()
    }
  })
})
