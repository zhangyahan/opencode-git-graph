import { describe, expect, it } from "vitest"
import type { z } from "zod"
import {
  ChangeCountsSchema,
  ChangedFileSchema,
  CommitHashSchema,
  FileDiffSchema,
  GetCommitFilesInputSchema,
  GetCommitFilesOutputSchema,
  GetDiffInputSchema,
  GetDiffOutputSchema,
  GetLogInputSchema,
  GetLogOutputSchema,
  GetRefsInputSchema,
  GetRefsOutputSchema,
  GetStatusInputSchema,
  GetStatusOutputSchema,
  GitCommitSchema,
  GitGraphErrorSchemas,
  GitGraphRpc,
  GitRefSchema,
  GitRepositorySchema,
  GitStatusSchema,
  GitTargetSchema,
  ListRepositoriesInputSchema,
  ListRepositoriesOutputSchema,
  RepositoryIdSchema,
  SafeRelativePathSchema,
} from "../src/rpc.js"
import type {
  ChangeCounts,
  ChangedFile,
  FileDiff,
  GitCommit,
  GitRef,
  GitRepository,
  GitStatus,
  GitTarget,
} from "../src/shared/types.js"

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Assert<T extends true> = T

// Compile-time guarantee that every exported schema output matches the shared
// canonical type used by the git engine and the GUI.
type _ChangeCounts = Assert<Equal<z.infer<typeof ChangeCountsSchema>, ChangeCounts>>
type _ChangedFile = Assert<Equal<z.infer<typeof ChangedFileSchema>, ChangedFile>>
type _Repository = Assert<Equal<z.infer<typeof GitRepositorySchema>, GitRepository>>
type _Status = Assert<Equal<z.infer<typeof GitStatusSchema>, GitStatus>>
type _Commit = Assert<Equal<z.infer<typeof GitCommitSchema>, GitCommit>>
type _Ref = Assert<Equal<z.infer<typeof GitRefSchema>, GitRef>>
type _Target = Assert<Equal<z.infer<typeof GitTargetSchema>, GitTarget>>
type _Diff = Assert<Equal<z.infer<typeof FileDiffSchema>, FileDiff>>

const changes: ChangeCounts = {
  staged: 1,
  unstaged: 2,
  untracked: 3,
  conflicted: 4,
}

const changedFile: ChangedFile = {
  path: "src/a.txt",
  oldPath: "src/old.txt",
  status: "renamed",
  staged: true,
}

const repository: GitRepository = {
  id: "c:\\workspace\\repo",
  name: "repo",
  rootPath: "C:\\workspace\\repo",
  gitDir: "C:\\workspace\\repo\\.git",
  type: "normal",
  branch: "main",
  head: "abcd1234",
  detached: false,
  changes,
}

const status: GitStatus = {
  repositoryId: repository.id,
  branch: "main",
  head: "abcd1234",
  detached: false,
  files: [changedFile],
  counts: changes,
}

const commit: GitCommit = {
  hash: "abcd1234",
  parents: ["ef015678"],
  author: "Test User",
  authorDate: "2024-01-01T00:00:00Z",
  subject: "subject",
  refs: ["HEAD -> main", "v1"],
}

const ref: GitRef = { name: "main", hash: "abcd1234", kind: "branch" }

const diff: FileDiff = {
  path: "src/a.txt",
  status: "modified",
  text: "diff --git a/src/a.txt b/src/a.txt\n",
  binary: false,
}

describe("git-graph RPC contract", () => {
  it("declares every method and no events", () => {
    expect(GitGraphRpc.id).toBe("git-graph")
    expect(Object.keys(GitGraphRpc.methods)).toEqual([
      "ping",
      "listRepositories",
      "getStatus",
      "getLog",
      "getRefs",
      "getCommitFiles",
      "getDiff",
    ])
    expect(Object.keys(GitGraphRpc.events)).toEqual([])
  })

  it("declares the unified error set on every repository method", () => {
    const expected = Object.keys(GitGraphErrorSchemas).sort()
    for (const name of [
      "listRepositories",
      "getStatus",
      "getLog",
      "getRefs",
      "getCommitFiles",
      "getDiff",
    ] as const) {
      expect(Object.keys(GitGraphRpc.methods[name].errors ?? {}).sort()).toEqual(expected)
    }
  })

  it("validates listRepositories input", () => {
    expect(ListRepositoriesInputSchema.parse(undefined)).toEqual({})
    expect(ListRepositoriesInputSchema.parse({})).toEqual({})
    expect(ListRepositoriesInputSchema.parse({ refresh: true })).toEqual({ refresh: true })
    expect(ListRepositoriesInputSchema.safeParse({ refresh: "yes" }).success).toBe(false)
    expect(ListRepositoriesInputSchema.safeParse({ refresh: true, extra: 1 }).success).toBe(false)
  })

  it("validates getStatus input", () => {
    expect(GetStatusInputSchema.parse({ repositoryId: repository.id })).toEqual({
      repositoryId: repository.id,
    })
    expect(GetStatusInputSchema.safeParse({}).success).toBe(false)
    expect(GetStatusInputSchema.safeParse({ repositoryId: 1 }).success).toBe(false)
    expect(GetStatusInputSchema.safeParse({ repositoryId: "" }).success).toBe(false)
    expect(RepositoryIdSchema.safeParse("x".repeat(4097)).success).toBe(false)
  })

  it("validates getLog pagination input", () => {
    expect(GetLogInputSchema.parse({ repositoryId: repository.id })).toEqual({
      repositoryId: repository.id,
    })
    expect(
      GetLogInputSchema.parse({ repositoryId: repository.id, limit: 1000, skip: 10_000_000 }),
    ).toEqual({ repositoryId: repository.id, limit: 1000, skip: 10_000_000 })

    for (const limit of [0, 1001, 1.5, -1]) {
      expect(
        GetLogInputSchema.safeParse({ repositoryId: repository.id, limit }).success,
      ).toBe(false)
    }
    for (const skip of [-1, 10_000_001, 1.5]) {
      expect(GetLogInputSchema.safeParse({ repositoryId: repository.id, skip }).success).toBe(false)
    }
  })

  it("validates getRefs input", () => {
    expect(GetRefsInputSchema.parse({ repositoryId: repository.id })).toEqual({
      repositoryId: repository.id,
    })
    expect(GetRefsInputSchema.safeParse({ repositoryId: repository.id, extra: true }).success).toBe(
      false,
    )
  })

  it("accepts only object-id hashes and non-negative parent indexes", () => {
    expect(CommitHashSchema.parse("abcd")).toBe("abcd")
    expect(CommitHashSchema.parse("0123456789abcdef".repeat(4))).toBe(
      "0123456789abcdef".repeat(4),
    )
    expect(CommitHashSchema.safeParse("abc").success).toBe(false)
    expect(CommitHashSchema.safeParse("a".repeat(65)).success).toBe(false)
    expect(CommitHashSchema.safeParse("HEAD").success).toBe(false)
    expect(CommitHashSchema.safeParse("--all").success).toBe(false)

    expect(
      GetCommitFilesInputSchema.parse({
        repositoryId: repository.id,
        hash: "abcd",
        parentIndex: 0,
      }),
    ).toEqual({ repositoryId: repository.id, hash: "abcd", parentIndex: 0 })
    expect(
      GetCommitFilesInputSchema.safeParse({
        repositoryId: repository.id,
        hash: "abcd",
        parentIndex: -1,
      }).success,
    ).toBe(false)
    expect(
      GetCommitFilesInputSchema.safeParse({
        repositoryId: repository.id,
        hash: "abcd",
        parentIndex: 1.5,
      }).success,
    ).toBe(false)
    expect(
      GetCommitFilesInputSchema.safeParse({ repositoryId: repository.id, hash: "--all" }).success,
    ).toBe(false)
  })

  it("validates getDiff targets and rejects unsafe paths", () => {
    expect(
      GetDiffInputSchema.parse({
        repositoryId: repository.id,
        target: { type: "commit", hash: "abcd", parentIndex: 1 },
        path: "src/a.txt",
      }),
    ).toEqual({
      repositoryId: repository.id,
      target: { type: "commit", hash: "abcd", parentIndex: 1 },
      path: "src/a.txt",
    })
    expect(
      GetDiffInputSchema.parse({
        repositoryId: repository.id,
        target: { type: "index" },
        path: "a.txt",
      }),
    ).toEqual({ repositoryId: repository.id, target: { type: "index" }, path: "a.txt" })
    expect(
      GetDiffInputSchema.parse({
        repositoryId: repository.id,
        target: { type: "working-tree" },
        path: "a.txt",
      }),
    ).toEqual({ repositoryId: repository.id, target: { type: "working-tree" }, path: "a.txt" })

    expect(
      GetDiffInputSchema.safeParse({
        repositoryId: repository.id,
        target: { type: "commit", hash: "HEAD~1" },
        path: "a.txt",
      }).success,
    ).toBe(false)
    expect(
      GetDiffInputSchema.safeParse({
        repositoryId: repository.id,
        target: { type: "bogus" },
        path: "a.txt",
      }).success,
    ).toBe(false)

    for (const unsafe of [
      "../a.txt",
      "a/../../b.txt",
      "/etc/passwd",
      "C:\\Windows\\win.ini",
      "a\\b.txt",
      "a//b.txt",
      "a/./b.txt",
      "",
      ".",
      "..",
    ]) {
      expect(SafeRelativePathSchema.safeParse(unsafe).success).toBe(false)
    }
    expect(SafeRelativePathSchema.parse("nested/file name.txt")).toBe("nested/file name.txt")
  })

  it("parses every output schema and rejects malformed values", () => {
    expect(ListRepositoriesOutputSchema.parse({ repositories: [repository] })).toEqual({
      repositories: [repository],
    })
    expect(GetStatusOutputSchema.parse(status)).toEqual(status)
    expect(GetLogOutputSchema.parse({ commits: [commit], hasMore: true })).toEqual({
      commits: [commit],
      hasMore: true,
    })
    expect(GetRefsOutputSchema.parse({ refs: [ref] })).toEqual({ refs: [ref] })
    expect(GetCommitFilesOutputSchema.parse({ files: [changedFile] })).toEqual({
      files: [changedFile],
    })
    expect(GetDiffOutputSchema.parse(diff)).toEqual(diff)

    expect(GitRepositorySchema.safeParse({ ...repository, type: "bogus" }).success).toBe(false)
    expect(GitStatusSchema.safeParse({ ...status, counts: { ...changes, staged: -1 } }).success).toBe(
      false,
    )
    expect(GitStatusSchema.safeParse({ ...status, files: [{ ...changedFile, status: "bogus" }] }).success).toBe(
      false,
    )
    expect(GitCommitSchema.safeParse({ ...commit, parents: undefined }).success).toBe(false)
    expect(GitRefSchema.safeParse({ ...ref, kind: "bogus" }).success).toBe(false)
    expect(FileDiffSchema.safeParse({ ...diff, binary: undefined }).success).toBe(false)
  })
})
