import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import {
  GetCommitFilesOutputSchema,
  GetDiffOutputSchema,
  GetLogOutputSchema,
  GetRefsOutputSchema,
  GetStatusOutputSchema,
  ListRepositoriesOutputSchema,
} from "../src/rpc.js"
import {
  createGitGraphHandlers,
  RepositoryManager,
  type GitGraphManager,
} from "../src/server/repository/manager.js"
import type { FileDiff, GitRepository, GitStatus } from "../src/shared/types.js"
import { commit, initRepo, mkTmpDir } from "./helpers.js"

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
    getDiff: vi.fn(async () => diffFixture),
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
        expect(files.files).toEqual([{ path: "a.txt", status: "added", staged: true }])

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
