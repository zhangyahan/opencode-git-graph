import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import {
  GetCommitFileContentOutputSchema,
  GetCommitFilesOutputSchema,
  GetComparisonDiffOutputSchema,
  GetComparisonFilesOutputSchema,
  GetDiffOutputSchema,
  GetLogOutputSchema,
  GetRefsOutputSchema,
  GetStatusOutputSchema,
  GitMutationResultSchema,
  ListRepositoriesOutputSchema,
} from "../src/rpc.js"
import {
  createGitGraphHandlers,
  RepositoryManager,
  type GitGraphManager,
} from "../src/server/repository/manager.js"
import { GitInputError } from "../src/server/git/validation.js"
import type {
  CommitFileContent,
  FileDiff,
  GitRepository,
  GitStatus,
} from "../src/shared/types.js"
import { commit, initRepo, mkTmpDir, runGit } from "./helpers.js"

type Handlers = ReturnType<typeof createGitGraphHandlers>
type TestContext = Parameters<Handlers["getStatus"]>[1]

interface TestError {
  type: string
  message: string
  data: Record<string, unknown>
  isRpcError: true
}

function makeContext(signal?: AbortSignal): {
  context: TestContext
  errors: TestError[]
} {
  const errors: TestError[] = []
  const context = {
    signal: signal ?? new AbortController().signal,
    error: (type: string, message: string, data: Record<string, unknown> = {}) => {
      const value: TestError = { type, message, data, isRpcError: true }
      errors.push(value)
      return value
    },
  }
  return { context: context as unknown as TestContext, errors }
}

const statusFixture: GitStatus = {
  repositoryId: "c:\\workspace\\repo",
  branch: "main",
  head: "abcd1234",
  detached: false,
  files: [],
  counts: { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 },
}

const repositoryFixture: GitRepository = {
  id: statusFixture.repositoryId,
  name: "repo",
  rootPath: "C:\\workspace\\repo",
  gitDir: "C:\\workspace\\repo\\.git",
  type: "normal",
  branch: "main",
  head: "abcd1234",
  detached: false,
  changes: { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 },
}

const diffFixture: FileDiff = {
  path: "a.txt",
  status: "modified",
  text: "diff --git a/a.txt b/a.txt\n",
  binary: false,
}

function fakeManager(overrides: Partial<GitGraphManager> = {}): GitGraphManager {
  return {
    listRepositories: vi.fn(async () => []),
    getStatus: vi.fn(async () => statusFixture),
    getLog: vi.fn(async () => ({ commits: [], hasMore: false })),
    getRefs: vi.fn(async () => []),
    getCommitFiles: vi.fn(async () => []),
    getCommitFileContent: vi.fn(
      async (): Promise<CommitFileContent> => ({
        path: "a.txt",
        mode: "100644",
        kind: "text",
        text: "one\n",
        size: 4,
      }),
    ),
    getDiff: vi.fn(async () => diffFixture),
    getComparisonFiles: vi.fn(async () => []),
    getComparisonDiff: vi.fn(async () => diffFixture),
    checkoutBranch: vi.fn(async () => ({
      status: statusFixture,
      changed: true,
    })),
    createBranch: vi.fn(async () => ({
      status: statusFixture,
      changed: true,
    })),
    createTag: vi.fn(async () => ({
      status: statusFixture,
      changed: true,
    })),
    renameBranch: vi.fn(async () => ({
      status: statusFixture,
      changed: true,
    })),
    deleteBranch: vi.fn(async () => ({
      status: statusFixture,
      changed: true,
    })),
    deleteTag: vi.fn(async () => ({
      status: statusFixture,
      changed: true,
    })),
    ...overrides,
  }
}

describe("git-graph RPC handlers", () => {
  it("serves schema-valid outputs from a real repository manager", async () => {
    const root = mkTmpDir()
    try {
      const repo = join(root.dir, "repo")
      initRepo(repo)
      const head = commit(repo, { "a.txt": "one\n" }, "first")

      const manager = new RepositoryManager(root.dir, { ttlMs: 60_000 })
      try {
        const handlers = createGitGraphHandlers(manager)
        const { context } = makeContext()

        const listed = ListRepositoriesOutputSchema.parse(
          await handlers.listRepositories({}, context as never),
        )
        expect(listed.repositories.map((entry) => entry.name)).toEqual(["repo"])
        const repositoryId = listed.repositories[0].id

        const status = GetStatusOutputSchema.parse(
          await handlers.getStatus({ repositoryId }, context as never),
        )
        expect(status.head).toBe(head)

        const log = GetLogOutputSchema.parse(
          await handlers.getLog({ repositoryId, limit: 10 }, context as never),
        )
        expect(log.commits.map((entry) => entry.hash)).toEqual([head])

        const refs = GetRefsOutputSchema.parse(
          await handlers.getRefs({ repositoryId }, context as never),
        )
        expect(refs.refs.some((entry) => entry.kind === "head")).toBe(true)

        const files = GetCommitFilesOutputSchema.parse(
          await handlers.getCommitFiles({ repositoryId, hash: head }, context as never),
        )
        expect(files.files).toEqual([
          { path: "a.txt", status: "added", staged: true, added: 1, deleted: 0 },
        ])

        const content = GetCommitFileContentOutputSchema.parse(
          await handlers.getCommitFileContent(
            { repositoryId, hash: head, path: "a.txt" },
            context as never,
          ),
        )
        expect(content).toEqual({
          path: "a.txt",
          mode: "100644",
          kind: "text",
          text: "one\n",
          size: 4,
        })

        writeFileSync(join(repo, "a.txt"), "two\n")
        const diff = GetDiffOutputSchema.parse(
          await handlers.getDiff(
            { repositoryId, target: { type: "working-tree" }, path: "a.txt" },
            context as never,
          ),
        )
        expect(diff.status).toBe("modified")
        expect(diff.text).toContain("+two")
      } finally {
        manager.dispose()
      }
    } finally {
      root.cleanup()
    }
  })

  it("serves comparison and confirmed mutation methods through the real manager", async () => {
    const root = mkTmpDir()
    try {
      const repo = join(root.dir, "repo")
      initRepo(repo)
      const base = commit(repo, { "a.txt": "one\n" }, "base")
      const head = commit(repo, { "a.txt": "two\n", "b.txt": "new\n" }, "head")

      const manager = new RepositoryManager(root.dir, { ttlMs: 60_000 })
      try {
        const handlers = createGitGraphHandlers(manager)
        const { context } = makeContext()
        const [entry] = await manager.listRepositories()

        const log = GetLogOutputSchema.parse(
          await handlers.getLog(
            {
              repositoryId: entry.id,
              refs: ["refs/heads/main"],
              showRemotes: false,
              showTags: false,
              firstParent: true,
              order: "topo",
              limit: 10,
            },
            context as never,
          ),
        )
        expect(log.commits.map((commitEntry) => commitEntry.hash)).toEqual([head, base])

        const files = GetComparisonFilesOutputSchema.parse(
          await handlers.getComparisonFiles(
            { repositoryId: entry.id, baseHash: base, headHash: head },
            context as never,
          ),
        )
        expect(files.files).toContainEqual({
          path: "b.txt",
          status: "added",
          staged: true,
          added: 1,
          deleted: 0,
        })

        const diff = GetComparisonDiffOutputSchema.parse(
          await handlers.getComparisonDiff(
            { repositoryId: entry.id, baseHash: base, headHash: head, path: "a.txt" },
            context as never,
          ),
        )
        expect(diff.text).toContain("+two")

        const created = GitMutationResultSchema.parse(
          await handlers.createTag(
            {
              repositoryId: entry.id,
              expectedHead: head,
              confirmed: true,
              name: "v1",
              target: head,
              message: "release",
            },
            context as never,
          ),
        )
        expect(created).toMatchObject({ changed: true, status: { head } })

        const deleted = GitMutationResultSchema.parse(
          await handlers.deleteTag(
            { repositoryId: entry.id, expectedHead: head, confirmed: true, name: "v1" },
            context as never,
          ),
        )
        expect(deleted.changed).toBe(true)
      } finally {
        manager.dispose()
      }
    } finally {
      root.cleanup()
    }
  }, 30_000)

  it("rejects a mutation whose confirmation is missing even when the handler is called directly", async () => {
    const manager = fakeManager()
    const handlers = createGitGraphHandlers(manager)
    const { context } = makeContext()

    const result = (await handlers.checkoutBranch(
      {
        repositoryId: statusFixture.repositoryId,
        expectedHead: null,
        branch: "main",
      } as never,
      context as never,
    )) as unknown as TestError

    expect(manager.checkoutBranch).not.toHaveBeenCalled()
    expect(result).toMatchObject({ type: "invalid_input", data: { reason: "confirmation" } })
  })

  it("maps mutation failures to a bounded reason without leaking paths", async () => {
    const manager = fakeManager({
      checkoutBranch: vi.fn(async () => {
        throw Object.assign(new Error("C:\\secret\\repo failed"), {
          name: "GitMutationError",
          reason: "x".repeat(500),
        })
      }),
    })
    const handlers = createGitGraphHandlers(manager)
    const { context } = makeContext()

    const result = (await handlers.checkoutBranch(
      {
        repositoryId: statusFixture.repositoryId,
        expectedHead: null,
        confirmed: true,
        branch: "main",
      },
      context as never,
    )) as unknown as TestError

    expect(result).toMatchObject({ type: "mutation_rejected" })
    const reason = result.data.reason as string
    expect(reason).toHaveLength(200)
    expect(result.message).not.toContain("secret")
    expect(JSON.stringify(result)).not.toContain("secret")
  })

  it("maps unexpected write failures to a generic mutation reason", async () => {
    const manager = fakeManager({
      deleteBranch: vi.fn(async () => {
        throw new Error("C:\\secret\\repo exploded")
      }),
    })
    const handlers = createGitGraphHandlers(manager)
    const { context } = makeContext()

    const result = (await handlers.deleteBranch(
      {
        repositoryId: statusFixture.repositoryId,
        expectedHead: null,
        confirmed: true,
        name: "topic",
      },
      context as never,
    )) as unknown as TestError

    expect(result).toMatchObject({
      type: "mutation_rejected",
      data: { reason: "mutation_failed" },
    })
    expect(JSON.stringify(result)).not.toContain("secret")
  })

  it("returns a successful write even when the caller aborts after it started", async () => {
    const controller = new AbortController()
    const changedStatus = { ...statusFixture, branch: "feature" }
    const manager = fakeManager({
      checkoutBranch: vi.fn(async () => {
        controller.abort()
        return { status: changedStatus, changed: true }
      }),
    })
    const handlers = createGitGraphHandlers(manager)
    const { context } = makeContext(controller.signal)

    const result = await handlers.checkoutBranch(
      {
        repositoryId: statusFixture.repositoryId,
        expectedHead: null,
        confirmed: true,
        branch: "feature",
      },
      context as never,
    )

    expect(result).toMatchObject({ changed: true, status: { branch: "feature" } })
  })

  it("does not start a write when the signal is already aborted", async () => {
    const controller = new AbortController()
    controller.abort()
    const manager = fakeManager()
    const handlers = createGitGraphHandlers(manager)
    const { context } = makeContext(controller.signal)

    const result = (await handlers.deleteTag(
      {
        repositoryId: statusFixture.repositoryId,
        expectedHead: null,
        confirmed: true,
        name: "v1",
      },
      context as never,
    )) as unknown as TestError

    expect(manager.deleteTag).not.toHaveBeenCalled()
    expect(result).toMatchObject({ type: "git_failed", data: { operation: "cancelled" } })
    expect(result.message).toContain("no git process was started")
  })

  it("maps mutation input validation errors and disposal without leaking details", async () => {
    const manager = fakeManager({
      renameBranch: vi.fn(async () => {
        throw new GitInputError("C:\\secret\\bad name")
      }),
    })
    const handlers = createGitGraphHandlers(manager)
    const { context } = makeContext()

    const result = (await handlers.renameBranch(
      {
        repositoryId: statusFixture.repositoryId,
        expectedHead: null,
        confirmed: true,
        oldName: "main",
        newName: "trunk",
      },
      context as never,
    )) as unknown as TestError

    expect(result).toMatchObject({ type: "invalid_input", data: { reason: "input" } })
    expect(JSON.stringify(result)).not.toContain("secret")
  })


  it("maps unknown ids, unsafe paths and revision expressions to declared errors", async () => {
    const root = mkTmpDir()
    try {
      const repo = join(root.dir, "repo")
      initRepo(repo)
      commit(repo, { "a.txt": "one\n" }, "first")

      const manager = new RepositoryManager(root.dir)
      try {
        const handlers = createGitGraphHandlers(manager)
        const { context } = makeContext()
        const [entry] = await manager.listRepositories()

        const missing = (await handlers.getStatus(
          { repositoryId: join(root.dir, "missing") },
          context as never,
        )) as unknown as TestError
        expect(missing).toMatchObject({ type: "repository_not_found" })
        expect(missing.message).not.toContain(root.dir)

        const traversal = (await handlers.getDiff(
          {
            repositoryId: entry.id,
            target: { type: "working-tree" },
            path: "../outside.txt",
          },
          context as never,
        )) as unknown as TestError
        expect(traversal).toMatchObject({
          type: "invalid_input",
          data: { reason: "path" },
        })

        const revision = (await handlers.getCommitFiles(
          { repositoryId: entry.id, hash: "--all" },
          context as never,
        )) as unknown as TestError
        expect(revision).toMatchObject({
          type: "invalid_input",
          data: { reason: "hash" },
        })

        const contentTraversal = (await handlers.getCommitFileContent(
          { repositoryId: entry.id, hash: entry.head!, path: "../outside.txt" },
          context as never,
        )) as unknown as TestError
        expect(contentTraversal).toMatchObject({
          type: "invalid_input",
          data: { reason: "path" },
        })

        const contentMissing = (await handlers.getCommitFileContent(
          { repositoryId: entry.id, hash: entry.head!, path: "missing.txt" },
          context as never,
        )) as unknown as TestError
        expect(contentMissing).toMatchObject({
          type: "invalid_input",
          data: { reason: "input" },
        })

        const tree = runGit(repo, ["rev-parse", `${entry.head}^{tree}`]).trim()
        const contentTree = (await handlers.getCommitFileContent(
          { repositoryId: entry.id, hash: tree, path: "a.txt" },
          context as never,
        )) as unknown as TestError
        expect(contentTree).toMatchObject({
          type: "invalid_input",
          data: { reason: "input" },
        })

        const contentMissingOid = (await handlers.getCommitFileContent(
          { repositoryId: entry.id, hash: "f".repeat(40), path: "a.txt" },
          context as never,
        )) as unknown as TestError
        expect(contentMissingOid).toMatchObject({
          type: "invalid_input",
          data: { reason: "input" },
        })
      } finally {
        manager.dispose()
      }
    } finally {
      root.cleanup()
    }
  })

  it("maps engine input errors to invalid_input without leaking details", async () => {
    const root = mkTmpDir()
    try {
      const repo = join(root.dir, "repo")
      initRepo(repo)
      const head = commit(repo, { "a.txt": "one\n" }, "first")

      const manager = new RepositoryManager(root.dir, { ttlMs: 60_000 })
      try {
        const handlers = createGitGraphHandlers(manager)
        const { context } = makeContext()
        const [entry] = await manager.listRepositories()

        // The root commit has no parents, so index 1 is rejected by the engine.
        const result = (await handlers.getCommitFiles(
          { repositoryId: entry.id, hash: head, parentIndex: 1 },
          context as never,
        )) as unknown as TestError

        expect(result).toMatchObject({
          type: "invalid_input",
          data: { reason: "input" },
        })
        expect(result.message).toBe("Invalid input")
        expect(result.message).not.toContain("Parent index")
        expect(JSON.stringify(result)).not.toContain(root.dir)
      } finally {
        manager.dispose()
      }
    } finally {
      root.cleanup()
    }
  })

  it("reports git failures without leaking paths in the message", async () => {
    const manager = fakeManager({
      getStatus: vi.fn(async () => {
        throw new Error("C:\\secret\\repo\\.git exploded")
      }),
    })
    const handlers = createGitGraphHandlers(manager)
    const { context } = makeContext()

    const result = (await handlers.getStatus(
      { repositoryId: "c:\\workspace\\repo" },
      context as never,
    )) as unknown as TestError

    expect(result).toMatchObject({ type: "git_failed", data: { operation: "getStatus" } })
    expect(result.message).not.toContain("secret")
  })

  it("refuses to start a git operation when the signal is already aborted", async () => {
    const controller = new AbortController()
    controller.abort()
    const getStatus = vi.fn(async () => statusFixture)
    const manager = fakeManager({ getStatus })
    const handlers = createGitGraphHandlers(manager)
    const { context } = makeContext(controller.signal)

    const result = (await handlers.getStatus(
      { repositoryId: statusFixture.repositoryId },
      context as never,
    )) as unknown as TestError

    expect(getStatus).not.toHaveBeenCalled()
    expect(result).toMatchObject({ type: "git_failed", data: { operation: "cancelled" } })
    expect(result.message).toContain("no git process was started")
  })

  it("reports post-call cancellation honestly instead of pretending to abort git", async () => {
    const controller = new AbortController()
    const getStatus = vi.fn(async () => {
      controller.abort()
      return statusFixture
    })
    const manager = fakeManager({ getStatus })
    const handlers = createGitGraphHandlers(manager)
    const { context } = makeContext(controller.signal)

    const result = (await handlers.getStatus(
      { repositoryId: statusFixture.repositoryId },
      context as never,
    )) as unknown as TestError

    expect(getStatus).toHaveBeenCalledWith(
      statusFixture.repositoryId,
      expect.objectContaining({ signal: expect.anything() }),
    )
    expect(result).toMatchObject({ type: "git_failed", data: { operation: "cancelled" } })
    expect(result.message).toContain("after the operation completed")
  })

  it("forwards the RPC signal through the manager", async () => {
    const controller = new AbortController()
    const getStatus = vi.fn(
      async (_repositoryId: string, options?: { signal?: AbortSignal }) => {
        expect(options?.signal).toBe(controller.signal)
        return statusFixture
      },
    )
    const manager = fakeManager({ getStatus })
    const handlers = createGitGraphHandlers(manager)
    const { context } = makeContext(controller.signal)

    const result = await handlers.getStatus(
      { repositoryId: statusFixture.repositoryId },
      context as never,
    )

    expect(getStatus).toHaveBeenCalledTimes(1)
    expect(result).toEqual(statusFixture)
  })

  it("maps an aborted manager call to the cancelled error", async () => {
    const controller = new AbortController()
    const manager = fakeManager({
      getStatus: vi.fn(async () => {
        controller.abort()
        throw Object.assign(new Error("aborted"), { name: "AbortError" })
      }),
    })
    const handlers = createGitGraphHandlers(manager)
    const { context } = makeContext(controller.signal)

    const result = (await handlers.getStatus(
      { repositoryId: statusFixture.repositoryId },
      context as never,
    )) as unknown as TestError

    expect(result).toMatchObject({ type: "git_failed", data: { operation: "cancelled" } })
    expect(result.message).toContain("repository discovery is not cancellable")
  })

  it("returns disposed when the manager aborts an in-flight handler request", async () => {
    const getStatus = vi.fn(
      (_repositoryId: string, options?: { signal?: AbortSignal }) =>
        new Promise<GitStatus>((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
            { once: true },
          )
        }),
    )
    const manager = new RepositoryManager("C:\\workspace", {
      deps: { discover: async () => [repositoryFixture], getStatus },
      ttlMs: 60_000,
    })
    await manager.listRepositories()

    const handlers = createGitGraphHandlers(manager)
    const { context } = makeContext()
    const pending = handlers.getStatus(
      { repositoryId: repositoryFixture.id },
      context as never,
    )
    await vi.waitFor(() => expect(getStatus).toHaveBeenCalledTimes(1))

    manager.dispose()
    const result = (await pending) as unknown as TestError
    expect(result).toMatchObject({ type: "disposed" })
  })

  it("returns the disposed error after the manager is disposed", async () => {
    const manager = new RepositoryManager("C:\\workspace")
    manager.dispose()
    const handlers = createGitGraphHandlers(manager)
    const { context } = makeContext()

    const result = (await handlers.listRepositories({}, context as never)) as unknown as TestError
    expect(result).toMatchObject({ type: "disposed" })
  })
})
