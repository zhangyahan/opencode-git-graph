import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import {
  RepositoryManager,
  RepositoryManagerError,
} from "../src/server/repository/manager.js"
import type { GitRepository, GitStatus } from "../src/shared/types.js"
import { commit, initRepo, mkTmpDir } from "./helpers.js"

const repository: GitRepository = {
  id: "c:\\workspace\\repo",
  name: "repo",
  rootPath: "C:\\workspace\\repo",
  gitDir: "C:\\workspace\\repo\\.git",
  type: "normal",
  branch: "main",
  head: "abcd1234",
  detached: false,
  changes: { staged: 0, unstaged: 1, untracked: 2, conflicted: 0 },
}

const status: GitStatus = {
  repositoryId: repository.id,
  branch: "main",
  head: "abcd1234",
  detached: false,
  files: [],
  counts: { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 },
}

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

describe("RepositoryManager", () => {
  it("scans real repositories once and serves status/log/files/diff by id", async () => {
    const root = mkTmpDir()
    try {
      const alpha = join(root.dir, "alpha")
      initRepo(alpha)
      const alphaHead = commit(alpha, { "a.txt": "one\n" }, "alpha first")

      const beta = join(root.dir, "group", "beta")
      initRepo(beta)
      const betaHead = commit(beta, { "b.txt": "one\n" }, "beta first")

      const manager = new RepositoryManager(root.dir, { ttlMs: 60_000 })
      try {
        const repositories = await manager.listRepositories()
        expect(repositories.map((entry) => entry.name).sort()).toEqual(["alpha", "beta"])

        const alphaId = repositories.find((entry) => entry.name === "alpha")?.id
        const betaId = repositories.find((entry) => entry.name === "beta")?.id
        expect(alphaId).toBeDefined()
        expect(betaId).toBeDefined()

        writeFileSync(join(alpha, "a.txt"), "two\n")
        const status = await manager.getStatus(alphaId!)
        expect(status.repositoryId).toBe(alphaId)
        expect(status.files).toContainEqual({
          path: "a.txt",
          status: "modified",
          staged: false,
        })

        const log = await manager.getLog(betaId!, { limit: 10 })
        expect(log.commits.map((entry) => entry.hash)).toEqual([betaHead])
        expect(log.hasMore).toBe(false)

        const files = await manager.getCommitFiles(alphaId!, alphaHead)
        expect(files).toEqual([{ path: "a.txt", status: "added", staged: true }])

        writeFileSync(join(beta, "b.txt"), "two\n")
        const diff = await manager.getDiff(betaId!, { type: "working-tree" }, "b.txt")
        expect(diff.path).toBe("b.txt")
        expect(diff.status).toBe("modified")
        expect(diff.text).toContain("-one")
        expect(diff.text).toContain("+two")
      } finally {
        manager.dispose()
      }
    } finally {
      root.cleanup()
    }
  })

  it("keeps listing healthy repositories when one has a corrupt index", async () => {
    const root = mkTmpDir()
    try {
      const healthy = join(root.dir, "healthy")
      initRepo(healthy)
      commit(healthy, { "a.txt": "one\n" }, "c1")

      const corrupt = join(root.dir, "corrupt")
      initRepo(corrupt)
      commit(corrupt, { "b.txt": "two\n" }, "c1")
      writeFileSync(join(corrupt, ".git", "index"), Buffer.from("DIRC\x00\x00\x00\x02\x00\x00\x00\x05"))

      const manager = new RepositoryManager(root.dir, { ttlMs: 60_000 })
      try {
        const repositories = await manager.listRepositories()
        expect(repositories.map((entry) => entry.name)).toEqual(["healthy"])
      } finally {
        manager.dispose()
      }
    } finally {
      root.cleanup()
    }
  })

  it("rejects unknown ids, traversal paths and revision expressions", async () => {
    const root = mkTmpDir()
    try {
      const alpha = join(root.dir, "alpha")
      initRepo(alpha)
      const head = commit(alpha, { "a.txt": "one\n" }, "first")

      const manager = new RepositoryManager(root.dir)
      try {
        const [entry] = await manager.listRepositories()
        expect(entry).toBeDefined()

        await expect(manager.getStatus(join(root.dir, "missing"))).rejects.toMatchObject({
          type: "repository_not_found",
        })

        for (const unsafe of [
          "../outside.txt",
          "a/../../b.txt",
          "/etc/passwd",
          "C:\\Windows\\win.ini",
          "a\\b.txt",
        ]) {
          await expect(
            manager.getDiff(entry.id, { type: "working-tree" }, unsafe),
          ).rejects.toMatchObject({ type: "invalid_input" })
        }

        await expect(manager.getCommitFiles(entry.id, "--all")).rejects.toMatchObject({
          type: "invalid_input",
        })
        await expect(manager.getCommitFiles(entry.id, "HEAD")).rejects.toMatchObject({
          type: "invalid_input",
        })
        await expect(
          manager.getDiff(entry.id, { type: "commit", hash: "HEAD~1" }, "a.txt"),
        ).rejects.toMatchObject({ type: "invalid_input" })

        // The real hash still works.
        await expect(manager.getCommitFiles(entry.id, head)).resolves.toEqual([
          { path: "a.txt", status: "added", staged: true },
        ])
      } finally {
        manager.dispose()
      }
    } finally {
      root.cleanup()
    }
  })

  it("shares one in-flight scan and clones results so callers cannot mutate the allowlist", async () => {
    const gate = deferred<GitRepository[]>()
    const discover = vi.fn(() => gate.promise)
    const manager = new RepositoryManager("C:\\workspace", {
      deps: { discover },
      ttlMs: 60_000,
    })

    const first = manager.listRepositories()
    const second = manager.listRepositories()
    expect(discover).toHaveBeenCalledTimes(1)

    gate.resolve([repository])
    const [firstResult, secondResult] = await Promise.all([first, second])
    expect(firstResult).toEqual([repository])
    expect(secondResult).toEqual([repository])
    expect(firstResult).not.toBe(secondResult)

    firstResult[0].name = "mutated"
    firstResult[0].changes.staged = 99
    const cached = await manager.listRepositories()
    expect(cached[0].name).toBe("repo")
    expect(cached[0].changes.staged).toBe(0)
    expect(discover).toHaveBeenCalledTimes(1)
  })

  it("honors TTL caching and invalidates it on refresh", async () => {
    let now = 1_000
    const discover = vi.fn(async () => [repository])
    const manager = new RepositoryManager("C:\\workspace", {
      deps: { discover, now: () => now },
      ttlMs: 100,
    })

    await manager.listRepositories()
    now = 1_050
    await manager.listRepositories()
    expect(discover).toHaveBeenCalledTimes(1)

    now = 1_200
    await manager.listRepositories()
    expect(discover).toHaveBeenCalledTimes(2)

    await manager.listRepositories({ refresh: true })
    expect(discover).toHaveBeenCalledTimes(3)
  })

  it("blocks new work and late scan write-back after dispose", async () => {
    const gate = deferred<GitRepository[]>()
    const discover = vi.fn(() => gate.promise)
    const manager = new RepositoryManager("C:\\workspace", { deps: { discover } })

    const pending = manager.listRepositories()
    const expectation = expect(pending).rejects.toBeInstanceOf(RepositoryManagerError)
    manager.dispose()
    gate.resolve([repository])
    await expectation

    await expect(manager.listRepositories()).rejects.toMatchObject({ type: "disposed" })
    await expect(manager.getStatus(repository.id)).rejects.toMatchObject({ type: "disposed" })
  })

  it("forwards the caller signal to the git engine and aborts the merged signal", async () => {
    const gate = deferred<GitStatus>()
    let received: AbortSignal | undefined
    const getStatus = vi.fn((_path: string, options?: { signal?: AbortSignal }) => {
      received = options?.signal
      return gate.promise
    })
    const manager = new RepositoryManager("C:\\workspace", {
      deps: { discover: async () => [repository], getStatus },
      ttlMs: 60_000,
    })
    await manager.listRepositories()

    const controller = new AbortController()
    const pending = manager.getStatus(repository.id, { signal: controller.signal })
    await vi.waitFor(() => expect(getStatus).toHaveBeenCalledTimes(1))

    expect(received).toBeDefined()
    expect(received).not.toBe(controller.signal)
    controller.abort()
    expect(received?.aborted).toBe(true)

    gate.resolve(status)
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    manager.dispose()
  })

  it("removes abort listeners once an operation settles", async () => {
    const controller = new AbortController()
    const add = vi.spyOn(controller.signal, "addEventListener")
    const remove = vi.spyOn(controller.signal, "removeEventListener")
    const manager = new RepositoryManager("C:\\workspace", {
      deps: { discover: async () => [repository], getStatus: async () => status },
      ttlMs: 60_000,
    })
    await manager.listRepositories()

    await manager.getStatus(repository.id, { signal: controller.signal })
    expect(add).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledTimes(1)

    add.mockRestore()
    remove.mockRestore()
    manager.dispose()
  })

  it("aborts in-flight git work when disposed", async () => {
    const gate = deferred<GitStatus>()
    let received: AbortSignal | undefined
    const getStatus = vi.fn((_path: string, options?: { signal?: AbortSignal }) => {
      received = options?.signal
      return gate.promise
    })
    const manager = new RepositoryManager("C:\\workspace", {
      deps: { discover: async () => [repository], getStatus },
      ttlMs: 60_000,
    })
    await manager.listRepositories()

    const pending = manager.getStatus(repository.id)
    const expectation = expect(pending).rejects.toMatchObject({ type: "disposed" })
    await vi.waitFor(() => expect(getStatus).toHaveBeenCalledTimes(1))

    manager.dispose()
    expect(received?.aborted).toBe(true)
    gate.reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
    await expectation
  })

  it("keeps discovery non-cancellable while rejecting an aborted list request", async () => {
    const gate = deferred<GitRepository[]>()
    const discover = vi.fn(() => gate.promise)
    const manager = new RepositoryManager("C:\\workspace", { deps: { discover } })

    const controller = new AbortController()
    const pending = manager.listRepositories({ signal: controller.signal })
    const expectation = expect(pending).rejects.toMatchObject({ name: "AbortError" })
    await vi.waitFor(() => expect(discover).toHaveBeenCalledTimes(1))

    controller.abort()
    gate.resolve([repository])
    await expectation

    // Discovery completed despite the abort, so its result remains cached.
    await expect(manager.requireRepository(repository.id)).resolves.toMatchObject({
      id: repository.id,
    })
    manager.dispose()
  })
})
