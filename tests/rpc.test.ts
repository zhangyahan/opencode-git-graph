import { describe, expect, it } from "vitest"
import type { z } from "zod"
import {
  ChangeCountsSchema,
  ChangedFileSchema,
  CheckoutBranchInputSchema,
  CommitFileContentSchema,
  CommitHashSchema,
  CreateBranchInputSchema,
  CreateTagInputSchema,
  DeleteBranchInputSchema,
  DeleteTagInputSchema,
  FetchRemoteInputSchema,
  FetchRemoteOutputSchema,
  FileDiffSchema,
  FullCommitHashSchema,
  GetCommitFileContentInputSchema,
  GetCommitFileContentOutputSchema,
  GetCommitFilesInputSchema,
  GetCommitFilesOutputSchema,
  GetComparisonDiffInputSchema,
  GetComparisonDiffOutputSchema,
  GetComparisonFilesInputSchema,
  GetComparisonFilesOutputSchema,
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
  GitGraphMutationErrorSchemas,
  GitGraphRpc,
  GitMutationResultSchema,
  GitRefSchema,
  GitRepositorySchema,
  GitStatusSchema,
  GitTargetSchema,
  ListRepositoriesInputSchema,
  ListRepositoriesOutputSchema,
  LogRefSchema,
  MAX_LOG_REFS,
  MUTATION_REASON_MAX_LENGTH,
  RenameBranchInputSchema,
  RepositoryIdSchema,
  SafeRelativePathSchema,
} from "../src/rpc.js"
import type {
  ChangeCounts,
  ChangedFile,
  CommitFileContent,
  FileDiff,
  GitCommit,
  GitFetchResult,
  GitMutationResult,
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
type _CommitFileContent = Assert<
  Equal<z.infer<typeof CommitFileContentSchema>, CommitFileContent>
>

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
  added: 3,
  deleted: 1,
}

const fileContent: CommitFileContent = {
  path: "src/a.txt",
  mode: "100644",
  kind: "text",
  text: "hello\n",
  size: 6,
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

const mutationResult: GitMutationResult = {
  status,
  changed: true,
}

type _MutationResult = Assert<Equal<z.infer<typeof GitMutationResultSchema>, GitMutationResult>>
type _FetchResult = Assert<Equal<z.infer<typeof FetchRemoteOutputSchema>, GitFetchResult>>
type _CheckoutInput = Assert<
  Equal<
    z.infer<typeof CheckoutBranchInputSchema>,
    {
      repositoryId: string
      expectedHead: string | null
      confirmed: true
      branch: string
    }
  >
>
const FULL_HASH = "0123456789abcdef".repeat(2) + "01234567"

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
      "getCommitFileContent",
      "getDiff",
      "getComparisonFiles",
      "getComparisonDiff",
      "checkoutBranch",
      "createBranch",
      "createTag",
      "renameBranch",
      "deleteBranch",
      "deleteTag",
      "fetchRemote",
    ])
    expect(Object.keys(GitGraphRpc.events)).toEqual([])
  })

  it("declares the unified error set on every repository method", () => {
    const expected = Object.keys(GitGraphErrorSchemas).sort()
    const mutationExpected = Object.keys(GitGraphMutationErrorSchemas).sort()
    for (const name of [
      "listRepositories",
      "getStatus",
      "getLog",
      "getRefs",
      "getCommitFiles",
      "getCommitFileContent",
      "getDiff",
      "getComparisonFiles",
      "getComparisonDiff",
    ] as const) {
      expect(Object.keys(GitGraphRpc.methods[name].errors ?? {}).sort()).toEqual(expected)
    }
    for (const name of [
      "checkoutBranch",
      "createBranch",
      "createTag",
      "renameBranch",
      "deleteBranch",
      "deleteTag",
      "fetchRemote",
    ] as const) {
      expect(Object.keys(GitGraphRpc.methods[name].errors ?? {}).sort()).toEqual(mutationExpected)
    }
    expect(mutationExpected).toContain("mutation_rejected")
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

  it("validates every getLog walk field and canonical refs", () => {
    const full = {
      repositoryId: repository.id,
      refs: ["refs/heads/main", "refs/remotes/origin/main", "refs/tags/v1"],
      showRemotes: false,
      showTags: false,
      firstParent: true,
      order: "topo" as const,
    }
    expect(GetLogInputSchema.parse(full)).toEqual(full)
    expect(GetLogInputSchema.parse({ repositoryId: repository.id, refs: [] })).toEqual({
      repositoryId: repository.id,
      refs: [],
    })

    expect(LogRefSchema.safeParse("refs/heads/feature/x").success).toBe(true)
    for (const unsafe of [
      "main",
      "refs/heads/",
      "refs/heads/x..y",
      "refs/heads/x@{1}",
      "refs/heads/x//y",
      "refs/heads/x/",
      "refs/heads/.hidden",
      "refs/heads/x.lock",
      "refs/heads/x y",
      "refs/heads/x~1",
      "refs/heads/x^",
      "refs/tags/x:y",
      "HEAD",
      "refs/heads/" + "x".repeat(5000),
    ]) {
      expect(LogRefSchema.safeParse(unsafe).success).toBe(false)
    }

    expect(
      GetLogInputSchema.safeParse({
        repositoryId: repository.id,
        refs: Array.from({ length: MAX_LOG_REFS + 1 }, (_value, index) => `refs/heads/b${index}`),
      }).success,
    ).toBe(false)
    expect(
      GetLogInputSchema.safeParse({ repositoryId: repository.id, order: "reverse" }).success,
    ).toBe(false)
    expect(
      GetLogInputSchema.safeParse({ repositoryId: repository.id, firstParent: "yes" }).success,
    ).toBe(false)
  })

  it("validates comparison input and output", () => {
    expect(
      GetComparisonFilesInputSchema.parse({
        repositoryId: repository.id,
        baseHash: FULL_HASH,
        headHash: "abcd",
      }),
    ).toEqual({ repositoryId: repository.id, baseHash: FULL_HASH, headHash: "abcd" })
    expect(
      GetComparisonFilesInputSchema.safeParse({
        repositoryId: repository.id,
        baseHash: "HEAD~1",
        headHash: "abcd",
      }).success,
    ).toBe(false)
    expect(
      GetComparisonDiffInputSchema.parse({
        repositoryId: repository.id,
        baseHash: FULL_HASH,
        headHash: "abcd",
        path: "src/a.txt",
      }),
    ).toEqual({
      repositoryId: repository.id,
      baseHash: FULL_HASH,
      headHash: "abcd",
      path: "src/a.txt",
    })
    expect(
      GetComparisonDiffInputSchema.safeParse({
        repositoryId: repository.id,
        baseHash: FULL_HASH,
        headHash: "abcd",
        path: "../a.txt",
      }).success,
    ).toBe(false)

    expect(GetComparisonFilesOutputSchema.parse({ files: [changedFile] })).toEqual({
      files: [changedFile],
    })
    expect(GetComparisonDiffOutputSchema.parse(diff)).toEqual(diff)
  })

  it("validates commit file content input and output", () => {
    expect(
      GetCommitFileContentInputSchema.parse({
        repositoryId: repository.id,
        hash: "abcd",
        path: "src/中文 file.txt",
      }),
    ).toEqual({
      repositoryId: repository.id,
      hash: "abcd",
      path: "src/中文 file.txt",
    })
    for (const hash of ["HEAD", "--all", "xyz", "a".repeat(65), ""]) {
      expect(
        GetCommitFileContentInputSchema.safeParse({
          repositoryId: repository.id,
          hash,
          path: "a.txt",
        }).success,
      ).toBe(false)
    }
    for (const path of ["", "../a.txt", "/etc/passwd", "C:\\Windows\\win.ini", "a\\b.txt"]) {
      expect(
        GetCommitFileContentInputSchema.safeParse({
          repositoryId: repository.id,
          hash: "abcd",
          path,
        }).success,
      ).toBe(false)
    }
    expect(
      GetCommitFileContentInputSchema.safeParse({
        repositoryId: repository.id,
        hash: "abcd",
        path: "a.txt",
        extra: true,
      }).success,
    ).toBe(false)

    expect(GetCommitFileContentOutputSchema.parse(fileContent)).toEqual(fileContent)
    expect(
      GetCommitFileContentOutputSchema.parse({
        path: "sub",
        mode: "160000",
        kind: "missing",
        text: null,
        size: null,
      }),
    ).toEqual({ path: "sub", mode: "160000", kind: "missing", text: null, size: null })
    expect(
      CommitFileContentSchema.safeParse({ ...fileContent, kind: "bogus" }).success,
    ).toBe(false)
    expect(CommitFileContentSchema.safeParse({ ...fileContent, size: -1 }).success).toBe(false)
    expect(
      CommitFileContentSchema.safeParse({ ...fileContent, truncated: "yes" }).success,
    ).toBe(false)
    expect(CommitFileContentSchema.safeParse({ ...fileContent, text: undefined }).success).toBe(
      false,
    )

    expect(ChangedFileSchema.parse(changedFile)).toEqual(changedFile)
    expect(ChangedFileSchema.safeParse({ ...changedFile, added: -1 }).success).toBe(false)
    expect(ChangedFileSchema.safeParse({ ...changedFile, deleted: 1.5 }).success).toBe(false)
  })

  it("validates mutation confirmation, expected head and operation fields", () => {
    expect(FullCommitHashSchema.safeParse(FULL_HASH).success).toBe(true)
    expect(FullCommitHashSchema.safeParse("abcd").success).toBe(false)
    expect(FullCommitHashSchema.safeParse("HEAD").success).toBe(false)
    expect(FullCommitHashSchema.safeParse("--all").success).toBe(false)

    const expected = "f".repeat(64)
    const base = {
      repositoryId: repository.id,
      expectedHead: expected,
      confirmed: true as const,
    }
    const checkout = {
      ...base,
      branch: "feature/x",
    }
    expect(CheckoutBranchInputSchema.parse(checkout)).toEqual(checkout)
    expect(
      CheckoutBranchInputSchema.safeParse({ ...checkout, expectedHead: null }).success,
    ).toBe(true)
    expect(
      CheckoutBranchInputSchema.safeParse({ ...checkout, confirmed: false }).success,
    ).toBe(false)
    const { confirmed: _confirmed, ...withoutConfirmation } = checkout
    expect(CheckoutBranchInputSchema.safeParse(withoutConfirmation).success).toBe(false)

    for (const expectedHead of ["abcd", "HEAD", "--all", expected.slice(1), expected + "a"]) {
      expect(
        CheckoutBranchInputSchema.safeParse({ ...checkout, expectedHead }).success,
      ).toBe(false)
    }

    for (const branch of ["-x", "--all", "../x", "x..y", "x@{1}", "x y", "refs/heads/x", "a\\b"]) {
      expect(CheckoutBranchInputSchema.safeParse({ ...checkout, branch }).success).toBe(false)
    }

    expect(
      CreateBranchInputSchema.parse({
        ...base,
        name: "topic",
        startPoint: expected,
        checkout: true,
      }),
    ).toMatchObject({ name: "topic", startPoint: expected, checkout: true })
    expect(
      CreateBranchInputSchema.safeParse({
        ...base,
        name: "topic",
        startPoint: "abcd",
      }).success,
    ).toBe(false)
    expect(
      CreateBranchInputSchema.safeParse({
        ...base,
        name: "--topic",
        startPoint: expected,
      }).success,
    ).toBe(false)

    expect(
      CreateTagInputSchema.parse({
        ...base,
        name: "v1.0.0",
        target: expected,
        message: "release",
      }),
    ).toMatchObject({ name: "v1.0.0", target: expected, message: "release" })
    expect(
      CreateTagInputSchema.safeParse({
        ...base,
        name: "-v1",
        target: expected,
      }).success,
    ).toBe(false)

    expect(
      RenameBranchInputSchema.parse({ ...base, oldName: "main", newName: "trunk" }),
    ).toMatchObject({ oldName: "main", newName: "trunk" })
    expect(
      DeleteBranchInputSchema.parse({ ...base, name: "topic" }),
    ).toMatchObject({ name: "topic" })
    expect(DeleteTagInputSchema.parse({ ...base, name: "v1" })).toMatchObject({ name: "v1" })

    expect(GitMutationResultSchema.parse(mutationResult)).toEqual(mutationResult)
    expect(
      GitMutationResultSchema.safeParse({ status, changed: true, warning: "cached" }).success,
    ).toBe(true)
    expect(GitMutationResultSchema.safeParse({ status, changed: "yes" }).success).toBe(false)
    expect(
      GitGraphMutationErrorSchemas.mutation_rejected.safeParse({ reason: "" }).success,
    ).toBe(false)
    expect(
      GitGraphMutationErrorSchemas.mutation_rejected.safeParse({
        reason: "x".repeat(MUTATION_REASON_MAX_LENGTH + 1),
      }).success,
    ).toBe(false)
    expect(
      GitGraphMutationErrorSchemas.mutation_rejected.safeParse({ reason: "rejected" }).success,
    ).toBe(true)
  })

  it("validates fetchRemote input and output", () => {
    const base = {
      repositoryId: repository.id,
      expectedHead: FULL_HASH,
      confirmed: true as const,
    }

    expect(FetchRemoteInputSchema.parse(base)).toEqual(base)
    expect(FetchRemoteInputSchema.parse({ ...base, remote: null })).toEqual({
      ...base,
      remote: null,
    })
    expect(FetchRemoteInputSchema.parse({ ...base, remote: "upstream", prune: true })).toEqual({
      ...base,
      remote: "upstream",
      prune: true,
    })
    expect(FetchRemoteInputSchema.safeParse({ ...base, prune: "yes" }).success).toBe(false)
    for (const remote of ["--all", "-x", "../x", "a b", "refs/heads/x"]) {
      expect(FetchRemoteInputSchema.safeParse({ ...base, remote }).success).toBe(false)
    }
    expect(
      FetchRemoteInputSchema.safeParse({ ...base, confirmed: false }).success,
    ).toBe(false)

    const fetchResult: GitFetchResult = {
      status,
      refsUpdated: 2,
      changed: true,
    }
    expect(FetchRemoteOutputSchema.parse(fetchResult)).toEqual(fetchResult)
    expect(
      FetchRemoteOutputSchema.parse({ ...fetchResult, warning: "cached" }).warning,
    ).toBe("cached")
    expect(FetchRemoteOutputSchema.safeParse({ ...fetchResult, refsUpdated: -1 }).success).toBe(
      false,
    )
    expect(FetchRemoteOutputSchema.safeParse({ ...fetchResult, changed: "yes" }).success).toBe(
      false,
    )
    expect(
      FetchRemoteOutputSchema.safeParse({ status, refsUpdated: 0 }).success,
    ).toBe(false)
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
