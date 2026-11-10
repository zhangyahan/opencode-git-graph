import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import {
  RepositoryManager,
  RepositoryManagerError,
  type MutationEngine,
  type MutationEngineResult,
  type RepositoryWriteBinding,
} from "../src/server/repository/manager.js"
import type { GitFetchResult, GitRepository, GitStatus } from "../src/shared/types.js"
import { commit, initRepo, mkTmpDir, runGit } from "./helpers.js"

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const EMPTY_COUNTS = { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 }

function fakeRepo(name: string, root = `C:\\workspace\\${name}`): GitRepository {
  return {
    id: root,
    name,
    rootPath: root,
    gitDir: `${root}\\.git`,
    type: "normal",
    branch: "main",
    head: "a".repeat(40),
    detached: false,
    changes: { ...EMPTY_COUNTS },
  }
}

function mutationResult(repositoryId: string, overrides: Partial<GitStatus> = {}): MutationEngineResult {
  return {
    status: {
      repositoryId,
      branch: "main",
      head: "a".repeat(40),
      detached: false,
      files: [],
      counts: { ...EMPTY_COUNTS },
      ...overrides,
    },
    changed: true,
  }
}

function fakeEngine(overrides: Partial<MutationEngine> = {}): MutationEngine {
  const fallback = vi.fn(async () => mutationResult("c:\\workspace\\repo"))
  return {
    checkoutBranch: fallback,
    createBranch: fallback,
    createTag: fallback,
    renameBranch: fallback,
    deleteBranch: fallback,
    deleteTag: fallback,
    fetchRemote: vi.fn(async () => ({ ...mutationResult("c:\\workspace\\repo"), refsUpdated: 0 })),
    ...overrides,
  }
}

function fakeManager(options: {
  repositories: GitRepository[]
  engine: MutationEngine
  commonDir: (repository: GitRepository) => string
  discover?: (root: string) => Promise<GitRepository[]>
}): RepositoryManager {
  return new RepositoryManager("C:\\workspace", {
    ttlMs: 60_000,
    deps: {
      discover: options.discover ?? (async () => options.repositories),
      mutations: options.engine,
      validateRepository: async (repository): Promise<RepositoryWriteBinding> => ({
        realRoot: repository.rootPath,
        commonDir: options.commonDir(repository),
      }),
      realpath: async (value) => value,
    },
  })
}

describe("RepositoryManager writes", () => {
  it("serializes writes that share a git common dir even across repositories", async () => {
    const a = fakeRepo("a")
    const b = fakeRepo("b")
    const gates = new Map<string, ReturnType<typeof deferred<MutationEngineResult>>>()
    const calls: string[] = []
    const checkoutBranch = vi.fn((repositoryPath: string) => {
      calls.push(repositoryPath)
      const gate = deferred<MutationEngineResult>()
      gates.set(repositoryPath, gate)
      return gate.promise
    })
    const engine = fakeEngine({ checkoutBranch })
    const manager = fakeManager({
      repositories: [a, b],
      engine,
      commonDir: () => "C:\\shared\\.git",
    })
    await manager.listRepositories()

    const first = manager.checkoutBranch(a.id, { branch: "main", expectedHead: null })
    await vi.waitFor(() => expect(checkoutBranch).toHaveBeenCalledTimes(1))
    const second = manager.checkoutBranch(b.id, { branch: "main", expectedHead: null })

    // The second write is queued: it must not reach the engine yet.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(calls).toEqual([a.rootPath])

    gates.get(a.rootPath)!.resolve(mutationResult(a.id))
    await expect(first).resolves.toMatchObject({ changed: true })
    await vi.waitFor(() => expect(checkoutBranch).toHaveBeenCalledTimes(2))
    expect(calls).toEqual([a.rootPath, b.rootPath])

    gates.get(b.rootPath)!.resolve(mutationResult(b.id))
    await expect(second).resolves.toMatchObject({ changed: true })
    manager.dispose()
  })

  it("runs writes in parallel when the git common dir differs", async () => {
    const a = fakeRepo("a")
    const b = fakeRepo("b")
    const gates = new Map<string, ReturnType<typeof deferred<MutationEngineResult>>>()
    const calls: string[] = []
    const checkoutBranch = vi.fn((repositoryPath: string) => {
      calls.push(repositoryPath)
      const gate = deferred<MutationEngineResult>()
      gates.set(repositoryPath, gate)
      return gate.promise
    })
    const engine = fakeEngine({ checkoutBranch })
    const manager = fakeManager({
      repositories: [a, b],
      engine,
      commonDir: (repository) => `${repository.rootPath}\\.git`,
    })
    await manager.listRepositories()

    const first = manager.checkoutBranch(a.id, { branch: "main", expectedHead: null })
    const second = manager.checkoutBranch(b.id, { branch: "main", expectedHead: null })
    await vi.waitFor(() => expect(checkoutBranch).toHaveBeenCalledTimes(2))
    expect(calls.sort()).toEqual([a.rootPath, b.rootPath].sort())

    gates.get(a.rootPath)!.resolve(mutationResult(a.id))
    gates.get(b.rootPath)!.resolve(mutationResult(b.id))
    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
    manager.dispose()
  })

  it("does not spawn a queued write whose caller aborts while it waits", async () => {
    const a = fakeRepo("a")
    const b = fakeRepo("b")
    const firstGate = deferred<MutationEngineResult>()
    const calls: string[] = []
    const checkoutBranch = vi.fn((repositoryPath: string) => {
      calls.push(repositoryPath)
      return firstGate.promise
    })
    const engine = fakeEngine({ checkoutBranch })
    const manager = fakeManager({
      repositories: [a, b],
      engine,
      commonDir: () => "C:\\shared\\.git",
    })
    await manager.listRepositories()

    const running = manager.checkoutBranch(a.id, { branch: "main", expectedHead: null })
    await vi.waitFor(() => expect(checkoutBranch).toHaveBeenCalledTimes(1))

    const controller = new AbortController()
    const queued = manager.checkoutBranch(
      b.id,
      { branch: "main", expectedHead: null },
      { signal: controller.signal },
    )
    controller.abort()

    firstGate.resolve(mutationResult(a.id))
    await expect(running).resolves.toMatchObject({ changed: true })
    await expect(queued).rejects.toMatchObject({ name: "AbortError" })
    expect(calls).toEqual([a.rootPath])
    manager.dispose()
  })

  it("reports an in-flight write as successful when the caller aborts after it starts", async () => {
    const a = fakeRepo("a")
    const gate = deferred<MutationEngineResult>()
    const checkoutBranch = vi.fn(() => gate.promise)
    const manager = fakeManager({
      repositories: [a],
      engine: fakeEngine({ checkoutBranch }),
      commonDir: () => "C:\\shared\\.git",
    })
    await manager.listRepositories()

    const controller = new AbortController()
    const pending = manager.checkoutBranch(
      a.id,
      { branch: "main", expectedHead: null },
      { signal: controller.signal },
    )
    await vi.waitFor(() => expect(checkoutBranch).toHaveBeenCalledTimes(1))

    controller.abort()
    gate.resolve(mutationResult(a.id))
    await expect(pending).resolves.toMatchObject({ changed: true })
    manager.dispose()
  })

  it("lets an in-flight write finish when the manager is disposed", async () => {
    const a = fakeRepo("a")
    const gate = deferred<MutationEngineResult>()
    const checkoutBranch = vi.fn(() => gate.promise)
    const manager = fakeManager({
      repositories: [a],
      engine: fakeEngine({ checkoutBranch }),
      commonDir: () => "C:\\shared\\.git",
    })
    await manager.listRepositories()

    const pending = manager.checkoutBranch(a.id, { branch: "main", expectedHead: null })
    await vi.waitFor(() => expect(checkoutBranch).toHaveBeenCalledTimes(1))

    manager.dispose()
    gate.resolve(mutationResult(a.id))
    await expect(pending).resolves.toMatchObject({ changed: true })

    await expect(
      manager.checkoutBranch(a.id, { branch: "main", expectedHead: null }),
    ).rejects.toMatchObject({ type: "disposed" })
    expect(checkoutBranch).toHaveBeenCalledTimes(1)
  })

  it("drops a queued write on dispose without spawning it", async () => {
    const a = fakeRepo("a")
    const b = fakeRepo("b")
    const firstGate = deferred<MutationEngineResult>()
    const checkoutBranch = vi.fn(() => firstGate.promise)
    const manager = fakeManager({
      repositories: [a, b],
      engine: fakeEngine({ checkoutBranch }),
      commonDir: () => "C:\\shared\\.git",
    })
    await manager.listRepositories()

    const running = manager.checkoutBranch(a.id, { branch: "main", expectedHead: null })
    await vi.waitFor(() => expect(checkoutBranch).toHaveBeenCalledTimes(1))
    const queued = manager.checkoutBranch(b.id, { branch: "main", expectedHead: null })

    manager.dispose()
    firstGate.resolve(mutationResult(a.id))
    await expect(running).resolves.toMatchObject({ changed: true })
    await expect(queued).rejects.toMatchObject({ type: "disposed" })
    expect(checkoutBranch).toHaveBeenCalledTimes(1)
  })

  it("invalidates the discovery snapshot and updates the allowlist after a successful write", async () => {
    const a = fakeRepo("a")
    const discover = vi
      .fn<(root: string) => Promise<GitRepository[]>>()
      .mockResolvedValueOnce([a])
      .mockResolvedValueOnce([{ ...a, branch: "feature", head: "b".repeat(40) }])
    const manager = fakeManager({
      repositories: [a],
      engine: fakeEngine({
        checkoutBranch: vi.fn(async () =>
          mutationResult(a.id, { branch: "feature", head: "b".repeat(40) }),
        ),
      }),
      commonDir: () => "C:\\shared\\.git",
      discover,
    })

    await manager.listRepositories()
    expect(discover).toHaveBeenCalledTimes(1)

    await manager.checkoutBranch(a.id, { branch: "feature", expectedHead: a.head })
    const listed = await manager.listRepositories()
    expect(discover).toHaveBeenCalledTimes(2)
    expect(listed[0]).toMatchObject({ branch: "feature", head: "b".repeat(40) })
    manager.dispose()
  })

  it("rejects invalid expected heads and unsafe ref names before touching the engine", async () => {
    const a = fakeRepo("a")
    const checkoutBranch = vi.fn(async () => mutationResult(a.id))
    const manager = fakeManager({
      repositories: [a],
      engine: fakeEngine({ checkoutBranch }),
      commonDir: () => "C:\\shared\\.git",
    })
    await manager.listRepositories()

    for (const expectedHead of ["abcd", "HEAD", "--all", "a".repeat(39)]) {
      await expect(
        manager.checkoutBranch(a.id, { branch: "main", expectedHead }),
      ).rejects.toMatchObject({ type: "invalid_input", data: { reason: "expectedHead" } })
    }

    for (const branch of ["--all", "-x", "../x", "x..y", "refs/heads/x", "x y"]) {
      await expect(
        manager.checkoutBranch(a.id, { branch, expectedHead: null }),
      ).rejects.toMatchObject({ type: "invalid_input", data: { reason: "branch" } })
    }

    expect(checkoutBranch).not.toHaveBeenCalled()
    manager.dispose()
  })

  it("maps engine write errors to a bounded mutation reason without leaking details", async () => {
    const a = fakeRepo("a")
    const manager = fakeManager({
      repositories: [a],
      engine: fakeEngine({
        checkoutBranch: vi.fn(async () => {
          throw Object.assign(new Error("C:\\secret\\repo failed"), {
            name: "GitMutationError",
            reason: "expected_head_mismatch",
          })
        }),
      }),
      commonDir: () => "C:\\shared\\.git",
    })
    await manager.listRepositories()

    await expect(
      manager.checkoutBranch(a.id, { branch: "main", expectedHead: a.head }),
    ).rejects.toMatchObject({
      type: "mutation_rejected",
      data: { reason: "expected_head_mismatch" },
      message: "Mutation rejected",
    })

    manager.dispose()
  })

  it("forwards fetch options and returns the ref count", async () => {
    const a = fakeRepo("a")
    const fetchRemote = vi.fn(async (): Promise<GitFetchResult> => ({
      ...mutationResult(a.id, { branch: "main", head: "b".repeat(40) }),
      refsUpdated: 2,
    }))
    const manager = fakeManager({
      repositories: [a],
      engine: fakeEngine({ fetchRemote }),
      commonDir: () => "C:\\shared\\.git",
    })
    await manager.listRepositories()

    const result = await manager.fetchRemote(a.id, {
      remote: "origin",
      prune: true,
      expectedHead: a.head,
    })

    expect(result.refsUpdated).toBe(2)
    expect(result.status.head).toBe("b".repeat(40))
    expect(fetchRemote).toHaveBeenCalledWith(a.rootPath, {
      remote: "origin",
      prune: true,
      expectedHead: a.head,
    })

    await manager.fetchRemote(a.id, { expectedHead: null })
    expect(fetchRemote).toHaveBeenLastCalledWith(a.rootPath, {
      remote: null,
      expectedHead: null,
    })
    manager.dispose()
  })

  it("rejects unsafe fetch inputs before touching the engine", async () => {
    const a = fakeRepo("a")
    const fetchRemote = vi.fn(async (): Promise<GitFetchResult> => ({
      ...mutationResult(a.id),
      refsUpdated: 0,
    }))
    const manager = fakeManager({
      repositories: [a],
      engine: fakeEngine({ fetchRemote }),
      commonDir: () => "C:\\shared\\.git",
    })
    await manager.listRepositories()

    for (const remote of ["--all", "-x", "../x", "refs/heads/x", "x y"]) {
      await expect(
        manager.fetchRemote(a.id, { remote, expectedHead: null }),
      ).rejects.toMatchObject({ type: "invalid_input", data: { reason: "remote" } })
    }
    await expect(
      manager.fetchRemote(a.id, { prune: "yes" as never, expectedHead: null }),
    ).rejects.toMatchObject({ type: "invalid_input", data: { reason: "prune" } })

    expect(fetchRemote).not.toHaveBeenCalled()
    manager.dispose()
  })

  it("lets an in-flight fetch finish when the manager is disposed", async () => {
    const a = fakeRepo("a")
    const gate = deferred<GitFetchResult>()
    const fetchRemote = vi.fn(() => gate.promise)
    const manager = fakeManager({
      repositories: [a],
      engine: fakeEngine({ fetchRemote }),
      commonDir: () => "C:\\shared\\.git",
    })
    await manager.listRepositories()

    const pending = manager.fetchRemote(a.id, { remote: "origin", expectedHead: null })
    await vi.waitFor(() => expect(fetchRemote).toHaveBeenCalledTimes(1))

    manager.dispose()
    gate.resolve({ ...mutationResult(a.id), refsUpdated: 0 })
    await expect(pending).resolves.toMatchObject({ refsUpdated: 0 })

    await expect(
      manager.fetchRemote(a.id, { remote: "origin", expectedHead: null }),
    ).rejects.toMatchObject({ type: "disposed" })
    expect(fetchRemote).toHaveBeenCalledTimes(1)
  })

  it("forwards every log option to the engine", async () => {    const a = fakeRepo("a")
    const getLog = vi.fn(async () => ({ commits: [], hasMore: false }))
    const manager = new RepositoryManager("C:\\workspace", {
      ttlMs: 60_000,
      deps: {
        discover: async () => [a],
        getLog,
        realpath: async (value) => value,
      },
    })
    await manager.listRepositories()

    await manager.getLog(a.id, {
      limit: 50,
      skip: 2,
      refs: ["refs/heads/main", "refs/tags/v1"],
      showRemotes: false,
      showTags: true,
      firstParent: true,
      order: "topo",
    })

    expect(getLog).toHaveBeenCalledWith(
      a.rootPath,
      expect.objectContaining({
        limit: 50,
        skip: 2,
        refs: ["refs/heads/main", "refs/tags/v1"],
        showRemotes: false,
        showTags: true,
        firstParent: true,
        order: "topo",
        signal: expect.anything(),
      }),
    )
    manager.dispose()
  })

  it("uses real compare and explicit-ref log reads", async () => {
    const root = mkTmpDir()
    try {
      const repo = join(root.dir, "repo")
      initRepo(repo)
      const base = commit(repo, { "a.txt": "one\n" }, "base")
      const head = commit(repo, { "a.txt": "two\n", "b.txt": "new\n" }, "head")

      const manager = new RepositoryManager(root.dir, { ttlMs: 60_000 })
      try {
        const [entry] = await manager.listRepositories()
        const files = await manager.getComparisonFiles(entry.id, base, head)
        expect(files).toContainEqual({
          path: "a.txt",
          status: "modified",
          staged: true,
          added: 1,
          deleted: 1,
        })
        expect(files).toContainEqual({
          path: "b.txt",
          status: "added",
          staged: true,
          added: 1,
          deleted: 0,
        })

        const diff = await manager.getComparisonDiff(entry.id, base, head, "a.txt")
        expect(diff.text).toContain("-one")
        expect(diff.text).toContain("+two")

        const log = await manager.getLog(entry.id, {
          refs: ["refs/heads/main"],
          showRemotes: false,
          showTags: false,
          firstParent: true,
          order: "topo",
          limit: 10,
        })
        expect(log.commits.map((commitEntry) => commitEntry.hash)).toEqual([head, base])

        await expect(
          manager.getComparisonDiff(entry.id, base, head, "missing.txt"),
        ).rejects.toBeInstanceOf(Error)
        await expect(
          manager.getComparisonFiles(entry.id, base, "HEAD~1"),
        ).rejects.toMatchObject({ type: "invalid_input" })
      } finally {
        manager.dispose()
      }
    } finally {
      root.cleanup()
    }
  })

  it("re-validates a cached repository so a core.worktree redirect is refused", async () => {
    const root = mkTmpDir()
    try {
      const repo = join(root.dir, "repo")
      const outside = join(root.dir, "outside")
      initRepo(repo)
      initRepo(outside)
      const head = commit(repo, { "a.txt": "one\n" }, "base")
      const createTag = vi.fn(async () => ({
        status: {
          repositoryId: repo,
          branch: "main",
          head,
          detached: false,
          files: [],
          counts: { ...EMPTY_COUNTS },
        },
        changed: true,
      }))

      const manager = new RepositoryManager(root.dir, {
        ttlMs: 60_000,
        deps: { mutations: fakeEngine({ createTag }) },
      })
      try {
        const repositories = await manager.listRepositories()
        const entry = repositories.find((repository) => repository.name === "repo")
        expect(entry).toBeDefined()

        // Poison the cached repository after discovery: the write must
        // re-bind it and refuse to touch the redirected worktree.
        runGit(repo, ["config", "core.worktree", outside])
        await expect(
          manager.createTag(entry!.id, { name: "v1", target: head, expectedHead: head }),
        ).rejects.toMatchObject({ type: "mutation_rejected" })
        expect(createTag).not.toHaveBeenCalled()
      } finally {
        manager.dispose()
      }
    } finally {
      root.cleanup()
    }
  })

  it("rejects an already aborted write synchronously without scanning or spawning", async () => {
    const discover = vi.fn(async () => [fakeRepo("a")])
    const mutation = vi.fn(async () => mutationResult("c:\\workspace\\a"))
    const manager = new RepositoryManager("C:\\workspace", {
      deps: {
        discover,
        mutations: fakeEngine({ checkoutBranch: mutation }),
        realpath: async (value) => value,
      },
    })
    const controller = new AbortController()
    controller.abort()

    await expect(
      manager.checkoutBranch(
        "C:\\workspace\\a",
        { branch: "main", expectedHead: null },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: "AbortError" })
    expect(discover).not.toHaveBeenCalled()
    expect(mutation).not.toHaveBeenCalled()
    manager.dispose()
  })

  it("does not turn a successful write into a failure when the follow-up cache update is stale", async () => {
    const a = fakeRepo("a")
    const manager = fakeManager({
      repositories: [a],
      engine: fakeEngine({
        checkoutBranch: vi.fn(async () => {
          // Simulate a concurrent dispose after the git write succeeded.
          manager.dispose()
          return mutationResult(a.id)
        }),
      }),
      commonDir: () => "C:\\shared\\.git",
    })
    await manager.listRepositories()

    const result = await manager.checkoutBranch(a.id, { branch: "main", expectedHead: null })
    expect(result).toMatchObject({ changed: true })
    expect(result.status.repositoryId).toBe(a.id)
  })

  it(
    "runs real create/rename/checkout/delete and tag mutations through the manager",
    async () => {
      const root = mkTmpDir()
      try {
        const repo = join(root.dir, "repo")
        initRepo(repo)
        const head = commit(repo, { "a.txt": "one\n" }, "base")
        const manager = new RepositoryManager(root.dir, { ttlMs: 60_000 })
        try {
          const [entry] = await manager.listRepositories()

          await expect(
            manager.createBranch(entry.id, {
              name: "feature",
              startPoint: head,
              checkout: true,
              expectedHead: head,
            }),
          ).resolves.toMatchObject({ changed: true })
          expect((await manager.getStatus(entry.id)).branch).toBe("feature")

          await expect(
            manager.renameBranch(entry.id, {
              oldName: "feature",
              newName: "renamed",
              expectedHead: head,
            }),
          ).resolves.toMatchObject({ changed: true })
          expect((await manager.getStatus(entry.id)).branch).toBe("renamed")

          await expect(
            manager.checkoutBranch(entry.id, { branch: "main", expectedHead: head }),
          ).resolves.toMatchObject({ changed: true })
          expect((await manager.getStatus(entry.id)).branch).toBe("main")

          await expect(
            manager.deleteBranch(entry.id, { name: "renamed", expectedHead: head }),
          ).resolves.toMatchObject({ changed: true })

          await expect(
            manager.createTag(entry.id, {
              name: "v1",
              target: head,
              message: "release",
              expectedHead: head,
            }),
          ).resolves.toMatchObject({ changed: true })
          await expect(
            manager.deleteTag(entry.id, { name: "v1", expectedHead: head }),
          ).resolves.toMatchObject({ changed: true })
        } finally {
          manager.dispose()
        }
      } finally {
        root.cleanup()
      }
    },
    30_000,
  )

  it("surfaces mutation errors from the real manager as mutation_rejected", async () => {
    const a = fakeRepo("a")
    const manager = fakeManager({
      repositories: [a],
      engine: fakeEngine({
        renameBranch: vi.fn(async () => {
          throw Object.assign(new Error("boom"), {
            name: "GitMutationError",
            reason: "x".repeat(500),
          })
        }),
      }),
      commonDir: () => "C:\\shared\\.git",
    })
    await manager.listRepositories()

    await expect(
      manager.renameBranch(a.id, { oldName: "main", newName: "trunk", expectedHead: null }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof RepositoryManagerError &&
        error.type === "mutation_rejected" &&
        (error.data.reason?.length ?? 0) === 200,
    )
    manager.dispose()
  })
})
